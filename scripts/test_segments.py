import unittest
from segments import split_nodes, segment_id, ewkt

class SegmentsTest(unittest.TestCase):
    def test_curves_and_junctions(self):
        nodes = [(1, -.16, 51.58), (2, -.1598, 51.5802), (3, -.1595, 51.5801), (4, -.159, 51.5803)]
        parts = list(split_nodes(nodes, lambda ref: ref == 3))
        self.assertEqual(parts, [nodes[:3], nodes[2:]])
        self.assertEqual(parts[0][1], nodes[1])

    def test_ids_independent_of_direction_and_versioned(self):
        nodes = [(1, 0, 51), (2, .001, 51)]
        self.assertEqual(segment_id('v1', 12, nodes), segment_id('v1', 12, nodes[::-1]))
        self.assertNotEqual(segment_id('v1', 12, nodes), segment_id('v2', 12, nodes))

    def test_closed_roundabout_preserves_all_vertices(self):
        nodes = [(1, 0, 51), (2, .001, 51), (3, .001, 51.001), (1, 0, 51)]
        self.assertEqual(list(split_nodes(nodes, lambda _: False, 10000)), [nodes])
        self.assertIn('LINESTRING', ewkt(nodes))

    def test_long_sections_split_at_existing_nodes(self):
        nodes = [(1, 0, 51), (2, .01, 51), (3, .02, 51)]
        self.assertEqual(list(split_nodes(nodes, lambda _: False)), [nodes[:2], nodes[1:]])

if __name__ == '__main__':
    unittest.main()
