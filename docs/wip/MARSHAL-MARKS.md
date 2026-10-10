# Lane MARSHAL-MARKS (2026-10-10)

Branch `lane/MARSHAL-MARKS`. ADR **0115**. Ruling: decisions **H123** (3) (answers S-ARCH-39). Builds on MARSHAL-BOARD (ADR 0114,
`docs/wip/MARSHAL-BOARD.md` default 9, which this lane replaces).

## Design

- **Server, `crc-sync/src/efsp/carrier/marshal-stack.js`.** The stack entry gains `unpassed` (`[]`, `['angels']`, `['eat']` or
  both; HOLDING only). `markClearanceChanges(stack, before, after)` is the one rule for what counts as a change (derived stacks
  either side of an op). `passClearance` is a stack op (`PassClearance`, in `STACK_OP_KINDS`). Back to stack sets both; MarkPushed
  (Commence) clears; insert/append start with `[]`. `validateStack` refuses a bad list or one on a PUSHED entry; `normalizeStack`
  reads a missing one as `[]`. `deriveEntry` passes it through, so the hull view's `derived.MAIN[]` carries it.
- **Server, `crc-sync/src/efsp/carrier-store.js`.** `_stackOp` and `_setState` (Case, ramp time) derive every stack before, apply,
  and call `_markChanges`. PassClearance gets the derived angels/EAT as `opts.current` so a pass of values that changed again is
  refused; the audit line carries `flightDataId`, `passed`, `angels`, `eatUtc`. Nothing-to-pass returns `unchanged` (no bump).
- **Persisted shape**: `unpassed` added to `stores.js`'s carrier entry shape.
- **Client.** `marshal-board-model.js`: `createMarks`/`updateMarks`/`passMarks` removed; `buildBoard` puts the entry's `unpassed` on
  the row, `marksOf(row, {enabled})` reads it, `passClearanceOp(row, {enabled})` builds the op (null when nothing is shown).
  `marshal-panel.js`: a click on a marked HOLD row sends it, only when this controller sequences the stack and sees the mark.

## Defaults taken (P2)

1. **Non-sticky?** No: a mark stays until passed even when the value moves back (a Move up then down still shows amber). Same as
   MARSHAL-BOARD's client.
2. **Commence clears the mark** (the flight has left its fix); **Undo of Commence brings it back** (the entry image is restored
   whole). Undo of Back to stack: commenced again, no marks.
3. **A marked flight that leaves** (Strip dropped, See you, To pattern, mission reset) takes the mark with it. A carrier flight has no
   Divert op (ADR 0111 is OVERFLIGHT/ARRIVAL); "diverts to the beach" is the Marshal's DropStrip today, walked as that.
4. **PassClearance names the values read** and is refused if they changed since (VALIDATION_ERROR, no new refusal code). A second
   click on an already-passed row is `ok`, writes nothing, no toast.
5. **Only the Marshal passes** (the stack's sequencing permission). Other carrier Positions and an Observer see the amber but a click
   sends nothing.
6. **No Undo for PassClearance**: the carrier-family stack ops (Move, Delta, CloseUp) have none either.
7. **The setting off**: no amber for this controller and their click sends nothing (they cannot pass what they do not see).
8. **Ramp time cleared**: an EAT that goes away adds no mark; an existing `eat` mark stays (shown on `--`) until passed. Edge, ours.
9. **Case change** I to III marks the angels when a Case I altitude had been typed and differs; the EAT appearing is not a change.

## Usage-guide wording (docs/efsp-usage-guide.md, section 4.1, replaces MARSHAL-BOARD's last sentence of the second bullet)

- "An angels or EAT that changed (a re-sequence, a Delta, a new ramp time, Back to stack) shows amber until you click the row to say
  you passed it to the pilot. The marks are the ship's, not your window's: every Marshal controller sees the same ones, they are
  still there after a reload or a crc-sync restart, and when you click the row it clears for everyone. If the clearance changed
  again just before your click, the click is refused: read the row again and pass the new value. Only the Marshal clears a mark;
  the other carrier Positions see it. Settings, MARSHAL, "Mark changed clearances until passed" hides the amber on your screen only."

## Walks

As tests: `crc-sync/tests/efsp-marshal-marks.test.mjs` (store, 12) and `efsp-scenario-marshal-marks.test.mjs` (wire, 5);
`crc-desktop/e2e/marshal-board.spec.js` test 07 (two pages, reload, pass, the setting).
- **Delta then reload**: spec 07 (the Marshal's page reloads, the marks are there); **Delta then restart**: the wire walk persists,
  builds a new EFSP from the snapshot, the marks are back, the PassClearance line is in the Mutation log with its values.
- **Pass on one Marshal while the other has it open**: spec 07 (a second controller as Observer at CV_MARSHAL; their click passes
  nothing; the Marshal's click clears it on both pages). Wire walk: PriFly refused, second click a quiet no-op. Store test: another
  Marshal's Delta between read and click refuses the pass and leaves the mark.
- **Back to stack then Undo**: both marked; Undo leaves the flight PUSHED with no marks.
- **A marked flight that commences**: the mark goes; the Commence undone brings it back. **That leaves** (DropStrip): its mark goes,
  the others keep theirs.
- Not walked: two Marshal Primaries at once (one Position has one Primary; a second Marshal is an Observer, or another
  controller after consolidation, ADR 0110).

## Findings

- `wire:record`: "WIRE_PROTOCOL stays 2 (last release speaks 1); surface unchanged." It does not scan carrier op kinds or stack
  entry keys (as CARRIER-STATE and MARSHAL-BOARD found), so this wire change is not detected by it; the release carries it anyway
  because 2 is already ahead.
- An Observer at CV_MARSHAL reads the same board; a click on a marked row there clears nothing (spec 07 checks the mark is still
  there half a second later; whether the click is not sent or refused by the Primary gate, the result is the same).
