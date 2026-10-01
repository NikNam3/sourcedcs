# BOARD-1 working file

## Report (lane BOARD-1, branch `lane/BOARD-1-facade`, base `b0f273f`)

```
80b0b35 test(BOARD-1): overflight-shared-state-names ALLOWED lists board/placement.js (S-BOARD1-2, approved by main)
a328423 wip(BOARD-1): pattern notes, bump sites, questioner answers, defaults, findings
ffbf288 refactor(BOARD-1): retarget M4 onto SetFlag's bump; two comment pointers follow the moved method names
fc8e16d refactor(BOARD-1): board/placement.js, Placement holds the order keys and the Bays (moved verbatim)
c0114ca test(BOARD-1): board-seam rule 4 exempts exactly 'this._rules = rules;' (S-BOARD1-1, approved by main)
bc51c0b refactor(BOARD-1): board/audit.js, BoardAudit.recordAudit/recordPeer moved verbatim
bf1f294 refactor(BOARD-1): board/board-state.js is the Board kernel (...) with bump/insert
41d1881 refactor(BOARD-1): board/strip-util.js holds deepClone, newFlags, _validateAltitudeBlock, _frequencyFromBlockValue
9bef25b docs(BOARD-1): ADR 0095, EFSP and CRC code structure
630f2f6 docs(BOARD-1): step 0, base counts, code as found, collaborator design
```

