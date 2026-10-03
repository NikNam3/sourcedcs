# AIRSP-2P-B: geometry, routes, DCS drawings, map outlines, layer menu

Lane note for 2P-B (briefing `docs/parallel/post-refactor/AIRSP-2-panel.md`, ADR draft `docs/wip/DES-AIRSP-adr-0098.md`).

## Step 1: mockup delta (H100 DA-8 a)

`docs/wip/AIRSP-2P-B-mockup.html` is a self-contained delta on the approved `docs/wip/AIRSP-mockup.html`. It uses the
same tokens and the same dark/light cloning, and adds only what that mockup did not show. Its scenes:

1. AREA editor, OUTLINE section, with the DCS-drawing picker open (drawings grouped by layer, the shape and the
   resulting point count, an open line listed greyed with its reason).
2. The OUTLINE section in six states: just picked; the drawing moved in this mission (Refresh offered); drawing not in
   the loaded mission; drawn on the map; cleared and not saved; locked because the airspace is ACTIVE (R3-23).
3. ROUTE editor: VR1207 with 4 fixes and one 10 NM leg. It shows the fix table (name, lat/lon, Navpt ▾, ✛ on map),
   lower, upper and width for each leg (the exit fix has none), the default width, and the derived envelope as
   read-only. The navpoint picker is open.
4. The map while drawing a polygon: rubber band, the first-point handle, a cursor readout, and the toolbar.
5. Vertex editing with a self-intersection: the crossing edges in orange-red, and Done disabled with the reason.
6. Adding route fixes on the map: the corridor buffered by leg width, and a snap to a navpoint.
7. The layer menu open in its default state (ACTIVE only): ACTIVE outlines are solid grey.
8. The menu changed: RETURNED on, one airspace Off, one On, centrelines on. Non-active outlines are dashed and lighter,
   with the state in the label.

A legend table explains each control.

## Design choices (no answer needed unless the human disagrees)

- **Colour.** Saved outlines are grey only: solid for ACTIVE, dashed and lighter for other states. The geometry being
  edited uses the blue accent (`--efsp-go`), because it is a selection and not a state. Orange-red is used only for a
  validation error, such as a crossing edge (ADR 0056/0058).
- **Nothing is saved until Save.** Draw, Pick, Refresh and Clear only fill the form buffer (AIRSP-3: the form is the
  draft). Cancel undoes them. A changed outline gets the same dot and "was …" line as a field.
- **Disabled buttons give their reason in text** under the row, not only in a tooltip, the same as the approved
  mockup's disabled rule.
- **Refresh from drawing** is enabled only when the outline came from a drawing, that drawing (layer + name) is in the
  loaded mission, and its points differ from the copy. The comparison is on the points, so no hash is stored.
- **The editor stays open while the map is in draw mode.** Finish/Done hands the points back to the form. The faded
  ACTIVE outlines (whatever the layer menu shows) stay visible so a neighbour can be drawn against.
- **Route table, one row per fix.** The leg columns on a row describe the leg *from* that fix, which matches ADR §5's
  `segments[i]` and makes the exit fix the row without a leg. Width is the **total** width (as stored), and a "±2
  each side" hint is shown because MTR charts quote the width each side of the centreline. A blank width shows the
  default as placeholder text.
- **Snapping to a navpoint** takes the navpoint's name and coordinates. The coordinates are copied, as for drawings.
  There is no fix database (H23).
- **The layer menu, per airspace, uses a three-way switch** (Filter / On / Off) and a grey result word ("shown",
  "hidden", "no outline"). The briefing's rule then becomes visible, and nobody has to work it out. The airspaces are
  grouped by controlling Facility, with search. An airspace with no outline is listed and reads "no outline".
- **Labels** have two lines: the name, then (for a non-ACTIVE airspace) the state and the limits. Limits show FL from
  the theater's transition altitude up (Syria 10,000 in the sample).

## Open questions

