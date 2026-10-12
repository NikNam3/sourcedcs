# 0117: A single frequency approach is a procedure between AP and PAR, not a Position; the PAR final ends when the aircraft lands

**Status.** Built (lane LT-SFA-PAR, 2026-10-12), for live-test findings T1, T5 and T11 (`docs/parallel/live-test-2026-10-11.md`).
Rulings: decisions.md **H128** ("FAA model, always": no `SFA` Position) and **H134** LT-RQ5 a to LT-RQ9 a. Research:
`docs/parallel/research/live-test-faa.md` Q1 to Q3. **Supersedes** ADR 0075 decisions 3 (the "Landing assured" half), 5 and 6's SFA
Position, and ADR 0093 decisions 2 (the SFA Position), 3 (the rotation record), 4 (`SfaRotation`), and 6's "Landing assured is
BALL". What 0075 and 0093 decided about RSU, the Bay descriptor flags (`view`, `replacesRacks`, `capacity`), the `par-missed` Bay
and "a frequency is assigned by filing on a Rack" (0093 decision 5) stands. ADR 0058 (conformance) gains the final rule below.

Editions (research, "Sources and editions"): **JO 7110.65BB** Basic 2-20-25 with Chg 1 to Chg 3 (7-9-26); **JO 7610.14A**,
effective 8-7-25, with Chg 1 (1-22-26) and Chg 2 (7-9-26). ADRs 0075 and 0093 cited only the implementation guide's §4.7.

## Context

The live test showed three things. T1: the build had a third Position, `SFA`, between AP and PAR, read from the guide's §4.7; the
FAA has no such Position, and AP's drop onto PAR was refused ("the only valid next state from INBOUND is HANDED_TO_TOWER").
T5: "Landing assured" set the PAR Strip to `BALL`, PAR has no Bay for `BALL`, so the Strip stayed in `par-final`, which holds one
Strip, and the next aircraft could not be handed in. T11: altitude and heading conformance kept alerting on the PAR final against
AP's last assignment, and PAR had nowhere to change the assigned heading or altitude.

What the orders say (quoted from the research):

- JO 7610.14A ¶7-1-5: "b. At least five discrete ultra-high frequency (UHF) frequencies are available for this use. c. The radar
  approach controller retains jurisdiction over the rotation of three frequencies between himself and the GCA controller. d. A
  letter of agreement is completed ... covering ATC procedures, use of frequencies, etc."
- JO 7110.65BB ¶4-7-3: "do not require a radio frequency change after the aircraft begins approach ... until a landing or low
  approach has been completed except under the following conditions: a. During daylight hours while the aircraft is in VFR
  conditions. b. On pilot request. c. When pilot cancels IFR flight plan. d. In an emergency situation. e. When aircraft is
  cleared for visual approach." ¶4-7-4 c: "If practicable, use a frequency common to both the GCA unit and approach control".
- ¶5-10-15 c: after a handoff the transferring controller positions transmitter selectors to preclude further transmissions on
  the special use frequencies, the receiving controller selects them, and "Do not require or expect the flight to check on
  frequency unless an actual frequency change is transmitted to the pilot." The handoff itself is ¶5-4-5 / ¶5-4-6, nothing
  SFA-specific.
- ¶5-10-13 a: the final controller obtains the tower's clearance and issues it: "(runway), WIND ..., CLEARED TO LAND". "Landing
  assured" is in no order (JO 7110.65BB, the P/CG, JO 7210.3EE).
- ¶5-12-8 d: "Pilots must remain on final controller's frequency until touchdown or otherwise instructed." ¶5-12-9: "CONTACT
  (terminal control function) (frequency, if required) AFTER LANDING."
- ¶5-12-3: "When an aircraft reaches the point where final descent is to start, instruct it to begin descent." ¶5-12-4: course
  guidance by "HEADING (heading)" about every 5 seconds, deviations called "above/below glidepath", "left/right of course".
- ¶5-9-4 c: approach clearance "except when conducting a radar approach" (a PAR has no "cleared ... approach").

## Decisions

