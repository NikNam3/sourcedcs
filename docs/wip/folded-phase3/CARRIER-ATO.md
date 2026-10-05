# CARRIER-ATO (H109, ADR 0109)

Branch `lane/CARRIER-ATO-carrier-ato`. Server only; no client change, no wire shape change (`wire:record`: surface unchanged, protocol stays 2).

## What changed
- `carrier/hull-config.js`: `hullForLocation`, `hullCode`. `ato/ato-board.js`: `carrierOf`, `flightData.ato.carrier`, preview `carrier` (absent on land lines, so the existing goldens did not move).
- `carrier/ato-bind.js` + `board/ops/create-strip.js`: a MARSHAL/LAUNCH created from `flightData` binds to the one ATO flight with that callsign (live MISSION line on TACTICAL, nothing else live); warning `BOUND_TO_ATO`.
- `traffic-count.js` `classifyLocality(strip, fd, home, { preDropState })`; `config/efsp-instrumentation.json` `CARRIER: ["UNION"]`.
- Tests: `tests/efsp-scenario-carrier-ato.test.mjs` (17). Goldens: `hub-resync-metrics.json` (CARRIER homeAirports, one value), new `scenario-carrier-ato.json`.
- Docs done by this lane: ADR 0109, usage guide (§8I, §8K), briefing (ATO section, Q3-6 row).

## Defaults taken
- Q3-6 (a). UNION launch recovering at Incirlik is TRANSIENT (human may overrule). Launch with no plan and no ATO line stays UNKNOWN.
- Bind is server-side (the Marshal has no picker) and does not require the line to be carrier-marked.
- The hull's code is its DCS unit name; the implicit hull of a carrier Strip is the Facility's first `homeAirports` entry.
- The preview dialog does not show the hull (client untouched; DESK-GRAPH is restructuring `crc-desktop/app/`). `ato.carrier` is on the flight if a later lane wants a tag.

## Walks done (all in `efsp-scenario-carrier-ato.test.mjs`)
callsign change after bind (re-import is UPDATE by line id, callsign kept); launch with no ATO line; ATO import after the launch exists (BIND); divert (ARRLOC LTAG and filed destination LTAG: TRANSIENT); cancelled launch (line and squawk stay, relaunch binds); re-import with moved DEPLOC; two lines one callsign (ambiguous, no bind); a second launch of a bound callsign (new flight); permission unchanged.
Not done: a real recovery Strip through FINAL/PATTERN into the count (unit-tested via `classifyLocality`, not walked); two hulls; Playwright (no client change).

## Findings
- A recovery Strip whose flight has no plan or ATO line has no known departure, so it counts UNKNOWN; the flight data does not remember "launched from the hull". If the human wants every UNION cycle LOCAL without an ATO line, record the launch on `military.carrier` at the Launched NLA.
- `CreateStrip` for a Strip of another Facility that matches an ATO callsign is not bound (only the launch is); OPS keeps the picker.
