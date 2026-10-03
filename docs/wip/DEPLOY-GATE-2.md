# DEPLOY-GATE-2 (B14)

## Code as found

- `.github/scripts/protocol-gate.sh` read `WIRE_PROTOCOL` from the checked-out source (`crc-sync/src/wire-protocol.js`, regex `WIRE_PROTOCOL:`) at the
  triggering `head_sha`, then `deploy.yml` pulled the mutable `ghcr.io/niknam3/sourcedcs/crc-sync:latest` (compose: `crc-sync:${TAG:-latest}`).
  The check and the deployed image could be different builds.
- The script failed OPEN when `https://sourcedcs.page/api/releases/latest` could not be read (warning, `hold=false`).
- It gated on every version listed by the API (win and linux), so a half-published release (one leg uploaded) held crc-sync on the older one.
- No test. Two different regexes for the two wire-protocol files.
- `crc-sync-docker.yml` pushed tags (branch, `sha-<short>`, `latest`) and metadata-action labels only; no wire label, digest not recorded.
- `crc-desktop-release.yml`: the upload step globbed `*.exe *.AppImage ...` with `nullglob`; a leg that produced nothing uploaded nothing and passed.
  `trigger-crc-sync-release` dispatches crc-sync unconditionally (kept).
- RUNBOOK (MapTiler step 3, "The gate" paragraph) said `docker compose pull crc-sync && docker compose up -d` (bypasses the gate) and
  "the gate warns and lets crc-sync through" when the API is unreadable.
- `atobrief-docker.yml` had no test step.
