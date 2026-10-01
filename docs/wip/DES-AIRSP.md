# DES-AIRSP: post-refactor design for AIRSP phase 2 (the airspace registry, ADR 0098)

Lane DES-AIRSP is docs-only. It is a W1 side track on `lane/DES-AIRSP-registry`, cut from `165a517`. Its outputs:

- `docs/wip/DES-AIRSP-adr-0098.md`: the ADR draft. The building lane 2S-A copies it to `docs/adr/` (P4).
- `docs/parallel/post-refactor/AIRSP-2-server.md`: two crc-sync lanes, 2S-A (core) and 2S-B (edges).
- `docs/parallel/post-refactor/AIRSP-2-panel.md`: two crc-desktop lanes, 2P-A (editor) and 2P-B (geometry and map).
- `docs/parallel/post-refactor/AIRSP-2-web.md`: one sourcedcs-web lane, 2W (admin page and booking tool).

Inputs read: decisions H78, H79 (and the question texts of AIRSP-1..7, R3-11, R3-12, R3-22..26 from the Decision
Desk database), H80, H84, H96, H97, H98, S-AIRSP1, S-desk3, S-ARCH2 and S-R3-80; `docs/wip/AIRSP.md` and
`AIRSP-mockup.html`; `docs/parallel/research/{mtr-airspace,vocabulary,control-release}.md`; `docs/wip/ARCH-plan.md`
§2 and §2.7; the refactor briefings AUTH, STORES, WIRE, CMSG and SYNC. Code was read at `165a517`, and symbols are
cited by name.

## Code as found (`165a517`)

- `crc-sync/src/efsp/airspace-config.js`: `validateAirspaces`, `AIRSPACE_TYPES`, `getAirspaces`/`getAirspace`,
  `getRangePositionIds`, and `setAirspaces` (no caller). The file is loaded at require time through
  `statePaths('efsp-airspaces.json')`, and `DEFAULT_AIRSPACES = []`.
- `crc-sync/src/efsp/airspace-store.js`: `AirspaceStore`. `_seed` runs in the constructor only. `apply` has six op
  kinds, plus `_isControlling`/`_isUsing`, `_recordAudit` (its `facilityId` comes from config, so it is null for an
  unknown id) and `isActive`. `snapshot`/`restore` drop ids that are not in config. `LEGAL_TRANSITIONS`.
- `crc-sync/src/efsp/efsp-ws.js`: `_handleAirspaceMutation` (session-bound, NOT_HOLDING_POSITION, replay through
  `_cachedOutcome`, delta `efsp-airspace-delta` with `airspaceSeq`).
- `crc-sync/src/efsp/index.js`: `createEfsp` builds `AirspaceStore` with `occupancyFor`, which counts the
  `airspaceEntry` of every Board. `airspaceFor` is wired into the Board rules. `_validateAirspaceReferences`
  only warns. `_restore` takes the store positionally.
- `crc-sync/src/efsp/facility-config.js`: RANGES `positions` come from `airspaceConfig.getRangePositionIds()`, with
  class `USING_AGENCY`. CENTER's facility JSON has only `CTR` (no OPS), so the R3-11 OPS row applies at INCIRLIK only.
- `crc-sync/src/efsp/board-store.js`: `_applyApproveAirspaceEntry` (an unknown id is a VALIDATION_ERROR, and a
  non-ACTIVE airspace gets the warning `AIRSPACE_NOT_ACTIVE`). In `_applyTofiAccept`, ENTRY writes
  `fdr.tofi.separationRegime` at accept. That is the moment H97 moves to entry, in ADR 0102, which is not this lane.
- `crc-sync/src/grpc-client.js`: `_getDrawings` (a Lua Eval) exports `primitiveType`, `polygonMode`, colours,
  `points`/`lat`/`lon`/`radius`, but **neither the drawing's `name` nor its layer's name** (finding F1).
  `_getNavpoints` exports `{name, lat, lon, coalition}`.
- `crc-sync/src/altimetry.js`: `indicatedAltFt` (QNH below the transition altitude, STD at and above it), the basis
  conformance uses.
- `crc-desktop/app/public/js/panels/efsp/airspace-panel.js`: `airspaceActionsFor`, `_buildAirspaceCard`,
  `renderAirspacePanel`. `geojson.js` draws `missionData.drawings`.
