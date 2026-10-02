# BACKCOMPAT report (W6)

Branch `lane/BACKCOMPAT-removal`, base 115ff24. Commits (this doc commit follows the last):
f24e6d0 chore(BACKCOMPAT): close the refactor window; the freeze suite is opt-in (npm run freeze), dated note in FREEZE.md
5e59d67 behaviour(BACKCOMPAT): Board restore takes only the current shape; assertRules checks kinds; boardStoreFor needs a Facility
49c5cb7 behaviour(BACKCOMPAT): no aliases, no restore migrations; an unknown persisted shape or legacy file key stops start-up
95f949c behaviour(BACKCOMPAT): every rule the Board reads is required; the optional-rule guards are gone
ae73266 refactor(BACKCOMPAT): tests/helpers/full-rules.mjs and required-rules.js; BoardStore fixtures build a complete rules object
ccd0cb5 docs(BACKCOMPAT): step 0, code as found

Suites: crc-sync 2158 (base ~2143) -> 2157 pass + 1 load-timing fail (test-reset "real server", passes alone; ato tokenize and
grpc backoff also flaked once under load, pass alone); crc-desktop 880/880. Freeze 48/48 identical, no golden touched or
re-recorded. soak:selfcheck PASS; freeze:selfcheck 18/18 caught (run before the last restore commit, which touches no mutation
target). Structure fixtures: clock allow-list loses the `persistence.js restore` entry; freeze guard 2 exempts
tests/required-rules.test.mjs (STRUCTURE_POLICIES).

Removed / changed:
- Optional-rule guards (~70 sites): board-store.js:300, board/placement, coordination, tofi, strip-ops, board/ops/*. 50 rules now
  required: `src/efsp/required-rules.js` (REQUIRED_RULES + kind check; a null function rule = missing), `assertRules` in the
  BoardStore constructor. tests/required-rules.test.mjs (ordinary test) proves list == guard-1 scan == helper defaults, and the loud error.
- Aliases efsp.boardStore/positionStore (index.js ctx + return) gone; boardStoreFor/positionStoreFor no longer default to INCIRLIK
  (no id = throw); ws-hub.js heartbeat uses DEFAULT_FACILITY_ID (outside Owns, approved).
- clearance-migration.js, overflight-migration.js deleted (H88); L28 TRANSITING restore gone; stores.js pre-WP4A `board` shape gone.
- Restore is loud (index.js `_restore` has no catch-all; stores.js; board/persistence.js `restore`, outside Owns, approved Q6-BC-3):
  unreadable/non-JSON file, pre-WP4A `board`, unconfigured Facility, Strip state its Role lacks (TRANSITING), pre-0058 clearance
  annotations, per-Strip `correlation`, missing strips/cidSeq/replay/droppedWallAt, DROPPED Strip without drop time. Missing file =
  first run. A failed start leaves the file byte-identical (tested in tests/efsp-restore-refusal.test.mjs).
- facility-config.js: a `blockVisibility` key is a startup error naming the file. createEfsp: assertAuthorityCoverage.
- Window close: `npm test` = tests/*.test.mjs; `npm run freeze`; dated note (2026-10-02) in docs/wip/FREEZE.md.
- Moved-Owns: board/*.js + board/ops/*.js (guards), board/persistence.js, stores.js (restore), index.js; helper tests/helpers/full-rules.mjs.
- Outside Owns: ws-hub.js, crc-desktop/tests/overflight-shared-state-names.test.mjs (allow-list entry removed), ~25 test files.

Defaults taken: required-rules.js lives in src/efsp/ (board-seam test forbids whole-`rules` use under board/); full-rules default
baysFor is an "every Bay" array; a Board for an unconfigured Facility is fatal; the clearance detector keeps a local copy of the old Block ids.

Findings: crc-desktop/tests/efsp-ui-reachability.test.mjs comments still cite clearance-migration.js; facility-schema.js and block-map.js
comments mention blockVisibility (comments only, L20). The clearance detector sees only the Blocks in PRE_0058_CLEARANCE_BLOCKS.

For the human before deploy: a deployed `state/` now fails startup loudly (naming file and reason) if efsp-board.json: is not valid
JSON; has a top-level `board` (pre-WP4A); has a Board for an unconfigured Facility; has a Strip in TRANSITING or another state its Role
lacks; has Strips with assigned altitude/heading still as annotations or a per-Strip `correlation`; or lacks cidSeq/replay/droppedWallAt
or a drop time for a DROPPED Strip. Also an efsp-facility-*.json with a `blockVisibility` key (plus DATA-1's rule: a missing/invalid
facility file). Fix: delete the named state file (clean start, R3-2) or correct it.

---

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
