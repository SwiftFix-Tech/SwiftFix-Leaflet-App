# Verification and release acceptance

## Executed in this workspace

- `next build`: successful production compile, TypeScript validation and static-shell generation.
- Vitest: **26 tests passed** across Supabase API adapter, state controller, request cache, gesture logic and map event integration.
- Python: **5 tests passed** for junction splitting, curved geometry, closed roundabouts, stable versioned IDs, subdivision at existing vertices and actual pyosmium parsing with the disk-backed cache/worker lifecycle. **4 database integration tests skipped** because no dedicated live database is configured.
- Playwright with Microsoft Edge: **2 checks passed**, desktop and phone viewport, for the signed-out/private setup entry point and absence of horizontal overflow.

The browser checks used the real Next.js production server with no service credentials. Map event tests used a mocked MapLibre renderer. Persistence tests used an in-memory test backend, and adapter tests mocked the Supabase RPC transport. These are not live Supabase or real map-provider tests.

## Automated coverage by requested behavior

| Behavior | Automated coverage | Live acceptance still required |
| --- | --- | --- |
| Click marks blue | Map event selection + full geometry + blue paint configuration + optimistic controller | Real map hit testing at UK intersections |
| Save to Supabase | RPC adapter arguments + queued persistence + transactional database suite supplied | Run database suite against dedicated Supabase |
| Refresh restores | New controller rehydrates saved features | Close/reopen browser against configured services |
| Right-click menu | Menu opens, Escape/outside click closes, remove action calls persistence | Native desktop context menu suppression |
| Remove deletes | Controller deletes, Undo recreates; database tests supplied | Real RLS-authorised deletion |
| Double click | One request and one saved completion | Concurrent real clients |
| Accurate total | Increment/decrement, rollback, shared state, paging retains global total | SQL integration count with large dataset |
| Zoom alignment | Same geographic coordinates supplied across zoom levels | Real GPU renderer at zooms 14–20 |
| Revisit UK locations | Rehydration from another viewport, global count and offscreen Undo | Belfast/Glasgow/Cardiff/Manchester real geometry |
| Shared staff map | Two controllers share persisted data; real membership tests supplied | Two real authorised sessions + Realtime |
| DB errors | Add/delete rollback, surfaced API errors, revision conflict | Network failure and expired-token behavior |
| Mobile | Tap/hold logic, drag cancellation, long-press menu and synthetic-click suppression | Physical iPhone/Android gesture arbitration |
| Efficient loading | In-flight coalescing, TTL, LRU, force refresh, keyset pages and revision retry | Full UK database load/capacity measurement |

## Required staging acceptance before production rollout

1. Provision a commercial MapTiler subscription and origin-restricted key, Supabase Auth/SMTP, workspace memberships and the pinned **United Kingdom** road dataset. Verify all required countries are present in the imported release.
2. On a dedicated test database run `scripts/test_database.py` with `SWIFTFIX_TEST_DATABASE=1`. Confirm anonymous/outsider denial, direct table write denial, uniqueness, shared reads and revision-checked Undo.
3. Open the real map near East Finchley. Mark a curved residential section, a roundabout section and parallel roads. Verify only the chosen section changes, names remain legible and intersections are picked as expected. Click a little away from an exact overlapping crossing to resolve visual ambiguity.
4. Refresh, sign out/in, visit Belfast, Glasgow, Cardiff and Manchester, and return. Verify highlights and the total persist. Check the network panel: no national network download and no requests on pointer movement.
5. Use two staff sessions in different browsers. Verify changes propagate through Realtime or within the 30-second foreground fallback. Verify Undo refuses to overwrite intervening edits to the same section.
6. Disable the network during add and remove. Confirm a visible error and authoritative state reconciliation after reconnect. Test multiple rapid marks and an immediate remove while the mark is saving.
7. On physical iPhone and Android, tap to mark and hold to remove. Pan/pinch without accidental marks; verify generated clicks do not dismiss the hold menu.
8. Import another release inactive in staging, review mappings, dry-run/apply reconciliation and verify saved sections and audit history survive. Exercise backup restoration.
9. Measure database storage, GiST query latency, page count, browser memory and rendering on a low-powered phone. Test thousands of saved sections spread nationwide and a dense urban viewport. Verify zoom-in messages replace oversized responses.

## Deployment status

No GitHub remote or Vercel deployment has been provisioned. No full UK PBF import, live authentication email, live RLS test, map-provider request or full-network benchmark has been executed here. The source and deployment configuration are supplied; the service setup and staging acceptance above remain necessary before describing the installation as production-verified.
