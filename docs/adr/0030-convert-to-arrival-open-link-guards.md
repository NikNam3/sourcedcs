# 0030 — `ConvertToArrival` refuses an unresolved link, and the coordination/TOFI asymmetry is the whole point

## Context

`_applyConvertToArrival` (docs/adr/0023) turns a `DEPARTURE` Strip at `HANDED_OFF` into its own return-leg `ARRIVAL` Strip in place — same `stripId`, same `fdrId`, no duplicate. As part of resetting the Strip for its new role it nulls both coordination records outright:

```js
strip.coordination = null;
strip.tofiCoordination = null;
```

Its only preconditions were `strip.role === 'DEPARTURE' && strip.state === 'HANDED_OFF'` and the `canCreateStripRole(actingPositionId, 'ARRIVAL')` permission check. Nothing looked at what those two fields *contained* before discarding them — unlike `_applyInvokeNla` and `_applyDropStrip`, which have both guarded open links since docs/adr/0022's live-testing fix.

For the five ATC↔ATC primitives that was survivable, because a Strip carrying an unresolved coordination proposal is rarely also sitting at its own terminus. For TOFI it was not, and the reason is structural: **TOFI never changes the ATC-side Strip's state at all.** docs/adr/0025 is explicit that jurisdiction never transfers — the Strip *stays live and posted throughout tactical control* (guide §4.6.3 rule 2) — so an ATC-side Strip sits at `DEPARTURE`/`HANDED_OFF` for the entire duration of an exchange, from `PROPOSE` through `ACTIVE` to the EXIT. That is precisely this op's entry condition.

So "Convert to Arrival →" rendered and worked at any point during a TOFI exchange:

- against a `PROPOSED` link, it silently orphaned the `MISSION` Strip the proposal had already minted on `TACTICAL`'s Board — which would then wait forever for a response that could never arrive. This is the identical failure mode `_applyInvokeNla`'s own guard comment describes fixing for the five-primitive case, left unfixed here.
- against an `ACTIVE` link, it succeeded and *corrupted* the link: the MRU side kept `tofiCoordination.state === 'ACTIVE'` with a `peerStripId` pointing at a Strip that had forgotten it entirely, and no notification was sent (`receiveTofiResponse` is only called by ACCEPT/REJECT/TRANSFER_COMMS). Worse than docs/adr/0027's Drop bypass in one respect — that one at least had a rejection to bypass; this one had nothing at all.

Found by the end-to-end military sortie trace, at exactly the point where a controller would reach for the button: the return leg.

## Decision

**The same three guards `_applyDropStrip` uses**, in the same order, before any mutation happens:

```js
if (strip.coordination && strip.coordination.state === 'PROPOSED')       → refuse
if (strip.tofiCoordination && strip.tofiCoordination.state === 'PROPOSED') → refuse
if (strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE')   → refuse
```

**The asymmetry is deliberate and is the substance of this ADR:** an `ACTIVE` *coordination* link is permitted; an `ACTIVE` *TOFI* link is not.

An `ACTIVE` coordination link means a `HANDOFF` was proposed **and accepted**. Jurisdiction has already moved, `receiveCoordinationResponse` has already told the peer, and the exchange is finished — the record persists as history, not as an obligation. For a flight `APP` handed to `CTR`, `coordination.state === 'ACTIVE'` is simply the normal, settled condition of CTR's Strip, and converting it for the return leg is *the next thing CTR does*. Refusing there would break the primary civil round trip.

An `ACTIVE` TOFI link means the opposite: tactical control is live **right now**. Because jurisdiction never transfers, the exchange stays open for its whole duration rather than settling on ACCEPT, so `ACTIVE` is a statement about the present, not the past.

This was not reasoned out in the abstract. A first attempt at this guard treated both fields uniformly — refusing `PROPOSED` *or* `ACTIVE` on either — and `tests/efsp-board-store-coordination.test.mjs:773` (*"ConvertToArrival works identically at CTR (CENTER Facility) — a departure handed off from APP, then converted for its return leg"*) failed immediately, with `coordination.state: 'ACTIVE'` in the rejection payload. That test encodes the real scenario and caught the over-strict version on the first run.

**Client mirror**, in `bay-view.js`, computed as a single reason string so the disabled button can say which of the three applies:

```js
const convertBlockedBy = (strip.coordination && strip.coordination.state === 'PROPOSED')
  ? 'an open coordination proposal'
  : (strip.tofiCoordination && strip.tofiCoordination.state === 'PROPOSED')
    ? 'an open TOFI proposal'
    : (strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE')
      ? 'active tactical control'
      : null;
```

The button's render is additionally gated on `_resolveActingPositionId(strip)` returning something, which pairs with docs/adr/0029 — it previously rendered for any viewer regardless of what they held.

## Alternatives considered

- **Treat both records uniformly (refuse `PROPOSED` and `ACTIVE` on each).** Rejected, and empirically so — it breaks the civil return leg, which is the single most common thing this op exists for. See the test above.
- **Resolve the link automatically instead of refusing** — e.g. send a REJECT to the peer, then convert. Rejected: the controller, not the system, decides how a coordination ends, and silently rejecting on someone's behalf is a worse version of the bug (the peer gets a decision nobody made). The §4.6 primitives are a conversation between two controllers; this op is not a party to it.
- **Guard only `tofiCoordination`**, on the grounds that the five primitives' case had not actually been observed failing. Rejected: `_applyInvokeNla` and `_applyDropStrip` both already guard `coordination.state === 'PROPOSED'` for the identical orphaned-replica reason, and leaving one of the three ops that discard the field unguarded is exactly the kind of drift these ADRs exist to prevent.
- **Allow the conversion and carry the link across** onto the new `ARRIVAL` role. Rejected: docs/adr/0023 resets `annotations`/`flags`/`correlation` too, because the return leg is a genuinely new phase of the flight; a coordination link scoped to the outbound leg has no meaning on the inbound one, and `COORDINATION_ELIGIBLE_STATES` would immediately want a fresh proposal anyway.

## Consequences

- The conversion is now refused mid-exchange with a specific `detail` string per cause, and the button is disabled with a matching title, so the controller learns the ordering rule (resolve the exchange, *then* convert) rather than discovering it through a corrupted link.
- **Nulling the two fields is now safe by construction**, which is worth keeping true: any future field added to `_applyConvertToArrival`'s reset block that carries an obligation to another party needs a guard here too.
- Covered in `tests/efsp-scenarios.test.mjs`'s military round trip — the conversion is attempted mid-`ACTIVE`-TOFI, asserted refused with `/active tactical control/`, and then performed successfully once the EXIT completes — and by the pre-existing coordination test at `:773`, which now serves double duty as the regression guard for the permitted `ACTIVE`-coordination case.
- The same asymmetry applies to `_retireStrip` (docs/adr/0027), which guards `ACTIVE` TOFI and not `ACTIVE` coordination for exactly these reasons. The two ops now read identically, which is the intent.
