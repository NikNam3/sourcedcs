# 0165: Remarks on the data block, and any Highlight colour but red

**Status.** Accepted (2026-11-15). [SOURCE-DEFINED]: the human's requests of 2026-11-15 ("remarks need to be not only
shown on the strip but also on the track label with a different colour than the track itself"; "for the colour picker
more colours or a hex palette + predefined colours would be nice"). Decision Desk LR-Q1..Q3 open; their recommended
defaults (a) are taken. Builds on H138 U2 / H139 (the Strip's remarks row), guide §7.3 / §7.7 rule 4 (Highlight, red is
Attention's) and ADR 0088 (the ATC data block).

## Context

A flight's remarks (`filed.remarks`, Block 9E on the ATC and carrier maps, M8 on MISSION) are on the Strip's bottom row
only. A controller looking at the scope has to turn to the Board to see that a flight is NORDO or carries a VIP. The
Highlight popover had three swatches (yellow, cyan, lime), too few to tell several marked flights apart.

## Decision

1. **Whose remarks.** A track's data block carries the remarks of a correlated, not-DROPPED Strip this controller's
   acting Position owns (`panels/efsp/track-remarks.js`, the same rule as the Highlight colour on the callsign,
   `track-highlight.js`); the first such Strip with remarks wins. Another Position's flight shows none: its remarks are
   that controller's to brief, and a scope that does not work the flight stays as it was (dark cockpit). Blank remarks
   are none.
2. **What.** One last line: the remarks with whitespace folded onto one line, the first 20 characters
   (`track-label.js` `remarksLabelText`; cut mid-word, the Strip and its text-box window have the whole text). On the
   ATC full data block only (a PDB or LDB is not a flight this controller works), and on the tactical label of any
   aircraft, on the ground too (a ground label is otherwise callsign only; NORDO matters on the ground).
3. **Colour.** Its own, lavender `#c49cff` by default, set under Settings → Colours → Track Labels → Remarks
   (`colRemarks`; `track-label.js` `remarksColor`). Not the track's colour, not red, not the Highlight colour of the
   callsign.
4. **Geometry.** The ATC block's segment cap (`ATC_MAX_SEGMENTS`) goes from 16 to 24: the remarks line adds two (its
   break and its text) to a worst case (EM, CA, SAA, SA and a conformance tag on line 0, two suffixes on line 1) that
   already passed 16. A block's box is estimated from its text (`label-box.js`: 0.6 em a glyph, 1.2 em a line, MapLibre
   reports no symbol box). A block wider than the base half width (`LABEL_HALF_W`, 30 px) is nudged sideways by its
   `text-offset` so its track-facing side stays where a base-width block's would be: it grows away from its track, on
   whichever side it sits. The leader aims at the drawn block's centre and stops at its box edge, never shorter than
   before. This applies to every block, not only those with remarks.
5. **Highlight colours.** Eight swatches, in Ctrl+click order (`panels/efsp/highlight-colour.js`): yellow `#ffe14d`,
   cyan `#33e0ff`, lime `#7cff4d`, orange `#ff9f1a`, pink `#ff6ec7`, violet `#a77bff`, white `#f2f2f2`, sky blue
   `#6cb8ff`, all light enough for the dark Board and the map. Below them a `#RRGGBB` box (Enter sets it) for any
   other colour. Ctrl+click steps through the eight, then off; a colour that is no swatch (typed, or a name an older
   client wrote) steps to the first. The × clear stays.
6. **Never red.** A colour is red, and refused with "Red is ATTENTION's, not a highlight", when its HSV hue is within
   20° of 0° (inclusive) with saturation ≥ 0.4 and value ≥ 0.35 (`isNearRed`): a pale pinkish grey or a dark brown is
   not mistaken for Attention. Orange (35°) and pink (323°) swatches are outside it.
7. **The server.** crc-sync's SetFlag stores `flags.highlight` as any value, as before. Shape validation (null, a
   swatch name or `#rrggbb`) was left out: the freeze traces set `'red'` as a highlight, so it would change a golden,
   which a lane cannot re-run. No wire change; the protocol stays 8.

## Consequences

- The tactical label's `format` gains `rmkLine` / `rmkColor`; the ATC block's remarks are one more segment line.
- A tooltip on the Strip's edge names a swatch (`Highlight: violet`) and shows a typed colour as stored.
- Every existing block wider than 60 px is now nudged and its leader clipped at its box: a small visible change.
- Strips stored with the old names (`yellow`, `cyan`, `lime`) still draw in those CSS colours.
