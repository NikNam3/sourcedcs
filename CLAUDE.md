# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

SOURCE DCS is an open-source monorepo for a virtual aviation squadron. It contains these independent services:

- **atobrief** — Tactical briefing web app (ATO packages, airspace, SPINS, real-time presenter/presentee sync)
- **sourcedcs-web** — Squadron public website (roster via Discord, events, applications, media, and crc-desktop's download page)
- **crc-sync** — Central multiplayer sync backend for crc-desktop (DCS-gRPC + SRS client, Casdoor-authed WebSocket feed). Replaces the retired `asacs_link`.
- **crc-desktop** — Electron desktop GCI/datalink client ("CRC") that connects to crc-sync. Bundles a local Node server and a Python SRS radio bridge (`lxsrs_v2`).
- **lxsrs_v2** — Python SRS Standalone client library used by crc-desktop's bundled radio bridge (not a standalone service — see crc-desktop's architecture below).
- **tools/miztoyaml** — Python CLI that converts DCS `.miz` mission files to ATO brief YAML

Infrastructure (Nginx, MariaDB, Casdoor OAuth, MediaWiki) lives in `infra/` as a Docker Compose stack.

> `asacs_link` no longer exists in this repo (retired, replaced by `crc-sync` + `crc-desktop`). If you see references to it in older docs, commit messages, or comments, they're stale.

## Commands

Each service is independent — there is no root-level build script.

### atobrief (Node.js, Express + Socket.IO, port 4000)
```bash
cd atobrief && npm install
PORT=4000 npm start
```

### sourcedcs-web (Node.js, Express, port 7000)
```bash
cd sourcedcs-web && npm install
PORT=7000 npm start
npm test   # node --test test/*.test.js
```

### crc-sync (Node.js, Express + ws, port 3000)
```bash
cd crc-sync && npm install
npm start
npm test   # node --test tests/*.test.mjs
```

### crc-desktop (Electron)
```bash
cd crc-desktop && npm install
npm start           # runs the app locally via `electron .`
npm test             # node --test tests/*.test.js — see "crc-desktop internals" below
npm run pack:linux   # electron-builder AppImage, unpublished, into dist/
npm run pack:win     # electron-builder NSIS installer, unpublished, into dist/
```
`app/` is its own package (its `package.json` declares "crc-server", the bundled local Express server) with its own `node_modules` — after `npm install` at the crc-desktop root, also run `npm install` inside `crc-desktop/app` before packaging or the asar will be missing `app/node_modules/dotenv`. See "How to build and release crc-desktop" below before touching packaging config.

### miztoyaml (Python 3)
```bash
pip install pyyaml
python3 -m tools.miztoyaml mission.miz
python3 -m pytest tools/tests/ -v
```

### Full production stack
```bash
cp .env.example infra/.env   # fill in domains, tokens, secrets
cd infra && docker compose up -d
```

### Nix dev environment
```bash
nix develop          # enter dev shell with Node.js, Python 3, Docker
```
Per-service `nix build .#<name>` package definitions in `flake.nix` predate `crc-sync`/`crc-desktop` and are not guaranteed current for every service — verify before relying on one for anything beyond atobrief/sourcedcs-web.

## Architecture

### atobrief

`server.js` is an Express server that also manages Socket.IO rooms for presenter/presentee session sync. The browser app is a vanilla-JS SPA (`public/index.html`).

Frontend structure under `public/js/`:
- `app.js` — core app logic, YAML package state
- `auth.js` — Casdoor OAuth flow
- `session.js` — Socket.IO session management (presenter broadcasts tab/scroll state to presentees)
- `editor/` — per-section YAML editors (ACO, COMMS, SPINS, etc.)
- `views/` — tab renderers (ATO, ACO, Weather, SPINS)
- `map/` — interactive SVG tactical map (routes, targets, airspace drawn from YAML data)
- `loadout.js` — decodes aircraft loadout CLSIDs

The presenter hashes their password with `crypto.scryptSync` + salt server-side; presentees join with a room code. Session state (current tab, scroll position) is broadcast to all presentees in real time.

YAML package schema is documented in `docs/atobrief/yaml-format.md` (six sections: `header`, `registry`, `ato`, `aco`, `spins`, `comms`, `weather`).

### sourcedcs-web

`server.js` is a single Express server handling:
- Discord bot integration — syncs roster/roles into a local JSON cache
- JSON-file persistence for events, applications, and squadron data (stored in a Docker volume, `data/`)
- Multer file uploads (gallery images, and separately, crc-desktop release installers)
- Casdoor OAuth token exchange
- **crc-desktop release hosting** — `releases.js` (`parseReleaseManifest`, `checkReleaseUploadToken`), `POST /api/releases/upload` (CI-only, bearer-token gated — see "How to build and release crc-desktop"), `GET /api/releases/latest`, static `/downloads`, and `public/download.html`. Installers land in `data/releases/`, same Docker volume as everything else.

