# Electronic Flight Strip Panel (EFSP) — Implementation Guide

**System:** SOURCE Combined Radar Controller (CRC) — MapLibre GL front end, Node.js / gRPC / WebSocket back end
**Component:** EFSP — a TFDM-style electronic flight strip panel, multi-position, with strip transfer
**Audience:** implementing agents
**Companions:** `EFSP-Research-Annex.md` (Part B — TFDM and military flight data, sourced) · `EFSP-Coordination-Annex.md` (Part C — how military control interfaces with the civil system, and the position model)
**Status:** draft for implementation. Version 1.1, 30 August 2026

**Operating environment, fixed by the project owner:** SOURCE operates from **Incirlik Air Base** but flies **American procedures, not Turkish**. Incirlik is therefore modelled as a US-operated joint-use base with a RAPCON holding delegated airspace, and Ankara Center as an ARTCC applying FAA JO 7110.65. This is a deliberate modelling choice; it is stated once in the facility configuration and not repeated. See `EFSP-Coordination-Annex.md` §6.

---

## 0. How to use this document

### 0.1 Register and normative language

**MUST / MUST NOT** — required. A build that violates one is non-conforming and MUST be corrected before the work package is accepted.
**SHOULD / SHOULD NOT** — required unless a stated reason applies. Departures MUST be recorded as an ADR (§0.4).
**MAY** — permitted, at the implementer's discretion.

Defined Terms are capitalised throughout (Strip, Bay, Rack, Position, Flight Data Record, Mutation, Board). Their definitions are in §2 and are binding: where prose and §2 disagree, §2 governs.

> **Editor's note.** This guide is drafted in a general normative register. It has **not** been conformed to the SOURCE Contract Language Standard, because that standard's text was not available to the drafter. A conforming editor's pass is required before this document is published to the wiki — in particular for defect-class naming, apparatus, and the precision rules on quantities and time expressions.

### 0.2 Provenance discipline — the single most important rule in this document

Real-world source material for TFDM stops well short of an interface specification. The FAA has not published the EFS operator manual, the state list, or the bay names. Where this guide specifies behaviour that is **not** documented in the real system, the clause is tagged **`[SOURCE-DEFINED]`**.

**Implementing agents MUST NOT:**

- present a `[SOURCE-DEFINED]` behaviour as real-world doctrine in code comments, UI text, wiki documentation, or training material;
- invent additional field names, state values, or procedures and attribute them to FAA, DoD, or NATO documents;
- resolve an ambiguity by guessing when the Research Annex marks it `[GAP]`. Raise it as an Open Question (§14) instead.

Where a clause **is** grounded in a published source, it carries a bracketed citation to the Annex section, e.g. `[Annex §5]`. Follow the link before departing from the clause.

### 0.3 Reconnaissance gate — do this before writing code

This guide was drafted **without access to the CRC repository**. Every statement about the existing system in §1.3 is an assumption. Work Package 0 (§13) requires the first implementing agent to verify each assumption against the actual codebase and produce an Integration Report. **No implementation work package may begin until WP0 is accepted.**

If a WP0 finding contradicts this guide, the finding wins and this guide MUST be amended by ADR.

### 0.4 Architecture Decision Records

Every departure from a **SHOULD**, every resolution of an Open Question, and every WP0 finding that amends this guide MUST produce an ADR at `docs/adr/NNNN-title.md` with: context, the decision, alternatives considered, consequences, and the clause of this guide affected.

### 0.5 The acronym collision, and the convention for handling it

In SOURCE usage **CRC** means the Combined Radar Controller. In real military usage **CRC means Control and Reporting Center** — a mobile ground-based C2 radar unit of the Theater Air Control System, with an AN/TYQ-23A battle-management suite and 16–18 BMC2 operators on crew `[Annex §14.2]`.

This collision will bite: the EFSP has a tactical Position whose real-world counterpart *is* a Control and Reporting Center, so both meanings appear in the same sentence routinely.

**Convention, binding on code, UI text and documentation:**

- The application is **CRC** only in repository and package identifiers.
- In all UI text and documentation the application is **"the radar client"** or **SOURCE CRC**.
- The military C2 entity is always written **"Control and Reporting Center"** on first use in a document and **"C2 CRC"** thereafter, never bare "CRC".
- The tactical Position identifier in code is `TAC_C2`, never `CRC`.

---

## 1. Scope

### 1.1 In scope

1. A multi-position electronic flight strip panel modelled on the FAA TFDM Electronic Flight Strips, faithful to the published block layout, interaction model and human-factors findings, extended with the military flight-data fields that DCS F-16/F-18 operations actually require.
2. Strip transfer between Positions over the existing gRPC/WebSocket layer, with explicit ownership, conflict rejection, presence gating, and reconnection resync.
3. A per-facility adaptation layer, because the real system's strip content is site-adapted and its national standard deliberately leaves the tower working area unstandardised `[Annex §9]`.
4. Correlation between a Strip and its surveillance track on the existing MapLibre display.
5. Military-specific state that has no civil equivalent: MARSA relationships, arresting-gear-gated runway state, alert/scramble ground constraints, ordnance state, MTR entry/exit, aerial refueling association, ATO mission-line binding.

### 1.2 Out of scope for v1

Departure metering and surface scheduling (TOBT/TMAT computation); datalink clearance delivery; a supervisor/traffic-management display; en-route `(flight, fix)` strip posting; ATO/ACO *authoring*. Each is addressed in §12 as a deliberate deferral with the reason.

### 1.3 Assumptions about the existing system — VERIFY IN WP0

| # | Assumption | If false |
|---|---|---|
| A1 | **RESOLVED by the project owner: the CRC server already keeps a per-aircraft flight record** with callsign, type, route, assigned altitude, squawk, departure and destination. The EFSP reads and writes that record and owns only its own annotations, Bay position and State. WP0 verifies the field set and the write path, not the existence | If the record turns out to be thinner than stated, WP0 raises an ADR and the EFSP extends it rather than replacing it |
| A2 | Browser↔server transport is WebSocket; gRPC is service-to-service only | §5 transport clauses change; note gRPC-Web cannot do bidirectional streaming in a browser `[Annex §15.7]` |
| A3 | A Position/authentication concept exists (a controller logs in as a Position) | WP1 must add it; ownership (§4.4) depends on it entirely |
| A4 | Surveillance tracks carry a stable identity and a Mode 3/A code | §6.6 correlation changes; expect the identity-reconciliation defect class regardless |
| A5 | The front end is a component framework with a state store, not raw DOM | §7 rendering clauses adapt; the template model (§7.2) is framework-agnostic |
| A6 | A persistent store exists for facility configuration and audit | WP1 must add one; the Mutation log (§5.6) is not optional |

---

## 2. Defined Terms

**Flight Data Record (FDR)** — the authoritative record of one flight or one formation: identity, filed intent, assigned clearance, current state. Server-owned. Exactly one per flight per operating day. Not itself a Strip.

**Strip** — a presentation of one FDR to controllers, carrying its own annotations, position in a Bay, and lifecycle State. One FDR MAY have more than one Strip only where §3.6 permits.

**Strip Role** — `DEPARTURE`, `ARRIVAL`, `OVERFLIGHT`, `MISSION`, `COORDINATION`, `PATTERN`, `MARSHAL`, `FINAL`. Determines which Block Map applies. The last three are SOURCE additions for the RSU, carrier and precision-approach positions and are `[SOURCE-DEFINED]` in layout, though their field content is sourced (§9.12, §7.10).

**Facility** — the top-level container: `INCIRLIK`, `CENTER`, `RANGES`, `TACTICAL`, `CARRIER`. Strips do not move between Facilities; data is forwarded and each Facility holds its own replica (§4.6).

**Block** — an addressable field on a Strip, identified by a Block ID string that follows FAA flight-progress-strip numbering (`"1"`, `"2A"`, `"9E"`, `"25"`, `"26"`) or the SOURCE military extension namespace (`"M1"`…).

**Block Map** — the per-Strip-Role mapping from Block ID to field definition: label, data binding, provenance class, required/optional, editability, actions.

**Bay** — a named container of Racks belonging to a Position. Bay membership expresses operational state.

