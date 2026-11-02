"""Generate immutable, compressed UK road cells. No database or service credentials.
Run once on an import machine, then deploy the generated public/roads assets.
"""
import argparse
import contextlib
import datetime
import gzip
import hashlib
import itertools
import json
import math
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import uuid
import osmium
from segments import split_nodes, segment_id
from osm_reader import apply_with_locations

HIGHWAYS = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
            'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
            'residential', 'living_street', 'service', 'pedestrian', 'road'}


def eligible(way):
    return way.tags.get('highway') in HIGHWAYS and way.tags.get('area') != 'yes'


def cell_at(lon, lat):
    sine = math.sin(math.radians(lat))
    return math.floor((lon + 180) / 360 * 4096), math.floor((.5 - math.log((1 + sine) / (1 - sine)) / (4 * math.pi)) * 4096)


def cells_for(nodes):
    west, east = min(n[1] for n in nodes), max(n[1] for n in nodes)
    south, north = min(n[2] for n in nodes), max(n[2] for n in nodes)
    x0, y1 = cell_at(west, south)
    x1, y0 = cell_at(east, north)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            yield f'{x}/{y}'


def run(args):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', args.version):
        raise ValueError('Use a unique immutable version containing letters, digits, _ or -.')
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    release = output / args.version
    if release.exists():
        raise ValueError('This release already exists. Never overwrite an immutable dataset version.')
    with contextlib.nullcontext(args.scratch) as scratch:
        with open(args.pbf, 'rb') as file:
            sha = hashlib.file_digest(file, 'sha256').hexdigest()
        counts = sqlite3.connect(str(Path(scratch) / 'nodes.sqlite'))
        counts.execute('pragma journal_mode=wal')
        counts.execute('pragma synchronous=full')
        counts.execute('pragma cache_size=-131072')
        if not args.resume:
            counts.execute('create table refs (id integer primary key, n integer not null)')
            counts.execute('create table cells (cell text, id text, feature text, primary key(cell,id))')
            counts.execute('create table meta (key text primary key, value text not null)')
            counts.executemany('insert into meta values (?,?)', [('sha256', sha), ('version', args.version), ('phase', 'counting'), ('last_way', '0'), ('segments', '0')])
            counts.commit()
        state = dict(counts.execute('select key,value from meta'))
        if state.get('sha256') != sha or state.get('version') != args.version:
            raise ValueError('Resume requires the exact same source SHA-256 and dataset version.')
        if args.resume:
            if counts.execute('pragma integrity_check').fetchall() != [('ok',)]:
                raise ValueError('Staging failed integrity checking; preserve it and recover into a clean copy.')
            if state.get('phase') == 'counting':
                raise ValueError('Junction pass was incomplete; it cannot be reused as complete junction counts.')

        def checkpoint(key, value):
            counts.execute('insert into meta values (?,?) on conflict(key) do update set value=excluded.value', (key, str(value)))

        class Count(osmium.SimpleHandler):
            def __init__(self):
                super().__init__()
                self.batch = []

            def flush(self):
                counts.executemany('insert into refs values (?,1) on conflict(id) do update set n=n+1', self.batch)
                counts.commit()
                self.batch.clear()

            def way(self, way):
                if eligible(way):
                    self.batch.extend((n.ref,) for n in way.nodes)
                    if len(self.batch) >= 100000:
                        self.flush()

        if state['phase'] == 'counting':
            print('Pass 1: counting source junctions.', flush=True)
            counter = Count()
            counter.apply_file(args.pbf)
            counter.flush()
            checkpoint('phase', 'geometry')
            counts.commit()
        else:
            print('Reusing completed junction counts; pass 1 is not repeated.', flush=True)

        class Roads(osmium.SimpleHandler):
            total = int(state['segments'])
            since_commit = 0
            previous_way = 0
            last_way = int(state['last_way'])

            def save(self):
                checkpoint('last_way', self.last_way)
                checkpoint('segments', self.total)
                counts.commit()
                self.since_commit = 0

            def way(self, way):
                if way.id <= self.previous_way:
                    raise ValueError('Source ways must be sorted by increasing ID for safe checkpoints.')
                self.previous_way = way.id
                if way.id <= int(state['last_way']):
                    return
                self.last_way = way.id
                if not eligible(way):
                    return
                nodes = [(n.ref, n.lon, n.lat) for n in way.nodes]
                def junction(ref):
                    return counts.execute('select n from refs where id=?', (ref,)).fetchone()[0] > 1
                for part in split_nodes(nodes, junction):
                    if any(not (-9 <= n[1] <= 3 and 49 <= n[2] <= 61.5) for n in part):
                        continue
                    identity = segment_id(args.version, way.id, part)
                    feature = {'type': 'Feature', 'id': identity, 'properties': {'id': identity, 'name': way.tags.get('name', '')},
                               'geometry': {'type': 'LineString', 'coordinates': [[n[1], n[2]] for n in part]}}
                    payload = json.dumps(feature, separators=(',', ':'), ensure_ascii=False)
                    counts.executemany('insert or ignore into cells values (?,?,?)', ((cell, identity, payload) for cell in cells_for(part)))
                    self.total += 1
                    self.since_commit += 1
                    if self.total % 100000 == 0:
                        print(f'Staged {self.total:,} sections.', flush=True)
                # Commit at a whole-way boundary, atomically with the resume cursor.
                if self.since_commit >= 10000:
                    self.save()

        if state['phase'] != 'complete':
            print(f"Pass 2: continuing after source way {state['last_way']} ({int(state['segments']):,} saved sections).", flush=True)
            roads = Roads()
            # Rebuild location lookup; a cache left by a power failure is not trusted.
            apply_with_locations(roads, args.pbf, Path(scratch) / f'locations-{uuid.uuid4().hex}.idx')
            roads.save()
            checkpoint('phase', 'complete')
            counts.commit()
        total = counts.execute('select count(distinct id) from cells').fetchone()[0]
        if not total:
            raise ValueError('No UK road sections found. Check the extract.')
        cells = [row[0] for row in counts.execute('select distinct cell from cells order by cell')]
        print(f'Geometry complete: {total:,} unique sections. Compressing {len(cells):,} cells.', flush=True)
        reuse = Path(args.reuse_cells).resolve() if args.reuse_cells else None
        if reuse and (reuse.parent != output or not reuse.name.startswith('.building-') or not reuse.is_dir()):
            raise ValueError('Reusable cells must be a previous .building-* directory in this output directory.')
        # A single sequential table scan plus an external sort avoids millions of
        # scattered row lookups through the (cell,id) index on laptop disks.
        counts.execute('pragma temp_store=file')
        cursor = counts.execute("select cell, feature || '' from cells not indexed order by cell,id")
        # This staging directory contains only closed gzip files; the parent owns the mapped node scratch.
        with tempfile.TemporaryDirectory(prefix='.building-', dir=output) as staging:
            compressed_bytes = 0
            largest_cell_bytes = 0
            reused = 0
            number = 0
            for number, (cell, rows) in enumerate(itertools.groupby(cursor, key=lambda row: row[0]), 1):
                payloads = [row[1] for row in rows]
                target = Path(staging) / '12' / f'{cell}.json.gz'
                target.parent.mkdir(parents=True, exist_ok=True)
                previous = reuse / '12' / f'{cell}.json.gz' if reuse else None
                matches = False
                if previous and previous.is_file():
                    try:
                        with gzip.open(previous, 'rt', encoding='utf-8') as file:
                            doc = json.load(file)
                        # Verify complete payloads, not only matching IDs or a valid gzip header.
                        matches = doc == {'type': 'FeatureCollection', 'features': [json.loads(p) for p in payloads]}
                    except (OSError, EOFError, ValueError):
                        pass  # Partial/corrupt final cell is regenerated from durable geometry.
                if matches:
                    shutil.copyfile(previous, target)
                    reused += 1
                else:
                    with gzip.GzipFile(filename=str(target), mode='wb', mtime=0) as compressed:
                        compressed.write(b'{"type":"FeatureCollection","features":[')
                        compressed.write(','.join(payloads).encode('utf-8'))
                        compressed.write(b']}')
                size = target.stat().st_size
                compressed_bytes += size
                largest_cell_bytes = max(largest_cell_bytes, size)
                if number % 1000 == 0:
                    print(f'Compressed {number:,}/{len(cells):,} cells ({reused:,} verified existing cells reused).', flush=True)
            if number != len(cells):
                raise ValueError('Cell export count does not match the staging index.')
            # Rename only the exact generated staging directory into the explicitly named output release.
            if Path(staging).resolve().parent != output or release.resolve().parent != output:
                raise ValueError('Generated release paths must remain inside the selected output directory.')
            Path(staging).rename(release)
        manifest = {'format': 'swiftfix-road-cells', 'version': 1, 'dataset': args.version, 'cellZoom': 12, 'cells': cells,
                    'source': args.source_url, 'sha256': sha, 'segmentCount': total,
                    'compressedBytes': compressed_bytes, 'largestCellBytes': largest_cell_bytes,
                    'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    'attribution': '© OpenStreetMap contributors', 'license': 'ODbL-1.0'}
        temp_manifest = output / f'.manifest-{args.version}.json'
        temp_manifest.write_text(json.dumps(manifest, separators=(',', ':')), encoding='utf-8')
        temp_manifest.replace(output / 'manifest.json')
        counts.close()
        print(f'Generated {total:,} sections in {len(cells):,} cells. SHA-256: {sha}', flush=True)
        print(f'Compressed cells: {compressed_bytes:,} bytes; largest cell: {largest_cell_bytes:,} bytes.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pbf', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--output', default='public/roads')
    parser.add_argument('--work', default='work/import')
    parser.add_argument('--source-url', default='https://download.geofabrik.de/europe/united-kingdom.html')
    parser.add_argument('--scratch', help=argparse.SUPPRESS)
    parser.add_argument('--resume', action='store_true', help='Reuse durable completed junction/whole-way checkpoints for this version.')
    parser.add_argument('--keep-work', action='store_true', help='Keep successful checkpoints for verification or repackaging.')
    parser.add_argument('--reuse-cells', help='Verify/reuse closed gzip cells from a previous output .building-* directory.')
    args = parser.parse_args()
    if args.scratch:
        run(args)
    else:
        root = Path(args.work).resolve()
        root.mkdir(parents=True, exist_ok=True)
        scratch = root / args.version
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', args.version) or scratch.resolve().parent != root:
            raise ValueError('Unsafe staging version/path.')
        if args.resume:
            if not (scratch / 'nodes.sqlite').is_file():
                raise ValueError('No checkpoint exists for this version in the selected work directory.')
        else:
            scratch.mkdir(exist_ok=False)
        result = subprocess.run([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:], '--scratch', str(scratch)])
        # The worker has exited, so Windows no longer holds mapped files open.
        for index in scratch.glob('locations-*.idx'):
            if re.fullmatch(r'locations-[0-9a-f]{32}\.idx', index.name) and index.resolve().parent == scratch.resolve():
                index.unlink()  # Disposable cache; only durable road/junction checkpoints are reused.
        if result.returncode == 0 and not args.keep_work:
            if scratch.resolve().parent != root or scratch.name != args.version:
                raise ValueError('Unsafe staging cleanup path.')
            shutil.rmtree(scratch)
        elif result.returncode:
            print(f'Import interrupted/failed. Checkpoints preserved at {scratch}.', file=sys.stderr)
        sys.exit(result.returncode)
