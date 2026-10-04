# DESK-SYNC (phase 3, client lane, E2E_LANE 3)

Branch `lane/DESK-SYNC-desk-sync`.

## What changed

1. **One sync cursor.** New leaf `crc-desktop/app/public/js/panels/efsp/sync-cursor.js` (imports nothing): cursors named
   `board:<facilityId>` and `store:<key>`, each `{ seq, epoch, behind }`; one `heartbeatGaps(msg)` (reads `boards` and `stores`),
   `storeFrameGap`, `epochMoved`, `resyncPositionOf(name)`, and one in-flight table (`beginResync` / `endResync(s)` / `ageResyncs`,
   `RESYNC_RETRY_HEARTBEATS = 10`). `efsp-state.js` lost `efspBoardSeqByFacility`, `efspBoardEpochByFacility`, `_heartbeatBehind`,
   `_storeSync`, `_storeBehind`, `efspHeartbeatGapOf`, `efspStoreGapOf`, `efspStoreHeartbeatGapOf`, `efspStoreResyncPositionFor`; it keeps
   `efspEpochChangeOf`, `efspResyncPositionFor`, `getEfspStoreSync`, `getEfspBoardEpoch`, and gained `efspFrameGapsOf(msg)`
   (every cursor a frame contradicts: Board lifetime, store lifetime, skipped store seq). A snapshot is `clearCursors()` + re-adopt (it also
   clears in-flight requests, so `noteEfspSnapshotLanded` is gone).
2. **One trigger.** `efsp-ws.js` has one registry observer, `noteEfspFrameForSync`, and one `requestEfspResync(name, reason)`. The handlers no
   longer call `noteEfspBoardMessageForSync` / `noteEfspHeartbeatForSync` / `noteEfspResyncAnswered` / `noteEfspStoreAnswerLanded` (all deleted).
   The observer asks on a frame gap or heartbeat gap, ends a Board's request when a delta of our own lifetime lands, ends the store requests when
   a stores reply lands, and ages the in-flight table on a heartbeat.
3. **Store redraw, no synthetic frames.** `efsp-message-registry.js` gained `registerEfspStoreRedraw(key, fn)` / `redrawEfspStore(key)` /
   `registeredEfspStoreRedraws()`. airspace-panel, carrier-panel, runway-status-panel and efsp-messages (correlation, marsa, sfa) register the
   same function their delta handler runs after applying. The resync-reply handler calls `redrawEfspStore(key)`; `deltaType` is gone from `STORE_SYNC`.
   A test asserts the registered keys equal `STORE_SYNC`'s and that no `efsp-*-delta` is dispatched by a reply.
4. **`efspBoardSeq` / `getEfspBoardSeq` deleted.** Tests read `getCursor(boardCursorName(f)).seq` or `efspResyncPositionFor(f).lastBoardSeq`; the two e2e specs
   (`ui-b-resync`, `l22-stars-scope`) read `efspResyncPositionFor(...).lastBoardSeq`. One legacy path went with it: a Board delta with no Facility
   and no default Facility used to set `efspBoardSeq`; it now adopts nothing (never happens on the wire).
5. **Pending CreateStrip is re-sent.** `rebaseForResend` returns the stored message unchanged when it has no `stripId`. Safe because
   `BoardStore.applyMutation` answers a cmid in its replay cache with the original outcome (`replayed: true`), applies one it has never seen (or lost to a
   restart/rollback) fresh, and the cache keys on the cmid alone and persists 10 minutes. So a lost ack neither duplicates nor loses the Strip, and the
   form keeps waiting for its ack instead of clearing with `CONNECTION_LOST`. Test: `efsp-ack-path.test.mjs`.

## Defaults taken

- A store's `redraw` is registered through the message registry (a leaf), not a field of `STORE_SYNC` (state must not import panels).
- Board epoch checks now run for every frame through the observer (before: only the delta and the ack handler). A frame of another family carrying
  `facilityId` + a different `boardEpoch` would now trigger a resync; none does today.
- Stale-resend edge: a CreateStrip held across a very long disconnect is still re-sent (the form is still waiting on it). If the Board was reset in
  between, it is created on the fresh Board, which is what the controller asked for.

## Findings

- SERVER-SEAMS-2: the store replay record does not carry `attestation` (already noted by DESK-ACKS). Nothing new needed for sync; the server's
  `efsp-resync` store answer and the `boards`/`stores` heartbeat shape are what the cursor reads, unchanged.
- DESK-GRAPH: `sync-cursor.js` is a leaf, `efsp-state.js` and `efsp-ws.js` import it; no edge to `app.js` added. `efsp-ws.js` still imports
  `efsp-state.js` and `efsp-messages.js` imports `efsp-ws.js` (existing).
- DESK-TIDY-2: `_resetEfspStateForTest` still does not reset the carrier/SFA state `STORE_SYNC` replaces (ARCH-C §1.4 bullet, untouched).

## Guide / briefing wording

- `docs/efsp-briefing.md` client section: "sync position is one `SyncCursor` per Board (`board:<facility>`) and per store (`store:<key>`); one registry
  observer (`noteEfspFrameForSync`) is the only resync trigger; a store resync redraws through `registerEfspStoreRedraw`; a pending CreateStrip is re-sent
  after a reconnect with its cmid".
