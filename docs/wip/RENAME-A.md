# RENAME-A: crc-sync identifiers, file moves, every wire/snapshot name (W7)

## Report

(written at the end)

## Step 0: code as found (base `470c6d1`)

Suites at the base: crc-sync `npm test` 2111 tests, 2110 pass + 1 todo; `npm run freeze` 48/48; crc-desktop
`npm test` 883 tests, 881 pass + 2 todo (load ~6).

Tool: `docs/wip/RENAME-A/rename_tool.py` is rename-map §8 copied verbatim. Counts:
`docs/wip/RENAME-A/step0-count.txt` (`count --tokens`). Lane totals now vs §9 (prep at `165a517`): A structural 982
exact (962) + 2150 stem (2226); A wire 8518 exact (8483) + 139 stem; goldens 47873 (47237); review sites 1505 area A
(1356), 1269 area B (1260), 3 area C.

Per term (mechanical A/B/C/D/G, prep → now), only the moves that need a sentence:
- **N18** C 28 → 40: DATA-1 made the four facility JSONs complete (every Bay and consolidation entry is now in
  `config/efsp-facility-*.json`, not in `DEFAULT_CONFIG` literals), so the Position and Bay ids appear there more often.
- **N05** C 2 → 4: the same cause (`coveringChain` in the CENTER file too).
- **N11** A mechanical 277 → 311 (+12 %) and review 892 → 1038 (+16 %): AUTH's `authority/` registry and BOARD-3's
  `board/ops/*.js` repeat the Role tables per family/op. Under 20 %; no other row moved by more than 5 %.

### Every file of §6 on the new layout

| §6 | Found at (base) | Moved to (commit 1) |
|---|---|---|
| station-coverage | `src/efsp/station-coverage.js`, `tests/efsp-station-coverage.test.mjs` | `position-coverage.js` (+ test) |
| fdr-store | `src/efsp/fdr-store.js`, tests `efsp-fdr-store`, `efsp-fdr-ato` | `flight-data-store.js`, `efsp-flight-data-store`, `efsp-flight-data-ato` |
| field-state | `src/efsp/field-state.js`, `field-state-store.js`, `src/efsp/wire/families/field-state.js` (WIRE), tests `efsp-field-state`, `-l1b`, `efsp-scenario-field-state` | `runway-status*.js` (+ tests) |
| stca | `src/stca.js`, `tests/stca.test.mjs` | `conflict-alert.js` (+ test) |
| carrier transfers | `src/efsp/carrier/transfers.js`, `transfer-effects.js`, `tests/efsp-carrier-transfers.test.mjs` | `handoffs.js`, `handoff-effects.js`, `efsp-carrier-handoffs.test.mjs` |
| authority/roles/ | `src/efsp/authority/roles/` (AUTH, 8 files) | `authority/strip-types/` |
| golden | `tests/freeze/golden/scenario-field-state.json` | `scenario-runway-status.json` **in commit 1** (see Defaults) |
| client | `css/field-state-panel.css`, `js/panels/efsp/field-state-panel.js`, `field-state-rules.js`, `e2e/field-state.spec.js`, `tests/efsp-field-state-client.test.mjs` (now `.mjs`, ESM) | `runway-status-*` |
| **not in §6** | `src/efsp/board/ops/carrier-transfer.js` (BOARD-3, named after the N06 Mutation kind) | `board/ops/carrier-handoff.js` |
| **not in §6** | `tests/efsp-carrier-roles.test.mjs` (N11's test-file row) | `efsp-carrier-strip-types.test.mjs` |

Importers: 37 `require`/`import` lines from the briefing's grep, plus path strings in tests (`readServer(...)`,
`readdirSync(.../authority/roles)`, the module-graph fixture keys, `overflight-shared-state-names` ALLOWED keys,
selfcheck M12/M16 `file:`), JSDoc `import('./fdr-store')`, `<link href>` in `index.html`, and file-name pointers in
comments (`fdr-store.js's setField`). All were rewritten **by path** by `docs/wip/RENAME-A/moves.py` (the script
that ran, quoted there in full: one regex per moved file name, the extensionless form only after a `/`, so the map
source `'stca'`, the logger `'efsp:station-coverage'` and the `'field-state'` log/trace labels are left for the
token pass). One hand edit: crc-desktop `ws-message-contract.test.mjs` `FAMILY_FILES` lists `'field-state'` as a file
name.

### Traps (step-0 greps)

