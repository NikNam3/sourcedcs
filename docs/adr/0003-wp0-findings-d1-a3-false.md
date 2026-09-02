# 0003 — WP0 reconnaissance: guide decision D-1 and assumption A3 are false

## Context

`EFSPImplementationGuide.md` §0.3 mandates a reconnaissance pass (WP0) before any implementation work, with the rule that "if a WP0 finding contradicts this guide, the finding wins and this guide MUST be amended by ADR." Decision D-1 (§14.1) states: "The CRC server already keeps a per-aircraft flight record. The EFSP reads and writes it and owns only annotations, Bay position and State." Assumption A3 (§1.3) states: "A Position/authentication concept exists (a controller logs in as a Position)."

This session's reconnaissance (three parallel codebase surveys across crc-sync and crc-desktop, cross-checked directly against the source in the implementation session that followed) found both false.

## Findings

**D-1 is false.** `crc-sync/src/tracks.js`'s `TrackStore.update()` constructs a "track" as pure live radar telemetry: `{id, callsign, coalition, type, lat, lon, alt, heading, player, category}`, plus optional SRS-observed `squawk`/`squawkStatus`/`mode4`. There is no route, assigned altitude, departure, or destination field anywhere in crc-sync. A flight-plan concept exists, but entirely outside crc-sync: `crc-desktop/app/server.js` proxies `GET /api/fpl/:callsign` to sourcedcs-web's `/api/fpl1801/by-callsign/...`, fetched on demand and joined to a track client-side by callsign string match. Track and flight-plan are separate objects in separate systems today, with no shared identity beyond that string match.

**A3 is false.** `crc-sync/src/auth.js` implements pure per-user Casdoor OAuth (code exchange, single-use WebSocket connect tickets) with no role or Position concept anywhere. The WebSocket session object (`ws-hub.js`'s `_onConnect`) carries `{user, who}`, where `who` is only a display-name fallback chain (`user.name || preferred_username || sub`) used for audit attribution on IFF declarations/renames — not a controlling authority. `CRCSYNC_COALITION` is a single server-wide environment variable (`src/resolve.js`), not a per-controller selection.

## Decision

Both are recorded as refuted per the guide's own WP0 process. The consequences, each itself the subject of a user decision and a corresponding implementation:

- **D-1's FDR is net-new state**, built as `src/efsp/fdr-store.js`, co-located with `TrackStore`/`CollaborativeStore` in crc-sync (not an extension of the existing track object, and not routed through sourcedcs-web's flight-plan record).
- **A3's Position/occupancy model is net-new**, built as `src/efsp/position-store.js` (Primary/Observer, covering chain, self-coordination) plus a dedicated Position-selector UI in crc-desktop, independent of both Casdoor login and the existing radar-visibility checkboxes.

## Consequences

Every downstream Phase 1 module (`board-store.js`, `permission.js`, `nla.js`, `block-map.js`, `facility-config.js`) is designed against this corrected picture, not the guide's original assumption. Beacon/squawk code minting (guide §3.10.1, also flagged for WP0 to establish) was likewise confirmed absent — `src/efsp/code-allocator.js` is equally net-new, not an extension of `resolve.js`'s squawk-map (which is a cosmetic observed-code-to-display-name lookup, never an allocator).
