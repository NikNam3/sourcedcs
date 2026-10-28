# 0127: A transit through an active MOA is an altitude release held on the airspace: requested by the transit's holder, accepted or declined by the side that separates the MOA's users, alerted when either side leaves its altitudes, ended by Resume ops

**Status.** **Proposed** (lane U-MOA-TRANSIT phase 1, 2026-10-16; no code). The human answers the questions in
`docs/wip/U-MOA-TRANSIT.md` (Decision Desk) first; the build is a second dispatch and records the answers here as an
amendment note before building. Rulings: decisions.md **H148** (the case), **H128** (FAA model, always), **H140** /
ADR 0124 (the card's flight list), ADR 0119 (entry alert; the using agency approves entry), ADR 0125 (jurisdiction areas),
ADR 0102 (MRU separation regime), ADR 0118 (CA, MARSA), dark cockpit (H115–H119). Research:
`docs/research/moa-transit.md` (R1–R7; editions there: JO 7110.65BB Chg 3 7/9/26, JO 7610.14A Chg 2 7/9/26, JO 7400.2R
Chg 3, AIM Chg 3). Mockup: `docs/mockups/moa-transit.html`.

**Would amend** ADR 0124 §1 ("filed through" becomes route geometry, the name match its fallback) and ADR 0119 §3 (an
accepted transit counts as an approved entry for the transiting flight). Neither is edited (P4).

## Context

H148: a MOA not in use, transit is trivial; a MOA in use, ATC either **declines** the transit or **accepts and guarantees
separation**, usually by altitude: the MOA aircraft get a block ("maintain block FL200–FL240"), the transit a restriction
("remain at or below FL190"), and after it has passed the MOA aircraft are cleared to **resume operations**; plus an alert
when either side busts its restriction, and route geometry for the card's "filed through" (U-MOA matched names).

What the orders say (quoted in full in the research note):

- **Permission.** The SUA rules stop applying when the using agency has given permission (JO 7110.65BB ¶9-3-1 a–b) or the
  area *"has been released to the controlling agency"* (¶9-3-1 c). ¶9-3-4: *"If a LOA/LOP has been coordinated with the
  Using Agency and permission has been granted to transit the area: a. Comply with the instruction/clearances issued by the
  Using Agency [...] b. If unable to comply with instructions/clearances, clear the aircraft in accordance with paragraph
  9-3-2, Separation Minima."* JO 7400.2R ¶25-1-6 a: *"IFR aircraft may be routed through the airspace, by agreement between
  controlling and using agencies, when approved separation can be provided from the MOA activity."* AIM 3-4-5 a: *"[...]
  nonparticipating IFR traffic may be cleared through a MOA if IFR separation can be provided by ATC. Otherwise, ATC will
  reroute or restrict nonparticipating IFR traffic."*
- **Decline.** ¶9-3-2: an aircraft not authorized by the using agency is nonparticipating and is kept *"at least 500 feet
  (above FL 290-1000 feet) above/below the upper/lower limit"* (a) or *"3 miles"* from the boundary (b).
- **Accept, MRU-worked MOA.** JO 7610.14A ¶8-1-9 b.1: *"[...] Such separation must be accomplished by coordination with the
  MRU at least 5 minutes prior to the ATCAA/SUA boundary penetration to obtain from the MRU a release to ATC of altitude(s)
  and/or flight level(s) throughout the entire ATCAA/SUA. ATCAA/SUA sub-areas may be used in separation if depicted on all
  involved units radars."* ¶8-1-10 e: the MRU confirms *"the assigned altitude block"* with its participants; ¶8-1-11 c: it
  keeps them within *"the limits of altitudes [...] released to the unit"*; ¶8-1-11 d: a spill-out is called as a
  *"Whiskey Alert"*. (¶8-1-9 b's lead-in names restricted areas, ATCAAs and warning areas; b.1 says "ATCAA/SUA", and a MOA is
  SUA: applying it to a MOA is **our reading**.)
- **Accept, ATC-worked MOA.** JO 7610.14A ¶3-3-4 a: *"When IFR service is provided by the ATC facility within the area,
  the separation within the area is the responsibility of the ATC facility unless MARSA is established"*. Then the transit
  is ordinary IFR separation by ATC: ¶4-5-1 a *"Up to and including FL 410- 1,000 feet"*, c *"Above FL 410- 2,000 feet"*;
  ¶4-5-7 g *"MAINTAIN BLOCK (altitude) THROUGH (altitude)."*
- **VFR.** JO 7610.14A ¶8-1-9 a: ATC alerts the VFR pilot; *"If the pilot indicates that the aircraft will penetrate the
  areas, ATC must advise the MRU of the VFR penetration and transfer flight information [...] 3. It is the pilot's
  responsibility for separation from non-participating aircraft."* JO 7400.2R ¶25-1-6 a: *"VFR aircraft are not denied
  access"*.
- **Silent:** "resume operations" (the order has only the reverse: the MRU returning airspace to ATC, ¶8-1-11 k–l, and ATC
  recalling delegated airspace, NOTE to ¶8-1-9 b.1); the wording "remain at or below"; any automated alert for a block
  bust; how the controlling Position and an Incirlik OPS desk that only schedules split the decision. Those are **ours**.

What exists: `AirspaceEntryAlertMonitor` (`crc-sync/src/efsp/airspace-entry-alert.js`) lists, per entry-type airspace,
the tracked flights inside and the live flights "filed through" (`routeNames`: the route text names the airspace), for a
session holding the using agency or the controlling Position (`trafficFor`); the card shows them with Approve
(`airspace-entry-list.js`). `ApproveAirspaceEntry` already carries an optional per-Strip `altitudeBlock` (its comment: "the
way a working flight is pushed out of the way while somebody transits"). Conformance checks an assigned block
(`conformance.js`, ADR 0091). The airspace store owns activation state and its ops (`airspace-store.js`), audited, on the
`efsp-airspace-*` wire family.

## Decision (proposed)

### 1. When a transit exists at all

- **Only for an `ACTIVE` MOA.** RETURNED, SCHEDULED and RELEASED are "released to the controlling agency" (¶9-3-1 c):
  nothing is offered, nothing alerts. **FAA.**
- **Only for an IFR flight** (one that has a clearance; `vfr.js` `hasNoClearance` false). A VFR flight is §6.
- **Scope: MOA only** (H148). WARNING and the restricted-like types keep ADR 0119's Approve; a WARNING transit can follow
  the same model later (**ours**, default logged).

### 2. Who asks, who decides (question MT-Q1)

- **Request:** a Position **holding a live Strip of the transiting flight** (AP, CTR, …), from that Strip's ⋯ menu
  ("Request transit <MOA>…", offered when the route crosses the MOA or the flight is near it) or from the card row
  (§7 lists it as `filed` or `approaching`). ¶8-1-9 b.1's "at least 5 minutes prior to [...] boundary penetration" is
  shown as text on the row, never enforced (**FAA** number, **ours** to show it).
- **Decider = the side that separates the MOA's users** (recommended, MT-Q1 a):
  - the MOA's **using agency** when that is an **MRU Facility** (`usingFacilityId` TACTICAL; its `airspaceUse` Position,
    TAC_C2): the MRU separates its participants (¶8-1-10 c) and releases altitudes to ATC (¶8-1-9 b.1). **FAA.**
  - otherwise the MOA's **controlling Position** (CTR, or AP inside RAPCON): ATC works the MOA's users itself and separates
    them (¶3-3-4 a); the LOA (¶25-1-6 b) is taken to authorize ATC to route IFR through when it can separate. **Inference**
    from ¶3-3-4 a and ¶25-1-6; Incirlik OPS (a scheduling using agency) **sees** the request and the transit, read-only.
  - a MOA with no using agency: its controlling Position (ADR 0102 I1: it acts for both sides).
- **Self-coordination:** when the requester also holds the deciding Position, "Request transit…" opens the accept dialog
  directly and the record notes `selfCoordinated`, as activation does (`_approveActivation`).
- The decider may also **accept without a request** (the transit's controller phoned): `AcceptTransit` naming the flight.

### 3. Decline

`DeclineTransit` (optional reason). The row on the transit's Strip shows "transit <MOA> declined" (grey). Nothing else
changes: the flight is a nonparticipant and ATC keeps it 500 ft / 3 NM clear (¶9-3-2); if it enters, ADR 0119's entry
alert fires as today. **FAA** (the decline), **ours** (the record).

### 4. Accept: one altitude release, held on the airspace (question MT-Q2)

`AcceptTransit { transitId | flightDataId, usersBlock: { lowerFt, upperFt } | null, transitBand: { lowerFt|null, upperFt|null } }`.

- **Where it lives (recommended, MT-Q2 a): on the airspace record**, `record.transits[]`, not on each MOA flight's
  Strip. Argued:
  - ¶8-1-9 b.1 releases altitudes *"throughout the entire ATCAA/SUA"*: one fact about the airspace, not one per aircraft;
  - it binds **every participant**, including one that enters after the accept and MRU-worked flights whose ATC Strip has
    no `airspaceEntry` (they are approved by their TOFI regime, ADR 0102);
  - one Resume lifts it; per-Strip blocks would need N edits by N holders and could half-lift;
  - the using agency and the controlling Position work it on the **card**, which is the airspace's.
  The existing per-Strip `airspaceEntry.altitudeBlock` stays what it is (users sharing the MOA among themselves); a
  participant's effective limits are the **intersection** of its own block and the transit's `usersBlock`. The Strips
  show a **derived** mark (§5), never a stored copy.
- **`usersBlock`**: the MOA users' block, inside the MOA's limits. **`null` = release the whole area**: the users vacate
  it. With MOA subdivisions defined as separate airspaces (JO 7400.2R ¶25-1-3; ¶8-1-9 b.1 "sub-areas may be used"), that
  is lateral deconfliction (question MT-Q4).
- **`transitBand`**: the transit's restriction, open at one end ("at or below FL190" = `{ lowerFt: null, upperFt: 19000 }`).
- **Checked** (VALIDATION_ERROR, no new refusal code): both inside sensible limits; the band lies wholly above or wholly
  below the block; the gap between them is at least **1,000 ft**, **2,000 ft** when either edge is above FL410 (¶4-5-1 a,
  c; **FAA**). ¶4-5-1 b (non-RVSM 2,000 ft at FL290+) needs equipment data we do not hold: not checked (**ours**, logged).
- **The dialog proposes** (ours): a band on the side of the MOA the transit's assigned (else filed) altitude is on, its
  edge at that altitude, and the users' block from the edge plus the gap to the MOA's far limit; it lists the
  participants with their current altitude and marks any outside the proposed block (grey text, no refusal).
- The transiting flight is from then on **authorized through** the MOA: ADR 0119's entry alert treats an ACCEPTED transit
  as an approved entry (`_approved`), and it is not a participant (¶9-3-2 NOTE). The transit's assigned altitude stays the
  ordinary ALT on its Strip; the band is a separate restriction checked only inside the MOA (§6).

### 5. What each Strip shows

- **The transit's Strip**: a grey mark `TRANSIT <MOA> ≤FL190` (or `≥FL250`, or `FL…–FL…`) while ACCEPTED; `REQ` while
  requested; `declined` for a short time after a decline (**ours**).
- **Each participant's live Strips** (ATC Strip and an MRU's MISSION Strip): `BLK 200–240 · <transit callsign>`, **amber
  until passed**, grey after. "Passed" is a click on the mark by a holder of a live Strip of that flight (it told the
  pilot); op `PassTransitChange { transitId, flightDataId }` (**ours**, the marshal's "unpassed clearance change" pattern,
  H116). After Resume the mark becomes `RESUME <MOA>`, amber until passed the same way, then disappears.
- **The transit's holder** sees on its transit row `users told 2/3` (grey) before it clears the flight in: that is
  ¶8-1-9 b.1's release, made visible (**ours**).

### 6. Alerting when either side leaves its altitudes (ours)

A new slice `airspaceTransit` on `efsp-alerts`, computed on the airspace-entry monitor's tick:

| Kind | Fires when | FAA counterpart |
|---|---|---|
| `TRANSIT_USERS_BLOCK` | an ACCEPTED transit exists, a **participant** is laterally inside the MOA and outside the users' block by more than `levelBustFt`, for `levelBustPersistSec`, **and** either it has been inside the block since the accept or the transit is laterally inside the MOA | Whiskey Alert (¶8-1-11 d), a voice call |
| `TRANSIT_BAND` | the **transit** is laterally inside the MOA and outside its band by more than `levelBustFt` for `levelBustPersistSec` | none in the SUA paragraphs |

- **Participant** = a tracked flight approved into the MOA (ADR 0119's `_approved`: Strip entry, working airspace, or MRU
  TOFI), not the transit and not one of its formation. The thresholds are conformance's (`alerting.json`), not new.
- **Delivered** to the controlling Position, the using agency, and every Position holding a live Strip of the flight that
  busts **or** of the other side (the transit's holder for a user bust; the users' holders for a band bust).
- **Display (dark cockpit)**: amber (`caution`), data block line 0 `BLK`, blinking until a click on the target
  acknowledges it, like `SAA`; Strip chip "Transit block: VIPER12 FL248, block FL200–240 (BLADE31)" /
  "Transit band: BLADE31 FL205, at or below FL190 (MOA)"; a track-panel line. Retracts when back inside.
- **Interactions.** Conflict Alert (ADR 0118) is unchanged and stays the **red** safety net between the transit and a
  participant (they are never MARSA with each other). A participant's own LEVEL_BUST (conformance) can fire beside it; the
  `BLK` alert names the transit, which is what matters to both controllers. ADR 0119's `SAA` never fires for an ACCEPTED
  transit's flight; a REQUESTED or DECLINED one that enters alerts `SAA` as today.

### 7. Resume operations (question MT-Q3)

`ResumeOperations { transitId }` by the decider (§2): the users' block is lifted, the record closes (appended to
`transitions`), the participants' marks turn to `RESUME`, amber until passed (§5).

