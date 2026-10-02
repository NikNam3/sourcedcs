# AIRSP-2P-A: the AIRSPACE panel edits the registry (crc-desktop)

## Code as found (step 0, base 9d1c58d4)

Briefing names mapped through `docs/glossary.md` (hold -> sign on, Primary -> signed on); every symbol re-found.

- `crc-desktop/app/public/js/panels/efsp/airspace-panel.js` (237 lines): `airspaceActionsFor(airspace, signedOnPositionIds)`
  (exported, mirrors the store's authority; **knows no `usingFacilityId`**, so a TAC_C2 session is offered nothing and the
  controlling Position is offered Approve with no request on a Facility-used AREA, and it offers Approve/Deny on a ROUTE),
  `_buildAirspaceCard`, `renderAirspacePanel`, `initAirspacePanel` (caches `#airspace-list`/`#airspace-empty` from
  `index.html`, dockview detaches inactive roots), and two `registerEfspMessage` handlers (`efsp-airspace-delta`, `-ack`;
  the ack only toasts errors/occupied warning). `efsp-airspace-calendar` has no handler.
- `efsp-state.js`: `efspAirspaces` Map keyed by `airspaceId`, filled by `applyEfspSnapshot` (`msg.airspaces`) and
  `applyEfspAirspaceDelta` (**ignores `airspaces.removed`**), `getAllEfspAirspaces`, `stripsInAirspace`.
- `efsp-ws.js` `sendEfspAirspaceMutation(actingPositionId, airspaceId, baseRev, op)`: builds `{clientMutationId, airspaceId,
  baseRev, actingPositionId, op}`, **no `baseDefRev`, returns nothing** (the cmid is not visible to the caller).
- No client mirror of the authority rows, no Facility->Position table (the wire has no Facility configs), no validator.
- crc-sync as merged (2S-A/2S-B), read not edited: records on the wire are `viewOf(record)` =
  `{airspaceId, theater, definition, defRev, rev, state, window, pendingRequest, transitions[], updatedAt, updatedBy, lastDenial?}`.
  **`definitionHistory` is not on the wire** (stripped by `viewOf`; only `store.getHistory`). Ack fields: see wip/AIRSP-2S-A.
  `efsp-airspace-calendar {theater, byAirspace:{id:[{startUtc,endUtc,by,altitudeFt}]}, bookingUrl?}` is sent on connect and on change.