**Rack** — an ordered vertical column of Strips within a Bay. Order within a Rack is meaningful (a departure Rack's order *is* the departure sequence `[Annex §9]`).

**Position** — an operating role a controller signs into. The set is fixed by the project owner and listed in §4.1. Positions MAY be combined at one workstation **within a Facility**, never across Facilities.

**Board** — the complete set of Bays, Racks and Strips for one facility. The unit of sequencing and resync.

**Mutation** — a client-originated intent to change the Board, e.g. `MoveStrip`, `SetBlock`, `TransferStrip`. Never a resulting state.

**Owner** — the Position currently responsible for a Strip. Exactly one at a time.

**EFSP State** — the value of Block 25. `[SOURCE-DEFINED]` — see §3.4.

**Next Logical Action (NLA)** — the single action Block 26 offers for the current EFSP State. Real-world TFDM has this as an on-strip button that state can inhibit `[Annex §3]`; its determination rule is not published, so the table in §3.5 is `[SOURCE-DEFINED]`.

---

## 3. Domain model

### 3.1 FDR and Strip are separate — non-negotiable

The FDR is the flight; the Strip is what a controller works with. They MUST be separate entities with separate revisions.

Reason: the FDR changes from upstream data (track updates, filed amendments, ATO ingest); the Strip changes from controller action. Collapsing them means every track update invalidates the controller's optimistic edit, and every annotation dirties the flight record. The real systems keep them separate — TFDM's block map marks fields "Computer-generated" versus "manually enter" as distinct provenance classes `[Annex §2.5]`.

```
FlightDataRecord {
  fdrId            string          // stable, server-assigned
  rev              uint64
  identity         Identity        // §3.2
  filed            FiledIntent     // route, altitude, times as filed
  assigned         Assignment      // clearance as issued
  military         MilitaryData    // §9, nullable
  trackRef         TrackRef?       // §6.6 correlation, nullable
  provenance       map<fieldPath, Provenance>
  createdAt, updatedAt, updatedBy
}

Strip {
  stripId          string
  fdrId            string
  rev              uint64          // independent of FDR rev
  role             StripRole
  state            EfspState       // Block 25
  ownerPositionId  string
  bayId, rackId    string
  orderKey         string          // fractional index, §5.4
  annotations      map<BlockId, AnnotationCell>   // §3.7
  flags            StripFlags      // offset, flipped, removeIndicator, …
  createdAt, updatedAt, updatedBy
}
```

`Provenance` MUST be one of `COMPUTER_GENERATED`, `CONTROLLER_ENTERED`, `UPSTREAM_ATO`, `UPSTREAM_TRACK`, `SYSTEM_DERIVED`, and MUST be rendered (§7.5). This is a real TFDM property, not decoration.

### 3.2 Identity

```
Identity {
  callsign         string   // MUST NOT exceed 7 alphanumeric characters
  flightSize       uint8    // number of aircraft; a formation is ONE record
  aircraftType     string   // ICAO Doc 8643 designator
  wakeCategory     WakeCat  // see below
  equipmentSuffix  string   // DERIVED, not directly editable — §3.3
  beaconCode       string   // Mode 3/A. ASSIGNED BY THE SYSTEM, never filed
  modeOne          string?  // military
  modeTwo          string?  // military
  tailNumber       string?  // distinct from callsign — DD-175 splits these
  unit             string?
  homeStation      string?
}
```

Binding rules, all sourced:

1. **Callsign MUST NOT exceed 7 alphanumeric characters** `[Annex §9]`.
2. **A formation is one Identity with `flightSize > 1`, not N records** `[Annex §13.6]`. Intra-cell vertical spacing of 500 ft between each aircraft is the rule Local applies; separation is computed against the formation envelope versus nonparticipating traffic.
3. **`beaconCode` MUST be assigned by the system and MUST NOT be settable from a filed flight plan.** Beacon codes are prohibited in the ICAO flight plan — the FAA's en route interface guide states plainly that it *"will not accept an input transponder code in an FPL"* — and assignment happens inside ATC automation `[Annex §9, Coord §2.8.6]`. Allocation and minting are **out of EFSP scope**; see §3.10 for the full boundary.
4. Wake category: implement **CWT categories A–I**, not the legacy heavy/large/small split. Note the real-world inconsistency — en route strips still say "heavy aircraft indicator H/" while terminal strips say "wake category indicator" `[Annex §9]`. The EFSP MUST store CWT and MAY render `H/` for compatibility.
5. Military callsign prefixes MUST be recognised for display grouping: `A` USAF, `C` USCG, `G` ANG/ARNG, `R` Army, `VM` USMC, `VV` USN `[Annex §12]`.

### 3.3 The equipment suffix trap — implement the interlock

**The equipment suffix MUST be derived from the ICAO equipment codes and MUST NOT be directly editable.** FAA doctrine is explicit that directly changing the suffix *"may unintentionally alter or delete other equipment codes"* `[Annex §9]`.

**Exception, which MUST be implemented:** `/H` (failed transponder) and `/O` (failed Mode C) are ATC-use-only degradation states, not published capabilities. A controller MUST be able to set them **without** touching the equipment code list, and they MUST NOT propagate back into a filed flight plan.

Implement as: `equipmentCodes` (editable, structured) → derived `equipmentSuffix`; plus an independent `degradation` field ∈ `{NONE, TRANSPONDER_FAILED, MODE_C_FAILED}` that overrides the rendered suffix.

### 3.4 EFSP State `[SOURCE-DEFINED]`

**The real TFDM EFS STATE value set is not published in any public source** `[Annex §3, Annex §16 gap 1]`. The values below are SOURCE-defined. They are shaped after three independent analogues — the Lincoln Laboratory prototype's Pending PDT / Ready to Taxi / Active / Unsorted, the FAA WJHTC prototypes' Pending / Outbound / Inbound, and the Raytheon patent's six flight-phase bays — but the labels are ours.

Departure lifecycle:

| State | Meaning | Normally owned by |
|---|---|---|
| `PROPOSED` | FDR exists, strip auto-created from filed data | `OPS` |
| `PENDING_CLEARANCE` | Awaiting clearance delivery | `CD` |
| `CLEARED` | Clearance issued (voice or datalink) | `CD` |
| `HELD` | Hold for release, release time, or void time in force — §3.8 | `CD` / `GND` |
| `PUSHBACK` | Off-block / engine start approved | `GND` |
| `TAXI` | Taxiing to runway | `GND` |
| `RUNWAY_QUEUE` | At or approaching the runway, in departure sequence | `TWR` |
| `LUAW` | Line up and wait — a distinct state, see §3.9 | `TWR` |
| `DEPARTED` | Airborne | `TWR` → `APP` |
| `HANDED_OFF` | Transferred to the next controlling agency | — |
| `DROPPED` | Removed from the Board | — |

Arrival lifecycle: `INBOUND` → `HANDED_TO_TOWER` → `FINAL` → `LANDED` → `TAXI_IN` → `DROPPED`.
Overflight: `INBOUND` → `IN_SECTOR` → `HANDED_OFF` → `DROPPED`.
Mission (`TAC_C2`): `TASKED` → `AIRBORNE` → `ON_STATION` → `OFF_STATION` → `RTB` → `DROPPED`. See §9.8.

**`DROPPED` MUST be distinct from deletion.** TFDM carries a separate "Remove Strip Indicator" field (Block 4A) alongside the state field, which means removal is a modelled action, not a delete `[Annex §2.5]`. A `DROPPED` Strip MUST remain queryable for the audit log and traffic count (§11.4) and MUST leave the visible Board.

### 3.5 Next Logical Action `[SOURCE-DEFINED]`

Block 26 renders one action button. What is verified about the real system: NLA is an on-strip button; drag-and-drop is the alternative path; a ground-stop indicator can **disable** NLA `[Annex §3]`. The determination rule is not published.

```
nla(strip) -> Action | INHIBITED(reason)
```

| State | NLA | Inhibited when |
|---|---|---|
| `PROPOSED` | Send to Clearance | no beacon code assigned |
| `PENDING_CLEARANCE` | Mark Cleared | flight plan invalid (§8.5) |
| `CLEARED` | Approve Pushback | a hold is in force (§3.8); alert pad conflict (§9.6) |
| `HELD` | Release | release time not reached; void time expired |
| `PUSHBACK` | Taxi | — |
| `TAXI` | To Runway Queue | assigned runway unavailable (§9.7) |
| `RUNWAY_QUEUE` | Line Up and Wait | runway occupied |
| `LUAW` | Cleared for Takeoff | runway occupied; arresting gear reconfiguration in progress (§9.7) |
| `DEPARTED` | Hand Off | no receiving Position present (§4.5) |
| `HANDED_OFF` | Drop | — |

Rules:

1. NLA MUST be a single action, never a menu. Where more than one action is plausible, the Strip has too many states — split it.
2. **An inhibited NLA MUST render the reason**, not merely grey out. The real system's one documented inhibit is a ground stop; ours are listed above and each MUST be attributable to a named condition.
3. NLA MUST be idempotent under double-tap: a second press within 400 ms MUST be discarded, not queued.
4. Every NLA transition MUST also be reachable by drag-and-drop and by keyboard command. NLA is an accelerator, not the only path.
5. **`Undo` MUST exist for the last NLA transition per Strip**, with a 30-second window. The Raytheon patent lists Undo as a first-class One Touch Action, and misfires on a touch panel are the expected failure mode `[Annex §3]`.

### 3.6 When one FDR gets more than one Strip

Permitted only in these cases, and MUST NOT be extended without an ADR:

1. A **`COORDINATION` half-strip** pushed to another Position while the full Strip remains with the Owner. Half-strips exist in vStrips for exactly this `[Annex §15.1]`.
2. A **turnaround**: an `ARRIVAL` Strip that reaches `DROPPED` and a later `DEPARTURE` Strip for the same airframe are separate Strips referencing separate FDRs.

Notably **not** permitted in v1: en-route `(flight, fix)` posting, where one flight generates a sequence of Strips, one per posted fix, linked by strip number and revision. That is how the real en route system works `[Annex §9]` and it is deferred (§12).

### 3.7 The amendment model — append-only with visible supersession

This is the hardest doctrinal constraint and MUST be implemented literally.

FAA JO 7110.65 ¶2-3-1: **"Do not erase or overwrite any item."** Deletions are marked with an `X` and **"write the new altitude information immediately adjacent to it and within the same space."** An altitude being vacated MUST NOT be struck through **"until after the aircraft has reported or is observed (valid Mode C) leaving the altitude."** `[Annex §9]`

```
AnnotationCell {
  blockId    BlockId
  entries    [ Entry ]        // append-only, ordered
}
Entry {
  value      string
  status     ACTIVE | SUPERSEDED | STRUCK | PREPLANNED
  at         timestamp
  by         positionId
}
```

Rules:

1. Amending a Block MUST append a new `Entry` and set the prior `Entry` to `SUPERSEDED`. It MUST NOT overwrite.
2. A superseded value MUST remain visible in the same Block, rendered struck through, until the Strip is `DROPPED`. Where space does not permit, the Block MUST render an overflow indicator and expose full history on tap — modelled on ATOP's `*` convention for state the strip cannot render `[Annex §9]`.
3. **A vacated altitude MUST NOT be struck automatically on assignment.** It MAY be struck only on pilot report or on valid Mode C observation of the aircraft leaving. Implement as an explicit `confirmVacated` action, and offer it automatically once Mode C confirms — but the marking is the controller's.
4. `PREPLANNED` entries render distinctly (the paper equivalent is red pencil).
5. **`Enter` commits, `Esc` cancels and reverts. The EFSP MUST NOT auto-commit an annotation on blur.** An accidental click elsewhere must never amend a clearance. This is VRC's exact contract and the right one `[Annex §15.2]`.

### 3.8 Departure release states

Four states MUST be modelled, from FAA JO 7110.65 ¶4-3-4 `[Annex §9]`:

| State | Rule |
|---|---|
| `RELEASED` | normal |
| `HOLD_FOR_RELEASE` | clearance not valid until further instructions; **departure delay information MUST be captured and displayed** |
| `RELEASE_TIME` | earliest time the aircraft may depart; a time check MUST be issued with it |
| `CLEARANCE_VOID_TIME` | with a **derived deadline 30 minutes after the void time**, at which the system MUST alert if the flight is not airborne |

That derived 30-minute deadline is a real rule and a good early demonstration of the panel doing something paper cannot.

### 3.9 LUAW as a first-class state

FAA JO 7210.3EE ¶10-3-8 requires facilities to establish a method for Local to maintain awareness of aircraft positions, *"for example, annotating flight progress strips"* — a national obligation with a locally chosen encoding `[Annex §9]`. The common local encoding is to offset the strip in the bay.

The EFSP MUST implement **both**: `LUAW` as a typed State **and** the `offset` flag as a free-form controller annotation. Do not collapse them. Typed state gains queryability; the offset gains the improvisation controllers actually use it for. TFDM made the same choice — typed Block 25 alongside free-text facility remarks in Blocks 23/24 `[Annex §9]`.

### 3.10 Beacon and IFF codes — where the boundary falls

**Code *allocation and minting* are out of EFSP scope. Everything the controller does with a code is in scope.** Full sourcing in `EFSP-Coordination-Annex.md` §2.8.

The real system draws the same line: allocation of code blocks is a national plan, assignment of a specific code is done by **the automation** at flight-plan processing time, and the code is then **carried on the flight plan record and forwarded** between facilities — a controller manually re-entering a flight plan is required to re-use the code that came with it, not mint a new one `[Coord §2.8.6]`. Two virtual-ATC systems solving this exact problem converged independently on central server-side allocation with a single authoritative list `[Coord §2.8.9]`.

Given decision D-1 — the CRC server already keeps the flight record — the code belongs there with it.

#### 3.10.1 The split

| Concern | Owner |
|---|---|
| Code pools and their search order; excluding reserved and non-discrete codes; minting at flight-plan creation; observed-code reporting from the track domain; duplicate **detection** | **CRC server** |
| Display of assigned versus observed; the controller override; the change-restraint rule; special-code handling; Mode 1/2/3 presentation and the ATO reconciliation; code-related NLA inhibits | **EFSP** |

**WP0 MUST establish whether the CRC server mints codes today.** If it does not, that work belongs in the server, not in this panel — but the EFSP cannot ship without it, because §3.5's `PROPOSED` → clearance transition is inhibited until a code exists. Raise it as an ADR rather than absorbing it.

#### 3.10.2 Rules the EFSP MUST implement

1. **Assigned and observed are two separate fields.** Never one. The panel derives a mismatch state by comparing them, and renders three cases: **matching**, **mismatched**, and **assigned but nothing received**. This is exactly what the real ERAM data block does with `####` and `NONE` `[Coord §2.8.9]`.
2. **The controller MAY override an assigned code** — *"Computer-assigned codes may be modified as required"* — and the override MUST be recorded with provenance `CONTROLLER_ENTERED`, not silently replacing the computer value `[Coord §2.8.6]`.
3. **The change-restraint rule MUST be enforced as a warning:** do not request a code change from a code the aircraft was squawking in the transferring facility's area until it is within your area of responsibility, unless a directive, agreement, or handoff coordination says otherwise. The panel knows whether the aircraft is in your area; use that.
4. **Reserved codes MUST be unassignable and display-only:** `0000` (never assigned by ATC), `7500`, `7600`, `7700`, `7400`, and `7777`. Attempting to assign one is a validation error, not a warning.
5. **`7777` deserves its own treatment.** It is *"DOD interceptor aircraft on active air defense missions and operating without ATC clearance"* — self-selected by an alert element, never issued by ATC. When observed, the panel MUST surface it prominently and MUST NOT offer it as an assignment. This pairs directly with the `SCRAMBLE` alert state in §9.6.
6. **Code `4000` MUST be a first-class assignable**, and it is the most SOURCE-relevant code in the plan: it is the code for flight not compatible with a discrete assignment — **MTR missions, aerial refueling across multiple strata, ALTRVs with frequent altitude changes** — and military aircraft in restricted or warning areas or on VR routes squawk it unless otherwise assigned `[Coord §2.8.5]`. The panel SHOULD offer `4000` as a suggested assignment whenever a Strip carries MTR (`M10`), AR (`M12`) or ALTRV (`M9`) data.
7. **Duplicate codes raise an alert, never a hard block.** Duplicates are structural in the real system and explicitly accepted as unavoidable `[Coord §2.8.2]`. A panel that refuses to proceed on a duplicate is modelling a guarantee the real system does not make.
8. **The monitor set MUST be recognised on sight** — `1200`, `1202`, `1203`, `1255`, `1277`, and `4000` in restricted or warning areas and on VR routes — and rendered distinctly from a discrete assignment.
9. **A code MUST NOT be accepted from a filed flight plan.** Already stated in §3.2 rule 3; restated here because it is the rule most likely to be violated by a convenience feature.

#### 3.10.3 Military modes — only Mode 3 is ATC's

```
Identity {
  modeThree   string   // ATC-writable. The beacon code. §3.2
  modeOne     string?  // mission code — ATO-owned, READ-ONLY to ATC
  modeTwo     string?  // airframe identity — ATO-owned, set on the ground, READ-ONLY to ATC
}
```

1. **Mode 1 and Mode 2 MUST be read-only to every ATC Position.** Mode 1 is a mission code set *"as directed by area commander instructions"*; Mode 2 is a per-airframe identity code *"assigned by area commander notices"* and **set on the ground**. Neither is ATC's to change `[Coord §2.8.7]`. They populate from the ATO's `MSNACFT` set (§9.9) and are displayed, not edited.
2. **Mode 3 is the only ATC-writable code**, and the doctrinal rule is that participating aircraft *"must display transponder codes as assigned by ATC at all times unless otherwise coordinated."*
3. **Implement the reconciliation, because milsim will hit it constantly.** When an ATO line carries a Mode 3 that differs from the ATC-assigned code, the panel MUST surface the conflict on the Strip and MUST NOT silently prefer either. **The ATC code is authoritative by default**; a departure from it requires a recorded coordination, and the panel MUST capture which of the six coordination instruments applied `[Coord §2.8.8]`. Note that **"otherwise coordinated" is nowhere defined** — SOURCE picks its own convention and labels it `[SOURCE-DEFINED]`.
4. **Modes 4 and 5 MUST be modelled only as `keyed / not keyed` and `valid / no reply`.** Their waveforms, crypto and message formats are not public. Do not model further `[Coord §2.8.7]`.
5. **Mode 1's range is disputed in the sources** — 00–73 in the Navy manual, 00–77 elsewhere. Pick one, put it in facility configuration, and document the choice. Do not present it as settled.

#### 3.10.4 What NOT to build

- **No code recycle or hold-down timer.** No value or mechanism is published anywhere; it appears to be an automation adaptation parameter. Inventing one is defect **D11** (doctrine fabrication).
- **No global uniqueness guarantee** — see rule 7.
- **No DoD block-request workflow.** The procedure is not public and MUST NOT be reconstructed.

---

## 4. Positions, Bays and transfer

### 4.1 Position set — fixed by the project owner

Eighteen Positions across five Facilities. The **Class** column is load-bearing and is derived in `EFSP-Coordination-Annex.md` §1: it determines which coordination primitives a Position may use, and it is not a stylistic choice.

| ID | Name | Class | Facility | Primitives | Strip Roles |
|---|---|---|---|---|---|
| `CD` | Clearance Delivery | Military ATC | Incirlik | intrafacility transfer; receives release | `DEPARTURE` |
| `GND` | Ground | Military ATC | Incirlik | intrafacility transfer | `DEPARTURE`, `ARRIVAL` |
| `TWR` | Tower | Military ATC | Incirlik | intrafacility; `HANDOFF` to `APP` | `DEPARTURE`, `ARRIVAL` |
| `RSU` | Runway Supervisory Unit | Military ATC, advisory | Incirlik | pattern supervision; **no separation authority** | `PATTERN` |
| `APP` | Approach / Departure (RAPCON) | **Military ATC** | Incirlik | `HANDOFF`, `POINT_OUT`, `TRAFFIC`, `OPERATIONAL_REQUEST`, release | all |
| `SFA` | Single Frequency Approach | Military ATC | Incirlik | **frequency-rotation transfer** — §4.7 | `ARRIVAL` |
| `PAR` | PAR Approach | Military ATC | Incirlik | continuous guidance | `FINAL` |
| `OPS` | Operations | **BASOPS / AMOPS** | Incirlik | files flight plans; owns Field State; **not a control position** | originates `DEPARTURE` |
| `CTR` | Ankara Center | Civil ATC | Center | `HANDOFF`, `POINT_OUT`, `TRAFFIC`, data forwarding, release, `TOFI` | all |
| `RANGE` | Range Control | **Using agency** | Ranges | **no strip primitives** — owns airspace state | none |
| `TAC_C2` | Tactical C2 | **MRU** | Tactical | **`TOFI` only** | `MISSION` |
| `AIC` | Air Intercept Controller | MRU position | Tactical | works under `TAC_C2`'s `TOFI` | `MISSION` |
| `GCI` | Ground Controlled Intercept | **MRU** | Tactical | **`TOFI` only** | `MISSION` |
| `JTAC` | JTAC | Non-ATC | Tactical | none | `MISSION` (read-only) |
| `CV_MARSHAL` | Carrier Marshal | Military ATC afloat | Carrier | stack sequencing; hands to `CV_APP` | `MARSHAL` |
| `CV_PRIFLY` | Carrier PriFly | Military ATC afloat | Carrier | owns the CCZ; **sets the recovery Case** | `PATTERN` |
| `CV_APP1` | Carrier Approach 1 | Military ATC afloat | Carrier | lane 1; hands to Final/LSO | `MARSHAL` → `FINAL` |
| `CV_APP2` | Carrier Approach 2 | Military ATC afloat | Carrier | lane 2 | `MARSHAL` → `FINAL` |

**Four rules that follow, and MUST be enforced in code, not merely documented:**

1. **`TAC_C2`, `GCI`, `AIC` and `JTAC` MUST NOT be given `HANDOFF` or `POINT_OUT`.** FAA JO 7610.14A ¶8-1-1 states that Military Radar Units *"must not be authorized nor requested to provide ATC services."* They get `TRANSFER_OF_FLIGHT_INFORMATION` (§4.6). Offering them a handoff button is a doctrinal defect, class **D12** (§15).
2. **`RANGE` works no Strips.** It owns airspace state — schedule, activation, release direction. Give it a Field State board.
3. **`OPS` originates the Flight Data Record**, matching the real BASOPS path in which the pilot files with base operations and base operations forwards to the centre `[Coord §2.5]`. It is also the owner of Field State actions under §9.7.
4. **`RSU` and `CV_PRIFLY` are supervisory positions over a visual pattern**, not radar control positions. Their Bay is a pattern board, not a strip rack.

**Positions are not signed into. They are derived from the controller's selected radar stations, they combine freely including across Facilities, and the set changes live during a session.** This is a property of the host CRC, it is the normal operating condition under low manning, and it governs §4.8 — read that before implementing anything in this section.

**`APP` unmanned:** when no controller holds `APP`, the delegated airspace reverts to `CTR`. Delegation is time-bounded in the real world — a verified example has a RAPCON's delegated Class B sector reverting outside published operating hours `[Coord §2.2]`. The panel MUST render reversion explicitly rather than stranding Strips.

### 4.2 Bay structure

Adopt the **Facility → Bay → Rack → Strip** hierarchy from vStrips `[Annex §15.1]`. It is the only public prior art that solves the multi-position problem, and it maps cleanly onto TFDM's "strip boards containing customisable bays with headers" `[Annex §4]`.

A controller views **one Bay at a time**, with other Bays reachable through header drop zones that double as drag targets. This avoids needing several Bays visible at once on a cab display.

Default Bay sets `[SOURCE-DEFINED]` — the real TFDM bay names are not published `[Annex §16 gap 3]`. These are the starting configuration; the adaptation layer (§8) is what matters.

| Position | Bays |
|---|---|
| `OPS` | Filed · Proposed · Field State · Coordination |
| `CD` | Pending Clearance · Cleared · Held · Coordination |
| `GND` | Pushback · Taxi Out · Taxi In · Coordination |
| `TWR` | Runway Queue (one Rack per runway) · Airborne · Arrivals · Coordination |
| `RSU` | Pattern board (not a strip rack) — closed, initial, base, final |
| `APP` | Inbound · In Sector · Departures · Handed Off · Coordination |
| `SFA` | Assigned Frequencies (one Rack per frequency — §4.7) |
| `PAR` | On Final (one Strip at a time, minimal — §7.10) |
| `CTR` | Inbound · In Sector · Delegated to APP · Forwarded · Coordination |
| `RANGE` | Airspace board (not a strip rack) — scheduled, active, released, returned |
| `TAC_C2` | Tasked · Airborne · On Station · Tanker · Coordination |
| `AIC` / `GCI` | On Station · Committed · Coordination |
| `CV_MARSHAL` | Marshal Stack (ordered by stack index — §9.12) · Departures · Coordination |
| `CV_PRIFLY` | Deck state · Pattern board · Case selector |
| `CV_APP1` / `CV_APP2` | Lane (one Rack, ordered) · Bolter/Waveoff |

### 4.3 The Pending bay is the known choke point

Measured finding: the longest ground-control dwells occurred when **searching for strips in the Pending bay** — 13 of 53 instances over 15 seconds `[Annex §6]`.

Therefore:

1. Any Bay expected to accumulate MUST support **Racks as partitions** and a **sort key** configured per facility.
2. Search results MUST render in a **dedicated search Bay**, not by filtering the working Bay in place. TFDM allows up to 10 search bays per position with stored criteria `[Annex §4]`.
3. **Instrument search usage.** Search is a failure symptom: if controllers search frequently, the Bay and sort design has failed. §11.5 makes this a measured acceptance criterion, not a hope.

### 4.4 Ownership

1. Every Strip has exactly one `ownerPositionId`.
2. Mutations to owner-controlled Blocks MUST be rejected unless the mutating Position is the Owner, or holds a Position that includes the Owner by combination (§4.1).
3. Annotation Blocks designated `sharedAnnotation` in the Block Map MAY be written by any Position with the Bay in view. Use this sparingly.
4. **Ownership eliminates most conflicts by construction.** This is the reason the EFSP uses optimistic concurrency rather than a CRDT — see §5.5.

### 4.5 Transfer protocol

Transfer is the operation most likely to fail in production. The Lincoln Laboratory prototype measured **99.68%–100%** successful ownership transfers, with the failure residue clustered around restarts and message latency `[Annex §4]`. Design for the failing 0.3%.

```
TransferStrip {
  stripId, baseRev
  fromPositionId, toPositionId
  clientMutationId
}
```

1. Transfer MUST be a **single atomic server-side Mutation**: owner change, Bay change and Rack placement commit together or not at all.
2. **Push targets MUST be gated on occupancy.** A Position is occupied when some connected controller is its Primary (§4.8.2). A transfer to an unoccupied Position MUST be rejected with `NO_RECEIVING_POSITION` and MUST NOT silently strand the Strip. vStrips gates external pushes on an active controller at the destination `[Annex §15.1]`. Occupancy is derived and changes live, so this check MUST be evaluated at commit time on the server, never from a cached client-side view.
3. Where the destination is unmanned, the Strip MUST route to the **covering Position** per the facility configuration, and the UI MUST say so.
4. The sending Position MUST see the Strip leave only on server acknowledgement. Optimistic rendering applies to moves *within* a Position; **transfer MUST NOT be rendered optimistically as complete** — it MAY render as "transferring".
5. A transfer that times out MUST return the Strip to the sender with a visible failure, never disappear.
6. Every transfer MUST be recorded in the Mutation log with both Positions and the timestamp. `[Annex §9]` notes that in real towers the Clearance Delivery controller **initials the strip** before passing it on; the electronic equivalent is a non-optional audit entry.

### 4.6 Cross-Facility coordination — a different mechanism entirely

**The Strip does not cross the Facility boundary.** Each Facility materialises its own Strip from forwarded data: FDIO strips print locally on defined triggers including facility-boundary crossing; the orders oblige forwarding of *data*, not the artefact; and each holder keeps its own Strip current and removes it on its own schedule `[Coord §2.6]`.

> **One logical Flight Data Record; N per-Facility Strip replicas; synchronised by data messages plus coordination events.**

Implementing this as a strip *move* across Facilities is defect class **D13** (§15).

**The primitives, per `EFSP-Coordination-Annex.md` §2.4 and §3.1:**

| Primitive | Between | Radar ID | **Comms** | Jurisdiction | Accept |
|---|---|---|---|---|---|
| `HANDOFF` | ATC ⇄ ATC | transfers | **transfers** | passes to receiver | `"RADAR CONTACT"` |
| `POINT_OUT` | ATC ⇄ ATC | transfers | **does not** | **stays with initiator** | `"POINT OUT APPROVED"` |
| `TRAFFIC` | ATC ⇄ ATC | transfers | does not | stays with initiator | `"TRAFFIC OBSERVED"` |
| `OPERATIONAL_REQUEST` | ATC ⇄ ATC | — | — | stays with requester | `"APPROVED"` / `"UNABLE"` / `"STAND BY"` |
| `TOFI` | **ATC ⇄ MRU** | — | separate step | see §4.6.3 | acknowledgement |
| `AIT` | ATC ⇄ ATC | transfers | transfers | passes | silent — requires a written directive |

Rules, each verified:

1. **On a `POINT_OUT` the initiator retains data ownership while the receiver takes separation responsibility for its own traffic.** That split is the subtlest thing in the protocol; the UI MUST render both halves unambiguously.
2. `HANDOFF` MUST complete **before** the aircraft enters the receiving Position's delegated airspace.
3. The **receiving** Position issues any entry restrictions **before accepting**; the transferring Position MUST then comply.
4. Changing flight path, altitude, speed or data-block content **during or after** a handoff or approved point out requires verbal approval. Implement as a soft interlock that warns.
5. Track-degradation flags (`CST`, `FAIL`, `NONE`, `IF`, `NT`, `TRK`) **force verbal coordination**: the panel MUST surface them and MUST disable silent transfer while present.
6. **Cross-Facility coordination MUST key on callsign plus beacon code, never on an internal record ID.** Computer IDs are intrafacility only; interfacility point outs use beacon codes only where an agreement permits.
7. `AIT` and prearranged coordination are **configuration, not defaults**. Both require a written directive in the real system.

#### 4.6.1 Data forwarding obligations — timed, and worth building

| Obligation | Rule |
|---|---|
| Advance forwarding | at least **15 minutes** before the aircraft is estimated to enter the receiving Facility's area, unless the agreement specifies otherwise |
| ETA revision | forward only when differing by **more than 3 minutes** |
| Amendment inside 30 min of proposed departure | MUST be coordinated **verbally AND by automated means** |
| Data-only facility on a transfer notification | manual coordination **plus verification within 3 minutes of the transfer-of-control-point estimate** |

These are exactly the obligations a paper strip cannot track and an electronic panel can. Implement each as a countdown with an alert, and instrument compliance.

#### 4.6.2 Departure release across the boundary

Five states, per §3.8 plus `[Coord §2.7]`: `RELEASED` · `HOLD_FOR_RELEASE` (with mandatory delay information) · `RELEASE_TIME` (with a mandatory time check unless expressed in minutes) · `EDCT` (**±5 min**, ground stop overrides) · `CALL_FOR_RELEASE` (**−2 / +1 min**).

**At a tower-served field the release travels controller-to-controller — `CTR` → `APP` → `TWR`. The pilot never hears "released."**

The agreement normally converts the per-flight call into a **standing release** for a named envelope — a stereo route, at or below an altitude, within a radius. Model standing releases as facility configuration; anything outside the envelope falls back to a per-flight `OPERATIONAL_REQUEST`.

#### 4.6.3 `TOFI` — the tactical boundary

`TRANSFER_OF_FLIGHT_INFORMATION` is a two-step exchange with an MRU, performed **before entry and again before exit**, followed by a separate transfer of communications.

The panel MUST model three independent fields, because none of them is derivable from the others `[Coord §3.2, §3.3]`:

```
flight.ifr_active            bool
flight.radar_service         ACTIVE | TERMINATED
flight.separation_regime     ATC | MARSA | USING_AGENCY | DUE_REGARD | SEE_AND_AVOID
```

1. **`separation_regime` MUST NOT be derived from airspace type.** Three internal regimes exist and the governing agreement picks one — including the case where ATC continues to separate inside the airspace.
2. **The Strip stays live and posted throughout tactical control.** The flight retains its IFR clearance, keeps its ATC-assigned beacon code, and ATC must still separate nonparticipating traffic from it. Dropping the Strip breaks all three.
3. **Exit is the safety-critical direction.** ATC separation MUST be re-established **before** the aircraft leaves the protected block, not after.
4. **Radar-out at the MRU is a distinct displayable state** that usually forces early airspace return.
5. `DUE_REGARD` and `MARSA` are **mutually exclusive**. Under MARSA the flight remains in the ATC system; under due regard it has left it and self-separates.

#### 4.6.4 Airspace ownership is a direction

```
airspace.owner ∈ { CONTROLLING_AGENCY, USING_AGENCY }
```

**Never a bare `released` boolean** — the word is used in both directions in the source material: released *to the using agency* means active, released *to the controlling agency* means available. Store the direction.

Two naming traps to avoid in the schema:

- **"Controlling agency" means the FAA/civil facility**, the opposite kind of entity from the tactical "controlling unit". Keep the namespaces apart.
- **Joint doctrine's "positive control"** means identify-track-and-direct; it is not the FAA's positive control and **does not imply separation service**.
- **"Hot" and "cold" are not defined terms** in any FAA or DoD publication reached. Internal state names MUST use *scheduled / active / released / returned*; "hot/cold" is display sugar only.

### 4.7 `SFA` inverts the frequency model

Single Frequency Approach exists so a single-piloted jet does not change frequency during an approach. Instead, **controllers rotate onto the aircraft's frequency**. The radar approach controller *"retains jurisdiction over the rotation of three frequencies between himself and the GCA controller"*, from a pool of **at least five discrete UHF frequencies** `[Coord §4.7]`.

**If the panel models "ownership transfer = frequency change", `SFA` breaks it.** Implement `SFA` ownership transfer as a controller-side rotation over a frequency pool, with `APP` holding rotation jurisdiction. The frequency is an attribute of the Strip; the controller is what moves.

### 4.8 Position occupancy, combination and handover

Fixed by the project owner: **a controller's Positions are derived from which radar stations they have selected**, several controllers may hold the same station with one acting as Primary, and **selection changes mid-session with automatic handover**. Combination across Facilities is normal — one person may be `CTR` and `TAC_C2` simultaneously — and under low manning it is the usual case, not the exception.

Saab's product describes the general capability: *"roles can be combined or split in real-time based on workload"* `[Annex §4]`. What follows is how to do that without losing the doctrine.

#### 4.8.1 Ownership is per-Position, and that makes handover nearly free

`Strip.ownerPositionId` (§3.1) names a **Position**, never a person. This was the right choice for reasons that only now become obvious:

> **On a handover, Strips do not move at all. Only the Position→Primary mapping changes.**

A controller dropping `TAC_C2` and another picking it up is a change to one mapping entry. Every Strip keeps its `ownerPositionId`; the new Primary simply resolves to them. There is no bulk transfer, no re-parenting, and no window in which a Strip is owned by nobody.

**The only case that involves a real move is when a Position becomes unoccupied and nobody replaces it** — see §4.8.4.

Every Mutation MUST additionally record **the Position the controller was acting as**, not merely their identity:

```
Mutation { …, actingPositionId, actorId }
```

Without this the audit log cannot answer "who was separating whom", and de-combination cannot be reasoned about after the fact. A controller holding four Positions produces four distinguishable streams in the log, not one.

#### 4.8.2 Primary and Observer

| Role | May act | Sees |
|---|---|---|
| **Primary** | yes — owns the Position's Strips | the Position's Bays, editable |
| **Observer** | no | the same Bays, read-only, visibly marked |

Rules:

1. **Exactly one Primary per Position at any instant.** Two Primaries is defect class **D18**.
2. Selecting a station whose Position has no Primary makes the selector Primary.
3. Selecting a station whose Position already has a Primary makes the selector an **Observer**. An Observer MAY request Primary; the request is delivered to the current Primary and requires their release. An unanswered request MUST NOT auto-promote.
4. **Every Strip MUST render its owning Position at all times**, and an Observer's view MUST be unmistakably read-only — not merely disabled controls, but a visible state. A controller who believes they are working an aircraft they cannot act on is the worst outcome here.
5. Primary status is presence state (§5.7): ephemeral, leased, heartbeat-renewed, and **it MUST NOT enter the durable Mutation log**. What enters the log is `actingPositionId` on each Mutation.

#### 4.8.3 Combination collapses the coordination, never the state transition

**This is the load-bearing rule of the section.**

When one controller holds both sides of a boundary — `CTR` and `TAC_C2`, or `TWR` and `APP` — there is no phone call to make. It is tempting to skip the whole exchange. **Do not.**

The reason: a coordination event is two things bolted together. There is a *dialogue* between two humans, and there is a *state change* to the flight. Combination removes the first. **It does not remove the second**, because the state change is a fact about the aircraft, not about the staffing:

- when a flight enters the block, the **separation regime genuinely changes** — ATC stops separating participants, the using agency or MARSA takes over `[Coord §3.2]`;
- radar service status and IFR status may change independently of each other `[Coord §3.3]`;
- MARSA has a declaring party, a start event and auto-void conditions (§9.2) that are unaffected by who is on position;
- and if a second controller takes `TAC_C2` ten minutes later, **the state must already be correct**, or they inherit a lie.

Therefore:

1. A boundary event between two Positions held by the same controller MUST be recorded as a **self-coordination**: a single action that applies the full state change and writes a Mutation naming both Positions, the actor, and the fact that it was self-coordinated.
2. The **state change is mandatory and unconditional**. Only the two-party dialogue collapses.
3. Self-coordination MUST be **one input**. If it costs a controller three clicks to hand an aircraft from themselves to themselves, they will stop doing it, the state will drift, and §10.4's silent-staleness failure arrives by a new route.
4. The Mutation log MUST distinguish self-coordinated from two-party events, so an after-action review can tell the difference.

#### 4.8.4 Combination is a union of hats, not a merge of powers

A controller holding `CTR` + `TAC_C2` holds **ATC powers as `CTR` and Military Radar Unit powers as `TAC_C2`**. They do not acquire the power to provide ATC service from the MRU hat.

> **Permissions MUST be evaluated per acting Position, never as the union of the held set.**

Concretely: attempting a `HANDOFF` on a Strip owned by `TAC_C2` MUST be refused even though the same person holds `CTR`, because ¶8-1-1 forbids an MRU from being asked to provide ATC service (§4.1, §4.6). Implementing combination as a permission union is the most likely way to reintroduce defect **D12**, and it will look correct in every demo.

The same applies to Facilities. **Combination does not merge Facilities.** Holding `CTR` and `TAC_C2` does not collapse the `CENTER` and `TACTICAL` Facilities into one, does not merge their Strip replicas, and does not turn a cross-Facility forwarding into a strip move (§4.6). The controller works two Boards; the Boards remain two.

#### 4.8.5 Live recomposition

Because the Position set changes during a session, Bay composition is **reactive state, not startup configuration**:

1. The station→Position mapping is facility configuration (§8.2). Selecting a station grants its Positions; deselecting revokes them.
2. On any change, the Bay set recomposes live. Bays MUST stay **grouped by Position**, never merged into one undifferentiated pile — a Strip belongs to its Position's Bay, and a controller holding six Positions needs to know which hat each Strip is under. With many Positions held, the vStrips model earns its keep: one Bay in view, the rest reachable through header drop zones `[Annex §15.1]`.
3. Recomposition MUST NOT disturb an in-progress drag, an open annotation cell, or scroll position in Bays the controller retains.
4. Losing a Position MUST NOT close the panel or reset the view. It removes that Position's Bays and nothing else.

#### 4.8.6 Vacating a Position — the case that must not strand Strips

When a controller deselects a station or disconnects:

1. If another controller is an **Observer** on that Position, they are offered Primary. Promotion is explicit — a prompt, not a silent transfer — **except** on an abrupt disconnect, where the longest-waiting Observer is auto-promoted and told so.
2. If **no controller holds the Position**, its Strips MUST route to the **covering Position** named in facility configuration (§8.2), and the UI MUST say what happened and where they went. The default covering chain: `CD`→`GND`→`TWR`→`APP`→`CTR`; `AIC`/`GCI`→`TAC_C2`→`CTR`; `CV_APP*`→`CV_MARSHAL`→`CV_PRIFLY`; `RSU`→`TWR`; `SFA`/`PAR`→`APP`.
3. If the covering Position is also unoccupied, follow the chain to the end. **A Strip MUST NOT be left owned by an unoccupied Position with no covering path.** That is defect class **D19**.
4. Vacating with delegated airspace held is a special case: when `APP` becomes unoccupied, its delegated airspace reverts to `CTR` (§4.1), and the reversion MUST be rendered rather than merely implied.
5. **A controller MUST be warned before deselecting a station that would strand Strips**, with the count and destination shown. Warn, do not block — under low manning, blocking a controller from leaving is worse than the stranding.

#### 4.8.7 Instrumentation

Add to the §11.5 metric set:

| Metric | Why | Target |
|---|---|---|
| Positions held per controller, over time | the low-manning reality this design serves | observed, not targeted |
| Self-coordination events, as a share of all boundary events | tells you how often combination is active, and whether §4.8.3 clause 3 is being obeyed | self-coord ≈ combined-position share |
| Handovers completed without a stranded Strip | §4.8.6 | 100% |
| Time a Position spends unoccupied while holding Strips | the covering chain working, or not | trending to zero |

---

## 5. Data and protocol

### 5.1 Schema and transports

1. Define all EFSP messages **once in protobuf**, in `proto/efsp/v1/`.
2. Use **gRPC for service-to-service** traffic (flight data ingest, ATO ingest, persistence).
3. Use **WebSocket for browser↔server**. Do not attempt gRPC-Web for the browser leg: browsers cannot do client-streaming or bidirectional streaming over gRPC-Web `[Annex §15.7]`, and the Board needs a bidirectional channel.
4. On the WebSocket leg, frames MUST be protobuf-encoded. A JSON-encoded protobuf mode MAY be enabled behind a development flag for debuggability.
5. **Version-negotiate on connect.** VRC's precedent is instructive: strip annotation sync was version-gated so old clients degraded rather than corrupted `[Annex §15.2]`. The server MUST reject or downgrade a client whose protocol version it does not support, and MUST NOT accept Mutations it cannot fully interpret.

### 5.2 Mutations, not state

Clients send **intents**. They MUST NOT send resulting state.

```
Mutation {
  clientMutationId  string    // client-assigned UUID, for idempotency
  stripId           string
  baseRev           uint64
  op                oneof { MoveStrip, SetBlock, TransferStrip, SetFlag,
                            SetState, InvokeNla, DropStrip, CreateStrip, … }
}
```

Reasons: intents are small, replayable, idempotency-checkable, and auditable. Given the domain, **the append-only Mutation log doubles as the incident-review record** — which is the electronic descendant of the requirement that control instructions not captured on voice recording MUST be documented on the strip `[Annex §9]`.

### 5.3 Optimistic concurrency

1. The server accepts a Mutation only if `baseRev == strip.rev`. On success `rev++` and broadcast. This is the ETag / `If-Match` pattern.
2. On mismatch the server MUST reject and **return the current Strip** so the client can rebase or surface the conflict.
3. **A rejected Mutation MUST be surfaced to the controller.** It MUST NOT be silently dropped, silently retried, or silently merged. In ATC a silently discarded amendment is the worst available failure mode.
4. Field-level last-writer-wins applies *within* a Strip so two controllers annotating different Blocks do not collide. Strip-level `rev` still governs moves, which are inherently whole-Strip.

### 5.4 Ordering

Use **fractional-index / LexoRank-style `orderKey` strings**, not integer positions.

Two controllers inserting at the same slot generate different keys and both survive, with no renumbering broadcast and no O(n) reindex. For a drag-reorderable shared list this is the single highest-leverage structural choice `[Annex §15.7]`.

Rebalancing MUST be a server-side operation, broadcast as a single Board event, and MUST NOT run during an active drag on any connected client.

### 5.5 Do not use a CRDT

**MUST NOT.** Reasons, in order of weight:

1. **Convergence is not the goal; correctness is.** A CRDT guarantees replicas agree. It does not guarantee they agree on something operationally safe. Two controllers concurrently assigning different runways must be **rejected and surfaced**, not silently merged. Optimistic concurrency gives that rejection point; CRDTs deliberately remove it.
2. **Ownership is the real-world model.** In every prior-art system a Strip belongs to one Position and transfer is explicit `[Annex §15]`. Encoding that eliminates most conflicts before they occur.
3. The conflict domain is a small structured record — roughly fifteen scalar fields plus a position — not rich text. CRDT metadata growth, tombstones and debuggability costs buy offline convergence the EFSP does not want.

### 5.6 Reconnection and resync

1. Every broadcast carries a **monotonic Board sequence number**.
2. On reconnect the client sends its last-seen sequence. The server either **replays the delta** from a bounded ring buffer, or responds `TOO_OLD` and sends a **full Board snapshot**. **Two paths only.** No partial-repair path, which is the one that gets subtly wrong.
3. The client then replays unacknowledged Mutations against the new baseline, and **surfaces any that now fail their `baseRev` check**.
4. `clientMutationId` MUST make replay idempotent so an ambiguous disconnect cannot double-apply a move.
5. **Heartbeat both ways with a short timeout, and degrade the UI visibly on a stale connection.** A controller MUST never be unable to tell that the Board they are reading is frozen. Implement a persistent connection-state banner and a Board-wide visual degradation after `staleThresholdSeconds` (default 10) without a heartbeat.
6. OzStrips resyncs **layout as well as data** on reconnect `[Annex §15.5]`. Bay arrangement is shared state; treat it as such.

### 5.7 Presence

1. Server maintains a presence set per Position: controller identity, connection state, last heartbeat.
2. Each Strip renders its Owner Position at all times, and a transient "being edited by X" indicator while another client holds an annotation cell open.
3. Editing locks MUST be **soft, leased and auto-expiring** (10–30 s, heartbeat-renewed). A hard lock strands a Strip when a client dies.
4. Presence is ephemeral and MUST NOT enter the durable Mutation log.

---

## 6. Strip anatomy and the Block Map

### 6.1 Keep FAA block numbering

Block IDs MUST follow the FAA scheme, including letter sub-blocks, exactly as TFDM does `[Annex §2]`. Reason: it makes the panel, the wiki, and any real-world reference material mutually legible, and it makes the doctrine tables in the Research Annex directly usable as test fixtures.

Military extensions occupy a **separate namespace `M1`…`Mn`** and MUST NOT be numbered into the FAA range.

### 6.2 Departure Block Map — implement as specified

Taken from FAA Order JO 7210.637 Figure 1 `[Annex §2.1]`. Blocks marked ✱ are required in the real system.

| Block | Field | Notes for implementation |
|---|---|---|
| 1 ✱ | Aircraft identification | ≤7 alphanumeric |
| 2 ✱ | Revision number | amendment counter, system-maintained |
| 2A | Voice Clearance Issued checkbox | pairs with 4B |
| 3 ✱ | Count if >1, wake indicator, type, equipment suffix | formation renders here |
| 4 ✱ | Computer identification number | |
| 4A | Remove Strip Indicator | distinct from delete — §3.4 |
| 4B ✱ | Datalink Clearance Indicator | TFDM's TDLS indicator; SOURCE equivalent is the DCS datalink/kneeboard path |
| 5 ✱ | Beacon code assigned | system-assigned only — §3.2 |
| 6 ✱ | Proposed departure time (P-Time) | |
| 7 ✱ | Requested altitude | |
| 8 ✱ | Departure airport, first fix or departure transition area | |
| 8A ✱ | Departure runway | drives Rack placement in `TWR` |
| 8B ✱ | Destination airport | |
| 9 ✱ | Route and destination (computer-generated); altitude restrictions in order flown (manual) | mixed provenance in one Block — render both |
| 9A–9C | facility use | adaptation layer |
| 9D ✱ | Full Route Clearance checkbox | |
| 9E ✱ | Remarks (computer-generated) | |
| 10 ✱ | ATIS code | drives the ATIS-update alert, §7.7 |
| 11 ✱ | Approval Request (APREQ) | |
| 14 ✱ | Release time | maps to §3.8 `RELEASE_TIME` |
| 16 | Movement-area entry time | metering only — deferred, §12 |
| 17 | Taxi time | |
| 18 ✱ | Takeoff time | |
| 19 | Gate / parking | |
| 20 | Heading | |
| 21 | Initial altitude | |
| 22 | Frequency | |
| 23 | Facility remarks | free text — keep it, §3.9 |
| 24 ✱ | Miles/minutes-in-trail remarks | |
| **25 ✱** | **EFSP State** | §3.4 |
| **26 ✱** | **Next Logical Action** | §3.5 |

**Do not collapse the four time constraints.** Blocks 6 (proposed), 11 (approval request), 14 (release) and 16 (movement-area entry) are different concepts occupying different blocks in the real system `[Annex §2.5]`.

### 6.3 Arrival and Overflight Block Maps

Per `[Annex §2.2, §2.3]`. Two implementation notes:

1. Block 9A on the arrival strip carries minimum fuel, destination, point-out, radar vector and speed adjustment. **Facility configuration MAY omit any of these except minimum fuel** — that exception is doctrinal and MUST be enforced by the adaptation layer validator.
2. Arrival and overflight Blocks 20/21 surface the radar-automation scratchpads. In the SOURCE system these bind to the CRC track scratchpads, not to Strip-local storage.

### 6.4 Military extension Blocks `[SOURCE-DEFINED]`

Every field below has a real-world basis cited in the Annex; the *block numbering* is ours.

| Block | Field | Basis |
|---|---|---|
| M1 | Mission number | ATO `AMSNDAT` `[Annex §14.3]` |
| M2 | Package ID | ATO `9PKGDAT` |
| M3 | Mission type (primary / secondary) | ATO `AMSNDAT` |
| M4 | IFF Mode 1 / Mode 2 | ATO `MSNACFT` |
| M5 | Datalink code | ATO `MSNACFT` |
| M6 | Vul window (start / stop) | ATO `AMSNLOC`, `7CONTROL` |
| M7 | Controlling agency + frequency | ATO `CONTROLA` — `AWAC` / `CRC` / `OTR` |
| M8 | MARSA reference | §9.2 |
| M9 | ALTRV reference | §9.3 |
| M10 | MTR designator / entry fix / entry time | §9.4 |
| M11 | MTR exit fix / exit estimate / requested altitude after exit | §9.4 — the two items a controller asks for by voice |
| M12 | AR track / anchor, ARCP, ARCT, tanker callsign, offload | ATO `ARINFO` / `5REFUEL` `[Annex §13.5]` |
| M13 | Standard conventional load (SCL) | ATO configuration codes |
| M14 | Ordnance state: `CLEAN` / `LOADED` / `HUNG` / `EXPENDED` | §9.5 |
| M15 | Hook / arresting-gear requirement | §9.7 |
| M16 | Alert status: `NONE` / `ALERT` / `SCRAMBLE` | §9.6 |
| M17 | Fuel state / playtime remaining | DD-175 carries fuel as endurance `[Annex §12]` |
| M18 | Stereo route name (e.g. "PACK 1") | §9.9 |
| M19 | Release authority | DD-175 item 20 — no civil analogue |
| M20 | Unit / home station / tail number | DD-175 item 19 |

### 6.5 The strip template — build it data-driven

**The Block Map MUST be data, not code.** Adopt the EuroScope TAG abstraction: a Strip is an ordered set of typed items, each with a data binding and an action pair, laid out by an editable template `[Annex §15.4]`.

```jsonc
{
  "role": "DEPARTURE",
  "rows": [
    { "cells": [
      { "block": "1",  "type": "text",     "bind": "fdr.identity.callsign",
        "width": 9, "style": "callsign",
        "leftAction": "selectStrip", "rightAction": "stripMenu" },
      { "block": "3",  "type": "composite","bind": "fdr.identity",
        "format": "{flightSize>1?flightSize:''}{wakeCat}/{type}/{suffix}" },
      { "block": "5",  "type": "beacon",   "bind": "fdr.identity.beaconCode",
        "editable": false },
      { "block": "25", "type": "state",    "bind": "strip.state" },
      { "block": "26", "type": "nla",      "bind": "computed.nla" }
    ]}
  ]
}
```

This buys per-facility layouts without forking components, and makes "click to cycle a value" a declarative property rather than bespoke code per field. It is also the only sane way to support the milsim extension Blocks alongside the civil ones.

### 6.6 Strip↔track correlation — budget for the defect class explicitly

**Measured in the real prototype:** 100% of Strip selections whose targets existed on the surveillance display highlighted in under 1 second, but only **85–90% of Strips matched a surveillance target**, largely because *"entity id changes are not picked up on the FDM but are propagated to the TIDS"* `[Annex §6]`.

**Identity reconciliation between the flight-data domain and the track domain is a named, measured defect class. Treat it as a first-class subsystem, not a join.**

Requirements:

1. Correlation keys, in priority order: explicit controller binding → Mode 3/A beacon code → callsign exact match → callsign fuzzy match (flagged as provisional).
2. `TrackRef` MUST tolerate the underlying track identity changing. Store the correlation as its own record with its own history; do not store a raw track ID on the FDR.
3. **A track identity change MUST NOT silently break the binding.** It MUST either re-bind on the beacon code or raise an uncorrelated warning on the Strip.
4. Selecting a Strip MUST highlight its track within 1 second (the measured real-world benchmark), and vice versa.
5. Render correlation state on the Strip: `CORRELATED`, `PROVISIONAL`, `UNCORRELATED`. EuroScope keys its whole tag-type system to correlation state `[Annex §15.4]`; that is the right instinct.
6. **Instrument the correlation rate.** If it drops below 95% in operation, that is a defect, not a fact of life.

---

## 7. User interface

### 7.1 Input model

1. **Primary input is pointer-based and MUST work identically for mouse, touch and stylus.** Build on **Pointer Events** with `setPointerCapture()`. **MUST NOT use the HTML5 Drag and Drop API** — no touch support, unstyleable drag image, browser-scheduled `dragover` `[Annex §15.7]`.
2. `touch-action: none` MUST be set on drag handles. Omitting it is the single most common cause of "drag works on desktop, not on the tablet".
3. **Noun-verb command structure**: select the object, then the action. This is the FAA's own documented convention and rationale `[Annex §5]`.
4. **Local-control interactions MUST be completable by touch alone.** Measured: local controllers used touch for 86.6% of interactions versus 61.8% at ground, because they edit less and must stay heads-up `[Annex §5]`. Ground and clearance positions MUST have an efficient keyboard path for data entry.
5. **A dot-command surface is a primary feature, not a power-user extra.** Every mature prior-art client is command-driven `[Annex §15.6]`. Implement a persistent single-line input accepting `.verb args`, with a **preview/echo area before commit**.

### 7.2 Drag rendering

1. Use a **single insertion line**, not live list reflow. VRC draws *"a blue line in the strip bay at the point where the strip will be placed"* `[Annex §15.2]`. This is both operationally legible and the cheapest thing to render: one absolutely-positioned element moving, versus N strips animating layout.
2. **MUST NOT** animate list reflow or run FLIP animations during a drag on an operational Board. It costs layout on every pointermove and makes the Board visually unstable while the controller is reading it.
3. The dragged Strip MUST be **semi-transparent while moving** so it does not obscure what is underneath — this is deployed TFDM behaviour `[Annex §5]`.
4. The dragged element MUST live in its own compositor layer (`position: fixed` + `transform: translate3d()` + `will-change: transform`) and be driven by `transform` only, never `top`/`left`.
5. Insertion index MUST be computed from rects cached at `pointerdown`, never from `getBoundingClientRect()` per move.
6. Strip move animations MUST NOT exceed 120 ms.

### 7.3 The paper gestures — and the cost ceiling on each

The prototype implemented these and controllers asked for two of them explicitly after the first evaluation `[Annex §5]`:

| Gesture | Implementation | Cost ceiling |
|---|---|---|
| Cock / offset | `offset` flag — visual indent plus a status icon | **1 input** |
| Flip | hides all Blocks except aircraft ID | **1 input** |
| Highlight | yellow background on one Block | **1 input** |
| Attention mark | red text on one Block | **1 input** |

**The cost ceiling is normative.** The measured complaint about the real prototype was not that these were missing but that they *"required too many FDM inputs to achieve the desired state"* `[Annex §5]`. A paper strip is cocked in one motion. If the electronic equivalent costs three taps, the affordance is lost. Any of the four exceeding one input at the primary interaction point is a defect.

### 7.4 Annotation entry

1. `Tab` cycles annotation cells within a Strip, `Shift+Tab` backwards. `Tab` MUST NOT escape to browser chrome mid-edit; trap focus per Strip while editing `[Annex §15.4]`.
2. `Enter` commits, `Esc` cancels and reverts. **No auto-commit on blur** (§3.7).
3. Single-keystroke insertion for the marks controllers actually use: ✓, ✗, ↑, ↓, strike. vStrips binds a checkmark to `Shift+/` `[Annex §15.1]`.
4. Constrained-value Blocks (state, runway, ordnance state) MUST offer a tap-to-cycle or keypad, not free text.

### 7.5 Rendering rules

1. **DOM, not canvas**, for the Strip panel. Strips are text-dense, need text entry, focus and accessibility, and number in the tens. Reserve WebGL for the map. Keep the panel and the map as separate components over shared state — the same split real systems use, and the split vNAS uses between its radar client and its strip application `[Annex §15.3]`.
2. **Do not virtualise in v1.** A Bay is tens of Strips. Virtualisation breaks drop targets, browser find and screen-reader traversal, and introduces measurement bugs under exactly the rapid-update conditions the Board lives in. Partition by Bay and Rack instead. Revisit only on measurement.
3. Batch incoming WebSocket updates into a **single `requestAnimationFrame` commit**. A burst of 50 Strip updates MUST cause one paint.
4. Key Strips by stable server ID so a reorder is a move, not a destroy-and-recreate.
5. Apply `contain: layout style paint` per Strip so one Strip's text change cannot invalidate the Bay's layout.
6. Never read geometry in the same frame you write styles.
7. Provenance (§3.1) MUST be visually distinguishable — computer-generated versus controller-entered. The real block map marks this distinction explicitly `[Annex §2.5]`.

### 7.6 Physical sizing and typography

1. **Resolution scaling MUST hold physical Strip size constant across monitors.** Deployed TFDM adjusts resolution scale so a Strip is the same physical size on a larger or higher-resolution display `[Annex §5]`. Do not let Strips shrink on a bigger panel.
2. Two Strip sizes MUST be offered: standard (paper-like) and condensed `[Annex §5]`.
3. Reference geometry from the FAA's own prototype: elements ≈ 13 mm high × 100 mm wide `[Annex §5]`. Use as a starting point, not a constraint.
4. **Touch targets MUST be ≥ 44×44 CSS px.** WCAG 2.2 SC 2.5.8 sets 24×24 as a floor; a controller tapping under time pressure on an angled display needs the ergonomic target, not the compliance minimum. Inflate hit areas with padding beyond the painted box where the visual must stay small `[Annex §15.7]`.
5. **Monospace is functional, not stylistic.** Callsigns, squawks, levels and times are fixed-width tokens scanned *positionally* down a Rack. Use a monospace with unambiguous `0/O`, `1/l/I`, `5/S`, `8/B`, and `font-variant-numeric: tabular-nums` in any non-mono text.

### 7.7 Colour and alerting

1. **Colour MUST be configurable, not hard-coded.** TFDM's colours are site-adaptable, and "colours not being exactly right" was a specific, recorded field complaint during deployment `[Annex §5, §6]`.
2. **Colour MUST NOT be the only channel.** Encode state redundantly: Bay position, border treatment, *and* colour. Target ≥ 7:1 contrast for primary Strip text — the Board is read at distance and off-axis.
3. Do not use pure black; use a dark desaturated ground. Pure `#000`/`#fff` maximises halation on emissive displays in a dark room.
4. **Reserve saturated colour for exceptions.** If every Strip is coloured, nothing is. OzStrips' model — alert on incorrect SSR code and incorrect cruising level — is the right one `[Annex §15.5]`.
5. **Alert prominence is a recorded real-world defect.** Controllers reported TFDM's yellow ground-stop alerts as insufficiently prominent versus the red used previously `[Annex §9]`. Alert severity MUST be configurable per alert type, and the default for any operation-blocking condition MUST be the highest tier.
6. ATIS-update indication: the FAA prototype used a **yellow/white 1.5 s flash cycle for 15 s total** `[Annex §5]`. Adopt as the default, configurable.

### 7.8 Accessibility

1. **Every drag operation MUST have a single-pointer alternative that does not require dragging.** WCAG 2.2 SC 2.5.7. A drag-only strip bay fails AA `[Annex §15.7]`. Implement click-to-select then click-to-place, plus a context-menu "move to Bay *n*", plus a keyboard command. The same mechanism satisfies the keyboard requirement in §7.1.
2. Bays get `role="list"` semantics with Strips as items, and an `aria-live="polite"` region announcing moves.
3. Focus MUST survive a remote reorder — re-focus by Strip ID after re-render, never by DOM index.

### 7.9 Latency budget

| Path | Budget |
|---|---|
| Local input → visual feedback | **< 50 ms**, optimistic, never waiting on the server |
| Remote change → visible | **< 200 ms** |
| Strip selection → track highlight | **< 1 s** (the measured real-world benchmark, §6.6) |

No UI transition may be gated on a round trip. Transfer is the sole exception (§4.5.4), and it renders an intermediate state rather than blocking.

### 7.10 The `FINAL` Strip — minimal by requirement

`PAR` and the carrier Final controller are the same job: continuous talk-down at a fixed cadence, terminating on the same kind of event. Precision-approach transmissions occur **approximately every 5 seconds**, with a required call at least once per mile, at glidepath interception, at decision altitude, and on trend deviation `[Coord §4.7]`.

**This is the only Position in the set where the controller is transmitting continuously.** The `FINAL` Strip MUST therefore be minimal and glanceable — runway, decision altitude, distance to touchdown, missed approach — and MUST NOT require any data entry during the approach. A `FINAL` Bay holds one Strip at a time.

Build **one shared component** for `PAR` and the carrier Final lane. Same cadence, same terminal event, same attention budget.

---

## 8. Facility adaptation layer

### 8.1 Why this exists

FAA doctrine states plainly that **"national standardization of items (10 through 18) is not practical because of regional and local variations in operating methods"** `[Annex §9]`. TFDM's own order requires local adaptation to be supported. In the real programme, a joint FAA/NATCA Adaptation Team designs the bays for each position at each facility, capturing existing local strip-marking practice `[Annex §4]`.

**The configurability is the specification.** A hard-coded strip layout is non-conforming.

### 8.2 What MUST be configurable

| Domain | Configurable |
|---|---|
| Strip layout | Block Map per Strip Role: visibility, required/optional, label, format, actions (§6.5) |
| Bays | Bay set per Position; Racks per Bay; sort keys; partition rules |
| Runways | Runway list; Rack-per-runway mapping; arresting-gear configuration (§9.7) |
| Colours | Full palette, per state and per alert tier |
| Alerts | Which conditions alert, at which severity |
| Routes | Stereo/canned route table (§9.9) |
| Positions | Position set and permitted combinations |
| Transfer | Routing table for unmanned Positions |

### 8.3 Configuration validation

Facility configuration MUST be validated on load, and the validator MUST enforce the doctrinal exceptions, not merely schema shape. At minimum:

1. Every Block marked required in §6.2/§6.3 MUST be present and visible.
2. Arrival Block 9A MUST retain minimum fuel even where other components are omitted (§6.3).
3. Every Position in the Bay set MUST exist in the Position set.
4. Every NLA target state MUST be reachable.
5. Local symbology defined in configuration MUST be marked local-only and MUST NOT appear in any inter-facility message — this is an explicit doctrinal prohibition `[Annex §9]`.

### 8.4 Configuration is versioned and audited

Configuration changes MUST be versioned, attributed, and recorded. A live Board MUST NOT be mutated by a configuration change without an explicit reload step; silent re-layout under a working controller is a defect.

### 8.5 Flight plan validation surfaced on the Strip

OzStrips surfaces alerts for incorrect SSR codes and cruising levels on the Strip itself `[Annex §15.5]`. Adopt this. Validation results MUST render on the Strip, not in a separate panel — a validation error the controller has to go looking for is not a validation.

---

## 9. The military layer

This section is what distinguishes the EFSP from a civil TFDM clone. Every field has a real-world basis; the modelling decisions are ours.

### 9.1 The scope lesson

Both verified military electronic-strip systems — Frequentis at Vance AFB (2009) and Northrop Grumman REFS at Sheppard AFB (2010) — span **tower + RAPCON + base operations + emergency response**, not tower alone `[Annex §11]`. The Navy's VIDS is likewise an **aggregator**: strips plus flight-data feed plus wind, altimeter, airfield lighting, ATIS, weather, cameras, and automated position logs `[Annex §10]`.

**Design consequence:** the EFSP is not a tower strip bay with military fields bolted on. It is a base-wide flight-data surface. `OPS` (AMOPS) is a first-class Position for this reason, and the field-state model (§9.7) is a peer of the Strip model, not a subsidiary of it.

### 9.2 MARSA — model it as an edge, not a flag

MARSA is a **stateful relationship between two or more Strips**, with a declaring party, a start event, an end event, and auto-void conditions `[Annex §13.1]`.

```
MarsaRelation {
  marsaId
  declaringCallsign     string
  participants          [ fdrId ]
  startedAt             timestamp
  startEvent            TANKER_ACCEPTED | MTR_ENTRY | LOCAL_DECLARATION
  endCondition          VERTICALLY_POSITIONED | MTR_COMPLETE | ATC_SEPARATION_ESTABLISHED
  voidedBy              CONTROLLER_COURSE_CHANGE | CONTROLLER_ALTITUDE_CHANGE | MANUAL | null
  endedAt               timestamp?
}
```

Verified rules that MUST be implemented:

1. **Aerial refueling:** MARSA begins when tanker and receiver have entered the AR airspace **and the tanker advises ATC it is accepting MARSA**. It ends when **the tanker advises ATC** that tanker and receivers are vertically positioned within the airspace. The declaration is the tanker's, and it is verbal — the EFSP records it, it does not decide it.
2. **The interlock:** issuing a course or altitude change prior to rendezvous **automatically voids MARSA**. Implement this: any `SetBlock` on assigned heading or altitude for a participant before the rendezvous event MUST void the relation, set `voidedBy`, and alert every participant Strip. This is the highest-value single military interlock available.
3. **MTRs:** for designated MARSA routes, the military assumes separation from the primary or alternate entry fix until ATC re-establishes separation after route operations complete.
4. **Flight-plan level:** `STS/MARSA` in ICAO Item 18 is the field through which MARSA enters the civil record. Ingest and emit it.
5. UI: MARSA MUST render on **every** participant Strip, with the relation visible as a link — selecting one participant MUST highlight the others.
6. Use the Pilot/Controller Glossary expansion in UI text: **"Military Authority Assumes Responsibility for Separation of Aircraft."**

### 9.3 ALTRV

Implement `MOVING` and `STATIONARY` ALTRV types, an approval record, and the **AVANA** ("Aircraft Void if Not Airborne") time — typically one hour — as a hard deadline the Board tracks and alerts on `[Annex §13.2]`.

The **ALTRV APREQ message format (Items A–G)** maps cleanly onto a request form and is reproduced in `[Annex §13.2]`. Implement the form; `FL240B260` block-altitude notation and the `ADMIS` / `FRMN` / `MITO` interval codes are exactly the details that read as authentic to a milsim audience.

**[GAP]** How APVLs are ingested into real automation as flight data was not established. Model the SOURCE ingest path explicitly as `[SOURCE-DEFINED]`.

### 9.4 Military Training Routes

Fields per §6.4 M10/M11. The two that matter operationally are **exit fix estimate** and **requested altitude after exit** — these are precisely what a controller asks for by voice and must post `[Annex §13.4]`.

Lost-comms rule to implement as an advisory: separate assuming the aircraft maintains **the higher of** the minimum IFR altitude for each remaining segment **or** the highest altitude in the last clearance.

### 9.5 Ordnance state

`M14` ∈ `{CLEAN, LOADED, HUNG, EXPENDED}`.

`HUNG` MUST propagate to field state: verified local practice is that hung ordnance influences **runway selection** — Kunsan selects the runway that minimises taxi distance to the hot cargo pad, weather permitting `[Annex §13.8]`. Implement as an advisory on runway assignment plus a routing constraint toward the designated hazardous-cargo parking area.

### 9.6 Alert and scramble

`M16` ∈ `{NONE, ALERT, SCRAMBLE}`.

**Alert status is a ground-movement constraint at least as much as an air constraint** `[Annex §13.7]`. Verified local rules: taxiing aircraft yield to alert scrambles; aircraft must not block runway access from the alert pad; a specific taxiway is kept clear for alert scrambles.

Implement: a `SCRAMBLE` Strip MUST raise a Board-wide priority indication, and MUST mark the configured alert-pad access route as constrained, with any conflicting taxi Strip flagged.

**[GAP] Do not implement a scramble/interceptor priority *ordering* from this guide.** FAA JO 7110.65 §2-1-4 (Operational Priority) and §9-2-7 (Interceptor Operations) were not read `[Annex §13.7]`. Read them before writing priority logic; until then, `SCRAMBLE` raises an indication and the controller decides.

### 9.7 Field state — the arresting-gear model

This is the highest-value military-specific feature in the guide, and it has no civil equivalent.

Verified: arresting-gear configuration is a **field state that gates runway availability**, and changing it **suspends runway operations pending a post-configuration inspection**. Barrier Maintenance notifies AMOPS and the tower before reconfiguration; operations resume only after AMOPS performs the inspection `[Annex §13.8]`.

```
FieldState {
  runways [ Runway {
      id
      status          OPEN | CLOSED | SUSPENDED_BARRIER_CHANGE | SUSPENDED_INSPECTION
      arrestingGear [ Gear { type: BAK_12 | E_5 | OTHER,
                             position: APPROACH_END | DEPARTURE_END | OVERRUN,
                             distanceFt, state: UP | DOWN | OUT_OF_SERVICE } ]
  } ]
  hotCargoPad     { occupied, occupantFdrId? }
  alertPad        { occupied, occupantFdrId? }
  runwayChangeInProgress  bool
}
```

Rules:

1. A runway in `SUSPENDED_*` MUST inhibit takeoff and landing NLA on every Strip assigned to it, with the reason rendered.
2. Resumption MUST require an explicit inspection-complete action attributable to a Position — by default `OPS` (AMOPS) `[Annex §13.8]`.
3. A **runway change MUST require coordination with `OPS` and `APP`** before it can be initiated. The verified real-world rule is that the tower coordinates with the Supervisor of Flying and the RAPCON; SOURCE has no separate SOF Position, so `OPS` carries that role. Implement as a coordination workflow with acknowledgements, not a dropdown.
4. Aircraft with `M15` hook requirement MUST be checked against gear state on approach; a mismatch alerts.
5. Field state changes MUST broadcast on the Board sequence like any other Mutation and MUST appear in the audit log.

### 9.8 The tactical Position and the ATO mission line

`TAC_C2` works **mission lines**, not clearance strips. The distinction is real and structural `[Annex §14.5]`:

| | ATC Strip | Mission line |
|---|---|---|
| Keyed by | callsign, beacon code | **mission number**, package ID, callsign |
| Time model | clearance events, ETAs over fixes | **vul / on-station window**, TOT |
| Identity | Mode 3/A | **Mode 1 / 2 / 3**, datalink code |
| Separation | ATC-provided | may be **MARSA** |
| Airspace | route, altitude, clearance limit | **ROZ / ACM from the ACO** |
| Control agency | sector / position | `CONTROLA`: AWAC / CRC / OTR |

**The bridge field is the Mode 3/A code.** It appears in the ATO's `MSNACFT` IFF/SIF fields and in the Strip's beacon Block. Everything else is joined by convention, voice or agreement.

Implement the `MISSION` Strip Role with its own Block Map drawn from the military extension namespace, and bind it to the same FDR as any tower Strip for that flight. **Joining the ATO refueling line to the ATC strip is something a milsim panel can do that a real one cannot** — do it, and make it visible.

### 9.9 ATO ingest

Ingest USMTF-style ATO sets and map them onto FDRs. Mapping per `[Annex §14.3]`:

| Set | Target |
|---|---|
| `AMSNDAT` | M1 mission number, M2 package, M3 mission type, M16 alert status, departure/recovery |
| `MSNACFT` | Identity: count, type, callsign; M4 IFF Mode 1/2; M5 datalink; M13 SCL |
| `AMSNLOC` | M6 vul window, altitude |
| `7CONTROL` | M6 on-station time, report-in point |
| `ARINFO` / `5REFUEL` / `REFTSK` | M12 AR data |
| `CONTROLA` | M7 controlling agency and frequency |
| `9PKGDAT` / `PKGCMD` | M2 package, package commander |

**Source caveat that MUST be carried into code comments:** the detailed set-level breakdown used here comes from a **DCS community wiki**, not the official specification. Set names are consistent with real USMTF, but anything load-bearing MUST be verified against MIL-STD-6040 `[Annex §14.3]`.

### 9.10 Stereo routes

Implement a **local canned-route table keyed by short name**, resolvable to a full route, with a filing path that does not require a full flight-plan form. This is verified real practice: assigned aircraft at Kunsan file locally-defined "Pack" routes by phone or email without the international form `[Annex §12]`.

This is the single most authentic-feeling military flight-data behaviour available and it maps directly onto how a DCS squadron actually operates. It is also cheap. Build it early.

### 9.11 Airspace activation authority

Verified: the **RAPCON, not the flying squadron, holds airspace activation authority**, and coordination and approval must precede airspace entry and exit `[Annex §13.3]`.

Model airspace activation as a state owned by `APP` (with `RANGE` as the using agency that schedules and releases it), with request and approval as recorded actions. Aircraft entering unactivated airspace MUST alert. Ownership is a direction, never a boolean — §4.6.4.

### 9.12 The carrier — the marshal stack

Field content per `EFSP-Coordination-Annex.md` §4.4–4.5. Layout is `[SOURCE-DEFINED]`; the numbers are not.

**The recovery Case is global session state owned by `CV_PRIFLY`**, and it reinterprets every carrier Strip simultaneously. Model it as a broadcast session property, never a per-Strip attribute. Criteria: Case I ceiling ≥ 3,000 ft and visibility ≥ 5 NM; Case II ceiling ≥ 1,000 ft and visibility 5 NM; Case III any ceiling below 1,000 ft or visibility below 5 NM, **and all night operations**.

**Case III — one integer drives four displayed fields.** Marshal holding is on the **180 relative to BRC**, at **1 NM per 1,000 ft plus 15** (angels 8 → 23 DME), minimum **6,000 ft**, **1,000 ft** vertical separation, **1-minute** push separation, arrive **±10 seconds**. So stack index → altitude, DME and push time together.

```
MarshalStrip {
  stackIndex   uint8     // AUTHORITATIVE — everything below is derived
  angels       = 6 + stackIndex
  marshalDme   = angels + 15
  pushTime     = charlieTime + stackIndex minutes
}
```

1. **Store the index; compute the display.** Do not let a controller hand-edit DME.
2. **Insertion is the interesting operation.** A low-fuel aircraft inserted low renumbers everyone above it, shifting altitude, DME and push time together. The Marshal controller's documented core task is *"sequencing aircraft based on fuel state and mission requirements"* — so **re-sequence MUST be the cheapest gesture in the UI**, and per-field editing MUST NOT be the path to it.
3. **Case I is not a controller-sequenced recovery.** Squadron-assigned stack altitudes from 2,000 ft AGL, 1,000 ft apart, within 5 NM; under Zip Lip the pilots break the deck themselves. The Case I Bay is a low-interaction altitude-keyed list. **Do not build Case I around push times.**
4. **The Case II transition fires on a pilot report**, not a controller action: Case II procedures outside 10 NM, Case I inside 10 NM or after "see you". That is an ownership transfer from `CV_MARSHAL` to `CV_PRIFLY` with an unusual trigger type — model it as such.
5. **Ship state is a banner, not a field.** Speed, heading, position, time and altimeter are shared by every carrier Position, and **final bearing is computed from ship heading, not typed**. This is how the real system does it.
6. **Store the approach *button* number, not a frequency.** The marshal message passes a button; real carrier frequencies are not publicly documented and every value circulating in the sim community is a module default.
7. **`EEAT` is issued before launch** as the lost-comms fallback and MUST survive from the departure Strip through to recovery. It is the field most likely to be missed.

Marshal message field set: `CALLSIGN · TYPE · CASE · APPROACH TYPE · MARSHAL RADIAL · MARSHAL DME · ANGELS · EAT/PUSH · EXPECTED FINAL BEARING · APPROACH BUTTON · ALTIMETER · SHIP WX · FUEL/LOW STATE · BINGO FIELD · BINGO FUEL · EEAT`

The panel SHOULD validate internal consistency — angels + 15 = DME, and marshal radial roughly reciprocal to final bearing — as a cheap correctness check.

**Ownership transfers on the carrier are heterogeneous and MUST NOT be unified behind one button:** Marshal → Approach is controller-initiated; Approach → Final is on radar acquisition; Final → LSO is on the pilot's **"ball"** call; Case II Marshal → PriFly is on a pilot report. Four different trigger types.

**`CV_APP1` and `CV_APP2` are parallel lanes, not independent sectors** — a recovery is a conveyor, one controller working final while the next aircraft is turned onto the bearing. Feed them alternately from the Marshal stack in push order.

### 9.13 The carrier's civil interface

**The carrier does not talk to the centre.** FAA JO 7610.14 ¶3-7-1: *"FACSFACs should be used as the point of contact for FAA activities with respect to Navy shipboard operations"*; ¶3-7-5 names the FACSFAC *"the communications link between FAA activities and aircraft carriers"* `[Coord §4.1]`.

Implement a **FACSFAC-equivalent role owning the warning-area boundary** rather than wiring `CV_MARSHAL` to `CTR`. It is sourced, it is the realistic answer, and it gives the community one more genuinely interesting position — the boundary is where the military and civil systems actually meet.

The legal basis for carrier operations without an ATC clearance is **due regard, satisfied by continuous surveillance from a surface facility** — the ship's own 50 NM radar coverage. Model `separation_regime = DUE_REGARD` inside the Carrier Control Area, and a due-regard entry/exit point on the Strip as the boundary at which ownership passes between the civil system and the ship.

---

## 10. Automation policy

The measured lesson from the real programme is unambiguous: **descriptive and assignment automation was accepted; prescriptive sequencing automation was rejected** `[Annex §6]`. Automation policy therefore follows a rule: *the system may fill in and suggest; it may not sequence or advance on its own.*

### 10.1 Auto-population — do it aggressively

Controllers were measured to be **less likely to write on strips immediately after issuing a command under high complexity** — strip currency degrades exactly when it matters most `[Annex §9]`. This is the strongest quantitative case for automation in the whole evidence base.

Auto-populate every Block whose value the system already knows, mark it `COMPUTER_GENERATED`, and let the controller override.

### 10.2 Runway assignment — copy this rule exactly

From the real prototype `[Annex §8]`:

1. Assign a default runway from configured logic.
2. Recalculate automatically when the route updates or the field configuration changes.
3. **Once a controller manually modifies an assignment, stop auto-updating that flight.**
4. Measured: 98% of final assignments matched the default logic. Expect the default to be right almost always, and never to argue when it is not.

### 10.3 Do NOT auto-advance strips on surveillance

**MUST NOT** move Strips between Bays based on detected aircraft position.

The prototype did exactly this and it *"caused the participant controllers some confusion"* and required redesign `[Annex §6]`. This is the most important single finding for anyone building auto-advancing bays.

Permitted instead: a **suggestion chip** on the Strip — "aircraft detected airborne; advance?" — that the controller accepts with one input. Surveillance informs; the controller advances.

### 10.4 Detect the silent failure mode

"Forgetting to update strips" was detected **only by visual analysis** — no controller complained about it `[Annex §6]`. It is a silent failure with no user signal.

Implement staleness detection: a Strip whose State contradicts its correlated track state for longer than a configured threshold MUST raise a low-severity indication. Log every occurrence for §11.5 analysis.

### 10.5 Provenance fallback chains

Where a time or value has multiple possible sources, implement an explicit ordered fallback and record which source was used. The pattern to copy, from ATD-2 `[Annex §8]`:

> *"UOBT is normally equal to the EOBT if the EOBT is set. If there is no EOBT, then LOBT; if no LOBT, then flight plan departure time; if no POBT, then SOBT; if no SOBT, then IOBT."*

Apply the same shape to departure time, off-block time and takeoff time. The chosen source MUST be visible on hover.

---

## 11. Non-functional requirements

### 11.1 Reliability

1. Transfer success rate MUST be ≥ 99.5% measured over a session (the real-world benchmark is 99.68–100% `[Annex §4]`).
2. No Mutation may be lost on reconnect (§5.6).
3. Server restart MUST NOT lose the Board. Persist Strips, Bays, order keys and field state.

### 11.2 Time and units

1. **All times UTC**, four digits `HHMM` on Strips, per doctrine `[Annex §9]`.
2. Altitudes in **hundreds of feet** by default; the thousands-of-feet abbreviation ("FL330 as 33") is a facility-configurable display option only, never a storage format.
3. Two-digit minute abbreviation within the current hour is **not** a national convention — it was found only in a virtual-facility SOP `[Annex §9]`. Configurable, default off.

### 11.3 Audit

Every Mutation MUST be recorded with Strip ID, Position, controller identity, timestamp, before/after and `clientMutationId`. The log is append-only.

Retention: **do not encode "15 days" as if it were a current requirement.** That figure traces to a 1965 advisory circular and was not found restated in current orders `[Annex §16 gap 9]`. Make retention a configuration value; default 30 days for SOURCE purposes and state it as a SOURCE policy choice.

### 11.4 Traffic count

The Strip's second life in a real tower is as a traffic-count record, collected hourly and categorised by aircraft type `[Annex §9]`. DAFMAN treats **formation flights** and **SUA traversals** as distinct count categories `[Annex §13.3, §13.6]`.

The EFSP MUST produce a traffic count from `DROPPED` Strips, with at least these categories: local, transient, formation, SUA traversal, alert scramble.

### 11.5 Instrumentation — measured acceptance, not asserted

The real programme's most useful findings came from instrumentation, not opinion. Instrument from day one:

| Metric | Why | Target |
|---|---|---|
| Search invocations per Position per hour | search is a failure symptom (§4.3) | trending down |
| Time-to-find: Strip selection latency after Bay entry | the Pending-bay choke point | p95 < 3 s |
| Inputs per paper-gesture equivalent | the cost ceiling (§7.3) | = 1 |
| Strip↔track correlation rate | the named defect class (§6.6) | ≥ 95% |
| Rejected Mutations per session, by reason | conflict surface | trending down |
| Staleness detections (§10.4) | the silent failure mode | trending down |
| Transfer failures and their causes | §11.1 | ≤ 0.5% |

---

## 12. Deliberate deferrals

| Deferred | Reason |
|---|---|
| Departure metering / TOBT / TMAT computation | The one capability that **failed acceptability outright** in the real prototype — *"not considered acceptable, either in concept or in display"* `[Annex §6]`. Keep Block 16 in the schema; do not compute it. |
| Datalink clearance loop | The two-way TFDM↔TDLS interface was **descoped from the real programme for budget** `[Annex §1]`. Keep Blocks 2A/4B as delivery-method indicators. |
| Supervisor / traffic-management display | Met only **47% of human-factors criteria** in the real prototype `[Annex §6]`. Revisit with a narrower scope. |
| En-route `(flight, fix)` strip posting | Structurally different data model — the unit of record becomes `(flight, fix)` tuples `[Annex §9]`. Do not retrofit; design separately. |
| Departure routing decision support | *"None of the acceptability criteria were met"* `[Annex §6]`. |
| ATO/ACO authoring | Ingest only in v1. |

Each deferral MUST leave its schema fields present and unpopulated rather than absent, so that adding the capability later is not a migration.

---

## 13. Work packages

Each work package has an owner agent, entry criteria, deliverables, and acceptance criteria. **A work package is not complete until its acceptance criteria are demonstrated, not asserted.**

### WP0 — Reconnaissance and Integration Report

**Entry:** none. **Blocks:** everything.

Deliverables:

1. A written finding for each assumption A1–A6 (§1.3): confirmed, refuted, or partially true, with file and line references.
2. The existing flight/track data model, transport layer, authentication/Position model and persistence, described as they are.
3. An integration surface proposal: exactly where the EFSP attaches, what it owns, what it reads.
4. **Whether the CRC server mints beacon codes today**, and if so from what pools and with what reserved-code exclusions (§3.10.1). If it does not, an ADR proposing where that work lands — in the server, not in this panel.
5. How the host exposes radar-station selection, since Position occupancy derives from it (§4.8).
6. An ADR for every point where a finding contradicts this guide.

Acceptance: a reviewer who has not read the codebase can, from the report alone, say where each EFSP subsystem attaches.

### WP1 — Domain model and protocol

**Entry:** WP0 accepted.

Deliverables: protobuf schema for FDR, Strip, Bay, Rack, Mutation, presence, Board events; server-side Board store with revisions, order keys and the Mutation log; WebSocket channel with version negotiation, sequence numbers, snapshot and delta resync.

Acceptance:

- A Mutation with a stale `baseRev` is rejected and returns current state.
- Two clients inserting at the same slot both survive with no reindex broadcast.
- A client disconnected for less than the ring-buffer window resyncs by delta; one disconnected longer receives a snapshot; **there is no third path.**
- Replaying a Mutation with the same `clientMutationId` does not double-apply.
- An unacknowledged Mutation that fails `baseRev` after reconnect is surfaced, not dropped. **Test this explicitly; it is the worst failure mode in the system.**

### WP1A — Position occupancy, combination and handover

**Entry:** WP1, and the WP0 finding on how the host CRC exposes radar-station selection.

This is foundational, not a feature. Under low manning the combined case is the normal case, so it must be correct before any Position-scoped behaviour is built on top of it.

Deliverables: the station→Position mapping as facility configuration; derived Position sets with live recomposition (§4.8.5); Primary/Observer with claim, request and release (§4.8.2); `actingPositionId` on every Mutation (§4.8.1); per-acting-Position permission evaluation (§4.8.4); the self-coordination action (§4.8.3); the covering chain and vacate handling (§4.8.6); the §4.8.7 metrics.

Acceptance:

- One controller holding `CTR` and `TAC_C2` sees both Facilities' Bays, **grouped by Position, not merged**, and both Boards remain distinct.
- **A `HANDOFF` attempted on a `TAC_C2`-owned Strip is refused, even though the same controller holds `CTR`.** Permissions are evaluated per acting Position. Test this specific case; it is defect D21 and it passes a casual demo.
- A boundary event between two Positions held by one controller **applies the full state change** — separation regime, radar service, IFR status — in **one input**, and writes a Mutation marked self-coordinated and naming both Positions.
- A second controller taking `TAC_C2` mid-block **inherits correct state**, not a state that was never written because one person held both sides.
- A Position never resolves to two Primaries, under any interleaving of selection changes. Test concurrently.
- **A handover moves no Strips.** Verify that `ownerPositionId` values are unchanged across a Primary change.
- Vacating a Position with no successor routes its Strips down the covering chain, tells the controller where they went, and leaves nothing stranded. Vacating `APP` renders the airspace reversion to `CTR`.
- A controller deselecting a station that would strand Strips is **warned with a count and destination, and not blocked**.
- Recomposition during an active drag, an open annotation cell, or a scrolled Bay disturbs none of them.

### WP2 — Block Map and template renderer

**Entry:** WP1.

Deliverables: data-driven Block Map (§6.5); Departure, Arrival and Overflight maps per §6.2–6.3; annotation cell model with append-only supersession (§3.7); facility configuration loader and validator (§8.3).

Acceptance:

- All Blocks marked required in §6.2 render, with correct labels, on a Strip built from a fixture FDR.
- Amending a Block leaves the prior value visible and struck through.
- An altitude cannot be struck as vacated without an explicit confirm action.
- `Enter` commits; `Esc` reverts; blur does neither.
- A configuration omitting minimum fuel from arrival Block 9A is **rejected by the validator**.

### WP3 — Bays, Racks and the interaction layer

**Entry:** WP2.

Deliverables: Bay/Rack UI; Pointer-Events drag with insertion line; keyboard and click-to-place alternatives; dot-command surface with preview line; annotation `Tab` cycling; the four paper gestures at one input each.

Acceptance:

- Drag works identically with mouse, touch and stylus; `touch-action: none` verified on a tablet.
- **Every drag operation has a non-drag single-pointer path** (WCAG 2.2 SC 2.5.7) — audited, not assumed.
- Offset, flip, highlight and attention-mark each cost exactly one input.
- All touch targets ≥ 44×44 CSS px, measured.
- A 60-Strip Bay sustains 60 fps during a drag on the target hardware. **Measure; do not assume.**
- 50 simultaneous Strip updates produce one paint.

### WP4 — States, NLA and transfer

**Entry:** WP3.

Deliverables: EFSP State machine (§3.4); NLA computation with inhibit reasons (§3.5); Undo within 30 s; transfer protocol with presence gating (§4.5); release-state model with the derived 30-minute void-time deadline (§3.8).

Acceptance:

- Every State has exactly one NLA or a rendered inhibit reason.
- Double-tap on NLA within 400 ms applies once.
- Transfer to an unmanned Position is rejected with a named reason, and the Strip stays with the sender.
- A transfer interrupted by a server restart resolves to exactly one owner. **Test with an actual restart.**
- Void-time expiry raises an alert at void + 30 minutes.

### WP4A — Inter-facility coordination

**Entry:** WP4.

Deliverables: the Facility model (§2, §4.6); the coordination primitives `HANDOFF`, `POINT_OUT`, `TRAFFIC`, `OPERATIONAL_REQUEST`, `TOFI`, `AIT` with correct jurisdiction semantics; per-Facility Strip replication from forwarded data; the timed forwarding obligations (§4.6.1); release objects across the boundary (§4.6.2); the three-field separation model (§4.6.3); airspace ownership as a direction (§4.6.4).

Acceptance:

- A `POINT_OUT` leaves data ownership with the initiator **and** moves separation responsibility to the receiver, and the UI shows both.
- **`TAC_C2`, `GCI`, `AIC` and `JTAC` have no handoff or point-out affordance at all** — audited in the UI, not merely absent from the happy path.
- A cross-Facility exchange produces **two Strip replicas**, each independently removable, not one moved Strip.
- A track-degradation flag disables silent transfer and forces the verbal path.
- The 15-minute, 3-minute and 30-minute obligations each raise an alert at the right moment, and compliance is instrumented.
- `separation_regime` cannot be set implicitly by airspace type — attempting it is a validation error.
- Setting airspace ownership requires a direction; there is no boolean path.

### WP5 — Track correlation

**Entry:** WP3, and WP0 finding on A4.

Deliverables: correlation subsystem per §6.6; coupled selection both directions; correlation-state rendering; correlation-rate instrumentation.

Acceptance:

- Strip selection highlights the track in < 1 s, measured at p95.
- A track identity change re-binds on beacon code or raises an uncorrelated warning — **it never silently breaks the binding.** This is the named defect class; test it deliberately.
- Correlation rate is reported and ≥ 95% on a representative session.

### WP6 — Military layer

**Entry:** WP4.

Deliverables: military extension Blocks (§6.4); MARSA relation with the course/altitude-change void interlock (§9.2); field state with arresting-gear gating and the runway-change coordination workflow (§9.7); alert/scramble constraints (§9.6); ordnance state (§9.5); MTR fields (§9.4); stereo route table (§9.10); airspace activation authority (§9.11).

Acceptance:

- A heading or altitude assignment to a MARSA participant before rendezvous voids the relation, sets `voidedBy`, and alerts every participant Strip.
- A barrier reconfiguration suspends the runway, inhibits takeoff and landing NLA with the reason shown, and requires an attributable inspection-complete action to resume.
- A runway change cannot be initiated without `OPS` and `APP` acknowledgement.
- A stereo route filed by short name produces a complete FDR.
- No UI text or code comment presents a `[SOURCE-DEFINED]` behaviour as real-world doctrine. **Audit this explicitly.**

### WP7 — ATO ingest and the tactical Position

**Entry:** WP6.

Deliverables: ATO set parser and mapping (§9.9); `MISSION` Strip Role and `TAC_C2` Bays; AR line ↔ tanker Strip join; ATO↔Strip binding on Mode 3/A.

Acceptance:

- An ATO fixture produces mission Strips with correct mission number, package, vul window, controlling agency and IFF codes.
- A tanker's AR line and its receivers' Strips render as a joined group.
- The community-source caveat (§9.9) appears in the parser's module documentation.

### WP7A — Carrier and precision approach

**Entry:** WP4A.

Deliverables: `MARSHAL`, `FINAL` and `PATTERN` Strip Roles; the marshal stack with stack index as the authoritative key (§9.12); Case as broadcast session state; the four heterogeneous ownership transfers; ship-state banner with computed final bearing; the shared `FINAL` component for `PAR` and the carrier Final lane (§7.10); `SFA` frequency-rotation transfer (§4.7).

Acceptance:

- Inserting an aircraft low in the marshal stack renumbers altitude, DME and push time for everyone above it, in one gesture.
- Marshal DME, angels and push time are **not independently editable**.
- Changing the Case re-renders every carrier Strip at once.
- The four transfer triggers are distinguishable in the UI — controller-initiated, radar acquisition, pilot "ball" call, pilot "see you" report.
- Final bearing is computed from ship heading and cannot be hand-entered.
- A `FINAL` Strip requires no data entry during an approach.
- `SFA` transfer rotates a controller onto the aircraft's frequency; the Strip's frequency does not change.
- `EEAT` set before launch is still present on the recovery Strip.

### WP8 — Instrumentation, audit and hardening

**Entry:** WP4.

Deliverables: audit log; traffic count (§11.4); the §11.5 metric set with a dashboard; staleness detection (§10.4); soak test.

Acceptance:

- Every metric in §11.5 is collected and visible.
- A four-hour soak with simulated traffic shows no memory growth, no order-key exhaustion, and no dropped Mutations.
- The traffic count reconciles against the Mutation log.

---

## 14. Decisions taken, and what remains open

### 14.1 Settled by the project owner — binding on implementing agents

| # | Decision | Effect on this guide |
|---|---|---|
| D-1 | **The CRC server already keeps a per-aircraft flight record.** The EFSP reads and writes it and owns only annotations, Bay position and State | §1.3 A1 resolved; §3.1 is an overlay model, not a new system of record. WP0 verifies the field set, not the existence |
| D-2 | **Eighteen Positions across five Facilities**, as listed in §4.1 | §4.1, §4.2, §4.6, §9.12–9.13 |
| D-3 | **Military-realistic clearance delivery**, of which civil-realistic is a subset | `CD` is a real Position; §6.2 departure Block Map applies in full |
| D-4 | **Flight plans are filed independently of the ATO.** The ATO is relevant only to `TAC_C2`, `AIC`, `GCI`, `JTAC` and `OPS` | §9.9 ATO ingest binds to `MISSION` Strips only and MUST NOT be a prerequisite for clearance delivery. WP7 moves behind WP6 and is independent of the tower chain |
| D-5 | **The EFSP is a dockable panel inside the CRC**, movable to another monitor | §7.6.1 below. Touch is not the primary input, but the drag layer still MUST be pointer-based |
| D-6 | **Retention: no requirement.** Any retention is a bonus | §11.3 default stands as a SOURCE policy choice, not an obligation |
| D-7 | **American procedures at Incirlik**, not Turkish | Stated once in the facility configuration; see the header note and `EFSP-Coordination-Annex.md` §6 |
| D-8 | **Conform to the SOURCE Contract Language Standard** | The conforming pass is **pending receipt of the standard's text**. Until then §0.1's editor's note stands |
| D-9 | **Positions are derived from selected radar stations**, combine freely including across Facilities, and change live during a session | §4.8 in full; §4.1 combination rule replaced; §4.5 occupancy gating |
| D-10 | **Several controllers may hold a Position; one is Primary. Selection changes mid-session with automatic handover** | §4.8.2, §4.8.6; defect classes D18–D21 |

#### 7.6.1 Consequence of D-5 — dockable panel, not a tablet

The panel lives in a docking system inside the CRC and can be moved to another monitor. Therefore:

1. **Resolution scaling (§7.6.1 of the original numbering, now §7.6 clause 1) still applies** — a Strip MUST keep constant physical size when the panel is dragged to a display of different pixel density. This is the exact case deployed TFDM handles, and it is now a routine user action rather than an install-time concern.
2. **The panel MUST survive a resize gracefully.** Bays reflow; Racks do not silently truncate; a Strip mid-drag when the panel is resized MUST resolve to a defined position, not vanish.
3. **Keyboard and mouse are primary; touch remains supported.** The 44×44 px target floor (§7.6) is retained anyway — it costs nothing on a mouse and buys the tablet case for free.
4. **Panel state — which Bay is in view, which Rack is scrolled where — is per-controller local state**, not Board state, and belongs in browser storage rather than the Mutation log.

### 14.2 Still open

| # | Question | Why it matters |
|---|---|---|
| OQ8 | **`CV_APP1` versus `CV_APP2` — what is the division of duties?** Two approach controllers are documented; the split between them is **not publicly documented** `[Coord §7, C11]` | SOURCE must define it. Whatever is chosen is `[SOURCE-DEFINED]` and must be labelled so |
| OQ9 | Is a **FACSFAC-equivalent position** wanted (§9.13)? It is the sourced-correct answer for the carrier's civil interface and adds a nineteenth Position | Facility model; whether `CV_MARSHAL` ever coordinates with `CTR` directly |
| OQ10 | Does SOURCE want to **write the Incirlik ↔ Ankara Letter of Agreement** as a directive document? `EFSP-Coordination-Annex.md` §2.3 gives the real-world template | It is where the panel's facility configuration comes from, and it settles a hundred coordination arguments in advance |
| OQ11 | `RSU` and `RANGE` work boards, not strip racks. Are those in v1 scope or deferred? | Scope of WP3 and WP6 |

---

## 15. Defect register — known classes to design against

Each is drawn from measured real-world failure, not speculation. Treat each as a test case, not a caveat.

| Class | Description | Mitigation clause |
|---|---|---|
| **D1 Identity reconciliation** | Track identity changes propagate to the surveillance display but not to flight data; 10–15% of strips lose correlation | §6.6 |
| **D2 Pending-bay accumulation** | The intake bay becomes unscannable; controllers resort to search; dwell times exceed 15 s | §4.3, §11.5 |
| **D3 Silent staleness** | Controllers forget to update strips; no user-visible symptom | §10.4 |
| **D4 Gesture cost inflation** | Paper affordances re-implemented at three taps instead of one; controllers stop using them | §7.3 |
| **D5 Auto-advance confusion** | Surveillance-driven strip movement disorients controllers | §10.3 |
| **D6 Silent mutation loss** | A rejected or unacknowledged amendment disappears without surfacing | §5.3.3, §5.6.3 |
| **D7 Transfer limbo** | A strip is owned by nobody, or by two Positions, after a restart | §4.5, WP4 acceptance |
| **D8 Alert under-prominence** | Operation-blocking conditions rendered at insufficient severity | §7.7.5 |
| **D9 Legibility regression** | Background contrast, column count and colour choices degrade scanning | §7.7 |
| **D10 Config drift** | Live re-layout under a working controller | §8.4 |
| **D11 Doctrine fabrication** | A `[SOURCE-DEFINED]` behaviour presented as FAA/DoD doctrine in code, UI or wiki | §0.2, WP6 acceptance |
| **D12 MRU given ATC primitives** | `TAC_C2`, `GCI`, `AIC` or `JTAC` offered a handoff or point out. A Military Radar Unit is forbidden from being asked to provide ATC service | §4.1, §4.6 |
| **D13 Strip moved across Facilities** | A cross-Facility exchange implemented as a strip move rather than data forwarding plus coordination. Produces one Strip where the real world has two replicas, and loses the independent removal schedules | §4.6 |
| **D14 Separation regime derived from airspace type** | `separation_regime` computed from MOA/ATCAA/restricted rather than stored as an agreement-sourced field. Three regimes exist, including ATC continuing to separate inside | §4.6.3 |
| **D15 Bare `released` boolean** | Airspace ownership stored as a boolean rather than a direction. "Released" appears in both directions in the source material | §4.6.4 |
| **D16 Carrier DME hand-edited** | Marshal DME, angels or push time editable independently of stack index, allowing the four derived values to drift apart | §9.12 |
| **D17 SFA modelled as a frequency change** | Ownership transfer implemented as "send the aircraft to a new frequency", which inverts what SFA actually does | §4.7 |
| **D18 Two Primaries** | A Position resolves to more than one acting controller, so two people can act on the same Strip believing they are the owner | §4.8.2 |
| **D19 Stranded Strips** | A Strip left owned by an unoccupied Position with no covering path after a controller vacates | §4.8.6 |
| **D20 Self-coordination skipping the state change** | A boundary event between two Positions held by one controller collapsed away entirely, so the separation regime, radar-service status or MARSA state never updates. Surfaces later as a second controller inheriting a false state | §4.8.3 |
| **D21 Permissions unioned across held Positions** | Combination implemented as the union of the held set's powers, so an MRU hat acquires ATC primitives from an ATC hat held by the same person. Looks correct in every demo | §4.8.4 |
| **D22 Assigned and observed code collapsed** | One `beaconCode` field instead of two, so a mismatch between what was assigned and what the aircraft is squawking becomes invisible | §3.10.2 |
| **D23 Duplicate code treated as an error** | A duplicate code blocking assignment. Duplicates are structural in the real plan and explicitly accepted as unavoidable; blocking models a guarantee that does not exist | §3.10.2 |
| **D24 Mode 1 or Mode 2 made ATC-editable** | Mission and airframe identity codes exposed as controller-writable. Neither is ATC's to change, and Mode 2 is physically set on the ground | §3.10.3 |

---

## 16. Build order, in one paragraph

Do WP0 first and take its findings seriously. Then build the protocol before the UI, because the concurrency model is the part that cannot be retrofitted. Then build the Block Map as data, because a hard-coded strip layout is the mistake that forces a rewrite the moment the second Facility appears — and with five Facilities and eighteen Positions fixed from the start, it will appear in week two. Then the interaction layer, measuring the gesture cost ceiling as you go. Then states, NLA and transfer, testing the restart case deliberately.

**WP1A comes immediately after the protocol, and WP4A must not slip.** Together they are the load-bearing structure of an eighteen-position panel worked by three or four people. WP1A because under low manning the combined case is the normal case, and because permission evaluation per acting Position is the one thing that cannot be bolted on afterwards without auditing every call site. WP4A because the class distinction — military ATC does handoffs, Military Radar Units do not — is expensive to retrofit and easy to get wrong. Every other work package assumes both.

Correlation can proceed in parallel once the UI exists. The military layer comes after the civil core works, not before — but ship stereo routes (§9.10) early, because it is cheap, it is verified real practice, and it is the thing squadron members will notice first. The carrier (WP7A) is a self-contained addition once the coordination layer exists, and its stack model is small and elegant: one integer drives four fields. ATO ingest is last and, per decision D-4, is not on the critical path for anything in the tower chain.

Defer everything in §12 without apology: the real programme deferred most of the same things, and the ones it did not defer are the ones its controllers rejected.
