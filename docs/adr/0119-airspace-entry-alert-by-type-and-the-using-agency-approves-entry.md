# 0119: An aircraft inside an active airspace it may not be in raises an airspace-entry alert, by airspace type; the using agency approves entry and only the controlling Position defines an airspace

**Status.** Built (lane LT-AIRSPACE-ALERT, 2026-10-13), for live-test findings T27 (rights) and T29
(`docs/parallel/live-test-2026-10-11.md`). Rulings: decisions.md **H132**, **H134** (LT-Q5 a, LT-RQ13 a, LT-RQ14 a),
**H136** (VQ4 b, VQ5 a, VQ8 a), **S-ARCH-51** (OPS's rows), **S-ARCH-56** (VFR = no clearance), **S-ARCH-57** (tracked,
per-session delivery). Research: `docs/parallel/research/live-test-faa.md` **Q8**, **Q9**;
`docs/parallel/research/vfr-flight-following.md` **V3** and "Proposed model" (b). **Amends** ADR 0098 §11 (OPS's
airspace row; the using agency approves entry) and ADR 0038/D14 (the airspace `type` is read for one behaviour).

Editions (research, "Sources and editions"): JO 7110.65BB Basic with Chg 1 to Chg 3 (7-9-26); JO 7400.2R; JO 7400.10H;
14 CFR Part 73 and 91 as reprinted there; P/CG with Chg 1 to Chg 3 (7-9-26).

## Context

T27: the human, signed on to OPS and CTR, could not create a CENTER MOA as OPS; LT-AIRSPACE-FIX fixed the client half
and left the research question: should the SUA **using agency** (Incirlik OPS) define a MOA another Facility controls?
T29 / H132: an alert when an aircraft enters an active airspace without approval, "no matter if it relates IRL or not",
following the FAA if an equivalent exists (H128).

What the orders say (quoted from the research):

- JO 7400.2R ¶21-1-10, CONTROLLING AGENCY: *"The controlling agency is the FAA ATC facility that exercises control of the
  airspace when a SUA area is not activated."* ¶21-1-11 a, USING AGENCY: *"... 2. Scheduling procedures are established,
  utilized, and captured in an LOA/LOP. 3. The controlling agency is kept informed of changes in scheduled activity ..."*
  ¶21-1-5: *"FAA Headquarters is the final approval authority for all permanent and temporary SUA ..."* ¶21-1-8 a:
  *"SUA must be returned to the controlling agency ... when the airspace is not needed by the using agency"*.
- 14 CFR 73.13: *"No person may operate an aircraft within a restricted area between the designated altitudes and during
  the time of designation, unless he has the advance permission of (a) The using agency described in § 73.15; or (b) The
  controlling agency described in § 73.17."* 73.15 (c): *"The using agency shall— (1) Schedule activities within the
  restricted area; (2) Authorize transit through, or flight within, the restricted area as feasible ..."* 91.133 (a):
  *"... or within a prohibited area, unless that person has the permission of the using or controlling agency"*.
- JO 7110.65BB ¶9-3-1: the SUA rules do not apply when *"a. The pilot informs you that permission has been obtained from
  the using agency to operate in the airspace. b. The using agency informs you they have given permission for the
  aircraft to operate in the airspace. NOTE- Using agency permission may be relayed to the pilot."* ¶9-3-2 NOTE:
  *"Nonparticipating aircraft refers to those aircraft for which you have separation responsibility and which have not
  been authorized by the using agency to operate in/through the special use airspace ..."*
- JO 7400.2R ¶25-1-6 a (MOA): *"In effect, MOAs are always joint use in that VFR aircraft are not denied access, and IFR
  aircraft may be routed through the airspace, by agreement between controlling and using agencies, when approved
  separation can be provided from the MOA activity."* ¶24-1-3 d (warning areas): *"Nonparticipating VFR pilots, while not
  excluded from warning areas, are on notice that military activity ... is conducted in those areas."*
