# 0081 — Board sync: one event, one broadcast; a Board epoch; replay records that survive a crash; a rotating code cursor

## Context

L6's soak harness (`crc-sync/tools/soak/`, `docs/wip/L6.md`) runs the real EFSP stores and the real
WsHub on a virtual clock and diffs every client's replica against server truth. It failed, and every
failure was real:

- **F1.** A rebalance re-keys every Strip in a Rack and bumps each one's `rev`. Only the Strip the
  Mutation named went out in the broadcast. Clients held stale order and revs for up to 22 minutes
  (127 stale Strips in four hours). A resync could not heal it either: the broadcast advertised a
  `boardSeq` that already covered the re-keying, so a delta from that seq was empty.
- **F8.** `needsRebalance` was never called. Same-slot inserts grew a key without bound (183
  characters after 400 drags). In traffic, the only rebalance was the one that fires when
  `keyBetween` throws `ORDER_KEY_EXHAUSTED`. That is F1's trigger.
- **F2.** `_seq` and the resync ring are per process, and `restore()` deliberately does not restore
  them. Once a new lifetime's seq overtook a client's, `efsp-resync` served a delta from the wrong
  ring as if it were continuous. Strips dropped before the restart stayed on screen, and Strips
  created were missed. This is latent, because the shipped client never sends `efsp-resync`
  (briefing §3.10).
- **F5.** `_appliedMutations` was not persisted. A CreateStrip whose ack died with the process was
  created twice on retry (mode A). A crash inside `_persist`, after the audit line was written and
  before the snapshot was, left an audit line for a change the restored Board did not have. The
  retry then wrote a second one (mode B).
- **F11 / F4.** The cache stored whole results. A success held the **live** Strip, so archiving could
  not free it. A refusal held a clone from the time of refusal, so replaying it sent the client's
  replica backwards.
- **F13.** The airspace, correlation, MARSA and field-state paths had no idempotency at all. A
  retried `DeclareMarsa` minted a second relation.
- **F6.** `CodeAllocator.allocate()` took the lowest free code. A landed flight released its code,
  and the next flight got it while the old aircraft was still squawking it. Correlation bound the new
  FDR to the old track 46 times in four hours.

Separately, L24's profile showed `_persist` pretty-printing the whole snapshot on every Mutation, at
40% of self-time in the four-hour soak (decisions.md S-L24).

## Decision

### One Board event, one broadcast

`BoardStore._touch` also adds the id to `_touchedSinceDrain`. The new `drainTouched()` returns and
forgets those ids. Whoever puts a Board's change on the wire drains it. `_handleMutation` builds
`strips.updated`/`strips.gone` from the drain: the addressed Strip first, then every other touched
Strip, each looked up and stamped with `_stampStrip`, with DROPPED Strips going into `gone`.
`peerBroadcast` is built the same way from the peer Board's drain, because a coordination replica
placed in a peer's coordination Bay can rebalance that Rack. A peer Board is drained only when its
broadcast is built, so nothing it touched is thrown away. A refusal touches nothing. If one ever did
(an exception part-way through an op), what it touched is broadcast rather than dropped.
`_handleSetPositions` already re-sends every live Strip. It drains so that those touches do not ride
on the next Mutation.

A rebalance gets **no audit line of its own** (L27-Q6 (a)). It is part of the Mutation that caused
it, and that Mutation is audited.

### The proactive rebalance

`_resolveOrderKey` rebalances the Rack once a freshly computed key is longer than
`REBALANCE_KEY_LENGTH` (40). It then recomputes the key between the named neighbours' fresh keys,
using the same `a > b` normalisation the exhaustion path uses. This happens inside the same Board
event, so the re-keyed Strips leave through the rule above. The threshold is a **placeholder, not
researched**. It is left at 40 because the soak gates on it. After the change the probe's longest key
is 40 at 400 pairs.

### A Board epoch

`BoardStore` mints `epoch = crypto.randomUUID()` in its constructor and again in `restore()`. It is
never persisted. A new process is a new lifetime even when it restores the same snapshot, because the
ring did not come back. On the wire:

- `efsp-snapshot` carries `boardEpochByFacility` beside `boardSeqByFacility`;
- **every** `efsp-board-delta` carries `boardEpoch`. That covers the Mutation broadcast,
  `peerBroadcast`, the MARSA FDR-only delta, `efsp-set-positions`, the resync delta and
  `ws-hub.js`'s `broadcastEfspBoardDelta`. The last one serves the NLA-status monitor and L24's
  archiver, and it stamps the Board's current epoch unless its caller already did;
- the mutation ack carries `boardEpoch` beside `boardSeq`;
- `efsp-resync` accepts an optional `boardEpoch`.

`_handleResync` is now three steps: resolve the Board, decide between delta and snapshot, then build
the answer. A delta is served only when the client's epoch equals the Board's current one **and** the
seq is inside the window **and** it is not ahead of the server. The `rewound` check stays because it
is cheap and still true. A missing or different epoch gets the snapshot, which is §5.6's other path
and always safe. The shipped client never resyncs, so it needs no change (L27-Q5 (a)). A future client
that resyncs sends the epoch it last read.

`getDeltaSince` also returns `gone`: ids the window touched that are no longer in `_strips` at all.
This is empty until retention removes records (L24). `_handleResync` sends
`gone: [...DROPPED still on the Board, ...delta.gone]`, which are disjoint by construction.

### Replay records, persisted for ten minutes, and the NotPersisted marker

`_appliedMutations` holds a compact, frozen record per clientMutationId:
`{ ok, reason, detail, warning, routedTo, selfCoordinated, stripId, fdrId, peerFacilityId, peerStripId, appliedWallAt }`.
It holds nothing live and nothing cloned. A replay rebuilds the result from the Board as it is now:
the original outcome, `strip: getStrip(stripId)` and `fdr: getFdr(fdrId)`, with `replayed: true`.
`_handleMutation` acks a replay and does nothing else: no persist and no broadcast, because those went
out the first time. `marsaChanged`, `fdrs` and `peerStrip` are not rebuilt. A Mutation without a
clientMutationId is never cached. (Before this change every cmid-less Mutation after the first was
answered from the entry cached under `undefined`.)

`BoardStore.snapshot()` carries `replay`: the records applied within the last
`REPLAY_PERSIST_WINDOW_MS` (**10 minutes of wall time**, `[SOURCE-DEFINED]`, a constant rather than a
tuning value). This is a retry window, not a history. `restore()` loads them all. The snapshot already
cut them to the window, and the boot reconcile needs every persisted record. A retry after a restart
is then answered from the cache (mode A). `appliedWallAt` is `Date.now()`, the same kind of exception
to ADR 0079 as the NLA latch: a storage lifetime, never a time a controller reads.

`_persist` writes `persistedWallAt`. At boot, after `_reconcileRestored`, `_reconcileLogTail` reads
the log from `persistedWallAt − 60 s`. Every successful Board line with a clientMutationId that no
Board's restored window holds was never persisted. For each one it appends:

```js
{ op: 'NotPersisted', clientMutationId, stripId, voids: <that line's op>,
  reason: 'CRASH_BEFORE_PERSIST', actorId: 'system', actingPositionId: null, at: <mission time> }
```

A line that an earlier boot has already marked is not marked again. The log stays **append-only**:
nothing is deleted or rewritten. The consequence for readers is that **a `NotPersisted` marker voids
the earlier line with the same clientMutationId**. The retry then applies the Mutation and writes the
one line that took effect (mode B). Readers updated:

- the traffic count voids the COUNT a marked drop made. It does this live in `_onLogEntry` and, at
  boot, by replaying the markers in `reconcile({ backfill })`, because the markers are written before
  the count subscribes to the log. `expectedFromLog` drops the marked drop. The retried drop carries
  the same clientMutationId and therefore the same countId, so a COUNT written **after** a VOID of its
  countId revives it (`liveCountRecords` and `_index` now read in file order);
- the soak ledger and its R2 classifier count a marker and the line it voids as none.

`_handleSetPositions` now persists when it reassigned Strips down the covering chain. That was the one
Board change never written.

