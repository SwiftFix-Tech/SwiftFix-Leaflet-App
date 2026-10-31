# Architecture and data licensing

## Map provider decision

The implementation uses **MapLibre GL JS + MapTiler Cloud + independently imported OSM road data**. Google Maps is not used. This is the alternative stack requested in the brief; it is a conservative integration choice, **not a claim that OSM overlays are universally prohibited on Google Maps**.

The OSM Foundation's [legal FAQ](https://osmfoundation.org/wiki/Licence_and_Legal_FAQ) distinguishes derivative and collective databases and points to its horizontal-layer guidance. Independently sourced layers can have separate licences. ODbL by itself does not establish a blanket Google-overlay prohibition. Google's [terms](https://cloud.google.com/maps-platform/terms) prohibit scraping and deriving geometry from Google content and impose product-specific usage rules. A Google implementation could be possible after confirming the exact agreement and separation of data. This implementation avoids combining those contracts and provides a complete selectable centreline layer on a MapLibre-compatible provider. It does not include a non-working Google switch.

[MapTiler documents MapLibre integration and geocoding](https://docs.maptiler.com/cloud/api/geocoding/). Its [Cloud terms](https://www.maptiler.com/terms/cloud/) and [copyright requirements](https://www.maptiler.com/copyright/) apply to the subscription. Use a commercial plan; do not assume a free plan permits this business application. The app uses its hosted streets style and transient UK geocoding. It never extracts road geometry from MapTiler vector tiles, which may contain licensed content beyond OSM.

Road geometry comes from [Geofabrik's UK OSM extract](https://download.geofabrik.de/europe/united-kingdom.html), explicitly including Northern Ireland, and is licensed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Visible attribution links to [OSM copyright](https://www.openstreetmap.org/copyright). Retain release provenance and the licence with redistributed road databases. If you publicly use/distribute an adapted road database or produced works, evaluate and fulfil ODbL attribution, share-alike and database offer obligations for that use. Private staff access does not remove the underlying licence obligations; do not assume completion/derived geometry can always be published under proprietary terms. Obtain licence advice for a changed distribution model. Tracking access remains private through authentication and RLS.

Sources reviewed during implementation on 31 October 2026. Provider terms and subscription conditions must be checked when provisioning and when changing providers or publishing data.

## Data flow

1. Supabase validates a magic-link session. The client reads its membership under RLS.
2. At street zoom (14+) a quantized visible bounding box requests complete active road features. Highlight snapshots load at zoom 12+ within a bounded area. Broad UK views show the base map and global count, without downloading the network.
3. `tracker_view` returns count, workspace revision and the first 750 records of each layer from one database snapshot. `tracker_page` loads subsequent keyset pages. A revision or release mismatch retries the view. Requests are bounded to 12,000 roads/20,000 highlights; denser views show a zoom-in message rather than silently dropping sections.
4. MapLibre's rendered-feature index narrows candidates. Screen-space distance to complete source polylines picks the closest section; completion features take precedence on duplicate IDs. At grade-separated crossings there is unavoidable visual ambiguity at the crossing pixel: click along the desired road on either side. No whole-road name matching is used.
5. `set_completed` verifies membership, locks the workspace, resolves canonical geometry and changes one section transactionally. `(workspace_id, road_segment_id)` prevents duplicates. The user ID is audit information, not the owner of a separate map.
6. Optimistic UI paints immediately; a serialized queue persists rapid edits. A failed write restores prior state, displays the error, then reloads authoritative data. A transport failure can have an ambiguous commit outcome; refreshing resolves actual database state rather than assuming that the server did not commit.
7. Workspace revision updates invalidate other clients. Polling and focus/reconnect refresh provide a fallback if Realtime is unavailable. Other staff see changes shortly, not a guaranteed instantaneous broadcast.

## Identity, snapshots and updates

The stable ID contains a dataset namespace, immutable release version, OSM way ID and direction-independent hash of source node IDs. It is independent of rendering tiles. Junction splitting and source-node subdivision produce sections with their original vertices. OSM identity can change between releases, so the version is intentional.

`completed_roads` stores the complete snapshot and release reference. Old releases are never overwritten by import. A separate revision row survives deletion so Undo can detect another staff member's intervention even through remove/re-add cycles. Normal idempotent completion never changes the revision or creates a duplicate; Undo supplies the expected revision.

Dataset reconciliation requires reviewed mappings for every saved old section and blocks activation when any are missing. The importer and reconciliation scripts are privileged offline tools. They accept credentials through environment variables, never browser bundles. Reconciliation invalidates Undo tokens and preserves old completion records in an admin-only audit table.

## Security and runtime boundaries

All public tables have RLS. Anonymous users receive no table permissions. Members can read shared data; only guarded `SECURITY DEFINER` RPCs can mutate completion state. Definer functions use an empty search path and fully qualified objects. Clients cannot add memberships, activate releases or inject arbitrary completion geometry. No admin credential is needed by Next.js.

Next.js renders a generic signed-out shell; no staff data is embedded in HTML or cached publicly by Vercel. Supabase session tokens are browser-managed. Configure production auth redirects, SMTP, allowed MapTiler origins and HTTPS. The application deliberately blocks edits while offline; it has no misleading local-only persistence fallback.

## Operational limits

PostGIS GiST indexes bound geometry queries; unique/composite indexes serve workspace lookup and keyset paging. Only `moveend`, search selection, realtime invalidation and scheduled refresh load tracking data. Pointer movement only performs local hit testing. Requests for the same viewport coalesce, cached views expire after 15 seconds, and the eight-view LRU is cleared on mutations. Complete section geometry can extend outside the viewport but retains one ID.

The national network belongs in a provisioned database; loading it is a substantial one-time job. Geometry import has not been capacity-benchmarked on a real full UK release here. Memberships are invite-only and there is no public geodata proxy. OSM omissions and source-node geometry quality remain dataset limitations. The application is for distribution tracking, not navigation or route planning.
