# ATO BRIEF

A tactical briefing application for presenting Air Tasking Orders (ATOs), Airspace Control Orders (ACOs), SPINS, COMMS, and Weather data. Supports live editing, YAML import/export, an interactive SVG map, and real-time presenter/presentee synchronisation.

## Quick Start

```bash
npm install
node server.js          # → http://localhost:3000
```

Load a YAML package via the upload screen (drag-drop or file picker) or by joining a presenter's session.

---

## Architecture Overview

```
index.html                          Single-page shell
├── css/                            Styling (theme tokens, layout, views, editor)
├── js/
│   ├── app.js                      Global state (STATE), utilities, YAML loading, registry resolution
│   ├── session.js                  Socket.io presenter/presentee sync
│   ├── loadout.js                  Weapon loadout code parser & renderer
│   ├── geo-data.js                 Country outlines (Natural Earth CDN) + city DB
│   ├── views/
│   │   ├── view-helpers.js         Shared doc-rendering helpers (tables, headers, KV rows)
│   │   ├── view-ato.js             ATO: intel strip, mission cards, Gantt timeline, detail panel
│   │   ├── view-aco.js             ACO: airspace control measure table
│   │   ├── view-spins.js           SPINS: flexible section-based operational procedures
│   │   ├── view-comms.js           COMMS: UHF/VHF preset frequency tables
│   │   └── view-weather.js         Weather: METAR/TAF parsers, decoded display, mission notes
│   ├── map/
│   │   ├── map-main.js             Entry point (renderMAP), SVG element factories
│   │   ├── map-state.js            Pan/zoom viewport state (MAP_VP)
│   │   ├── map-data.js             Coordinate collection from ATO + ACO data
│   │   ├── map-interact.js         Mouse/touch drag, scroll zoom, coord picker integration
│   │   ├── map-render.js           Main draw loop, viewport transform, measurement tool
│   │   ├── map-ui.js               Popups, coord formatting, sidebar legend
│   │   ├── map-draw-layers.js      Country outlines, city dots/labels
│   │   ├── map-draw-zones.js       Airspace shapes (anchor, circle, polygon), engagement zones
│   │   ├── map-draw-routes.js      Flight paths / steer-point lines
│   │   └── map-draw-markers.js     Airfields, carriers, targets, marshal points, steer points
│   └── editor/
│       ├── editor-core.js          Editor state (EDITOR), dialog framework, form helpers, export
│       ├── editor-registry.js      CRUD for registry categories (airfields, carriers, targets…)
│       ├── editor-missions.js      Mission add/edit/delete with registry dropdowns
│       └── editor-sections.js      Times, ACO, SPINS, COMMS, Weather section editors
├── server.js                       Express + Socket.io server, session management
└── data/                           Sample YAML packages
```

---

## Core Data Flows

### 1. Package Load → Render

```
User loads YAML file (drag-drop / file picker)
  │
  ▼
app.js: loadPackage(yamlText)
  │  parse YAML → plain JS object
  ▼
app.js: loadPackage_obj(data)
  │  1. Copy sections into STATE.pkg (ato, aco, spins, comms, weather, registry, header)
  │  2. Propagate header fields (operation, ato_date) into each section
  │  3. Resolve registry references:
  │     ├── registry.airfields   → ato.missions[].deploy_coords, home_base_coords…
  │     ├── registry.carriers    → ato.missions[].deploy_coords, recovery_coords…
  │     ├── registry.tankers     → ato.missions[].refuel.tanker_callsign, ar_track…
  │     ├── registry.targets     → ato.targets[], mission.target.aim_points[]
  │     ├── registry.ref_points  → ato.marshal_points[]
  │     └── registry.control     → ato.global_control, mission.control._agency
  │  4. Compute ingame time (local → zulu or vice versa)
  │
  ▼
Render each section (all run on the same STATE.pkg):
  ├── renderATO(pkg.ato)        → Intel strip + mission cards + Gantt timeline
  ├── renderACO(pkg.aco)        → ACM table
  ├── renderSPINS(pkg.spins)    → Flexible doc sections
  ├── renderCOMMS(pkg.comms)    → UHF/VHF preset grids
  ├── renderWEATHER(pkg.weather) → METAR/TAF decoded + mission notes
  └── renderMAP(pkg.ato)        → SVG map (reads STATE.pkg.aco internally)
```

### 2. Edit → Save → Re-render

```
User enables Edit Mode (toggleEditMode)
  │
  ▼
User clicks an edit button (✎) on any view
  │
  ▼
editor-*.js: openEditorDialog(title, buildFn, onSave)
  │  1. buildFn(body) creates form fields in the editor overlay
  │  2. User fills in fields
  │  3. User clicks SAVE → onSave() callback fires
  │     ├── Read form values
  │     ├── Write back to STATE.pkg
  │     └── Call editorReRender()
  │
  ▼
editor-core.js: editorReRender()
  │  1. _syncHeaders() — propagate operation/ato_day across all sections
  │  2. editorCleanPkg(STATE.pkg) — deep-clone stripping _ prefixed fields
  │  3. loadPackage_obj(source) — re-resolve registry + re-render all views
  │  4. Restore current tab and selected mission
  │  5. Broadcast to presentees (if presenter is connected)
```

