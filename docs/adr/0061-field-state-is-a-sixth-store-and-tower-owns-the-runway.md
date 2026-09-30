# 0061 — Field state is a sixth store with one record per Facility and one runway record per pavement; tower owns the runway, a suspension ends only through an attributable inspection, a runway change needs its acknowledgements before it can begin, and field state rides its own sequence

## Context

Guide §9.7 calls field state "the highest-value military-specific feature in the guide, and it has no civil equivalent", and §13 turns two of its five rules into WP6 acceptance criteria:

- *"A barrier reconfiguration suspends the runway, inhibits takeoff and landing NLA with the reason shown, and requires an attributable inspection-complete action to resume"*
- *"A runway change cannot be initiated without `OPS` and `APP` acknowledgement."*

Before this slice there were two hooks and nothing behind them. The `ops-field-state` Bay (`// WP6 hook, inert`) and `twr-runway-queue`'s one Rack per runway (`rwy-05`, `rwy-23`) were the only runway inventory anywhere. `nla.js` said in four places that the §9.7 inhibits "never trigger here". ADR `0002` (§11.1.3) promised to "persist … field state" from the start, but there was none to persist.

The design is the WP6 plan's Phase 3 (`docs/efsp-wp6-plan.md`), corrected by the human's and the supervisor's rulings in `docs/parallel/decisions.md`. Where those rulings changed the plan, this ADR says so. The rulings are H17–H22, S-Q23–S-Q25, S-L1a–c, S-R2-1, -2, -5, -14 and -15, plus the recommended answers to Q26–Q30, Q35, Q36 and Q40, which S-ALL adopted.

## Decision

### A sixth store: one instance, one record per Facility with a runway inventory

`crc-sync/src/efsp/field-state-store.js` (`FieldStateStore`) is a peer of the other five. It is **not** a subsidiary of the Board. Guide §9.1 says so itself: *"the field-state model (§9.7) is a peer of the Strip model, not a subsidiary of it"* (the sentence `docs/adr/0034` quotes).

There is one instance for the whole server, for `AirspaceStore`'s reason: nothing about a runway is ever handed across a Facility boundary, so no D13 replica question arises. The store holds one record per Facility that has a runway inventory, which today means INCIRLIK only. `rev` is per Facility record, so two controllers reconfiguring the field at once collide on `STALE_REV`. That is correct, and not costly.

The store has the shape of its peers: its own sequence, `setMutationLog`, one `apply()` that never throws and returns the current record with every result, and append-only `transitions[]`. It audits **every** outcome, including `STALE_REV` and `NOT_FOUND`. That follows correlation (`0045`), not airspace, because a refused `BeginRunwayChange` is the most interesting refusal here. Audit entries carry their own id field, `fieldStateFacilityId`, and the `runwayId`.

The pure rules live in `field-state.js`, in the `correlation-match.js` → `correlation-store.js` relationship: the status machine, how a Strip's runway is resolved, the inhibit wording, and the into-wind end. That module requires nothing from the EFSP tree, so `facility-config.js` can require it without a cycle.

### One runway record per pavement, not per direction (S-Q23)

The plan had one record per direction (`rackId: 'rwy-05'`). Status belongs to the pavement: a barrier change closes 05 and 23 together, and a per-direction model would let 23 stay OPEN while 05 was suspended for the same cable. So a runway is `{ runwayId: '05/23', ends: ['05','23'], endHeadingsTrue, rackIds: { '05': 'rwy-05', '23': 'rwy-23' }, arrestingGear }`, and the Facility holds which **end** is active (`activeRunway: '05'`).

### Inventory is config, read once; everything that changes is store state

The runway list, ends, true headings, rack mapping, gear, acknowledgers, inspection authority and pad names are a `fieldState` key in INCIRLIK's `DEFAULT_CONFIG`. §8.2 assigns runways, the rack-per-runway mapping and gear to Facility adaptation, and the shallow merge in `_loadOne` means the shipped JSON needs no edit. The runway list is not derived from rack ids: a rack is a Strip container, and a Facility that laid its queue out differently would silently have no runways (`0041`'s class of silent failure).