- `main.js` `setWindowOpenHandler` denies every `window.open` but the Casdoor login: there is **no external-link path** today
  (the update-required link's `target=_blank` is dead in the packaged app too).
- Tests that constrain me: `module-graph.test.mjs` (every module reachable from main.js, export-name fixture
  `tests/fixtures/module-graph-exports.json`), `ws-message-contract.test.mjs` (a registered type must be one the server scan
  finds; the calendar frame is `version: 1`, so the scan misses it).

## What was built

New client modules under `crc-desktop/app/public/js/panels/efsp/`:
- `airspace-validate.js`: hand copy of `validateAirspaceDefinition`, `polygonSelfIntersects`, `checkReferences`, the constants, plus `diffDefinitions`. Parity: `tests/airspace-validate-parity.test.mjs` (54 cases through both).
- `airspace-capabilities.js`: the authority-row mirror (rows, USING_AGENCY class row, Facility->Position table, `authorityFor`, `isUsing`, `createPositionsFor`). Parity: `tests/airspace-capabilities-parity.test.mjs` (reads `authority/` and the shipped facility JSON).
- `airspace-editor.js`: pure model (editable fields and reasons, R3-23 lock, draft, dirty, patch, per-field validation, impact note, conflict table and resolution) and the inline DOM editor. `tests/airspace-editor.test.mjs`.
- `airspace-detail-views.js`: History and Delete (models + DOM). `airspace-calendar.js`: calendar state, next booking, format. `tests/airspace-panel-views.test.mjs`.
- `airspace-geometry-editor.js`: the stub `mountGeometryEditor(container, definition, onChange)`; 2P-B replaces the file whole.
- `css/airspace-panel.css` (one `<link>` added to `index.html`).
- `airspace-panel.js`: Facility grouping, MINE/ALL (persisted in localStorage, forced ALL when signed on to nothing), `+ New airspace`, the card menu with reasons (`Owned by AP`, first blocker), `Using: TACTICAL`, ID and limits line, ROUTE labels (Confirm, Delay with an inline note, no Deny, a filed-flight count and no warning), the calendar chip, ack routing into the open form, and the `efsp-airspace-calendar` handler. `airspaceActionsFor` was extended (usingFacilityId, TAC_C2, ROUTE); its existing 9 tests are unchanged and green.
- Main process: `crc-desktop/external-link.js` (Electron-free gate, S-2PA0), `main.js` (`setWindowOpenHandler` opens a URL only when `externalLinks.canOpen(url)`, IPC `external-link-allow`), `app/preload.js` (`crcLinks.allowBookingUrl`), `package.json` `build.files`. `tests/external-link.test.js`.

## Shared-file edits (minimal)

- `efsp-state.js`: `efspAirspaceEdits` (client edit log), `airspaces.removed` handled, snapshot logs edits made while away, reset also clears airspaces.
- `efsp-ws.js`: `sendEfspAirspaceMutation(..., op, extra = {})` spreads `extra` (`baseDefRev`) and returns the cmid.
- `main.js`, `app/preload.js`, `package.json`, `index.html` (one link), `e2e/helpers/modules.js` (two module keys), `e2e/helpers/sync-supervisor.js` and `playwright.config.js` (`'{}'` fixture, separate commit), `tests/ws-message-contract.test.mjs` (scan the calendar frame's `version: 1`), `tests/fixtures/module-graph-exports.json` (re-recorded: only the new modules' exports).

## Defaults taken (P2)

- History shows state transitions (complete, on the wire) plus the definition edits this window saw arrive; `definitionHistory` is not on the wire (see findings).
- "Mine" = airspaces whose controlling Position OR using side (a using Position, or a `use` Position of the using Facility) you are signed on to; with nothing signed on the list is ALL and the toggle disabled.
- `+ New airspace` creates an AREA only (a ROUTE needs 2P-B's leg editor); the Facility/Position pickers offer only what the session may create (OWN = itself, FACILITY = OPS's Facility).
- Choosing a using Facility clears the using Position field (at most one using agency).
- Delay uses an inline note field, not `window.prompt` (Electron has no prompt). Deny still uses the old prompt (left as found).
- Choosing Theirs for every clashing field with nothing else left says "Nothing left to save" and sends nothing.
- A booking link opens only when crc-sync sent a `bookingUrl` and only on that origin (S-2PA0); with none, no link is drawn.
- Calendar times are real UTC with the date, next booking not yet ended by the wall clock (`Date.now()`: a booking is a real-world slot, not an EFSP fact).
- DA-8 (coordinate format DMS/DM/MGRS) touches only geometry text, which is 2P-B's; 2P-A shows point counts only.

## Findings

- For a later crc-sync lane: **definitionHistory over the wire** (the record view, ack and snapshot strip it). Until then a window that connects after an edit cannot show it.
- For 2P-B: `openAirspaceEditor` mounts `mountGeometryEditor(geoHost, definition, onChange)` with `definition` carrying `kind`, `geometry`/`segments`/`defaultWidthNm`; `onChange(patch)` must be a patch of those keys; the optional `setReadOnly(reason)` is called when the session may not change them (R3-23). The draft keys are `geometry`, `segments`, `defaultWidthNm`. The kind chooser is not offered on create (add it with the leg editor). Import `validateAirspaceDefinition`/`polygonSelfIntersects` from `airspace-validate.js`.
- The e2e rig has no DCS mission, so crc-sync has no current theater and the panel shows nothing: the spec injects records through the client dispatcher and captures sends via the sender setter. A real create/edit round trip needs a mission-fed rig.
- `main.js`'s old window-open handler denied all links, so the update-required link was dead in the packaged app; it stays denied (its origin is not the booking origin).
- `module-graph-exports.json` must be re-recorded by 2P-B (GOLDEN_RECORD=1).

## Release note

"The AIRSPACE panel can create, edit and delete airspaces (the controlling Position, or OPS of its Facility), shows History, resolves two-controller edit conflicts field by field, groups by Facility with a MINE/ALL toggle, and shows the next booking with a link to the booking page."

## Walks not done

A live two-window race against a real crc-sync (the conflict table is covered with a built STALE_REV ack in the browser and at model level); the packaged Electron link open (the gate is unit-tested, `shell.openExternal` is not exercised).
