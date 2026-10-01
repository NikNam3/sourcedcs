# STORES report
Branch lane/STORES-registry; commits:
c1527b3 docs(STORES): report
28ca472 refactor(STORES): retarget M9 to the registry order
aeeee59 refactor(STORES): persisted-store registry (stores.js) and call-time snapshot paths
0d29552 wip(STORES): code as found

- Tests: crc-sync 2092 -> 2092 (all pass; base had 3 load-timing fails, green on rerun), crc-desktop 866 -> 866 (1 todo). Freeze goldens 47/47 identical, no UPDATE_GOLDEN.
- Selfcheck: M9 retargeted (src/efsp/stores.js, swaps REGISTRY[0]/[1]) CAUGHT; M10 unchanged text, CAUGHT. soak:selfcheck not run (no gated file touched).
- index.js 688 -> 542 lines; new src/efsp/stores.js (REGISTRY, RESTORE_ORDER). ctx.stores added; all old ctx keys kept; aliases and data.board restore kept.
- Structure fixtures: none changed. Files outside Owns: none.

## Defaults taken
- Persist order != restore order (boards written first, restored after fdr/airspaces). Registry is in persist order (byte-identical body); an explicit RESTORE_ORDER list in stores.js drives restore. The briefing's "array order = restore order" is impossible.
- `sfaRotation` is the key (not `sfa`), matching the persisted body.
- No `after` hook: carriers' evictMissingFdrs lives in its restore; cross-store steps (migrations, _reconcileRestored, _reconcileLogTail) stay in _restore after the loop, original sequence.
- `boards` is a registry entry whose "store" is the facilities Map (BoardStores are still built in the Facility loop).
- `BOARD_SNAPSHOT_PATH` export kept (require-time default) because frozen tools/soak/host-core.js and tests/freeze/freeze-recorder.mjs read it; createEfsp no longer uses it.
- Version key / upgrade hook: a comment in stores.js only.

## Findings for other lanes
- APP: pass `paths: {read, write}` to createEfsp; retire the BOARD_SNAPSHOT_PATH export with host-core + freeze-recorder.
- Stores build in registry order with lazy `stores.fdr` closures; a new store needing another at construction time must come after it.

## Code as found (base b0f273f)
- index.js 688 lines. Persist literal (`_persist`, ~L638): persistedWallAt, then boards, fdr, airspaces, correlations, marsa, fieldStates, carriers, sfaRotation.
- Restore order (`_restore`, ~L564): fdr, airspaces, boards (data.boards, else pre-WP4A data.board), correlations, marsa, fieldStates, carriers (+evictMissingFdrs), sfaRotation, migrateClearanceAnnotations, migrateOverflightStates, _reconcileRestored, _reconcileLogTail.
  NOTE: persist order != restore order (boards first in JSON, fdr first in restore). The briefing's "array order = JSON order = restore order" cannot hold; byte-identical body wins.
- Call sites: handleMessage closure and `persist` (both `_persist`), `_restore` once in createEfsp. Neither is exported.
- Module-level path constants: BOARD_SNAPSHOT_READ_PATH / BOARD_SNAPSHOT_PATH (statePaths at require time, env CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH). `BOARD_SNAPSHOT_PATH` is exported but nothing imports it.
- Base counts: crc-sync 2092 tests (3 timing fails under load, differing per run), crc-desktop 866 (1 todo), freeze 47 pass.
- M9 finds `      boards,\n      fdr: fdrStore.snapshot(),` in index.js; M10 finds `liveStripsForFdr: (fdrId, excludeStripId) => {`.