- **Suites.** crc-sync: 2092 → 2092, all passing at the end. The base had 3 timing failures, all from load. crc-desktop: 866 → 866, 865 pass and 1 todo. The end run had 1 failure, the INBOUND allow-list, fixed in 80b0b35 and re-run alone. The freeze suite was 47/47 at every commit.
- **Golden:** identical in every structural commit. There is no behaviour commit. `soak:selfcheck`: PASS, every detector fired. `freeze:selfcheck`: 18/18 applied and caught. I retargeted M3, M7 (`board/audit.js`), M6 (`board/placement.js`) and M4 (SetFlag's `bump`). `board-seam` passes strictly on all four `board/*` files.
- **board-store.js:** 3359 → 2861 lines. New files: board-state 142, placement 314, audit 79, strip-util 69.
- **Structure fixture `guard-board-surface.json`:** private-member rows lost `_seq`, `_recordAudit` and `_bayForNewOwner`. They gained `_state` (src, a name collision), `_audit` (src, a name collision) and `_placement` (tests).
- **Outside Owns, both approved by main:** `tests/board-seam.test.mjs` rule 4 exemption (S-BOARD1-1), and `crc-desktop/tests/overflight-shared-state-names.test.js` ALLOWED entry for placement.js (S-BOARD1-2). I also changed the tests `efsp-role-bay-fallback` and `efsp-scenario-tactical-l23`, which reached `_bayForNewOwner`.
- **Defaults taken and findings:** see below. They include the public method names on collaborators, the extra deps (`touch` on BoardState, `rules` on BoardAudit), `bump(strip, null)` at 3 sites, and host-core's `_rebalanceRack` wrap.
- **Supervisor decides:** nothing open.

## Step 0: base check

Base `b0f273f` on `lane/BOARD-1-facade`, installed with `npm ci` in crc-sync, crc-desktop, crc-desktop/app.
Machine load average ~90 during the runs (other agents).

| Suite | Count at base |
|---|---|
| crc-sync `npm test` | 2092 tests, 2089 pass, 3 fail: `efsp-ato-tokenize` "pathological inputs finish fast" (2.99 s budget), `grpc-client-stream` backoff window, `test-reset` "server did not come up". All three are timing tests; re-run alone, test-reset passed and the other two failed again on timing (load avg 88). Load, not code |
| crc-desktop `npm test` | 866 tests, 865 pass, 1 todo |
| freeze suite | 47 / 47 pass, no UPDATE_GOLDEN |
| `board-store.js` | 3359 lines |

## Code as found (by symbol, at `b0f273f`, `crc-sync/src/efsp/board-store.js`)

- Pure helpers: `REPLAY_PERSIST_WINDOW_MS` 48, `_replayRecord` 73, `newFlags` 89, `_validateAltitudeBlock` 99,
  `deepClone` 116, `_frequencyFromBlockValue` 142. Per-Role tables 58-63 (stay; AUTH/BOARD-3).
- Constructor 169-208. Kernel: `currentSeq` 212, `epoch` 214, `getStrip` 215, `getAll` 216, `getRack` 219, `_touch` 225,
  `drainTouched` 238, `_pruneLog` 243, `getDeltaSince` 255, `_nextCid` 330. Kernel writes outside the kernel:
  `archiveStrip` 3290 (delete + `gone` log entry + prune), `restore` 3322 (`_strips`, `_epoch`, `_cidSeq`).
- Order keys: `_resolveOrderKey` 274, `_keyAfterRebalance` 296, `_rebalanceRack` 320, `_appendOrderKey` 1692.
- Audit: `_recordPeer` 347, `_recordAudit` 584. Not in the move: four inline `_mutationLog.record` calls in the facade
  (`receiveCoordinationPeerGone` 2459, `reassignPositionStrips` 3212, `returnCoveredStrips` 3250, `archiveStrip` 3299).
- Placement: `_nlaCtx` 986, `_fieldStateView` 1004, `_placementRack` 1015, `_roleBayFor` 1108,
  `_validateBayImpliedTransition` 1113, `_requireKnownBay` 1178, `_bayFullRefusal` 1210, `_bayForNewOwner` 1706,
  `_relocateForImpliedState` 1739. `setAirborneObserver` 1083 (stays on the facade).
- Placement's reaches back into the facade: `_validateBayImpliedTransition` calls `_rejectedReplicaRefusal` (NLA
  cluster, BOARD-3's) and `getRack`/`getAll`; `_keyAfterRebalance` calls `_rebalanceRack`, which **the soak host wraps**
  (below).
- The four-line block (rev, updatedAt, updatedBy, touch): 32 `rev += 1` sites. 17 are exactly
  `rev += 1; updatedAt = this._clock.now(); updatedBy = by || null; this._touch(strip.stripId)` (884, 962, 979, 1197,
  1340, 1359, 1373, 1424, 1512, 1680, 1783, 2100, 2363, 2409, 2430, 2485, 2952), 3 are the same with
  `updatedBy = null` (2455 `receiveCoordinationPeerGone`, 3207 `reassignPositionStrips`, 3245 `returnCoveredStrips`),
  12 reuse a `now` read earlier (1610 `_applyCarrierTransfer`, 1669 `_applySfaRotation`, 2291, 2336, 2630, 2757,
  2789, 2908, 2994, 3139, 3169, and 3061 with `reusedAt`), and 325 (`_rebalanceRack`) is rev + touch only.
- Inserts (`_strips.set` + `_touch`): create 732, `receiveCoordinationProposal` 2585, `receiveTofiProposal` 3111.

### Private members reached from outside (guard-board-surface.json) and what happens to each

| Member | Reached by | Decision |
|---|---|---|
| `_touch` | tools (host-core.js:112 patches it), src (collision) | kept on the facade as a method (an own-property patch must still shadow it); delegates to `state.recordTouch` |
| `_log` | tools (host-core.js:266/269 `.length`), tests (archiver `.some`), src (comment) | facade getter onto `state.log` |
| `_strips` | tools (host-core.js `.values/.get/.size/.delete`), tests | facade getter onto `state.strips` (the Map itself, so `.delete` works) |
| `_cidSeq` | tools (host-core.js:272) | facade getter onto `state.cidSeq` |
| `_bayForNewOwner` | tests (role-bay-fallback, tactical-l23) | moved to Placement as `bayForNewOwner`; tests reach `board._placement.bayForNewOwner` |
| `_rebalanceRack` | **tools: host-core.js:122 `wrapCause('_rebalanceRack', ...)`** (by string, so guard 2 does not see it) | kept on the facade as a shim delegating to `placement.rebalanceRack`; Placement calls it through a late-bound `rebalanceRack` callback, same pattern as `touch`, so the soak's REBALANCE_SIDE_EFFECT attribution keeps working with no edit to host-core |
| `_recordAudit`, `_seq`, `_dispatch`, `_mutationLog`, `_clock` | src (name collisions with other stores) | `_recordAudit` and `_seq` leave the facade (rows disappear from the fixture, listed); the others stay |
| `_appliedMutations`, `_nlaHistory`, `_retireStrip`, `_droppedWallAt`, `_fdrStore` | tests/tools | untouched (SYNC / BOARD-3) |

## Design (the pattern BOARD-2, BOARD-3 and SYNC copy)

- Collaborators live in `src/efsp/board/`, are constructed by the facade with **one options object of named
  dependencies**, store each as `this._<name>`, and expose **public (non-underscore) methods** — seam rule 2 forbids
  `this._placement._x` from a sibling, so a collaborator's API must be public names. The facade calls
  `this._placement.resolveOrderKey(...)` etc.
- Late-bound callbacks for anything an outside tool may patch on the facade: `touch: (id) => this._touch(id)` and
  `rebalanceRack: (...a) => this._rebalanceRack(...a)`. Also for a method still on the facade that a later lane moves
  (`rejectedReplicaRefusal`, BOARD-3's).
- W1-W2-3 answer: `BoardState` keeps its fields underscored internally (`this._strips` etc. inside its own file is
  `this._x`, allowed) and exposes public read members for collaborators and the facade: `strips` (the Map), `log`,
  `seq`, `epoch`, `cidSeq`, plus `get(id)`, `all()`, `rack(bayId, rackId)`, `recordTouch(id)`, `drainTouched()`,
  `getDeltaSince(seq)`, `nextCid()`, `logGone(id)`, `bump(strip, by)`, `insert(strip)` and restore setters
  (`replaceStrips`, `newEpoch`, `setCidSeq`). Only the facade keeps `_strips`/`_log`/`_cidSeq` getters, for tools/tests.
- `BoardState({ clock, touch })`: `bump`/`insert` must go through the late-bound facade `_touch` or the soak host's
  patch misses them, so BoardState takes the `touch` callback too (briefing said `{ clock }` only).
- `BoardAudit({ rules, clock, mutationLog })`: `recordAudit`/`recordPeer` read `this._rules.facilityId`, so rules is a
  dependency; neither reads `state` nor `_activeCmid` (callers pass `causedBy`), so those are not passed.
- `Placement({ state, rules, clock, fdrStore, touch, rebalanceRack, rejectedReplicaRefusal })`.

## How to copy the pattern (BOARD-2, BOARD-3, SYNC)

1. New file under `src/efsp/board/`, one class, `constructor({ rules, ...deps })`. Put **`rules` first** in the
   destructure: the seam test's rule 4 only treats `{ rules,` as a declaration, and `, rules,` mid-list is flagged.
   Store it with exactly `this._rules = rules;` (the S-BOARD1-1 exemption); read it as `this._rules.X` only.
2. Store each dependency as `this._<name>`. If the moved code called `this._foo(...)` on the facade and `foo` stays on
   the facade (or a tool patches it), pass `foo: (...a) => this._foo(...a)` and store it as `this._foo`: the moved
   body then stays verbatim. Do the same for `touch`, always.
3. Methods become public names (drop the leading `_`); the facade calls `this._<collab>.name(...)`. A sibling
   collaborator is passed in by the facade, never required (seam rule 1); its methods are public, so the call passes
   rule 2.
4. Kernel access: `this._state.get(id)` / `.strips` / `.all()` / `.rack(b, r)` / `.bump(strip, by)` /
   `.insert(strip)` / `.nextCid()`. Never `this._state._x`.
5. Update the tests that reached a moved private (`board._placement.bayForNewOwner`), re-record
   `guard-board-surface.json` with `UPDATE_GOLDEN=1 node --test tests/freeze/freeze-guards.test.mjs`, and list the
   row change. Retarget any M-file whose `find` moved (check with `grep -cF` in both files).

## Bump sites (step 2)

`bump()` replaced 20 blocks: 17 exact (`_applyConvertToArrival`, `_applyApproveAirspaceEntry`,
`_applyClearAirspaceEntry`, `_applyMoveStrip`, `_applySetBlock` ×3, `_applyAnnotationSet`, `_applyTransferStrip`,
`_applySetFlag`, `_applySetState`, `_retireStrip`, `_applyCoordinationReject`, `_applyCoordinationCancel`,
`receiveCoordinationCancel`, `_applyCoordinationStandBy`, `_applyTofiReject`'s else branch) and 3 with
`updatedBy = null` (`receiveCoordinationPeerGone`, `reassignPositionStrips`, `returnCoveredStrips` →
`bump(strip, null)`; `null || null` is `null`, so identical). Kept as written because they reuse a `now` read earlier:
`_applyCarrierTransfer`, `_applySfaRotation`, `_applyCoordinationPropose`, `_applyCoordinationAccept`,
`receiveCoordinationResponse`, `_applyTofiPropose` (×2), `_applyTofiAccept`, `_applyTofiTransferComms`,
`receiveTofiProposal` (`reusedAt`), `receiveTofiExitProposal`, `receiveTofiResponse`. `rebalanceRack` keeps its own
`rev += 1` + touch (no updatedAt). `insert()` at CreateStrip, `receiveCoordinationProposal`, `receiveTofiProposal`.

## Questioner points

- **W1-W2-2 (M6):** M6 moved with Placement and is retargeted to `src/efsp/board/placement.js`. M1, M2, M8, M15 stay in
  `board-store.js` and still match once (M15's `  getDeltaSince(` is now the facade's one-line delegation, and renaming
  it is still caught).
- **W1-W2-3 (BoardState's underscored fields):** settled as recommended. BoardState keeps `_strips` etc. internally
  and exposes public `strips`, `log`, `seq`, `epoch`, `cidSeq`, `get`, `all`, `rack`, `bump`, `insert`, `nextCid`,
  `recordTouch`, `logGone`, `drainTouched`, `getDeltaSince` and the restore setters. No collaborator reads `_x` off
  anything but `this`. `board-seam` passes strictly on all four files.

## Defaults taken (P2)

- The collaborators' methods got public names (`placement.resolveOrderKey`, `audit.recordAudit`), not the briefing's
  `this._placement._x`. Seam rule 2 would flag the underscored form as soon as a sibling (BOARD-2's Coordination) calls
  it.
- BoardState takes `{ clock, touch }` and BoardAudit takes `{ rules, clock, mutationLog }`, not the briefing's
  signatures. See Design.
- The `updatedBy = null` blocks use `bump(strip, null)`. They are value-identical to the exact block.
- CreateStrip uses `insert()` as well as the two replica mints, because its code is the same `set` + touch.
- Two orphaned doc comments (the Bay-implied-transition explainer and the `_nlaCtx` one-liner, which sat before
  `_applyApproveAirspaceEntry`) moved to sit above the methods they describe in `placement.js`. The text is unchanged.
- I asked main for one edit outside Owns, and main approved it as S-BOARD1-1: `tests/board-seam.test.mjs` rule 4
  now exempts exactly `this._rules = rules;`, with three self-tests.

## Findings for other lanes

- `tools/soak/host-core.js:122` wraps `bs._rebalanceRack` by name. The briefing's list next to `_touch` and `_log`
  does not include it. Whoever replaces `_touch` with `observeTouches` (APP/SYNC) should replace this one too, and
  then the facade's `_rebalanceRack` shim and Placement's `rebalanceRack` callback can go.
- Seam-test quirk: in rule 4, `{ a, rules, b }` counts as "rules used as a whole value". `{ rules, a }` does not.
  BOARD-2/3: put `rules` first.
- Four `_mutationLog.record` calls stay inline in the facade: PeerGone, SystemReassign ×2 and Archive. They are not
  `_recordAudit`/`_recordPeer`, so they were not moved. BOARD-2/3 or SYNC could route them through `BoardAudit`.
- Comments in files outside my Owns still name the old private methods: `facility-config.js:438` names
  `_bayForNewOwner`, `permission.js:581` and several tests name `_validateBayImpliedTransition`, and
  `efsp-ws.js:40` names `_pruneLog`. They are L20's to fix.