- **Proposed, never automatic** (recommended, MT-Q3 a): once the transit has been laterally inside and is now outside the
  MOA by at least **3 NM** (the ¶9-3-2 b figure, borrowed: **ours**), or every live Strip of it is gone, the row reads
  `clear of <MOA>`; the Resume button is there throughout. Lifting the restriction is a radio call to every user; the
  board must not claim it before a controller made it (same reason ADR 0102 refuses an automatic regime revert).
- The requester may `CancelTransit` while REQUESTED. An ACCEPTED transit that will not happen is ended by Resume.
- The MOA leaving ACTIVE (released, returned) ends every open transit (closed by the system, audited). The mission reset
  (ADR 0108) ends them too (build item).

### 8. A VFR flight (question MT-Q5)

No request and no separation (¶8-1-9 a 3, ¶25-1-6 a). Recommended (MT-Q5 a): the holder of a VFR (flight-following)
Strip has **"Advise <MOA>"** in its ⋯ menu when the flight is in or approaching the active MOA; it records
`vfrAdvisories[]` on the airspace (who, when) and the card row reads `VFR · advised` for the decider and the participants'
holders, who pass it to the users (¶8-1-9 a 1–2). Never amber; ADR 0119 already never alerts a VFR flight in a MOA.

### 9. "Filed through" from route geometry (amends ADR 0124 §1; question MT-Q6)

