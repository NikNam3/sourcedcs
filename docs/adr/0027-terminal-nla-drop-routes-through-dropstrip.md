# 0027 — A terminal NLA Drop routes through the same retire path as the `DropStrip` op

## Context

Every Strip Role ends its lifecycle at `DROPPED`, and in every case the NLA button that takes it there is labelled, to the controller, **"Drop"** — `efsp-nla.js`'s `NLA_LABELS`: `DEPARTURE`'s `HANDED_OFF`, `ARRIVAL`'s `TAXI_IN`, `OVERFLIGHT`'s `TRANSITING`, `MISSION`'s `RTB` (docs/adr/0026). `nla.js` returns `{ toState: 'DROPPED' }` for each of those four states.

But that button and the `DropStrip` op were two completely separate code paths, and only one of them had any rules. `_applyInvokeNla` routed a non-transfer-shaped result to `_applySetState`, a five-line generic setter that writes `strip.state`, bumps `rev`, and stops. All of the actual *meaning* of dropping a Strip lived in `_applyDropStrip`: the guide §4.6.3 rule 2 rejection, `strip.flags.removeIndicator`, and `this._fdrStore.releaseFdr(...)`.

`DropStrip` is reachable from exactly one place in the whole client — `efsp-panel.js`'s dot-command handler, on `.drop` (a single `sendEfspMutation(..., { kind: 'DropStrip', ... })` call site). The button every controller actually uses went the other way. Three consequences, all live:

1. **The §4.6.3 rule 2 hard rejection was bypassable from the default UI, on both sides of a live exchange.** ADR 0025 states it unconditionally — *"`DropStrip` is rejected outright (not a soft warn) while `tofiCoordination.state === 'ACTIVE'`, on either side"* — because guide rule 2's *"dropping the Strip breaks all three [separation-model fields]"* is a data-integrity fact, not a coordination nicety. An MRU controller pressing the button labelled "Drop" on a `MISSION` Strip at `RTB`, or an ATC controller pressing it on their own Strip at `HANDED_OFF`, walked straight past it. Nothing notified the peer (only `receiveTofiResponse` does that, and `_applySetState` never calls it), so the other side's `tofiCoordination.state` stayed `'ACTIVE'` forever, pointing at a Strip that no longer existed.
2. **The remove indicator was never set** on that path, so a Strip retired through the button never got guide §3.4's "queryable but removed" treatment the rest of the system assumes a `DROPPED` Strip has.
3. **The beacon code was never released.** `releaseFdr` had exactly one caller, inside `_applyDropStrip`. Every Strip retired the normal way leaked its Mode 3/A code out of `CodeAllocator`'s pool for the life of the process.

(2) and (3) are not new to this slice — they have been true for every Role since Phase 1, and were invisible because nothing in the UI shows a code returning to the pool. All three were found by walking a whole sortie end to end (`tests/efsp-scenarios.test.mjs`) rather than by any per-mutation unit test, none of which ever exercised `InvokeNla` against a terminal state while an exchange was open.

## Decision

**One path to `DROPPED`.** A new `BoardStore._retireStrip(strip, by)` holds everything that dropping a Strip means: the ACTIVE-TOFI rejection, `state = 'DROPPED'`, `flags.removeIndicator = true`, the `rev`/`updatedAt`/`updatedBy` bump, `_touch`, and the FDR release (now `_releaseFdrIfLastStrip` — docs/adr/0028).

