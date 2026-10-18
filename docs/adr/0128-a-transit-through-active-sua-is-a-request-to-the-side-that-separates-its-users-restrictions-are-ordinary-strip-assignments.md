# 0128: A transit through active SUA is a request to the side that separates its users; the restrictions are ordinary Strip assignments

**Status.** Accepted (lane U-MOA-TRANSIT-BUILD, 2026-10-18). **Supersedes ADR 0127** (Proposed, never built): the human's
answers to its questions (decisions.md **H151**, Decision Desk round 12) void most of it, and an ADR is never edited once
committed (P4), so this one replaces it. Rulings: **H151** (MT-Q1…Q8), **H152** (no fix coordinates until AIRAC cycles),
**H148** (the case), **H128** (FAA model, always), dark cockpit **H115–H119**. Research: `docs/research/moa-transit.md`
(JO 7110.65BB Chg 3, JO 7610.14A Chg 2, JO 7400.2R Chg 3, AIM Chg 3; quoted there in full, cited here). Amends ADR 0124 §1
("filed through" is route geometry, the name match is gone) and ADR 0119 §3 (an approved transit is an approved entry).
Neither is edited.

## Why 0127 is superseded

ADR 0127 proposed an altitude release held on the airspace record (users' block plus transit band, gap-checked), two
amber bust alerts on it, "passed" marks on every participant's Strip, a manual "Resume ops", a VFR advisory record, an
`approaching` reason and a name-match fallback. H151 answered:

- **MT-Q1 a**: the side that separates the airspace's users decides. Kept (§2).
- **MT-Q2 b**: the users' restriction lives on each user's Strip (the ordinary assigned altitude, or the existing
  `airspaceEntry.altitudeBlock`). **No release record on the airspace**: 0127 §4 is void.
- **MT-Q3 c**, *"there is no such button"*: no Resume ops; the controller clears or changes the assignment on the Strip
  when the users continue. The transit's restriction is its normal assigned altitude. 0127 §7 is void.
- **MT-Q4**, *"the atc needs freedom here"*: nothing for lateral deconfliction (no sub-area release, no corridor).
- **MT-Q5 b**: VFR, nothing new (ADR 0124 stands). 0127 §8 is void.
- **MT-Q6 c**: route geometry only; drop the name match.
- **MT-Q7 b**: no "passed" step, grey marks only. 0127 §5's amber marks are void.
- **MT-Q8**: all warning and restricted airspaces, not MOA only.

With no release record there is nothing for 0127 §6's bust alerts to measure against; H151 keeps a bust check only "if
conformance does not already cover it" (§4).

## Context (FAA)

- **Permission.** JO 7110.65BB ¶9-3-1 a–b: the SUA rules stop applying when the pilot or the using agency says
  *"permission has been obtained from the using agency"* / *"they have given permission"*; ¶9-3-1 c: or the area *"has
  been released to the controlling agency"*. ¶9-3-4: *"If a LOA/LOP has been coordinated with the Using Agency and
  permission has been granted to transit the area: a. Comply with the instruction/clearances issued by the Using Agency
  [...] b. If unable to comply with instructions/clearances, clear the aircraft in accordance with paragraph 9-3-2,
  Separation Minima."* JO 7400.2R ¶25-1-6 a: *"IFR aircraft may be routed through the airspace, by agreement between
  controlling and using agencies, when approved separation can be provided from the MOA activity."*
- **Decline.** ¶9-3-2: an aircraft not authorized by the using agency is nonparticipating and is kept *"at least 500
  feet (above FL 290-1000 feet) above/below the upper/lower limit"* (a) or *"3 miles"* from the boundary (b).
- **MRU-worked airspace.** JO 7610.14A ¶8-1-9 b.1: separation *"must be accomplished by coordination with the MRU at
  least 5 minutes prior to the ATCAA/SUA boundary penetration to obtain from the MRU a release to ATC of altitude(s)
  and/or flight level(s) throughout the entire ATCAA/SUA."* The lead-in of ¶8-1-9 b names *"Restricted Areas, ATCAAs and
  Warning Areas"*; applying b.1 to a MOA is **our reading** (b.1 itself says "ATCAA/SUA").
- **ATC-worked airspace.** JO 7610.14A ¶3-3-4 a: *"When IFR service is provided by the ATC facility within the area, the
  separation within the area is the responsibility of the ATC facility unless MARSA is established"*.
- **Silent:** how an automation records the request and the answer; who in a squadron with a scheduling-only using
  agency (Incirlik's OPS) answers for an ATC-worked area. Both are **ours** below.

## Decision

### 1. When a transit exists

- An **ACTIVE** AREA of type **MOA, WARNING or RESTRICTED** (H151 MT-Q8, **FAA** ¶9-3-1/¶9-3-4). Our **RANGE** and
  **DANGER** are restricted-like (ADR 0119's reading) and follow RESTRICTED (**ours**). **PROHIBITED** has no transit
  (¶9-3-4 NOTE: no clearance without the appropriate approval; a prohibited area has none to give). A ROUTE and a
  JURISDICTION area have none. `TRANSIT_TYPES` in `authority/airspace.js`.
- Not ACTIVE (SCHEDULED, RELEASED, RETURNED): released to the controlling agency (¶9-3-1 c); every transit op is refused
  and none is listed. **FAA.**
- **IFR only**: the flight has an assigned altitude or heading (`vfr.js` `hasNoClearance` false). A VFR flight gets
  nothing new (H151 MT-Q5 b). The flight must have a live Strip.

### 2. Request, decision, and who decides (H151 MT-Q1 a)

Four ops on the airspace store's existing mutation family (`efsp-airspace-mutation`), audited, mission clock, no undo
(like `ApproveAirspaceEntry`):

- **`RequestTransit { flightDataId, note? }`**: a Position **holding a live Strip of the flight** (it works the flight,
  the ¶9-3-1 NOTE's relay). From the Strip's ⋯ menu ("Request transit <name>", or "Transit…" with a choice), or from the
  card row of a listed flight. One open transit per flight and airspace; after a decline the holder may ask again.
- **`ApproveTransit { flightDataId }`**: the **decider**. With or without a request: the decider may approve a listed flight
  it was told about by phone (H151).
- **`DeclineTransit { flightDataId, reason? }`**: the decider, answering a request or withdrawing an approval (the users
  need the airspace back: **ours**; ¶8-1-9 b.1 NOTE gives ATC the recall of delegated airspace, the reverse direction).
- **`CancelTransit { flightDataId }`**: a holder, while REQUESTED only.

**The decider** is the side that separates the airspace's users (`transitDeciders`, `authority/airspace.js`, with a client
hand copy under a parity test):

- the **using Facility's MRU Positions with the airspace-use row** (TAC_C2) when the using agency is an MRU (Position class
  `MRU`): the MRU separates its participants and releases altitudes to ATC (¶8-1-9 b.1, ¶8-1-10). **FAA.**
- otherwise the **controlling Position** (CTR, AP): ATC works the users and separates them (¶3-3-4 a). **Inference** from
  ¶3-3-4 a and ¶25-1-6. A scheduling using agency (OPS, class BASOPS) and a range-control Position see the transit on the
  card, read-only. **Ours.**

**Self-coordination** (ours, as `_approveActivation` records it): a requester that is itself the decider (CTR holding the
Strip of a MOA it controls) is approved at once, `selfCoordinated: true`; a controller holding both the Strip's owner and
the decider sends the request and then the approval, and the approval is `selfCoordinated` because the same controller
asked.

**Where it lives** (the briefing's recommendation, kept): a per-airspace list on the record, `record.transits[]`, one
entry per flight: `{ flightDataId, callsign, state: REQUESTED|APPROVED|DECLINED, requestedBy, requestedPositionId,
requestedAt, note, decidedBy, decidedPositionId, decidedAt, reason, selfCoordinated }`. It is **not** 0127's release
record: no block, no band, no restriction data. Why the airspace and not the flight data or the Board: the decider is the
airspace's (its controlling Position or using agency), the card it answers on is the airspace's, a flight may want
several airspaces at once, and the airspace record already reaches every session (airspaces are not flights, ADR 0080).
A transit op is not a state transition (`transitions` gains nothing), but it bumps the record's `rev`; the client sends
transit ops with no `baseRev`, so another change to the record never makes one STALE_REV.

**How a transit ends:**

- the airspace leaves ACTIVE (`ReleaseAirspace`): every transit goes, and the RELEASED transition counts them
  (`transitsEnded`); ¶9-3-1 c, **FAA**;
- the flight's last live Strip goes, and a decline has been kept **5 minutes** of mission time (`DECLINED_TRANSIT_SHOWN_MS`,
  **ours**): a system sweep (`AirspaceStore#sweepTransits`, the `airspace-transits` ticker every 5 s, `efsp.sweepTransits`),
  one `EndTransit` audit line per transit (actor `system`, `trigger` NO_LIVE_STRIP or DECLINE_SHOWN), one
  `efsp-airspace-delta` per record changed (an airspace delta moves seq by exactly one);
- the mission reset (ADR 0108): `AirspaceStore#resetForMission`, `trigger` MISSION_RESET, its deltas among the reset's frames.

A snapshot from before this ADR has no `transits` key and restores with none; an unknown key inside a transit stops
start-up like any unknown persisted shape (`stores.js`).

### 3. Restrictions are ordinary Strip assignments (H151 MT-Q2 b, MT-Q3 c, MT-Q4)

- The transit's restriction is its **assigned altitude** (ALT, ADR 0058; a block, ADR 0091). The users' restriction is
  their assigned altitude or block, or **`airspaceEntry.altitudeBlock`** (`ApproveAirspaceEntry`). When the users continue
  the controller clears or changes the assignment: no button, no proposal (*"there is no such button"*).
- An **APPROVED** transit counts as an approved entry for ADR 0119 (`_approved`: ¶9-3-4's "permission has been granted to
  transit the area"): no airspace-entry alert for it. A REQUESTED or DECLINED one that enters alerts as before. A transit
  does **not** change the flight's frequency (unlike `ApproveAirspaceEntry`, which moves the radio).
- The UI that sends `ApproveAirspaceEntry`'s `altitudeBlock` did not exist (0127's finding). It now does: the entry
  popover ("Airspace…") has two optional fields (lower, upper; both empty is the whole airspace), checked against the
  airspace's limits before sending; "Entry block…" on a Strip already in an airspace re-issues the op on the same airspace
  and frequency, which amends (or lifts) the block.

### 4. A bust is conformance's (H151: "only if conformance does not already cover it")

Conformance checked the assigned altitude, a block included (ADR 0091), but not `airspaceEntry.altitudeBlock`. It now does,
in one place (`conformance.js` `altitudeToCheck`): **when the flight has no assigned altitude**, an entry block on a live
Strip is checked like an assigned block; the assigned altitude is the clearance and **wins** (**ours**). An amended block
re-arms the check. No new alert kind, no new tuning key: LEVEL_BUST and WRONG_WAY, with the `block`, as for an assigned
block. A transit's own restriction is its assigned altitude, which conformance already checks.

### 5. "Filed through" by route geometry (H151 MT-Q6 c, H152; amends ADR 0124 §1)

`efsp/airspace/route-geometry.js` (pure, **ours** throughout) replaces `routeNames`: the filed route's tokens (split on
spaces and commas; `DCT` skipped; a `/…` suffix dropped, `ERGEP/D1+00` → `ERGEP`) are looked up in the DCS mission's nav
points (`missionData.waypoints`), then the airports by ICAO (`missionData.airports`), then the named fixes of the theater's
ROUTE airspaces; the filed departure and destination (ICAO first) add the ends. Consecutive resolved points make legs; the
flight is filed through an AREA when a leg touches its lateral shape (`containment.legCrossesPolygon`) and the filed
altitude (else the assigned one) reaches into its limits, or is unknown. **Fewer than two resolved points: not filed
through**, no name fallback (H151 MT-Q6 c); the stereo-route fixes (KEMER, ERGEP, MANAZ, MUT, TARSU, DAN) resolve only if
the mission has nav points of those names, until AIRAC cycles bring fix coordinates (H152). The other `filed` reasons (a
live Strip approved there, `comms.airspaceId`) stay. No `approaching` reason (not asked for: a follow-up).

### 6. What the controllers see (H151 MT-Q7 b, dark cockpit)

- **The transit's Strip**: a grey mark per airspace, `TRANSIT <name> REQ` while asked, `TRANSIT <name>` once approved,
  `TRANSIT <name> DECLINED` while a decline is kept; the title names who asked and who decided (and the reason). Never amber.
- **The airspace card** (ADR 0124's list, sent to the using agency and the controlling Position): a flight with a transit is
  listed whatever its route says; the row shows the transit's state in grey; the decider has **Approve transit** /
  **Decline transit** (the reason typed inline, optional); a holder of one of the flight's Strips has **Request transit** /
  **Cancel request**; a scheduling using agency sees the state with no button. A group of a transit type carries the
  server's `transitDeciders`.

### 7. Wire

New op kinds on the airspace family (scanned): `cd crc-sync && npm run wire:record` recorded them; `WIRE_PROTOCOL` stays 2
(unreleased; the last release speaks 1). The record's `transits` and the traffic rows' `transit` / the group's
`transitDeciders` are record contents, not scanned. No new refusal code (VALIDATION_ERROR, PERMISSION_DENIED, NOT_FOUND).

## Consequences

- An IFR flight that wants through an active MOA, warning or restricted area is asked for and answered on the board, by
  the side that separates the users; the restrictions stay where controllers already write them, on the Strips.
- "Filed through" is real geometry where the mission's nav points, airports or our ROUTE fixes name the fixes, and nothing
  where they do not: a squadron stereo route through a MOA is not listed as filed until the mission names its fixes or
  AIRAC cycles bring a fix table (H152). A flight with a transit request is listed regardless.
- A JTAC-like session that reads only its own flights (ADR 0080, H40) still receives every airspace record, so it sees a
  transit's callsign on the record (airspaces are not filtered). Accepted (ours): a callsign is no position.
- Not covered: an `approaching` projection, the ¶8-1-9 b.1 "5 minutes prior" shown on the row, a VFR advisory record,
  lateral deconfliction. None was asked for.