Per decision **P5**, the inventory is read **once at startup and never written by code**. `FieldStateStore` never calls `setFacilityConfig` and writes no config or state config file; a change applies on restart only. Status, suspension, closure, inspection, pending requests, the active end and any runway change live **only** in the store and the Board snapshot. The snapshot in turn holds no inventory, and it is reconciled against config on restore (the airspace precedent, `0048`). Otherwise `setFacilityConfig`, which persists the merged config to `state/`, could pin a runway's status on disk forever.

`validateConfig` **rejects** a malformed inventory, because a malformed one can never work in any deployment (the radar-selector precedent). It **warns** when a runway end names a rack no `RUNWAY_QUEUE` Bay has, or when such a rack is claimed by no end.

Every shipped value is `[SOURCE-DEFINED]` squadron data: the true headings 056/236 (approximate, for the squadron to verify), the acknowledgers `['OPS','APP']`, inspection authority `OPS`, and the pad names.

### Tower owns the runway (H18, S-L1b)

The plan made OPS the owner of the barrier family. The human ruled that **tower is the sole authority over the runways**, so the table in `permission.js` is:

| Op | Owner |
|---|---|
| `CloseRunway`, `OpenRunway`, `BeginBarrierChange` (a closing) | TWR |
| `RequestRunwayStatus {action: CLOSE \| OPEN \| BARRIER_CHANGE}` | OPS, CD, GND, APP |
| `AcceptRunwayRequest`, `RejectRunwayRequest` | TWR |
| `CompleteBarrierChange`, `CompleteInspection` | OPS |
| `Propose`/`SelfCoordinate`/`Withdraw`/`Begin`/`CompleteRunwayChange` | TWR |
| `AckRunwayChange`, `RejectRunwayChange` | OPS, APP |

An accepted request is carried out **as** tower's own op, through the same checks, attributed to TWR and naming who asked (`requestedBy`). A request that a direct tower op has made moot is settled in the same transition.

The permission predicate is `canActOnFieldState(actingPositionId, opKind)` over an explicit `FIELD_STATE_OP_OWNERS` table. It is **not** an entry in `OP_KINDS`: every `PERMISSIONS` row built with a `.filter()` would silently pick a new kind up (the D21 trap), and a test pins that none is there. It has exactly two parameters, so it can never take a held set (D21 by construction). A range Position, an MRU, CTR or an unknown Position is refused by being absent from every row.

Two rows are ceilings that the store narrows further and never widens. `CompleteInspection` is narrowed to `fieldState.inspectionAuthorityPositionId`. `Ack`/`RejectRunwayChange` are narrowed to the change's frozen acknowledger set.

