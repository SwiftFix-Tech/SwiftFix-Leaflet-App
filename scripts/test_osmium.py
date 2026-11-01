"""Actual library smoke test with synthetic OSM XML, never production road data."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys
import json

AVAILABLE = importlib.util.find_spec('osmium') is not None


@unittest.skipUnless(AVAILABLE, 'Install scripts/requirements.txt for the actual OSM parser test')
class OsmiumTests(unittest.TestCase):
    def test_import_handler_and_disk_location_cache(self):
        with tempfile.TemporaryDirectory() as scratch:
            source = Path(scratch) / 'synthetic.osm'
            source.write_text('''<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="swiftfix-test">
<node id="1" lat="51.587" lon="-0.164"/>
<node id="2" lat="51.5873" lon="-0.163"/>
<node id="3" lat="51.5871" lon="-0.162"/>
<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="name" v="Synthetic test road"/></way>
</osm>''', encoding='utf-8')
            # Match the real import worker lifecycle; Windows library mappings close on process exit.
            code = '''import sys,json,osmium
from import_roads import eligible
from segments import split_nodes
from osm_reader import apply_with_locations
captured=[]
class Handler(osmium.SimpleHandler):
    def way(self,way):
        if eligible(way):
            captured.extend(split_nodes([(n.ref,n.lon,n.lat) for n in way.nodes],lambda _:False))
apply_with_locations(Handler(),sys.argv[1],sys.argv[2])
print(json.dumps(captured))
'''
            result = subprocess.run([sys.executable, '-c', code, str(source), str(Path(scratch) / 'locations.idx')], cwd=Path(__file__).parent, check=True, text=True, capture_output=True)
            captured = json.loads(result.stdout)
            self.assertEqual(len(captured), 1)
            self.assertEqual(captured[0][1], [2, -0.163, 51.5873])


if __name__ == '__main__':
    unittest.main()
