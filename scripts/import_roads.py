"""Import a pinned UK Geofabrik PBF into PostGIS. Run on a provisioned import machine.
Credentials are read only from DATABASE_URL. Never use the Supabase browser key here.
"""
import argparse
import hashlib
import os
from pathlib import Path
import re
import sqlite3
import contextlib
import subprocess
import sys
import tempfile
import osmium
import psycopg
from segments import split_nodes, segment_id, ewkt
from osm_reader import apply_with_locations

HIGHWAYS = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
            'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
            'residential', 'living_street', 'service', 'pedestrian', 'road'}


def eligible(way):
    return way.tags.get('highway') in HIGHWAYS and way.tags.get('area') != 'yes'


def run(args):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', args.version):
        raise ValueError('Version must be a unique immutable release label: letters, digits, _ or -')
    root = Path(args.work).resolve()
    root.mkdir(parents=True, exist_ok=True)
    # The parent cleans this directory after the worker exits and releases Windows mmap handles.
    with contextlib.nullcontext(args.scratch) as scratch:
        counts = sqlite3.connect(str(Path(scratch) / 'nodes.sqlite'))
        counts.execute('pragma journal_mode=off')
        counts.execute('create table refs (id integer primary key, n integer not null)')

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

        print('Pass 1: counting junctions (this can take hours for the full UK).', flush=True)
        counter = Count()
        counter.apply_file(args.pbf)
        counter.flush()
        with open(args.pbf, 'rb') as file:
            sha = hashlib.file_digest(file, 'sha256').hexdigest()
        with psycopg.connect(os.environ['DATABASE_URL']) as db:
            db.execute("set statement_timeout = 0")
            db.execute('insert into public.road_datasets(version,source_url,sha256) values (%s,%s,%s)',
                       (args.version, args.source_url, sha))
            db.execute('create temp table road_import(id text, dataset_version text, road_name text, osm_way_id bigint, geom text) on commit drop')
            print('Pass 2: loading complete, junction-split road geometries.', flush=True)
            with db.cursor().copy('copy road_import from stdin') as copy:
                class Roads(osmium.SimpleHandler):
                    total = 0

                    def way(self, way):
                        if not eligible(way):
                            return
                        # Missing node coordinates abort the import; do not silently bridge gaps.
                        nodes = [(n.ref, n.lon, n.lat) for n in way.nodes]
                        def junction(ref):
                            return counts.execute('select n from refs where id=?', (ref,)).fetchone()[0] > 1
                        for part in split_nodes(nodes, junction):
                            copy.write_row((segment_id(args.version, way.id, part), args.version,
                                            way.tags.get('name', ''), way.id, ewkt(part)))
                            self.total += 1
                roads = Roads()
                # Disk-backed node location cache avoids holding the UK in RAM.
                apply_with_locations(roads, args.pbf, Path(scratch) / 'locations.idx')
            if roads.total == 0:
                raise ValueError('No roads imported; check the source extract.')
            db.execute('insert into public.road_segments select id,dataset_version,road_name,osm_way_id,extensions.st_geomfromewkt(geom) from road_import on conflict(id) do nothing')
            db.execute('analyze public.road_segments')
            if args.activate:
                if db.execute('select exists(select 1 from public.road_datasets where active)').fetchone()[0]:
                    raise ValueError('An active dataset already exists. Use reviewed reconciliation for updates.')
                db.execute('update public.road_datasets set active=true where version=%s', (args.version,))
            print(f'Imported {roads.total:,} sections. SHA-256: {sha}. Active: {args.activate}', flush=True)
        counts.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pbf', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--work', default='work/import')
    parser.add_argument('--source-url', default='https://download.geofabrik.de/europe/united-kingdom.html')
    parser.add_argument('--activate', action='store_true', help='First import only; atomically enable after success')
    parser.add_argument('--scratch', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.scratch:
        run(args)
    else:
        root = Path(args.work).resolve()
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='swiftfix-', dir=root) as scratch:
            subprocess.run([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:], '--scratch', scratch], check=True)
