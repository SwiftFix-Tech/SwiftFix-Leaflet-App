# SwiftFix Tech — UK Leaflet Tracker

This updates the existing Next.js/MapLibre app to store progress in **IndexedDB in your browser**. Open the map, click or tap a road section to mark it **#1683FF**, and right-click or hold a highlighted section to remove it. Changes and Undo save automatically.

There is no sign-in, server database, shared workspace or cloud synchronisation. **Clearing browser/site data, private browsing cleanup, storage eviction, or switching browser/device/origin can make progress unavailable. Export regular backups.** The app shows this warning permanently.

Records from the previous server-backed edition are not automatically copied into a browser. If you used it with live data, preserve an export before decommissioning it and convert that export to the documented JSON backup format for import. This version never contacts the former database.

## Local setup

Use Node.js 24 LTS and pnpm 11.25.0:

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env.local
```

On PowerShell use `Copy-Item .env.example .env.local` instead of `cp`.

The map needs this public environment variable:

```dotenv
NEXT_PUBLIC_MAPTILER_KEY=your_maptiler_browser_key
```

Use a MapTiler plan permitting commercial maps/geocoding usage. Restrict the public key to your production/custom-domain and development origins. The basemap, UK postcode/address search, map dragging, zoom and East Finchley re-centre are unchanged. Google keys and database credentials are unnecessary.

```sh
pnpm dev
```

The map initially opens in East Finchley and can navigate anywhere in England, Scotland, Wales and Northern Ireland. Progress belongs to the **exact origin** used, including protocol, hostname and port. A Vercel preview URL and a custom domain have separate browser storage. Export/import to transfer progress between them.

## Selectable road geometry: static assets, no database

The original application served independent OSM road geometries through its database. Those geometries now live in compressed, versioned static files under `public/roads`. They are fetched by visible area at street zoom (14+), cached, and deduplicated using stable segment IDs. The application never downloads the entire UK network into the browser or extracts roads from MapTiler's licensed basemap tiles.

**Generated national road assets are distributed separately from source control.** Generate/deploy the road assets once before using new-road selection. See [production road deployment](docs/ROAD-DEPLOYMENT.md) for the static CDN option, size limits, deployment checks and GitHub Desktop steps. Without them the MapTiler basemap/search still work and existing saved geometry/backups remain available, but the app reports that selectable road data is not installed. There is no simulated data or borough-only fallback.

If you received the separate `SwiftFix-UK-Roads-uk_20261101_v1.zip` delivery, use that complete prebuilt release instead of regenerating the UK. Extract its `roads/` directory and follow the upload instructions. Python and the source PBF are not required by Vercel or by the running app.

1. Download a pinned **United Kingdom** `.osm.pbf` from [Geofabrik](https://download.geofabrik.de/europe/united-kingdom.html). The UK extract includes Northern Ireland; a Great Britain-only extract does not.
2. On a provisioned import machine, install Python 3.12+ and the generator dependency:

```sh
python -m venv .venv
# Activate .venv for your shell.
python -m pip install -r scripts/requirements.txt
python scripts/import_roads.py --pbf /path/to/united-kingdom.osm.pbf --version uk_YYYYMMDD_v1 --output public/roads
```

3. Run `pnpm roads:check` and measure the generated release. Include `public/roads/manifest.json` and the **entire referenced release directory** in your deployment if it fits your hosting budget. Otherwise upload these public files to a static CDN and set `NEXT_PUBLIC_ROADS_BASE_URL` to its HTTPS directory. This optional setting is necessary for separately hosted national geometry; it is not a database. The generator runs offline, never in a Vercel function. See [detailed steps](docs/ROAD-DEPLOYMENT.md).

The generator preserves the existing segmentation algorithm and versioned way/node IDs. It splits at shared junctions and approximately 250 m using existing vertices, preserves curves/roundabouts, and writes complete sections into every intersected zoom-12 cell. Tile boundaries do not create new IDs. It stores source provenance and SHA-256 in the manifest. It uses disk-backed scratch storage and worker isolation for Windows file-map cleanup.

After the junction pass completes, interrupted imports can continue from durable whole-way checkpoints with `--resume`, using the exact same source, version and work directory. Do not delete staging or rerun a fresh import over it. Legacy staging damaged by a power failure must first be copied/recovered read-only into clean staging. See [safe recovery and resume](docs/ROAD-DEPLOYMENT.md#interruptions-and-safe-resume).

The national extract requires substantial local disk space and generation time. Measure the generated output against your hosting plan's deployment/file limits before deploying. Do not commit multi-gigabyte PBF, scratch files or personal backup files. Large generated assets can be included by your deployment pipeline; Git LFS pointer files alone will not serve geometry. Keep the output release immutable; the tool refuses to overwrite an existing version. Saved highlights contain full geometry snapshots and survive a dataset change, but new IDs from a different release are distinct sections. Review dataset changes before changing releases; no road-name matching silently reassigns progress.

## Export Backup / Import Backup

**Export Backup** downloads one JSON file containing every completed section in this browser, including stable ID, complete LineString geometry, road name and timestamps. Export waits for outstanding saves. No progress is sent to a server.

**Import Backup** merges a version-1 SwiftFix JSON backup with existing progress:

- New stable IDs are inserted.
- Matching IDs with the same geometry are skipped. Existing records/timestamps are kept; progress is never cleared by import, including an empty backup.
- Duplicate IDs inside a file are deduplicated. Conflicting geometry for one ID rejects the import.
- The format/version, IDs, dates, finite UK coordinates, geometry shape and size limits are validated before writing. Unsupported or malformed files cause no partial import.
- The merge is one atomic IndexedDB transaction. Storage/quota failures abort the whole transaction and leave previous records intact.
- Import reports added/skipped counts, refreshes highlights/counter, and clears the previous Undo action. Undo applies to normal mark/remove actions, not whole-file imports.

A backup uses this envelope (road entries are complete GeoJSON Features):

```json
{
  "format": "swiftfix-leaflet-backup",
  "version": 1,
  "exportedAt": "2026-11-01T12:00:00.000Z",
  "roads": []
}
```

Imports accept at most 50 MiB, 100,000 records and 2,000,000 coordinates, with 2–10,000 coordinates per section. Save downloaded JSON somewhere outside the browser, for example your normal backed-up Documents folder. To use another device, export here, copy the file there and import it there. Later edits on the devices remain separate.

IndexedDB is the primary road database. localStorage is not used for progress. Modern browsers keep IndexedDB across normal refreshes and browser restarts, subject to browser settings, available disk space and eviction rules. Private/incognito profiles are temporary. There is no automatic cloud recovery if browser data is lost. The app works without a MapTiler key for backup/import and shows the map configuration message until the key is supplied.

## Deploy to Vercel

1. Push this updated existing application to your GitHub repository. No migration or database setup is required.
2. Import/update the repository in Vercel. Set the Root Directory to the app directory (repository root when these files are at root).
3. Select Next.js and Node.js 24.x. The supplied `vercel.json` uses `pnpm install --frozen-lockfile` and `pnpm build`. Use Corepack support if required to honour `packageManager: pnpm@11.25.0`.
4. Add `NEXT_PUBLIC_MAPTILER_KEY` to the desired Vercel environments. If roads are hosted separately, also set `NEXT_PUBLIC_ROADS_BASE_URL` to the public static directory URL. Remove the old database environment variables from Vercel settings; they are no longer read by any app code.
5. Include the generated UK `public/roads` assets or upload the complete release to the configured CDN first. Vercel builds now fail early if road data is missing; see `pnpm roads:check`. Deploy, and restrict the MapTiler key to the final HTTPS origin. Public environment values are compiled at build time; redeploy after key changes.
6. Export progress before changing domains, browser profiles or devices, then import on the destination. A normal deployment to the same origin does not erase IndexedDB.

There are no server-side secrets and no production authentication redirects. Anyone able to open the website can use their own local tracker. The website does not grant access to another browser's IndexedDB. Preserve MapTiler and OpenStreetMap attribution and comply with their commercial-data/licensing terms. See [architecture](docs/ARCHITECTURE.md).

## Checks

```sh
pnpm typecheck
pnpm test
pnpm test:deployment
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
python -m pip install -r scripts/requirements.txt
python -m unittest discover -s scripts -p 'test_*.py'
```

Browser tests start a local Next.js dev server with a non-production test key, intercept provider requests, and supply clearly synthetic OSM/road fixtures. They use the actual MapLibre renderer and browser IndexedDB. On Windows with Edge installed, set `PLAYWRIGHT_CHANNEL=msedge`. They do not need live map credentials. Do not run another server on port 3000 at the same time. `E2E_BASE_URL` can target an existing configured test deployment instead.

Tests cover persistence, duplicate prevention, removal, Undo, global counts, import validation/merge/rollback, backups, cross-tab revisions, request caching, map gestures, browser refresh/restart, UK navigation and mobile layout. [Verification notes](docs/VERIFICATION.md) distinguish automated fixture checks from real-provider/full-UK acceptance.