1. **No `SFA` Position.** INCIRLIK has OPS, CD, GC, LC, RSU, AP, PAR. `SFA` leaves the facility config (positions, classes,
   letters, consolidation, radars, Bays), the capability table (`authority/positions/incirlik-military.js`), the combination's
   non-local list (`combination.js`, so T26's line no longer names it), and the client's mirrors (topology, combination,
   formation, strip fields, NLA owners).

2. **The SFA frequencies are AP's.** AP's new Bay `ap-sfa` (`view: 'sfa-freqs'`, implies `INBOUND`, after `ap-inbound` so that
   stays the fallback) has one Rack per pool frequency. Filing a Strip there assigns the flight that frequency, as 0093 decision 5
   built. `singleFrequencyApproach` is `{ jurisdiction, pool: [{ rackId, mhz, use }] }`, `use` one of `ROTATION` (exactly three,
   ¶7-1-5 c), `INITIAL_CONTACT`, `SPARE`; at least five UHF frequencies (¶7-1-5 b); the `sfa-freqs` Bay must be the jurisdiction
   Position's. **Ours** (H134 LT-RQ5 a; the order leaves it to the LOA, ¶7-1-5 d): freq-1 is AP's initial-contact frequency,
   freq-2 to freq-4 rotate, freq-5 is a spare. The frequencies themselves stay placeholders.

3. **No rotation record.** Who has a rotating frequency selected follows the flight on it (¶5-10-15 c): PAR while PAR holds the
   Strip of a flight on that frequency, otherwise AP. It is derived, never stored, so it cannot drift from the Board; the client
   draws it in AP's SFA header. The store (`sfa-store.js`), its wire family (`efsp-sfa-mutation` / `-ack` / `-delta`), its
   `SetSfaRotation` op, its heartbeat and resync entry, and its mission-reset step are gone: five synced stores, not six. A
   snapshot written before this still has a top-level `sfaRotation`; it is read and dropped rather than refused (stores.js
   `DROPPED_KEYS`; the supervisor decides when that line goes).

4. **AP's handoff to PAR is an ordinary strip transfer (T1).** A `TransferStrip` of an ARRIVAL at INBOUND into the receiving
   Position's Bay that implies `ON_FINAL` converts it in place to a FINAL at ON_FINAL with PAR (`par-final.js` `PAR_HANDOFF`,
   checked in `transfer-strip.js` in place of the Bay-implied NLA check): same Strip, same flight, the flight's frequency never
   touched. Only a Position with the capability column `handsOffToFinal` (AP) sends it; the state owner and open-proposal checks
   are `nlaPrecheck`'s. Staffing, consolidation and capacity are TransferStrip's own: an unstaffed PAR whose hat is offered to AP
   receives the Strip with the `UNSTAFFED_RECEIVER` warning (ADR 0110), and PAR's final Bay still holds one. The `sfaTransfer`
   field keeps its name (so a saved Strip reads) and records `kind: 'PAR_HANDOFF'`, from, to and the SFA Rack it left (null off
   the SFA Bay). The `SfaRotation` op is gone; the audit line of a converting transfer carries `conversion`. Any arrival may be
   handed to PAR this way (a drag); the "Hand off to PAR" button is offered beside the NLA only on AP's arrival on a rotating
   frequency. No frequency change is flagged or offered for the ¶4-7-3 a to e exceptions: the pilot's frequency is outside the
   Board, and the Strip's FREQ Block is AP's to amend.

5. **The PAR final ends when the aircraft lands (T5, H134 LT-RQ6 b, LT-RQ7 a).** "Landing assured" is gone. The final controller
   records two calls and makes one move (op `FinalCall`, `call` one of):
   - `BEGIN_DESCENT` (¶5-12-3): recorded once on the Strip (`finalCalls`), and it supersedes the active assigned altitude with
     none: from here the reference is the glidepath (¶5-12-4).
   - `CLEARED_TO_LAND` (¶5-10-13 a): recorded once; optional.
   - `LANDED`: the Strip leaves PAR for **GC directly** as an ARRIVAL at TAXI_IN in `gc-taxi-in` (the `LANDED` conversion, through
     the same TransferStrip), which frees `par-final` for the next aircraft. GC drops it the ordinary way (TAXI_IN's NLA).

   FINAL's NLA at an airfield is Landed by the same transfer; `BALL` is the carrier's alone (PAR no longer owns it). A missed
   approach stays FINAL's `BOLTER_WAVEOFF` in `par-missed`. `FinalCall` is held by the capability column `recordsFinalCalls`
   (PAR) and refused on the carrier, whose final keeps Ball and Waveoff. Every call is undoable (ADR 0100).

6. **PAR changes the assigned heading and altitude (H134 LT-RQ8 a).** The FINAL Block Map gains `7A` (ALT) and `9A-VECTOR`
   (HDG), the flight's clearance (ADR 0058), so PAR amends what AP assigned. They are on the FINAL Strip and on the FINAL Bay
   line as two fields. The carrier's FINAL Strip, which shares the map, gets them too.

7. **Conformance on a final (T11, H134 LT-RQ8 a, LT-RQ9 a).** A flight whose FINAL Strip is on final (ON_FINAL, or the carrier's
   BALL) gets **no heading check**: the final controller's headings are course guidance changed every few seconds and course
   deviation is its own call (¶5-12-4), so they are recorded, never alerted, and AP's last vector stops alerting at the handoff.
   At an airfield the **altitude is checked until Begin descent**, which ends the assignment (decision 5), so on the glidepath
   there is nothing to check. A missed approach (BOLTER_WAVEOFF) is checked again: its climb-out heading and altitude are
   assignments (¶5-10-12).

8. **The carrier final, ours.** JO 7110.65BB has no carrier (CATCC) procedures (research Q3: silent). By analogy with the PAR
   talk-down, **ours**: no heading and no altitude check from the carrier final on, with no descent call to wait for.

9. **The FINAL Bay line keeps a stuck Strip reachable (T5).** PAR's racks are replaced by the line, so the line carries the
   Strip's ⋯ menu and Drop beside its HDG, ALT and the four buttons (Begin descent and Cleared to land stay on it greyed once
   recorded). The empty Bay reads "No aircraft on final." (it no longer tells the controller where aircraft come from).

## Alternatives considered

- **Keep the rotation record and let AP set it.** Rejected: ¶5-10-15 c makes the selector follow the handoff; a record AP must
  keep in step is a second truth that drifts (the live test's own state).
- **Convert on the client: turn the drop into the old rotation op.** Rejected: every path that hands an arrival to PAR (drag onto
  the tab or the Bay, the button, a self-coordinated transfer) is a TransferStrip; the server is where it must work.
- **A new FINAL state for Cleared to land / Begin descent.** Rejected: the calls are records in either order, not a sequence of
  Bays, and FINAL's states are shared with the carrier.
- **Landed as BALL with a PAR Bay for it.** Rejected: the final controller's part ends at touchdown (¶5-12-8 d, ¶5-12-9); a Strip
  parked at PAR is T5 again.
- **Refuse a snapshot that still has `sfaRotation`.** Rejected for now: it would make an operator delete the whole Board for a
  record nothing reads.
