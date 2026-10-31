# SwiftFix Tech — UK Leaflet Tracker

A private, shared map for recording leaflet delivery. Click/tap a road section to mark it **#1683FF**. Right-click/hold a highlighted section to remove it. Every mutation is saved automatically to Supabase. Undo reverses the database mutation.

## What is included

- Next.js App Router, React, TypeScript and Tailwind; responsive map-first interface.
- MapLibre GL JS with a MapTiler streets basemap and UK address/postcode search.
- Independent, real OSM road centreline geometries imported into Supabase PostGIS. Complete sections are picked by screen-space distance; curves are never replaced by arbitrary straight lines.
- Junction-based segments with an additional approximately 250 m split at **existing** source nodes. Source ways, shared nodes, loops and roundabouts retain their shape. A sparse source edge can be longer than 250 m.
- Invite-only Supabase sign-in and one shared workspace. RLS protects reads; membership-checked database functions control writes. Browser code has no service-role key.
- Optimistic updates, serialized writes, duplicate prevention, failure rollback, revision-checked Undo, spatial loading, keyset pages, bounded viewport caching and global count.
- Realtime workspace invalidation, foreground refresh every 30 seconds, and refresh on reconnect/returning to the tab.
- SQL migration, import/update tools, automated tests and GitHub Actions checks.

**External setup is required.** No Supabase project, map subscription, staff accounts, hosted UK dataset, GitHub remote or Vercel deployment is created by the source code. Unconfigured installations show a setup screen; they do not simulate a working private map. No live-service validation is claimed without credentials. See [verification](docs/VERIFICATION.md).

## 1. Install locally

