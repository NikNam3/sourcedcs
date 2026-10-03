# DESK-SIGNON (B1: a reconnect signs the controller off)

## Code as found
- `crc-sync/src/ws-hub.js` `_onConnect` close handler: `efsp.onDisconnect(session)` signs the controller off every Position at once (abrupt: Observer auto-promoted, sign-off repairs and GC offers follow).
- `crc-desktop/.../efsp-ws.js` `sendEfspSetPositions` writes `_actingPositionsByFacility` before sending; nothing re-sends it after a reconnect; `efsp-messages.js` `efsp-positions-ack` logs `signedOn` and never adopts it. Every gate reads the claim.
- `coverage.signedOnPositions[].isPrimary` is already on the wire (per session, on connect and after the sender's set-positions) but the client never reads it. It is not refreshed for a *different* session whose Position it was promoted to.

## Decision
1. Server grace: a closed session's sign-ons are held for `signOnGraceMs` (config/sign-on-grace.json, injected wall clock, swept by a named ticker). A reconnect by the same controllerId inside it cancels the sign-off. A second live socket for the same controller also suppresses it.
2. Client: after every connect the client re-declares its desired set per Facility (declared set kept apart from the server's truth); the ack's `signedOn` is adopted; a Position lost meanwhile is unticked with one visible line.
3. Primary/Observer: read from the existing `coverage.signedOnPositions[].isPrimary` (no new wire field); server refreshes other sessions' coverage when staffing changes.
