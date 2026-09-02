# 0009 — The 30-second Undo window stays scoped to state-only NLA transitions, not transfer-shaped ones

## Context

Guide §3.5 rule 5 requires: "`Undo` MUST exist for the last NLA transition per Strip, with a 30-second window." Phase 1 implemented this for every NLA transition uniformly, because every Phase 1 NLA transition was a plain state change (`_applySetState`).

Phase 2 (ADR 0007, ADR 0008) introduces transfer-shaped NLA transitions — `computeNla()` can now return `{toState, transferTo}`, and `board-store.js`'s `_applyInvokeNla` routes those through `_applyTransferStrip()` instead of `_applySetState()`. A literal reading of §3.5 rule 5 would record these into the same `_nlaHistory` map and make them Undo-eligible too.

Doing so exposes a real correctness hazard, found while implementing this: `_nlaHistory` is keyed by `stripId` and is not cleared by an ordinary `TransferStrip` Mutation. If a Strip has a still-open, state-only Undo window (say, an NLA-driven `LUAW → DEPARTED` transition) and is then transferred to a different Position — whether via the new transfer-shaped NLA path or an entirely separate, controller-initiated drag transfer — the stale history entry would remain. A subsequent `Undo` call could revert the Strip's *state* back to its pre-transfer value while its *ownership* has already moved, producing a Strip in a state/owner combination that never legitimately existed (e.g. `LUAW`, a `TWR`-lifecycle state, owned by `APP`).

## Decision

1. **Undo stays scoped to state-only NLA transitions.** `_applyInvokeNla` only records into `_nlaHistory` when `!result.transferTo` — a transfer-shaped transition is never Undo-eligible via the `Undo` op kind.
2. **Any successful `_applyTransferStrip` clears `_nlaHistory` for that Strip** — regardless of whether the transfer came from the new transfer-shaped NLA path or an ordinary controller-initiated `TransferStrip` (a drag). This closes the stale-history hazard above, including for the plain-drag case, which had the same latent gap even before Phase 2 (a pre-existing issue this ADR's fix also happens to close).
3. **A failed or mistaken transfer is handled by the existing transfer-timeout/failure path (guide §4.5 rule 5: "a transfer that times out MUST return the Strip to the sender with a visible failure, never disappear"), not the `Undo` button.** Reversing an ownership change is a materially different, untested mechanism from reversing a state change — the guide's `Undo` was designed and evidenced (the Raytheon patent citation in §3.5) against touch-panel state-transition misfires, not against undoing a hand-off after the fact.

## Alternatives considered

- **Make transfer-shaped transitions Undo-eligible too**, reverting owner+Bay+Rack+state together. Rejected: this is a genuinely different, more consequential operation (an ownership reversal, potentially after the receiving controller has already started acting on the Strip) that the guide's Undo design was never evidenced against, and building/testing it properly is disproportionate to what Phase 2 needs. The transfer-timeout-revert path already exists and already covers "the transfer didn't really happen the way it should have."
- **Leave `_nlaHistory` unscoped and accept the stale-Undo hazard.** Rejected outright once identified — it's a real, demonstrable correctness bug (Strip left in a `state`/`ownerPositionId` combination that violates the lifecycle's own invariants), not a hypothetical edge case.

## Consequences

- `board-store.test.mjs` gained explicit coverage: a transfer-shaped `InvokeNla` leaves no Undo available immediately after; an ordinary `TransferStrip` clears a previously-pending Undo window from an earlier state-only NLA transition.
- A future WP4A implementer building real cross-Facility `HANDOFF` should apply the same rule: any operation that moves a Strip's `ownerPositionId` — accelerator-driven or not — must clear `_nlaHistory`, not just the two paths this ADR covers.
- This does not change Phase 1's existing state-only Undo behavior in any way — `LUAW`'s Undo, `PENDING_CLEARANCE`'s Undo, etc. all work exactly as before.
