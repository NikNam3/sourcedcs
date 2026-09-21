# 0036 — Airspace activation is a request/approval round trip, with the approving authority configured per airspace

## Context

Guide §9.11 is **verified**, not `[SOURCE-DEFINED]`, which raises the bar for deviating from it:

> Verified: the **RAPCON, not the flying squadron, holds airspace activation authority**, and coordination and approval must precede airspace entry and exit `[Annex §13.3]`.
>
> Model airspace activation as a state owned by `APP` (with `RANGE` as the using agency that schedules and releases it), with request and approval as recorded actions. Aircraft entering unactivated airspace MUST alert. Ownership is a direction, never a boolean — §4.6.4.

Two things in that are separable, and the distinction is the whole ADR. The *principle* — the using agency does not activate its own airspace; ATC approves, and approval precedes entry — is verified doctrine. The *specific Position*, `APP`, is an instance of it: §0's operating environment models Incirlik as *"a US-operated joint-use base with a RAPCON holding delegated airspace"*, so for a range complex inside Incirlik's delegated airspace the RAPCON is `APP` and the guide names it directly.

That instance does not generalise. The project owner's picture is that MOAs are owned by whoever owns the airspace they sit in — Ankara Center for the ones around Incirlik. Fixing the approver to `APP` would have Incirlik Approach approving airspace it does not own and has no delegated authority over, which contradicts the verified principle while literally obeying the sentence.

docs/adr/0032 listed *"is activation a Mutation?"* among the questions it deferred. It is not — see below.

## Decision

**The approving authority is `definition.controllingPositionId`, configured per airspace.** `airspace-config.js` requires it on every record. A MOA under Ankara Center names `CTR`; a range inside Incirlik's delegated airspace names `APP`, which is §9.11's own case, unchanged. The generalisation preserves the principle the clause states and drops only the assumption that one RAPCON owns everything.

**The op set, and who may run each:**

| Op | Acting Position | Effect |
|---|---|---|
| `ScheduleAirspace` | using **or** controlling | → `SCHEDULED`, with a `{fromUtc, toUtc}` window |
| `RequestActivation` | using | records `pendingRequest`; state unchanged |
| `ApproveActivation` | controlling | → `ACTIVE` |
| `DenyActivation` | controlling | clears the request, records `lastDenial`; stays `SCHEDULED` |
| `ReleaseAirspace` | using | → `RELEASED` |
| `ReturnAirspace` | controlling | → `RETURNED`, window and request cleared |

The split is §9.11's: *"`RANGE` as the using agency that schedules and releases it"*, ATC approving and taking back. `_isControlling` and `_isUsing` are the only authority predicates, and every op checks exactly one of them (`_schedule` accepts either, since booking is not an authority question).

**An airspace with no using agency has no request step, and that is the common case.** `_isUsing` falls back:

```js
_isUsing(definition, actingPositionId) {
  if (definition.usingPositionId) return definition.usingPositionId === actingPositionId;
  return this._isControlling(definition, actingPositionId);
}
```

For an ordinary MOA (docs/adr/0035: no `usingPositionId`, because nobody controls it), the controlling Position acts for both sides. `_approveActivation` mirrors this — it requires an outstanding `pendingRequest` only `if (definition.usingPositionId)`, so `CTR` schedules and activates its own MOA directly, with no second party to ask. This is not a bypass of §9.11: there is no flying squadron on the other side of the exchange to hold authority away from. Where a real range control exists, the round trip is mandatory and `_approveActivation` refuses without a request.

**Self-coordination is recorded, not collapsed.** Guide §4.8.3: a boundary event between two Positions held by one controller *"MUST be recorded as a self-coordination... The state change is mandatory and unconditional. Only the two-party dialogue collapses."* `_approveActivation` stamps the transition accordingly:

```js
selfCoordinated: !!(request && request.requestedBy && request.requestedBy === (by || null)),
```

so the audit history distinguishes one controller holding both ends from a genuine two-party approval, while the approval itself still happens in full.

**Its own wire message, `efsp-airspace-mutation`.** `_handleAirspaceMutation` in `efsp-ws.js` handles it, returning an `efsp-airspace-ack` to the sender and broadcasting an `efsp-airspace-delta` to everyone. It cannot reuse `_handleMutation`/`applyMutation`: that path is built end to end on `mutation.stripId`, the *Strip's* `baseRev`, and `_dispatch`'s `strip.ownerPositionId !== actingPositionId` ownership gate — none of which mean anything for a record that no Position owns and no Board holds. So activation is not a Strip Mutation; it is an airspace op, with its own optimistic concurrency on the airspace record's own `rev`.

