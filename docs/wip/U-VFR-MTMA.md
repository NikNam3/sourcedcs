# U-VFR-MTMA: unclassified airspace, VFR service per area, the VFR departure (ADR 0143, H166)

Lane note for the docs pass. Branch `lane/U-VFR-MTMA`. ADR: `docs/adr/0143-airspace-class-is-optional-each-area-has-a-vfr-service-and-cd-makes-a-vfr-departure.md`.

## What was built

1. `airspaceClass` optional on a JURISDICTION area (server schema, client mirror, parity cases). `LTAG-RAPCON` has no
   class; `LTAG-CZ` keeps **Class D** (H166 addendum), its source text now says the class is the human's.
2. `vfrService` (`ALL_SEPARATED` / `IFR_SEPARATED` / `ADVISORY`), required only on an unclassified area; a class implies
   it (B all separated, C IFR separated, D/E/F advisory; none in A or G, which refuse the field). `jurisdictionAt` returns
   `airspaceClass` (null when unclassified) and the effective `vfrService`. RAPCON: `IFR_SEPARATED`. CZ: advisory by class.
3. Block 9K `DIR` (`filed.directionOfFlight`, N…NW) and the Board op `CreateVfrDeparture` (CD by table; no id in the rule):
   flight data + discrete code + DEPARTURE Strip in the CLEARED Bay, no lookup, no clearance steps, Undo. Client: toolbar
   `VFR…` form, `.vfr`, read-out line, DIR on CD/GC/LC/AP faces once set, "Radar service terminated" on a VFR departure AP holds.

## Usage-guide text

### `CD` — Clearance Delivery (add under the Bay table)

**VFR departure.** A VFR pilot calls for traffic advisories with the proposed direction of flight; there is no flight
plan to look up (a VFR flight plan is a search-and-rescue record with Flight Service, H166). Press **VFR…** in the
toolbar (shown only at CD), type the callsign, the type (`F16`, `2/F16`), pick **DIR** (N…NW) and, if the pilot asked
for one, the runway (empty = the active runway), then **Create VFR** (or Enter). Keyboard: `.vfr VIPER11 F16 NW [23]`.
In one step the flight gets flight data, a **discrete code** and a DEPARTURE Strip in `cd-cleared`; the form shows the
line to read: "VIPER11, squawk 4321, maintain VFR" (add the departure frequency, JO 7110.65BB ¶7-6-10: "VIPER11, squawk
4321, departure frequency 251.0, maintain VFR"). It skips Pending Clearance: there is no clearance to review, no altitude
or destination needed, no release or void time. From here it is an ordinary departure: **Approve Pushback** to GC, taxi,
LC's runway queue, departed, Hand Off to AP. A refusal (bad callsign, type or direction, a runway this airfield does not
have, no free code) shows in the form in red and spends no code. **Undo** within 10 s removes the Strip and frees the code.

Why a code before takeoff: two minutes after it leaves the Class D control zone it is in the Adana MTMA, where Approach
separates IFR traffic from it.

### §8C2 Flight following (add a paragraph)

