import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import shutil
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(importlib.util.find_spec('osmium'), 'Install scripts/requirements.txt')
class ResumeTest(unittest.TestCase):
    def test_recover_complete_way_prefix_without_modifying_original_then_resume(self):
        from recover_roads import recover
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source.osm'
            source.write_text('''<osm version="0.6" generator="resume-test">
<node id="1" lat="51.587" lon="-.164"/><node id="2" lat="51.5871" lon="-.163"/>
<node id="3" lat="54.6" lon="-5.93"/><node id="4" lat="54.6001" lon="-5.929"/>
<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
<way id="20"><nd ref="3"/><nd ref="4"/><tag k="highway" v="residential"/></way></osm>''', encoding='utf-8')
            base = [sys.executable, str(Path(__file__).parent / 'import_roads.py'), '--pbf', str(source), '--version', 'resume_test']
            first = subprocess.run([*base, '--output', str(root / 'original'), '--work', str(root / 'work'), '--keep-work'], capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            original_db = root / 'work/resume_test/nodes.sqlite'
            before = hashlib.sha256(original_db.read_bytes()).hexdigest()
            report = recover(original_db, source, 'resume_test', root / 'recovered', hashlib.md5(source.read_bytes()).hexdigest(), batch_size=1)
            self.assertEqual(report['recoveredUniqueSections'], 1)
            self.assertEqual(report['resumeAfterWay'], 19)
            self.assertEqual(hashlib.sha256(original_db.read_bytes()).hexdigest(), before)
            resumed = subprocess.run([*base, '--output', str(root / 'restored'), '--work', str(root / 'recovered'), '--resume', '--keep-work'], capture_output=True, text=True)
            self.assertEqual(resumed.returncode, 0, resumed.stderr)
            self.assertIn('Reusing completed junction counts', resumed.stdout)
            def ids(directory):
                manifest = json.loads((directory / 'manifest.json').read_text())
                result = set()
                for cell in manifest['cells']:
                    with gzip.open(directory / manifest['dataset'] / '12' / f'{cell}.json.gz', 'rt') as file:
                        result.update(f['properties']['id'] for f in json.load(file)['features'])
                self.assertEqual(manifest['segmentCount'], len(result))
                return result
            self.assertEqual(ids(root / 'original'), ids(root / 'restored'))
            reused_output = root / 'reused-output'
            reused_output.mkdir()
            previous = reused_output / '.building-test'
            shutil.copytree(root / 'restored/resume_test', previous)
            cached = sorted(previous.rglob('*.gz'))
            first_payload = gzip.decompress(cached[0].read_bytes())
            cached[0].write_bytes(gzip.compress(first_payload, compresslevel=1, mtime=0))
            expected_reused = cached[0].read_bytes()
            cached[-1].write_bytes(b'\x1f\x8btruncated')
            repackaged = subprocess.run([*base, '--output', str(reused_output), '--work', str(root / 'recovered'), '--resume', '--keep-work', '--reuse-cells', str(previous)], capture_output=True, text=True)
            self.assertEqual(repackaged.returncode, 0, repackaged.stderr)
            self.assertEqual(ids(reused_output), ids(root / 'original'))
            self.assertEqual((reused_output / 'resume_test' / cached[0].relative_to(previous)).read_bytes(), expected_reused)
            self.assertEqual(cached[-1].read_bytes(), b'\x1f\x8btruncated')
            source.write_text(source.read_text() + '\n')
            mismatch = subprocess.run([*base, '--output', str(root / 'mismatch'), '--work', str(root / 'recovered'), '--resume'], capture_output=True, text=True)
            self.assertNotEqual(mismatch.returncode, 0)
            self.assertIn('exact same source SHA-256', mismatch.stderr)


if __name__ == '__main__':
    unittest.main()
