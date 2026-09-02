# 0004 — EFSP Board deltas broadcast immediately, not on the existing 500ms tick

## Context

`src/ws-hub.js` already has two broadcast styles in production, not one: `TrackStore`/`CollaborativeStore` changes ride a 500ms `setInterval` tick (`_tick()`, matching crc-desktop's original local-server cadence), while squadron-wide config changes (`squawkMapSet`, `theaterSettingsSet`, `aptConfigSet`) broadcast **immediately** on mutation, before the trackId-gated switch in `_onMessage`.

`EFSPImplementationGuide.md` §7.9 sets a remote-change budget of "< 200 ms" for a Strip mutation to become visible on another controller's Board. A 500ms tick cannot meet that budget even in the best case.

## Decision

EFSP Board mutations (`efsp-mutation` messages) broadcast immediately via `WsHub._broadcast()`, the same style already used for `squawkMapSet` et al. — not queued onto the 500ms tick. See `src/efsp/efsp-ws.js`'s `_handleMutation()`, which returns `{ack, broadcast}` for `ws-hub.js` to send in the same synchronous pass as the mutation itself.

## Alternatives considered

- **Ride the existing 500ms tick**, matching tracks/collab-store. Rejected outright: violates the guide's explicit <200ms budget by a wide margin, and Strip state changes (a clearance issued, a transfer accepted) are exactly the kind of event where a controller needs to see another Position's action land promptly, unlike a track's smoothly-interpolated position update where a short delay is imperceptible.

## Consequences

- `board-store.js`'s own sequence/ring-buffer (`_seq`, `_log`, `getDeltaSince()`) exists purely for **reconnect resync** (guide §5.6 — a client that was briefly offline catching up), not for pacing live broadcasts — a deliberate difference from `TrackStore`'s identically-shaped `_log`, which serves both purposes there.
- Every accepted Mutation triggers its own broadcast + a synchronous disk write (`efsp/index.js`'s `_persist()`, per ADR 0002) — acceptable at Phase 1's scale (tens of Strips, infrequent relative to track-update volume), but a candidate to batch/debounce if WP8's instrumentation (guide §11.5) shows write volume becoming a problem at larger Facility/Position counts in later phases.