- `sourcedcs-web/routes/bookings.js`: `booking-resources` CRUD for `ranges` (`{id, name, frequency (string),
  minAltitude, maxAltitude}`) and `controllers`, gated by `requireBookingAdmin` (`BOOKING_ADMIN_ROLES = ['admin',
  'squadronlead']`). Bookings are real-world ISO times, with range altitude deconfliction
  (`RANGE_ALTITUDE_SEPARATION_FT = 999`) and Discord notifications. The admin UI is `public/bookings.html`'s
  "MANAGE RANGES & CONTROLLER POSITIONS" panel (`public/js/bookings.js`, `bkRenderAdminPanel`). `wing-admin.html` is
  the squadron admin page (roster, squadrons, Discord roles).
- `sourcedcs-web/auth.js`: `requireFlightPlanService` (a shared bearer token, compared with
  `checkReleaseUploadToken`). `crc-sync/src/efsp/flight-plan-lookup.js`: `listFiledFlightPlans` (never throws, has a
  timeout, uses `CRCSYNC_SOURCEDCS_WEB_URL`).

## Key decisions (all in the ADR draft)

1. **crc-sync owns the registry. The web is a client** (DA-1). There is one writer, one audit and one live push.
2. **Keyed by theater** (R3-22). The panel and the queries see the current mission's theater. The web picks a theater.
3. **One wire family, new op kinds** (`CreateAirspace`, `EditAirspace`, `DeleteAirspace`, `ImportAirspaces`,
   `DelayActivation`). There is no `airspace-definition.js` family. This deviates from ARCH-plan §2.7 for the sake of
   fewer kinds (one replay kind, one seq).
4. **`defRev` plus a per-field conflict check** from a bounded `definitionHistory`. R3-25's "rev" is satisfied by
   `defRev`, which is kept separate so that state ops and definition edits never invalidate each other.
5. **R3-23** is enforced on the server: while the record is not RETURNED, or has a pending request, only `name` and
   the two frequencies may change.
6. **Geometry**: AREA has a polygon, a copied DCS drawing (DA-2), or null. ROUTE has segments `{fix:{name,lat,lon},
   altLowerFt, altUpperFt, widthNm?}`, where the last element is the exit fix, plus a required `defaultWidthNm`.
   The envelope is derived.
7. **`activation` is a rule keyed by `kind`**, not a stored field (it deviates from §2.7 for the same reason as
   occupancy). ROUTE: Confirm, no Deny, and `DelayActivation` as a note.
8. **The using agency is at most one of** `usingPositionId` (RANGES, takes effect at restart) and the new
   `usingFacilityId` (an MRU, live). The `airspaceUse` capability says which of its Positions act (DA-7).
9. **The H97 interface** (§7 of the ADR) was agreed with DES-RELEASE through main: `isActiveFor`,
   `activeContaining` and `containing`, all pure. The basis is indicated feet.
10. **Standing list**: `config/efsp-airspaces.json` keyed by theater, imported once per id (`seeded`), and additive.
    ACO import is the same op later.
11. **Persistence**: definitions join the airspace store's `stores.js` entry inside the one atomic Board snapshot.
    `state/efsp-airspaces.json` is no longer written, and there is no migration (R3-2).
12. **Web link**: `/api/airspace-registry/*` on crc-sync, with an `AIRSPACE_SERVICE_TOKEN` service principal
    `SQUADRON_ADMIN`. Bookings reference registry airspaces. crc-sync pulls calendar bookings for display only (DA-6).

## Reconciliations (no human call needed)

- **R3-25's option text** says "persisted to state/efsp-airspaces.json". The substance (per-airspace op, audit,
  clientMutationId, rev) is kept. The file is replaced by the store-registry snapshot, because AIRSP.md gap 2 (two
  files, no shared atomicity) is a correctness problem, and S-ARCH2/STORES already put every store in one write.
- **AIRSP-2 (the controlling Position) and R3-11 (OPS of the controlling Facility)** were both answered, and they are
  read as a union, which is how ARCH-plan §2.7 already reads them.
- **AIRSP.md Q3 ("usingPositionId not editable")** is superseded by R3-24: it is editable, and takes effect at restart.
- **AIRSP.md §5 ("editing ACTIVE allowed, all fields")** is superseded by R3-23.
- **AIRSP.md Q9 (no geometry)** is superseded by AIRSP-7 and R3-12.

## Questions for the human

Each question has options and a recommendation. The recommendation is the default written into the drafts, marked
**[default DA-n]**.

