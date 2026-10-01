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
3. **(W5-12: the families' shape is the default, the Board's is `ReplayCache.forBoard()`.)**
   **`src/efsp/sync/replay-cache.js`:** one `ReplayCache({ cap = 5000, kinds = null })`. With `kinds` it is the
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
5. **Superseded by W5-11 / W5-15 (see Rulings): `observeTouches(fn(stripId))` with no context, host-core's
   `_rebalanceRack` wrap kept, `ringLength` instead of `syncLog`.** As first designed: **`observeTouches(fn)` on the facade.** `fn(stripId, { rebalance })`, where `rebalance` is null or the one
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

## Rulings received and how each landed

- **S-SYNC0 Q1** (index.js require, no shim): done in `566c0a3`. Requirers changed: `src/efsp/index.js:51`,
  `tests/efsp-ws-replay.test.mjs`, `tests/wire-skeleton.test.mjs`, `tests/sync-log-characterisation.test.mjs`.
- **S-SYNC0 Q2 / W5-1** (all six counters): one commit per store (`beb86f6` airspace, `3e9f6c0` correlation, `a67422d`
  MARSA, `0e41da2` field state, `02c94a6` carrier, `8a199f8` SFA), each `_seq` -> `this._sync = new SyncLog()` (counter only) and every bump (in `_touch`
  and inline: correlation x2 in `reconcile`, carrier's `setShipState` and quiet stack op) -> `this._sync.advance()`.
  Store tests and freeze green per commit. Three header comments name `_sync seq` instead of `_seq` (pointer only).
- **S-SYNCq2 W5-11** (reverses the `{rebalance}` design): `observeTouches(fn(stripId))` only; host-core keeps its
  by-name `_rebalanceRack`, `reassignPositionStrips` and `receive*` wraps and the facade's `_rebalanceRack` shim.
- **W5-12**: the families' shape is `new ReplayCache()`'s default, kinds read lazily from `wire/families` on first
  use; the Board's is `ReplayCache.forBoard()`.
- **W5-13 = W5-4**: `26459a1`, before step 1, green on the base.
- **W5-14**: `b7a5cbf`. Its diff is the new trace in `freeze-traces.mjs`, the new golden `hub-resync-metrics.json` and
  the one-word addition of `'resync-metrics'` to `TRACE_NAMES` in `freeze-hub.test.mjs` (the runner needs it). The
  metrics store's path resolves under `CRCSYNC_STATE_DIR`, which `host-env.js` sets to the world's temp dir before
  any `src/` require (checked: nothing lands in `crc-sync/state/`).
- **W5-15**: persistence takes `mutationLog: () => this._mutationLog` (late); no public `syncLog` getter, only
  `ringLength`.

## Answers to the questioner (questions-W5.md)

- **W5-1** Done, see above.
- **W5-2** Done: `new SyncLog()` is counter-only; `{ring, touched, epoch}` are opt-in and only `BoardState` turns them
  on; the epoch is `crypto.randomUUID()` looked up at call time (`const crypto = require('crypto')`, property read on
  each call, so `seedIds`' patch applies). Freeze identical at every commit proves the uuid sequence.
- **W5-3** `newEpoch()` changes only the epoch: the seq, the ring and the touched set are kept. Pinned in
  `sync-log-characterisation.test.mjs` ("newEpoch() changes nothing else") and a Board restore keeps `currentSeq`.
- **W5-4** Pinned: 2,001 touches leave 1,000 entries starting at seq 1,002; `gone` takes a seq and is not a touch;
  a delta's first-appearance order with the last entry per id; a resync from exactly 900 behind is a delta and from 901
  a snapshot (`efsp-ws.test.mjs`); both caches' caps. The window now sits next to the prune in `sync-log.js`
  (`canServeDelta`, `RESYNC_RING_WINDOW`, `RING_MAX`, `RING_KEEP`); `efsp-ws.js` re-exports `RESYNC_RING_WINDOW`.
  `tools/soak/report.js:20-21` still copies 2000 and 5000 by hand: Findings.
- **W5-5** One class, one instance per Board plus the families' instance; each shape keeps its keying and its
  null-vs-undefined record; the KINDS throw stays; the Board's lookup stays inside `applyMutation`, so
  `ato/ato-board.js:497`'s per-line cmids (`${cmid}#${lineId}`) still go through it (the ATO tests pass). `has()`
  keeps the Board's unkeyed `Map.has` (a restored `''` key answers `true` as before). The ATO ack cache stays: Findings.
- **W5-6** Used: index.js:51 only; host-core's `_appliedMutations`/`_strips`/`_cidSeq`/`_nlaHistory` reads were not
  changed (the facade keeps `_appliedMutations` and `_droppedWallAt` getters); M13 and M15 did not need retargeting
  (their lines did not move: the resync case line, and the facade's `  getDeltaSince(` delegation).
- **W5-7** The contract as recommended, proven by the new `efsp-board-store` test (one observation per ring `update`
  entry, called after it, rebalance touches attributed through a `_rebalanceRack` wrap, none for an archive).
  `_log` did **not** stay listed in `guard-board-surface.json`: the guard now lists only members BoardStore has.
- **W5-8** As recommended: `BoardPersistence` owns `droppedWallAt` and reads the replay window; StripOps reads
  `() => this._persistence.droppedWallAt`; snapshot key order and record key order unchanged (characterisation test
  and goldens); allow-list `file` changes only; `REPLAY_PERSIST_WINDOW_MS` re-exported by `board-store.js`.
- **W5-9** The new trace covers the metrics report (valid with one bad event, duplicate, not holding, invalid) and
  request (with and without `trafficCount`), a Board replay, a cmid-less Mutation, a family replay and a replay
  refused at the gate, and six resync decisions. The ring prune, the 900 edge and the cap evictions are unit tests.
- **W5-10** The proposal below starts from the client as it is.

## Defaults taken (P2)

- `canServeDelta(current, epoch, lastSeq)` is a pure function in `sync-log.js` taking `{seq, epoch}`; `efsp-ws.js`
  keeps a one-line `_deltaCanServe(boardStore, …)` wrapper (the facade gains no resync method).
- `BoardState` no longer takes a `touch` dependency: `bump`/`insert` call its own `recordTouch` (nothing patches the
  facade any more). Its public API is otherwise unchanged; it gains `observeTouches`.
- The facade keeps private getters `_appliedMutations` (onto the cache's Map), `_droppedWallAt`, `_strips`,
  `_cidSeq` for host-core and tests; `ringLength` is the only new public read.
- The inline `SystemReassign` audit entries in `reassignPositionStrips`/`returnCoveredStrips` and PeerGone's stay
  inline (BOARD-1/3's finding): routing them through `BoardAudit.recordAudit` would change the entry's key order,
  which is output. The `Archive` entry moved verbatim into persistence.
- `familyRecord` keeps `undefined` for absent fields exactly as `replay-cache.js` did; KINDS is read lazily on the
  first keyed `get`/`set` instead of at require time (same set: `wire/families` is static).

## Findings for other lanes

- **After the window (W5-5):** `wire/families/ato.js:24-30` keeps a third idempotency cache (WeakMap per ctx, cap
  200) that stores **whole acks**, not ADR 0081's compact records. It could become a `ReplayCache` with an ATO kind;
  left as is (frozen file).
- `tools/soak/report.js:20-21` copies `logRingMax: 2000` and `appliedMax: 5000` by hand; they could read
  `RING_MAX` (`sync/sync-log.js`) and `APPLIED_MUTATIONS_CAP` (`sync/replay-cache.js`).
- L20 (comments): `board/placement.js` header (still says host-core patches `_touch`), `board/strip-ops.js`'s
  `deps.touch`/`deps.droppedWallAt` JSDoc ("the facade's Map"), and Coordination/Tofi constructor notes describe
  `touch` as the facade's late-bound `_touch`; it is now the kernel's `recordTouch`. `metrics.js:71` names
  `board-store.js APPLIED_MUTATIONS_CAP` (now `sync/replay-cache.js`).
- `peerStripId` is recorded in every Board replay record but never read back (`_replayResult`); harmless.

## Step 7: SYNC-B proposal (queue item 4, H88). Not built.

**What the client does today** (`crc-desktop/app/public/js/panels/efsp/efsp-state.js`; on the ESM branch the same
names become exports): only the Board is tracked: `efspBoardSeqByFacility`/`efspBoardEpochByFacility`, filled by
`applyEfspSnapshot` and `_adoptBoardSeq`, read by `_boardSyncOf`, `efspEpochChangeOf`, `efspHeartbeatGapOf` and
`efspResyncPositionFor`; `efsp-ws.js` sends `efsp-resync` and unwraps `efsp-resync-reply` by `answer`. No client file
reads `airspaceSeq`, `correlationSeq`, `marsaSeq`, `fieldStateSeq`, `carrierSeq` or `sfaSeq`. The family deltas
(`applyEfspAirspaceDelta`, `…CorrelationDelta`, `…MarsaDelta`, `…FieldStateDelta`, the carrier and SFA handlers)
replace records by id; only a full snapshot heals a lost one.

**Server side, per store**, a declaration next to its `stores.js` entry: `sync: { seqKey, epochKey, deltaType }`,
e.g. airspace `{airspaceSeq, airspaceEpoch, efsp-airspace-delta}`. Each store's `SyncLog` turns on `epoch: true`
(one `randomUUID` per store per lifetime: every golden re-records, so this is a `behaviour(SYNC-B)` commit). No store
other than the Board needs a ring: each holds a handful of records (airspaces, one field state per Facility, carriers,
one SFA record, correlations and MARSA relations by FDR), so its resync answer is **its own snapshot slice**, which
keeps §5.6's "two paths" (delta or snapshot) without a second ring. Correlation is the one that could grow (one
record per FDR); it is still bounded by the FDR count, so a snapshot slice is fine at squadron scale.

**On the wire:** every family ack and delta also carries its `epochKey`; the snapshot carries `storeSeqs` and
`storeEpochs` maps (`{airspace: n, …}`). `efsp-resync` gains an optional `stores: {key: {lastSeq, epoch}}`; the reply
(`efsp-resync-reply`, `answer` per store) carries, for each store whose epoch differs or whose seq is behind, its
snapshot slice under the same key the full snapshot uses (`snapshotKey`, WIRE's registry). A family delta's seq
moves by exactly one per change today (`advance()`), unlike the Board's, so a gap **is** detectable from deltas alone
for these stores: a client holding seq n that receives n+2 asks. The condition is that every `advance()` reaches the
client as a delta; SYNC-B must check the bumps made off the wire path (correlation's `reconcile`, driven by the
reconciler tick, and carrier's `setShipState`, driven by the carrier ticker) and either broadcast each one or let the
heartbeat carry the seq. The heartbeat (WIRE-B, per Facility) should then name every store's seq,
not only the Board's, so a lost last delta is caught within two beats; sequence SYNC-B after WIRE-B.

**Client changes that follow** (by module export): `efsp-state.js` gains a `storeSync` map (`seq`, `epoch` per store
key) written by `applyEfspSnapshot` and each `applyEfsp*Delta`, a `storeGapOf(msg)` beside `efspHeartbeatGapOf`, and
`efspResyncPositionFor` returns the `stores` map; `efsp-ws.js` sends it and routes each slice in the reply to the
store's existing snapshot applier. The Board path is unchanged.
