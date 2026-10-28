# U-LABEL-MENU (H164 FT-Q4 a, ADR 0140)

## What was built
- `crc-desktop/app/public/js/panels/efsp/label-assign-rules.js` (pure): `assignmentCellsFor(stripType, facilityId)`,
  `labelAssignmentFor(strips, actingAt, {prefer})`, `labelAssignOps(entries)`.
- `crc-desktop/app/public/js/panels/efsp/label-menu.js`: `openLabelMenu(trackId, x, y, {onTrackInfo})`,
  `closeLabelMenu`, `labelMenuState`, `labelAssignmentForTrack`.
- `map-interactions.js` `_onLabelClick`: the owner gets the menu; Shift+click or no offer = the track panel.
- CSS `.label-menu*` in `overlays.css`.
- Tests: `tests/label-menu.test.mjs` (10: cells per strip type, owner/non-owner, 12 generated Facilities, ops, the DOM
  menu: Enter, chaining on the rev, refusal stops, Esc, TRACK); `e2e/u-label-menu.spec.js` (2, lane 9).

## What the usage guide should say (§8 map / STARS scope)
"Click a contact's data block to assign it a heading, speed or altitude when you own its Strip: the menu opens on HDG;
type the value and Enter. Tab to SPEED and ALT; Enter sends every changed value, as if typed in the Strip's cells (same
refusals, same 'Coordinated with …' line). Esc closes. TRACK, or Shift+click on the block, opens the track panel. If you
don't own the Strip, or the contact has none, the click opens the track panel as before."
Briefing §STARS (ADR 0088 line "a click on the block still opens the track panel"): now only for a non-owner, see 0140.

## Defaults taken
- D1: the owner's plain click opens the menu **instead of** the track panel (the panel switches the dock tab away from the
  Strips); the panel stays one input away (TRACK item, Shift+click). The briefing offered "a menu item or a modifier":
  both are built.
- D2: three inputs in one menu (HDG focused) rather than a single prefixed input (`H250`): the cells keep their own
  labels and formats, Tab reaches the other two. Enter sends all changed cells.
- D3: changed cells go one after the other on ack; a refusal or attestation stops the rest (no retries).
- D4: owning two copies of the flight (two Facilities): the Strip in an open Bay wins, else the first.
- D5: menu opens at the click point (over the block), clamped to the viewport.

## Walks
- Owner types HDG and ALT, both land on the flight's clearance and the Strip cell (e2e).
- Esc sends nothing; TRACK opens the track panel; Shift+click no menu (e2e).
- Non-owner (signed on elsewhere) gets the track panel (e2e).
- Not walked live: the attestation path (a write while the other Facility has control): it is the Strip cell's own
  ack handling, unchanged; unit test proves the default surface is kept.

## Findings for other lanes
- `strip-template.js` `isParFinalOnlyOnCarrier` compares the literal Facility id `'CARRIER'` (already on H160's list
  item 1 for U-ROLE-POSITIONS); the menu inherits it through `isBlockEditable`.
- `bay/dispatch.js` `_resolveActingPositionId` falls back to "the first acting Position" when the controller does not
  own the Strip (a rule-9 smell: it sends a write as an arbitrary Position, which the server then refuses). The menu does
  not use the fallback.
