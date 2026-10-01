# SYNC working file

## Report

(written at the end)

## Step 0: base check

Base `2b055d4` on `lane/SYNC-one-mechanism`, installed with `npm ci` in crc-sync, crc-desktop, crc-desktop/app.
Load average ~45-65 (other agents).

| Suite | Count at base |
|---|---|
| crc-sync `npm test` | 2143 tests, 2142 pass, 0 fail, 1 todo |
| crc-desktop `npm test` | 866 tests, 865 pass, 1 todo |
| freeze suite | 47 / 47 pass, no UPDATE_GOLDEN |

## Code as found (by symbol, at `2b055d4`)

### Sequences, rings, epochs

| Where | What | Exact semantics |
|---|---|---|
| `board/board-state.js` `BoardState` constructor | `_seq = 0`, `_log = []`, `_epoch = crypto.randomUUID()`, `_touchedSinceDrain = new Set()` | The epoch is minted **in the constructor**, after `_strips`, `_log`, `_seq` and before `_cidSeq`. `crypto.randomUUID` is seeded by the soak/freeze host (`host-env.js` `seedIds`), so **the number and order of `randomUUID` calls is golden-visible**: one per Board construction, one per `restore()`, nothing else from the sync mechanism |
| `BoardState.recordTouch(id)` | `_log.push({seq: ++_seq, type:'update', id})`, add to touched, `_pruneLog()` | the facade's `_touch` calls it; everything else (bump, insert, Placement/Coordination/Tofi/StripOps `touch`) goes through the facade's late-bound `_touch` |
| `BoardState.logGone(id)` | `_log.push({seq: ++_seq, type:'gone', id})`, `_pruneLog()` | **not** added to the touched set (archive is not a touch) |
| `BoardState._pruneLog()` | `if (_log.length > 2000) _log.splice(0, _log.length - 1000)` | prune sizes 2,000 / 1,000 |
| `BoardState.getDeltaSince(after)` | walks `_log` back to the first `seq <= after`, last entry per id wins (Map insertion = first appearance order in the window), `updated` = still in `_strips`, `gone` = not | returns `{updated, gone, seq: _seq}` |
| `BoardState.drainTouched()` | ids in first-touch order, then clear | called by efsp-ws.js (and the ATO family) only |
| `BoardState.newEpoch()` | `crypto.randomUUID()` | called by the facade's `restore()` only; the epoch is never persisted |
| `efsp-ws.js` `RESYNC_RING_WINDOW = 900`, `_deltaCanServe(board, epoch, lastSeq)` | epoch mismatch -> no; `lastSeq < 0` -> no; `lastSeq > currentSeq` -> no (rewound); else `currentSeq - lastSeq <= 900` | `_resyncAnswer`: unknown Board -> snapshot; owned read scope -> snapshot; then the decision; then the delta (DROPPED -> `gone`, then `delta.gone`) |
| `board-store.js` facade | `currentSeq`, `epoch`, `drainTouched`, `getDeltaSince` delegate; `_touch` method (host-core patches it), `_log`/`_strips`/`_cidSeq` getters | `_touch` row in `guard-board-surface.json`: usedBy `src` (name collision with other stores' `_touch`) and `tools` |
| `airspace-store.js` | `_seq = 0` (constructor), `+= 1` in `_touch(record, by, transition)` only, `currentSeq` getter | sent as `airspaceSeq` by `wire/families/airspace.js` (ack and delta); not persisted, no ring, no epoch, no `restore` effect |
| `correlation-store.js` | `_seq` + `currentSeq`; `+= 1` in `_touch` (182) **and twice inline** in `reconcile` (388, 420: rev/updatedAt/seq without a transition) | `correlationSeq` (wire/families/correlation.js) |
| `marsa-store.js` | `_seq` 116, `+= 1` in `_touch` 196 | `marsaSeq` (wire/frames.js `marsaDelta`) |
| `field-state-store.js` | `_seq` 77, `+= 1` in `_touch` 223 | `fieldStateSeq` (wire family, and `app.js` 339 on the wind tick) |
| `carrier-store.js` | `_seq` 64, `+= 1` at 198 (`_touch`), 229, and inline at 347 (`quiet` path) | `carrierSeq` (wire family carrier.js, frames.js `carrierDelta`) |
| `sfa-store.js` | `_seq` 49, `+= 1` at 148 | `sfaSeq` (frames.js `sfaDelta`, family sfa.js) |

Only the Board has a ring, an epoch and a touched set. The six other stores keep a bare counter that the client
receives but cannot resync from (queue item 4, SYNC-B).

### Idempotency maps

| Where | Key | Record | Cap / eviction | Persisted | When consulted / written |
|---|---|---|---|---|---|
| `board-store.js` `_appliedMutations` (Map) | `cmid` | `_replayRecord(result, Date.now())`: frozen `{ok, reason, detail, warning, routedTo, selfCoordinated, stripId, fdrId, peerFacilityId, peerStripId, appliedWallAt}`, `undefined` -> `null` | `APPLIED_MUTATIONS_CAP = 5000`: `set`, then if `size > 5000` delete the first key | **yes**: `snapshot()` writes `replay: [[cmid, record]...]` for `appliedWallAt >= Date.now() - REPLAY_PERSIST_WINDOW_MS` (10 min), in Map order; `restore()` loads **every** pair with a string cmid and an object record as `Object.freeze({...record})`, no cap, no window | `applyMutation`: **before** everything (before dispatch, before any gate inside the Board) when `cmid` is a non-empty string; written after dispatch for every keyed Mutation, ok or refused, also after an internal error. A cmid-less Mutation is never cached. `hasApplied(cmid)` for index.js's boot reconcile (`_reconcileLogTail`) |
| `board-store.js` `_replayResult(record)` | | `{ok, replayed:true}` + non-null `reason, detail, warning, routedTo, selfCoordinated, peerFacilityId`, `strip` = getStrip(stripId) now, `fdr` = fdrStore.getFdr(fdrId) now | | | `peerStripId` is recorded but never read back |
| `replay-cache.js` `ReplayCache` (one per `createEfsp`, `ctx.replayCache`, index.js 290) | `` `${kind}|${cmid}` ``; `kind` must be in `KINDS` = `wire/families` `REPLAY_KINDS` (airspace, correlation, marsa, fieldState, carrier, sfa), else **throws** | frozen `{ok: !!ok, reason, detail, warning (undefined kept undefined), id (undefined -> null)}` | `REPLAY_CACHE_CAP = 5000`, same set-then-evict-first | **no** (memory only, S-W3d) | `wire/skeleton.js` `run`: consulted **after** the store lookup, the session gate and `permit` (so a refusal at the gate is never cached and a replay is re-gated); a non-string/empty cmid is never cached and `get` returns `null` before the kind check. Written after `apply` for ok and refused |
| `wire/families/ato.js` `_atoAckCaches` (WeakMap ctx -> Map) | `cmid` | the first full ack | 200, same eviction | no | ATO mutation only. **Frozen file** (wire/families); left alone, listed |
| `metrics.js` `_reports` / `seenMutations` (BoundedSet) | reportId / cmid | presence | 5000 | no | dedupe of metrics input, not a replay answer; not an idempotency cache in this sense, left alone |

### The touch patch and other reaches

- `tools/soak/host-core.js` 110-128: per Board, replaces `bs._touch` with a wrapper that pushes `{fid, id, cause}`
  (`cause` = top of `causeStack`); wraps by name `_rebalanceRack` (cause `REBALANCE_SIDE_EFFECT`, plus
  `stats.rebalances++` and `stats.rebalancedStrips += getRack(bay, rack) minus excl` computed **before** the
  rebalance), `reassignPositionStrips` (`SYSTEM_REASSIGN`), and the five `receive*` (`PEER_REPLICA`).
- host-core reads `bs._log.length` (208, 211), `bs._appliedMutations.size` (209, 212), `bs._strips`, `bs._nlaHistory`,
  `bs._cidSeq`. My Owns there: the touch observer and the `_log` reads.
- tests: `efsp-archiver` reads `b._log.some(...)` and `_appliedMutations`; `efsp-board-store` 1146 reads
  `_appliedMutations`; `efsp-crash-replay` imports `REPLAY_PERSIST_WINDOW_MS` from board-store.js; `efsp-ws` imports
  `RESYNC_RING_WINDOW` from efsp-ws.js; `efsp-ws-replay` and `wire-skeleton` import `ReplayCache` from
  `src/efsp/replay-cache.js`.
- Facade regions SYNC owns: `applyMutation`'s idempotency lines, `hasApplied`, `_rememberApplied`, `_replayResult`,
  `reassignPositionStrips`/`returnCoveredStrips` (inline `SystemReassign` log entries), `droppedWallAtOf`,
  `archiveStrip` (inline `Archive` entry), `snapshot`, `restore`.
- Clock-policy allow-list rows in my region: `board-store.js` `applyMutation`, `droppedWallAtOf`, `snapshot`,
  `restore` (all `Date.now()`, wall, kept as wall by TIME-B).
- Selfcheck: M8 targets `const REPLAY_PERSIST_WINDOW_MS = 10 * 60 * 1000;` in board-store.js; M15 `  getDeltaSince(`
  in board-store.js (the facade delegation, which stays); M13 the resync case line in efsp-ws.js (stays).
- S-WIREfix: the hub goldens send `efsp-resync` (op-matrix, walk-tactical, crash-replay, monitors) but never an
  `efsp-metrics-report` or `efsp-metrics-request`.

## Design

1. **`src/efsp/sync/sync-log.js` `SyncLog({ ring = false, epoch = false })`.** One implementation of: `seq`;
   `advance()` (seq + 1, for a store without a ring: airspace); `touch(id)` (ring entry `update` + touched set +
   prune + observers); `gone(id)` (ring entry `gone` + prune); `drainTouched()`; `deltaSince(after, lookup)`
   (the exact walk above, `lookup(id)` returns the record or undefined); `epoch` + `newEpoch()` (minted in the
   constructor only when `epoch: true`, so no extra `randomUUID` call anywhere); `observeTouches(fn)` (returns an
   unsubscribe). Constants `RING_MAX = 2000`, `RING_KEEP = 1000`, `RESYNC_RING_WINDOW = 900`, and a pure
   `deltaCanServe({seq, epoch}, clientEpoch, lastSeq)` that efsp-ws.js calls (it re-exports `RESYNC_RING_WINDOW`).
   `BoardState` owns one `SyncLog({ ring: true, epoch: true })` constructed where `_seq/_log/_epoch` are today,
   and keeps its public API (`seq`, `epoch`, `log`, `recordTouch`, `logGone`, `drainTouched`, `getDeltaSince`,
   `newEpoch`) as delegations, so no frozen collaborator changes.
2. **Airspace store:** `_seq` becomes `this._sync = new SyncLog()`; `_touch` calls `this._sync.advance()`;
   `currentSeq` returns `this._sync.seq`. Same values (no ring, no epoch, no `randomUUID`). The five other bare
   counters (correlation, marsa, field-state, carrier, sfa) are **not in my Owns**: asked main (below); default
   while waiting: airspace only, the other five listed for SYNC-B.
3. **`src/efsp/sync/replay-cache.js`:** one `ReplayCache({ cap = 5000, kinds = null })`. With `kinds` it is the
   families' cache (key `kind|cmid`, unknown kind throws, `set` compacts to `{ok, reason, detail, warning, id}`
   exactly as today: the skeleton calls it unchanged). Without `kinds` it is a Board's cache (key `cmid`; `set`
   stores the frozen record the caller built). Shared: the keyed test (non-empty string), set-then-evict-first at
   the cap, `get`/`has`/`size`, `entries()`, `windowSince(horizon)` (records with `appliedWallAt >= horizon`, in Map
   order) and `load(pairs)` (fresh Map, no cap, string cmid + object record, frozen copy). Also exported:
   `replayRecord(result, appliedWallAt)` (= `_replayRecord`), `APPLIED_MUTATIONS_CAP`, `REPLAY_CACHE_CAP`,
   `REPLAY_PERSIST_WINDOW_MS` (with its comment; M8 retargets here). `Date.now()` stays in `applyMutation` (and
   moves with `snapshot`/`restore` to persistence.js; allow-list `file` changes only). The facade keeps an
   `_appliedMutations` getter onto the cache's Map (host-core, two tests: not my region of host-core).
   `src/efsp/replay-cache.js` is deleted; index.js's one `require` line needs to point at `./sync/replay-cache`
   (asked main: index.js is frozen for me).