A pure resolver, `efsp/airspace/route-geometry.js` (ours throughout):

- **Points from the filed route** (`flightData.filed.route`, which a stereo route has already expanded): split on spaces;
  skip `DCT` and anything that resolves to nothing; drop a `/…` suffix (`ERGEP/D1+00` → `ERGEP`). Each token is looked up,
  in order, in **the DCS mission's nav points** (`missionData.waypoints`, name, both coalitions; already fetched by
  `grpc-client.js`), **airports by ICAO** (`missionData.airports`), and **the named fixes of the theater's ROUTE airspaces**
  (`segments[].fix`). `filed.departureAirport` / `destinationAirport` add the ends.
- **Crossing**: two or more consecutive resolved points make a polyline; it is "filed through" when a leg crosses the
  MOA's lateral shape and the filed altitude (`filed.requestedAltitude`, else the assigned ALT) is inside its limits or
  unknown.
- **No geometry** (fewer than two points): the name match of ADR 0124 stays as the fallback, and the row says
  `filed (name)` so the controller knows the difference (recommended MT-Q6 a).
- **Approaching** (new reason): the track's 5-minute straight-line projection (ground speed, course) enters the MOA:
  ¶8-1-9 b.1's 5 minutes, and the EDST trajectory-probe idea of ADR 0119 (¶13-1-1) at its simplest.