`docs/wip/RENAME-A/step0-traps.txt`. Trap 1 (regex literals naming an id): 14 sites, in
`e2e/l3-coordination.spec.js:211`, `e2e/runway-status.spec.js:246,252,382,401`, `tests/coverage-panel.test.mjs:80,90,115`,
`tests/efsp-correlation-client.test.mjs:211`, `tests/efsp-stereo-panel.test.mjs:241`, crc-sync
`efsp-runway-status.test.mjs:359,967`, `efsp-scenario-incirlik-l18.test.mjs:119`, `efsp-ui-findings.test.mjs:432`.
The "ids in sentences" grep has ~495 lines: comments and test titles (L20) except the expected server messages,
which the wire commit fixes where a test fails.

### Promotion check (rename-map §1.2)

`docs/wip/RENAME-A/step0-promotion.txt` (the `A`/`S` exact rows) plus the same grep over every `A`/`S` stem
compound. **One promotion: N04 `heldPositions` (S → W).** `ws-hub.js` `_coverageMsg()` sends it on the `coverage`
frame (`heldPositions: session.coverage.heldPositions`) and the client's `app.js:450` reads `msg.heldPositions`. No
golden carries it, so derivation said S. It is renamed in the wire commit, not in the N04 structural commit. The other
hits are method calls or locals (`isOccupied`, `setHeldPositions`, `heldBy`, `coveringPositionFor`, `getFdr`,
`fdrStore`, `fdrExists`, `visibleFdrIdsOf`, `evictMissingFdrs`, `fdrsGone`), and `fdrCallsign`/`fdrType` are
the internal `who` record; `presentation.js` maps them to `callsign`/`type` before anything is sent.

### Tokens the map does not cover (row requests to main, no hand edit)

`docs/wip/RENAME-A/step0-uncovered.txt` (area A/B/C tokens containing a renamed stem that no row matches). Asked
for, all A-class, all structural: `createRoles` (the Position-family field, sibling of the `createsRoles` row),
`registerRoleFamily`, `roleFamilies`, `roleFamily`, `_byRole`, `_byRoleWhere`, `roleBayFor`, `roleNames`, `roleDir`,
`ARRIVAL-role`/`DEPARTURE-role` (test fragments); `conformance-stca` (ticker name; app.js, app-boot test, soak
host-core); `OCCUPANCY`, `also-unoccupied`; `CENTER-held`, `AIC-held`, `held-set`, `actually-held`. Left alone
unless main adds rows. `manned`/`mannedHours`/`perMannedHour` are the metrics' "manned hour" (a staffed-time metric,
a reported field): it needs a decision (W if renamed). Lower-case test locals (`twr`, `gnd`, `twrBays`, `gndOnly`,
`twrOnly`, `gndPushback`) are left for L20 (briefing default).

## Review decisions (step 2)

Files: `docs/wip/RENAME-A/review-N03.tsv`, `-N04`, `-N11`, `-N13`, `-N18` (area A), `review-C-N13.tsv` (area C's
one crc-sync config site). They were made by the classifiers next to them (`classify_small.py` N13+N18,
`classify_n03.py`, `classify_n04.py`, `classify_n11.py`), and their N/Y output was read site by site. Decision classes:

- **N03** (98 Y / 22 N): Y = a Position's staffing, in code, comments and test titles alike (the `unmanned` exact
  row renames the same sentences, so the comments stay consistent). N = airspace occupancy (`airspace-store.js`, the
  airspace family's `occupied` ack field: DES-AIRSP F2), the hot-cargo/alert pad `occupied` flag (a runway-status
  record field, 655 golden occurrences), Marshal stack slots, runway OCCUPANCY (`nla.js:32`, `departure.js:223`).
