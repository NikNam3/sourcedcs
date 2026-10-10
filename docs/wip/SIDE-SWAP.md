# SIDE-SWAP — the side number takes the callsign's slot on carrier Strips

Ruling: decisions.md **H122** (answers MARSHAL-BOARD default 4; H117 "aircraft are identified by side number only").
Client only. No crc-sync file changed, so no wire, freeze or walk change.

## What moved where

The Strip face is a grid of fields in the order `strip-fields.js` lists them. The callsign's "slot" on a carrier Strip was
first place and two columns wide (`FIELD_SPANS.C1 = 2`); C18 (SIDE) was third and one column. C1 was never bold or larger
(only the CIV Block 1 is, `.efsp-block-1`), so "prominence/size" is place and width.

| Strip type | Facility Position | Before | After, once a side number is typed |
|---|---|---|---|
| MARSHAL | CV_MARSHAL | CALLSIGN (C1, 2 cols), TYPE, SIDE (C18, 1 col), … | SIDE (C18, 2 cols), TYPE, CALLSIGN (C1, 1 col), … |
| FINAL | CV_APP1 / CV_APP2 | same | same swap (C18 is read-only there, as before) |
| PATTERN | CV_PRIFLY | CALLSIGN, TYPE, NOTE | unchanged: its Block Map has no C18 (see findings) |

The rule is structural: any strip type whose Block Map has both C1 and C18 swaps (`sideNumberLeads()` in
`crc-desktop/app/public/js/panels/efsp/strip-fields.js`; `compactBlocksFor()` swaps the two ids, `fieldSpanFor(id, sideLeads)`
swaps their widths; `strip-view.js` passes it). The labels go with their Blocks (SIDE / CALLSIGN). The expanded view (▼)
is unchanged. The Strip rebuilds on the flight's `rev`, so typing the side number moves the field at once.
Non-carrier Strips are unchanged (the server's Block Maps are untouched).

## Defaults taken (P2)

1. **No side number yet: the callsign keeps the big slot** (briefing default). A Strip is never led by an empty field; the
   swap happens the moment one is typed, and undoes if it is cleared. Whitespace-only counts as none.
2. **No new emphasis** (dark cockpit): the side number gets the callsign's place and width, nothing bolder or coloured, because
   C1 had nothing more.
3. **PATTERN unchanged**: it has no side number Block; adding C18 to it is a server Block Map change (freeze, walk), beyond
   "as small as the ruling".

## Usage-guide wording (for the supervisor to place, carrier section)

"On a carrier Strip (MARSHAL, FINAL) the aircraft is named by its side number: once the Marshal types it in SIDE, it moves to
the first, wide field and the callsign moves to SIDE's place. Until a side number is typed the callsign leads."

## Tests

- Unit: two tests in `crc-desktop/tests/efsp-strip-fields.test.mjs` (swap on MARSHAL/FINAL incl. spans; no side number,
  PATTERN and non-carrier unchanged). Module-graph fixture re-recorded (`sideNumberLeads` exported from strip-fields.js).
- e2e: `crc-desktop/e2e/side-swap.spec.js` (MARSHAL: callsign big, type the side number in the field, side big and wider,
  callsign small and still found by text; Commence + Radar contact: FINAL leads with the side number too).
- The carrier specs locate Strips by `.efsp-block-C1` text or by the callsign text anywhere on the Strip, never by field
  position, so none needed a change.

## Findings / for the supervisor

1. **Places still led by the callsign on carrier screens, not Strips, so left alone:** the PriFly pattern board chip
   (`pattern-board.js`, `.efsp-pattern-cs`), the FINAL talk-down panel head (`final-panel.js`, `.efsp-final-callsign`) and
   the PATTERN Strip itself. H117 says "side number only" in the carrier regime; if the ruling covers these, a follow-up
   needs the side number in the pattern/final view models (and C18 on PATTERN's Block Map, a crc-sync change).
2. Search, the MAP correlation highlight and the `strip(page, callsign)` helpers key on the flight's callsign data or on the
   `.efsp-block-C1` element, which is still on the Strip: unaffected.
