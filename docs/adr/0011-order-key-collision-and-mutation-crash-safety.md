# 0011 — order-key collisions no longer crash the server; no single Mutation can ever crash it

## Context

`crc-sync` crashed in live use with an uncaught exception:

```
Error: order-key: keyBetween requires a < b (got "V", "V")
    at keyBetween (order-key.js:68:11)
    at BoardStore._resolveOrderKey (board-store.js:119:14)
    at BoardStore._applyMoveStrip (board-store.js:343:27)
    ...
    at WsHub._onMessage (ws-hub.js:212:33)
```

`order-key.js`'s own header comment already documents that `_jitter()` tolerates a ~1-in-62 chance of two *different* Strips ending up with the *identical* order key — accepted by design, since the guide's WP1 acceptance criterion (two concurrent same-slot inserts must both survive with no reindex broadcast) requires it, and `board-store.js`'s Rack sort already tie-breaks equal keys by `stripId` to keep display order well-defined. What was never handled: a *later* `MoveStrip`/`TransferStrip` inserting a third Strip strictly *between* two Strips that had already collided. `keyBetween`'s own docstring claimed `a >= b` was "a caller bug, never true for two keys actually drawn from the same Rack" — this crash proved that claim false. The thrown error carried no `.code`, so `_resolveOrderKey`'s existing `ORDER_KEY_EXHAUSTED`-only catch didn't handle it, and nothing above `board-store.js` caught it either — it propagated all the way to the WebSocket message handler and killed the Node process, taking down the whole server for every connected controller over one Strip drag.

## Decision

Two independent fixes, because they close different-shaped gaps:

**1. Root cause — `order-key.js`'s `keyBetween(a, b)` now throws with `.code === 'ORDER_KEY_EXHAUSTED'` when `a >= b`**, the same code as its other exhaustion cases, since the recovery is identical in both: there is no valid key strictly between two equal (or inverted) bounds, so the caller must rebalance the Rack (which reassigns fresh, guaranteed-distinct keys) and retry. `_resolveOrderKey`'s existing retry-after-rebalance path now handles this automatically.

That retry itself had a second, subtler failure mode, found while testing the fix: a rebalance preserves the Rack's own tie-broken order (`orderKey` then `stripId`), which can come out *opposite* to whatever the caller's `afterStripId`/`beforeStripId` labels assumed — specifically when those two Strips were the ones that collided, and their `stripId`s (random UUIDs) happen to tie-break the other way. `_resolveOrderKey`'s retry now normalizes the two resolved keys into ascending order before the final `keyBetween` call, since the caller's real intent ("insert between these two specific Strips") doesn't depend on which one was labelled "after" vs "before" once already in this recovery path.

**2. Defense in depth — `BoardStore.applyMutation()` (the single choke point every client Mutation flows through) now wraps `_dispatch()` in a try/catch.** An unexpected exception anywhere inside Mutation application becomes `{ok:false, reason:'VALIDATION_ERROR', detail:'internal error processing mutation'}` for that one Mutation — logged loudly via `console.error` (still a real bug worth finding and fixing), but never an uncaught exception that crashes the process. This existed as a documented intent already (`applyMutation`'s own docstring: "Never throws for an ordinary rejection") but nothing enforced it in code before this ADR.

## Alternatives considered

- **Fix only the root cause, skip the defense-in-depth catch.** Rejected: item 1 fixes the *specific* trigger found this time, but the guarantee "one bad Mutation can never crash the server for everyone" shouldn't depend on having found and patched every possible internal exception in advance. The catch in `applyMutation` is what actually makes that guarantee true going forward, for whatever the next one turns out to be.
- **Only add the defense-in-depth catch, leave `order-key.js` unfixed.** Rejected: this would have "fixed" the crash by silently rejecting every Mutation that hit a jitter collision, permanently failing that one drag with no path to success — a real regression in usability, discovered specifically because the first version of this fix (catch-only) made the reproduction test fail with a rejection instead of the drag actually completing.
- **Try to eliminate jitter collisions instead of handling their consequence.** Rejected: collisions are an accepted, documented tradeoff of the fractional-index scheme (guide §5.4's "two clients inserting at the same slot both survive with no reindex" requirement), not a bug to design away — the fix belongs entirely in how the system recovers from the downstream case, not in reducing how often it occurs.

## Consequences

- `keyBetween(a, a)` and `keyBetween(b, a)` (inverted) both now carry `.code === 'ORDER_KEY_EXHAUSTED'` — `efsp-order-key.test.mjs`'s old test asserting a *plain, uncoded* error for this case was itself testing the bug and has been replaced.
- `efsp-board-store.test.mjs` gained a direct reproduction of the production crash (two Strips with a forced-identical `orderKey`, then a `MoveStrip` between them) — run repeatedly in a loop during development specifically to confirm the fix doesn't depend on which way the two Strips' random UUIDs happen to tie-break, and a second test confirming `applyMutation` survives and stays usable after an entirely unrelated simulated internal exception.
- Any future internal exception during Mutation application will now surface as a `VALIDATION_ERROR` rejection plus a `console.error` log line, not a crash — worth treating any occurrence of that log line as a real bug report, not routine noise.
