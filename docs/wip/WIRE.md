# WIRE lane (refactor W2): families, one skeleton, `broadcasts[]`

(Report goes here at the end.)

## Step 0: base counts

Base `b0f273f`: crc-sync `npm test` 2092 pass / 0 fail; crc-desktop `npm test` 866 tests / 865 pass / 0 fail (1 skipped);
freeze goldens 47 / 47. `efsp-ws.js` 1217 lines, `ws-hub.js` 694, `replay-cache.js` 56.

## Code as found

`src/efsp/efsp-ws.js` (symbols, base line numbers)
- `handleMessage` :182 (11 cases: efsp-mutation, -resync, -set-positions, then the airspace, correlation, MARSA, field-state,
  ATO preview, ATO mutation, carrier, SFA types). `_subject` :169 (7 cases, `msg.type`-keyed).
- Replay helpers `_cachedOutcome`/`_rememberOutcome` :134/:137; `replayKind`s: airspace, correlation, marsa, fieldState, carrier, sfa.
- Families (handler, ack type, gate, delta, snapshot key):
  | family | handler | ackType | gate | broadcast | snapshot key |
  |---|---|---|---|---|---|
  | airspace | :431 | efsp-airspace-ack | primary somewhere | efsp-airspace-delta | airspaces |
  | correlation | :505 | efsp-correlation-ack | primary somewhere + `canCorrelate` | efsp-correlation-delta | correlations |
  | MARSA | :584 | efsp-marsa-ack | primary somewhere + `canDeclareMarsa` | marsa delta (+ regime board-delta in the primary slot) | marsa |
  | field state | :1024 | efsp-field-state-ack | primary at msg.facilityId (default facility) | efsp-field-state-delta | fieldStates |
  | carrier | :683 | efsp-carrier-ack | primary at CARRIER | carrier delta | carriers |
  | SFA | :724 | efsp-sfa-ack | primary at the default facility | sfa delta (only when `changed`) | sfaRotation |
  | ATO preview | :1142 | efsp-ato-preview-result | `_atoGate` | none | none |
  | ATO mutation | :1155 | efsp-ato-ack | `_atoGate` | one board-delta | none |
- Skeleton deviations (each one the family file must declare):
  1. Only airspace/correlation/MARSA/field-state set `unaudited: true` on a gate refusal; carrier and SFA refusals do not (finding F1).
  2. Field-state refusals and every field-state ack carry `facilityId`, and the refusals carry `fieldState`/`fieldStateSeq`.
  3. SFA persists on `ok && changed` and broadcasts only when `changed`; field-state and carrier call `nlaStatusMonitor.tick()` on ok.
  4. ATO preview: no replay, no persist, no broadcast. ATO mutation: its own ack cache (WeakMap per ctx, cap 200), its own
     refusal audit (`logEntry`), a board-delta broadcast with `boardEpoch`.
  5. MARSA: the primary slot (`broadcast`) holds a stripless board-delta for regime FDRs, the MARSA delta is the `marsa` slot.
  6. Board path (`_handleMutation` :199) builds primary/peer/marsa/carrier slots; set-positions (:770) one board-delta; resync (:338) ack only.
- Snapshot key order (`_fullSnapshotMessage` :934): version, type, boardSeq, facility, facilities, boardSeqByFacility,
  boardEpochByFacility, aitAuthorizedByFacility, positionLetters, positions, bays, strips, fdrs, **airspaces, correlations, marsa,
  fieldStates, carriers, sfaRotation** (the registry order must be exactly that).
- `filterForSession` :871 cases: efsp-snapshot, efsp-board-delta, efsp-correlation-delta, efsp-marsa-delta, efsp-alerts, default.
- `module.exports`: handleMessage, carrierDelta (server.js uses it), sfaDelta, snapshotMessage, filterForSession, supplementFor,
  readScopeKey, readScopeOf, RESYNC_RING_WINDOW.

`src/ws-hub.js`: `_onMessage` :588; broadcast loop :602-626 (broadcast, peerBroadcast, marsaBroadcast, carrierBroadcast, sfaBroadcast,
then `_onEfspChange`); `attach()` :67 starts `_timer` (:81), no `stop()` exists.

`src/efsp/replay-cache.js` :17 `KINDS` literal (6 kinds).

Readers of the named broadcast keys: 14 test files (~100 sites), `tests/helpers/efsp-scenario.mjs` (doc comments),
`tests/freeze/freeze-recorder.mjs` (records `out` verbatim: goldens carry `broadcast`/`peerBroadcast`/`marsaBroadcast`/
`carrierBroadcast`/`sfaBroadcast` keys) and `freeze-table.test.mjs:183` (`sent:` = result keys).
Freeze: `freeze-tables.test.mjs` scraper reads `case 'efsp-…'` from `handleMessage` and `type: 'efsp-…'` literals from `src/efsp/*.js`.
Mutations: M5/M5b/M17 swap lines in the hub loop; M13 removes the resync case line.

## Design decisions (defaults taken)
- Families return broadcast **slots** `{primary, peer, marsa, carrier, sfa}`; the skeleton orders them with one constant
  `SLOT_ORDER` (this is what M5/M5b/M17 swap) and returns `broadcasts[]`. The Board path, set-positions and ATO use the same
  ordering function. `handleMessage` always returns `{ack, broadcasts:[…]}`.
- Golden identity: goldens record the old named keys. A pure test helper `tests/helpers/wire-slots.mjs` maps `broadcasts[]`
  back to the slot names by frame type, used only by `freeze-recorder.mjs` and `freeze-table.test.mjs` (harness, no golden change).
- ATO preview/mutation are "custom" families (`handle()` override, `replayKind: null`), exceptions listed in their file.
- `unauditedGates` boolean on the family keeps carrier/SFA refusals un-flagged as today (finding F1).

## Findings
- F1: carrier and SFA gate refusals (NOT_HOLDING_POSITION, no store) are not marked `unaudited`, so L5's metrics tap does not write
  them, unlike the other four mutation families (metrics.js:916). Possibly an oversight; kept as is.
