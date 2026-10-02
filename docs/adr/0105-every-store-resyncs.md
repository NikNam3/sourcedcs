# 0105 — Every store resyncs

## Context

Only the Board had an epoch and a resync (ADR 0081, 0104). The six other stores (airspace, correlation, MARSA, runway
status, carrier, SFA) counted a seq through `sync/sync-log.js` that no client read: a lost family delta healed only on
the next full snapshot, which means a reconnect. H88 queue item 4 asked for the same healing for every store.

## Decision

- **Declaration.** Each of the six `stores.js` registry entries has `sync: { key, seqKey, epochKey, deltaType, gapFromDeltas }`
  (`STORE_SYNC` lists them). `key` is the store's snapshot key (`airspaces`, `correlations`, `marsa`, `runwayStatuses`,
  `carriers`, `sfaRotation`), which names its heartbeat entry and its resync slice. `gapFromDeltas` is true where one
  change is exactly one seq step in a delta (airspace, runway status, SFA); false for correlation, MARSA and carrier, whose one
  delta may carry several steps, so a client there relies on the heartbeat.
- **Epoch.** Each store's `SyncLog` turns on `epoch: true`: one `randomUUID` per store per process, never persisted.
  No ring: the answer to a resync is the store's snapshot slice.
- **Frames.** Every ack and delta of a family carries its `epochKey` beside its `seqKey` (`airspaceEpoch`, `correlationEpoch`,
  `marsaEpoch`, `runwayStatusEpoch`, `carrierEpoch`, `sfaEpoch`). The snapshot carries `storeSeqs` and `storeEpochs`
  (`{ [key]: n }`). The heartbeat carries `stores: { [key]: { seq, epoch } }` beside `boards`, built once per tick and
  the same for every session (see Read scope).
- **Request.** `efsp-resync` gains `stores: { [key]: { lastSeq, epoch } }`. A request with `stores` and neither `lastBoardSeq`
  nor `boardEpoch` is stores-only.
- **Reply.** `efsp-resync-reply` carries `stores: { [key]: { seq, epoch, slice } }` for each named store whose epoch differs or
  whose seq is not the server's (behind or rewound). `slice` is what the full snapshot carries under that key, filtered for
  the session's read scope. A stores-only reply has `answer: 'stores'`. A Board `delta` answer carries the slices
  beside it; a Board `snapshot` answer carries none (it already holds every store). The Board's answer is unchanged.
- **Off-wire changes.** The correlation reconciler's delta now carries `correlationSeq` and `correlationEpoch` (it carried
  neither), as does the wind-derived runway-status delta its epoch. Every other advance reaches the client as a delta, so no
  change relies on the heartbeat alone; the heartbeat remains the net for a delta that is lost.
- **Read scope.** An owned-scope session is sent an empty correlation or MARSA delta when nothing in it is visible (it was
  skipped before), so its seq stays continuous, as for the Board delta; the heartbeat therefore needs no filtering. The
  supplement frames sent with a handed Strip carry no seq. Slices are filtered as the snapshot is.
- **Protocol.** The surface scan does not cover these keys; the number stays 2 (already ahead of the last release).

## Consequences

A client that loses a delta of any store notices at the heartbeat (two beats behind, or an epoch change at once) and gets
that store's slice back by one request, with no reconnect and no full snapshot. The client half is SYNC-B-C.
