> Amended for H100 (2026-10-01): DA-9 (a) plus a user menu to toggle which airspaces and layers show (no fixed rule); 2P-B is
> 1.1 lanes. Other DA answers as recommended.

# AIRSP-2 panel: the AIRSPACE panel edits the registry (lanes 2P-A and 2P-B, crc-desktop)

> Read `docs/parallel/refactor/README.md` (the conventions) and `docs/wip/DES-AIRSP-adr-0098.md` (the ADR wins).
> Rulings: AIRSP-1 (the mockup is approved as shown: `docs/wip/AIRSP-mockup.html`, read the local file), AIRSP-2..7,
> R3-11, R3-12, R3-23, R3-24, S-R3-80, ADR 0056/0058 (colour: grey by default, orange-red only for something wrong).
> UI code is exempt from "no magic values" (S3-6). **Starts after the refactor window and L20.** The client is
> native ES modules (ESM-1/2), messages are registered with `registerEfspMessage` (CMSG), and the client rule
> tables are hand copies with parity tests (ARCH-D7). Questions DA-1..DA-9 are answered (decisions.md H100, listed in `docs/wip/DES-AIRSP.md`); DA-9 changed 2P-B.

There are two lanes with disjoint files. 2P-A builds the approved mockup: list, editor, conflict, history and delete.
2P-B builds what the mockup does not show: the geometry and route editor, the DCS-drawing picker, map outlines, and
the MTR route note. Both code against the ADR's wire shapes and can start alongside 2S-A. Their end-to-end checks run
after 2S-A merges.

---

## Lane 2P-A: editor, conflicts, history, delete, capabilities

