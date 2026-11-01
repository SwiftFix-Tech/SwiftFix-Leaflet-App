# Verification — local IndexedDB edition

Verification date: 1 November 2026.

## Application and storage checks

- **37 Vitest tests passed**: the existing optimistic state controller, save/remove/Undo, rollback, rapid edits, offscreen Undo, cache coalescing, map event wiring and mobile gesture logic; the new IndexedDB transaction layer, reopen persistence, duplicate prevention, cross-tab revision conflicts, exact browser-wide count, backup export/restore, merge validation, atomic conflict rollback and quota-error rollback; and static geometry loading/caching.
- The IndexedDB unit suite uses `fake-indexeddb`, a test implementation of the real IndexedDB API. It verifies object-store and transaction behavior instead of replacing persistence with an in-memory application backend. Existing state-controller tests also retain their focused mock backend.
- **6 Python tests passed**: original segmentation checks, actual pyosmium parsing with disk-backed locations, and the full static-generator worker pipeline with curved geometry, Belfast coordinates, cell-boundary duplicate IDs, immutable versions and scratch cleanup.
- **12 Playwright browser checks passed, with 2 platform-specific skips**, using Microsoft Edge/Chromium with the actual MapLibre renderer and real browser IndexedDB. Provider responses and road assets are synthetic fixtures, intercepted in the test runner; no test-only data is included in production road assets.

## Browser acceptance scope

The Playwright suite covers desktop and phone entry layout, permanent storage warning, actual rendered-road marking, repeated clicks, refresh and page reopening, context-menu deletion, persistent Undo, all-road JSON download, duplicate merge, restore after deletion, rejection of malformed JSON, Belfast/East Finchley navigation, zoom alignment, independent browser profiles, native touch tap/hold removal, and closing/reopening a persistent browser profile. Platform-specific tests deliberately skip desktop touch and duplicate phone browser-profile restart checks.

During these checks a pre-existing CSS conflict was fixed: MapLibre's `position: relative` was overriding the application's full-map container, clipping the canvas and intercepting clicks. The selector is now specific enough to preserve absolute positioning. Road menus also render above backup notifications so notifications cannot block removal on smaller screens.

## External acceptance still required

The full national UK extract is not present in this checkout and has not been generated or capacity-benchmarked here. The generator was tested end-to-end on synthetic OSM fixtures, including Northern Ireland coordinates. Before live new-road selection, generate and deploy the complete UK static assets as described in README, including the release referenced by the manifest.

No live MapTiler account/key, paid subscription, origin restrictions or real-provider road alignment was validated. Before rollout, configure the single public MapTiler key and check actual road selection at curves, parallel roads, roundabouts and intersections in England, Scotland, Wales and Northern Ireland. At an exact grade-separated crossing, click a little along the intended road to resolve overlapping visual geometry.

Mobile tests emulate a phone in Chromium and dispatch actual browser touch events. Physical iPhone Safari/Android testing remains useful for platform gesture/storage behavior. IndexedDB persistence is subject to browser storage policies, cleared site data, private-browsing lifecycle, available disk space and eviction; backups remain essential. Changing the website origin uses a separate browser database.

Production deployment needs no database credentials, migrations, sign-in or replacement cloud storage. The website stores no progress in localStorage and sends no tracking records to a database service.