**DA-1. Where do airspace definitions live, now that sourcedcs-web edits them too?**
(a) crc-sync's registry is the only source. The web admin page reads and writes it over a server-to-server API, and
the booking tool reads it. (b) sourcedcs-web is the source. crc-sync pulls the list (like flight plans), and
controllers' panel edits are pushed back to the web. (c) Split by field: the web owns the standing shape (geometry,
owner, type), and crc-sync owns live edits (frequencies, name).
*Recommend (a).* Audit, conflicts, the delete guard and the occupied warning only work where the flights are. (b)
needs two writers or a write-back with its own failure modes. (c) needs two sources joined by id with nobody owning
a create or a delete. Cost of (a): the web admin needs crc-sync up, which it always is in the stack.

**DA-2. When a controller picks a DCS drawing as the outline, is it copied or linked?**
(a) Copy the points at selection, keep `{layerName, objectName}` as provenance, and offer "Refresh from drawing"
while that mission is loaded. (b) A live link, resolved at each mission load. With no matching drawing, the outline
is unknown.
*Recommend (a).* Airspaces are standing per theater, while drawings belong to one mission. A live link makes the
TOFI entry gate and the map depend on which `.miz` is loaded, and a renamed drawing silently removes the outline.

**DA-3. Who may edit airspaces on sourcedcs-web?**
(a) The booking admins (`admin`, `squadronlead`), the same people who manage booking ranges today. (b) `admin` only.
(c) A new Casdoor role (for example `airspaceadmin`).
*Recommend (a).* It is the existing group for the same data, and adds no new role to provision.

**DA-4. Does the sourcedcs-web admin page get a map for drawing outlines?**
(a) No. A coordinate table (lat/lon, decimal or DMS paste) for polygons and route fixes, with a read-only SVG outline
preview. Drawing on a map, and picking DCS drawings, happen in crc-desktop's panel. (b) Yes, a MapLibre map in the
web admin with polygon drawing.
*Recommend (a)* for phase 2: it keeps the web lane small, the crc-desktop map already exists, and the web cannot see
mission drawings anyway. (b) can follow as its own lane.

**DA-5. What happens to the booking tool's existing "ranges"?**
(a) They become read-only "legacy". Existing bookings keep displaying until they pass, and new range bookings pick a
registry airspace (theater, then airspace). (b) A one-time migration: an admin maps each legacy range to a registry
airspace, and its bookings move over. (c) Drop the legacy ranges and their bookings (clean start).
*Recommend (a).* No data loss, no migration code, and it fades out by itself. (b) is worth it only if there are many
future bookings.

**DA-6. What do calendar bookings do inside crc-desktop?**
(a) Information only: the next booking is shown on the airspace card in grey (real UTC, who, altitude), with a link to
the booking page. (b) Also a "Schedule from booking" button that pre-fills the schedule form. (c) Not shown.
*Recommend (a).* Bookings are real-world time and the airspace window is mission time (ADR 0079). Mixing them in a
pre-fill invites a wrong window whenever the mission date differs from today.

**DA-7. Which Positions of an MRU act as using agency for an airspace released to it (schedule, request activation,
release)?** This is not editing (AIRSP-6 already said no to that). It is the H97 flow: ATC releases the block to the MRU.
(a) TAC_C2 only. (b) TAC_C2 and GCI/AIC. (c) Every Position of the MRU Facility.
*Recommend (a).* TAC_C2 is the Position that accepts the TOFI, and so the one that knows the block is needed. Adding
more is one capability row.

**DA-8. Does the panel's geometry and route editor need its own mockup approval before it is built?**
The approved mockup (AIRSP-1) has no geometry, no route segments, no `usingFacilityId`, and no DCS-drawing picker.
(a) Yes: lane 2P-B starts with a mockup delta (H49 precedent), while 2P-A builds the approved parts in parallel.
(b) No: build directly from the ADR, and review it in the running app.
*Recommend (a).* The map interaction (draw, edit vertices, pick a drawing, route legs with widths) is the part most
likely to need a second look, and 2P-A is not blocked by it.