**Inspection authority is not configurable wider than OPS.** Widening it needs config-derived permissions (`0035`'s shape), which is a bigger change than this deliverable.

### Rules 1–2: a suspension ends only through the inspection

The statuses are §9.7's verbatim: `OPEN | CLOSED | SUSPENDED_BARRIER_CHANGE | SUSPENDED_INSPECTION`, in a `LEGAL_TRANSITIONS` table in `airspace-store.js`'s shape. **`SUSPENDED_BARRIER_CHANGE → OPEN` is not a legal edge; that absent entry *is* rule 2.** `SUSPENDED_* → CLOSED` is also absent, because it would let suspend → close → open reopen a re-rigged runway without an inspection. A graph test pins that every path from `SUSPENDED_BARRIER_CHANGE` to `OPEN` passes through `SUSPENDED_INSPECTION`.

`CompleteInspection` stamps `lastInspection = {at, by, positionId, note}`. That is rule 2's attribution, and it is written to the Mutation log. Attribution needs no new mechanism, because `actingPositionId` is session-bound (`0029`).

**The gear is data only (H17, S-L1a — provisional, desk item L1-W1).** DCS does not simulate arresting wires. The §9.7 gear shape is validated when present, Incirlik ships `arrestingGear: []`, and there is **no `SetGearState`** (so there is also no Q39 out-of-service op). A suspension carries `suspension.kind` (`BARRIER_CHANGE`, or `RUNWAY_CHANGE`), and the barrier wording lives in one label table. If the human answers "a generic works + inspection suspension", that is a rename, not a rework.

### Rule 1: the inhibit is on the button, the drag, the advisory stamp and `SetState`

`nla.js` reads one new ctx rule, `fieldStateFor()` (default `() => null`: every pre-L1 caller and every hand-built ctx fails open). `board-store.js`'s `_nlaCtx()` threads it, which puts the inhibit on **every** `computeNla` call site at once:

- the button (`_applyInvokeNla`);
- the advisory `nla` stamp every Strip carries (`nlaStatusFor`), which is how "with the reason shown" reaches the client with no new client code;
- the **drag** (`_validateBayImpliedTransition`). §3.5 rule 4 makes NLA an accelerator, never the only path.

The inhibited transitions are DEPARTURE `TAXI → RUNWAY_QUEUE`, `RUNWAY_QUEUE → LUAW` and `LUAW → DEPARTED`, and ARRIVAL `HANDED_TO_TOWER → FINAL`. Each is checked before the occupancy gate. **`FINAL → LANDED` is never inhibited:** it is an observation that the aircraft touched down, and refusing it would make the board lie and strand a landed aircraft (H19: nothing special for an emergency; the Strip waits).

The reasons, in `nla.js`'s lower-case style (Q40), are:

- `runway 05/23 suspended — barrier change`
- `runway 05/23 suspended — awaiting inspection`
- `runway 05/23 closed`

**`CLOSED` inhibits too (Q28).** That goes beyond rule 1's letter, which names only `SUSPENDED_*`, and is `[SOURCE-DEFINED]`: a closed runway is at least as unavailable.

**Runway resolution (S-Q25, Q27).** The runway is resolved from the target rack of a drag, then the rack the Strip sits in, then its FDR field (8A for a DEPARTURE, 8B for an ARRIVAL, normalised), then the Facility's active end, then nothing. Every step records its source. An unresolvable runway, one not in the inventory, or a Facility with no field state **fails open**, because an inhibit that fires on bad data strands aircraft. OVERFLIGHT and MISSION Strips never resolve.

The target rack comes first on the drag path because the plan's version checked where the Strip *was*, not where it was going (plan T7, question Q27).

**Placement by runway (Q26, S-R2-1).** Every place that files a Strip into `bay.rackIds[0]` now goes through one helper, `runwayRackFor(strip, fdr, view, bay)`. That covers ConvertToArrival, `_relocateForImpliedState`, the NLA transfer in `_applyInvokeNla`, and coordination accept. In a runway-queue Bay the helper picks the end the FDR names, else the active end; anywhere else it keeps the first rack as before. Without it, every NLA-queued departure sat in `rwy-05` and was judged against 05 after a change to 23.

**`SetState` honours the runway inhibit (S-R2-14).** The raw override may not put a Strip into a runway-using state (`RUNWAY_QUEUE`, `LUAW`, `DEPARTED`, `FINAL`) while its runway is unusable. It may still record `LANDED`. Every other NLA gate `SetState` bypasses stays bypassed; who may use `SetState` at all is L23's.

A same-state move between `rwy-05` and `rwy-23` stays allowed, since it is how a controller re-sequences or sends a Strip to an open surface at a two-runway field. At Incirlik both racks are one pavement, so the move does not escape a suspension.

**Occupancy is not implemented.** §9.7's schema has no occupancy field, and §3.5's `RUNWAY_QUEUE` row cites no section, so inventing one would be D11. The `nla.js` comments now say so rather than implying coverage.

### Rule 3: the runway change is its own machine

`board-store.js`'s coordination primitives cannot carry it. They are Strip-attached, cross-Facility by construction (TWR, OPS and APP are all INCIRLIK), and one-proposer/one-responder with no way to express an AND. So the change is a record on the field state:

```
null ─Propose(TWR)→ PROPOSED ─(every acknowledger acked, any order)→ ACKNOWLEDGED
     ─Begin(TWR)→ IN_PROGRESS ─Complete(TWR)→ PENDING_INSPECTION
     ─(OPS CompleteInspection on each runway in the set)→ null
PROPOSED/ACKNOWLEDGED ─Reject(an acknowledger) | Withdraw(TWR)→ REJECTED (terminal; a new proposal replaces it)
```

**§13's second criterion is `BeginRunwayChange`'s single guard, `runwayChange.state === 'ACKNOWLEDGED'`.** That assertion was written first and watched fail. Acks are not retractable (reject instead) and there is no timeout (Q35). Nothing after `Begin` can be withdrawn, because the change is physically under way.

- **Acknowledgement is coordination, not permission (H20).** The acknowledger set is frozen at propose time from config and from who is manned. An acknowledger nobody holds is **skipped and recorded** (`{skipped:true, reason:'UNMANNED'}`, with `skippedAcknowledgers` on the transition), never a deadlock.
- **No cross-Facility reversion (S-R2-15).** The plan's reading of §4.1, CTR answering for an unmanned APP, is **not** built. An unmanned APP is skipped and audited like any other.
- **One input for a solo controller (S-Q24).** `SelfCoordinateRunwayChange` is legal only when the session is Primary on TWR (checked at the wire) and on every manned acknowledger. One Mutation takes the change straight to `ACKNOWLEDGED`, naming each Position with `selfCoordinated: true`. This is guide §4.8.3 rule 3.
- **The D21 case.** The plan's D21 test becomes *"an ack sent as TWR never counts as APP's"*. A two-party ack from a controller who also proposed is allowed and flagged `selfCoordinated` (the airspace `_approveActivation` precedent).
- **A runway change is also a suspension (Q29).** `IN_PROGRESS` changes no status. `CompleteRunwayChange` moves `activeRunway` and puts the new end's pavement (and the old one's, if it is a different surface) into `SUSPENDED_INSPECTION` with `suspension.kind: 'RUNWAY_CHANGE'`. Rule 1 therefore holds the new runway until OPS inspects it, with no new inhibit path. It is refused if a runway in that set is mid barrier change or closed.
- **Where the two families meet.** Rules 1–2 and rule 3 are separate families and meet at exactly one point: `CompleteInspection` both reopens a runway and drains `pendingInspection`. When the drain empties, the change goes into `transitions` and clears. The guide's derived bool `runwayChangeInProgress` is computed on read (true in `IN_PROGRESS` and `PENDING_INSPECTION`).

