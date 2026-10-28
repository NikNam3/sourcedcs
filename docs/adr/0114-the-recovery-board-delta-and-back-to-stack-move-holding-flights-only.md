# 0114: The recovery board: Delta and Back to stack move holding flights only, and a commenced flight keeps the time it left

**Status.** Built (lane MARSHAL-BOARD, 2026-10-10). Rulings: decisions.md **H117** (side numbers, Delta per CV NATOPS 6.4.9, Back to
stack, the stack along the marshal radial), **H118** (the bolter turn-in follows each flight's assigned approach turn, 4, 6 or 8
nm), **H119** (the board shows the marshal position read-only). Builds on ADR 0113 (the carrier state, the EAT worked back from the
ramp time) and ADR 0064/0074 (the stack, the handoffs). Vocabulary is the glossary's: Position, Strip, Mutation.

## Context

After ADR 0113 an EAT is derived: `ramp time + slot x 60 s - fixToRamp`. Two things followed that the stack could not express.
Push time was never stored, so a ramp-time change rewrote the EAT of a flight that had already left its fix. And the Marshal had
no way to say "everyone holding is delayed" (Delta) or to take a flight back that had commenced.

## What CV NATOPS says (NAVAIR 00-80T-105, July 2009, p. 6-17, quoted as printed)

**6.4.9 Delta Procedures.** "In the event the deck becomes fouled or an excessive number of aircraft bolter or wave off, the CCA
Officer shall issue via marshal control a signal Delta. The signal Delta shall be accompanied by the number of minutes of delay
(even increments but never less than four) required to resume recovery operations (i.e., Delta 4, Delta 6, and so forth).

1. In marshal: Aircraft shall continue holding and await assignment of new EAT.
2. Commenced aircraft: Commenced aircraft above 7,000 feet shall level off at the next lower odd altitude and hold on the inbound
   bearing at a range in nm equal to holding altitude in thousands of feet plus base distance (angels + 15). ... Aircraft at or
   below 7,000 feet will continue the approach.
3. Issuance of EATs: Marshal control shall issue new EATs as soon as possible. To preclude two aircraft having the same EAT, new
   EATs shall be issued from the latest to the earliest (i.e., top of the holding pattern to the bottom). Aircrews shall
   acknowledge receipt of the new EAT."

**DELTA** (glossary): "A signal given to hold and conserve fuel at an altitude and position appropriate to type aircraft and case
recovery in effect." **EAT**: "The future time at which an aircraft is cleared to depart inbound or penetrate from a preassigned
fix."

## Decisions

1. **A commenced flight keeps the time it left.** `MarkPushed` stores `pushedAtUtc` (the mission clock at Commence) and `eatUtc`
   (the EAT it was working to, with any Delta in it) on the stack entry. They are facts of a past event, not derived values: the
   derivation returns them for a flight that has pushed, so a ramp-time change or a Delta never rewrites them. They are cleared
   when the flight returns to the stack, and a holding entry carrying them is refused. (`pushTimeUtc` and the other derived names
   stay refused as stored keys.)
2. **Delta** is a stack op `{ kind: 'Delta', minutes }`: an even integer, never less than 4 (60 is our sanity cap, NATOPS sets
   none). It adds to the stack's `deltaMs`, which the derivation adds to a **holding** flight's EAT; a commenced flight is not
   touched ("it is not applied automatically to commenced aircraft", H117). Each Delta adds to the last. `changed` lists the holding
   flights top of the stack first, the order NATOPS issues the new EATs in. It is refused without a ramp time (no EAT to move) and
   with nobody holding. Only the Marshal sequences the stack (`sequencesStack`).
3. **A new ramp time clears the Delta.** The Delta was a delay on the old schedule; the Marshal or PriFly who types a new ramp time
   has allowed for it. (Ours; a default, logged in the lane note.)
4. **Back to stack** (H117) is a carrier handoff, `COMMENCED_TO_MARSHAL`, on the same machinery as the other four (audited, undoable
   for 10 s, trigger `CONTROLLER_INITIATED`, Case II and III): the Strip goes COMMENCED to IN_STACK, owned by CV_MARSHAL, and the
   stack entry (effect `RETURN_TO_STACK`) takes **the slot above the highest entry**, status HOLDING, push time cleared. Nobody else
   moves. The Strip is the lane's, so this is the one transfer the Marshal makes on a Strip it does not own, a named row in
   `mayActBesideOwner`. It applies to COMMENCED only: a flight the lane already has on final (FINAL) is not taken back.
   Undo restores the entry whole (slot, status, push time): `restoreCheck` now answers `RESTORE_ENTRY` where it answered
   `UNMARK_PUSHED`, refused when the slot has been refilled.
5. **Side number** is a flight field, `military.carrier.sideNumber` (1-8 letters or digits), the Block `C18` on MARSHAL (typed) and
   FINAL (read). The recovery board names every flight by it; a flight without one is listed by its callsign, marked.
6. **Approach turn** is a flight field, `military.carrier.approachTurnNm` (4, 6 or 8), Block `C19`. The board draws the bolter
   racetrack's turn-in there; none assigned draws 6 (ours).
7. **Status** on the board is read from the Strip, not stored: MARSHAL IN_STACK is HOLD, COMMENCED is COMM, FINAL ON_FINAL is
   APP A or B (CV_APP1 or CV_APP2), BOLTER_WAVEOFF is BOLTER, BALL is BALL, PATTERN is PATTERN.
8. **Low state, past EAT and the changed-clearance marks are the client's.** Low state compares the typed fuel (`lowStateLb`) with
   bingo (`bingoFuelLb`) against the controller's margin; a flight is past its EAT when the mission clock is past the end of its
   push window; the amber mark on a changed angels or EAT lives in the panel and is cleared by clicking the row. None is stored
   or sent, so a second Marshal controller sees only the marks they have not cleared themselves.
9. **`marshalMessage()` is still not sent.** The board does not need it; it stays built for the Strip's marshal message.
10. The ordering and slot board of the `cv-marshal-stack` Bay is removed (the MARSHAL panel replaces it); the Bay keeps the Strips.
    No foul-deck state exists, so none is drawn.

## Consequences

- Wire: stack entries gain `pushedAtUtc`, `eatUtc`; the stack gains `deltaMs`; two Block ids; a handoff kind. `wire:record` sees no
  surface change (it does not scan carrier op kinds) and `WIRE_PROTOCOL` stays 2, ahead of the last release.
- `state/efsp-board.json` written by an earlier build is read without the new keys (they default); no migration is needed.