Use Node.js **24 LTS**, pnpm **11.25.0**, Python 3.12+ for import tooling, and a Supabase project with enough Postgres storage for the UK road network.

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env.local
```

On PowerShell use `Copy-Item .env.example .env.local`. Install pnpm separately if your Node distribution does not include Corepack.

Fill these public browser values in `.env.local`:

| Variable | Source |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable API key; the legacy anon key also works |
| `NEXT_PUBLIC_MAPTILER_KEY` | MapTiler Cloud key for maps and geocoding |
| `NEXT_PUBLIC_WORKSPACE_ID` | Keep the UUID seeded in the migration |

`DATABASE_URL` is an **import/admin machine secret only**. It is never accessed by Next.js and must never have a `NEXT_PUBLIC_` prefix. This app needs no Google Maps key and no Supabase service-role key.

```sh
pnpm dev
```

Open the local URL printed by Next.js. A production run uses `pnpm build` then `pnpm start`.

## 2. Configure Supabase

1. Create a Supabase project in an appropriate UK/European region. Plan storage and backups for a national dataset; a small free database is not an adequate production capacity assumption. The importer logs the actual segment count. Budget storage and index space using a test import before launch.
2. Apply `supabase/migrations/001_tracker.sql` with the Supabase SQL editor as project owner, or `supabase db push` after linking with the Supabase CLI. It enables PostGIS in `extensions`, seeds the SwiftFix workspace, creates the tables, functions, indexes, RLS policies and Realtime publication. If PostGIS is already installed elsewhere, align its schema before running the migration.
3. In Authentication, disable **Allow new users to sign up**. Enable email magic-link sign-in; configure a production SMTP provider and rate limits.
4. Set **Site URL** to your deployed HTTPS origin. Add that same origin and your local development origin to the redirect allowlist. Add specific preview origins only when you need preview sign-in. The browser supplies its current origin as the magic-link return URL; Supabase must explicitly allow it.
5. Create authorised users through Supabase's admin interface. In the SQL editor add each existing user's UUID to the shared workspace:

```sql
insert into public.workspace_members (workspace_id, user_id)
values ('5c7c15a9-3757-4c87-85d3-a5d671642f36', 'STAFF_AUTH_USER_UUID')
on conflict do nothing;
```

Use the admin interface to create staff accounts before the app sends their requested sign-in link. There is no client-side membership creation or self-registration. All staff use the **same workspace UUID**. Removing a membership revokes database access even if their authentication token has not expired. Read access and database execution both enforce membership; merely hiding the map is not the security boundary.

The `completed_roads.user_id` records the staff member who marked a section. Uniqueness is `(workspace_id, road_segment_id)`, so delivery is shared across employees. Saved rows include the immutable dataset reference and a full geometry snapshot.

## 3. Load real UK roads

Read [data licensing and architecture](docs/ARCHITECTURE.md) first. Obtain a dated **United Kingdom** PBF from [Geofabrik](https://download.geofabrik.de/europe/united-kingdom.html). This includes England, Scotland, Wales and Northern Ireland. Do not substitute the Great Britain-only extract.

Run on a provisioned import machine, outside Vercel. Allow hours, fast local scratch storage, reliable connectivity and space for the PBF, disk location cache, junction SQLite database, Postgres data, indexes and transaction WAL. Do a capacity measurement on your chosen release. The full UK import is deliberately not run as a serverless request.

```sh
python -m venv .venv
# Activate .venv using the normal command for your shell.
python -m pip install -r scripts/requirements.txt
# Set DATABASE_URL securely in this shell, using Supabase's direct connection
# or session-mode pooler URI, with sslmode=require. Never commit the URI.
python scripts/import_roads.py --pbf /path/to/united-kingdom.osm.pbf --version uk_YYYYMMDD_v1 --activate
```

The version is an immutable label for the exact file and segmentation algorithm. The importer computes and stores its SHA-256, counts shared road nodes using disk-backed SQLite, resolves full geometries with a disk node cache, and streams a `COPY` to Postgres. It fails on missing coordinates. Import and first activation commit together; a failure leaves the prior dataset unchanged. Reusing a version fails instead of silently changing saved geometry. Motorway through residential/service/pedestrian road classes are included; footpaths/cycleways and polygonal highway areas are excluded.

If a road is missing in OSM, it cannot be selected; fix the upstream data and prepare a reviewed new release. No geometry is scraped from the basemap or invented.

### Updating the road dataset

1. Back up Supabase. Import a new pinned release **without** `--activate`.
2. Review old/new sections and create a CSV with `old_id,new_id`. Each completed old section across all workspaces must map to at least one reviewed target section. Exact correspondence can be proposed from OSM way/node IDs; changed junctions, splits, merges and geometry require review. Do not mark a whole new road merely because its name matches.
3. Dry-run `python scripts/reconcile_dataset.py --version NEW_VERSION --mapping reviewed.csv`.
4. After reviewing the mapping, use the same command with `--apply`. It locks workspace writes, snapshots old completion records into a private audit table, moves completions to the reviewed target geometry and atomically activates the new dataset. Unmapped saved sections block activation.
5. Old roads remain stored. Old Undo revisions are invalidated. Realtime refreshes clients; stale clients cannot complete inactive dataset sections.

There is no fuzzy automatic migration that could silently lose or overstate coverage. See the audit table and backups for operational recovery; do not delete old source releases until retention requirements are met.

## 4. MapTiler configuration and licence

Create a MapTiler Cloud account with a plan permitting your **commercial** usage and sufficient map/geocoding quota. Enable the maps and search APIs, and restrict your browser key to exact production and development origins. Maintain MapTiler/OpenStreetMap attribution. Search results are used transiently for navigation and are not stored in the tracking database.

The application uses the compliant alternative MapLibre path and an independent ODbL road import. It does not scrape Google, derive road geometry from Google, use public Overpass for production requests, or use the public OSM tile server. [Architecture](docs/ARCHITECTURE.md) explains the licensing decision and the difference between overlay permission and data ownership.

## 5. Deploy to Vercel and GitHub

1. From **this application directory**, initialise Git and create a private GitHub repository under your organisation. Commit this source and `pnpm-lock.yaml`; exclude `.env.local`, road extracts, caches and dependencies using the supplied `.gitignore`. Push to GitHub. If storing this inside a larger repository, set both CI working directory and Vercel Root Directory to this app directory.
2. Import that repository in Vercel. Select Next.js, Node.js **24.x**, and the app root. The included `vercel.json` uses `pnpm install --frozen-lockfile` and `pnpm build`. Enable Vercel's Corepack support (`ENABLE_EXPERIMENTAL_COREPACK=1`) if needed so the `packageManager` version is honoured.
3. Add the four `NEXT_PUBLIC_` environment values above to the desired Vercel environments. They are compiled into the browser bundle; redeploy when they change. Do **not** add `DATABASE_URL` or any service-role secret.
4. Confirm the Supabase migration, staff memberships and full UK road import are ready. Complete MapTiler billing and origin restrictions.
5. Deploy. Update Supabase Site URL/redirect allowlist and MapTiler allowed origins to the exact HTTPS deployment/custom domain. Redeploy if build-time values changed. No application code hardcodes a deployment hostname or localhost callback.
6. Sign in as two authorised staff. Complete/remove a test section, refresh, visit Belfast and Glasgow, return, verify the global count and try Undo. Verify an unauthorised account cannot read or mutate data. Use a dedicated staging database for destructive integration tests.
7. Enable Supabase backups/PITR appropriate to your plan, monitor storage/query latency and MapTiler quota, and review logs before widening staff access.

Vercel hosts the Next.js app. Supabase stores roads and completion records. The import is an operational job; it is not a Vercel runtime dependency. Browser map/search requests go directly to MapTiler, with staff tracking traffic going to Supabase under their own JWT.

## 6. Tests

```sh
pnpm typecheck
pnpm test
python -m unittest discover -s scripts -p test_segments.py
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

On Windows with Edge already installed you can set `PLAYWRIGHT_CHANNEL=msedge` before running browser tests. `E2E_BASE_URL` optionally targets an existing deployment. The access smoke test expects a signed-out session and verifies desktop/phone entry layout and that private map data is not presented.

For real RLS/RPC integration tests, install `scripts/requirements.txt`, set `DATABASE_URL` to a **dedicated migrated Supabase test database**, set `SWIFTFIX_TEST_DATABASE=1`, then run:

```sh
python -m unittest discover -s scripts -p test_database.py
```

Those tests create synthetic fixture users and geometry inside rolled-back transactions. Never run them on production: they temporarily change the active dataset inside their test transaction. They test real SQL access boundaries, shared writes, uniqueness, snapshot geometry, deletion and conflicting Undo. They are intentionally skipped without explicit test-database configuration.

Map renderer tests use a mocked MapLibre implementation. They verify event wiring, geographical source usage and styling; actual GPU alignment, real touch gestures and provider availability still need the staging acceptance checks in [verification](docs/VERIFICATION.md).

After installing the import requirements, `python -m unittest discover -s scripts -p 'test_*.py'` also runs the actual pyosmium parser/cache worker smoke test. The import worker process releases Windows file mappings before its parent cleans scratch files. Database tests remain explicitly skipped until the dedicated test environment is configured.
