# SYNC-B: epoch and resync for every store, not only the Board (lanes SYNC-B-S and SYNC-B-C)

> Read `README.md` in this folder, `docs/parallel/refactor/README.md` (conventions, **Test policy**) and
> `docs/parallel/lane-rules.md` first. Rulings: decisions.md **H88** (queue item 4: "extend epoch + delta resync to
> every store", SYNC-B after W5, a wire change per store), ADR **0081** (Board sync), ADR **0104** (WIRE-B's heartbeat;
> it reserved the `stores` key), **R3-47** (no resync on reconnect: the connect snapshot is the recovery), S-UIB (the
> client's resync triggers, at most one in flight). **The design is `docs/wip/SYNC.md` "Step 7: SYNC-B proposal"**
> (read all of it; this briefing turns it into two lanes and settles its open points). VERSION's protocol rule applies
> (`npm run wire:record`).

| | SYNC-B-S (server) | SYNC-B-C (client) |
|---|---|---|
| Wave | C | C, cut from SYNC-B-S's **wire commit** (step 3) |
| Starts after | **WIRE-B**, **AIRSP-2S-A** (rewrites the airspace store and its snapshot) and **UNDO-S** (edits `carrier-store.js` and `marsa-store.js`) have merged | SYNC-B-S's wire commit; BRIDGE and ESM-GUARDS merged |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-SYNC-B-S` on `lane/SYNC-B-S-store-resync` | `/home/nklx/dev/personal/sourcedcs-SYNC-B-C` on `lane/SYNC-B-C-store-resync-client` |
| ADR | **0105** "every store resyncs" (new; S writes it) | none (0105) |
| Size / model | 1 lane / Sonnet 5.5 | 0.75 lane / Sonnet 5.5 |
| E2E lane | none | `E2E_LANE=4` (MAPKEY's, free by then): a new `store-resync.spec.js` and `ui-b-resync` |
| Merge | S, then C right after it. The protocol bump lands with S, so a release needs both | |

## Code as found (from SYNC.md step 0; re-find on your base, it moves with 2S-A and UNDO-S)

- `sync/sync-log.js` (`SyncLog`): counter-only by default. Only `BoardState` turns on ring, touched and epoch.
- The six other stores count through it: airspace, correlation, MARSA, runway status (field state in SYNC.md's
  words), carrier and SFA.
  - Each sends its seq on its ack and delta: `airspaceSeq`, `correlationSeq`, `marsaSeq`, `runwayStatusSeq` (named
    `fieldStateSeq` in SYNC.md, before W7), `carrierSeq`, `sfaSeq`.
  - None has an epoch.
  - The client reads none of them. A lost family delta heals only on the next full snapshot, which means a reconnect.
- Off-wire bumps (SYNC.md): correlation `reconcile` (reconciler tick, two inline bumps) and carrier `setShipState`
  (carrier ticker, the `quiet` path). Each advances seq without a delta reaching the client.
- Client: `efsp-state.js` tracks only Board seq/epoch per Facility. The family appliers (`applyEfspAirspaceDelta`,
  `…CorrelationDelta`, `…MarsaDelta`, runway status, carrier, SFA) replace records by id.

## Goal

A client that misses one delta of any store notices within two heartbeats, or at once on an epoch change, and gets
that store's current state back without a reconnect and without the whole snapshot.

## Design (SYNC.md's proposal, settled)

- **Per store, one declaration** next to its entry in `stores.js`: `sync: { key, seqKey, epochKey, deltaType }`, for
  example airspace `{ key: 'airspace', seqKey: 'airspaceSeq', epochKey: 'airspaceEpoch', deltaType:
  'efsp-airspace-delta' }`. `key` is the store's `snapshotKey` in WIRE's registry.
- **Epoch**: each of the six stores' `SyncLog` turns on `epoch: true` (one `randomUUID` per store per lifetime). It is
  not persisted, like the Board's.
- **No ring** for these stores. Each holds a handful of records, so the resync answer is the store's own **snapshot
  slice**, under the same key the full snapshot uses. Correlation is bounded by the flight-data count, which is fine
  at squadron scale (H12: up to 20 aircraft).
- **Wire**:
  - every family ack and delta also carries its `epochKey`;
  - the snapshot carries `storeSeqs` and `storeEpochs` (`{ airspace: n, … }`);
  - the heartbeat gains `stores: { [key]: { seq, epoch } }` beside WIRE-B's `boards`, filtered by read scope as the
    family deltas are (correlation and MARSA have `family.filter`; mirror it);
  - `efsp-resync` gains an optional `stores: { [key]: { lastSeq, epoch } }`;
  - `efsp-resync-reply` returns, per store whose epoch differs or whose seq is behind, its snapshot slice under
    `stores[key]`. The Board's `answer` path is unchanged.
- **Off-wire bumps**: every `advance()` that does not produce a delta is either broadcast as one, or relies on the
  heartbeat's seq to trigger the resync. Default: **rely on the heartbeat** for the reconciler and carrier-tick
  paths. A client then sees "behind" and resyncs that slice, which costs one slice per change on a ticker. If step 0
  measures that as more than about one resync per minute in the soak profile, broadcast instead and say so.
- **Gap detection from deltas**: a family delta moves seq by exactly one per change (unlike the Board's), so a client
  holding n that receives n+2 asks at once. Only when every advance reaches the client as a delta, or the store is
  marked `gapFromDeltas: false` (correlation and carrier, unless you broadcast their off-wire bumps).

## SYNC-B-S owns

- `crc-sync/src/efsp/stores.js` (the six `sync` declarations), `sync/sync-log.js` (if the epoch option needs work).
- The six stores' constructors (the `SyncLog` option line only) and their off-wire bump sites, if broadcasting.
- `wire/skeleton.js` and `wire/families/*.js` (`epochKey` on ack and delta).
- `efsp-ws.js` (`_snapshotMessage` `storeSeqs`/`storeEpochs`, `_resyncAnswer` `stores`).
- `ws-hub.js` (`_tick`'s heartbeat `stores`).
- `tools/soak/shadow.js` and `driver.js`: track and check store seqs, so the soak proves no store stays stale. Add a
  `store-stale` detector and its selfcheck case, if the soak's structure makes that a small change; otherwise list it.
- Tests: `tests/store-resync-*.test.mjs`, plus updates to wire and family tests.
- `wire-surface.json` and the protocol bump.
- `docs/adr/0105-…md`, `docs/wip/SYNC-B-S.md`.

## SYNC-B-C owns

- `crc-desktop/app/public/js/panels/efsp/efsp-state.js`:
  - a `storeSync` map (`seq`, `epoch` per key), written by `applyEfspSnapshot` and each family applier;
  - `storeGapOf(msg)`, beside `efspHeartbeatGapOf`;
  - `efspResyncPositionFor` returns `stores`.
- `efsp-ws.js`: sends `stores` and routes each slice of the reply to that store's existing snapshot applier.
- The family appliers' seq/epoch adoption lines (one per applier module).
- `tests/efsp-store-resync*.test.mjs`, new `e2e/store-resync.spec.js`. Use the test-reset hook to drop one airspace
  delta to one client, then assert the panel heals within two heartbeats without a reconnect.
- `docs/wip/SYNC-B-C.md`.

## Frozen for both

- The Board's resync path (`_deltaCanServe`, `RESYNC_RING_WINDOW`).
- The stores' business logic.
- Everything client-side that is not listed.

## Steps (S)

0. Step 0 per the refactor README:
   - the six stores' seq sites after 2S-A and UNDO-S;
   - each family's ack and delta builder and filter;
   - the off-wire bumps;
   - the resync reply shape;
   - the soak's per-Facility shadow;
   - a soak smoke measurement of how often each off-wire path advances.
1. ADR 0105.
2. Declarations, epochs, `epochKey` on acks and deltas, snapshot maps, heartbeat `stores`. Tests per store.
3. **Wire commit**: `efsp-resync` `stores` and the reply slices, `wire:record`. SYNC-B-C is cut here.
4. Soak shadow and detector, then `soak:selfcheck`. Both suites once.

## Steps (C)

0. Re-find the client sites. Read ADR 0105 and S's wire commit.
1. `storeSync`, the gap and epoch checks, the request and the routing. Unit tests per store.
2. The e2e spec and `ui-b-resync` on `E2E_LANE=4`. Both suites once.

## Acceptance

- For each of the six stores, a dropped delta is detected (by a seq gap, by the heartbeat, or by an epoch change after
  a server restart without a reconnect, which the test simulates by swapping the store) and healed by one resync slice.
  No full snapshot, and no reconnect.
- An owned-scope session never receives a slice outside its scope.
- Soak selfcheck passes, including the new detector if added.
- Both suites green, with the protocol bumped once (or not at all, if VERSION's rule says the unreleased number
  already covers it).

## Defaults (P2)

- Heartbeat-driven healing for off-wire bumps, unless measured too chatty.
- Snapshot slices, no rings.
- No persistence of store epochs.
