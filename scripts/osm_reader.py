"""Read full geometry in the import worker. Its exit releases Windows mmap handles."""
import osmium


def apply_with_locations(handler, source, cache_path):
    locations = osmium.index.create_map(f'sparse_file_array,{cache_path}')
    locator = osmium.NodeLocationsForWays(locations)
    locator.ignore_errors()  # eligible-way coordinate access still fails on missing locations
    try:
        with osmium.io.Reader(str(source), osmium.osm.NODE | osmium.osm.WAY) as reader:
            osmium.apply(reader, locator, handler)
    finally:
        locations.clear()
