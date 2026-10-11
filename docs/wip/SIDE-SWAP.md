# SIDE-SWAP — the side number takes the callsign's slot on carrier Strips

Ruling: decisions.md **H122** (answers MARSHAL-BOARD default 4; H117 "aircraft are identified by side number only").
Client, plus one crc-sync line: PATTERN's Block Map gains a read-only C18 (second agent, below). Wire unchanged
(`wire:record`: stays 2, surface unchanged); freeze golden `blockMap.PATTERN` re-recorded (separate commit); walk 23/23.

## What moved where

The Strip face is a grid of fields in the order `strip-fields.js` lists them. The callsign's "slot" on a carrier Strip was
first place and two columns wide (`FIELD_SPANS.C1 = 2`); C18 (SIDE) was third and one column. C1 was never bold or larger
(only the CIV Block 1 is, `.efsp-block-1`), so "prominence/size" is place and width.

| Strip type | Facility Position | Before | After, once a side number is typed |
|---|---|---|---|
| MARSHAL | CV_MARSHAL | CALLSIGN (C1, 2 cols), TYPE, SIDE (C18, 1 col), … | SIDE (C18, 2 cols), TYPE, CALLSIGN (C1, 1 col), … |
| FINAL | CV_APP1 / CV_APP2 | same | same swap (C18 is read-only there, as before) |
| PATTERN | CV_PRIFLY | CALLSIGN, TYPE, NOTE | SIDE (C18, 2 cols), TYPE, CALLSIGN (C1, 1 col), NOTE; with no side number CALLSIGN, TYPE, NOTE as before (no empty SIDE) |

The rule: a strip type whose Block Map has both C1 and C18, owned by a CARRIER Position (`sideNumberLeads(stripType,
positionId, flightData)` in `crc-desktop/app/public/js/panels/efsp/strip-fields.js`, via `facilityOfPosition`; FINAL and
PATTERN are also Incirlik's strip types at PAR and RSU, which never swap). `compactBlocksFor()` swaps the two ids,
`fieldSpanFor(id, sideLeads)` swaps their widths; `strip-view.js` passes it. PATTERN's SIDE is read-only
(`carrier-derived`, like FINAL's) and is on the face only while it leads (`SIDE_ONLY_WHEN_LEADING`), so RSU's Strips and a
side-less carrier PATTERN look exactly as before. The labels go with their Blocks (SIDE / CALLSIGN). The expanded view (▼)
is unchanged. The Strip rebuilds on the flight's `rev`, so typing the side number moves the field at once.
Non-carrier Strips are unchanged (the server's Block Maps are untouched).

## Defaults taken (P2)

1. **No side number yet: the callsign keeps the big slot** (briefing default). A Strip is never led by an empty field; the
   swap happens the moment one is typed, and undoes if it is cleared. Whitespace-only counts as none.
2. **No new emphasis** (dark cockpit): the side number gets the callsign's place and width, nothing bolder or coloured, because
   C1 had nothing more.
3. ~~PATTERN unchanged~~ (first agent). Replaced by the second agent: H122 covers every carrier Strip, so PATTERN gets C18
   (`carrier-derived` sideNumber, both Block Maps, parity-held), read-only because the Marshal types it, drawn only while it leads.
4. **Carrier = owner Position in the CARRIER Facility** (the supervisor's "everything in the CARRIER Facility"), not "the Block
   Map has C18": the first version would also have swapped an Incirlik PAR FINAL Strip carrying a side number.
5. **The Bay search also matches the side number** (`searchEfspStrips`, efsp-state.js), since the carrier names aircraft by it.

## Usage-guide wording (for the supervisor to place, carrier section)

"On a carrier Strip (MARSHAL, FINAL, PATTERN) the aircraft is named by its side number: once the Marshal types it in SIDE, it
moves to the first, wide field and the callsign moves to SIDE's place. Until a side number is typed the callsign leads (a PATTERN
Strip then shows no SIDE at all). The Bay search finds a Strip by its side number too."

## Tests

- Unit: four tests in `crc-desktop/tests/efsp-strip-fields.test.mjs` (swap on MARSHAL/FINAL incl. spans; every carrier
  strip type has C18 and swaps; carrier PATTERN with/without side; no side number, non-carrier, PAR FINAL and RSU PATTERN
  unchanged) and one in `efsp-state.test.mjs` (search by side number). Module-graph fixture re-recorded (`sideNumberLeads` exported from strip-fields.js).
- e2e: `crc-desktop/e2e/side-swap.spec.js` (MARSHAL: callsign big, type the side number in the field, side big and wider,
  callsign small and still found by text; Commence + Radar contact: FINAL leads with the side number too; test 02: Case II
  See you to PriFly, the PATTERN Strip with a side number leads with it, the one without shows the callsign and no SIDE
  field, and the search finds the side number).
- The carrier specs locate Strips by `.efsp-block-C1` text or by the callsign text anywhere on the Strip, never by field
  position, so none needed a change.

## Findings / for the supervisor

1. **Places still led by the callsign on carrier screens, not Strips, so left alone:** the PriFly pattern board chip
   (`pattern-board.js`, `.efsp-pattern-cs`), the FINAL talk-down panel head (`final-panel.js`, `.efsp-final-callsign`) and
   the PATTERN Strip itself. H117 says "side number only" in the carrier regime; if the ruling covers these, a follow-up
   needs the side number in the pattern/final view models. (PATTERN's Strip is now covered, see above.)
2. The MAP correlation highlight and the `strip(page, callsign)` helpers key on the flight's callsign data or on the
   `.efsp-block-C1` element, which is still on the Strip: unaffected.