### The active runway comes from the mission wind (H22, S-L1c, S-R2-2)

There is no config default. On `mission-load`, a delimited hunk in `server.js` fetches the wind at each Facility's `fieldState.airportIcao` and calls `setActiveRunwayFromWind`, which picks the end with the largest headwind component.

The DCS wind is in degrees **true** and is compared with each end's **true** heading from the inventory, never with the magnetic end number times ten. It is applied once per mission key. crc-sync hears `mission-load` on every gRPC reconnect, so a reconnect or a restart must not undo what TWR has since chosen. It is never applied while a runway change is open, and it is audited as the system actor `crc-sync`.

The mission key is `field-state.js`'s `missionKeyOf`, a fingerprint of the theatre, navpoints and drawings, passed in as a parameter. F3's `mission-session.js` replaces it (S-R2-2). Until the first mission load, `activeRunway` is null, and a Strip that resolves by no other means is not inhibited.

### Rule 5: its own sequence and delta — a deliberate deviation

The guide says field state changes *"MUST broadcast on the Board sequence like any other Mutation"*. **That is not followed literally.** `boardSeq` is not a counter: it is the index into `board-store.js`'s `_log` ring that `getDeltaSince` replays for a reconnecting client, and that ring holds Strips. All three literal readings break:

1. **Field state inside `BoardStore`** contradicts §9.1 ("a peer of the Strip model").
2. **Bumping `boardSeq` from outside** leaves `getDeltaSince` with no record at that index, a gap the client cannot detect.
3. **Riding `efsp-board-delta` without bumping** silently drops field state from resync, so **a controller reconnecting after a suspension sees an OPEN runway**. That is worse than the bug the sentence guards against.

The sentence's real job is the contrast (broadcast and audited, not a fire-and-forget alert). The Airspace/Correlation shape honours both halves:

