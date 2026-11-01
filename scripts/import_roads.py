"""Generate immutable, compressed UK road cells. No database or service credentials.
Run once on an import machine, then deploy the generated public/roads assets.
"""
import argparse
import contextlib
import datetime
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
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
        counts = sqlite3.connect(str(Path(scratch) / 'nodes.sqlite'))
        counts.execute('pragma journal_mode=off')
        counts.execute('create table refs (id integer primary key, n integer not null)')
        counts.execute('create table cells (cell text, id text, feature text, primary key(cell,id))')

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

        print('Pass 1: counting source junctions.', flush=True)
        counter = Count()
        counter.apply_file(args.pbf)
        counter.flush()
        with open(args.pbf, 'rb') as file:
            sha = hashlib.file_digest(file, 'sha256').hexdigest()

        class Roads(osmium.SimpleHandler):
            total = 0

            def way(self, way):
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
                    if self.total % 10000 == 0:
                        counts.commit()

        print('Pass 2: writing complete, junction-split sections to disk staging.', flush=True)
        roads = Roads()
        apply_with_locations(roads, args.pbf, Path(scratch) / 'locations.idx')
        counts.commit()
        total = counts.execute('select count(distinct id) from cells').fetchone()[0]
        if not total:
            raise ValueError('No UK road sections found. Check the extract.')
        cells = [row[0] for row in counts.execute('select distinct cell from cells order by cell')]
        # This staging directory contains only closed gzip files; the parent owns the mapped node scratch.
        with tempfile.TemporaryDirectory(prefix='.building-', dir=output) as staging:
            for cell in cells:
                target = Path(staging) / '12' / f'{cell}.json.gz'
                target.parent.mkdir(parents=True, exist_ok=True)
                with gzip.GzipFile(filename=str(target), mode='wb', mtime=0) as compressed:
                    compressed.write(b'{"type":"FeatureCollection","features":[')
                    first = True
                    for (feature,) in counts.execute('select feature from cells where cell=? order by id', (cell,)):
                        if not first:
                            compressed.write(b',')
                        compressed.write(feature.encode('utf-8'))
                        first = False
                    compressed.write(b']}')
            # Rename only the exact generated staging directory into the explicitly named output release.
            if Path(staging).resolve().parent != output or release.resolve().parent != output:
                raise ValueError('Generated release paths must remain inside the selected output directory.')
            Path(staging).rename(release)
        manifest = {'format': 'swiftfix-road-cells', 'version': 1, 'dataset': args.version, 'cellZoom': 12, 'cells': cells,
                    'source': args.source_url, 'sha256': sha, 'segmentCount': total,
                    'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    'attribution': '© OpenStreetMap contributors', 'license': 'ODbL-1.0'}
        temp_manifest = output / f'.manifest-{args.version}.json'
        temp_manifest.write_text(json.dumps(manifest, separators=(',', ':')), encoding='utf-8')
        temp_manifest.replace(output / 'manifest.json')
        counts.close()
        print(f'Generated {total:,} sections in {len(cells):,} cells. SHA-256: {sha}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pbf', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--output', default='public/roads')
    parser.add_argument('--work', default='work/import')
    parser.add_argument('--source-url', default='https://download.geofabrik.de/europe/united-kingdom.html')
    parser.add_argument('--scratch', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.scratch:
        run(args)
    else:
        root = Path(args.work).resolve()
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='swiftfix-', dir=root) as scratch:
            subprocess.run([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:], '--scratch', scratch], check=True)
