import gzip
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from package_roads import package


class PackageTest(unittest.TestCase):
    def test_only_complete_referenced_assets_and_licence_are_packaged_without_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            roads = root / 'roads'
            (roads / 'release/12/1').mkdir(parents=True)
            payload = gzip.compress(b'{"type":"FeatureCollection","features":[]}')
            (roads / 'release/12/1/2.json.gz').write_bytes(payload)
            (roads / 'README.md').write_text('OpenStreetMap ODbL attribution')
            (roads / 'unreferenced.tmp').write_text('must not ship')
            manifest = {'format': 'swiftfix-road-cells', 'version': 1, 'dataset': 'release', 'cells': ['1/2']}
            (roads / 'manifest.json').write_text(json.dumps(manifest))
            report = package(roads, root / 'data.zip')
            self.assertTrue(report['crcVerified'])
            with zipfile.ZipFile(root / 'data.zip') as archive:
                self.assertEqual(set(archive.namelist()), {'roads/manifest.json', 'roads/README.md', 'roads/release/12/1/2.json.gz'})
                self.assertEqual(archive.read('roads/release/12/1/2.json.gz'), payload)
            with self.assertRaises(FileExistsError):
                package(roads, root / 'data.zip')
            manifest['cells'] = ['../outside']
            (roads / 'manifest.json').write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):
                package(roads, root / 'unsafe.zip')


if __name__ == '__main__':
    unittest.main()