### 3. Map Coordinate Picker

```
User clicks 📍 next to a coordinate field
  │
  ▼
editor-core.js: _startCoordPick(targetInput)
  │  1. Hide editor overlay (preserve form state)
  │  2. Switch to MAP tab
  │  3. Set EDITOR._coordPickCb callback
  │
  ▼
map-render.js: on click (with distance < 5px from mousedown)
  │  ├── If clicking on existing marker → use marker's lat/lon
  │  └── If clicking on empty space → use SVG→geo coordinate transform
  │
  ▼
EDITOR._coordPickCb(lat, lon)
  │  1. Write formatted coordinate into the target input
  │  2. Restore editor overlay and previous tab
```

### 4. Presenter / Presentee Sync

```
Presenter                          Server                        Presentee
─────────                          ──────                        ─────────
joinSession(id, 'presenter', pw)
        ─── join ──────────────▶   validate password
                                   store session
                                   send current state
        ◀── session-state ──────                      ◀── session-state ──

loadPackage(yaml)
        ─── package-loaded ────▶   broadcast to room
                                         ─── package-loaded ──▶ loadPackage(yaml)

editorReRender() (for edits)
        ─── package-loaded ────▶   broadcast to room
                                         ─── package-loaded ──▶ loadPackage(yaml)
```

Tab navigation, theme, and display-mode changes are **local to each client** and
are not broadcast to the room.  Each presenter and presentee navigates
independently.

### 5. Export

```
User clicks EXPORT button
  │
  ▼
editor-core.js: exportPackageYaml()
  │  1. Prompt for file name
  │  2. editorCleanPkg(STATE.pkg) — strip internal fields
  │  3. jsyaml.dump() → YAML text
  │  4. Create Blob → download link → trigger click
```

---

## Key Modules

### `STATE` (app.js)

Global application state. All views read from `STATE.pkg` and `STATE.display`.

| Field | Type | Description |
|-------|------|-------------|
| `pkg` | Object | The loaded YAML package (ato, aco, spins, comms, weather, registry, header) |
| `selectedIdx` | number | Currently selected mission index (-1 = none) |
| `currentTab` | string | Active tab name (ato, aco, spins, comms, weather, map) |
| `theme` | string | Visual theme: `'pro'` (light) or `'movie'` (CRT green) |
| `display.timeMode` | string | `'Z'` (Zulu) or `'L'` (local + offset) |
| `display.coordMode` | string | `'dm'`, `'dms'`, or `'mgrs'` |
| `mapUI.tx` / `mapUI.ty` / `mapUI.sc` | number | Map pan/zoom state (content-group transform); preserved across tab switches |
| `mapUI.highlighted` | string\|null | Route filter: `null` = all visible, `'__none__'` = none, key = solo flight |
| `mapUI.engVisible` | boolean | Engagement-zone overlay visibility |
| `mapUI.airVisible` | boolean | Airspace overlay visibility |
| `mapUI.measureMode` | string | Measurement tool state: `'off'` / `'waitA'` / `'waitB'` / `'fixed'` |
| `mapUI.mapMode` | string | Background tile style: `'chart'` / `'tactical'` / `'elevation'` / `'satellite'` |

### `EDITOR` (editor-core.js)

Editor state. Tracks whether edit mode is active and holds the current dialog's save callback.

| Field | Type | Description |
|-------|------|-------------|
| `active` | boolean | Edit mode on/off |
| `_onSave` | Function | Current dialog's save callback (set by `openEditorDialog`) |
| `_coordPickCb` | Function | Map coordinate picker callback (set by `_startCoordPick`) |

### Registry Resolution (app.js → `loadPackage_obj`)

The registry is the single source of truth for shared entities. During package loading, registry entries are resolved into mission fields:

| Registry Category | Resolved Into |
|-------------------|---------------|
| `airfields` | Mission deploy/home/recovery coords and names |
| `carriers` | Mission deploy/recovery coords from carrier positions |
| `tankers` | Mission refuel callsign, AR track, altitude |
| `targets` | `ato.targets[]` array, mission aim points with threat data |
| `reference_points` | `ato.marshal_points[]` array |
| `control_agencies` | `ato.global_control._agency`, mission `control._agency` |

---

## Styling

Two themes controlled by a `data-theme` attribute on `<html>`:

- **Pro** — Light background, dark text, professional briefing style
- **Movie** — Dark green CRT aesthetic with scanlines, vignette, and neon accents

CSS is split into modular files imported via `css/app.css`:
`base.css` (themes) → `layout.css` (shell) → `ato.css` / `docs.css` / `map.css` / `weather.css` / `loadout.css` / `editor.css`

---

## YAML Format

See [`docs/yaml-format.md`](docs/yaml-format.md) for the full schema reference.


## TODO

- Map: additional tile types and higher accuracy geo data
- ISR data section
- PDF export
- Kneeboard export
- MIZ → YAML converter improvements:
    - Read target altitude
    - Dense waypoint filtering
    - COMMS extraction