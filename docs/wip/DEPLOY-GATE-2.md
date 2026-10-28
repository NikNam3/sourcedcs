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

## What changed

1. `crc-sync-docker.yml`: `org.sourcedcs.wire-protocol=<n>` image label (from `crc-sync/src/wire-protocol.js`), digest in the run summary.
2. `.github/scripts/protocol-gate.sh` rewritten: resolve tag -> digest, read the label of that digest, compare with the newest published release.
   Outputs `hold`, `image` (`repo@sha256:...`), `server_protocol`. `deploy.yml` passes `CRC_SYNC_IMAGE=<digest>`; `infra/docker-compose.yml`
   uses `${CRC_SYNC_IMAGE:-...crc-sync:${TAG:-latest}}`. Pull stays scoped to `main-website atobrief crc-sync`; hold path unchanged.
3. Fails closed (API unreadable, no tag, unreadable client file, no label, unresolved digest). `skip_protocol_gate` still bypasses the comparison.
4. Newest published = `sort -V` max of win/linux versions.
5. `crc-desktop-release.yml`: a leg without installer + manifest exits 1; new `verify-published` job turns a half-published run red. The crc-sync
   dispatch stays unconditional (not in its `needs`).
6. `infra/tests/protocol-gate.test.js` (19 cases), run by `infra-nginx-check.yml` (paths widened to `.github/scripts/**` and `deploy.yml`).
7. RUNBOOK (MapTiler step 3, the gate paragraph, the 2026-10 release step 3) now go through the Deploy workflow / the gate script.
8. `atobrief-docker.yml`: `test` job, `build-and-push` needs it.
9. CLAUDE.md: deploy section describes the gate and `CRC_SYNC_IMAGE`; the wire-protocol paragraph says fails closed.

## Erratum for ADR 0103 (supervisor: ADRs are not edited, P4)

- "refuses to deploy a crc-sync whose `WIRE_PROTOCOL` differs from the one in the published crc-desktop release" was true only of the *source* at
  `head_sha`, not of the image deployed. Since DEPLOY-GATE-2 the protocol is the `org.sourcedcs.wire-protocol` label of the image digest being deployed.
- "fails closed" was false until now: an unreadable releases API let crc-sync through (S-QA-A). It now holds crc-sync (the rest still deploys).
- "published release" = the newest version listed (win or linux), not every listed version.
- Images built before this change carry no label; the first deploy after merge will hold crc-sync until a labelled image exists (see below).

## Defaults taken

- Took the API (not git tags) as the source of "published", failing closed when unreadable, per the briefing; the newest tag in git is not consulted.
- Dev deploys stay ungated and unpinned (`CRC_SYNC_IMAGE` empty, compose falls back to `crc-sync:dev`).
- `:latest` is used as the ref only when a non-crc-sync build triggered the deploy (no `sha-` image exists for that commit); it is pinned to a digest in the gate.

## Not done / to verify

- Not run: no workflow can be run here. `actionlint` is not installed (not installed on request); YAML parsed with PyYAML; compose rendered with `docker compose config`.
- `docker buildx imagetools inspect --format '{{json .Image}}'` and `'{{.Manifest.Digest}}'` are untested against ghcr (stubbed in the test). The jq accepts both
  a flat image config and a per-platform map.
- The server's ghcr login: unchanged. The runner logs in with `GITHUB_TOKEN` (`packages: read`); if the package is private to another owner, the gate will hold with "could not resolve".

## First real deploy: human checks

1. Merge, then let `crc-sync-docker.yml` run once on main BEFORE the deploy matters: only that build produces a labelled image. A deploy triggered by atobrief/web
   before then resolves `:latest`, finds no label and holds crc-sync (safe, with an error saying so).
2. In the crc-sync run summary: digest and label match the protocol in `crc-sync/src/wire-protocol.js`.
3. In the Deploy run: the gate log prints `... (ghcr.io/...@sha256:...) and the newest published CRC vX both speak protocol N`, and the SSH log prints `crc-sync image: ...@sha256:...`.
   On the server: `docker inspect crc-sync --format '{{.Image}} {{.Config.Image}}'`.
4. Check `docker buildx imagetools inspect` output works on the runner (the gate's error text says which step failed if not).
5. Next crc-desktop release: `verify-published` is green, and both manifests list the new version.
