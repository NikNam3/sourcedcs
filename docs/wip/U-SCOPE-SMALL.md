# U-SCOPE-SMALL: drawings switch, picker highlight, airport surface

Client-only, three items from the 2026-10-20 live test. No ADR. Branch `lane/U-SCOPE-SMALL` from `e44bae1f`.

## 1. "DCS drawings" switch (Settings → Declutter)

- New setting `drawingsEnabled`, **on by default** (`settings.js`). Off, `buildDrawings()` (`geojson.js`) returns no
  features, so `drawing-fills` and `drawing-lines` draw nothing; on, the source is rebuilt. Same mechanism as the text
  marks (data, not layer visibility), so it survives theme changes and mission reloads with no extra code.
- T28 is untouched: its filter on the two layers (`airspace-layer.js` `_applyDrawingFilter`) still applies whenever
  the switch is on.
- **Moved the "DCS text marks" switch** out of Colours → Labels (it was that group's only row; the group is gone) into a
  new **Map** group at the top of the Declutter tab: DCS drawings, DCS text marks, Airport surface. One place for
  "what of the map do I see". The checkbox id (`set-text-marks`) is unchanged.
- The drawing geometry moved to `drawingGeometry()` in the new `js/drawing-highlight.js` (a circle as a 64-gon, a closed
  polygon, an open line), so the drawings and the highlight share it. `buildDrawings` output is unchanged.

## 2. Picker highlight (airspace editor, "Pick DCS drawing")

- `js/drawing-highlight.js`: source `drawing-highlight`, layers `drawing-highlight-halo` (8 px, 22 %) and
  `drawing-highlight-line` (2.5 px), registered right after the airspace layers, so **above the drawings and the
  airspace outlines and draft, below the tracks**. Built from `missionData.drawings` directly: it shows with the
  drawings switch off and for a drawing T28 hides.
- Colour: **turquoise `#40e0d0`** on the dark scope, `#007a7a` on the light theme. Not red/orange/yellow (alerts,
  emergencies, bogey/bandit), not the editor's blue `#4a7dbf` (the shape being edited) nor the friendly blue.
- Triggers: `mouseenter` or keyboard `focus` on a picker row (rows are now `tabindex=0`; ArrowUp/ArrowDown move,
  Enter/Space pick an eligible row). Mouse leaving a row falls back to the focused row, if any, else clears. Ineligible
  rows (an open line) highlight too, so the controller sees what they are.
- Clears when the picker closes, an entry is picked (both go through `render()` with the picker closed), the geometry
  editor is destroyed, or the row asking for it is no longer shown (a 300 ms check while a highlight is up: the dock
  panel closed or went behind another tab; the dock keeps the panel's DOM alive when it is closed, so destroy alone
  would not catch it). Typing in the search box rebuilds the rows and so clears it too.
- **Moving the map: chosen as an explicit "show" control** per row (a small grey button, visible on hover/focus). It
  highlights the drawing and fits the map to it **only when it is not wholly in view** (padding 60, max zoom
  `max(current, 9)`). Hover and focus never move the map.

## 3. Airport surface

### What the `aeroway` source-layer holds

OpenMapTiles schema (`layers/aeroway/aeroway.yaml`): fields `class` (aerodrome, heliport, runway, helipad, taxiway,
apron, gate) and `ref`. MapTiler's `tiles/v3` is OpenMapTiles v3 and OpenFreeMap serves the same schema (its TileJSON
lists the same `aeroway` fields), so one style serves both. Decoded OpenFreeMap z14 tiles (2026-10-18 build):

| Field | runway | taxiway | apron | helipad | gate |
|---|---|---|---|---|---|
| LTAG Incirlik | line `05/23` | 34 lines (N, S, C, ... "India Loop") | 7 polygons (Alpha, Bravo, Charlie West Apron ...) | - | - |
| OSKL Bassel Al-Assad | 2 lines `17R/35L` `17L/35R` | 20 lines (F, Z) | 1 polygon | 1 polygon | - |
| LTDA Hatay | line `04/22` | 6 lines | 1 | - | - |
| LCRA Akrotiri | line `10/28` | 94 lines | 12 polygons | 4 | - |
| LLBG Ben Gurion | 3 lines | 32 lines (K, N, M, W1 ...) | 1 | - | - |
| OLBA Beirut | 3 lines | 99 lines | 1 | - | 24 points |

In the Syria theatre **runways and taxiways are lines only** (no `area:aeroway` polygons in any field sampled);
aprons and helipads are polygons; `aerodrome` is the field boundary polygon. Runway `ref` is the designator pair.
Taxiway `ref` is the taxiway name. Apron `ref` is often its name. Gates are points, only where mapped (Beirut).

### The style (`crc-desktop-scope-style.json`)

