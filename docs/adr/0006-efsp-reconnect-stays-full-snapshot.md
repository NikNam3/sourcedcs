# 0006 — EFSP reconnect transport stays full-snapshot-always; the real gap was the missing replay

## Context

`EFSPImplementationGuide.md` §5.6 requires exactly two resync paths on reconnect — a bounded delta replay for a briefly-disconnected client, or a full snapshot for one disconnected longer — "no partial-repair path." crc-sync's `src/efsp/efsp-ws.js` already implements both server-side (`_handleResync`, ring-buffer-bounded delta vs. full `_snapshotMessage`), and the client already has matching helpers (`sendEfspResync()`, `replayPendingEfspMutations()` in `efsp-ws.js`/`efsp-state.js`).

A Phase 2 code audit found that in the actually-running app, only one path is ever exercised: `ws-hub.js`'s `_onConnect` unconditionally sends a full EFSP snapshot to every newly-connected client — the same as every other feed this server pushes (tracks, `CollaborativeStore`, `squawk-map`, `theater-settings`, `apt-config`). Nothing client-side ever calls `sendEfspResync()`. The delta-resync machinery is real, tested (`efsp-ws.test.mjs`), and behaves correctly when exercised directly — it's just never invoked outside its own tests.

Separately, and more seriously: `replayPendingEfspMutations()` — which rebases every still-pending Mutation against a fresh baseline after reconnect, per §5.6.3 — was *also* never called from anywhere. A Mutation in flight at the exact moment of a disconnect could never have its ack delivered on the dead connection, and nothing ever resent it once reconnected. That is defect D6 (silent mutation loss), and it is independent of which resync transport is used — it would exist whether the client used snapshot-always or delta-then-snapshot.

## Decision

1. **Keep EFSP's connect-time behavior unconditional full-snapshot, matching every sibling feed in `ws-hub.js`'s `_onConnect`.** Do not special-case EFSP to wait for a client-initiated `efsp-resync` — that would make EFSP the one asymmetric feed in a function that otherwise treats every feed identically, for a bandwidth saving that doesn't matter at Phase 2's scale (tens of Strips). The delta-resync path (`sendEfspResync`/`_handleResync`) stays in the codebase as intentionally-dormant, still-tested infrastructure — it's guide-mandated, cheap to keep, and a genuinely bandwidth-constrained future deployment could wire it in without redesigning anything.
2. **Fix the actual gap**: `app.js`'s `efsp-snapshot` handler now calls `replayPendingEfspMutations()` after applying the snapshot and re-rendering, with an `onOrphaned` callback (`efsp-panel.js`'s new `notifyEfspOrphanedMutation`) that surfaces — via the existing mutation-error banner — any pending Mutation whose target Strip no longer exists locally, rather than letting it vanish.

## Alternatives considered

- **Wire the client to call `sendEfspResync()` on reconnect, using the delta path when possible.** Rejected for Phase 2: it would require tracking "was this a fresh connect or a reconnect" client-side (not currently tracked anywhere), and the benefit — skipping a full snapshot of a few dozen Strips — isn't worth that added state at this scale. Revisit if/when the Board grows enough for snapshot size to matter (WP8's instrumentation would be the trigger).
- **Delete the unused delta-resync code as dead weight.** Rejected: it's correct, tested, and guide-mandated (§5.6 explicitly requires the two-path behavior to exist server-side); removing it would just mean re-deriving it later for no present benefit.

## Consequences

- The real fix — replay-on-reconnect — was orthogonal to the transport question, and would have been needed either way. Anyone revisiting this ADR to wire in delta-resync should leave the replay call in `app.js`'s `efsp-snapshot` (and add an equivalent one wherever a delta-resync response is handled) rather than assuming snapshot-always was doing double duty for both concerns.
- `efsp-ws.test.mjs`'s delta-resync coverage remains the only thing exercising that path; a future change to `_handleResync` that breaks it will only be caught there, not by any end-to-end/manual test, since the running app never takes that branch.
