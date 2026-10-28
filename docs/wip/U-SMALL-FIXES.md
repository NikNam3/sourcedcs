# U-SMALL-FIXES (lane note)

Briefing: `docs/parallel/next/U-SMALL-FIXES.md`. Decisions S-ARCH-75, S-ARCH-76, H156 (MTB-Q2 b, MTB-Q3).

## Item 1: a cleared assignment is no clearance (`vfr.js`, S-ARCH-76)

- `setClearance` records clearing an altitude or heading as an ACTIVE entry with an empty value (ADR 0058's
  append-only history, the docstring says so). Kept at the source: the clearing is an amendment and stays in the cell.
- `hasNoClearance` (server and client hand copy, parity test) now counts only an ACTIVE entry with a non-empty value;
  an entry with no string value (hand-built shapes) counts when it has a parsed value or a block.

## Item 2: spec cleanup sends `baseDefRev` (S-ARCH-76)

- `crc-desktop/e2e/airspace-entry-alert.spec.js` sends `{ baseDefRev: a.defRev }` with `DeleteAirspace` and now polls
  that the airspace is gone (so a refused cleanup fails the spec). The other specs that delete airspaces
  (`airspace-badge`, `moa-transit`, `u-moa`) already sent it; `airspace-panel` checks the UI sends it. Passed on lane 7.

## Item 3: soak `skip-shadow-client` on every seed (S-ARCH-75)

- Why seeds 15, 16, 23, 26 failed: the dropped frame is a Drop's delta (`gone: [id]`), and a later delta that touches
  the DROPPED Strip lists it in `gone` again (`wire/frames.js` `touchedStrips`), so the shadow was already right at the
  next 60 s checkpoint (seed 15: dropped at 187.8 s, repaired by seq 127 at 223.6 s, checkpoint at 240 s).
- No frame is beyond repair (any later touch re-sends the `gone`), so the fix is the one drop-broadcast already uses:
  `send()` judges the client that missed the frame at once (`where: 'post-skip'`), while the withheld Drop is the newest
  truth. Seeds 1–30: all ok (drops 1, staleness 1, cause UNKNOWN).

## Item 4: a transit decline stays until acknowledged (H156 MTB-Q2 b, ADR 0136 §1)

- `AcknowledgeTransit { flightDataId }` on the airspace family: removes a DECLINED transit; rights = a Position holding a
  live Strip of the flight now. The 5-minute `DECLINE_SHOWN` sweep and `DECLINED_TRANSIT_SHOWN_MS` are gone; the
  `NO_LIVE_STRIP` end, the release and the mission reset stay.
- Client: Strip ⋯ menu "Acknowledge transit decline <name>" (`acknowledgeableTransits`), card row "Acknowledge"
  (`transitRowOffer().acknowledgeAs`). `moa-transit.spec.js` now acknowledges after the decline and checks the mark goes.

## Item 5: the grey COORD mark (H156 MTB-Q3, ADR 0136 §2)

- Server: the airspace-entry monitor's filed-through pass yields `airspaceCoordinate: [{facilityId, stripId,
  airspaceId}]` on `efsp-alerts`, per Strip holder (`coordinateFor`, as `insideFor`), OWNED scope filtered. Condition:
  ACTIVE AREA of `TRANSIT_TYPES`, filed route crosses it by geometry, IFR, no transit in any state, not `_approved`.
- Client: grey `COORD <name>` in the transit slot (class `efsp-coordinate-mark`, not `efsp-transit-mark`, so the transit
  spec's locators stay unique), title `Filed through <name> (<STATE>): no transit or entry approval`; in the render
  signature (`crd:`).
- No e2e spec for the mark: the rig has no mission nav points, so no filed route resolves (ADR 0128 §5); covered by
  `crc-sync/tests/airspace-coordinate-fact.test.mjs` and the client reachability test.

## What the guide / briefing should say (docs pass)

- `docs/efsp-usage-guide.md` (transit section): a decline stays on the Strip (`TRANSIT <name> DECLINED`) and on the card
  until the controller holding the flight picks "Acknowledge transit decline <name>" from the Strip's menu, or
  "Acknowledge" on the card row; nothing expires after 5 minutes any more. A grey `COORD <name>` on a Strip means the
  flight's filed route crosses that active MOA/warning/restricted area and nothing is coordinated yet (no transit, no
  entry approval); it goes on Request transit, an entry approval, or the airspace going cold.
- `docs/efsp-briefing.md`: ADR 0136 amends ADR 0128 §2 (no DECLINE_SHOWN) and §6 (the COORD mark); `efsp-alerts` has
  `airspaceCoordinate`.
- A cleared ALT/HDG (empty value) is no clearance: the flight reads VFR again for the transit and entry-alert rules.

## Defaults taken

- Item 1: clearing stays an entry at the source (append-only history, ADR 0058); the reader (`hasNoClearance`) is fixed.
- Item 3: no frame is unrepairable (a later touch re-sends the `gone`), so the skipped client is judged at once after
  the skip, like drop-broadcast's post-drop judge.
- Item 4: acknowledge rights = whoever holds a live Strip of the flight now (the briefing's recommendation), not only the
  requesting Position; not gated on ACTIVE or IFR.
- Item 5: mark text `COORD <name>`; delivered to every live Strip holder of the flight (not only the owner of one);
  only the route-geometry reason counts (the other "filed" reasons are approvals); a transit in any state hides it.

## Findings for other lanes / the supervisor

- `airspace-entry-alert.js` imports `TRANSIT_TYPES` from `authority/airspace.js` (U-ROLE-POSITIONS' directory): read
  only, no edit there.
- Item 5 relies on the filed route resolving (mission nav points, airports, ROUTE fixes): a stereo route through a MOA
  shows no COORD until AIRAC fixes exist (H152), as it is not listed as filed either.