- **N04 `held`** (102 Y / 101 N): Y = the signed-on Position list: the `held` field of `efsp-set-positions` and
  `efsp-positions-ack`, `setHeldPositions`' `{held, vacated}` result, the coverage list in `position-coverage.js`,
  read-scope's `scopeOf(held)`, the efsp-ws locals that carry them, and every test/harness/soak helper that passes
  the list on (`hold(..., held)`, `ws-hub-coverage`'s `c1:held` grant key). N = English prose in comments and test
  titles (renaming the verb would give "the controller signedOn"), held Strips/codes/contacts/tracks/frequencies
  (`placement.js`, transponder, track-numbers, `facility-schema.js`'s frequency set), HELD.
- **N11** (770 Y / 238 N): Y = `role` in code wherever it is the Strip axis (strip/op/Bay/Block-Map/family `role`,
  locals and params carrying it, the freeze table's `role=` cell labels), a comment's code reference to it
  (`` `role` ``, `.role`, `role:`, `@param … role`), `roles` locals of `createRoles` values (authority/index.js), and
  `Role`/`Roles` inside a validation/refusal message string. N = English prose in comments and test titles
  (`Role` maps to the two-word "strip type"; L20 rewrites those sentences with the glossary), the Casdoor/sourcedcs-web
  role (`position-store.js:7`, `flight-plan-lookup.js:112`), and the refusal `unknown Strip Role: ${role}` (it would
  read "Strip strip type"; left for the reword, a finding). No ARIA or Playwright site exists in area A.
- **N13** (45 Y / 64 N): Y = `coordination.state` / `tofiCoordination.state` values, including where
  `board/coordination.js` and `board/tofi.js` build the record (`state: 'PROPOSED'`) and compare it (`link.state`,
  `tofi.state`, `open.state`), the drop/convert/strip-ops cleanup, forwarding obligations, the soak driver's
  `s.coord.state`. N = Strip state `PROPOSED`, runway-status change `PROPOSED`, the config `impliesState`.
- **N18 part** (9 Y / 26 N): Y = composite ids built from a Position id: test controller ids `c-TWR`/`c-APP`/`c-GND`
  and the freeze trace step names `observer-selects-APP`, `combine-GND+CD`. N = `CV_APP` (carrier), `APP_ATC` (a test
  approach-radar fixture like `APP_RADAR`), `CLIENT_APP` (the app module), and ids in comment/test-title prose.

## Defaults taken (P2)

- `board/ops/carrier-transfer.js` → `carrier-handoff.js` in commit 1: a file named after the N06 Mutation kind that
  BOARD-3 created after prep. Moved now because B and C are cut from commit 1 (paths must agree); reported to main.
- The golden `scenario-field-state.json` was renamed in commit 1, not in the wire commit (§6 places it there). Its
  content is byte-identical, and `freeze-scenarios` derives the golden name from the scenario test file, which §6
  moves in commit 1.
- `heldPositions` promoted to W (above).

## The wire commit's proof that the re-record is a pure rename (S-RENA1)

The question: does every new golden, read back through the inverse of the map, equal the base golden?

Scripts, all in `docs/wip/RENAME-A/inverse/`:
1. `build_inverse.py <base golden dir>` writes `inverse.json`, the inverse of rename-map §7:
   - every `=`/`?` token row and `lit` row as new → old; where two old tokens share a new one, the W row wins (`staffed` → `manned`);
   - the stems reversed (`flightData` → `fdr`, `runwayStatus` → `fieldState`, …), the N18 part rows reversed, and "strip type(s)" → "Role(s)";
   - one declared wording change, "unknown strip type" → "unknown Strip Role" (S-RENA0 (4));
   - the base goldens' own token set: a token the base already had is never rewritten.
2. `inverse-lib.mjs` stands in for `freeze-lib.mjs` in a scratch copy of the renamed crc-sync. It is the base `freeze-lib.mjs` (as `freeze-lib-old.mjs`), with every input of `canonical`, `summarize`, `summarizeCollection`, `summarizeFinalState` and `checkGolden` passed through the inverse first. Record hashes are therefore taken over old-vocabulary records with old key order.
3. `patch_scratch.sh` sends the two raw-text hashes the harness takes outside the library through the same inverse: freeze-world's persisted-snapshot hash and the soak driver's `trafficDigest`. It patches the scratch copy only.
4. In the scratch copy, `UPDATE_GOLDEN=1 node --test tests/freeze/freeze-*.test.mjs` passes 48/48. It writes the goldens in the old vocabulary.
5. `compare_inverse.py <scratch goldens> <base goldens at 8c1347a>` compares them file by file.

Result (`docs/wip/RENAME-A/inverse/result.txt`), 44 files:
- **33 SAME**, byte-identical. This includes every scenario golden but one, all the hub-random and hub-order-keys traces, every table golden but one, and guard-board-surface.
- **8 KEYORDER**, equal once object keys are sorted: the hub-* traces whose connect snapshot `_snapshotView` sorts by key. The harness sorts by the NEW key name (`fieldStates` → `runwayStatuses` moves it after `positionLetters`) before the inverse runs. Every value and hash is equal.
- **1 STRSORT**: `tables-wire-message-types`. Its type lists are sorted by the new names (`efsp-field-state-*` → `efsp-runway-status-*`), so they are equal as sets.
- **2 DIFF**, both explained:
  - `scenario-carrier-l17` lines 1298 and 1344: "a carrier hand-over is recorded" now reads "a carrier handoff is recorded" (N06 `hand-over` → `handoff`). The base goldens already contain the token `handoff` with its own meaning, so the inverse leaves it alone by rule.
  - `tables-nla-coordination-config` lines 26-30: `.v.coveringChain` is absent. This is an artifact of the proof: the renamed harness reads `c.consolidation` from a `canonical()` result, and in the proof `canonical()` has already inverted the key back to `coveringChain`. The same lines' `h` (the digest of the whole facility config) is equal. A direct check also passes: the real new golden's `consolidation` maps, inverted, equal the base `coveringChain` maps on all five lines.

Nothing else differs. The wire commit changes names only, plus the one declared refusal wording.

## Step 5: state check, and the S-RENA2 fix

Setup: a base-build (`470c6d1`) `createEfsp` wrote `state/efsp-board.json` and `efsp-mutations.jsonl`, with OPS signed on and one DEPARTURE Strip. `server.js` from the renamed tree then started on it, on port 3592, in a scratch copy.

Before the fix, at `30396bd`:
- **(a) The Board snapshot loads half-read.** The server boots and serves it. The only sign is one WARN: "restored Strip references a missing FDR … flightDataId=undefined". `fdrs`, Strip `fdrId` and Strip `role` are ignored silently.
- (b) An old `state/efsp-facility-incirlik.json` fails loudly: "missing required key consolidation" (DATA-1).
- (c) An old `state/alerting.json` with `stca` is ignored silently.

S-RENA2 ruling (H88 item 8): an unknown key in a persisted or state file is a loud startup error. The fix is commit `behaviour(RENAME-A): an unknown key …`:
- **The Board snapshot shape:**
  - `PERSISTED_SHAPE` in `src/efsp/stores.js`, next to the restore registry, is one data structure. Its top level is the REGISTRY keys plus `persistedWallAt`.
  - It also covers each store's record keys: Strips with their coordination, TOFI, airspace-entry, handoff and previous-leg objects; flight data with its sections and its flat dotted `provenance`; replay records; airspace, correlation, MARSA, runway-status (pads), carrier (stack entries) and SFA records.
  - `checkPersistedShape` runs in `_restore` before any store restores. It names the file and the key path, and the file stays byte-identical. The pre-WP4A top-level `board` keeps its own, more specific refusal.
  - The lists come from the union of every key persisted across crc-sync `npm test`, `npm run freeze` and `soak:smoke`, collected by a write hook, and were cross-checked against the code that assigns them.
  - Proof it is complete: a hook ran `checkPersistedShape` on every persisted body (12,309) in those three runs, with zero violations.
- **The tuning layers:** `readLayer(name, override, shipped)` refuses a state/ key the shipped file lacks (`_*` keys are free), and `alerting-config` passes `shipped`.
- **Tests:**
  - `efsp-restore-refusal.test.mjs` gains three: the step-5 old-names snapshot, a deep `assigned.releaseState`, and an unknown top-level key, which also pins that the shape's top level equals what `_persist` writes.
  - `tuning-layer-keys.test.mjs` is new: `stca` in a layer, a nested unknown key, a valid partial layer, and the shipped `alerting.json` holding only keys `src/` reads.
- **After the fix:** (a) fails at start-up with `unknown key "boards.INCIRLIK.strips[].fdrId"`, and the file is unchanged (md5 checked). (c) fails with `[tuning] …/state/alerting.json has an unknown key "stca"`.
- **Finding:** `tests/efsp-block-altitude.test.mjs` (the SetBlock-wire test) calls `createEfsp()` with the default paths, so it reads and writes the real `crc-sync/state/efsp-board.json`. On a dev machine that still holds an old-shape file there, this test now fails, correctly. The test should use temp paths (L20 or a test-hygiene lane).

**Deploy note (human):** before starting this build on a server, delete `state/efsp-board.json` and `state/efsp-mutations.jsonl` (clean start, R3-2). Also delete or rename any `state/efsp-facility-*.json` written by an older build, and any `state/alerting.json` that uses `stca`. Each of these now stops start-up and names the file.
