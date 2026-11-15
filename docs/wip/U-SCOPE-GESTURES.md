# U-SCOPE-GESTURES: Ctrl+drag heading, Alt+wheel altitude (docs/adr/0164)

Branch `lane/U-SCOPE-GESTURES` (cut from `cancel-ff`).

## What was built

- Ctrl + drag from an owned contact's target / square / label: line + magnetic heading readout, release sends HDG
  (nearest 5°, 360 for north), overwrites. Esc, blur, or a release within 8 px of the press: nothing.
- Alt + wheel over it: preview of the assigned altitude on the block (`A140?`), 1,000 ft per notch, 100 ft with Shift,
  sent once on Alt release. Blocks move whole; `<`/`>` prefixes kept. Esc / blur / a pointer move without Alt cancel.
- Both only where the label menu would offer that cell (labelAssignmentForTrack), sent as the cell's SetBlock.

## Module layout (crc-desktop/app/public/js)

| file | job |
|---|---|
| `scope-gestures/gesture-values.js` | pure: roundHeading, headingText, parseAssignedAltitude (client twin of crc-sync's parseAltitude, plus `<`/`>`), formatAssignedAltitude / altitudeEndText (twin of formatAltitudeEnd/Block), shiftAltitude, altitudeStart, wheelNotches |
| `scope-gestures/alt-preview.js` | leaf: the one Alt+wheel preview; `withAltPreview` for the ATC block |
| `scope-gestures/assign-send.js` | the Strip cell a gesture writes (label menu's rule) and the SetBlock |
| `scope-gestures/contact-hit.js` | contact under a canvas point (target, square, label layers) |
| `scope-gestures/hdg-drag.js` | the Ctrl+drag gesture |
| `scope-gestures/alt-wheel.js` | the Alt+wheel gesture |
| `map-layers-gestures.js` | the line + readout source/layers (map-layers-overlays.js is at 325 lines) |

Hooks: `map-interactions.js` (+8 lines), `map-setup.js` (+2), `geojson.js` buildAssignedLine (+preview, takes the
track id), `atc-scope.js` (`withAltPreview` around `atcAssigned`), `track-label.js` (`assignedPreviewText`, one branch in
`atcAssignedText`). No import cycle (module-graph test green).

## Usage-guide text (for docs/efsp-usage-guide.md, the label-menu section)

> **Vector by drawing.** Hold Ctrl and drag from a flight's target, square or data block: a line follows the cursor with
> the magnetic heading at its end, rounded to 5°. Let go to assign it; it replaces the heading the flight had. Esc while
> dragging cancels; a drag of only a few pixels does nothing (a plain Ctrl+click is still a click).
>
> **Step the altitude with the wheel.** Hold Alt and turn the wheel over the flight: each notch moves the assigned
> altitude 1,000 ft (hold Shift as well for 100 ft), up to climb. It starts from the assigned altitude, or from the
> flight's current altitude if none is assigned; a block (080B120) moves as a whole. The data block shows the new value
> with a `?` while you turn. Release Alt to assign it, once. Esc before releasing Alt cancels; so does switching window.
> You may move off the flight while Alt is held: releasing Alt still sends.
>
> Both work only on a flight whose Strip you own (the same flights that get the HDG / SPEED / ALT menu); everywhere else
> Ctrl+drag and the wheel work the map as before. A refused value shows on the refusal banner as if typed on the Strip.

## Defaults taken

- SG-Q1 a: heading to the nearest 5°, 360 not 000.
- SG-Q2 a: 1,000 ft per notch, 100 ft with Alt+Shift.
- SG-Q3 a: sent once on Alt release.
- SG-Q4 a: start from the assigned altitude, else current altitude rounded to the step.
- Ours: wheel up climbs; one notch per mouse-wheel event (≥ 40 px, Chromium gives 53 on Linux, 100/120 elsewhere),
  touchpad deltas add up to a notch per 100 px; Shift+wheel's deltaX accepted (Chromium turns Shift+wheel horizontal).
- Ours: the assigned start is not rounded (8,550 → 9,550); a shift taking the low end ≤ 0 or high end > FL999 is
  ignored.
- Ours: preview marker `?` after the altitude, trend arrow dropped while previewing. Text-only, grey as the block.
- Ours: moving off the contact keeps the preview; wheel over another contact discards the first; pointer move seen
  without Alt discards (missed release); blur discards. AltGr (Ctrl+Alt) does not start it.
- Ours: the same heading as assigned, or no net altitude change, sends nothing.
- Ours: the current altitude is whatever the contact carries (Mode C, else a radar/datalink height on a tactical scope).
- Ours: release within 8 px of the press = click (measured at release, not the farthest point).
- The heading line runs from the contact's reported position (not the coasted ATC position).

## Not done / walks

- Playwright spec written, NOT run: `crc-desktop/e2e/u-scope-gestures.spec.js` (adds `magnetic`, `hdgDrag`, `altWheel`
  to `e2e/helpers/modules.js`). It forces the variation to 0° via `applyTheaterFacts`. Assumes Playwright's
  `mouse.wheel` carries the modifiers held with `keyboard.down` (it does in Chromium) and that the earlier-found label
  point stays on the label after the ASGN line appears.
- Not checked in a real Electron window: that `preventDefault` on the Alt keyup stops the hidden menu bar (Electron only
  handles keyboard events the page did not consume; should hold). A lone Alt press with no wheel still shows the menu as
  before.
- MapLibre 3.6.2: a layer mousedown's `preventDefault` keeps drag-pan/rotate off the press (documented behaviour);
  `dragRotate` is disabled anyway.

## After U-ALT-LIMITS reported (coordinator message)

- Below the transition altitude the typed form is kept: an end typed in hundreds stays hundreds (`<080` → `<090`,
  `080` → `090`, `A050` → `A060`); feet stay feet (`8000` → `9000`); at and above the transition altitude it is always
  `FL`. `altitudeEndText(ft, ta, style)`, where `style` comes from parseAssignedAltitude.
- A limit entry stores `parsed: null` and `block` with one end null: the start falls back to it when the `value` text
  is unreadable (`lowFt == null` → `<highFt`, `highFt == null` → `>lowFt`). The text path already reads `<`/`>`.
- ADR 0164 §5 says "feet below" without this refinement. It was committed in this lane, so per P4 I did not edit it:
  supervisor, either allow a one-line amendment before merge or let this note stand as the record.
- Not yet against `altitude-limit.js` (not on my base); gesture-values.js has its own parse, so there is nothing to wire.

## Findings for other lanes

- **U-ALT-LIMITS:** `gesture-values.js` `parseAssignedAltitude` keeps a leading `<`/`>` and `formatAssignedAltitude`
  writes it back, so a stored `<FL240` wheels to `<FL250`. The start reads the ACTIVE entry's `value` text first. The
  preview display (`assignedPreviewText`, tactical `buildAssignedLine`) does not show the prefix: if your lane shows
  `<`/`>` on the block, add it there (the preview object carries `prefix`).
- **U-LABEL-REMARKS:** my edits in geojson.js are in `buildAssignedLine` (signature now `(flightData, trackId)`) and the
  import list; in track-label.js a new `assignedPreviewText` before `atcType` and one branch at the top of
  `atcAssignedText`. Nothing in map-layers-tracks.js.
