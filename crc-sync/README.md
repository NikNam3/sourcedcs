# crc-sync

Central multiplayer sync backend for [`crc-desktop`](../crc-desktop) — the sole gRPC (DCS telemetry) and SRS-transponder client on behalf of every connected crc-desktop instance, broadcasting merged track state + a collaborative overlay (IFF declarations, renames, track numbers) over a Casdoor-authed WebSocket.

Replaces the retired `asacs_link` service. Unlike asacs_link, it has no public browser-facing GCI dashboard today — `public/` exists but is an unused scaffold; every client is crc-desktop itself.

## Quick start

```bash
cp .env.example .env   # local dev only -- production values come from infra/.env via infra/docker-compose.yml
npm install
npm start
npm test   # node --test tests/*.test.mjs
```

## Architecture

- `server.js` — Express app: `/js/config.js` (Casdoor client config for the browser), `POST /api/auth/token` (Casdoor code exchange, cross-origin from crc-desktop's Electron renderer), `POST /api/ws-ticket` (mints a single-use, 30s-TTL WebSocket connect ticket from a valid bearer JWT — see `src/auth.js` for why: it keeps the long-lived JWT out of the `/feed` WebSocket URL, which would otherwise land in proxy/access logs), and a few on-demand RPC proxies (ATIS transmit, SRS client list, airport weather).
- `src/grpc-client.js` / `src/srs-client.js` — upstream DCS-gRPC and SRS-transponder clients, configured via `DCS_GRPC_HOST` / `SRS_HOST` / `SRS_PORT`.
- `src/tracks.js` — in-memory DCS ground truth. Never sent to a client as-is.
- `src/collab-store.js` — the collaborative overlay: manual IFF declarations and tags, shared across every connected client.
- `src/surveillance/` — what a controller is told about a contact (`docs/adr/0059`): the transponder model (`transponder.js`), who a contact is (`identity.js`, `track-numbers.js`), the datalink feed (`datalink.js`), IFF (`iff.js`), and `presentation.js`, the single function that builds the wire track from the sensors of one controller's Positions. `CRCSYNC_COALITION` env var (`2`=RED, `3`=BLUE, default BLUE) sets which DCS coalition counts as "own".
- `src/ws-hub.js` — the `/feed` WebSocket: ticket-gated connection (`verifyClient`), one 500ms hub tick that sends each session what its sensors returned (`updated`), whose identity changed (`relabeled`) and what left (`gone`), and the rest of the message protocol.

## Deploy

Built and pushed as a Docker image by `.github/workflows/crc-sync-docker.yml` (push to `main`/`dev`, a `v*` tag, or `workflow_dispatch` — the last of these is how `crc-desktop-release.yml` forces a redeploy alongside every crc-desktop release, since client releases are often codependent on this backend). See the root `CLAUDE.md`'s "How the docker-image services deploy" section for the full deploy chain and two non-obvious gotchas in it.