`_applyDropStrip` keeps its own two `PROPOSED`-link guards (an unresolved coordination or TOFI proposal, per docs/adr/0022's live-testing fix) and then delegates. `_applyInvokeNla` gains a third branch beside its existing transfer-shaped one:

```js
} else if (result.toState === 'DROPPED') {
  applied = this._retireStrip(strip, by);
} else {
  applied = this._applySetState(strip, result.toState, by);
}
```

This is the same reasoning the transfer-shaped branch above it already embodies: it reuses `_applyTransferStrip` rather than writing owner/Bay/state itself, because guide §3.5 rule 4 makes NLA *an accelerator for an operation*, not a shortcut around that operation's checks. A terminal NLA is a Drop, so it has to mean what Drop means.

The `PROPOSED`-link guards deliberately stay in `_applyDropStrip` and `_applyInvokeNla` separately rather than moving into `_retireStrip`, because `_applyInvokeNla` must apply them to *every* transition, not only the terminal one — a Strip with an unresolved proposal should not advance at all.

**The ACTIVE check, by contrast, belongs only in `_retireStrip`**, and this asymmetry is load-bearing: docs/adr/0026 and its test (*"the MISSION Strip advances through its own lifecycle... independent of the TOFI exchange state"*) require a `MISSION` Strip to walk `TASKED → AIRBORNE → ON_STATION → OFF_STATION → RTB` freely while tactical control is live. It may not *end* during one. A blanket ACTIVE guard in `_applyInvokeNla` would have broken the whole MRU lifecycle.

**Client mirror.** `bay-view.js` disables the NLA button proactively — the same "server is authoritative, this is so it never *looks* pressable" pattern the `canActOnState` and open-coordination checks beside it already use. Narrowed the same way the server is, via `nlaLabel === 'Drop'`:

```js
const isTerminalDrop = nlaLabel === 'Drop';
const underTacticalControl = strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE';
```

## Alternatives considered

- **Add the ACTIVE-TOFI check to `_applyInvokeNla` alongside its existing `PROPOSED` guards, and leave the two drop paths separate.** Rejected on two counts. It would freeze a `MISSION` Strip's entire lifecycle during the exchange that created it, contradicting docs/adr/0026 directly. And it fixes only the first of the three consequences above — the remove indicator and the beacon release would still never happen on the button path, which is the path essentially every retirement actually takes.
- **Make the client send `DropStrip` instead of `InvokeNla` when the computed NLA is terminal.** Rejected: it puts a server-side rule (which states are terminal) into the client's dispatch logic, and leaves the server still accepting an `InvokeNla` that bypasses everything — a client is not where an invariant gets enforced.
- **Drop the Undo window for terminal transitions**, sidestepping the reversal problem below by making a Drop final. Rejected as a real usability regression for a mis-click, and for no gain: docs/adr/0009 scoped Undo to state-only NLA transitions precisely because transfer-shaped ones have the transfer-timeout-revert path instead, and a terminal Drop is state-only. It stays in scope; it just has more to reverse now.

## Consequences

- **Undo now reverses more than a state.** `_applyUndo` clears `flags.removeIndicator` and calls a new `FdrStore.reacquireFdr(fdrId)` before restoring `prevState`. `reacquireFdr` re-claims the FDR's own recorded `identity.beaconAssigned` through `CodeAllocator.reassign` — but checks `holderOf(code)` first and **declines** if the code has gone to a different FDR in the meantime, returning `{ ok: true, warning: 'DUPLICATE_IGNORED_WARNING' }`. That window is 30 seconds wide and requires a `CreateStrip` inside it, so it is narrow but real; leaving this FDR's recorded code un-reserved is the lesser evil against knowingly minting a duplicate, which is defect D23's own posture (duplicates warn, never block — `code-allocator.js`'s `validateAssignment`).
- **The `.drop` dot-command and the Drop button are now genuinely the same operation**, differing only in `_applyDropStrip`'s extra `PROPOSED` guards. A future work package adding a dedicated Drop *gesture* (the briefing's long-standing "DropStrip has no button" gap) should target `DropStrip` and inherit all of this for free.
- Covered by `tests/efsp-scenarios.test.mjs`: the military round trip asserts the button is refused on both the `MISSION` side (walked to `RTB` first, since its earlier states advance normally) and the ATC side; two dedicated tests cover the beacon release on the button path and the Undo reversal including the re-claim.
- `_applySetState` is now reached only by genuine mid-lifecycle transitions and by `SetState` itself, which remains the documented direct path (guide §3.5 rule 4) and is deliberately *not* routed through `_retireStrip` — a controller writing `SetState { toState: 'DROPPED' }` explicitly is using the escape hatch, and every test that walks a Strip past an awkward state relies on it staying dumb.
