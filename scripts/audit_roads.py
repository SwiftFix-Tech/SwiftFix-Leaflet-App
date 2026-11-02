"""Validate every generated cell and report measured deployment capacity. No network."""
import argparse
import gzip
import json
import math
from pathlib import Path
from import_roads import cell_at


def audit(root):
    root = Path(root)
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    assert manifest['format'] == 'swiftfix-road-cells' and manifest['version'] == 1
    seen = set()
    total_bytes = 0
    largest = 0
    references = 0
    samples = {}
    locations = {'East Finchley': (-.164, 51.587), 'Manchester': (-2.24, 53.48),
                 'Glasgow': (-4.25, 55.86), 'Cardiff': (-3.18, 51.48), 'Belfast': (-5.93, 54.6)}
    sample_cells = {name: '/'.join(map(str, cell_at(*point))) for name, point in locations.items()}
    for number, cell in enumerate(manifest['cells'], 1):
        path = root / manifest['dataset'] / '12' / f'{cell}.json.gz'
        size = path.stat().st_size
        total_bytes += size
        largest = max(largest, size)
        with gzip.open(path, 'rt', encoding='utf-8') as source:
            doc = json.load(source)
        assert doc['type'] == 'FeatureCollection'
        local_ids = set()
        for feature in doc['features']:
            identity = feature['properties']['id']
            assert feature['type'] == 'Feature' and feature['id'] == identity
            assert identity.startswith(f"osm-uk:{manifest['dataset']}:way:")
            assert identity not in local_ids
            local_ids.add(identity)
            geometry = feature['geometry']
            assert geometry['type'] == 'LineString'
            points = geometry['coordinates']
            assert 2 <= len(points) <= 10000
            assert all(len(p) == 2 and all(math.isfinite(v) for v in p) and -9 <= p[0] <= 3 and 49 <= p[1] <= 61.5 for p in points)
            assert any(p != points[0] for p in points[1:])
            assert len(feature['properties']['name']) <= 1024
            seen.add(identity)
            references += 1
        for name, sample_cell in sample_cells.items():
            if cell == sample_cell:
                samples[name] = {'cell': cell, 'sections': len(local_ids)}
        if number % 1000 == 0:
            print(f'Validated {number:,} cells / {len(seen):,} unique sections.', flush=True)
    assert len(seen) == manifest['segmentCount'], 'Unique section count mismatch'
    assert total_bytes == manifest.get('compressedBytes', total_bytes), 'Compressed byte count mismatch'
    assert len(samples) == len(locations) and all(s['sections'] for s in samples.values()), 'Missing UK nation sample cells'
    return {'dataset': manifest['dataset'], 'source': manifest['source'], 'sha256': manifest['sha256'],
            'uniqueSections': len(seen), 'cellReferences': references, 'cellFiles': len(manifest['cells']),
            'compressedCellBytes': total_bytes, 'largestCellBytes': largest,
            'roadAssetBytes': total_bytes + (root / 'manifest.json').stat().st_size,
            'roadAssetFiles': len(manifest['cells']) + 1, 'samples': samples,
            'github100MiBIndividualFileLimitExceeded': largest > 100 * 1024 * 1024,
            'vercelHobby100MBCLISourceBudgetExceededByRoadsAlone': total_bytes > 100_000_000,
            'vercelPro1GBCLISourceBudgetExceededByRoadsAlone': total_bytes > 1_000_000_000,
            'vercel15000CLISourceFileBudgetExceededByRoadsAlone': len(manifest['cells']) + 1 > 15000}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default='public/roads')
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    report = audit(args.root)
    Path(args.report).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
