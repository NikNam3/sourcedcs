# SYNC-B-S: every store resyncs (ADR 0106)

## Code as found (base c2df2e3d)
- `sync/sync-log.js`: counter-only unless asked; only `BoardState` had ring/touched/epoch. Six stores construct `new SyncLog()` and expose `currentSeq`.
- Seq sites: airspace `_touch` + create/import/edit/delete (5 `advance()`), correlation `_touch` + two inline bumps in `reconcile`, MARSA `_touch`,
  runway status `_touch`, carrier `_touch` + `_stackOp` quiet bump + `setShipState`, SFA one.
- Families (`wire/families/*.js`): ack and delta builders carry only the seq; `frames.js` builds marsa/carrier/sfa deltas. Filters exist for correlation and
  MARSA only. Delta senders outside the skeleton: `ws-hub.broadcastEfspCorrelationDelta` (reconciler: **no seq at all**), `broadcastEfspRunwayStatusDelta`
  (wind), carrier tick `onChange`.
- Resync: `_handleResync` answers Board delta or snapshot; no store key. Heartbeat: `boards` only (ADR 0104).
- Soak: `shadow.js` tracks Board seqs only and never reads the beat body.
- Off-wire bumps: reconcile (reconciler tick) now broadcast with seq; `setShipState` advances only when it returns true and the tick then
  broadcasts, so no advance is silent. Not measured in the soak (nothing relies on the heartbeat for them any more).

## Done
Wire commit: see git log "wire(SYNC-B-S)". Declarations, epochs, epoch keys, snapshot maps, heartbeat `stores`, resync `stores` and slices,
owned-scope continuity, tests `tests/store-resync-server.test.mjs`.

## Defaults taken
- Declaration key = snapshot key (the briefing's example said `airspace`; its text says snapshotKey).
- Slice reply shape `{ seq, epoch, slice }`; stores-only request = `stores` without `lastBoardSeq`/`boardEpoch`, answered `answer: 'stores'`.
- Instead of filtering the heartbeat for owned sessions, correlation/MARSA deltas now reach them empty (seq continuous).
- Protocol stays 2.

## For SYNC-B-C
Adopt `<store>Seq`/`<store>Epoch` from acks and deltas (not from supplement frames, which carry none). `gapFromDeltas` false stores must not ask on a jump.

## Not done
- Soak `store-stale` detector: not added. `shadow.js` tracks Board state only, and the driver's restart/reconnect/ledger paths would each need store-seq handling (a lane of its own, NX-1's soak lane). `soak:selfcheck` passes unchanged.
- Off-wire advance rate was not measured: every reconciler and carrier-tick advance now reaches the client as a delta carrying the seq, so none relies on the heartbeat.

## Gates
crc-sync npm test 2373/0, crc-desktop 1038/0, freeze 48/48 after re-record, freeze:selfcheck 18/18 (M9 retargeted), soak:selfcheck PASS.
Re-recorded: all 38 golden files (six extra randomUUID calls renumber ids; new epoch keys).