- **What does not exist today**: ATO route sets (the parser skips `6ROUTE`), and each DCS group's own mission-editor route
  (not fetched; it would need a new `CustomService.Eval` query per group): option MT-Q6 b.

### 10. Wire and stores (for sizing)

- **Airspace store** (`airspace-store.js`): `record.transits[]`
  `{ transitId, flightDataId, callsign, state: 'REQUESTED'|'ACCEPTED', requestedBy, requestedPositionId, requestedAt, note,
  decidedBy, decidedPositionId, decidedAt, selfCoordinated, usersBlock, transitBand, passed: { [flightDataId]: change } }`,
  closed ones appended to `transitions`; `record.vfrAdvisories[]` (§8). New state ops on the existing
  `efsp-airspace-mutation` family: `RequestTransit`, `AcceptTransit`, `DeclineTransit`, `CancelTransit`,
  `ResumeOperations`, `PassTransitChange`, `AdviseVfrPenetration`. Rights need two facts the store does not have:
  injected `liveStripHoldersOf(flightDataId)` and `isVfr(flightDataId)`. The persisted shape (`stores.js` `airspaces`
  `anyOf`) gains `transits` and `vfrAdvisories` (an old snapshot without them still restores: `anyOf` keys are optional).
  Undo: none (like `ApproveAirspaceEntry`). All times from the mission clock (ADR 0096).
