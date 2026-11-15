# 0164: Scope gestures: Ctrl + drag assigns a heading, Alt + wheel moves the assigned altitude

**Status.** Accepted (2026-11-15). [SOURCE-DEFINED]: the human's request of 2026-11-15 ("Holding STRG plus drawing a
hdg line from a owned track dot or label should assign the hdg to that strip this should also overwrite previously
assign hdgs. Hold Left ALT plus using the mouse wheel while hovering a dot or label should assign an altitude starting
at the current alt if none is assigned or from the currently assigned alt if one is already assigned. blocks are not
changed in height but moved as a whole up and down."). Builds on ADR 0140 (the label menu's HDG / SPEED / ALT).
Decision Desk SG-Q1..Q4 open; their recommended defaults (a) are taken.

## Context

ADR 0140 lets the controller who owns a contact's correlated Strip assign heading, speed and altitude from the data
block's menu: a click, a typed value, Enter. Vectoring and stepping an altitude are the two things done most often,
and both are a direction or an amount the controller already sees on the scope: drawing and wheeling are quicker than
typing. The scope is FAA-modelled; neither STARS nor ERAM has these exact gestures, so the gestures themselves are ours.
What they write is the Strip's own heading and altitude, so every rule about those values is unchanged.

## Decision

1. **Who.** Only on a contact whose correlated Strip this controller may assign from the label menu: acting at the
   Strip's owning Position in its own Facility, a strip type with that cell (label-assign-rules.js, ADR 0132's one
   acting Position, a Case I carrier flight excluded, crc-sync ADR 0156). ATC and tactical controllers alike. For any
   other contact, and anywhere off a contact, the map keeps its own Ctrl+drag and wheel.
2. **Where it starts.** The contact's target (ATC disc or `+`), its tactical square, or its label.
3. **Ctrl + drag: heading.** Press with Ctrl, drag: a line from the contact to the cursor and the heading at the cursor
   in three digits. The heading is the true bearing contact→cursor shown magnetic (`magnetic.js` toMagneticDisplay at the
   contact; headings are magnetic, H15), rounded to the nearest 5° (SG-Q1 a, ours), north written 360 (the strip's
   own rule, crc-sync's parseHeadingDeg; JO 7110.65 ¶2-4-17 numbers usage). Release sends it to the Strip's heading cell,
   overwriting the assigned heading; the same heading as assigned sends nothing. Esc or the window losing focus cancels.
   A release closer to the press than the label drag threshold (8 px, label-drag-gate.js) sends nothing and is today's
   click (MapLibre's click tolerance is the same 8 px). With the variation not known yet the readout is `---` and nothing
   is sent: a true bearing is never sent as magnetic.
4. **Alt + wheel: altitude.** With (left) Alt held over the contact, each wheel notch moves a preview 1,000 ft, 100 ft
   with Shift (SG-Q2 a, ours); up climbs. It starts from the assigned altitude when there is one (a block moves as a
   whole and keeps its height; a leading `<` or `>` is kept and only the number moves), else from the contact's current
   altitude rounded to the step (SG-Q4 a; Mode C, or for a tactical scope the height its sensor gives). A move that would
   take the low end to 0 ft or below, or the high end above FL999, is not made (ours). The preview is shown where the
   block shows the assigned altitude (ATC line 3, tactical ASGN line) and marked `?`, with no trend arrow: `A140?`,
   `A090B130?`. Releasing Alt sends it **once** (SG-Q3 a); no net change sends nothing.
   Cancelled (nothing sent): Esc; the window losing focus (Alt+Tab); a pointer move seen without Alt (the release was
   missed, off the window). Kept: moving off the contact (Alt's release still sends it). A wheel over another such
   contact throws the first preview away and starts on that one. AltGr (Ctrl+Alt on Windows) does not start it.
   The wheel over the contact never zooms the map; an Alt release that ended a preview is not handed to Electron, so it
   does not show the hidden menu bar (`autoHideMenuBar`).
5. **What is sent.** The cell's own SetBlock, as the label menu sends it, with the Strip resolved again at release
   (its rev may have moved): the refusal banner, the Mutation log, conformance and the control-release attestation are
   as if it was typed on the Strip. The altitude text is the strip's: `FL` and three digits at and above the theater's
   transition altitude, feet below, a block `low-high` (crc-sync's formatAltitudeEnd / formatAltitudeBlock).

## Consequences

- No wire change: the gestures send an existing op.
- Module layout (crc-desktop/app/public/js): `scope-gestures/gesture-values.js` (pure: rounding, the altitude text, the
  shift, the start, wheel notches), `scope-gestures/alt-preview.js` (leaf: the one preview), `scope-gestures/assign-send.js`
  (the cell a gesture writes, and the send), `scope-gestures/contact-hit.js` (the contact under a point),
  `scope-gestures/hdg-drag.js`, `scope-gestures/alt-wheel.js`, `map-layers-gestures.js` (the line and readout). Hooks:
  map-interactions.js (mousedown on the contact layers, one line in the label mousedown, wireAltWheel), map-setup.js
  (the layers), and the preview in geojson.js / atc-scope.js / track-label.js (`assignedPreviewText`).
- SPEED has no gesture.