Client secret (`DISCORD_BOT_TOKEN`, `CASDOOR_CLIENT_SECRET`, `RELEASE_UPLOAD_TOKEN`) never reaches the browser. `express-rate-limit` protects auth, upload, and release-upload endpoints.

### crc-sync

Central backend crc-desktop instances connect to — replaces the old asacs_link server-side role, minus its browser-facing GCI dashboard (crc-sync has no public UI; `public/` is currently an unused scaffold).

- `server.js` — Express + `ws`. Casdoor OAuth code exchange (`POST /api/auth/token`), single-use short-TTL WebSocket connect tickets (`POST /api/ws-ticket`, `src/auth.js`) so a long-lived bearer JWT never rides in a `/feed` WebSocket URL.
- `src/grpc-client.js` / `src/srs-client.js` — sole gRPC (DCS telemetry) and SRS-transponder client on behalf of every connected crc-desktop instance.
- `src/tracks.js` / `src/collab-store.js` — in-memory track state + collaborative overlay (manual IFF declarations, renames, track numbers), delta-broadcast to clients every 500ms via `src/ws-hub.js`.
- `src/resolve.js` — per-track IFF/callsign resolution (server-side now, was client-side in the original asacs_link/crc-desktop code); `CRCSYNC_COALITION` env var sets which DCS coalition is "own".

Deployed as a Docker image (`ghcr.io/niknam3/sourcedcs/crc-sync`) via `.github/workflows/crc-sync-docker.yml` — see "How the docker-image services deploy" below.

### crc-desktop

Electron app ("CRC") — the squadron's DCS multiplayer GCI/datalink client. See **`crc-desktop/README.md`** for the full picture (packaging gotchas, the Python venv auto-provisioning, autoupdate wiring); summary:

- `main.js` — Electron main process. Spawns the bundled local server (`app/server.js`, an Express server serving the renderer UI and proxying a few on-demand crc-sync RPCs), creates the `BrowserWindow`, and drives `electron-updater`.
- `lxsrs-setup.js` — SRS radio bridge launch logic, deliberately kept Electron-free (`require('electron')` outside a running Electron process doesn't return the real API) so it's unit-testable. Creates a Python venv on first run and pip-installs `lxsrs_v2`'s third-party deps into it against whatever `python3` is actually on the machine, since those deps include compiled extensions tied to a specific CPython ABI that can't be reliably pre-bundled.
- `app/` — the bundled local server + browser UI, **its own npm package** (see Commands above — this is the single most common source of packaging bugs, detailed in crc-desktop/README.md).
- `python-pkg/` — `lxsrs_v2` itself (pure Python source, pip-installed with `--no-deps` and committed to git), bundled via `electron-builder`'s `build.linux.extraResources`.

Released via `.github/workflows/crc-desktop-release.yml` — see "How to build and release crc-desktop" below.

### miztoyaml

A Python 3 package that unzips `.miz` files (ZIP archives containing Lua tables), parses the mission structure, and emits an ATO brief YAML package.

Key parsing challenge: DCS mission files are Lua tables, not JSON. `lua.py` provides brace-balanced extraction helpers; `parse.py` and `parse_flights.py` use regex + those helpers to walk the structure. Coordinate projection (DCS Cartesian → WGS84) is in `projection.py` using theater-specific Transverse Mercator constants.

Module responsibilities:
- `extract.py` — top-level orchestration and CLI
- `parse.py` / `parse_flights.py` — group, flight, carrier, waypoint, weather, drawing parsing
- `build_targets.py` — SAM sites, airspace, aim-points
- `build_missions.py` — airfield registry, mission list assembly
- `build_doc.py` — final YAML document assembly
- `weapons.py` — CLSID → weapon name lookup
- `dtc.py` — DTC file and SPINS markdown parsing
- `sam.py` — SAM threat definitions and classification

## How the docker-image services deploy (atobrief, sourcedcs-web, crc-sync)

Each has its own `.github/workflows/<name>-docker.yml`: on push to `main`/`dev` (path-filtered to that service's directory) or a `v*` tag, it builds and pushes `ghcr.io/niknam3/sourcedcs/<name>:<tag>`.

`.github/workflows/deploy.yml` listens for any of those three workflows completing successfully on `main`/`dev`, then SSHes into the server and runs:
```bash
cd <PATH>            # repo checkout root on the server
git pull --ff-only    # picks up infra/docker-compose.yml, .env key names, etc.
cd infra
docker compose pull main-website atobrief crc-sync   # only our own published images —
docker compose up -d                                  #   NOT mariadb/casdoor/certbot/nginx (see below)
```

**Two non-obvious things about this pipeline, both found the hard way:**
1. `docker compose pull` is deliberately scoped to just the three images we publish. Pulling every service (including third-party base images like `mariadb:11`) means one transient registry hiccup on an image that didn't even change aborts the *entire* deploy under `set -e` — this once blocked an unrelated nginx config fix for hours.
2. The `git pull` step is what actually gets a **non-image** config change (e.g. `infra/docker-compose.yml`, `nginx`'s embedded config, `.env.example`) onto the server. Before it existed, editing `docker-compose.yml` in the repo did nothing to the running stack until someone manually pulled on the server — `docker compose pull && up -d` alone only ever picks up new *images*.

`nginx`'s config is generated inline in `infra/docker-compose.yml`'s `command:` block (no standalone `nginx.conf`). `client_max_body_size` there is `350M` — needed for crc-desktop installer uploads; if you're debugging a `413` on any upload endpoint, check this first, and remember it only takes effect after the `git pull` + `docker compose up -d` sequence above actually runs on the server (not just after merging to `main`).

## How to build and release crc-desktop

Tag a commit `crc-desktop-vX.Y.Z` and push the tag — `.github/workflows/crc-desktop-release.yml` handles the rest:

1. Matrix build on `windows-latest` (NSIS `.exe`) and `ubuntu-latest` (`.AppImage`). Each leg: `npm ci` at the crc-desktop root, `npm ci` again inside `app/` (see "crc-desktop" architecture above for why), `npm test`, sets the version from the tag, runs `electron-builder --publish never`.
2. Uploads the installer + its `latest.yml`/`latest-linux.yml` manifest to `sourcedcs-web`'s `POST /api/releases/upload`, authenticated with the `RELEASE_UPLOAD_TOKEN` repo secret (must match the `RELEASE_UPLOAD_TOKEN` env var sourcedcs-web reads — set in `infra/.env` on the server, wired through `infra/docker-compose.yml`).
3. A final job triggers `crc-sync-docker.yml` (`workflow_dispatch`) **unconditionally** (`if: ${{ !cancelled() }}`, not `needs: build` alone) — a crc-desktop release always forces a crc-sync rebuild+redeploy, since many client-side changes are codependent on the server it talks to. This must stay unconditional: gating it on the build succeeding creates a deadlock if the actual failure is a stale server-side config the crc-sync redeploy itself would fix (this happened once with the nginx body-size limit above).

Installed crc-desktop instances autoupdate via `electron-updater` against `https://sourcedcs.page/downloads` (generic HTTP provider — `package.json`'s `build.publish`), polling `latest.yml`/`latest-linux.yml`. The public download page is `sourcedcs-web/public/download.html`, populated from `GET /api/releases/latest`.

**Before changing crc-desktop's `package.json` `build` config**, read `crc-desktop/README.md` and run `npm test` (`crc-desktop/tests/packaging-config.test.js` statically checks the exact config shape that's broken packaging before — `directories.app`, the `files` array) — a wrong change there packages successfully but produces an app that crashes on first launch, which local testing might not catch if your dev machine happens to already have leftover state (`app/node_modules`, a Python venv) masking the bug.

## Authentication

All services use [Casdoor](https://casdoor.org/) for OAuth 2.0. Configuration is documented in `sourcedcs-web/CASDOOR_SETUP.md`. The OAuth code exchange happens server-side; client secrets are never sent to the browser. `crc-sync` additionally mints single-use, 30-second-TTL WebSocket connect tickets (`src/auth.js`) so the bearer JWT itself never appears in a `/feed` WebSocket URL (which would otherwise land in proxy/access logs).

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Used by |
|---|---|
| `CASDOOR_ENDPOINT` | atobrief, sourcedcs-web, crc-sync |
| `ATOBRIEF_CLIENT_ID` / `ATOBRIEF_CLIENT_SECRET` | atobrief |
| `CRCSYNC_CLIENT_ID` / `CRCSYNC_CLIENT_SECRET` | crc-sync |
| `CRCSYNC_DCS_GRPC_HOST`, `CRCSYNC_SRS_HOST`, `CRCSYNC_SRS_PORT` | crc-sync (DCS server upstream) |
| `DISCORD_BOT_TOKEN` | sourcedcs-web |
| `RELEASE_UPLOAD_TOKEN` | sourcedcs-web (accepts uploads) + the `crc-desktop-release.yml` repo secret (sends them) — must match |
| `CRCSYNC_SOURCEDCS_WEB_URL` | crc-sync (EFSP flight-plan lookup — reaches sourcedcs-web at `http://main-website:7000` inside the Docker stack) |
| `FLIGHT_PLAN_SERVICE_TOKEN` | sourcedcs-web (accepts EFSP's filed-plan queries) + crc-sync (sends them) — must match |
