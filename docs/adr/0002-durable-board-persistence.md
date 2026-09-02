# 0002 — Durable Board persistence, departing from crc-sync's ephemeral-state precedent

## Context

`EFSPImplementationGuide.md` §11.1.3 requires: "Server restart MUST NOT lose the Board. Persist Strips, Bays, order keys and field state."

crc-sync's existing philosophy for live tactical state is deliberately ephemeral: `TrackStore` and `CollaborativeStore` (`src/tracks.js`, `src/collab-store.js`) are pure in-memory `Map`s, explicitly cleared on **both** server restart and DCS mission reload (`server.js`'s `grpcClient.on('mission-load', ...)` handler calls `trackStore.clear()`/`collabStore.clear()`). Only small squadron-wide *configuration* — `theater-settings.json`, `apt-config.json`, the squawk map — persists to disk today; no durable, ever-growing log of anything exists anywhere in the codebase.

## Decision

The EFSP Board (`src/efsp/board-store.js`), the FDR store (`src/efsp/fdr-store.js`), and the code allocator persist to JSON files (`config/efsp-board.json`, folded into the same snapshot as the FDR store) via `src/efsp/index.js`'s `_persist()`/`_restore()`, following the `theater-settings.js`/`apt-config.js` load-once/write-on-mutation pattern. An append-only Mutation audit log (`src/efsp/mutation-log.js`, `config/efsp-mutations.jsonl`) records every accepted Mutation.

Both are **explicitly excluded** from the mission-reload `clear()` call site in `server.js` — a loud code comment marks this at both the `efsp = createEfsp()` construction site and the `mission-load` handler itself.

## Alternatives considered

- **Treat Strips as ephemeral, like tracks** (cleared on restart/mission reload). Rejected: a Strip represents real controller work — clearances issued, transfers made, annotations written — not a value that regenerates automatically from DCS-gRPC the way a track does. Losing it on a crc-sync restart or a mission reload (which happens routinely mid-session) is a materially worse failure than losing a radar blip.

## Consequences

- `mutation-log.jsonl` grows without bound until a retention/rotation job exists — deliberately deferred to WP8 (guide §11.3's 30-day default), not built in Phase 1. Ship the raw log now; add rotation later without needing to change the log's shape.
- crc-sync now has two categories of "clear on mission reload" behavior at one call site (`server.js`'s `mission-load` handler): tracks/collab-store are cleared, EFSP state is not. A future editor reflexively adding `efsp.boardStore.clear()` there would silently reintroduce data loss — the comment at both sites exists specifically to prevent that.
- Every EFSP store gained a `snapshot()`/`restore()` pair (`board-store.js`, `fdr-store.js`, `code-allocator.js`) that didn't need to exist under the ephemeral model — tested explicitly via an actual restart simulation (`efsp-board-store.test.mjs`'s "resolves to exactly one owner" test, `efsp-index.test.mjs`'s "a freshly constructed efsp instance restores it" test), per the guide's own instruction that this is "the worst failure mode in the system" to get wrong.
- Position occupancy (`src/efsp/position-store.js`) remains ephemeral, matching the *original* precedent — guide §4.8.2 rule 5 is explicit that Primary/Observer presence state "MUST NOT enter the durable Mutation log." Only `actingPositionId` on each Mutation is durable.
