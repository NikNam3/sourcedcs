# 0040 — The departure leg is archived rather than erased, and airspace ops reach the audit log

## Context

Two places where the system was losing information it had been given, found by asking where bugs might still be rather than by a failing test.

**`ConvertToArrival` erased every annotation on the Strip.** docs/adr/0023 built it to turn a returning flight's `DEPARTURE` Strip into its `ARRIVAL` leg in place, and reset `annotations`/`flags`/`coordination`/`correlation` to fresh-Strip defaults on the reasoning that *"none of them mean the same thing under the new role."* That reasoning is sound for the live set and wrong for the values: `strip.annotations = {}` discarded controller-entered text outright.

Three things compound it. The button (`Convert to Arrival →`) renders unconditionally on any `DEPARTURE` Strip at `HANDED_OFF`, which is where a Strip sits for its entire enroute life — so it is always present and one click away. There is no Undo: `_applyInvokeNla` records into `_nlaHistory` only for NLA transitions, and `ConvertToArrival` is a separate op kind that records nothing, so §3.5 rule 5's 30-second window has never covered it (docs/adr/0009 scoped Undo deliberately narrowly, to state-only NLA transitions). And the annotation model is append-only for exactly this reason — guide §3.7 quotes FAA JO 7110.65 ¶2-3-1, *"Do not erase or overwrite any item"*, the same clause docs/adr/0032 cited when it made `airspace.owner` keep its history and docs/adr/0018 cited when it routed that field through a dedicated setter. A role change is not an exception to it.

**Airspace ops reached the Mutation log not at all.** docs/adr/0036 gave them a separate dispatch path for good reasons — `efsp-ws.js`'s `_handleAirspaceMutation` calls `AirspaceStore.apply`, never `BoardStore.applyMutation`, because that path is built on `mutation.stripId`, a Strip's `baseRev` and the Strip-owner check, none of which mean anything for a record no Position owns. What came with that separation was the loss of `BoardStore._recordAudit`, and nothing replaced it.

The airspace record's own `transitions` array is not a substitute. It holds where an airspace has *been* — the states it moved through, who moved it — and structurally cannot hold what was *asked for*. A `RequestActivation` that is refused changes no state and appends no transition, so a denial left no trace anywhere in the system. For a feature whose entire purpose is recording who authorised entry into a block (§9.11: *"coordination and approval must precede airspace entry and exit"*), the refusals are at least as interesting as the approvals.

## Decision

### The departure leg is archived on the Strip

`_applyConvertToArrival` captures the outgoing leg before clearing it:

```js
strip.previousLeg = {
  role: 'DEPARTURE',
  annotations: strip.annotations,
  flags: strip.flags,
  convertedAt: Date.now(),
  convertedBy: by || null,
};
strip.annotations = {};
strip.flags = newFlags();
```

`previousLeg` is seeded `null` on every Strip at creation, alongside `coordination`/`tofiCoordination`/`airspaceEntry`.

**Clearing the live set is still correct**, and this changes nothing about that. docs/adr/0023's reasoning holds: the Block Maps differ between roles, so a `DEPARTURE` Strip's Block `8B` (destination airport) and Block `9A` (route restriction) do not mean what the same Block IDs mean on an `ARRIVAL`. Carrying the values across would not preserve them — it would relabel them as statements about the return leg that nobody made. The archive keeps them as what they were: annotations on the departure.

**The archive lives on the Strip rather than only in the Mutation log.** The log had it all along — `BoardStore._recordAudit` writes `before` for every successful Mutation, including this one, so the values were technically recoverable by reading `efsp-mutations.jsonl`. That is not the same as being available. A controller asking *"what did Ground tell them on the way out"* is looking at the Strip in front of them, and a record that requires a file read and a JSONL parse to reach is, operationally, a record nobody has.

Client side: the button asks twice when there is something to lose. With annotations present it relabels to `Convert — press again` on the first press and dispatches on the second, with a title naming the count; with none it fires on the first press as before. This is the same two-press pattern `efsp-panel.js` uses for the duplicate-callsign warning (`_pendingDuplicateCallsign`), for the same reason — the action is legitimate and occasionally destructive, so the right answer is friction rather than a refusal. A `previousLeg` badge (`DEPARTURE ×2`) then sits on the return-leg Strip, its tooltip listing each archived Block and its values.

### `AirspaceStore` writes to the Mutation log