4. **`board/persistence.js` `BoardPersistence({ rules, state, replay, clock, mutationLog, nlaHistory })`:**
   `snapshot()`, `restore(data)`, `archiveStrip(...)`, `droppedWallAtOf(id)`, owns the `droppedWallAt` Map
   (StripOps' late `droppedWallAt` accessor reads `persistence.droppedWallAt`). Moved verbatim; the facade keeps
   one-line delegations (public API unchanged). `reassignPositionStrips`/`returnCoveredStrips` stay on the facade
   (Position lifecycle, not persistence); their inline `SystemReassign` entries stay inline (a route through
   BoardAudit would change the entry's key order: not structural).
5. **`observeTouches(fn)` on the facade.** `fn(stripId, { rebalance })`, where `rebalance` is null or the one
   `{ bayId, rackId, excludeStripId }` object of the rebalance running (the facade sets it around
   `placement.rebalanceRack`, through the callback Placement already calls). The collaborators' `touch` callback
   binds straight to the kernel (`state.recordTouch`), the facade's `_touch` method and `_log` getter go, and
   `get syncLog()` (public, read-only use: `.ringLength`, `.ring`) replaces `_log` for host-core and the archiver
   test. host-core: one `observeTouches` per Board replaces both the `_touch` patch and the `_rebalanceRack` wrap
   (cause `REBALANCE_SIDE_EFFECT` when `rebalance` is set, else the cause stack's top; `stats.rebalances` counts
   distinct rebalance objects, `rebalancedStrips` counts touches with one: identical, since a rebalance of an empty
   Rack is unreachable: `keyBetween(null, null)` is never exhausted nor long). The `receive*` and
   `reassignPositionStrips` wraps stay (public methods). `guard-board-surface.json` updated.
6. M8 retargeted to `src/efsp/sync/replay-cache.js`.
7. The SYNC-B proposal: half a page at the end of this file. Not built.
8. S-WIREfix: a new hub trace `resync-metrics` (an `efsp-metrics-report`, an `efsp-metrics-request`, and resyncs:
   delta, epoch mismatch, rewound, too old) with its own golden, in a `test(SYNC)` commit before the moves.

## Questions to main (P2 defaults in brackets)

- Q1: index.js `require('./replay-cache')` -> `require('./sync/replay-cache')`, one line outside Owns. [Ask; if
  refused, keep `src/efsp/replay-cache.js` as a one-line re-export.]
- Q2: the five other stores' counters on a `SyncLog` (`advance()`), 3-5 lines each in files outside Owns
  (correlation, marsa, field-state, carrier, sfa). [Airspace only; the five listed for SYNC-B.]

## Defaults taken (P2)

(filled as I go)

## Findings for other lanes

(filled as I go)
