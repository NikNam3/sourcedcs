# WIRE lane (refactor W2): families, one skeleton, `broadcasts[]`

## Report
Branch `lane/WIRE-families` from `b0f273f`. Commits: see `git log --oneline b0f273f..HEAD` (docs step 0, the refactor commit, the wip/report commit).
- Done: every `efsp-<x>-mutation` family (airspace, correlation, MARSA, field state, carrier, SFA) is `src/efsp/wire/families/<x>.js`; ATO
  preview and ATO mutation are two custom families in `families/ato.js`. `efsp-ws.js` keeps the Board path, resync, set-positions, snapshot
  assembly and the read scope; `wire/skeleton.js` runs gate, class check, replay, apply, remember, persist, ack, broadcasts. `ws-hub.js` loops
  `result.broadcasts`; `WsHub.stop()` added. `replay-cache.js` `KINDS` come from the registry. Snapshot family keys come from `snapshotKey/snapshot`
  in registry order. `filterForSession` delegates correlation and MARSA deltas to the family's `filter`.
- `efsp-ws.js` 1217 -> 486 lines (wire/ total 838 across 11 files).
- Tests before -> after: crc-sync 2092 -> 2098 (+5 new tests, +1 todo), all pass; crc-desktop 866 -> 866 (865 pass, 1 skipped, as at base).
  One load flake (`grpc-client-stream` retry timing) passed alone.
- Golden: identical, no `freeze:update`; freeze 47/47. The goldens record the old named keys, so `tests/helpers/wire-slots.mjs` maps `broadcasts[]`
  back by slot name (the array carries a non-enumerable `slots` array set by `orderSlots`); it throws on a missing or mismatched `slots` (tested
  in `tests/wire-slots.test.mjs`), it never guesses from frame types (primary and peer are both board-deltas).
- Selfcheck: M5, M5b, M17 retargeted to the one `SLOT_ORDER` constant (`wire/slots.js`, swap two entries), each proven CAUGHT by freeze-hub
  (`npm run freeze:selfcheck M5|M5b|M13|M17`; M13 file unchanged, still applies, caught by hub, scenarios and tables). The full 17-mutation run was not
  repeated (only these four touch moved code). `soak:selfcheck` PASS (all detectors fire, drop-broadcast included).
- Structure fixtures / files outside Owns: `freeze-tables.test.mjs` scraper reads the registry and `src/efsp/wire/**` (owned);
  `freeze-recorder.mjs` and `freeze-table.test.mjs` use `legacyShape` (harness, not in Owns); crc-desktop `tests/ws-message-contract.test.js` (server file list
  plus registry types) and `tests/overflight-shared-state-names.test.js` (the INBOUND-in-a-comment allow-list entry moved from `efsp-ws.js` to
  `wire/skeleton.js`). The ~100 named-key reads in 14 crc-sync tests became `slot(out, 'primary'|'peer'|...)`.
- Commit granularity: the skeleton, the registry and all families landed in ONE refactor commit, not one per family: `efsp-ws.js`, the hub and
  the result shape change together, so no intermediate state was golden-green.
- Defaults taken: P2 `_subject` stays one function (`skeleton.subjectOf`, reading `family.subject`); no heartbeat work (WIRE-B: a per-Facility
  heartbeat, plan section 6 item 5). S-WIRE0 from main: slot-carrying helper, loud on ambiguity.
- Answers to the questioner: the order is proven by the real hub trace `peer-marsa-order`, not a stub; M5/M5b/M17 are caught by it.
- Findings: F1 below (`test.todo` in `tests/wire-skeleton.test.mjs`). Also: `family.filter` exists for correlation and MARSA only; the board-delta, snapshot and
  alerts filters stay in `efsp-ws.js`. Nothing for the supervisor to decide.

## How to add a family (AIRSP phase 2 is the first reader)
1. Create `src/efsp/wire/families/<x>.js` exporting `{ type, ackType, deltaType?, replayKind, snapshotKey?, subject(msg), store(ctx), noStore,
   gate: 'primary-somewhere' | 'primary-at-facility' | fn(ctx, session, msg) -> null|{reason,detail}, notHolding(msg, facilityId), facilityOf?(ctx, msg),
   permit?(ctx, msg), apply(ctx, session, msg), rememberId(result, msg, ctx), fromCached(ctx, cached, msg), ack(result, ctx, msg), broadcasts(result, ctx, msg),
   snapshot?(ctx), filter?(ctx, scope, msg) }`. `ack` returns the fields after `ok`; the skeleton adds version, type, clientMutationId, `subject`, `head` and `ok`.
2. `broadcasts` returns slots `{ primary, peer, marsa, carrier, sfa }` (any subset); the skeleton orders them with `SLOT_ORDER` (`wire/slots.js`).
3. Add it to `FAMILIES` in `families/index.js` (the order is the snapshot key order; `replayKind` joins the replay cache `KINDS` by itself).
4. Optional hooks: `head`/`refusalTail` (extra ack fields on refusals), `persistWhen`, `after(ctx, result, msg)` on ok, `unauditedGates: false` (see F1).
5. A shape that does not fit declares `handle(ctx, session, msg, persist)` returning `{ ack, broadcasts: orderSlots(...) }` and lists why in its file (ATO).
6. Run the freeze goldens; the message-type table (`tables-wire-message-types`) and crc-desktop's `ws-message-contract` read the registry, so a new type changes the
   golden: that is an approved-behaviour change, not a structural one.

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
