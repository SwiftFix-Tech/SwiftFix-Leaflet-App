"""Pure segmentation logic. No coordinates are invented or simplified."""
import hashlib
import math


def distance(a, b):
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * math.cos(lat), a[1] - b[1]) * 111195


def split_nodes(nodes, junction, max_metres=250):
    """nodes: [(OSM node id, lon, lat)]. Split at shared nodes and source vertices."""
    current = []
    length = 0
    for node in nodes:
        if current:
            length += distance(current[-1][1:], node[1:])
        current.append(node)
        if len(current) > 1 and (junction(node[0]) or length >= max_metres):
            if any(n[1:] != current[0][1:] for n in current[1:]):
                yield current
            current = [node]
            length = 0
    if len(current) > 1 and any(n[1:] != current[0][1:] for n in current[1:]):
        yield current


def segment_id(version, way_id, nodes):
    refs = [n[0] for n in nodes]
    canonical = min(refs, list(reversed(refs)))
    digest = hashlib.sha256(','.join(map(str, canonical)).encode()).hexdigest()[:24]
    return f'osm-uk:{version}:way:{way_id}:{digest}'


def ewkt(nodes):
    return 'SRID=4326;LINESTRING(' + ','.join(f'{n[1]:.7f} {n[2]:.7f}' for n in nodes) + ')'
