# SERVER-SEAMS-2 (phase 3, crc-sync)

Branch `lane/SERVER-SEAMS-2-server-seams-2`. Server-only. No wire shape change (`wire:record`: protocol stays 2, surface unchanged).
Tests: `npm test` 2456 -> 2460 (+1 deliverEfsp, +3 synced-store); freeze 52/52 (after 3 intended golden updates); walk 23/23; `soak:selfcheck` PASS; crc-desktop 35 failing before and after (same list, INTEG-PARITY's).

## What changed
1. **One delivery path.** `WsHub#_deliver({broadcasts, directed})` / `deliverEfsp(frames)`: read-scope filter, directed frames, then the post-change hook (not re-entered) after any delivery that sent a frame. The six broadcast entry points are gone (`broadcastEfsp{BoardDelta,CorrelationDelta,RunwayStatusDelta,Frames,Message,CarrierDelta}`). The hub builds no EFSP frame: `wire/frames.js` has `serverBoardDelta`, `correlationDelta` (seq-less supplement = no store), `runwayStatusDelta`; ato.js, correlation.js, runway-status.js, efsp-ws.js use them. `broadcastEfspAlerts` stays its own per-session loop (state, not a delta; filtered via `_efspAlertsMsg`). Server-originated deltas now also run the obligation re-check (it ticks more often).
2. **`efsp/synced-store.js`** base class for the six sequenced stores: clock, mutationLog, SyncLog, `currentSeq`/`epoch`, `_bump(record)`, `_guarded(what, log, fn)` (the apply backstop), `_writeAudit` (common audit line; each store keeps its subject ids). Board and flight-data store keep their own.
3. **`BoardState.bump(strip, by, at)`** now used at all 12 Board rev/updatedAt/updatedBy/touch sites (tofi 7, coordination 3, carrier-handoff, sfa-rotation). `placement` rebalance and undo restore stay (different semantics).
4. **Splits.** `app.js` 913 -> 257 lines: `app/{http-routes,radar-picture,monitors,tickers,feed-handlers,archive,airport-weather,active-runway,late-binding}.js`. `efsp/index.js`: rules bag -> `efsp/facility-rules.js`, locator -> `efsp/regime-locator.js`. Late setters removed: `flightDataStore.setWriteObserver` (ctor `onWrite`), `board.setAirborneObserver` (BoardStore `airborneObserver`, createEfsp `airborneEvidence`), `efsp.setAbsentCheck` (PositionStore `isAbsent`; hub and efsp share one `pendingSignOffs` Map), `nlaStatusMonitor.setOnDelta` (createEfsp `onNlaDelta`), `wsHub.setOnEfspChange` (WsHub ctor `onEfspChange`). **Remaining, named:** `app/late-binding.js` links `wsHub` (hub <-> producers of server frames) and `surveillanceHints` (Boards <-> hint monitor); they throw if used unbound or bound twice. `archiver.setIsCounted` is still a setter, now called inside `createEfspInstrumentation` (the count is built beside the facade tap and needs the facade).
5. Dead `PUBLIC_DIR`/`express.static` removed.
6. `hub-random-seed1/2`: efsp-alerts frames are hashed in content order (`freeze-world.mjs sortedAlerts`), because the server sorts obligations by raw stripId. Re-recorded once (alert hashes only).

## Defaults taken
- Rules bag moved intact, not reduced to modules (BoardStore's rule contract and ~12 tests build their own rules).
- `airborneEvidence` always set in createApp (answers false when no hint monitor): same behaviour as no observer.
- Tests that poked setters now use a small mutable sink passed through the new dependency (`nlaSink`, `airborne`, `hook`).

## Not done
- Scope 7: `withPaths` env helper (~50 files) and the real waits in `collab-store.test:70`, `airspace-service.test:200`.
- ARCH-S 2b's "pass facilityView/modules instead of closures".

## Findings
- CLAUDE.md still says app.js names a `public/` dir (no longer true) and `docs/efsp-briefing.md` names the removed hub methods; both are shared docs, not edited.
- DESK-GRAPH/client: nothing client-visible changed.
- `tools/soak/host-core.js` unchanged and works (it reads `app.wsHub`, `monitors.*`).
