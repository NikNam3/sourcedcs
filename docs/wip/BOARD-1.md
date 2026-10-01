# BOARD-1 working file

(Report goes here at the end.)

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

## Defaults taken (P2)

## Findings for other lanes

- `tools/soak/host-core.js:122` wraps `bs._rebalanceRack` by name (not in the briefing's list next to `_touch` and
  `_log`). Whoever replaces `_touch` with `observeTouches` (APP/SYNC) should replace this one too.
