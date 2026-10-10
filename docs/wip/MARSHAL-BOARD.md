# Lane MARSHAL-BOARD (2026-10-10)

Branch `lane/MARSHAL-BOARD-build`. ADR **0114**. Briefing: `docs/parallel/next/CARRIER-PANELS.md` section 3. Rulings: H117, H118, H119.
Built: the MARSHAL panel (recovery board, mockup revision 7) and its server half.

## CV NATOPS citations

6.4.9 Delta (p. 6-17) quoted in full in ADR 0114: even minutes, never less than four; in marshal hold and await a new EAT; commenced
aircraft above 7,000 ft return to holding (here the Marshal's manual Back to stack); new EATs issued top of the stack to the bottom.
Glossary DELTA and EAT quoted there too. Earlier lanes' citations (ramp time, 6.4.1.1, 6.4.5) are in ADR 0113.

## Server

- Stack entry: `pushedAtUtc`, `eatUtc` (written at Commence, cleared at Back to stack); stack: `deltaMs`. `Delta` and `BackToStack`
  stack ops (`STACK_OP_KINDS`), the handoff `COMMENCED_TO_MARSHAL` (effect `RETURN_TO_STACK`), `mayActBesideOwner` row for it.
- Flight fields `sideNumber`, `approachTurnNm`; Blocks `C18` (MARSHAL typed, FINAL read) and `C19` (same).
- Undo of Commence / Back to stack: `restoreCheck` action `RESTORE_ENTRY` (was `UNMARK_PUSHED`).

## Client

- `marshal-panel.js` (panel, settings tab `marshal`), `marshal-board-model.js` (pure rules), `marshal-picture.js` (SVG), `marshal-panel.css`.
- Removed: `carrierOrderRack`, the stack board, `carrierMoveToSlot`, the Bay's slot drop target. The Bay keeps the Strips.
- Settings tab MARSHAL: `marshalLowStateMarginKlb` 1.0, `marshalMarkChanged` true. No "fuel report old" setting: the mockup's tab
  has none, and no fuel report time is stored.

## Defaults taken (P2)

1. A new ramp time clears the Delta (ADR 0114 decision 3).
2. Delta is refused with no ramp time or nobody holding; 60 min cap is ours.
3. Back to stack: slot above the highest entry (pushed entries included), only for COMMENCED (not FINAL), only the Marshal, Case II/III.
4. A flight with no side number is listed by its callsign in grey (a row is never anonymous). The Strips keep their C1 callsign
   Block; SIDE (C18) is added beside it. Replacing C1 on carrier Strips was not done (H117 says "everywhere"; the board is where it
   matters; say if the Strips should follow).
5. Approach turn: Block `C19` on the flight, default 6 drawn when unassigned (ours). The bolter racetrack is drawn once at the
   default when nobody is on it, otherwise once per distinct turn-in of the bolters.
6. "Approach" in the header: the staffed lanes as ATC-scope letters (`CV-1 CV-2`); the mockup's "CV-1" had no data behind it.
7. Header ramp time is read-only (typed in the carrier panel); the mockup's editable field is not built (H119).
8. Past EAT = mission clock beyond the end of the +/-10 s push window, on any holding flight.
9. Marks (changed angels/EAT) are per controller and in memory: lost on reload, not shared between two Marshal controllers. An EAT
   that appears from nothing (ramp time first set) is not a change. Back to stack marks both.
10. Vacancies (H28) are rows with a "Close up" button for the Marshal, so the old board's function is not lost.
11. `marshalMessage()` still not sent.
12. A bolter or commenced flight with no radar contact is listed but not drawn on the picture (no DME to place it by).

## Usage-guide wording (docs/efsp-usage-guide.md, section 4.1)

- "The **MARSHAL** panel lists every aircraft in the recovery in landing order, next to land at the top: sequence, side number,
  type, fuel (thousands of pounds) and EAT minute, angels, and status (HOLD, COMM, APP A or B, BOLTER). Beside it is the Case III
  picture. Only the Marshal changes anything; the other carrier Positions read it."
- "Drag a HOLD row onto another HOLD row to re-sequence. **Commence** is on the next flight to push. A commenced flight can be sent
  **Back to stack**: it takes the next slot at the top. **Delta** (even minutes, at least four) moves the EATs of the aircraft
  holding; commenced aircraft are not moved. An angels or EAT that changed shows amber until you click the row to say it was passed."
- "Amber also means fuel within the margin of bingo (Settings, MARSHAL) and a flight past its EAT that has not pushed; red is fuel at
  or below bingo. Fuel and bingo are the Low state and Bingo fuel Blocks of the Strip. The side number and approach turn are Strip Blocks."

## Walks (pilot requests)

Done as tests (`crc-sync/tests/efsp-marshal-board-store.test.mjs`, `efsp-scenario-marshal-board.test.mjs`, specs in `e2e/marshal-board.spec.js`):
- ramp time changed after some flights pushed: pushed keep EAT and push time, holding follow;
- Delta with a commenced flight: it is not moved; Delta then Commence records the EAT with the Delta in it;
- Back to stack then Delta: the returned flight is holding and takes it; top of the stack first;
- a flight leaving the stack (divert/bingo) mid-sequence: vacancy, other EATs unchanged;
- two Marshal controllers: second Back to stack refused; Move and Delta interleave; undo of Back to stack restores slot and push time.
Not done: a real DCS ship (DME placement of aircraft on the picture, radar-ordered APP rows) is not exercised in the harness (no
radar contacts); the DME order is unit tested (`marshal-board-model.test.mjs`). Two Marshal controllers' marks diverge by design.

## Seams for CARRIER-MAP (what "occupied" can be read from)

Per flight, from Strips: MARSHAL IN_STACK (holding, the stack), MARSHAL COMMENCED (inbound to final), FINAL ON_FINAL (on final),
FINAL BOLTER_WAVEOFF (the Case III bolter racetrack is occupied), FINAL BALL, PATTERN IN_PATTERN (Case I/II pattern and spin
occupied). `buildBoard(...).rows[].kind` (`hold|comm|approach|bolter|ball|pattern`) in `marshal-board-model.js` already maps them.
`row.turnNm` is the assigned approach turn; `row.marshalDme` / `angels` the fixes.

## Findings

- `wire:record` does not scan carrier op kinds (as CARRIER-STATE found); protocol stays 2.
- One baseline crc-sync test (`ato tokenize: pathological inputs scale linearly`) is timing-flaky when the desktop suite runs alongside.
- `l17-carrier.spec.js` tests 02, 04, 06 were rewritten onto the MARSHAL panel.