**A VFR departure** (CD's `VFR…`, above) reaches AP as an ordinary handed-off DEPARTURE with no clearance. AP keeps
flight following on it, or, when it leaves the MTMA or the pilot cancels, `⋯` → **Radar service terminated** (or `.term`):
now offered on an overflight **or a departure** with no clearance that your AP or CTR owns. The DIR cell shows where it
is heading. Update the `.term` sentence: "offered on an overflight Strip or a VFR departure with no clearance…".

### Jurisdiction areas (replace the class sentences)

Each card shows its class (if it has one), its limits, **its VFR service** and its shape. Türkiye does not classify its
airspace: the **Incirlik RAPCON is the Adana MTMA** and has no class; its VFR service is **IFR separated from VFR, VFR to
VFR traffic advisories** (H166). The **LTAG CTR (control zone)** is **Class D**, so VFR gets traffic advisories, no
separation from IFR in the air (the line reads "(Class D)"). The carrier area and everything outside the areas
(CENTER's) are Class E (ours). Edit… now has **CLASS** (with "none (unclassified)") and **VFR SERVICE** ("by the class:
…", or one of the three); an unclassified area must name its service, and Class A or G has none. Last sentence: "The
limits of the control zone and the RAPCON are AIP Türkiye's; the control zone's Class D is the human's (H166); the
classes E and the carrier area are ours."

### Strip fields table (§ on the face)

`DIR` (Block 9K): a VFR departure's direction of flight, on CD's, GC's, LC's and AP's departure face once set.

## Defaults taken

- **D1 class implies service** (supervisor's question): yes; the field is required only when unclassified and is an
  override otherwise. The shipped CZ carries no field.
- **D2 three values**, `ALL_SEPARATED` added beside the briefing's two so Class B's default exists.
- **D3 starting state CLEARED** in the acting Position's Bay implying CLEARED (`cd-cleared`); release stays RELEASED.
- **D4 runway**: typed end validated against this airfield's runway inventory; empty takes the active end at creation
  (stored in Block 8A, so a later runway change shows the existing "queued for inactive runway" advisory).
- **D5 departure airport** = the Facility's airfield (`fieldAirport`, `LTAG`); destination, route, altitude left empty.
- **D6 Block number 9K**, last in the server DEPARTURE map (freeze corpus gains a step at the end of the DEPARTURE walk).
- **D7 DIR only when set** on the face (dark cockpit: IFR departures never show an empty DIR).
- **D8 the read-out line** has no departure frequency (the client would have to name AP by id to find it); the guide's
  phraseology adds it.
- **D9 permission**: a `VFR_DEPARTURE_OP_KINDS` grant on CD's row (like PATTERN_OP_KINDS on LC), plus the op's own
  role-shaped gates; OPS (which also creates DEPARTUREs) is refused since it does not own CLEARED.
- **D10 Terminate at AP** offered on any DEPARTURE with no clearance owned by AP/CTR (server already allowed it).

## Answers the briefing asked for

- **Behaviour that read the class**: only "Class G is nobody's" in `jurisdictionAt` (kept). Nothing else; confirmed.
- **The CENTER fallback's `E`**: still the "class" `jurisdictionAt` reports for CENTER, and it now yields `ADVISORY`. As a
  class it is as invented as RAPCON's C was (Ankara's real airspace is not classified either); what matters is the
  service. Suggest the human decides: keep `E` (advisory by class) or make the fallback unclassified + `ADVISORY` (one
  constant in `airspace/jurisdiction.js`). Same question for `CVN-72-CCA`'s `E`.
- **Conflict Alert today**: alerts every pair of tracked (CORRELATED) aircraft, IFR or VFR, in every area, same
  thresholds; MCI for tracked vs untracked with Mode C. So a tracked VFR vs IFR pair alerts (right in an
  `IFR_SEPARATED` area) and a tracked VFR vs VFR pair alerts too (traffic-advisory territory there). The FAA's CA is
  not regime-aware either (P/CG CONFLICT ALERT: "between tracked targets (known IFR or VFR aircraft)"), and a safety
  alert is owed to any aircraft (¶2-1-6). Question for the human below; nothing built.

## Walks done

- Unit walk (`efsp-vfr-departure.test.mjs`): CD create → NLA PUSHBACK (GC) → TAXI → RUNWAY_QUEUE (LC, rack rwy-23) →
  LUAW → DEPARTED (takeoff stamped) → HANDED_OFF (AP) → TerminateRadarService (dropped, code released). Undo of the create.
- e2e `vfr-departure.spec.js` (lane 6): toolbar form, read-out text, DIR chip in cd-cleared, refusal shown; `.vfr` + `.undo`;
  button hidden at GC. `jurisdiction.spec.js` and `smoke.spec.js` pass.
- **Not walked**: a pilot cancelling flight following before AP (at LC: no Terminate there; LC hands off as usual);
  a VFR departure that switches to IFR on the ground (CD types ALT: it becomes an IFR-looking departure in CLEARED with
  no filed plan, refused nothing); a VFR departure CD wants to hold (HELD path works as for any CLEARED Strip); the
  live DCS picture (the code is acquired by the beacon rung as any discrete code, H135/ADR 0142).

## Findings for other lanes / human actions

- **Human action (deploy):** the deployed Board's airspace registry keeps `LTAG-RAPCON` at Class C (standing entries
  are imported once). It still behaves right (C gives IFR_SEPARATED), but its card says Class C: AP edits it once
  (CLASS none, VFR SERVICE IFR separated), or reset the Board. LTAG-CZ needs nothing.
- **Rule 9:** the client offers the action through an id mirror `VFR_DEPARTURE_POSITIONS = ['CD']` (authority-mirror.js,
  held to the server by a test), the same pattern as `FLIGHT_FOLLOWING_POSITIONS`; and the server grant sits in CD's
  permission row, as every row does. Both become roles with U-ROLE-POSITIONS. The op itself names no id.
- `CreateVfrDeparture` is not in the freeze hub op matrix (unit and e2e tests only), like ControlRelease.
- The wire: one new Board op kind recorded; protocol stays 2. The new flight-data key is unscanned record content.

## Questions for the human

- **VQ-A** Should `IFR_SEPARATED` / `ADVISORY` change Conflict Alert (e.g. no CA between two tracked VFR aircraft in
  an `IFR_SEPARATED` or `ADVISORY` area, leaving traffic advisories to the controller)? Default kept: no change (FAA CA
  is not regime-aware).
- **VQ-B** CENTER fallback and the carrier area: keep "Class E" or make them unclassified with `ADVISORY`?
- **VQ-C** Should the read-out include the departure frequency automatically (needs the hand-off receiver from
  topology, not an id)?
