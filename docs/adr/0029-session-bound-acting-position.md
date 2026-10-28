# 0029 — `actingPositionId` is bound to the connecting session's Primary, at the wire boundary

## Context

Every per-Position authority rule the EFSP has is evaluated against `actingPositionId`:

- `permission.js`'s `canMutate(actingPositionId, opKind)` — the class gate, deliberately two-argument and D21-proof (never a union of everything the controller holds).
- `board-store.js`'s `_dispatch` ownership check, `strip.ownerPositionId !== actingPositionId → NOT_OWNER` (guide §4.4 rule 2).
- `canActOnState(actingPositionId, role, state)` — per-State authority, docs/adr/0010.
- docs/adr/0025's MRU refusal, D12 — `TAC_C2` may never hold a `HANDOFF`, by construction.

And `actingPositionId` arrived as a bare field on the wire message, passed straight through:

```js
const result = boardStore.applyMutation(mutation, msg.actingPositionId, session.controllerId);
```

Nothing anywhere tied it to the connecting session. `PositionStore` had `primaryOf(positionId)` and `heldBy(controllerId)` fully implemented and used for occupancy, covering-chain and self-coordination lookups — but neither was ever consulted on the mutation path. The client's own `efsp-ws.js` documents the arrangement as a *contract* rather than an enforcement: *"Caller MUST only pass a currently-held Position — efsp-panel.js only offers actions for Positions actually held."*

So any connected client could drive any Strip on any Board through any transition, simply by naming whichever Position currently owned it. Ownership and permission both check the claim against itself. D10, D12, D21 and §4.4 rule 2 held against a well-behaved client and nothing else, and no test anywhere asserted otherwise — confirmed by grep at the time.

This is not a theoretical concern in a squadron app where every client is a member's own CRC install, but it is the difference between a rule and a convention, and three of the four rules above exist specifically to stop *accidental* overreach (a controller walking a Strip through three other Positions' jobs because nobody transferred it away). A buggy client, a stale `strip.ownerPositionId` in a client's local Map, or a replayed message all produce the same effect as a malicious one.

## Decision

**Check at the wire boundary, in `efsp-ws.js`'s `_handleMutation`, before the mutation reaches the store:**

```js
const positionStore = ctx.positionStoreFor(facilityId);
if (!positionStore || positionStore.primaryOf(msg.actingPositionId) !== session.controllerId) {
  return { ack: { ..., ok: false, reason: 'NOT_HOLDING_POSITION',
    detail: `you are not Primary at ${msg.actingPositionId} — select it before acting on its Strips` } };
}
```

**Primary, not merely held.** `heldBy` would have been the looser and more obvious check, and it is wrong: `setHeldPositions` claims a Position as **Observer** when someone else is already Primary there (guide §4.8.2 rule 3, and defect D18 — never a second Primary), and `_sessions` records Observer selections identically to Primary ones. An Observer who could mutate would *be* a second Primary in everything but name. `primaryOf(...) === session.controllerId` is the same test `isSelfCoordinated` already uses for the self-coordination question, which is the right precedent: it is asking "is this controller the one acting at this Position."

**Facility-scoped**, via `positionStoreFor(facilityId)` — a controller's held set is per-Facility server-side (docs/adr/0013 gives each Facility its own `PositionStore`), and the message already carries the `facilityId` the mutation is routed by.

**Why the wire boundary and not `board-store.js`.** Two reasons, both structural:

1. `BoardStore` has no session concept and should keep none. It is a pure function of `(mutation, actingPositionId, by)` over its own `_strips` Map; `by` is an attribution string for the audit log, not an authority. Threading a session or a `PositionStore` into `applyMutation` would give the store a second, parallel authority model alongside `_rules.canMutate`, and make "who is allowed" answerable in two places.
2. The wire boundary is where the untrusted claim actually enters. Everything downstream of it — including `receiveCoordinationProposal` and `receiveTofiProposal`, which are direct in-process peer-Board calls, not dispatched Mutations — is server-authored and already trustworthy. Checking once, at the edge, is both sufficient and the only place the session is in scope.

A consequence of (1) that is worth stating plainly: `boardStore.applyMutation` remains directly callable by tests with any `actingPositionId`, which is how the great majority of this package's ~570 tests drive it. That is deliberate. The tests that exercise the *wire* path go through `handleMessage` and now declare positions first, exactly as a real client does.

## Alternatives considered

- **`heldBy(...).includes(actingPositionId)`** — accept any selected Position, Observer or not. Rejected: see above; it recreates D18 through the back door, and an Observer's whole purpose (§4.8.2 rule 3) is to watch a Position someone else is working.
- **Enforce inside `board-store.js`'s `_dispatch`, passing the session through `applyMutation`.** Rejected for the two structural reasons above, and because it would have required touching every one of the several hundred direct `applyMutation` test call sites to thread a session that means nothing to them.
- **Derive `actingPositionId` server-side rather than checking it** — e.g. always use the Strip's owner if the session holds it. Rejected: it destroys the D21 property that a Mutation names exactly one acting Position, which is what makes the durable Mutation log's `actingPositionId` stamp meaningful for a controller holding several Positions, and it would silently reinterpret a client bug rather than rejecting it.
- **Warn rather than reject**, to avoid breaking anything mid-session. Rejected: a permission check that does not deny is not a permission check, and the one client-side path that genuinely violated it (below) was a real bug worth surfacing.

## Consequences

- **A new rejection reason, `NOT_HOLDING_POSITION`**, distinct from `PERMISSION_DENIED` (this Position class may not do this) and `NOT_OWNER` (this Position does not hold this Strip). The distinction matters to a controller: the fix is "select the Position," not "ask someone else to do it."
- **Position occupancy is ephemeral by design** (docs/adr/0002 — it never enters the durable snapshot, per guide §4.8.2 rule 5: *"Primary status is presence state... and it MUST NOT enter the durable Mutation log"*), so after a server restart a client must re-declare before it can act. That is exactly what a real reconnecting client does, and `tests/efsp-index.test.mjs`'s cross-Facility restart test now exercises it explicitly rather than depending on the hole.
- **`efsp-panel.js`'s `convertStripToArrival` had to change.** It was the one dispatch helper in the client that sent `strip.ownerPositionId` unconditionally instead of using `bay-view.js`'s `_resolveActingPositionId(strip)` like every other action — which under this decision is a guaranteed rejection whenever the controller does not hold the owning Position, where before it silently succeeded. The button's render is now gated on a resolvable held Position too (docs/adr/0030 covers its other new gates).
- **This decision depends on the Position selector being the authoritative statement of what a controller holds** — see docs/adr/0033, which records why Positions are declared through a dedicated selector rather than derived from radar-station selection as guide D-9 assumed. If Positions were ever derived from something the controller changes for an unrelated reason, this check would start denying legitimate actions.
- Covered in `tests/efsp-scenarios.test.mjs` by two tests: a controller naming the Position that genuinely owns a Strip but which they have not selected is refused (and the controller who does hold it succeeds), and an Observer at an occupied Position is refused.
