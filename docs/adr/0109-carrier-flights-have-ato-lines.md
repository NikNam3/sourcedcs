# 0109 — Carrier flights have ATO lines

## Context

The ATO import (ADR 0071) makes a MISSION line on TACTICAL for every mission line it reads, and nothing in `ato/`
knew a carrier. A UNION-based flight therefore had an ATO line and, separately, a flight made for the launch Strip
CV_MARSHAL creates (ADR 0064, 0074); nothing joined them but the callsign, so the launch carried none of the line's
plan, MARSA or military Blocks and minted a second Mode 3/A. `config/efsp-instrumentation.json` listed only
`INCIRLIK: ["LTAG"]` as a home airport, so every Strip of the CARRIER Facility was `UNKNOWN / NO_HOME_AIRPORT_CONFIGURED`
though L17's Q9 ruled a launch, a trap and a recovered pattern flight each count once, and H33 ("departs and lands at
the same Facility's airfield") had no answer for a ship. The human ruled (H109, 2026-10-04): "carrier flights also
have ato lines." Q3-6 option (a) is the default.

## Decision

- **A carrier mission is recognised from the ATO's own text.** An AMSNDAT `DEPLOC` or `ARRLOC` that names a configured
  hull (`carrier/hull-config.js` `hullForLocation`: the DCS unit name `UNION`, the id `CVN-72`, the label or the type
  `CVN_72`, alone or as one word of the text; case, spaces, hyphens and underscores ignored; an airfield never
  matches) marks the line. The result is `{ hullId, hullCode, departs, recovers }`, kept on the line as `flightData.ato.carrier`
  and on the preview line as `carrier`; both keys are absent for a land-based line, so nothing else changes shape.
  A carrier line is a MISSION line on TACTICAL in `tac-c2-tasked`, made, bound and updated exactly as any other. A re-import
  replaces `ato` wholesale, so a moved DEPLOC changes the record with it.
- **A launch binds to its line by callsign, on the server.** L14's ATO-first direction for OPS is a picker in the client
  that sends `flightDataId`; CV_MARSHAL has no picker. `carrier/ato-bind.js` `atoFlightForLaunch`, called from
  `CreateStrip` for a MARSHAL Strip created in LAUNCH from `flightData` (no `flightDataId`), binds the new Strip to
  the flight of the one ATO-tasked flight whose callsign it carries when that flight has a live MISSION Strip on
  TACTICAL and no other live Strip anywhere. Several matches, none, or a flight already filed or launched: no bind, a new flight as
  before (ambiguity is an answer, ADR 0046). An explicit `flightDataId` is never overridden. The result carries the existing
  warning `BOUND_TO_ATO`; no frame or op shape changes. The line need not be carrier-marked (a mission with no
  DEPLOC still launches from the ship). The same op as every bind: no second beacon code, and the flight keeps its plan, MARSA
  and military Blocks.
- **The other direction already worked.** A launch Strip made first is a non-MISSION Strip on a flight, so L14's
  `bindCandidatesFor` offers it to an ATO line with that callsign and preselects it when it is the only one.
- **The hull is a home field.** `trafficCount.homeAirports` gains `"CARRIER": ["UNION"]`. For a carrier Strip type
  (MARSHAL, FINAL, PATTERN) `classifyLocality` knows one end by itself: a Strip dropped from `LAUNCH` departed this hull; any other
  carrier Strip is a recovery and lands on it. The other end is the filed plan's airport, else the flight's ATO line
  (the hull code when the line departs/recovers on the hull, else its DEPLOC/ARRLOC), else unknown. LAUNCH + ATO line
  recovering on the hull is LOCAL; launching from UNION and recovering at Incirlik, by the filed plan or by the ATO's
  ARRLOC, is **TRANSIENT** (the Q3-6 default; the human may overrule); a launch with nothing known about where it lands
  stays `UNKNOWN / NO_AIRPORT_DATA`, not guessed. Land Strips are untouched. Counting itself (a launch, a trap, a recovered
  pattern flight each once) is ADR 0074's and unchanged. `classifyLocality` takes a fourth argument, `{ preDropState }`, from
  the Mutation log entry's `before`.

## Consequences

- The Marshal types the callsign and gets the ATO line's flight. A mistyped callsign makes a second, unbound flight, as it
  always did; the `BOUND_TO_ATO` warning says when it did bind.
- A flight with a line but no launch Strip yet is not "filed": the launch takes it. Two launches of one callsign: the
  second is a new flight.
- A cancelled launch (the Strip dropped) leaves the line and the ATO's squawk; the next launch binds again.
- `homeAirports` is a per-Facility list of codes; the hull's code is its DCS unit name, so a second hull needs its own
  entry and the carrier Strips' implicit hull is the Facility's first listed code (v1 has one hull, H29).
- Nothing on the wire changes shape (`wire:record`: surface unchanged), so no protocol bump.
