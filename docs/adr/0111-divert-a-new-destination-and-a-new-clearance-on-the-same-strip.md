# 0111: Divert is a new destination and a new clearance on the same Strip

**Status.** Built (lane DIVERT, 2026-10-08). Rulings: decisions.md **H114** (CTR and AP may divert; none for departures; an
untowered field keeps the flight with CTR until radar service ends) and **H120** (an ARRIVAL may divert; the form's
clearance fields come from FAA JO 7110.65). Vocabulary is the glossary's: Position, strip type, flight data, staffed.

## Context

Today the Board can turn a DEPARTURE at HANDED_OFF into an ARRIVAL in place (`ConvertToArrival`, ADR 0023). Nothing turns an
OVERFLIGHT into an ARRIVAL, so CTR cannot hand a flight that now wants Incirlik to AP, and cannot hand one that wants the
carrier to CV_MARSHAL (the carrier hand-off needs an ARRIVAL at INBOUND). An ARRIVAL whose field closes cannot be pointed
somewhere else either. The controller's only recourse is to drop the Strip and create a new one, which loses the flight
data, the beacon code, the ATO line, MARSA relations and the correlation.

## What the FAA order says (the part we copy)

Read 2026-10-08 on `https://www.faa.gov/air_traffic/publications/atpubs/atc_html/chap4_section_2.html` and `chap4_section_5.html`
(JO 7110.65BB, the edition the FAA page serves that day).

- **¶4-2-1 Clearance Items.** Issue the items "in the order listed": aircraft identification; **clearance limit** ("when the
  clearance limit is an airport, the word 'airport' must follow the airport name", phraseology `CLEARED TO (destination)
  AIRPORT`); SID or vectors where applicable; **route of flight**; **altitude data in the order flown**; Mach number if
  applicable; **holding instructions**; **any special information**; frequency and beacon code information.
- **¶4-2-5 Route or Altitude Amendments.** A route in a previously issued clearance is amended by one of four methods
  (`CHANGE (portion) TO READ (new portion)`; `(amendment), REST OF ROUTE UNCHANGED`; `CLEARED DIRECT (fix)` or `CLEARED DIRECT
  (destination) AIRPORT`; or the entire route restated). "When route or altitude in a previously issued clearance is amended,
  **restate all applicable altitude restrictions**." A restated "maintain" altitude is itself an amended clearance, and
  omitting earlier restrictions cancels them (the Note under the example).
- **¶4-5-7 Altitude Information.** The altitude instruction is "maintain" or "cruise", a climb/descent with restrictions as
  required, crossing altitudes at a fix. We take only the maintain altitude and its restrictions.

## Decision

### 1. One action, `Divert`, one op kind (`Divert`), AP and CTR only

Granted exactly like `ConvertToArrival` (`AP_CTR_ONLY_OP_KINDS`), refused to every other Position. The acting Position must
own the Strip. It is **ours**, not the FAA's: the order has no "divert" Strip concept; it has amended clearances (¶4-2-5), and
the new destination is the clearance limit of that amended clearance (¶4-2-1).

### 2. The form shows the fields the order makes part of an amended clearance

| Field | Order | Stored as |
|---|---|---|
| **Destination** (required; the clearance limit) | ¶4-2-1 clearance limit | `filed.destinationAirport` on the flight data |
| **Route** (the route as it now stands; blank leaves it) | ¶4-2-1 route of flight; ¶4-2-5 amendment | `filed.route` |
| **Maintain altitude** (blank leaves it) | ¶4-2-1 altitude data; ¶4-5-7 | `clearance.altitude` (the existing append-only history; the old value shows struck through) |
| **Altitude restrictions** | ¶4-2-5 "restate all applicable altitude restrictions" | the Strip's divert record |
| **Holding** | ¶4-2-1 holding instructions | the Strip's divert record |
| **Special information** | ¶4-2-1 any special information | the Strip's divert record |

Not shown, on purpose: aircraft identification (the Strip), SID/vectors (a vector is already its own Block), Mach (not
applicable to the squadron's flights), frequency and beacon code (the beacon code stays on the flight data; a frequency
change is the hand-off's business). The app never says what the controller must say; the four phrasing methods of ¶4-2-5 are
spoken on frequency, the app stores the result. **Ours, not the FAA's:** that the fields are typed into one form, that a blank
means "unchanged", and that the order of the form follows ¶4-2-1.

### 3. The destination decides the result (ours; H114, H120)

`rules.divertDestinationFor(text)` classifies the typed destination: a name from `data/icao.json` is mapped to its ICAO code;
**a field we run** is an airfield named by a Facility's `runwayStatus.airportIcao` (today LTAG) or a carrier hull id from
`config/efsp-carriers.json` (today CVN-72); everything else is not ours. A Facility added later (Konya, Akrotiri) makes its
field ours with no code change.

| Strip now | Destination | Result (same Strip id, same flight data) |
|---|---|---|
| OVERFLIGHT (INBOUND, IN_SECTOR) | a field we run | ARRIVAL at INBOUND in the holder's arrival Bay; handed on as usual (CTR to AP, or to CV_MARSHAL) |
| OVERFLIGHT | not ours | OVERFLIGHT stays, new destination; the state is kept |
| ARRIVAL at INBOUND | a field we run (another one, or the same one again) | ARRIVAL at INBOUND |
| ARRIVAL at INBOUND | not ours | OVERFLIGHT at IN_SECTOR (it is being worked) |

Only a Strip the holder still works is diverted: OVERFLIGHT at INBOUND or IN_SECTOR, ARRIVAL at INBOUND. An ARRIVAL already
with the tower is the tower's. A departure is refused with its own reason ("a departure that turns back is told to call
Center"). Untowered or no Facility: CTR stays responsible until radar service is terminated, so the flight remains an
OVERFLIGHT and ends with the existing overflight lifecycle.

The origin airport crosses the strip type change as ConvertToArrival does it (`departureAirport` and `originAirport` are the same
fact under two names). An overflight that became an arrival is counted as an arrival (the count reads the strip type at the
drop, ADR 0065); an arrival that became an overflight is counted as an overflight.

### 4. Audit and display

The Mutation line carries `divert: { from, to }` (strip type, state, destination, route, altitude, restrictions, holding, special),
who and when. The Strip keeps an append-only `diverts` list of the same; the Strip shows the destination it replaced struck
through, like the other amendments (§3.7). The mission clock stamps it (`ctx.clock.now()`).

### 5. Guards (the same set as ConvertToArrival, plus control)

Refused with `VALIDATION_ERROR` and a reason that names the way out: a coordination proposal open (INITIATED), a TOFI proposal
open or tactical control active, a HANDOFF the sender still has ACTIVE (the flight is with the receiver), a HANDOFF whose
control has not yet moved (a new altitude or route is a control instruction that needs the other party), a destination that
is blank, or a strip type or state that cannot divert. No new refusal code.

### 6. Undo

Undoable for 10 s like every one-click move (ADR 0100): the scope is the Strip and its flight data; the label is "Divert
CALLSIGN". Restoring puts back the strip type, state, Bay, destination, route, altitude history and the `diverts` list.
Diverting back is a second ordinary divert; both stay in the audit.

## Consequences

- `Divert` is a new op kind: the wire surface fixture and `WIRE_PROTOCOL` are re-recorded (`npm run wire:record`).
- The persisted Strip shape gains `diverts`.
- Real-world practice is not claimed anywhere beyond the three paragraphs above.
- Not built: a Facility for Konya or Akrotiri; moving a divert to a field a tower already holds an ARRIVAL for; a pilot-
  initiated "unable" flow.