**Q1. A DCS drawing with more than 200 points.** ADR §5 caps a polygon at 200 points. Freehand drawings in DCS can
easily have more.
(a) Leave it in the picker but greyed out, with the reason "412 points, the limit is 200".
(b) Simplify it on pick (Douglas–Peucker) to at most 200 points, and show "simplified from 412 to 196 points, within
0.1 NM". If the simplified shape crosses itself, refuse as in (a).
(c) Raise the limit.
*Recommend (b).* A controller who picks a freehand MOA wants that outline. A 0.1 NM tolerance is far below what a
scope shows. The limit stays an engineering constant in one place (the 2P-A validator copy and 2S-A).

**Q2. How coordinates are typed in the route table** (and shown in the cursor readout).
(a) Degrees and decimal minutes (`N37 21.0 E035 21.0`), as the DCS F10 map and the jets' navigation pages show them.
On input, decimal degrees and DMS are also accepted, and every format is normalised to DDM on blur.
(b) Decimal degrees, as stored.
(c) A per-user setting.
*Recommend (a).* It is the format controllers and pilots read in DCS. Pasted values in the other formats still work.
A setting (c) can follow if anyone asks.

**Q3. Building a ROUTE from a DCS line drawing.** The picker is specified for AREA only. Mission makers often draw
MTRs as lines.
(a) Not in this lane: a line is listed greyed ("not an outline") in the AREA picker, and ROUTE fixes are typed, picked
from navpoints or placed on the map.
(b) Add "Fixes from DCS line" to the ROUTE section. It copies the line's vertices as fixes named A, B, C …, and the
controller fills in altitudes and widths.
*Recommend (a)* for 2P-B (the scope stays at 1.1 lanes), with (b) as a small follow-up lane once 2S-B's drawing names
exist. It reuses the same copy-at-selection rule (DA-2).

## Code as found (step 0, build lane)

- `airspace-geometry-editor.js` is 2P-A's stub (`mountGeometryEditor(container, definition, onChange)` returning `{destroy, setReadOnly}`); replaced whole.
- `airspace-editor.js` builds the form with a constant `base = {kind:'AREA'}` on create, so there is no AREA/ROUTE chooser; `_createDefinition` also drops `segments`/`defaultWidthNm`. Minimal edits needed there (kind chooser, route create).
- `airspace-validate.js` exports `validateAirspaceDefinition`, `polygonSelfIntersects`, `deriveRouteEnvelope`, limits (200 vertices, 100 segments).
- Map: `map-setup.js` registers sources/layers by hand; `geojson.js` `buildDrawings()` already draws drawings; `missionData.drawings` now carries `name`/`layerName` (2S-B). No `js/map/` dir exists; map modules sit in `js/`.
- Settings: `app.js` `settings` persisted in localStorage `crc-desktop-settings`; no coordinate-format setting yet; no MGRS code anywhere (client or web). Web has `sourcedcs-web/public/js/airspace-coords.js` (decimal/DMS/DM pair parsing, no MGRS).
- Airspaces on the client: `getAllEfspAirspaces()` in `efsp-state.js`; transition altitude in `settings.transitionAltFt`.

## Built (build lane, branch `lane/AIRSP-2P-B-build`)

New files under `crc-desktop/app/public/js/`:

| File | What it is |
|---|---|
| `coords.js` | DMS / DM / MGRS formatting and parsing (decimal accepted too); hand-written UTM/MGRS, no dependency. `tests/coords.test.mjs` (reference points: equator/3E, 45N/3E, Sydney, round trips in both hemispheres, even and odd zones) |
| `panels/efsp/airspace-geometry-model.js` | pure: polygon editing, circle to 64 points, Douglas-Peucker (0.1 NM), the picker's rows, `geometryFromDrawing` (copies the points), `outlineStatus` (what the OUTLINE chip and buttons say), route rows <-> segments, the hand copy of `missionFingerprint` (parity-tested against crc-sync) |
| `panels/efsp/airspace-geometry-editor.js` | the real `mountGeometryEditor` (replaces 2P-A's stub): OUTLINE for an AREA, the fix table for a ROUTE |
| `airspace-draw.js` | the map session: draw a polygon, drag/insert/delete vertices, add route fixes with navpoint snap, place one fix |
| `airspace-layer.js` | outlines, corridors, centrelines, labels on the map; the draft layer; mounts the menu |
| `airspace-layer-menu.js` | the menu model (pure) and its DOM |
| `panels/efsp/mtr-route-note.js` | the Strip's "route active / not active" note |
| `css/airspace-geometry.css` | all styling for the above |

Tests: `airspace-geometry`, `airspace-layer`, `airspace-layer-menu`, `mtr-route-note`, `coords` (crc-desktop `tests/`), the MGRS case in `sourcedcs-web/test/airspace-coords.test.js`, and `e2e/airspace-geometry.spec.js` (13 tests).

### Shared-file edits (kept minimal)

- `airspace-editor.js` (2P-A's): `kind` chooser on create (AREA / ROUTE) that rebuilds the form (`buildForm`, `switchKind`); `_createDefinition` carries `segments`/`defaultWidthNm` and leaves the derived altitudes out; `base` and `editable` became `let`.
- `airspace-panel.js` (2P-A's): `renderAirspacePanel()` calls `refreshAirspaceLayers()` first (the map follows the registry whether or not the panel is built).
- `map-setup.js`: one `registerAirspaceLayers()` line, `mountAirspaceMenuButton()`, a refresh at map ready and in `applyMapTheme`.
- `app.js`: two settings defaults (`airspaceMenu`, `coordFormat`) and `refreshAirspaceLayers()` in the `init` handler.
- `panels/settings-panel.js` + `index.html`: the coordinate-format select and the airspace menu mount (GENERAL tab).
- `panels/efsp/bay/strip-element.js`: the route note in the expanded view (next to the lost-comms note).
- `e2e/helpers/modules.js`: `airspaceLayer` added to MODULES.
- `tests/fixtures/module-graph-exports.json`: re-recorded (`GOLDEN_RECORD=1`).
- `sourcedcs-web/public/js/airspace-coords.js` + its test and the hint in `airspace-admin.js`: MGRS paste (own commit).

## Defaults taken

- **Coordinate setting** lives in the settings store as `coordFormat` ('DMS' | 'DM' | 'MGRS', default DM). It controls what the editor and the cursor readout write; input accepts every format whatever the setting. In the route table, MGRS shows in the LAT cell and LON is disabled ("in MGRS"); pasting a whole position (any format) into the LAT cell fills both.
- **Unnamed drawings** are referenced by `unnamed drawing #n` (index + 1) as `objectName`; Refresh finds them by the same rule, so reordering a mission's drawings can break the link (the outline stays, Refresh says the drawing is not in the mission).
- **MTR note** is in the Strip's expanded view, not on the collapsed face: the briefing says "the MTR group", but the group's blocks are generic block-map cells and a note there would need block-map changes outside this lane.
- **Route widths** are total widths (as stored, mockup note); a blank leg width uses the default.
- **Fixes added on the map** append at the end only; moving an existing fix is done with "+" (place on map) or typing.
- **Typed outline** ("Type points", one point per line, any format) was added to the AREA section (not in the mockup) because the web admin has the same and a keyboard path is useful with no map; it is one extra grey button.
- **Layer menu "Reset"** clears the individual settings of every theater, not only the current one (the briefing's default says "no individual overrides").
- **AP2B-Q3** done as decided: a DCS line is listed greyed in the AREA picker ("an open line is not an outline"); no route from a line.

## Walks not done / follow-ups

- Moving an existing route fix by dragging on the map.
- The MTR route note on the collapsed Strip face.
- The Strip e2e for the note (unit-tested; no e2e spec builds a flight with MTR data and a ROUTE record together).
- A route from a DCS line drawing (AP2B-Q3, later lane).
- `sourcedcs-web` `npm test` has 7 failing files on this checkout both before and after the MGRS commit (airspaces-route, auth, bookings-airspace, discord-client, helpers-routes, ranges-migration, store); the coords test passes.

## Findings

- Re-rendering a table on every `change` drops the focus a Tab is moving to (a Playwright fill of the next cell hit it); the route table updates cells in place and only structural changes rebuild it. 2P-A's editor re-renders its field rows the same way via `refresh()` but keeps the input elements, so it is not affected.
- MapLibre 3.6 does not keep the GeoJSON data object on the source, so specs read `crc.airspaceLayer.lastAirspaceFeatures()`.
- `queryRenderedFeatures` right after `setData` can miss a vertex that was just added; hit-testing is done from the session's own points.
