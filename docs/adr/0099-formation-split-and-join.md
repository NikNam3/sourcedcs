> Amended for H100 (2026-10-01): Q-SJ1 (b), Q-SJ2 (any IFR Strip, on the ground no assignment), Q-SJ3 (c), speed as a plain
> recorded assignment (DR-11 b). Q-SJ4 (a) and Q-SJ5 (a) settled as recommended. See decisions.md H100.

# 0099: A formation splits in two and joins into one, each as one audited Strip op

**Status.** Built (SJ-S, 2026-10-02). Drafted by DES-SPLIT (2026-10-01); the human's answers are decisions.md H100. Edited at
build time only where the code as found proved the draft wrong: see "Built notes" at the end.

Written in the post-RENAME vocabulary (H96, H98; `docs/parallel/research/vocabulary.md`): **flight data** (today FDR,
`fdrId`, `fdr-store.js`), **strip type** (today Strip Role, `strip.role`), **staffed** (today occupied),
**consolidation** (today covering chain), **beacon code** (today squawk/beaconAssigned), **Interfacility** (today
`Peer*` audit kinds), **CarrierHandoff** (today `CarrierTransfer`). Identifiers below that do not exist yet take their
final spelling from the RENAME mapping table.

## Context

Guide §3.2 rule 2 makes a formation one identity with `identity.flightSize > 1`. Until now the EFSP had no way to
record that a formation broke up or that two flights became one: the only tools were editing `flightSize` and
originating a fresh Strip by hand, which mints an unrelated flight data record with no lineage, an empty plan and no
audit link between the two.

The human settled the doctrine in chat (decisions.md H89, H90, H91):

- **Under MARSA** a split needs no authorisation and is not noted down until the flight returns to an agency that
  provides separation (H89). On return the formation is expected to have rejoined; if not, the pilots say so on initial
  contact. The system does not point it out; the controller records the split then (H91). H100 (Q-SJ1 b) reverses the
  supervisor's assumption in H91: on that return the heading/speed/altitude assignment is **still required**.
- **Under IFR control** a split is by **speed, altitude or heading**, and the departing part **must** be given that
  assignment (H90). It keeps the **same flight plan** and is usually told to resume it once separated.
- A split is **binary**: one aircraft or sub-formation leaves at a time, 4 becomes 1+3 or 2+2, never 1+1+2 in one step
  (H89).
- The departing part **gets a new beacon code**, allocated like any other (H90), so each part correlates to its own
  track. The controller **always types its callsign**; there is no default (H91).
- **Join exists** (H91): two formations or single aircraft become one. The joiner follows the lead, so at completion
  **the joiner's flight data is voided**, its Strip ends as joined (audited), its code is released and the lead's size
  grows by the joiner's.

FAA JO 7110.65 2-1-13 ("Formation Flights": control a formation as a single aircraft; separation is established before
individual control) is the reference; this lane did not re-fetch it, so the citation is unverified.

## Decision

### 1. `SplitFormation`: one op on one Strip, exactly two results

```
op: { kind: 'SplitFormation',
      size: k,                                   // the departing part, 1 <= k < N (N = the lead's flightSize)
      callsign: 'VIPER3',                        // typed, required, never defaulted (H91)
      assignment: { kind: 'HEADING'|'SPEED'|'ALTITUDE', value: '270' } | null,   // required unless the Strip is on the ground (§4)
      marsaReturn: false }                       // true: recorded on return from MARSA (H91); an audited label only
mutation.stripId = the formation's Strip (the lead)
```

Applied on the acting Position's own Board, atomically, nothing half applied:

1. **Gates** (each a refusal with its own wording, no side effects): the acting Position owns the Strip and holds the
   `SplitFormation` grant (§4); the strip type and state are split-eligible (§4, **settled H100 Q-SJ2**); `N >= 2` and
   `1 <= k < N`; the callsign passes the existing callsign rule and differs from the lead's; `assignment` is present
   unless the Strip's state is a **ground state** of its strip type (§4; `marsaReturn` does not relax this, H100 Q-SJ1 b), and its value parses (heading and altitude with the existing parsers, speed with the
   new one in §3); no coordination or TOFI exchange on the Strip is `PROPOSED`; TOFI is not `ACTIVE` (the flight is
   under an MRU's tactical control: split it after the exit, as a MARSA return); the Strip is not a rejected replica;
   a free beacon code exists (checked before anything is written).
2. **New flight data** for the departing part, through one new flight-data store method
   (`createSplitFlightData(leadId, {callsign, size, by})`, today's `FdrStore.createFdr` sibling): the lead's filed plan
   (`filed.*`), mission fields (`mission.*`), military namespace, `assigned.*` and identity (type, wake, equipment, unit,
   home station) are **copied**; `callsign` is the typed one, `flightSize = k`, a **new beacon code** is allocated by
   the code allocator (`code-allocator.js` `allocate`), `beaconObserved` is null, `tailNumber` null, provenance of the
   copied paths says `COPIED_ON_SPLIT`, and `identity.splitFrom = <lead flight data id>` records the lineage. The active
   altitude and heading clearance entries are copied as fresh `ACTIVE` entries (the part was flying them).
3. **The assignment** is written to the new flight data's clearance cell for its kind (heading, speed, altitude) as an
   ordinary clearance entry (ADR 0058's model; the split's kind is the assignment, H90). A split on the ground (§4)
   carries no assignment, so nothing is written (a ground split that does carry one is accepted and recorded).
4. **The lead's flight data** gets `flightSize = N - k`. Its code, callsign, plan and correlation are untouched.
5. **The new Strip** is created on the same Board: same strip type, state, owner, Bay and Rack as the lead, placed
   directly after it; annotations' active entries copied (the plan is the same), flags fresh, coordination/TOFI null,
   `airspaceEntry` and `previousLeg` copied, `splitFrom = { stripId, flightDataId, at, actionId }`.
6. **One audit entry** (ADR 0083, one outcome one entry), op `SplitFormation`, addressed Strip = the lead (`before`,
   `after`), plus `records: [{ stripId, flightDataId, before: null, after }]` for the new Strip and
   `split: { size, remaining, callsign, assignment, marsaReturn, newFlightDataId, beaconCode }`.
7. **One Board event**: both Strips ride one board delta, the two flight data records ride the same broadcast.

Splitting again is the same op on either result (H89's 1+1+2 is two splits). A split part may later get its own IFR
clearance through ordinary edits (H91: "the Split copies the lead's plan by default; the controller can change it").

**MARSA return (H91; H100 Q-SJ1 b):** `marsaReturn: true` is only the controller's declaration that this split is
being recorded on the formation's return from MARSA, audited as such. It relaxes **nothing**: the assignment is still
required (the controller records the heading, speed or altitude the part is under as it comes back; the pilots'
initial-contact report tells them which) and a new code is still allocated, because the system still has to tell the two
tracks apart. The system does not check that the flight was under MARSA and never prompts for it. There is no "back from
MARSA" exemption.

**Ground split (H100 Q-SJ2):** a split on the ground needs no assignment (§4 defines "on the ground" by the Strip state).
The new part still gets the typed callsign, a new code and the copied plan.

### 2. `JoinFormation`: the joiner ends, the lead grows

```
op: { kind: 'JoinFormation', leadStripId, leadBaseRev }
mutation.stripId = the joiner's Strip (the one selected), mutation.baseRev its rev
```

1. **Gates:** the acting Position owns **both** Strips (**settled H100 Q-SJ5 a**) and holds the `JoinFormation` grant; both are
   on this Board, distinct, live, join-eligible (§4); both revs current; neither has a coordination or TOFI exchange
   `PROPOSED` or `ACTIVE`; the joiner's flight data has **no other live Strip anywhere** (no replica at another
   Facility, no MISSION Strip): the controller resolves those first, because voiding a flight another Facility still
   works would void their record silently.
2. **The joiner retires through the one retirement path** (today `_retireStrip`): state `DROPPED`, with
   `endReason: 'JOINED'` and `joinedInto: { stripId, flightDataId }` on the Strip. That path already releases the code
   when no other Strip references the flight data, ends any MARSA relation (`retireMarsaForFdr`), and puts the Strip in
   the archive clock. Nothing new is needed for archiving: a joined Strip is a DROPPED Strip and is archived by ADR 0082.
3. **The joiner's flight data is voided:** `voided = { reason: 'JOINED', into: <lead flight data id>, at, by }`
   (a field, never a deletion; the archiver removes it with its last Strip as usual). Nothing reads a voided flight data
   record as a live flight.
4. **The lead's flight data** gets `flightSize += joinerSize`. Its aircraft type stays; if the joiner's type differs the
   ack carries a warning ("mixed formation: type stays F-16C") and the controller edits Block 3 if needed (default,
   not a desk question).
5. **One audit entry**, op `JoinFormation`, addressed Strip = the joiner (its `before`/`after` is the drop, so the
   traffic count's existing `isDropTransition` sees it unchanged), `records: [{ lead before/after }]`,
   `join: { leadFlightDataId, joinerFlightDataId, joinerSize, newSize }`. One Board event.

Correlation needs nothing: the 1 Hz reconciler's `retireFinished` already ends the correlation of a flight data record
with no live Strip, and the split part is correlated like any new flight (by its own code, or by hand).

### 3. Speed is a plain recorded assignment (DR-11 b)

Today the flight data clearance (ADR 0058) has `altitude` and `heading` only (`CLEARANCE_FIELDS`), and ARRIVAL's
`9A-SPEED` is a Strip annotation. Splits by speed exist (H90), and a split's assignment must be recorded on the departing
part's flight data and shared with every Facility like the other two. **That is the only reason speed gets a cell**, and
what H100 DR-11 (b) leaves of the earlier draft is exactly this and nothing more:

- **Kept (the split assignment needs it):** `clearance.speed`, the same append-only cell (ACTIVE / SUPERSEDED / STRUCK,
  plus VOIDED from ADR 0100), values `250` (knots) or `M0.85` / `M.85` (Mach), format-parsed only. It is a **recorded
  assignment with no conformance**: no check against the track's speed, no monitor, no alert, and **no control axis**
  (ADR 0101 has no SPEED scope, no `control: 'SPEED'` Block attribute and no attestation for a speed entry; speed
  restrictions are rare and are not checked on the Strips, H100).
- **Kept (so the assignment is visible on the part's Strip, finding F4):** a place to read each of the three assignment
  cells on every split-eligible strip type: DEPARTURE gains `9A-VECTOR` and `9A-SPEED` clearance Blocks, OVERFLIGHT gains
  `9A-SPEED`. Without them a split by heading or speed on an airborne DEPARTURE or OVERFLIGHT would be invisible.
- **Kept, narrowly:** ARRIVAL's `9A-SPEED` is retargeted from the Strip annotation to the cell, only so the speed
  assignment shows in one place on every strip type instead of two. It stays a plain free-entry Block with no control
  meaning (a listed behaviour change; clean start, R3-2). If the lane's step 0 finds this migration costs more than a
  second display place, it may leave the annotation and read the cell in a new read-only Block instead, and says so.
- **Dropped:** everything that treated speed as something to be checked or coordinated (the DES-RELEASE control-axis
  attribute and its tests, any "speed conformance"). DES-SPLIT never had a conformance check, so nothing else changes.

### 4. Eligibility and permissions (authority registry, ADR 0095's AUTH families)

- **Eligible Strips (settled H100 Q-SJ2): any live IFR Strip, airborne or not.** The IFR strip types are DEPARTURE,
  ARRIVAL and OVERFLIGHT; every state except `DROPPED` is eligible (`splitEligibleStates` / `joinEligibleStates` in each
  strip-type family file, listing the non-terminal states). If the flight data carries a flight-rules field that says VFR
  the split is refused (step 0 reports whether the field exists). **Never MISSION** (the MRU side is MARSA and records
  nothing, H89, so its Strip is not an IFR Strip with a separation responsibility to record) **and never the carrier
  Strips** MARSHAL, FINAL, PATTERN (carrier control is its own regime, H92/H93); H100 did not change either exclusion. A
  family without the keys refuses (no silent default; a test holds every family to declaring them, as
  `COUNTABLE_PRE_DROP_STATES` does). Join additionally requires both Strips' types to be join-eligible; they need not be
  the same type (the lead's type and plan win), and a join of one ground and one airborne Strip is allowed with an ack
  warning.
- **"On the ground" is the Strip state, not the track.** Each family declares `groundStates`; a split in one of them needs
  no assignment:
  - DEPARTURE: `PROPOSED`, `PENDING_CLEARANCE`, `CLEARED`, `HELD`, `PUSHBACK`, `TAXI`, `RUNWAY_QUEUE`, `LUAW`;
  - ARRIVAL: `LANDED`, `TAXI_IN`;
  - OVERFLIGHT: none.
  Every other eligible state (DEPARTURE `DEPARTED`, `HANDED_OFF`; ARRIVAL `INBOUND`, `HANDED_TO_TOWER`, `FINAL`;
  OVERFLIGHT `INBOUND`, `IN_SECTOR`, `HANDED_OFF`) is airborne: the assignment is required. `groundStates` is checked
  against `STATES_BY_ROLE` by the same completeness test (every state is either ground, airborne or `DROPPED`). A
  split in a ground state copies the lead's plan as usual; step 0 walks each copied path of a ground DEPARTURE (departure
  release state, takeoff stamp, runway, queue position) and records copy / reset for each: the part that leaves a ground
  Strip has no takeoff stamp.
- **Grants (settled H100 Q-SJ3 c):** `SplitFormation` and `JoinFormation` are a literal capability
  (`FORMATION_OP_KINDS`), never picked up by a `.filter()` over the op kinds. Holders: **every ATC Position**, that is every
  Position of the civil-ATC and Incirlik-military families (APP, CTR, SFA, TWR, GND, CD, OPS, RSU, PAR ... ids as the
  RENAME table spells them; step 0 lists them by family file). Not the tactical (MRU) or carrier families: they own no
  eligible strip type. Whatever the Position holds, it may split or join only **a Strip it owns** (H100 Q-SJ5 a), and
  consolidation applies as for any op.

### 5. Traffic count and metrics (H91's open point)

- **A split part is its own flight** when its Strip drops, counted by the ordinary countability rules (the unit is one
  Strip, H34), with `flightSize` frozen at its drop (`k`, or whatever it is by then) and the lineage
  `splitFromFlightDataId` on the COUNT record so a report can fold it back. The lead drops with `N - k`.
  **settled H100 (Q-SJ4 a)**
- **A joined Strip is not a flight:** `countability()` returns `excludedReason: 'JOINED'` for an `after` with
  `endReason: 'JOINED'`; its aircraft are counted under the lead, whose `flightSize` at its drop includes them. The
  reconciliation stays total (every drop has a record, counted or excluded).
- **Aircraft are conserved:** a 4-ship that splits 2+2 and both parts land counts 2 flights, 4 aircraft at that
  Facility; one that splits and rejoins counts 1 flight, 4 aircraft. A Facility that dropped its own Strip before the
  split keeps the size it froze then.
- `metrics.js` gains two counters per hour and per mission session: `formationSplits`, `formationJoins`. Refusals are
  counted by reason as today (the tap logs board refusals).

### 6. Interactions

- **Undo (ADR 0100):** both ops are undoable within the 10 s window. Undoing a split removes the new Strip and its
  flight data (the ring gets a `gone`, the code is released), and restores the lead's size and Strip. Undoing a join
  restores the joiner's Strip and flight data (un-voided, code re-acquired; a code taken meanwhile warns, D23) and the
  lead's size. Both declare their undo scope per ADR 0100 §3.
- **Cross-Facility replicas:** the new part exists only on the acting Board. A replica of the lead at another Facility
  (an `ACTIVE` coordination link) keeps pointing at the lead and sees its new size through the shared flight data. The
  controller coordinates the new part separately (an ordinary HANDOFF or TOFI). An exchange still `PROPOSED` blocks the
  split (§1.1).
- **Airspace occupancy (AIRSP phase 2, ADR 0098):** a split adds a flight inside an airspace and a join removes one.
  Occupancy derived from live Strips and flight data follows automatically; if AIRSP stores a count it must recount on
  these two ops.
- **Control release (H94):** a split part starts with no release state of its own (its Strip is new and owned here);
  the lead's release record is unchanged.

## Alternatives considered

- **N-way split in one op** (4 into 1+1+2). Rejected: H89, splits are binary.
- **Keep one flight data record for both parts** (two Strips on one record). Rejected: one record has one beacon code,
  and H90's whole point is that each part correlates to its own track; it would also make every per-flight field (the
  assignment, the code, the size) ambiguous.
- **A default callsign** (VIPER1 → VIPER12). Rejected: H91.
- **Join as a new terminal state `JOINED` in every strip type's state list.** Rejected: it would add a state to every
  lifecycle and every table keyed by state (NLA, Bays, countability) for an end that behaves exactly like a drop. A drop
  with `endReason` reuses archiving, code release, MARSA retirement and the delta's `gone`.
- **Count a split as one flight** (fold the parts at drop). Option (b) of Q-SJ4, not chosen (H100 picked (a)); it would need cross-Strip state in
  the count, which today is a pure function of one log entry.
- **Speed as a Strip annotation** (today's ARRIVAL `9A-SPEED`). Rejected for the split assignment: an assignment is the
  flight's, shared across Facilities, like heading and altitude (ADR 0058). Equally rejected: giving speed a conformance
  check or a control axis (H100 DR-11 b).
- **Optional assignment on MARSA return, or a "back from MARSA" exemption.** Rejected by the human (H100 Q-SJ1 b).
- **Airborne-only splits, or only the radar Positions.** Rejected by the human (H100 Q-SJ2, Q-SJ3 c).

## Consequences

- New op modules `board/ops/split-formation.js`, `board/ops/join-formation.js`; a flight-data store method for the
  copy; `clearance.speed` (a recorded assignment, no conformance); Block-map entries for the assignments; `countability()` and the COUNT record gain
  `JOINED` and `splitFromFlightDataId`; two metrics counters; the authority registry gains the eligibility keys and the
  formation grant.
- The audit entry gains an optional `records` array (other Strips one Mutation changed on the same Board). ADR 0083's
  "one outcome, one entry" holds: still one entry per Mutation per Board. Readers that need every Strip change use one
  helper, `stripChangesOf(entry)` (the addressed Strip, then `records`).
- Wire: two new op kinds on `efsp-mutation`, and new Strip and flight data fields (`splitFrom`, `endReason`,
  `joinedInto`, `identity.splitFrom`, `voided`, `clearance.speed`). No compatibility (R3-2).

## Built notes (SJ-S)

- **No flight-rules field exists** on the flight data, so §4's "refuse a flight whose flight rules say VFR" is not built: the
  IFR strip types (DEPARTURE, ARRIVAL, OVERFLIGHT) are the whole test.
- **DEPARTURE already has heading and altitude Blocks** (`20`, `21`); it gains only `9A-SPEED`. OVERFLIGHT (`7A`, `9A-VECTOR`)
  gains `9A-SPEED`; ARRIVAL's `9A-SPEED` is retargeted from the Strip annotation to the speed cell. The client's Block Map
  mirror got the same three entries (the parity test); the template rows are SJ-C's.
- **The grant is `FORMATION_OP_KINDS`** in `authority/op-kinds.js`, listed literally in the civil-atc and Incirlik-military
  Position sets (OPS, CD, GC, LC, AP, CTR, RSU, SFA, PAR). It is not in `OP_KINDS`, so no `.filter()` grant picks it up.
  Eligibility reaches the Board as one injected rule, `formationEligibility(stripType)`, read from the strip-type families'
  `splitEligibleStates`, `joinEligibleStates` and `groundStates`.
- **Reasons:** the assignment refusal is `ASSIGNMENT_REQUIRED`; every other gate is `VALIDATION_ERROR` with a detail (or
  `NOT_OWNER`, `STALE_REV`, `NOT_FOUND`, `PERMISSION_DENIED` as the dispatcher gives them).
- **Flight data:** `createSplitFlightData` copies by the table in `docs/wip/SJ-S.md`; `setFormationSize` and `voidFlightData` are the
  other two writes. A size change leaves `updatedAt` alone (not a plan amendment).
- **Traffic count:** `stripChangesOf(entry)` is the one reader of `records`; `undoneDrops(entry)` generalises `isUndoOfDrop`
  (an Undo that takes a dropped Strip out of DROPPED or removes it); `splitFromFlightDataId` rides the COUNT record.
- **Wire:** the mutation ack gains `splitStripId` and `split` (a split) or `join` (a join); the new Strip and flight data ride the
  one Board broadcast. Strip fields `splitFrom`, `endReason`, `joinedInto`, flight data fields `identity.splitFrom`, `voided`,
  `clearance.speed` joined the persisted-shape allow-list.
- **Undo:** both modules declare their scope per ADR 0100 (split: lead Strip and flight data, creates the part, its flight data and
  code; join: both Strips and flight data, the joiner's code and MARSA relations).
