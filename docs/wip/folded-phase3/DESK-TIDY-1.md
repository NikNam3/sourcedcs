# DESK-TIDY-1 (phase 3, client lane, E2E_LANE 2)

## Done
1. **Topology module.** `crc-desktop/app/public/js/panels/efsp/facility-topology.js` (a leaf: imports nothing) owns the
   Facility -> Position table, `DEFAULT_FACILITY_ID`, `RANGES_FACILITY_ID`, `facilityOfPosition`, `positionsOf`,
   `shippedFacilityIds`, `allFacilityIds`. Deleted: `airspace-capabilities.js`'s table (re-exports it),
   `radar-panel.js`'s `EFSP_FACILITY_POSITIONS`, `efsp-ws.js`'s `DEFAULT_EFSP_FACILITY_ID` and hard-coded signed-on keys,
   the `'INCIRLIK'` fallbacks in `metrics-panel.js` and `create-strip.js`, `ato-import.js`'s `'TACTICAL'`, and every literal
   Facility in `authority-mirror.js`'s `COORDINATION_TARGETS`, `CARRIER_HANDOFF_TARGET`, `TOFI_COUNTERPARTS` (now
   `facilityOfPosition(positionId)`). `tests/facility-topology-parity.test.mjs` reads `crc-sync/config/efsp-facility-*.json`
   and the `DEFAULT_FACILITY_ID` line of `facility-config.js` (text, so SERVER-SEAMS-1 ending the singleton cannot break it);
   it also fails if one of the four consumer files hard-codes `'INCIRLIK'|'TACTICAL'|'CENTER'` again. The old D-9 tests in
   `client-mirror-parity.test.mjs` that regex-read the removed consts are replaced by it.
2. **Parity tests** (`tests/client-rule-tables-parity.test.mjs`, 5 tests): `LINES_WITH_OTHERS` vs tactical.js
   (`handBackTargetsFor`/`tofiAnswererFor`); `LOCAL_POSITION`/`NON_LOCAL_TOWER` vs `combination.js`; `handoffSteps` /
   `buildStepOp` actions vs `handoff-control.js` `MARKS`/`RELEASE_ACTIONS` (both directions); `_canMarkTofiEntered` vs the
   server's `Tofi._applyTofiMarkEntered` run on a stub over every precondition combination; `getEfspRack` vs
   `BoardState.rack`. Row 20 (web `airspace-coords.js` vs desktop `coords.js`) is already covered by
   `tests/web-airspace-parity.test.mjs` (WEB-DATA B11): not duplicated.
3. **Real-server airspace e2e**, `e2e/airspace-server.spec.js` (2 tests, ~30 s): create, edit, geometry (a DCS drawing, then
   clearing it) and delete are each answered by crc-sync's own `efsp-airspace-ack` and verified from a second controller's
   page. The rig had no theater, so the server refused every panel op "no mission loaded"; `e2e/helpers/fake-dcs.js` is a
   DCS-gRPC stand-in (GetTheatre + one airdrome, nothing else) the spec starts, and `harness-env.js` now points
   `DCS_GRPC_HOST` at `syncPort + 200` (nothing listens there for any other spec, same hermetic "no DCS") and sets
   `CRCSYNC_MISSION_SESSION_PATH` into the throwaway state dir (before, a loaded mission would have been written into
   `crc-sync/state/`). The one injected frame is the mission's drawings (the fake serves none).
4. **Docs.** `docs/wip/FREEZE.md` brought up to the per-golden grain / `PROJECTION` hashes / `module-graph` client guard /
   M17. `docs/efsp-briefing.md`: the Hand Off double-tap note. Verified in code first: `invoke-nla.js` sets the latch only
   `if (applied.ok && !result.transferTo)` and a carrier handoff returns before it.
5. TOFI-C screenshot now `test.info().outputPath('tofi-c.png')` (it had been writing into `docs/wip/TOFI-C/`; no
   scratchpad path was left on this branch).

## Defaults taken
- The topology stays a parity-tested table, not derived from the snapshot: the "acting as" checkboxes and the airspace
  editor's pickers must work before the first snapshot (the old radar-panel comment says the same). RANGES still comes from
  the snapshot. Order of Positions is the table's.
- `create-strip.js`'s per-row `facilityId: 'INCIRLIK'/'TACTICAL'` literals in `OPS/AP/TAC_C2` form tables were left (each row
  names its own Facility next to its Bay id); only the `'INCIRLIK'` argument of the flight-plan create was derived.
- `efsp-ws.js` is DESK-ACKS's file: I touched only the two lines at its top (the default id and the signed-on key table)
  and the one `facilityId = DEFAULT_FACILITY_ID` default parameter, plus one import line. Expect a trivial textual merge.

## Findings for other lanes
- DESK-TIDY-2: `bay-views.js:218` `bay.facilityId === 'CARRIER'` is a kind test, not a topology copy; left. `create-strip.js`
  form tables above could take their Facility from `facilityOfPosition(actingPositionId)`.
- DESK-GRAPH: `facility-topology.js` is a leaf; `authority-mirror.js` and `airspace-capabilities.js` now import it, no new cycle.
- Supervisor: the harness's `DCS_GRPC_HOST` changed from `127.0.0.1:1` to `127.0.0.1:<syncPort+200>`. A lane running two
  harnesses at once is unaffected (ports are per lane), but anything else listening on 3210-3219 would be seen as DCS.
- The airspace spec's readiness signal is `crc.airspaceLayer.currentTheater() === 'Syria'` (the `init` frame crc-sync sends
  once it has loaded the mission), not a sleep.
