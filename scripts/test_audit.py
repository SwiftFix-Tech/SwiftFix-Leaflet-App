import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(importlib.util.find_spec('osmium'), 'Install scripts/requirements.txt')
class AuditTest(unittest.TestCase):
    def test_national_samples_measured_sizes_and_missing_cell_rejection(self):
        from audit_roads import audit
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parts = ['<osm version="0.6" generator="swiftfix-audit-test">']
            places = [(-.164, 51.587), (-2.24, 53.48), (-4.25, 55.86), (-3.18, 51.48), (-5.93, 54.6)]
            for index, (lon, lat) in enumerate(places):
                for offset in range(2):
                    parts.append(f'<node id="{index * 2 + offset + 1}" lon="{lon + offset * .0001}" lat="{lat}"/>')
            for index in range(5):
                parts.append(f'<way id="{index + 1}"><nd ref="{index * 2 + 1}"/><nd ref="{index * 2 + 2}"/><tag k="highway" v="residential"/></way>')
            parts.append('</osm>')
            source = root / 'input.osm'
            source.write_text(''.join(parts), encoding='utf-8')
            result = subprocess.run([sys.executable, str(Path(__file__).parent / 'import_roads.py'), '--pbf', str(source), '--version', 'audit_test', '--output', str(root / 'roads'), '--work', str(root / 'work')], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = audit(root / 'roads')
            self.assertEqual(report['uniqueSections'], 5)
            self.assertEqual(len(report['samples']), 5)
            self.assertGreater(report['compressedCellBytes'], 0)
            self.assertFalse(report['github100MiBIndividualFileLimitExceeded'])
            next((root / 'roads' / 'audit_test').rglob('*.gz')).unlink()
            with self.assertRaises(FileNotFoundError):
                audit(root / 'roads')


if __name__ == '__main__':
    unittest.main()