The audit line is still written before the snapshot. L27-Q2 (c), auditing after persist, was
rejected because a crash between the two would lose a line.

### The non-Board replay cache

`src/efsp/replay-cache.js` is pure and memory only (L27-Q3 (a)). It keeps compact frozen
`{ ok, reason, detail, warning, id }` records per kind (`airspace | correlation | marsa | fieldState`),
capped at 5000 with insertion-order eviction. The four handlers consult it after their own session
and class gates and before their store. A hit is answered with the original outcome and the store's
current record, with no store call, audit, persist or broadcast. A refusal made before the store
(`NOT_HOLDING_POSITION`, a class `PERMISSION_DENIED`, a missing store) is never cached, so a retry
after taking the Position goes through. The stores' own `apply()` is unchanged.

### A rotating code cursor

`allocate()` scans from the code after the last one it handed out and wraps past 7777, with the same
exclusions (reserved codes, 4000, and the synthetic 6000–6777 block). A released code comes back only
after the whole free discrete pool has cycled, which is thousands of flights at H12's scale. There is
no clock and no tuning file. The cursor is persisted as `codeCursor` in the FDR snapshot. A snapshot
without one starts at 0000. `validateAssignment`, `reassign` and `reacquireFdr` are unchanged.

### Persist cost (S-L24)

`_persist` writes compact JSON. It also skips the write when the serialised body equals the last one
it successfully wrote, and `persistedWallAt` then stays the time of the write that is on disk. Every
Board change is still written **synchronously, before its ack leaves**. A debounced or batched write
was rejected: it would let an acknowledged change die with the process, and the NotPersisted marker
would then contradict an ack the client had already received. On the four-hour snapshot (435 KB),
serialising takes 17.3 ms pretty-printed and 7.3 ms compact on the same machine.

## Alternatives considered

- **Special-casing the rebalance** by returning `rebalanced` ids on the result. This was rejected
  because it would leave every other side effect behind it (a peer placement, a future one) to be
  found the same way. Collecting touches covers them all.
- **Persisting `_seq` and the ring** instead of naming the lifetime. The ring is a cache of recent
  changes. Persisting it on every Mutation costs a write for a feature the client does not use yet,
  and an epoch is one string.
- **Cloning the Strip at replay time** (L27-Q1 (b)). This fixes F11 only, leaves F4 to a second edit
  of the same function in the same wave, and is not serialisable for F5.
- **A persisted replay window only** (L27-Q2 (b)). This leaves mode B's two audit lines for one
  change as a documented gap.
- **A quarantine on released codes** (L27-Q4 (b)). This needs a clock and a tuning value. Least
  recently released first (c) needs per-code history. The cursor needs neither.

## Consequences

- **ADR 0002** (a durable Board): the snapshot now also carries the replay window and
  `persistedWallAt`, and the FDR snapshot carries `codeCursor`. The snapshot file is compact JSON. The
  Mutation log gains a system-written `NotPersisted` entry. It is still append-only, but "every line is
  a change that happened" no longer holds without reading the markers.
- **ADR 0004** (immediate broadcast): a Mutation's broadcast carries every Strip it touched, on its
  own Board and on the peer Board, not only the one it named. A replay broadcasts nothing.
- **ADR 0006** (the two resync paths): still two paths, but a delta now also requires the current
  Board epoch. Without it the answer is a snapshot.
- **Guide §5.2** (idempotency): holds across a restart for ten minutes, and on every dispatch path,
  not only the Board's. A replay's ack carries the current record, not the one at the time.
- **Guide §5.4** ("a rebalance is one Board event"): now true on the wire as well as in the store.
- **Guide §5.6**: the delta path is scoped to one Board lifetime.
- The soak's sync checks pass. `silentStaleness`, `resyncDivergence`, `acrossRestartDivergence`, R2
  and `misbinding` are all 0 in the default, 240-minute and stress runs (see `docs/wip/L27.md`).
- The last serialised snapshot body is held in memory for the dirty check. It is bounded by the
  snapshot size, which L24's retention bounds.
