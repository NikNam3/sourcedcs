# U-AIRSPACE-BADGE (wip notes)

Lane U-AIRSPACE-BADGE, 2026-10-21. ADR 0134. Ruling H155 item 4.

## What was built

- crc-sync `efsp/airspace-entry-alert.js`: the monitor's tick also computes, per live Strip with an `airspaceEntry`,
  whether its flight is airborne inside that airspace (any state), via `airspaceStore.containing` (same
  `containment.evaluate`, same indicated feet, same `_eligible` filters). `getInside()`, `insideFor(positions)`.
- `app/monitors.js` + `ws-hub.js`: `efsp-alerts` gains `airspaceInside: [{facilityId, stripId, airspaceId}]`, per session
  to the Strip's holder only. `read-scope.js` keeps visible Strips only for an OWNED scope.
- crc-desktop `alerts-state.js` `airspaceInsideForStrip(strip)`; `strip-indicators.js` `airspaceBadgeTone`; the badge is
  amber only when inside and not ACTIVE. `bay/strip-signature.js` includes the fact (`asp:…/in`), re-rendered by the
  existing `alerts` topic.
- Tests: `crc-sync/tests/airspace-inside-fact.test.mjs` (8), `crc-desktop/tests/airspace-badge.test.mjs` (2), the
  reachability badge test rewritten, `crc-desktop/e2e/airspace-badge.spec.js` (1, lane 7). Wire surface, module-graph
  fixture and freeze goldens re-recorded (goldens: only the empty `airspaceInside` key added).

## What the usage guide should say (for the owner of docs/efsp-usage-guide.md)

> **Airspace badge.** A Strip approved into an airspace shows the airspace's name, frequency and entry block. It is grey
> while the aircraft is on the ground, en route, or inside an active airspace. It turns **amber** only while the aircraft
> is airborne inside its approved airspace and that airspace has not been activated (hover: "<name> is SCHEDULED, not
> active"): the block still belongs to the controlling agency, so the aircraft is working it unprotected. Activate the
> airspace, or move the aircraft out. Only the controller holding the Strip sees the amber.

And for `docs/efsp-briefing.md`: efsp-alerts carries `airspaceInside` (ADR 0134), computed by the airspace-entry monitor.

## Defaults taken (P2)

1. **Carrier:** a new `airspaceInside` slice in `efsp-alerts`, computed by the airspace-entry monitor, not the
   surveillance hint (reason in ADR 0134 §2: the hint monitor has no airspace geometry; adding it would be a second
   containment path).
2. **Delivered to the Strip's holder only** (Facility + owner Position match), as the briefing says. Other sessions that
   can see the Strip see grey.
3. **Inside = the alert's `_eligible` filter + a finite altitude** (airplane/helicopter, >= 50 kt, track >= 10 s). A
   hovering helicopter is therefore not inside (grey). Flagged as a follow-up in the ADR.
4. **Any of the flight's tracks** (lead or formation wingman) counts, as the card list.
5. **Any airspace kind** the Strip is approved into (an AREA or a ROUTE) uses `containment.evaluate` as `containing` does;
   JURISDICTION areas are never approved into, and `containing` skips them.
6. No airspace record on the client (unknown): grey.

## Walks done (unit test `the walk: …` in airspace-inside-fact.test.mjs, plus the client tests)

- Approved early, parked (0 kt) under the block: not inside → grey.
- Takes off, inside while the block is SCHEDULED (cold): inside → amber, title "<name> is SCHEDULED, not active".
- Block activated while inside: client tone grey (`airspaceBadgeTone(ACTIVE, true)`), the server fact stays true.
- Leaves (laterally, below, above the limits): not inside → grey.
- Entry approval cleared while inside: no fact for that Strip, no badge.
- A second Strip of the same flight (another Facility) approved into the same airspace: gets the same fact, to its own
  holder. Strip handed to another Position: the new holder is told, the old one no longer.
- Not walked against a live DCS: the e2e rig has no units, so the spec injects the fact.

## Findings for other lanes / the supervisor

- `crc-desktop/e2e/airspace-entry-alert.spec.js` (pre-existing) cleans up with `DeleteAirspace` without `baseDefRev`, so
  the server refuses it ("DeleteAirspace needs baseDefRev", seen in a screenshot) and the test airspace is left behind on
  the rig. `moa-transit.spec.js` and `u-moa.spec.js` pass `{ baseDefRev: a.defRev }`; the new spec does too. Not fixed
  here (not this lane's spec).
- No literal Position ids or Facility defaults were added to rules (lane rule 9): the holder match is the Strip's own
  `facilityId:ownerPositionId` against the session's signed-on Positions. Ids appear in tests only.