**DA-9. What does the scope map show of airspaces?**
(a) The outline of ACTIVE airspaces (AREA polygons, ROUTE corridors), with a toggle in settings and a label with the
name and limits. (b) All airspaces, coloured by state. (c) Nothing (panel only).
*Recommend (a).* It highlights what matters now (R3-12's original recommendation was "highlight when active") without
cluttering the scope with every standing area. The grey and colour rules follow ADR 0056/0058.

## Findings for other lanes and the supervisor

- **F1 (crc-sync, `grpc-client.js` `_getDrawings`).** The drawing export carries no `name` and no layer name. So (i)
  a DCS drawing cannot be picked by name, and (ii) `missionFingerprint` (`mission-session.js`) hashes
  `names(missionData.drawings)`, which is always a run of empty strings. The fingerprint is weaker than ADR 0086
  assumes, because only waypoints and the theater discriminate. Lane 2S-B adds `name` and `layerName` to the export.
  Changing the fingerprint input changes session ids for the same mission, which is a behaviour change: flag it in
  2S-B's report and do not bundle it silently.
- **F2 (RENAME prep).** "Occupied" means two things. Position occupancy becomes "staffed" (R2), but airspace occupancy
  (flights working the block: `occupancyFor`, `AIRSPACE_STILL_OCCUPIED`, AIRSP-4's "occupied airspace") is not
  staffing and should keep its word. The R2 regex (`occup(ied|ant|ancy|y)`) would catch it. Add it to the "stays"
  list, next to the runway `occupantFdrId`.
- **F3 (security note, not a lane).** sourcedcs-web's `requireAuth` decodes the JWT without verifying it, and the
  `SQUADRON_ADMIN` path trusts the web's role check. That gives the airspace registry the same trust level as the
  booking tool today. It is recorded here for the feature map only. Auth hardening is out of scope.
- **F4 (ARCH-plan §2.7 deviations).** There is one wire family, not an `airspace-definition.js`, and `activation` is
  a rule keyed by `kind` rather than a stored field. If the supervisor wants §2.7 literally, it is a two-line change in
  the ADR draft.
- **F5 (ADR 0102 sequencing).** The release+TOFI lane consumes `activeContaining`/`isActiveFor`. It can code against
  the signature with a stub, but its merge must follow 2S-A's.

- **F6 (infra).** The nginx config is now `infra/nginx/templates/default.conf.template` (CLAUDE.md still says it is
  "generated inline in docker-compose.yml's command: block", which is stale after INFRA2). The crc-sync vhost proxies
  `location /` wholesale, so any new crc-sync service route is public unless it is denied explicitly. 2W adds the
  deny for `/api/airspace-registry`. L20 or the docs owner should fix the CLAUDE.md sentence.

## Lane split and sizing

| Lane | Repo area (disjoint files) | Size / model | Starts | Merges |
|---|---|---|---|---|
| 2S-A core | `airspace-store.js`, `airspace-config.js` (schema/seed), new `airspace/containment.js`, `stores.js` entry, `wire/families/airspace.js`, `authority/positions/*` airspace rows, `metrics.js`, `config/efsp-airspaces.json`, ADR 0098 | 1.5 / Sonnet | window close + L20 | first |
| 2S-B edges | new `airspace-service.js`, new `efsp/booking-lookup.js`, `app.js` mount + ticker, `grpc-client.js` `_getDrawings`, `crc-sync/.env.example` | 0.75 / Sonnet | with 2S-A (stub) | after 2S-A |
| 2P-A editor | `airspace-panel.js`, new `airspace-editor.js`, `airspace-validate.js`, `airspace-capabilities.js`, parity tests | 1 / Sonnet | with 2S-A | after 2S-A |
| 2P-B geometry | mockup delta first (DA-8), new `airspace-geometry-editor.js`, `map/airspace-draw.js`, `map/airspace-layer.js`, one line each in `map-setup.js` and `settings-panel.js`, the MTR group renderer | 1 / Sonnet (+ mockup) | mockup at once; code on approval | after 2P-A |
| 2W web | `sourcedcs-web/{crcsync-client.js, routes/airspaces.js, routes/bookings.js, auth.js, public/airspace-admin.*, public/bookings.*, public/wing-admin.html link}`, `infra/docker-compose.yml`, nginx template, root `.env.example`, CLAUDE.md env rows | 1 / Sonnet | with 2S-A | after 2S-B |

That is about 5.25 lane-units, five agents in parallel (plus the questioner), and about 3 working days elapsed
including merges. The release+TOFI lane (ADR 0102) consumes 2S-A's queries and merges after it.

## Report

Done; the files are listed at the top. The questions are DA-1..DA-9, all non-blocking for 2S-A: its defaults are
written in, and the answers change only isolated paragraphs. The interface was sent to main for DES-RELEASE.
