# L18 server half (branch lane/L18-server)

ADR `docs/adr/0093-bay-descriptor-flags-and-the-sfa-rotation-record.md` (0075 Part B built). Run on `E2E_LANE=9`.

## What the guide / briefing should say

- Incirlik has eight Positions. RSU: the pattern board (closed, initial, base, final); chips Next leg, Landed, Drop; asks
  for runway status, never closes. SFA: five UHF frequency Racks, the header shows who is on which; "Rotate to PAR" beside the
  NLA. PAR: one aircraft on final, the FINAL panel (nothing to type), two terminal buttons; a missed approach goes to the
  `par-missed` Bay. APP edits the rotation record (a select per frequency), nobody else.
- Filing a Strip on an SFA Rack assigns it that frequency; rotating never changes it. A vacated Position's Strips go to APP and
  come back to their own Racks when it is retaken. RSU has no covering Position: its Strips stay with it.
- Briefing module map: `sfa.js`, `sfa-store.js`; messages `efsp-sfa-mutation`, `efsp-sfa-ack`, `efsp-sfa-delta`, `sfaRotation` in the
  snapshot; op `SfaRotation`; audit fields `sfaTransfer`, `sfaTrigger`; client `sfa-state.js`, `bay-views.js`.

## Defaults taken (P2)

1. SFA's Bay implies `INBOUND` (an existing ARRIVAL state), as the supervisor said.
2. Pool: `freq-1..5` = 232.1 to 236.1 MHz placeholders [SOURCE-DEFINED]; initial rotation APP/SFA/PAR on freq-1/2/3.
3. RSU originates PATTERN Strips (the spec gave no way for a Strip to reach RSU). SFA and PAR originate nothing.
4. PAR has a second Bay `par-missed` (not in the spec) for BOLTER_WAVEOFF.
5. SFA_ROTATION is refused if PAR is unmanned (no covering) and if `par-final` is occupied; the Strip keeps its Rack in `sfaTransfer.frequencyRackId`.
6. PAR/RSU/SFA Bay descriptor flags `view`, `replacesRacks`, `capacity` (L17 had none; it used `bayId`). Carrier Bays got `view` only.
7. FINAL sample: distance to the approach radar's site (no runway geometry client-side), glidepath against a nominal 3 degrees from the radar's elevation, decision height field + 200 ft; carrier: distance to the ship. All [SOURCE-DEFINED]; L20 marks them.
8. `RequestRunwayStatus` kinds are CLOSE, OPEN, WORKS (BARRIER_CHANGE is WORKS since L1b); the spec's text was stale.
9. SFA's compact Strip fields: APP's ARRIVAL list without SREG; runway 8B shown for SFA.
10. The shipped `config/efsp-facility-incirlik.json` (positions, chain, bays) was regenerated from the new defaults: it overrides them.

## Findings for other lanes

- **L18 client half bug, fixed here:** `pattern-board.js` and `final-panel.js` both declared a top-level `finite`, and `_el` collided with `metrics-panel.js`; in a browser one script failed to load and the other's builder broke. Node tests (stub, one module each) could not see it. A test now holds the four Bay-view scripts' top-level names unique across index.html.
- **L17:** the carrier's final Bays comment "one Strip at a time" but nothing enforced it; `capacity: 1` now exists and could be set on `cv-app*-final` (not done: behaviour change).
- **PARITY merge:** its tests were copied in untracked and run green against this tree (client-mirror-parity, bay-descriptor-parity, ws-message-contract, wire-payload-contract); none committed.
- **SFA edge:** if something else rewrites a flight's working frequency (an airspace approval), its Rack no longer matches; the Rack is a placement, the FDR is the truth.
- **PAR vacated with an aircraft on final:** the Strip goes to APP's coordination Bay and APP cannot advance it (L17's watch item 1, same shape); it returns to PAR when retaken.
- `docs/wip/L18.md` is stale on BARRIER_CHANGE and on `impliesState`; L18's mockup unchanged.

## Walks done / not done

Done (wire, `efsp-scenario-incirlik-l18.test.mjs`): rotation acceptance; switch frequency (drag to another Rack), switch controller (back to APP and on); cancel (missed approach, second aircraft refused then admitted, rotation to an unmanned PAR then late PAR, Drop in the pattern, Undo after a rotation); late arrival (SFA, PAR and RSU vacating and retaking); RSU asks and is refused a close; restart keeps the record. Browser: `e2e/l18-incirlik.spec.js` 3 specs.
Not done: a live DCS track driving the FINAL sample (the harness has no gRPC, so the sample shows `--`); two controllers at two screens; the four-hour soak.
