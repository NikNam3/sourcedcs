# FREEZE-GRAIN (ARCH-W 5.4, H106 AC-4 "restructure the goldens")

Branch `lane/FREEZE-GRAIN-freeze-grain`. Only `crc-sync/tests/freeze/**` touched; no `src/`, no package.json edit.

## What changed
1. **Ids by first appearance per golden.** `canonical()` no longer renumbers; recordings keep their (deterministic) uuids and `renumberIds()` numbers them `#1, #2...` over the whole golden text at write/compare time (any uuid form, so the hub host's seeded ids too). `digest()` renumbers inside its own record. Keys holding a uuid keep insertion order (raw value is not stable).
2. **Projection hashes** (`PROJECTION` in `freeze-lib.mjs`). Strip core: `stripId stripType state ownerPositionId bayId rackId orderKey rev flightDataId`; sparse (hashed with null/false/""/[]/{} pruned): `flags coordination airspaceEntry tofiCoordination annotations previousLeg`. Flight data core `flightDataId rev`; sparse `identity filed assigned clearance airspace comms`. Everything else (`cid`, timestamps, `updatedBy`, `ato`, `military`, ...) is ext: in FREEZE_DUMP dumps, in no hash. Non-record objects hash with empties pruned. Persisted-body hash in hub steps is over the projection too; the per-step `bytes` count is gone.
   **Promote a field:** add it to `PROJECTION.<kind>.core` or `.sparse`, run `npm run freeze:update`, own commit.
3. **`VOLATILE_KEYS` + `VOLATILE_RE`** (`boardSeq`, `boardSeqByFacility`, `storeSeqs`, `undoable`, any `*Epoch/*Epochs/*EpochByFacility`) are dropped by `canonical`/`summarize`. One line to add one. (Hub non-full frame labels still print `#boardSeq`.)
4. **Split per op:** `golden/table-mutations/<op>.json` (17) and `golden/hub-op-matrix/<op>.json` (+ `setup`, `resync-*`, `ato-*`, `_checkpoints.json`). Hub op steps drop cumulative `i`, `t` and the per-step Board hash; whole-state checkpoints and counters live in `_checkpoints.json`. `checkGoldenSet` also fails on a missing/stale file.
5. New `freeze-grain.test.mjs` (4 tests). Table cmids are `freeze-cmid-NNNNN` (uuid-shaped ones collided with the uuid counter).

## Numbers
- Goldens: 44 files / 13.8 MB before; 109 files / 12.8 MB after (size is mostly verbatim in/out, unchanged by design).
- `npm run freeze`: 52/52 (48 + 4). `freeze:selfcheck`: 18/18 after the final code. `npm test`: 2423/2423.
- Grain demo (scratch, reverted): 3 extra `randomUUID()` calls in `create-strip.js`: **3 of 109 goldens change** (was 38-44 of 44); a new non-empty ext field on every Strip: **0 goldens**. Residual 3 and why: `scenario-tactical-l23` (its test hard-codes uuid-shaped cmids `00000000-0000-4000-8000-0000000000aa` in `tests/efsp-scenario-tactical-l23.test.mjs`, which collide with the freeze counter; fix there, not mine to edit), and `hub-random-seed1/2` (`efsp-alerts` frames hash content ordered or derived by raw id value in src).

## Item 5 (retire scenario goldens?)
Default taken: keep all 13 `hub-*` and all `scenario-*`. Case for retiring: the 26 scenario goldens (~6 MB) replay `tests/efsp-scenario*.test.mjs`, which already assert intent; with the new grain they churn rarely, so the cost argument weakens. Case for keeping: they are the only whole-wire characterisation of the scenario corpus and caught M1-M16 alongside the hubs. Recommendation: keep for now; if the integrator still re-records often, retire scenarios first (delete files + `freeze-scenarios.test.mjs` + `freeze-recorder.mjs`; selfcheck detectors list `freeze-scenarios` in several Mxx files, remove it there).

## Integrator: resolving golden conflicts at merge
Never hand-merge a golden. Resolve code conflicts, then `git checkout --theirs`/ours on `crc-sync/tests/freeze/golden`, run `cd crc-sync && npm run freeze:update`, review `git diff --stat` (expect few files; a behaviour lane's op shows in its `<op>.json` only), commit as `test: re-record goldens`. A directory split means conflicts are per op file.

## Suggested CLAUDE.md text (crc-sync section)
"Freeze goldens: ids are numbered per golden by first appearance; hashes cover `PROJECTION` (`tests/freeze/freeze-lib.mjs`), other fields are ext; cross-cutting counters go in `VOLATILE_KEYS`; `table-mutations/` and `hub-op-matrix/` are one file per op. Promote a field to the projection on purpose; re-record with `npm run freeze:update`."

## Findings
- Scenario tests should not use uuid-shaped literal cmids (collision above). `docs/wip/FREEZE.md` still describes whole-record hashes (not edited; superseded by this file).
- E2E-STAB Board clock change: supervisor re-records at merge.