- P/CG: *"AIRSPACE CONFLICT- Predicted conflict of an aircraft and active Special Activity Airspace (SAA)."* *"AIRCRAFT
  CONFLICT- ... A Blue alert is used for conflicts between an aircraft and predefined airspace."* JO 7110.65BB ¶13-1-1:
  *"EDST uses current plan data, forecast winds, aircraft performance characteristics, and track data to derive expected
  aircraft trajectories, and to predict conflicts between aircraft and between aircraft and special use or designated
  airspace."* ¶13-1-2: *"a. Actively scan EDST information for predicted aircraft-to-aircraft and aircraft-to-airspace
  alerts. b. When a conflict probe alert is displayed, evaluate the alert and take appropriate action as early as
  practical ..."* ¶13-1-9 (acknowledgement of automated notification). STARS (¶5-14): **no** aircraft-to-SUA alert.

## Decision

### 1. Only the controlling Position defines an airspace; the using agency uses it (H134 LT-RQ13 a)

Definition (create, edit shape and limits, delete) stands in for the FAA's approval (¶21-1-5) and stays with the
**controlling Position** (`'OWN'`). OPS's `airspace` row goes from create/edit/delete `'FACILITY'` to `null` and
`use: true`, on both sides (`authority/positions/civil-atc.js`, client hand copy `AIRSPACE_ROWS.OPS`, the parity test):
OPS is Incirlik's **using agency** (¶21-1-11; 73.15 (c)): it schedules, requests activation and releases an airspace
whose `usingFacilityId` is INCIRLIK. The `'FACILITY'` scope stays in the rows' vocabulary; no row uses it. Who approves
and confirms activation (the controlling Position) is unchanged.

### 2. Who approves entry (H136 VQ5 a)

