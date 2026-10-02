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
