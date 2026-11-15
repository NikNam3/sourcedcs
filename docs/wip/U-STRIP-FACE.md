# U-STRIP-FACE: forced capitals and the route at the bottom of the Strip

Human: "input fields on strips should be forced caps same with any field that goes into the strip like creating a new
callsign and type via the quick menu. the route field on the strips needs to be bigger and therefore should be put at the
bottom of any strip that currently shows it. and always show the full route."

## 1. Forced capitals (SF-Q1 a)

`crc-desktop/app/public/js/force-caps.js` is a leaf module (it imports nothing). `forceCaps(el)` uppercases the **value**
on every `input` event, typed or pasted, and keeps the caret and the selection where they were (ß→SS moves the offsets with
it). It is not CSS: what is sent is what the controller saw. The listener is a capture listener, so it runs before the
field's other `input` listeners (the Block editor's draft keeper, the dot-command preview) whichever was added first. An
IME composition is left alone until `compositionend`. Only typing changes a value: an editor opened on an old lowercase value
keeps it until typed into, so opening and committing an untouched editor stays a no-op.

Wired on:
- every Strip Block editor (`bay/block-edit.js`), on the face and in the expanded view;
- the remarks text box (`bay/popovers/remarks.js`);
- the label menu: HDG/SPEED/ALT, the TAG ACID/TYPE, the carrier check-in SIDE (`label-menu.js`);
- the New Strip callsign and the dot-command line (`efsp-panel.js`, after `_cachePanelElements`; `panel/state.js` stays
  import-free). `parseDotCommand` lowercases the verb, `.ff` and `.stereo` match case-blind, track ids are DCS unit ids
  (digits);
- the track panel's TAG VFR callsign/type (`track-panel.js`);
- the carrier callsign popover, the Marshal board's SIDE and its stack inputs (`marshal-panel.js`);
- the ATO import's callsign override, the coordination and TOFI notes, the MARSA "who declared it" field, the airspace-entry
  block fields.

Not wired (they do not land on a Strip): the airspace editors, the frequency table, the runway-status panel, the carrier
management panel (carrier state), PAR's numeric inputs, the settings, the search boxes, the track panel's tag rename.

**crc-sync** already uppercases on write most of what it parses: the callsign on create and on every callsign edit, the
aircraft type and wake, times, runways, altitudes, MTR values, the divert destination, stereo names. It stores the **route
(9), the full route clearance (9D) and the remarks as typed**. The server was not changed: the client now sends capitals,
and a server-side uppercase of free text would be a behaviour change for every other writer (ATO import, flight plans from
sourcedcs-web). Worth a small follow-up if the supervisor wants old lowercase flight plans shown in capitals.

## 2. The route at the bottom, whole (SF-Q2 a, SF-Q3 a)

`panels/efsp/route-row.js` (leaf): `FULL_ROW_BLOCKS = ['9', '9D']`, `isFullRowBlock`, `oneLine`.
`strip-fields.js` `faceLayoutFor(...)` splits `compactBlocksFor()`'s list into `fields` (the grid) and `rows` (the route);
together they are exactly the old list, so the expanded view's "what is on the face" filter is unchanged. `FIELD_SPANS`
lost `'9': 3` (and the CSS its `efsp-field-w3`).

`strip-view.js` draws the route as `.efsp-block-chip.efsp-field.efsp-strip-route`, the **last row of the main column, under
the remarks row** (SF-Q3 a, supervisor 2026-11-15): fields, indicators, reason lines, RMKS, RTE, then the expanded view.
The cell (`.efsp-block-9.efsp-block-wrap`) wraps (`pre-wrap`, `overflow-wrap: anywhere`), no ellipsis, no cut; the Strip
grows. Faces that show it: DEPARTURE at OPS, CD, AP, CTR; OVERFLIGHT at AP, CTR; the strip-type fallbacks for DEPARTURE,
ARRIVAL, OVERFLIGHT. In the expanded view (where the route is listed when it is not on the face) the same cell wraps too.

The editor for 9/9D is a `<textarea class="efsp-block-input efsp-block-input-wrap">`, full row width, grown to its text by
`field-sizing: content` (Electron 43). Same contract as every Block edit: Enter (also Shift+Enter) commits, Esc reverts,
blur never commits; a pasted newline is folded to a space as typed and again on commit; capitals.

Checked: the drag insertion line measures each Strip's rect (`bay/drag.js`, `strip-drag.js`), so variable heights are
fine; a flipped Strip draws only Block 1; the carrier, marshal and final Bays draw one-line lists (`bay-views.js`), and the
FINAL / VFR / carrier faces have no route; the arrival flash is on the Strip element and does not depend on its height;
Racks have no fixed Strip height. Not walked in a browser (no Playwright in lanes).

## Usage-guide text (for docs/efsp-usage-guide.md)

> **Capitals.** Everything you type that ends up on a Strip is typed in capitals: Block cells, remarks, the label menu,
> New Strip, the TAG VFR fields, the carrier and Marshal fields and the dot-command line. You do not need Caps Lock.
>
> **The route.** On every Strip that shows the route (RTE), it is the bottom row, under the remarks, and always the whole
> route: a long route wraps over more lines and the Strip grows. Click it to edit; the box wraps too. Enter saves, Esc
> cancels; the route stays one line (a pasted line break becomes a space).

## Tests

- New: `crc-desktop/tests/force-caps.test.mjs` (8).
- `efsp-strip-fields.test.mjs`: +2 (`faceLayoutFor` split on every list, `oneLine`). 24 → 26.
- `efsp-ui-reachability.test.mjs`: +4 (route is the last row under remarks on six faces; no route row on GC/LC; the
  wrapping editor: capitals, newline folded, Enter sends one line; other cells still an `<input>` in capitals).
  `openInputs` now also finds the `<textarea>`. 151 → 155.
- `tests/fixtures/module-graph-exports.json` re-recorded (GOLDEN_RECORD=1): new modules `force-caps.js`, `route-row.js`
  and the new `faceLayoutFor` export. `module-graph.test.mjs` 8/8.

Playwright specs changed, **not run**:
- `e2e/u-strip.spec.js`: the DEPARTURE-at-OPS and OVERFLIGHT-at-CTR U1/U2 tests now assert the route row
  (`expectRouteRow`: last row, full width, whole text, not cut, wraps to >1 line at 480 px) instead of "cut in its cell,
  whole on hover".
- `e2e/l2-block-editing.spec.js` F-201: the route editor is `textarea.efsp-block-input`.
- `e2e/l1-nla-clearance-chain.spec.js` `fillChip`: `.efsp-block-input` (it fills RTE).

Specs that might need a look on the first run: anything that types lowercase into a Strip field and then asserts the
lowercase value (none found by grep); `l4-density.spec.js` only reports Strip heights.

## Defaults taken

- SF-Q1 a (everything that lands on a Strip, remarks included), SF-Q2 a (full-width bottom row, never truncated).
- SF-Q3 a (asked, supervisor confirmed): RTE is the very last row, under RMKS. The route editor wraps (supervisor).
- 9D (full route clearance) is treated as a route too: not on any face today, it wraps in the expanded view and edits in the
  wrapping box.
- No server change (see above).

## Findings for other lanes

- crc-sync stores route, full route clearance and remarks as typed; old flight plans may show lowercase.
- `COMPACT_BLOCKS_BY_POSITION` is still keyed by Position id (ADR 0132's U-ROLE-POSITIONS re-keys it); unchanged here.