| Layer | What | From |
|---|---|---|
| Airport zone | aerodrome/heliport polygon, `#111111` as before (was every polygon) | z11 |
| **Airport pavement** (new) | apron, helipad, and runway/taxiway polygons where they exist; dark grey fills, runway brightest | z12, fades in to z13 |
| **Taxiway** (new) | taxiway lines, `#323c32`, width roughly to scale (exponential, about 10 px at z16) | z12 |
| Aeroway | runway lines only now, `#4a5a4a`, width roughly to scale (24 px at z16) | z5 |
| **Runway designators** (new) | runway `ref` along the runway, `#8a9a8a` | z12 |
| Taxiway labels | taxiway `ref`, brightened `#5a6a5a` to `#788878` | z13 |
| **Apron labels** (new) | apron `ref`, `#627062` | z14 |
| Airport gate | gate `ref` | z15 |

Light theme values are in `map-style.js` `applyMapTheme`. The black strict-STARS ATC scope (ADR 0088) hides every
surface layer and keeps the runway lines in dim gray, as it hid the taxiway and gate names before.

### The setting

`airportSurface`, **on by default** for every Position: it only appears from zoom 12, where only a GC/LC/AP
controller looking at a field ends up. Off hides the six surface layers (`js/airport-surface.js`
`AIRPORT_SURFACE_LAYERS`); the runway lines stay (they are the video map's runways). In Settings → Declutter → Map.

### Is the OpenMapTiles vector data enough? (vs an OSM raster, vs satellite)

**Yes, for this purpose.** It is OpenStreetMap's data, already in both basemap sources, needs no new provider or key,
styles to the dark scope (any colour, any layer on or off, black-scope aware), stays sharp at every zoom and is light on
bandwidth. Runway designators and taxiway names are real text the map can declutter. Screenshots below.

- **OSM raster tiles (tile.openstreetmap.org)**: the same data, pre-rendered in OSM's bright light "Carto" style. It
  cannot be made dark or grey except by a crude CSS invert/filter, cannot hide parts, and labels are baked in (they
  rotate and scale with nothing). The OSM tile usage policy forbids heavy or bulk use, requires a valid identifying
  User-Agent, offers no SLA, and asks distributed apps not to hard-code the service; a squadron client fleet is a poor fit.
  Nothing it shows is missing from the vector tiles.
- **Satellite imagery** (MapTiler Satellite, Esri World Imagery): shows real pavement markings and parking spots, but
  is a bright photo that fights a dark scope (it would need heavy dimming), needs a keyed provider and its quota (another
  MapTiler cost, and no keyless fallback), is heavy on bandwidth, and shows the real field of today, which can differ
  from the DCS model (as OSM can; neither is the DCS airfield). Could be a later per-controller option for TWR only.
- Caveat for both data sources: OSM is the real-world field today. DCS's Syria fields are older models; a taxiway built
  since may show on the scope but not in DCS.

### Screenshots (OpenFreeMap fallback, dark theme, style as shipped)

Rendered by a throwaway Playwright script (not committed: the e2e harness blocks both basemap hosts) that loads the
shipped style with its source pointed at OpenFreeMap and the bundled glyphs:

- `docs/wip/U-SCOPE-SMALL/ltag-z13.png`, `ltag-z14.png`, `ltag-z15.png`, `ltag-z16.png` (Incirlik)
- `docs/wip/U-SCOPE-SMALL/oskl-bassel-al-assad-z13.png`, `-z14.png`, `-z15.png` (Bassel Al-Assad, Syria)
- `docs/wip/U-SCOPE-SMALL/olba-beirut-z14.png`, `olba-beirut-z16.png` (Beirut, gates)

The MapTiler source was not rendered (no key used by this lane); it serves the same OpenMapTiles v3 schema.

## Defaults taken (P2)

- Drawings switch on by default (brief). Text marks moved next to it (brief: "consider"): yes.
- Airport surface on by default (brief: "probably right").
- Map moves only on the explicit "show" control, and only when the drawing is not wholly in view.
- Highlight colour turquoise `#40e0d0` / `#007a7a` (light).
- The black ATC scope hides the airport surface (as it hid the taxiway and gate names), so a TWR controller who turns
  "ATC map background" off sees runways only. Revisit if a tower controller wants the surface on the black scope.

## For the guide / briefing (owners only)

- Usage guide, Settings → Declutter: "Map: DCS drawings (on), DCS text marks (off), Airport surface (on): aprons,
  taxiways, runway numbers and taxiway names when zoomed in on a field."
- Usage guide, airspace editor: "Hover or arrow through the Pick DCS drawing list to see each drawing outlined on the
  map in turquoise; 'show' brings an off-screen drawing into view."

## Tests

- Unit: `crc-desktop/tests/scope-small.test.mjs` (defaults and tab placement, drawings filter, highlight builder and
  bounds, surface visibility matrix, style layer shape/order). Module-graph exports fixture re-recorded
  (`airport-surface.js`, `drawing-highlight.js`, `map-style.js` `applyAirportSurface`).
- E2E (lane 3): `crc-desktop/e2e/u-scope-small.spec.js`, 3 tests. Also run: airspace-geometry, airspace-server,
  settings-tabs, l22-stars-scope, no-maptiler, l1-overlays (31/31).
