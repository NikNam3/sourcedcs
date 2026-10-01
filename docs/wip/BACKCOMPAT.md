# BACKCOMPAT (W6)

## Code as found (base 115ff24)

- Aliases: `efsp.boardStore` / `efsp.positionStore` and `ctx.boardStore` / `ctx.positionStore` in `src/efsp/index.js` (ctx + returned object).
  Callers: `src/ws-hub.js:542` (heartbeat), comments in `src/app.js` and `efsp-ws.js`; ~25 test files (efsp-ws 33 uses).
  Moved-Owns: none of the aliases moved; restore code is in `src/efsp/stores.js` (boards entry, pre-WP4A `saved.board`).
- Restore migrations: `index.js` `_restore` calls `migrateClearanceAnnotations` (clearance-migration.js) and
  `migrateOverflightStates` (overflight-migration.js, L28 TRANSITING). Tests: efsp-overflight-migration, efsp-clearance (part),
  crc-desktop tests mention overflight-migration by name (allow-lists). Item 8 answer present in decisions.md H88: delete.
- Rule guards: ~50 rule names read under board-store.js + board/** (same scan as freeze guard 1); ~70 optional-guard sites
  (`rules.x ? ... : null`, `rules.x &&`) in placement, coordination, tofi, strip-ops, ops/*, board-store:300.
  Moved-Owns: guards live in `board/*.js`, `board/ops/*.js` (not index.js).
- Partial-rules fixtures: `new BoardStore(` in 11 test files (14 sites + efsp-board-store 9) plus src/efsp/index.js.
- `blockVisibility`: facility-config.js `_loadOne` (warn + delete).
- authority-coverage: tests/authority-coverage.test.mjs (test only).
- Test script: `"test": "node --test"`; freeze: `freeze:update`, `freeze:selfcheck` in crc-sync/package.json.
