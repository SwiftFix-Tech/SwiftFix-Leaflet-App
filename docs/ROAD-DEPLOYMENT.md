# Selectable roads in production

The missing-data error means `roads/manifest.json` returned an error. MapTiler supplies the background map, not this application's selectable road geometry. A source-only deployment previously succeeded with just `public/roads/README.md`. Vercel does not run the offline Python generator automatically.

The supplied `uk_20261101_v1` release has **9,387,158 unique sections in 7,971 cells**, with **551,301,473 compressed cell bytes** and a largest cell of **1,308,920 bytes**. All cells were audited; measured sample coverage includes East Finchley, Manchester, Glasgow, Cardiff and Belfast. See [machine-readable audit](ROAD-RELEASE.json). Use the provided separate ZIP instead of regenerating it. The national archive exceeds GitHub's 100 MiB individual-file limit; the combined assets exceed Vercel Hobby's CLI source-upload budget. They remain separate from the source commit. Individual cells fit GitHub's file limit, and roads alone fit the documented Pro CLI byte/file budgets; the recommended static CDN route avoids including these large artifacts in app deployments.

## Generate once

Use the existing `scripts/import_roads.py` with a pinned Geofabrik **United Kingdom** extract (includes Northern Ireland). Never replace it with a Great Britain-only extract or fabricate an East Finchley-only production fallback.

```sh
python -m pip install -r scripts/requirements.txt
python scripts/import_roads.py --pbf /path/to/united-kingdom-261101.osm.pbf --version uk_20261101_v1 --source-url https://download.geofabrik.de/europe/united-kingdom-261101.osm.pbf --output public/roads
pnpm roads:check
python scripts/audit_roads.py --root public/roads --report road-audit.json
python scripts/package_roads.py --root public/roads --output /exports/SwiftFix-UK-Roads-uk_20261101_v1.zip --report road-package.json
```

The manifest records the source SHA-256, section count, compressed bytes and largest cell. The entire immutable version directory must accompany it. Keep original attribution/licence notices. Personal completion records are never part of this dataset.

The packaging tool includes only the manifest, licence README and referenced cells under a top-level `roads/` folder. It preserves gzip bytes, verifies ZIP CRCs, reports archive SHA-256, and refuses to overwrite an existing package. Extract it into the app's `public/` directory for a bundled deployment, or upload the extracted `roads/` contents to your static host. Do not commit this national ZIP to GitHub.

The audit reads/decompresses every cell, checks coordinate/feature validity and duplicate IDs within cells, compares the unique national ID count with the manifest, and reports actual file sizes and sample coverage. It requires the generator's Python environment. To exercise the actual generated data in the browser (MapTiler style/search intercepted, road requests served normally), set `NATIONAL_ROADS_CHECK=1` and run `pnpm exec playwright test e2e/national-roads.spec.ts`. The regular browser suite uses synthetic road fixtures instead.

## Interruptions and safe resume

The importer now keeps staging at `--work/<version>` on failure, uses durable WAL/FULL transactions, and commits the road records and source-way cursor together at whole-way boundaries. Once the junction pass has completed, repeat the identical command with `--resume` and the same `--work`, source PBF and version. It verifies source SHA-256 and staging integrity, reuses the completed junction counts and roads, and rebuilds the disposable coordinate lookup. Stable IDs and the `(cell,id)` primary key prevent duplicates. A completed geometry checkpoint can also be repackaged into a new empty `--output` directory. Existing immutable release directories are never overwritten.

Compression uses a sequential staging-table scan and disk-backed sort, avoiding millions of random feature lookups on laptop disks. If only compression was interrupted, add `--reuse-cells public/roads/.building-PREVIOUS` to the resumed command. This reads that old staging directory without modifying it and reuses a gzip file only when its complete decoded feature payload matches the saved geometry. Truncated or mismatched cells are regenerated. No road-generation pass is repeated when the durable phase is already `complete`.

An incomplete junction-count pass is deliberately rejected as resumable: its partial counts must not be mistaken for complete junction information. Do not change the extract, edit checkpoints or delete staging to get past validation.

The original importer used `journal_mode=OFF` and temporary scratch directories. A power failure can corrupt its cells table even when the completed junction table survives. `scripts/recover_roads.py` is specifically for that legacy layout. It opens the original read-only, verifies the entire junction table, verifies a pinned source checksum, copies junctions and a contiguous sorted prefix of road rows into a **new** durable work directory, and discards the final potentially incomplete way. The normal importer then resumes with the uncertain tail replayed from the source. The original staging is preserved as evidence. Do not continue writing directly to a damaged legacy database or assume the last logged road count means the country was complete.

```sh
python scripts/recover_roads.py --source /old/scratch/nodes.sqlite --pbf /path/to/united-kingdom-261101.osm.pbf --version uk_20261101_v1 --work /new/recovery-work --expected-md5 4f4f70905c533e697f73dc14f3a5272a --report recovery.json
python scripts/import_roads.py --pbf /path/to/united-kingdom-261101.osm.pbf --version uk_20261101_v1 --source-url https://download.geofabrik.de/europe/united-kingdom-261101.osm.pbf --output public/roads --work /new/recovery-work --resume
```

The recovery checksum shown here belongs only to that pinned extract. For a different source use its published checksum and a corresponding new dataset version. The offline SQLite files are generator scratch only; application progress remains exclusively in browser IndexedDB.

Generated assets and PBF/scratch files are ignored by Git intentionally. Do not drag a national dataset into GitHub Desktop without measuring it. Source updates do not upload ignored road assets.

## Choose asset hosting after measuring

