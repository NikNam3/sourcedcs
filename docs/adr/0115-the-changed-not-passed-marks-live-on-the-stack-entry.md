# 0115: The "changed, not yet passed" marks live on the stack entry, and passing one is a stack op

**Status.** Built (lane MARSHAL-MARKS, 2026-10-10). Ruling: decisions.md **H123** (3): MARSHAL's "changed, not yet passed" marks
live on the server, shared by every Marshal controller, and survive a reload. Replaces ADR 0114 decision 8 for the marks only (low
state and past EAT stay the client's). Builds on ADR 0064/0074 (the stack, its ops), 0113 (the EAT worked back from the ramp time)
and 0114 (Delta, Back to stack, the push time on record). Vocabulary is the glossary's: Position, Strip, Mutation.

## Context

ADR 0114 kept the amber marks (an angels or EAT that changed and has not been passed to the pilot) in the MARSHAL panel: each
window compared what it saw with what it had seen before. So a reload forgot every mark, a second Marshal controller saw only the
marks they had not cleared themselves, and nobody could tell afterwards whether a new EAT had been passed. The human ruled (H123)
that the marks belong to the recovery, not to a window.

## Decisions

1. **The mark is a stored fact on the stack entry**: `unpassed`, a list of `'angels'` and/or `'eat'` (each once, in that order),
   on a HOLDING entry; a PUSHED entry carries none (validateStack refuses one). It persists with the rest of the stack in the Board
   snapshot (`carriers[].stacks.*.entries[].unpassed`), and the hull view's derived entries carry it to every client. It is the
   last of the clearance not yet told, not a derived value: it cannot be recomputed from the stack, because what the pilot was
   told is history.
2. **The server alone decides what counts as a change** (`markClearanceChanges`, marshal-stack.js), with MARSHAL-BOARD's rules: the
   store derives every stack before and after each stack op, Case change and ramp-time change, and marks a field of a flight
   that was HOLDING both times when it moved **from a value to another value**. A value that appears from nothing (the ramp time
   first set, a Case I altitude first typed) was never told, so it is not a change; one that goes away (the ramp time cleared)
   leaves nothing to pass. A new flight in the stack is told its clearance as it checks in: not marked. A mark stays until passed,
   even if the value later moves back (the pilot may have heard nothing in between, ours).
3. **Back to stack marks both**, whatever they read (H117: "new angels/EAT marked until passed"). **Commence clears the marks**:
   the flight has left its fix, so the old clearance is moot. A flight that leaves the stack (dropped, See you, To pattern, the
   mission reset) takes its marks with it. An Undo restores the entry whole, marks included (ADR 0100): undoing a Commence brings
   back what was not passed; undoing a Back to stack leaves the flight commenced with nothing to pass.
4. **Passing is a stack op**, `{ kind: 'PassClearance', flightDataId, angels, eatUtc }`, the Marshal's click on the row. Only the
   Position that sequences the stack (`canSequenceMarshalStack`, the Marshal) may send it. It names the angels and EAT the Marshal
   read; when either differs from the derivation now (another Marshal's Delta landed between the read and the click) it is
   refused (VALIDATION_ERROR, "changed again"): a clearance that changed again has not been passed. Nothing left to pass (two
   Marshals clicked the same row) is `ok` and writes nothing. The audit line names the flight, the fields passed and the values
   (`flightDataId`, `passed`, `angels`, `eatUtc`), with the actor, the Position and the mission-clock `at` every Mutation carries.
5. **No Undo for PassClearance.** The other stack ops a controller sends on the carrier family (Move, Delta, CloseUp) have none
   either (ADR 0100 covers the Board's Mutations and the stack effects of carrier handoffs). A pass made by mistake is put right
   by telling the pilot again; the mark does not come back.
6. **The `marshalMarkChanged` setting is the controller's view only.** Off, this controller sees no amber and a click on a row
   sends nothing (they cannot pass what they do not see); the marks stay on the server for everyone else.

## Consequences

- Wire: the stack entry (and so the derived entry in the hull view) gains `unpassed`; a stack op kind `PassClearance`.
  `wire:record` does not scan carrier op kinds or entry keys and reports the surface unchanged; `WIRE_PROTOCOL` stays 2, already
  ahead of the last release (1), so the next crc-desktop release carries this.
- `state/efsp-board.json`: `unpassed` joins the persisted shape. A snapshot written before this build has no `unpassed` and reads
  as nothing to pass (normalizeStack); nothing else changes.
- crc-desktop: the panel's own mark state (`createMarks`, `updateMarks`, `passMarks`) is removed; `marksOf(row)` reads the entry's
  `unpassed` and `passClearanceOp(row)` builds the op.
- Three carrier freeze goldens move (they hash the stack entries).