`setMutationLog(mutationLog)` mirrors `BoardStore`'s exactly, wired in `index.js`'s composition root, with `_recordAudit` called from `apply` after every op. Two deliberate differences from `BoardStore`'s version:

**`airspaceId`, not `stripId`.** An airspace op targets no Strip, and reusing the Strip field for something that is not one would corrupt every existing reader of the log. A reader keys on whichever id is present.

**Failures are logged too, with `reason` and `detail`.** `BoardStore._recordAudit` returns early on `!result.ok` and records successes only, which is defensible there — a rejected Strip Mutation leaves the Board unchanged and the client gets the rejection. It is not defensible here. A refused activation request is the one case that leaves no transition on the record, so the log is the only place it can exist, and "who asked for this block and was told no" is a question an after-action review will ask.

## Alternatives considered

- **Make `ConvertToArrival` undoable** instead of archiving. Rejected as disproportionate: Undo would have to restore `role`, `state`, `bayId`, `rackId`, `orderKey`, the annotations, the flags *and* the `filed.originAirport` write on the FDR — an ownership-and-identity reversal of exactly the kind docs/adr/0009 deliberately kept Undo away from, having found that a stale `_nlaHistory` entry across a transfer could produce a Strip in a state/owner combination that never legitimately existed. Archiving solves the data loss; the two-press confirm solves the misfire.
- **Carry the annotations across unchanged.** Rejected: it does not preserve them, it mislabels them. The Block IDs mean different things under the new role, so the same text under the same Block ID becomes a different claim.
- **Leave the values to the Mutation log** and add nothing to the Strip. Rejected: see the Decision. The information existed but was not reachable by the person who needed it, at the moment they needed it.
- **Archive to the FDR** rather than the Strip. Rejected: annotations are Strip state, not flight state (guide §3.1's separation, and the reason `board-store.js` owns them at all). On the FDR they would outlive the Strip that made them and be visible to every replica of the flight, including ones at other Facilities that never saw the departure.
- **Log airspace ops from `efsp-ws.js`** rather than from the store. Rejected: it would record only what arrives over the WebSocket, missing any other caller (a future scheduled activation, an admin tool, a test driving the store directly), and it breaks the symmetry with `BoardStore` that makes the audit path findable at all.
- **Log airspace failures nowhere**, matching `BoardStore`'s successes-only rule for consistency. Rejected: consistency in the wrong direction. The asymmetry is justified by the asymmetry in what the two stores lose — a rejected Strip Mutation leaves the Board's own state as the record, and a refused airspace request leaves nothing.

## Consequences

- `previousLeg` is Strip state, so it rides the durable snapshot (docs/adr/0002) and every `efsp-board-delta` like any other field. It costs one copy of the annotation set per converted Strip, which is bounded by how much a controller typed on one departure.
- It is written **once**: `ConvertToArrival` only ever converts `DEPARTURE` → `ARRIVAL`, and refuses any other role/state, so there is no accumulation and no need for a list. A future op converting some other pair would need to decide whether to chain or overwrite, and should say so in its own ADR.
- Airspace log entries carry `airspaceId` and no `stripId`. Anything reading `efsp-mutations.jsonl` must key on whichever id is present rather than assuming every line has a Strip — which is also true of the `ok`/`reason`/`detail` fields, present only on airspace entries.
- `tests/efsp-scenario-concurrency.test.mjs` asserts both halves of the log change: a successful `ScheduleAirspace` with its `actingPositionId` and no `stripId`, and a refused `ApproveActivation` carrying `ok: false` and `reason: 'PERMISSION_DENIED'`. `tests/efsp-scenario-coordination.test.mjs` asserts the archive — annotations cleared from the live set and present under `previousLeg`.
- **The concurrency suite added alongside this found nothing, and that is the finding.** `tests/efsp-scenario-concurrency.test.mjs` runs two controllers at one Board: colliding writes on a shared revision, the same `clientMutationId` replayed after a lost ack (§5.2's idempotent replay), both ends of a handoff acting simultaneously, a client resyncing inside and outside the ring-buffer window (§5.6's two paths), and a Mutation replayed against a Strip whose role changed while its client was away. All eleven passed on the first run. This was the largest untested dimension in the system, and D6 names a silently lost Mutation *"the worst failure mode in the system"* — having established that the optimistic-concurrency layer holds under contention is worth recording, because the next person to wonder should not have to re-derive it.