GitHub blocks individual Git files larger than 100 MiB and recommends repositories ideally below 1 GB. Vercel's documented **CLI source upload** limits are 100 MB (Hobby), 1 GB (Pro), and 15,000 source files. These are not a blanket statement that every Git-integrated build has a 100 MB output limit. Check your actual deployment method and plan. See [GitHub large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) and [Vercel limits](https://vercel.com/docs/limits).

If the measured release fits your selected deployment budget, include `manifest.json` and the full release in `public/roads` as deployment artifacts. To intentionally track a measured small release use `git add -f public/roads/manifest.json public/roads/uk_20261101_v1` before reviewing in GitHub Desktop. Never commit the PBF, scratch files, personal backups or LFS pointer files as served geometry. Keep the exact dataset version when redeploying.

For a release exceeding your budget, use a **public static object bucket/CDN**, for example Cloudflare R2 with a production custom domain or S3/CloudFront. This is only file hosting for public OSM geometry, not a progress database. Do not generate the country inside a Vercel function or download the PBF on every deployment.

1. Create/configure the static host in your own account. Upload credentials stay on the uploader machine, never in the application or `NEXT_PUBLIC_` variables.

   For Cloudflare R2, use a [production custom domain](https://developers.cloudflare.com/r2/buckets/public-buckets/), not the rate-limited development `r2.dev` URL. Set this [bucket CORS policy](https://developers.cloudflare.com/r2/buckets/cors/):

   ```json
   [{"AllowedOrigins":["*"],"AllowedMethods":["GET","HEAD"],"AllowedHeaders":["*"],"MaxAgeSeconds":3600}]
   ```

   If objects were cached before CORS was configured, purge that CDN cache. The build probe sends an Origin header so origin-sensitive CORS policies are exercised.

2. Upload the immutable release directory first, retaining the directory structure. Upload `manifest.json` **last**, after all cells exist. Upload `README.md` with attribution as well. An S3-compatible client can copy the complete generated directory; for example after configuring an rclone remote called `roadcdn`:

```sh
rclone copy public/roads/uk_20261101_v1 roadcdn:YOUR_BUCKET/roads/uk_20261101_v1
rclone check public/roads/uk_20261101_v1 roadcdn:YOUR_BUCKET/roads/uk_20261101_v1 --one-way --download
rclone copyto public/roads/README.md roadcdn:YOUR_BUCKET/roads/README.md
rclone copyto public/roads/manifest.json roadcdn:YOUR_BUCKET/roads/manifest.json
```

3. Serve public HTTPS GET requests with `Access-Control-Allow-Origin: *` (no credentials). Set CORS on successful and error responses. `manifest.json` should have `Content-Type: application/json` and `Cache-Control: no-cache`. Versioned `.json.gz` cells can have `Content-Type: application/gzip` and `Cache-Control: public,max-age=31536000,immutable`. Do not add `Content-Encoding: gzip` to an already-gzipped file unless your host handles it correctly; the browser loader accepts raw gzip bytes or HTTP-decoded JSON.
4. Verify `https://YOUR_ROAD_DOMAIN/roads/manifest.json` and its referenced cells are publicly readable, without a login, signed URL or HTML error page. The CDN needs to support normal browser CORS requests. Keep release directories immutable.
5. Add the public directory URL to Vercel Production and Preview as needed:

```dotenv
NEXT_PUBLIC_ROADS_BASE_URL=https://YOUR_ROAD_DOMAIN/roads
```

6. Keep `NEXT_PUBLIC_MAPTILER_KEY`. No database or storage-upload credentials go into Vercel. Deploy again because public configuration is compiled into the browser bundle.

## Deployment protection

`pnpm build` now runs `scripts/check-roads.mjs --vercel` before Next.js. On Vercel (`VERCEL=1`) it rejects a missing/invalid manifest and missing local cells, or probes the CDN with CORS checks and sample cells in East Finchley, Manchester, Glasgow, Cardiff and Belfast. It catches an absent release instead of delivering a broken selection interface. This is a smoke check, not an exhaustive remote integrity audit: validate all files before uploading and use the complete release.

For an explicit local check run `pnpm roads:check`. To check a CDN in PowerShell:

```powershell
$env:NEXT_PUBLIC_ROADS_BASE_URL = 'https://YOUR_ROAD_DOMAIN/roads'
pnpm roads:check
Remove-Item Env:NEXT_PUBLIC_ROADS_BASE_URL
```

The pre-build command reads process environment (as supplied by Vercel), not `.env.local`. Development and CI builds without `VERCEL` still work without a national data artifact. Normal Next.js loading of `.env.local` continues for the app itself.

## GitHub Desktop and redeploy

Apply the supplied source patch to a clean clone of SwiftFix-Tech/SwiftFix-Leaflet-App, or copy the changed source files listed in the delivery report into your existing clone. In GitHub Desktop use File > Add Local Repository if necessary, review the changes, commit and Push origin. Generated releases are delivered separately and remain ignored unless deliberately included after checking limits.

Configure and upload the road assets **before** pushing a production build with the deployment guard. In Vercel keep the existing project/domain, Next.js framework, correct root directory, Node 24.x, `pnpm install --frozen-lockfile` and `pnpm build`. Add the CDN URL only if using external static hosting, then redeploy the corrected commit. Preserve the current origin so IndexedDB progress remains accessible. Export a backup before any domain change.

At zoom 16–18 in East Finchley, click a road away from intersections: it should become blue and increment the counter. Refresh, right-click that section and remove it, then refresh again. Check Undo, export/import, and sample roads in Manchester, Glasgow, Cardiff and Belfast. Keep provider/OSM attribution. Mobile tap and hold use the same geometry and browser database.
