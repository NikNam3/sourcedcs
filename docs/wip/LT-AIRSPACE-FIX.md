# LT-AIRSPACE-FIX (T13, T27 client half, T28)

Branch `lane/LT-AIRSPACE-FIX`, cut from `efsp-wp5-correlation` at `c68fbc74`. No ADR. No wire change (refusal `detail`
text and a newly accepted Block value are not on the wire surface; `wire-protocol.test.mjs` is green without a record).

## T13: ARSPC (Block 24A) can be cleared

- crc-sync `flight-data-store.js` `setAirspaceOwner`: `''` or `null` now clears ownership back to undecided (`null`, what a
  new flight starts with). The clear is appended to `airspace.transitions` (`{ owner: null, at, by }`) and goes through the
  ordinary SetBlock path, so it is audited in the Mutation log like any amendment. Booleans and other words are still
  refused (D15); the refusal text now says "... or cleared".
- crc-desktop `strip-template.js`: `24A` joins `ENUM_CLEARABLE_BLOCKS`, so the picker offers "—" once ARSPC has a value.
- Only the Strip's ARSPC is meant. The airspace *definition's* using agency (USING FACILITY / USING POSITION in the
  editor) could already be cleared; the controlling agency cannot, by design: JO 7400.2R ¶21-1-10 "A controlling agency
  must be designated for each joint-use SUA area".

## T27: acting Position and refusal text

- Client (`airspace-capabilities.js`): `authorityFor` now puts the airspace's controlling Position first among the held
  Positions with full authority; new `createActingPositionFor(signedOn, def)` = the draft's controlling Position when held,
  else a held Position the rows let create it (OPS of the controlling Facility today), else the first Position that may
  create at all (the server decides). The editor (`airspace-editor.js`) recomputes the acting Position from the
  CTRL FACILITY/POSITION pickers on every change, shows it in the header ("Creating as CTR"), and sends with it. Edit and
  delete use `authorityFor`, so they also act as the controlling Position when held.
- Server (`authority/airspace.js`): new `positionsThatMay(action, def, deps)` and `refusalReason(action, def, deps)`. The
  candidates are the controlling Position and every Position of the controlling Facility, each judged by
  `definitionAuthority` itself, so the text follows the rows. `airspace-store.js` uses it for create/edit/delete:
  - `OPS may not create MOA-GAZIPASA: only CTR may`
  - `LC may not edit Test Range: only AP or OPS may (RANGE_1_CONTROL: its control frequency only)`
  - when the rows give it to nobody: `... no Position of <Facility> may`.
  "OPS of CENTER" can no longer appear.

### What LT-AIRSPACE-ALERT must change (H134, LT-RQ13 a)

- Narrow the rows only: OPS's `create`/`edit`/`delete` go from `'FACILITY'` to `null` in
  `crc-sync/src/efsp/authority/positions/*.js` (the `airspace` column) and in the client's hand copy
  `AIRSPACE_ROWS.OPS` (`airspace-capabilities.js`; the parity test enforces it). Using-agency rights (schedule, activate,
  release, approve entry) go on `use`/the state ops, not on create/edit.
- Nothing in this lane's code needs to change with it: the refusal text is derived from the rows (it will read
  "only CTR may" / "only AP may"), and the client's acting Position already prefers the controlling Position.
- `controllingChoicesFor` (the create pickers) is derived from `createPositionsFor`, so OPS alone will no longer see
  "+ New airspace"; the panel already hides it when that list is empty.
- Update the test lines that assert OPS creates/edits an INCIRLIK airspace
  (`crc-sync/tests/airspace-registry.test.mjs` "authority: who may create, edit and delete", and the T27 text test's
  "only AP or OPS may" expectations; `crc-desktop/tests/airspace-capabilities-parity.test.mjs` T27 tests' OPS fallbacks).

## T28: an airspace from a DCS drawing shows its own outline

Chosen: **hide the source drawing while the airspace's outline is drawn** (not a layer-order change).

Why: the layer order was already right (airspace layers are registered after the drawing layers, so they are drawn above
them). The outline was "hidden" because the two coincide exactly and the mission drawing is the brighter line (white at
0.75, 1.2 px) under a grey, often dashed, airspace line; the eye reads the drawing. Raising the airspace further changes
nothing. Hiding the copy's source leaves one line, styled by the airspace state (solid ACTIVE, dashed otherwise).

Rule (ours, no FAA rule covers mission drawings): a mission drawing is not drawn while an airspace outline **on the map**
was copied from it, i.e. found by its layer and name (`drawingRef`) and still exactly what picking it would copy (same
points). A drawing that has since changed stays on the map (the two shapes differ; the editor's "Refresh from drawing"
says so). When the layer menu does not draw the airspace (the default menu draws ACTIVE only), the drawing is drawn
again, so the shape never vanishes. Implementation: `airspace-layer.js` `drawingsShownAsAirspace` (pure) and a MapLibre
filter on `drawing-fills`/`drawing-lines` by a new `idx` feature property (`geojson.js` `buildDrawings`).

## Usage-guide wording (for the batch docs pass)

- Strip, ARSPC: "Pick CONTROLLING AGENCY or USING AGENCY. Choose — to clear it if it was set by mistake; the earlier
  value stays in the flight's record."
- Airspace editor: "The editor creates, edits and deletes as the airspace's controlling Position when you hold it (the
  header says which: *Creating as CTR*). If you are signed on to OPS and CTR together, a CENTER airspace is created as
  CTR. A refusal names the Positions that may do it."
- Map: "An airspace whose outline was copied from a mission drawing replaces that drawing on the map while the airspace
  is shown. Hide the airspace in the Airspaces menu and the drawing comes back. (Ours.)"

## Defaults taken

- T13 is the Strip's ARSPC field (Block 24A), the only "using/controlling agency" that could not be cleared; the
  definition's controlling agency stays mandatory (FAA quote above).
- Clearing an already-clear ARSPC is accepted (appends another `null` transition), same as setting the same direction twice
  today.
- T28: hide only while the airspace outline is drawn and the drawing still matches the copy (see above).
- T27 fallback when the controlling Position is not held and no held Position may create: send as the first creator and
  let the server refuse with the named Positions (as the briefing says).

## Walks not done

- No live walk against DCS; the Playwright round trips use the fake DCS rig (lane 3).
