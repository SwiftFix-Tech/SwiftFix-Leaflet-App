# Local storage architecture

The existing Next.js App Router/React/TypeScript/Tailwind interface and MapLibre/MapTiler mapping remain. The former server-side data path and sign-in flow have been removed.

## Progress: browser IndexedDB

`lib/indexed-db.ts` opens `swiftfix-leaflet-tracker` schema version 1. It has three object stores:

- `completed`, keyed by stable segment ID, holds the complete GeoJSON road snapshot, computed bounding box, western-coordinate index and completion/update timestamps.
- `revisions`, keyed by segment ID, retains mutation tokens even after a deletion. These let Undo reject an intervening change from another tab.
- `meta` contains a global local revision. The counter uses the object store's exact count, including records outside the current viewport.

IndexedDB serializes read/write transactions across tabs. A mark is idempotent if its ID already exists; removal deletes the completion. Every mutation resolves only after transaction completion. The existing optimistic state controller serializes rapid edits and restores prior UI state on a failed transaction. A fresh authoritative read reconciles ambiguous outcomes. No server is involved.

Views filter saved geometry by its bounding box, using the west-coordinate index and checking the remaining bounds. The complete geometry snapshot draws at all zooms and can be restored even if the static dataset is unavailable. The global count is independent of the visible highlights. Other tabs on the same origin receive BroadcastChannel invalidation; focus/visibility refresh is a fallback. Other origins, browser profiles and devices have independent data.

## Backup validation and merge

`lib/backup.ts` defines the versioned JSON envelope and normalizes all imported data. It rejects non-LineString geometry, empty/oversized IDs, invalid timestamps, non-finite/out-of-UK coordinates, zero-length geometry and conflicting duplicate IDs. Size/record/coordinate limits protect the main thread from unexpectedly large files. Bounds are derived from geometry, never trusted from imported input.

The UI validates JSON before opening a write transaction. `importRecords` then checks existing IDs and inserts all new entries in one transaction. Existing matching records keep their metadata; any conflict or storage error aborts everything. Input JSON cannot insert executable code or foreign IndexedDB stores. Road names render as React text. No file is uploaded. Import clears Undo, so it cannot accidentally reverse a change made before the merge.

## Geometry: static OSM cells

MapTiler remains the basemap/search provider. Independently generated OSM roads are served from `/roads/manifest.json` and `/roads/<dataset>/12/<x>/<y>.json.gz`. No geospatial database is needed. The generator reuses source-way/source-node segmentation and immutable versioned IDs, and duplicates **whole sections** into intersected cells. The browser deduplicates by ID; it never treats a clipped vector-tile fragment as an independent road.

At zoom 14+ the loader requests only visible cells, batches requests four at a time, coalesces concurrent requests and retains a bounded 16-cell cache. Broad zooms show the normal basemap. More than 20 cells or 12,000 in-view sections asks the user to zoom in; geometry is not silently truncated. MapLibre's rendered-feature index narrows candidates, followed by nearest screen-space distance to the source centreline. Mouse movement performs local feature picking only.

Generated releases are immutable and carry source URL/SHA-256. The app's saved geometry snapshots are independent of subsequent release changes. It does not silently remap IDs by name or erase old highlights. Curves and roundabouts retain their vertices. At an exact grade-separated crossing there can be visual ambiguity; select slightly along the desired road.

## Licensing and deployment

The [Geofabrik UK extract](https://download.geofabrik.de/europe/united-kingdom.html) includes Northern Ireland. It contains [OpenStreetMap data under ODbL](https://www.openstreetmap.org/copyright). Generated cells are a distributed road dataset: preserve attribution, licence notices and ODbL share-alike/offer obligations. Do not claim exclusive ownership of the underlying road database. The generator records provenance and the app visibly credits OSM.

MapTiler's [Cloud terms](https://www.maptiler.com/terms/cloud/) and [copyright requirements](https://www.maptiler.com/copyright/) apply separately to the commercially licensed basemap and search. This implementation does not derive a persistent road dataset from their tiles or use public Overpass as a production server.

Vercel serves Next.js. Static geometry is either bundled or served from a public static CDN configured by `NEXT_PUBLIC_ROADS_BASE_URL`; the map requires `NEXT_PUBLIC_MAPTILER_KEY`. No authentication token, database credential or server secret is used. Tracking information is never sent to a cloud database. Search queries and map viewport requests still go to MapTiler; static road-cell requests go to the app's host or configured public road CDN. Browser storage can be evicted/cleared and is not an automatic backup; the permanent UI warning and JSON export/import make that limitation explicit.
