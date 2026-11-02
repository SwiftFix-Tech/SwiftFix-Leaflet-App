"""End-to-end static road generation with synthetic OSM input, no cloud or database."""
import gzip
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(importlib.util.find_spec('osmium'), 'Install scripts/requirements.txt')
class StaticGenerationTest(unittest.TestCase):
    def test_full_worker_pipeline_belfast_curves_cell_boundaries_and_immutable_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'test.osm'
            source.write_text('''<osm version="0.6" generator="swiftfix-test">
<node id="1" lat="51.587" lon="-0.1759"/><node id="2" lat="51.5873" lon="-0.1757"/><node id="3" lat="51.5871" lon="-0.1755"/>
<node id="4" lat="54.6" lon="-5.93"/><node id="5" lat="54.6001" lon="-5.929"/>
<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="name" v="Curve"/></way>
<way id="20"><nd ref="4"/><nd ref="5"/><tag k="highway" v="residential"/><tag k="name" v="Belfast"/></way>
</osm>''', encoding='utf-8')
            command = [sys.executable, str(Path(__file__).parent / 'import_roads.py'), '--pbf', str(source), '--version', 'test_release', '--output', str(root / 'roads'), '--work', str(root / 'work')]
            result = subprocess.run(command, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            manifest_path = root / 'roads' / 'manifest.json'
            before = manifest_path.read_bytes()
            manifest = json.loads(before)
            self.assertEqual(manifest['segmentCount'], 2)
            self.assertEqual(len(manifest['sha256']), 64)
            sizes = [p.stat().st_size for p in (root / 'roads' / 'test_release').rglob('*.gz')]
            self.assertEqual(manifest['compressedBytes'], sum(sizes))
            self.assertEqual(manifest['largestCellBytes'], max(sizes))
            grouped = {}
            for cell in manifest['cells']:
                with gzip.open(root / 'roads' / 'test_release' / '12' / f'{cell}.json.gz', 'rt', encoding='utf-8') as file:
                    for feature in json.load(file)['features']:
                        grouped.setdefault(feature['properties']['name'], []).append(feature)
            self.assertIn('Belfast', grouped)
            self.assertGreaterEqual(len(grouped['Curve']), 2)
            self.assertEqual(len({r['properties']['id'] for r in grouped['Curve']}), 1)
            self.assertEqual(grouped['Curve'][0]['geometry']['coordinates'][1], [-.1757, 51.5873])
            self.assertEqual(list((root / 'work').iterdir()), [])
            again = subprocess.run(command, text=True, capture_output=True)
            self.assertNotEqual(again.returncode, 0)
            self.assertEqual(manifest_path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
