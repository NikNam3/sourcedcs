# 0007 — DEPARTED's Next Logical Action becomes a real, occupancy-gated Hand Off to APP, superseding ADR 0005's stub

## Context

ADR 0005 (Phase 1) recorded that `DEPARTED`'s NLA was a deliberate stub — it always transitioned straight to `HANDED_OFF`, never inhibited, because `APP` was "not a configured Position at all in Phase 1, not merely unoccupied." Reusing the guide's real `NO_RECEIVING_POSITION` inhibit there would have misleadingly implied `APP` existed and was simply unstaffed.

Phase 2 adds `APP` as a real, occupiable `INCIRLIK` Position (guide §4.1: "Approach / Departure (RAPCON)... Military ATC... Incirlik"). ADR 0005's stated reason for the stub no longer holds — `APP` genuinely exists now, with its own Bays (`facility-config.js`'s `APP.bays`) and covering-chain entry (`coveringChain.TWR = 'APP'`).

Critically, `TWR` and `APP` are both `INCIRLIK` Positions. The guide's real cross-Facility `HANDOFF` primitive (§4.6) is between `APP` and `CTR` — a different Facility, still entirely unbuilt (WP4A, deliberately out of scope for Phase 2). What Phase 2 builds is the *intrafacility* hand-off from `TWR` to `APP`, which the guide's own transfer machinery (§4.5, `TransferStrip`) already models correctly: single atomic Mutation, occupancy-gated with a covering-chain fallback, self-coordination-aware.

## Decision

`nla.js`'s `computeDepartureNla()` now computes `DEPARTED`'s real transition:

```js
case 'DEPARTED':
  if (!ctx.isOccupied('APP') && !ctx.coveringPositionFor('APP')) {
    return { inhibited: 'no receiving Position present' };
  }
  return { toState: 'HANDED_OFF', transferTo: 'APP' };
```

`computeNla()` gained a 4th parameter, `ctx` (`{isOccupied, coveringPositionFor}`), threaded from `board-store.js`'s `_nlaCtx()` helper at both call sites (`_applyInvokeNla` and `_validateBayImpliedTransition`'s drag-doctrine check). `board-store.js`'s `_applyInvokeNla` now branches on whether `computeNla()`'s result carries a `transferTo`: if so, it calls the existing `_applyTransferStrip()` — the exact same atomic owner+Bay+Rack+state mechanism a controller-initiated drag transfer uses — instead of a plain `_applySetState()`. This is what guide §3.5 rule 4 ("NLA is an accelerator, not the only path") actually requires: the accelerator must invoke the *same* operation dragging would, not a parallel, easier-to-drift shortcut around its checks.

The client mirrors this: `efsp-nla.js`'s `NLA_LABELS.DEPARTURE.DEPARTED` changes from `"Mark Handed Off (local)"` to `"Hand Off to APP"`.

## Alternatives considered

- **Keep the stub, now that APP exists.** Rejected: ADR 0005's own reasoning was explicitly conditioned on `APP` not existing. Now that it does, the stub would silently strand the guide's own occupancy-gating requirement (§4.5 rule 2, "a transfer to an unoccupied Position MUST be rejected") for the one lifecycle transition that most needs it.
- **Build the real cross-Facility HANDOFF primitive now, since DEPARTED "really" hands off to APP.** Rejected: that conflates two different things. `TWR`→`APP` is intrafacility (both `INCIRLIK` Positions); the guide's `HANDOFF` primitive is specifically for crossing a Facility boundary (`APP`↔`CTR`), and building it now would be WP4A scope creep with no `CTR` Facility to actually hand off to.

## Consequences

- `_validateBayImpliedTransition`'s own internal `computeNla()` call (used by the drag-doctrine check that stops a Strip from being dragged past a doctrine gate) now also needs `ctx` — a drag into an `APP`-implied-state Bay would otherwise throw on `ctx.isOccupied` being undefined. Both call sites go through the same `_nlaCtx()` helper so they can't drift apart.
- Per ADR 0009, this transfer-shaped transition is deliberately *not* recorded into the 30-second Undo window — see that ADR for the reasoning.
- `efsp-nla.test.mjs`'s old "DEPARTED uses the Phase-1 stub" test is replaced with occupancy-gated cases (inhibited when unoccupied/uncovered, transfers when occupied or covered, safe-degrades to inhibited when no `ctx` is supplied at all — never a throw).
- The real cross-Facility `HANDOFF`/`POINT_OUT`/`TRAFFIC`/`OPERATIONAL_REQUEST`/`TOFI`/`AIT` primitives remain entirely absent from the Mutation op union (per ADR 0005's original discipline) — this ADR does not add any of them.
