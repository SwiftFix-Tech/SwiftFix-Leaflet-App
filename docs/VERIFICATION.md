# Verification — UK road release and IndexedDB edition

Verification date: 2 November 2026.

## National data and interruption recovery

The original import was interrupted by the laptop shutdown. Its legacy `journal_mode=OFF` cells table was damaged; no completed manifest/release had been published. The complete junction table passed integrity checking. The original staging was opened read-only and preserved.

Recovery retained 29,303,280 road-node reference counts and 3,710,028 unique sections from a contiguous, ordered, complete-way prefix. The uncertain tail was replayed after source way 136737254. The download and junction pass were not restarted. The pinned source MD5 still matched Geofabrik; source SHA-256 is recorded in the release audit.

The finished `uk_20261101_v1` release contains **9,387,158 unique sections in 7,971 cells**. Every gzip/JSON cell, feature, ID and coordinate was audited, and the distinct count matches the manifest. Sample cells in East Finchley, Manchester, Glasgow, Cardiff and Belfast are present. Compressed cells total **551,301,473 bytes**; the largest is **1,308,920 bytes**. See [release audit](ROAD-RELEASE.json).

The separate road ZIP contains 7,973 files (cells, manifest and licence README), is 552,658,113 bytes, and passed archive CRC verification. SHA-256: `dbf724a8d3ee5bde5c6961dd8536d7a9d430cc7f046cf36a96e048a61e84fd84`. It excludes PBF, SQLite staging, application source and personal progress. It must not be committed to GitHub as one oversized file.

## Application checks

- Frozen-lockfile installation, standalone TypeScript checking and the Next.js 16.4.3 production build passed. The final build used `VERCEL=1`, so the missing-asset guard checked the full local release. TypeScript checks remain enabled.
- **38 Vitest tests passed** for IndexedDB persistence, duplicate prevention, backup validation/merge/rollback, exact counts, optimistic operations, Undo, error rollback, cache coalescing and map/gesture wiring.
- **2 Node deployment tests passed** for missing local assets, complete releases, public HTTPS/CORS configuration and invalid remote responses.
- **9 Python tests passed**, including segmentation, actual pyosmium parsing, cell boundaries, immutable releases, full worker generation, national audit behavior, read-only prefix recovery, source-hash rejection, safe resume, exact reuse of closed cells, regeneration of truncated cells and separate archive packaging.
- **22 Playwright checks passed, with 2 platform-specific skips**, against the production build in Edge/Chromium. The regular checks cover refresh and full browser restart, marking, duplicate clicks, right-click removal, mobile tap/hold, Undo, global counts, backups/restore, separate profiles and UK navigation.
- Ten national acceptance checks exercise actual generated road files in East Finchley, Manchester, Glasgow, Cardiff and Belfast on desktop and phone layouts. Road requests are not intercepted. They verify exact saved IDs/geometry, persistence, removal, and rendered blue pixels appearing/disappearing around the selected road.

The first browser run exposed a new test refreshing during an optimistic removal. The test now waits for the confirmed IndexedDB commit before refreshing. An isolated browser-startup timeout passed unchanged on rerun; the subsequent complete suite passed. The strengthened rendering checks were then rerun separately. No application storage/map code was changed to satisfy these checks.

## Scope of external acceptance

MapTiler style/search responses are intercepted in browser tests with a public test key; production road files and real browser IndexedDB are used for national checks. No live MapTiler account/billing/origin restrictions, external road CDN or Vercel deployment was tested. Configure the existing real key and upload the audited static release before redeploying. Follow [deployment instructions](ROAD-DEPLOYMENT.md).

Physical Safari/iPhone/Android checks remain separate from Chromium phone emulation. Browser storage remains subject to cleared site data, private browsing and storage eviction. Keep the same app origin and export backups before domain/profile/device changes. No progress is uploaded to a database, and the IndexedDB schema, backup format and existing UK MapLibre controls remain unchanged.
