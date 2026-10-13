# LT-MARSA wip note (ADR 0118)

## What was built

- **CA eligibility (H134 LT-RQ16 a):** CA only between two correlated (CORRELATED/PROVISIONAL) tracks; nothing between
  two uncorrelated. The "Not suppressed: a pair with no Strips" rule is gone (`crc-sync/src/conflict-alert.js` header).
- **MCI (H134, H136 VQ7 a, VQ8 a):** `kind: 'MCI'` on the `conflictAlert` entry, `intruder` = the uncorrelated track;
  only for an intruder whose transponder replies. Facility key `modeCIntruder` (INCIRLIK/CARRIER 500 ft AGL, CENTER
  5,000 ft MSL + 1,500 AGL over high ground, `inhibitedPositions` []). Per-session delivery in the hub.
- **Groups (T16):** no CA/MCI inside one flight data or one ACTIVE MARSA relation; uncorrelated wingmen within 1 NM /
  1,000 ft of a tracked flight with `flightSize > 1` are its members (ours).
- **Air refueling (T17/T18, LT-RQ10):** receivers under TANKER_ACCEPTED MARSA are checked against tanker ±1,000 ft and
  3 NM (`WRONG_WAY`/`LEVEL_BUST` with `tanker`, new `TANKER_DISTANCE`), no heading check; the tanker is checked as usual.
- **T14:** MARSA op `AcknowledgeVoid` (holder of a participant Strip only); client Acknowledge button; acknowledged =
  nothing shown.
- **T15:** `bay-view.js` reconciler: a protected Strip holds its place. Spec reproduces on the old code.

## Defaults taken (P2)

1. "Tracked" includes PROVISIONAL (it carries the flight identification on the label).
2. "Reports altitude" = transponder replies (server-wide), not per session sensor.
3. Ground unknown (no MapTiler key / tile not cached) = sea level for the AGL floor; the CENTER high-terrain rule only
   where the ground is known.
4. `inhibitedPositions` is facility config, not a controller toggle (¶12-6-12 d gives it to the facility manager).
5. Formation member recognition: 1 NM lateral, 1,000 ft vertical (`alerting.json` `formationLateralNm`,
   `formationVerticalFt`); nearest first, at most `flightSize - 1`; a member counts as tracked against outsiders.
6. AR vertical ±1,000 ft (`refuelingBlockFt`), lateral 3 NM (`refuelingLateralNm`); WRONG_WAY measured from the block
   edge with no 400 ft band (needed for the human's 1,350 ft example), LEVEL_BUST beyond the 500 ft buffer after having
   been inside; TANKER_DISTANCE only after the receiver first closed within 3 NM; persistence reuses the conformance
   persist times.
7. Tanker = ATO `military.arInfo.asTanker`, else callsign matching the declaring callsign (spaces/hyphens ignored);
   none found = no altitude/heading checks on any participant. MTR_ENTRY/LOCAL_DECLARATION MARSA: ordinary conformance.
8. After MARSA ends, the receiver's conformance memory is reset (a level aircraft off its old altitude does not alert
   until it reaches it again; one still climbing away alerts WRONG_WAY).
9. Strip chip text: "Conflict Alert X 0:55" / "Mode C Intruder X 0:40"; data block tags `CA` / `MCI` (CA wins if both);
   refueling tags `AR ↓`, `AR −700`, `AR 3.8 NM`. An MCI acknowledged on the scope stays acknowledged if the pair
   becomes a CA (same pair id).
10. The void exchange row shows only "MARSA VOIDED · <others>" + Acknowledge; the why stays in the existing red reason
    line.

## For the usage guide / briefing (docs pass)

- Guide, Conflict Alert: "CA is between two aircraft with Strips (correlated). An aircraft with no Strip that squawks is
  a Mode C intruder (MCI) against an aircraft with a Strip, above 500 ft AGL at Incirlik and the carrier, 5,000 ft MSL at
  CENTER. Two aircraft without Strips never alert. Aircraft of one formation, and MARSA participants, never alert
  against each other."
- Guide, MARSA: "A void stays on both Strips until the controller holding one presses Acknowledge." "Under MARSA with a
  tanker the receiver is watched against the tanker: within 1,000 ft above or below it and within 3 NM, not against its
  assigned altitude. It is back on its own clearance when MARSA ends."
- Briefing/CLAUDE.md: facility key `modeCIntruder`; MARSA op `AcknowledgeVoid`; conformance kind `TANKER_DISTANCE`.

## Findings for LT-AIRSPACE-ALERT

- "Tracked" for alerting = correlated CORRELATED/PROVISIONAL (`ConflictAlertMonitor` `trackedFlights` in
  `app/monitors.js`); reuse it for "an uncorrelated contact inside active airspace".
- `facilityConfig.getModeCIntruder` and `mciFloorFt` exist if an airspace alert ever needs a base altitude.
- The hub's per-session alert filter hook (`conflictAlertFor` on the alerts object, never sent) is the pattern for
  per-Position delivery of an airspace alert.

## Walks not done

- No live DCS walk of a real AR (tanker/receiver squawk behaviour, wingman stacking distances) — the 1 NM / 1,000 ft
  member recognition should be checked against a real 2-ship and an AR cell.
- MCI against terrain AGL not walked with a MapTiler key.

## Questions for the human (not blocking)

- Should a controller be able to suppress one alert by hand (FAA CO/suppress, ¶5-13-1 c.1(a))? Not built.
- Should the MCI inhibit be a controller toggle per Position at runtime rather than facility config?
