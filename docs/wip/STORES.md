# STORES wip

## Code as found (base b0f273f)
- index.js 688 lines. Persist literal (`_persist`, ~L638): persistedWallAt, then boards, fdr, airspaces, correlations, marsa, fieldStates, carriers, sfaRotation.
- Restore order (`_restore`, ~L564): fdr, airspaces, boards (data.boards, else pre-WP4A data.board), correlations, marsa, fieldStates, carriers (+evictMissingFdrs), sfaRotation, migrateClearanceAnnotations, migrateOverflightStates, _reconcileRestored, _reconcileLogTail.
  NOTE: persist order != restore order (boards first in JSON, fdr first in restore). The briefing's "array order = JSON order = restore order" cannot hold; byte-identical body wins.
- Call sites: handleMessage closure and `persist` (both `_persist`), `_restore` once in createEfsp. Neither is exported.
- Module-level path constants: BOARD_SNAPSHOT_READ_PATH / BOARD_SNAPSHOT_PATH (statePaths at require time, env CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH). `BOARD_SNAPSHOT_PATH` is exported but nothing imports it.
- Base counts: crc-sync 2092 tests (3 timing fails under load, differing per run), crc-desktop 866 (1 todo), freeze 47 pass.
- M9 finds `      boards,\n      fdr: fdrStore.snapshot(),` in index.js; M10 finds `liveStripsForFdr: (fdrId, excludeStripId) => {`.

## Defaults taken