**It carries docs/adr/0029's session binding.** This is the part that was most at risk of being skipped:

```js
const facilityIds = ctx.facilityConfig.getFacilityIds();
const isPrimarySomewhere = facilityIds.some((facilityId) => {
  const positionStore = ctx.positionStoreFor(facilityId);
  return positionStore && positionStore.primaryOf(msg.actingPositionId) === session.controllerId;
});
```

`actingPositionId` arrives as an untrusted client claim, and the entire authority model above is evaluated against it — so without this a client could approve activation of any airspace by naming its controlling Position, exactly the hole 0029 closed for Strips. A new dispatch path is precisely where that gets forgotten. The check spans Facilities rather than one, because the two ends of an exchange live in different ones (`RANGES` and the controlling Facility) and a controller may legitimately hold either.

**The broadcast is unfiltered.** An airspace going active changes what every controller in the theater is looking at, and the client filters by what it holds — matching every other EFSP broadcast rather than inventing server-side scoping for this one.

## Alternatives considered

- **Fix the approver to `APP`, literally per §9.11.** Rejected: it obeys the sentence and breaks the principle. Incirlik Approach would approve activation of a MOA inside Ankara Center's airspace, which it neither owns nor holds delegated authority over. The guide names `APP` as the RAPCON of the range complex it was describing, and §0 is explicit that the RAPCON's authority is *delegated* airspace — authority that does not extend to a Center's.
- **Let the using agency activate its own airspace**, with ATC merely notified. Rejected outright: this is the one thing §9.11's verified clause forbids — *"the RAPCON, not the flying squadron, holds airspace activation authority"*.
- **Model activation as a Strip Mutation**, reusing `applyMutation` and the board-delta protocol. Rejected: see the Decision. Forcing an ownerless, Boardless record through a Strip-shaped dispatch would have meant faking a `stripId` and neutering the ownership gate — and docs/adr/0034 had already established that an airspace is not a Strip.
- **Reuse the 5-primitive coordination machinery** (`_applyCoordinationPropose`/`Accept`) for the request/approval exchange. Rejected: those operate on a Strip's `coordination` record and mint a per-Facility replica (D13). There is no Strip here and nothing to replicate. The shape looks similar — propose, approve, reject — but it is the same reason docs/adr/0025 gave TOFI its own table rather than a sixth row.
- **Require an activation request even for an uncontrolled MOA**, for uniformity. Rejected: it would mean `CTR` sending itself a request and then approving it, which is ceremony with no second party, and §4.8.3's self-coordination rule already covers the case where one controller genuinely holds both ends of a real exchange.
- **Auto-activate a `SCHEDULED` airspace when its window opens.** Rejected: *"coordination and approval must precede airspace entry"* — approval is an act, and a clock is not a controller. The window is a booking, not an authorisation.

## Consequences

- `crc-sync/tests/efsp-airspace-store.test.mjs` covers both authority shapes directly: the using agency is refused `ApproveActivation` on its own airspace, a different airspace's controlling Position has no authority here, approval without a request is refused where a using agency exists and permitted where none does, and the `selfCoordinated` flag distinguishes one controller from two.
- `tests/efsp-scenarios.test.mjs` walks both sorties end to end through the real wire path — a MOA that `CTR` books and activates alone, and a range where the range Position books and asks and `APP` approves, including the explicit assertion that the range cannot self-approve. A separate test asserts the session binding: acting as a Position the session does not hold is `NOT_HOLDING_POSITION`.
- The `efsp-airspace-delta` broadcast rides `ws-hub.js`'s existing generic `result.broadcast` handling, so no change was needed there — the same property that made the message type cheap to add.
- **Airspace ops are not replayed on reconnect.** The client's `sendEfspAirspaceMutation` deliberately does not register a pending mutation: §5.6.3's replay machinery is keyed on Strip identity. An airspace op lost at the moment of disconnect is simply reissued by hand, which is acceptable for an op a controller performs a handful of times a session, but it is a real asymmetry with Strip Mutations and should be revisited if airspace ops ever become frequent.
- **Nothing enforces the booked window.** An airspace can be activated outside its `{fromUtc, toUtc}`, and an active one is never automatically released when the window closes. That is deliberate for now — the window is a booking and a controller's judgment overrides it — but a "scheduled window has elapsed" obligation is the natural companion to docs/adr/0037's unactivated-entry alert, and would fit the existing monitor.