- The store has its own sequence, sent as `fieldStateSeq`.
- A successful op acks the sender (`efsp-field-state-ack`) and broadcasts `efsp-field-state-delta` to everyone.
- The snapshot carries `fieldStates`, and there is no `efsp-resync` branch: a reconnect gets the snapshot.
- Every op, refusals included, is in the Mutation log from the store onward (S-R2-5; the wire-level `NOT_HOLDING_POSITION` is L5's tap).

A field-state op changes the `nla` stamp of Strips it never touched. So after a successful op the handler ticks the NLA status monitor, which re-stamps only the Strips whose status moved and sends them on the ordinary board-delta. The reason reaches every controller at once, rather than on the next 15-second sweep.

The session binding is `_handleMutation`'s **per-Facility** check (`0029`, the fifth dispatch path to carry it), not "Primary somewhere". A field has exactly one Facility, and OPS at INCIRLIK must not act on a runway elsewhere.

### A suspension survives a restart intact

Field state is in the Board snapshot and is restored after MARSA, reconciled against the inventory. A Facility with no inventory is skipped, a runway no longer configured is dropped, and a newly configured one starts OPEN. A runway change naming an end no longer configured is cleared with a warning.

Otherwise the state comes back **exactly** as it was: `SUSPENDED_BARRIER_CHANGE` with who suspended it, a half-acknowledged change with its acks, the active end. This is the MARSA precedent (`0051`): a fact a person recorded is not made untrue by a crc-sync restart, and coming back OPEN would hand the next controller a lie (§4.8.3). The sequence number is not persisted, matching the airspace store.

### Pads present, empty

`hotCargoPad` and `alertPad` are on the record as `{name, occupied:false, occupantFdrId:null}`. The names come from config placeholders, with no geometry and no preferred direction (Q36, H21). No op touches them; L12 and L13 give them meaning.

## What this changes in earlier ADRs (P4 — none is edited)

- **`0002`** (§11.1.3, "persist … field state"): this is where that finally becomes true. Field state is in the durable Board snapshot.
- **`0034`** quotes §9.1's "peer of the Strip model". This store is that peer, and it relies on the quote.
- **`0052`** built `3F` and said §9.7's gear-mismatch check "now [has] data to read". **This ADR does not build that check.** `gearMismatchFor(fdr, runway)` (rule 4) is L1b's, computed rather than stored. Under H17 there is also no gear state to mismatch against until the human answers L1-W1.
- **`0056`** has §9.7 reasons render "under the NLA". That rendering is L1b's client work. The reasons are already on the wire in each Strip's `nla` stamp.
- The "§9.7 never triggers" stance lived only in `nla.js` comments. Those comments are replaced.

## Alternatives considered

- **One record per runway direction (the plan).** Rejected per S-Q23: status belongs to the pavement.
- **OPS owns close/open/suspend (the plan), or OPS and TWR may close (Q32's recommended answer).** Overruled by H18: tower alone. Q4's option (b) is recorded here for completeness.
- **`SetGearState` legal only while suspended (the plan), and Q39's out-of-service op.** Not built: gear is data only (H17).
- **A config default active runway (Q38's recommended answer).** Overruled by H22: derived from the wind.
- **Only `SUSPENDED_*` inhibits (rule 1's letter).** Rejected (Q28): launching onto a closed runway is the worse error.
- **Leaving NLA placement on `rackIds[0]` (the briefing's default).** Overruled by Q26 and S-R2-1: rule 1 would judge the wrong runway after every change.
- **Riding the Board sequence (rule 5's letter).** Rejected, for the three reasons above.
- **Relying on the 15-second NLA sweep for other controllers' Strips.** Too slow for "with the reason shown"; the monitor is ticked instead.
- **CTR acknowledging for an unmanned APP.** Rejected by S-R2-15 for wave 1.

## Consequences

- Both §13 field-state lines are asserted word for word in `tests/efsp-scenario-field-state.test.mjs` (sorties 1 and 2). The D21 case is in `tests/efsp-permission.test.mjs`, with its behavioural twin in sortie 13. Restart mid-suspension is sortie 11.
- **Not implemented, and the comments say so:** runway occupancy; configurable (widenable) inspection authority; gear state changes and the hook-mismatch check; cross-Facility acknowledger reversion; an audited emergency override for landing on a suspended runway (H19 keeps it a candidate).
- `SetState` still bypasses every NLA gate other than the runway one. Owner-checking it is L23's.
- `server.js`'s hunk broadcasts the wind-derived change through `WsHub._broadcast`, because `ws-hub.js` has no field-state broadcaster and was not this lane's file. A public method is a follow-up.
- The client (the field-state dock panel, inhibit rendering, request/ack UI) is L1b's. Until it lands, the new ops are reachable only on the wire. The `ops-field-state` Bay stays an inert Strip container, and its comment now points at the panel.
