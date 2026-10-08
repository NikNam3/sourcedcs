# Briefing: DIVERT (design + build) — ADR 0111

Written 2026-10-08 by the supervisor. One agent (H112), Sonnet; follow `docs/parallel/lane-rules.md`, run both unit
suites, commit at every green step, dark-cockpit UI (memory `feedback_dark_cockpit_ui`).

## The human's decision (decisions.md H114, read it)

CTR and AP may divert. A divert means the aircraft is now flying to a different airport, **inside or outside** CTR/APP
airspace, and it gets **a new clearance**. **Departures do not divert** (an emergency is not a divert; a departure that turns
back is told to call Center). Konya and Akrotiri will get Facilities later. Diverting to an untowered field (or one with no
Facility), CTR stays responsible until radar service is terminated: the flight stays an OVERFLIGHT and is terminated once out
of range.

## Today

Only "Convert to Arrival" exists: a DEPARTURE at HANDED_OFF becomes an ARRIVAL (`crc-sync/src/efsp/board/ops/convert-to-arrival.js`,
AP/CTR only, refused while a coordination or TOFI link is open). An OVERFLIGHT cannot become an ARRIVAL, so CTR cannot hand a
diverting flight to the carrier (the carrier hand-off needs an ARRIVAL at INBOUND, `canHandOffToCarrier`).

## Design (write ADR 0111 first, then build)

A **Divert** action on a Strip held by CTR or AP: one input, the **new destination**, plus the amended clearance fields.

| Strip now | New destination | Result |
|---|---|---|
| OVERFLIGHT (INBOUND, IN_SECTOR) | a field we run (Incirlik; the carrier; later Konya/Akrotiri) | ARRIVAL for that field at INBOUND, handed on as usual (CTR→AP, or to CV_MARSHAL) |
| OVERFLIGHT | outside our airspace, untowered, or no Facility | stays OVERFLIGHT with the new destination; handed off at the boundary or terminated when out of range |
| ARRIVAL (to be confirmed by the human — the supervisor proposed it, H114 note) | another field we run | ARRIVAL for the new field |
| ARRIVAL (same) | outside / untowered / no Facility | OVERFLIGHT with the new destination |

- Same Strip id and flight data (plan, ATO line, MARSA, correlation stay).
- The destination and the new clearance (route, altitude) are an **audited amendment** (who, when, old → new), shown struck
  through like other amendments.
- Undoable for 10 s like every one-click move (ADR 0100). Refused while a coordination/TOFI exchange is open (same guard as
  Convert to Arrival). Departures: refused with a clear reason.
- Traffic count: an overflight that became an arrival counts as an arrival.
- Ask the human (via the supervisor) only: whether an ARRIVAL may divert (row 3/4), and which clearance fields the divert
  form shows (default: destination, route, cleared altitude).

## Gates

Both unit suites, `freeze` (goldens move: `freeze:update` once, separate commit), `walk`, `soak:selfcheck` (Board op),
`wire:record` (new op kind). Specs: divert an overflight to Incirlik and hand it to AP; to the carrier and hand it to
CV_MARSHAL; to an untowered field and terminate; a refused departure; undo. Walk the pilot requests: a divert cancelled
(divert back), a divert during a hand-off, a divert by a controller holding both AP and CTR.