| | |
|---|---|
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-AIRSP2PA` on `lane/AIRSP-2P-A-editor` |
| Size / model | 1 lane / Sonnet 5.5 |

### Owns

- `crc-desktop/app/public/js/panels/efsp/airspace-panel.js`. Keep the cards and `airspaceActionsFor` unchanged. Add
  Facility grouping, the "Mine / All" toggle, "+ New airspace" (only when the session may create), the card ⋯ menu
  (Edit…, History, Delete…, each disabled with a reason per ADR 0056), the ROUTE labels (Confirm instead of Approve,
  Delay instead of Deny, a count and no occupied warning), and a "Using: TACTICAL" line for `usingFacilityId`.
- New `js/panels/efsp/airspace-editor.js`: the inline editor in the card (mockup scenes 2–3). The ID can be edited on
  create only. A changed field shows a dot and "was …" in grey. Errors appear on the field and are summarised beside
  Save, which is disabled with the reason. The **R3-23 lock**: when the record is not RETURNED or has a pending
  request, every field except name and the two frequencies is read-only, with the reason "airspace is ACTIVE: only
  name and frequencies can change". A `usingPositionId` change carries the note "takes effect after the next crc-sync
  restart" (R3-24). The editor leaves a slot for 2P-B's geometry section (`mountGeometryEditor(container, definition,
  onChange)`, imported from 2P-B's module). Until 2P-B merges it is a stub module, and 2P-B owns the real file.
- New `js/panels/efsp/airspace-validate.js`: a **hand copy** of 2S-A's `validateAirspaceDefinition` rules for the
  whole definition, geometry and route rules included (ADR §3, §5). You own the file. 2P-B imports it and asks
  through the questioner if it needs a change.
- New `js/panels/efsp/airspace-capabilities.js`: a mirror of the authority rows (ADR §11).
- The conflict view (mockup scene 4: per field "you started from / they now / yours", Theirs/Mine, non-conflicting
  fields "apply cleanly", re-send against the current `defRev`), the History view (scene 5: `transitions` and
  `definitionHistory` merged, newest first, mission Zulu), and the delete view (scene 6: the blockers listed with what
  clears them).
- The calendar chip: register `efsp-airspace-calendar` and show the next booking in grey with real UTC, who and
  altitude, plus a "Book…" link to `bookingUrl` opened in the external browser through the existing link path. No
  action changes state (DA-6).
- Tests: `crc-desktop/tests/airspace-editor.test.js` (field gating, R3-23 lock, dirty tracking, conflict merge view
  model), `airspace-capabilities-parity.test.js` (the client table agrees with crc-sync's authority rows, read
  read-only from `crc-sync/src/efsp/authority/`), `airspace-validate-parity.test.js` (the same table of cases run
  against both validators). One Playwright spec if needed, on the `E2E_LANE` the supervisor assigns.
- `docs/wip/AIRSP-2P-A.md`.

### Frozen for you

crc-sync (2S-A/B), 2P-B's files (below), `sourcedcs-web/**`, `map-setup.js`/`geojson.js` (2P-B).

### Steps

0. Step 0 per the README.
1. The validator copy and the parity table (failing first).
2. The capability mirror and the parity test.
3. The editor: create, edit, the R3-23 lock, the restart note.
4. Conflicts, history, delete.
5. The ROUTE labels and the calendar chip.

### Walks

Every walk on 2S-A's list, seen from the panel. Two app windows race the same field. An ACTIVE edit offers only name
and frequencies. TAC_C2 sees every Edit greyed out with "Owned by APP". A session signed on to nothing reads
everything and edits nothing.

---

## Lane 2P-B: geometry, routes, DCS drawings, map outlines, MTR note

| | |
|---|---|
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-AIRSP2PB` on `lane/AIRSP-2P-B-geometry` |
| Size / model | 1.1 lanes / Sonnet 5.5 (+0.1 for the DA-9 layer menu; step 1 mockup: Opus if the supervisor prefers, docs only) |

### Step 1 first: mockup delta **settled H100 (DA-8 a)**

Add one HTML file, `docs/wip/AIRSP-2P-B-mockup.html`, in the style of `AIRSP-mockup.html`, with dark and light
themes. It shows:

- the geometry section of the editor for AREA: Draw on map, Pick DCS drawing (a list of the loaded mission's drawings
  by layer and name), Refresh from drawing, Clear outline, and the vertex count;
- the ROUTE editor: a fix table (name, lat/lon or "pick navpoint", altitudes per leg, width per leg or blank for the
  default), the default width, and the derived envelope shown read-only;
- the map while drawing;
- the airspace layer menu (DA-9) open, with its default (ACTIVE only), and the outlines in both the ACTIVE and the dashed non-active style.

The supervisor publishes it for approval. Build steps 2–5 start when it is approved, but step 2's pure code may
start at once.

### Owns

- New `js/panels/efsp/airspace-geometry-editor.js`: `mountGeometryEditor(container, definition, onChange)` (the real
  module behind 2P-A's stub). It holds the AREA polygon editor and the ROUTE segment table.
- New `js/map/airspace-draw.js` (or next to the map modules on your base): MapLibre interaction to draw a polygon,
  move a vertex, delete a vertex, and click to add a route fix or pick a navpoint (`missionData.waypoints`). It emits
  `[lat, lon]` points. Self-intersection is checked through 2P-A's validator.
- New `js/map/airspace-layer.js`: the airspace outlines (AREA polygon, ROUTE corridor buffered by leg widths for
  display), each with a label showing name and limits (FL for values at and above the transition altitude, from the
  `theater` message). **What it draws is decided by the layer menu below, not by a fixed rule (settled H100, DA-9).** An
  ACTIVE airspace draws as a solid grey outline, any other shown state (SCHEDULED, RELEASED, RETURNED) as a dashed lighter
  grey outline with its state in the label; orange-red is never used for it (ADR 0056/0058). One registration line in
  `map-setup.js`.
- New `js/map/airspace-layer-menu.js` (**settled H100, DA-9: a menu to toggle which airspaces/layers show**), mounted in
  `panels/settings-panel.js` and openable from a small button on the map. Its model is a pure function in the same
  file (testable without a DOM):
  - **Layers:** `Outlines`, `Labels`, `Route corridors` (the buffered corridor) and `Route centrelines`, each on/off.
  - **Filters, all additive:** by **kind** (`AREA` types MOA, RANGE, DANGER, RESTRICTED, PROHIBITED, WARNING; `ROUTE`),
    by **state** (SCHEDULED, ACTIVE, RELEASED, RETURNED) and by **individual airspace** (a checklist of the current
    theater's airspaces, grouped by controlling Facility, with a search box).
  - **Rule (the whole of it):** an airspace is shown when its layer is on and, if it has an individual setting, that wins
    (on or off); otherwise when both its kind and its state are enabled. There is no other rule and nothing is forced on.
  - **Default** (first run, and the "Reset" button): Outlines and Labels on, Route corridors on, centrelines off, every
    kind on, **state = ACTIVE only**, no individual overrides. That reproduces "outline ACTIVE airspaces" without making it
    a rule: a user can turn on RETURNED airspaces, or one individual SCHEDULED MOA, or silence one noisy ACTIVE area.
  - **Persistence:** a per-user display preference in the client's existing settings store (the one the other map toggles
    use), keyed by theater for the individual overrides (ids belong to a theater). Not synced between sessions, not on
    the wire, not part of any Board or audit. A new airspace appears under the kind and state filters; an override for a
    deleted airspace is ignored and pruned.
- The DCS-drawing picker: read `missionData.drawings`. This needs `name`/`layerName` from 2S-B; until then, show
  "unnamed drawing #n" from the index. Convert a circle or oval to a 64-point polygon (UI code). On pick, **copy the
  points** and set `drawingRef {layerName, objectName, missionFingerprint}` (DA-2).
- The MTR note on the Strip: when `military.mtr.designator` matches a ROUTE `airspaceId` in the client's airspace list
  (after the same normalisation), the MTR group shows a grey "route not active" or "route active" line. Read-only. An
  unknown designator stays as it is (ADR 0062, H23). This is one renderer file under `js/panels/efsp/bay/` (re-find
  the MTR group renderer on your base); edit that file only.
- Tests: `crc-desktop/tests/airspace-geometry.test.js` (polygon editing model, route table to segments, circle to
  polygon, drawing pick copies the points), `airspace-layer.test.js` (which records are drawn, labels, the solid/dashed styles) and `airspace-layer-menu.test.js` (the model: default = ACTIVE only; each kind, state and individual toggle; an individual override beats the filters; reset; theater switch; a deleted airspace's override pruned; persistence round-trip),
  `mtr-route-note.test.js`.
- `docs/wip/AIRSP-2P-B.md`.

### Frozen for you

2P-A's files (except that your module replaces the stub file 2P-A created: agree the export name through the
questioner at step 0), crc-sync, and the web.

### Walks

- Draw a MOA, save it, and see it outlined once ACTIVE (the default menu state).
- Open the menu: include RETURNED in the state filter and see the dashed outlines; turn one ACTIVE airspace off individually; switch theater and back, the choices hold; Reset restores ACTIVE only.
- Pick a DCS drawing, save it, load a mission without that drawing: the outline stays.
- Refresh from a moved drawing on a RETURNED airspace; on an ACTIVE one it is locked by R3-23.
- Build a 4-fix route with one wide leg. TAC_C2 requests it, CTR confirms it, and its corridor shows.
- A Strip with MTR designator `VR1207` shows "route active".