`ApproveAirspaceEntry` and `ClearAirspaceEntry` are sent by **the Position working the Strip** (it holds the op kind, AP
and CTR: it relays the using agency's permission, ¶9-3-1 NOTE) **or the airspace's using agency itself** (73.15 (c)(2),
¶9-3-1 b; `authority/airspace.js` `isUsing`), which holds no op grant and acts on a live Strip of its own Facility it does
not hold (`facility-rules.js` `mayActBesideOwner`, beside `permission.js`'s table). Approve checks the named airspace in
the op's `authorize`; Clear checks the Strip's current airspace in `apply`. New Board rule `isAirspaceUsingAgency`
(60 required rules); `AirspaceStore#isUsingAgency`. A flight-following Strip (H136 VQ1) is approved the same way. The
client offers "Airspace…" (only the airspaces that Position uses) and "Leave airspace" to a controller holding the using
agency and not the Strip (`_usingAgencyEntryChoices`).

### 3. The airspace-entry alert (H132; H134 LT-Q5 a, LT-RQ14 a; H136 VQ4 b)

`efsp/airspace-entry-alert.js` `AirspaceEntryAlertMonitor`, ticked once a second after Conflict Alert. The FAA
equivalent is EDST's aircraft-to-airspace alert (¶13-1-1, ¶13-1-2, P/CG AIRSPACE CONFLICT). **Ours differs**: it fires
on **actual containment** (the aircraft is inside now), not on a predicted trajectory; it is not limited to en route
(STARS has none); like EDST it is for **ACTIVE** airspace only (`AirspaceStore#activeAreasContaining`, indicated feet,
unknown geometry never alerts). Named "Airspace conflict <name>" (P/CG term).

**By airspace type, as the FAA. This makes the airspace `type` behavioural for the first time** (it was "never read for
behaviour", ADR 0038/D14; it still picks no separation regime):

| Type | Tracked aircraft without an approved entry | Tracked VFR | Untracked contact |
|---|---|---|---|
| RESTRICTED, PROHIBITED | alerts (73.13, 91.133, ¶9-3-1) | alerts (73.13 applies to VFR) | alerts |
| RANGE, DANGER | alerts (**inference**: restricted-like, research V3 (b)) | alerts | alerts |
| MOA, WARNING | alerts (**ours**: an IFR aircraft goes through by LOA, ¶25-1-6 a-b, else it is a nonparticipant, ¶9-3-2) | **never** (¶25-1-6 a, ¶24-1-3 d) | alerts |
| ROUTE (IR, VR, SR, LLTR) | never (**ours**: an MTR is no area an aircraft is denied) | never | never |

- **Tracked** = correlated CORRELATED or PROVISIONAL (S-ARCH-57), and an uncorrelated **formation wingman** of a tracked
  flight is that flight (ADR 0118's members, read from the CA monitor): one alert per flight and airspace, named by the
  lead's track.
- **VFR** = the flight data has no ACTIVE assigned altitude and no ACTIVE assigned heading (H136 VQ2, S-ARCH-56): the
  client's `_noClearance` test is now `vfr.js` `hasNoClearance` on both sides, with a parity test.
- **Untracked**: alerts inside any ACTIVE area (H134 LT-Q5 a; the supervisor's reading of H136), **only when it reports
  altitude** (decided here with H136 VQ8 a's MCI rule in mind: an airspace has vertical limits a primary-only target
  cannot be placed against by the controller; **ours**). It is answered by "Start flight following" then an approval
  (research "Proposed model" (b)); there is no FAA act approving a bare contact.
- **Approved** (¶9-3-1 a-b): a live Strip of the flight working that airspace (`airspaceEntry`), the flight data's
  `comms.airspaceId`, or an MRU TOFI (accepted or effective, ADR 0102) for a Facility the airspace is ACTIVE for
  (**ours**: the MRU, the using agency, has taken the flight).
- Not alerted (**ours**, `alerting.json` `airspaceEntry`): a track slower than 50 kt (on the ground, hovering) or younger
  than 10 s, as CA.

**Delivery**: in `efsp-alerts.airspaceEntry` (`{ id, kind: 'AIRSPACE_ENTRY', trackId, flightDataId|null, callsign,
airspaceId, airspaceName, airspaceType, since }`, `since` on the mission clock), per session to the airspace's
**controlling Position** and **every Position holding a live Strip of the flight** (`deliverableTo`, the hub's
`airspaceEntryFor`, the LT-MARSA `conflictAlertFor` pattern; the filter is never sent); an untracked contact's goes to
the controlling Position only. A read-scope OWNED session also needs the flight visible.

**Display (dark cockpit)**: amber. ATC data block line 0 `SAA` (palette key `caution`, ours; after CA, forces an FDB like
CA), blinking until a click on the target acknowledges it (client-local, as STARS, ¶13-1-9's spirit); a new entry blinks
again. Classic label `SAA` after the red alerts. Strip chip "Airspace conflict <name>", a track-panel line. Retracts when
the aircraft leaves, or on approval. The tag `SAA` (Special Activity Airspace, P/CG) is ours; the FAA's is a Blue EDST
alert in a list, not a data-block tag.

### 4. Wire

`efsp-alerts` gains the `airspaceEntry` slice. The wire scan now records `efsp-alerts`' top-level keys
(`tools/wire-surface.js`); WIRE_PROTOCOL stays 2 (unreleased).

## Consequences

- OPS alone no longer sees "+ New airspace" and cannot edit or delete a definition; airspace definitions are the
  controlling Positions' (or the web's SQUADRON_ADMIN, unchanged).
- A RANGES using Position (`usingPositionId`) is the using agency in the rules, but works no Board: it cannot reach a
  Strip to approve on. Unchanged; the Position working the Strip relays.
- The alert does not look ahead (no EDST-style probe): a predictive warning before entry is the human's call (LT-RQ5 of the
  research), not built.
- A real hostile or nonparticipant aircraft reporting altitude in an active area alerts the controlling Position; a
  primary-only one does not.
