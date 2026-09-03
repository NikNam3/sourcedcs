# 0012 — every NLA transition that crosses a Position boundary is transfer-shaped, not just DEPARTED→APP

## Context

ADR 0007 made `DEPARTED`'s NLA a real, occupancy-gated `TransferStrip` to APP — because "Hand Off" is inherently a transfer of control, not just a status update. Every other DEPARTURE NLA transition stayed state-only (`{toState}`, no `transferTo`), including the ones that also cross a `DEPARTURE_STATE_OWNERS` boundary: `PROPOSED→PENDING_CLEARANCE` (OPS owns PROPOSED, CD owns PENDING_CLEARANCE), `CLEARED→PUSHBACK` (CD→GND), `HELD→PUSHBACK` (CD or GND→GND), `TAXI→RUNWAY_QUEUE` (GND→TWR).

Live testing surfaced two consequences of that asymmetry:

1. Per ADR 0010's per-State authority gate, once OPS presses "Send to Clearance" the Strip is now stuck in `PENDING_CLEARANCE` — OPS is no longer authorized to advance it further, but nobody else owns it either, since ownership never moved. The Strip only becomes actionable again once someone explicitly drags it to CD.
2. That explicit drag has no UI path at all for a genuinely single-Position controller. `efsp-panel.js`'s `_positionsWithBays()` only renders a drop-target tab for Positions the acting controller currently *holds* (its own comment already flags this: "a single-Position controller has no tab to drop a handoff onto for a Position they don't hold themselves"). An operator who only holds OPS has no way to complete the hand-off to CD — the two-step "press NLA, then drag" workflow that ADR 0010 now requires is simply unreachable for them.

The user's explicit request: make "Send to Clearance" (and the other pre-Tower buttons) actually move the Strip, the same way "Hand Off to APP" already does.

## Decision

Extend the transfer-shaped pattern from ADR 0007/0008 to every DEPARTURE transition that crosses a `DEPARTURE_STATE_OWNERS` boundary:

```
PROPOSED -> PENDING_CLEARANCE   transferTo: CD    (was state-only)
CLEARED  -> PUSHBACK            transferTo: GND   (was state-only)
HELD     -> PUSHBACK            transferTo: GND   (was state-only; no-op if GND already held it)
TAXI     -> RUNWAY_QUEUE        transferTo: TWR   (was state-only)
```

Each gains the same occupancy-gated inhibit (`{inhibited: 'no receiving Position present'}`) already used for `DEPARTED`/`INBOUND`/`LANDED`, checked via the same `ctx.isOccupied`/`ctx.coveringPositionFor` mechanism. Transitions that stay with the same owner — `PENDING_CLEARANCE→CLEARED`, `PUSHBACK→TAXI`, `RUNWAY_QUEUE→LUAW`, `LUAW→DEPARTED` — are untouched, since there's no Position boundary and nothing to transfer.

No change to `board-store.js` was needed: `_applyInvokeNla` already branches on `result.transferTo` and routes through the exact same atomic `_applyTransferStrip` a controller-initiated drag uses (ADR 0007). Only `nla.js`'s `computeDepartureNla` changed.

## Alternatives considered

- **Only fix the missing drop-target UI** (render drop-only tabs for Positions a controller doesn't hold, so a single-Position controller can still manually drag a hand-off). Rejected as the sole fix: it would still leave every hand-off in the chain as a mandatory two-step "press NLA, then drag," which is exactly the friction the user asked to remove — and it leaves the DEPARTED→APP asymmetry (the one transition that's already one step) unexplained and inconsistent with the rest of the chain.
- **Leave the asymmetry and add both** (transfer-shaped NLA for these four transitions, and still build drop-only tabs separately for the general case). Not rejected outright — the drop-only-tabs gap is real and still open for any hand-off outside this specific lifecycle chain (e.g. an ad hoc reassignment) — but it's a separate, smaller, not-yet-requested piece of work, not needed to satisfy this request.

## Consequences

- Per ADR 0009, these four transitions are no longer Undo-eligible via the 30-second NLA Undo window — same as `DEPARTED→HANDED_OFF` already wasn't. Recovery from a mistaken press is a subsequent transfer/drag back, not the Undo button.
- The single-Position-controller drop-target gap (`efsp-panel.js`'s own comment) is now moot for the whole documented DEPARTURE lifecycle chain — OPS alone can move a Strip all the way to CD, CD alone to GND, GND alone to TWR, purely via the NLA button, no drag required. The comment's flagged gap still stands for any hand-off outside this chain.
- `crc-sync/tests/efsp-nla.test.mjs` gained occupancy-gated cases for `PROPOSED`, `CLEARED`, `HELD`, `TAXI`, mirroring the existing `DEPARTED`/`INBOUND`/`LANDED` test shape. `crc-sync/tests/efsp-ws.test.mjs`'s doctrine-bypass test now occupies CD first, since `PROPOSED`'s NLA would otherwise resolve to `NLA_INHIBITED` (no receiving Position) before ever reaching the doctrine check the test is actually about.
