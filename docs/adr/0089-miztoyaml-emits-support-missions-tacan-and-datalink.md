# 0089 — miztoyaml emits tankers and AWACS as missions, with the TACAN and datalink the .miz holds

## Context

**H43** gave atobrief's YAML the fields a USMTF ATO needs (ADR 0078): package id and commander, IFF Mode
1/2/3, datalink (Link 16 callsign, TACAN, JU), alert status, vul window, report-in point, and tanker/AWACS
mission detail. In that design, tankers and AWACS are ordinary missions (`REFUELING` / `AEW`), and
`registry.tankers[]` / `registry.control_agencies{}` link to them through `mission_number`. That link
produces `REFTSK`, `5REFUEL` and `7CONTROL`.

miztoyaml skipped AWACS and tanker flights, and emitted none of these fields. So every package converted
from a mission had to be completed by hand, although the `.miz` holds the support groups, their TACAN
beacons and most datalink settings. **S-R2-10** made this a separate Python lane (L25).

Other decisions this ADR applies:

- **H60:** ATO callsigns are at most 7 characters. Vowels are cut from back to front until the callsign fits.
- **S-L3:** Mode 3 codes in the 6xxx block belong to crc-sync's synthetic AI traffic and are never handed out.
- **H68:** the ATO's date is ignored downstream. The mission's date is used instead.

## Decision

1. **One mission per flight, in flight order.** Tanker flights become `mission_type: REFUELING`, and
   AWACS flights become `AEW`. Everything else keeps its DCS task label. Mission numbers run from the
   existing hash-derived start, so support flights take numbers in the same sequence.
2. **The registry links each support flight to its mission.** `registry.tankers[].mission_number` and
   `registry.control_agencies.<callsign>.mission_number` hold the mission's `mission_number`. A tanker entry
   also gets these fields:
   - `freq_mhz`, the group's frequency;
   - `tacan`;
   - `arcp`, the orbit waypoint's name, when it has one;
   - `system`, from a fixed table of DCS tanker types (KC-135 and KC-10 give `BOOM`; KC-135MPRS, KC-10
     drogue, KC-130, S-3B and IL-78 give `DROGUE`). An unknown type leaves `system` out.
3. **TACAN comes from the group's `ActivateBeacon` task** with `type = 4`. The value is channel plus band,
   for example `39Y`. It fills the tanker registry entry and the mission's `datalink.tacan`.
4. **Datalink comes from the flight lead's `AddPropAircraft`:**
   - `datalink.l16_callsign` is `VoiceCallsignLabel` plus `VoiceCallsignNumber`, for example `ED11`;
   - `datalink.ju` is `STN_L16`, 5 octal digits.

   Both are written as strings, so leading zeros survive YAML. When the `.miz` has neither, `datalink`
   is null.
5. **Callsigns follow H60.** The group name is upper-cased and stripped of anything outside A–Z and 0–9.
   Then vowels are cut from back to front until it fits in 7 characters. This is the same rule as crc-sync's
   ATO import (L14's `fitCallsign`). If the name still does not fit once every vowel is gone, it is emitted
   normalised but uncut, for example `STRAWBERRY11`. atobrief's export flags it as `CALLSIGN_NOT_SEEDABLE`,
   L14 returns null for it, and a planner shortens it. Nothing is invented. The same callsign is used for:
   - the mission;
   - the `registry.callsigns` key;
   - the tanker and agency entries;
   - the steerpoint `flights` lists;
   - the comms `callsign`. The comms `group` keeps the raw group name.
6. **Nothing is invented.** miztoyaml never emits the fields the `.miz` does not hold, and atobrief's
   export reports each one as a gap:
   - IFF Mode 1/2. DCS has a Mode 2 property on some modules, but it is not an ATO assignment;
   - Mode 3;
   - package id and commander;
   - alert status;
   - vul window;
   - report-in point;
   - offload;
   - a receiver's `refuel` link to a tanker;
   - a flight's `control.agency_id`.
7. **`header.ato_date` stays the `.miz` date.** H68 makes the ATO date irrelevant downstream. But
   atobrief's USMTF mapper refuses a package without `ato_date` (`NO_ATO_DATE`), and every DTG is built
   from it. It was already filled from the `.miz`, which is also the mission date, so nothing changes.
8. **`_random_squawk` never returns 6xxx** (S-L3), nor 7500/7600/7700. `build_doc` does not call it today,
   because `spins.sections` is emitted empty. It is fixed so that it cannot hand out a 6xxx code if it is
   wired back in.
9. **Group frequency fix.** The group's frequency is now read from the group's own fields. Before this,
   a flat search found a route task's `ActivateBeacon` `["frequency"]` first, which is the TACAN's
   frequency in Hz. Tankers were getting frequencies such as 1112 MHz.

## Consequences

- A converted package exports `REFTSK` for every tanker and has no `UNKNOWN_SUPPORT_MISSION` or
  `SUPPORT_MISSIONS_NOT_EXPORTED` for them. `tools/tests/test_h43_support_missions.py` builds a fixture
  `.miz`, converts it, and runs the YAML through `atobrief/public/js/usmtf-ato.js` with js-yaml. The test
  is skipped when `atobrief/node_modules` is absent.
- `7CONTROL` appears only once a planner sets `control.agency_id` on the missions an AWACS controls.
- Callsigns in converted packages change: `VIPER-1` becomes `VIPER1`, and `TEXACO11` becomes `TEXAC11`.
  crc-sync's ATO import (L14) applies the same H60 rule, so the two agree. The Python function and L14's
  JavaScript function are separate copies and must be kept equal.
- The tanker AR-system table is the one piece of per-type knowledge. A new tanker type needs a row.