- **Monitor**: `AirspaceEntryAlertMonitor` gains the transit's approval (§4), the route resolver (§9) with
  `missionData` injected, the `approaching` reason, and the two transit alerts (or a sibling `transit-monitor.js` on the
  same tick: the build decides); `airspaceTraffic` rows gain `transit` (`{ transitId, state, role: 'TRANSIT'|'USER',
  inBlock, passed, clear }`) and `vfrAdvised`.
- **`efsp-alerts`** gains the top-level key `airspaceTransit` (scanned): `cd crc-sync && npm run wire:record`; the new op
  kinds are scanned too. Whether `WIRE_PROTOCOL` bumps depends on the last released `crc-desktop-v*` tag at build time.
- **Refusal codes**: none new (VALIDATION_ERROR, PERMISSION_DENIED, NOT_FOUND, STALE_REV).
- **Client**: `airspace-entry-list.js` (Request / Accept… / Decline / Resume ops / Advise rows), a new transit dialog
  module, the Strip marks (`strip-alerts.js` and the Strip's mark row), `atc-scope.js` and `geojson.js` (`BLK`), the
  track panel; the authority mirror and refusal wording as usual. No `window.*`, no cycle (module-graph test).

## Consequences

- The using agency or the controlling Position sees, on the card, every IFR flight that wants through and answers it there;
  the restriction lives in one place and every Strip of every affected flight shows it.
- Two new alerts, both amber, both ours; CA stays the red net.
- "Filed through" gets real geometry wherever the mission's nav points or our ROUTE fixes name the route's fixes; the
  squadron's stereo routes (KEMER, ERGEP, MANAZ, MUT, TARSU, DAN) resolve only if the mission has nav points of those
  names (none ship in config). The name match remains for the rest.
- An OPS desk that only schedules gains nothing to press for an ATC-worked MOA (it sees the transits); if the human wants
  OPS to grant every transit, MT-Q1 b changes one rule.
- A WARNING-area transit and a non-RVSM gap are not covered.
