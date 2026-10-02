# SYNC-B-C: the client heals every store (crc-sync ADR 0106)

## Code as found (base 9cd1ebde)
- `efsp-state.js` tracked only Board seq/epoch per Facility; the family appliers (airspace, correlation, marsa, runway status, carrier, sfa) replace records by id and read no seq. `efspResyncPositionFor` named only a Board.
- `efsp-ws.js`: `requestEfspResync` keeps one in flight per Facility (retry after 10 heartbeats); the reply handler mapped any non-snapshot answer to a Board delta.
- Server (SYNC-B-S): every store ack/delta carries `<store>Seq`/`<store>Epoch`; snapshot `storeSeqs`/`storeEpochs`; heartbeat `stores`; resync `stores` request; reply `stores:{key:{seq,epoch,slice}}`, `answer:'stores'` for a stores-only request. Snapshot keys are `airspaces, correlations, marsa, runwayStatuses, carriers, sfaRotation`.

## Done
- `efsp-state.js`: `STORE_SYNC`, `getEfspStoreSync`, `efspStoreGapOf` (frames), `efspStoreHeartbeatGapOf` (2 beats behind, epoch at once), `efspStoreResyncPositionFor`, `applyEfspStoreSlices`; snapshot refactored into per-store `_replace*`.
- `efsp-message-registry.js`: `addEfspMessageObserver`, so seq/epoch is read from every family delta and ack in one place (no per-panel edits).
- `efsp-ws.js`: one in-flight store resync per store; `efsp-messages.js`: reply handler applies slices, re-dispatches an empty family delta to redraw.
- Tests: `tests/efsp-store-resync.test.mjs` (13), `e2e/store-resync.spec.js`.

## Defaults taken
- A jump on a `gapFromDeltas:false` store (correlation, marsa, carrier) is not adopted and not asked for; the heartbeat names it after two beats. Same for `true` stores it asks at once.
- One efsp-resync per stale store (each names only that store), not one batched request.
- No position held (snapshot did not name the store) means no request: the connect snapshot is the recovery.
- ADR cited as 0106.

## Findings
- `_sendEfsp` returns nothing, so a request sent on a closed socket is "in flight" until the 10-heartbeat retry (same as the Board's).
- The e2e rig has no mission, so the spec moves each store to a stale lifetime client-side rather than dropping a real delta.
