# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

SOURCE DCS is an open-source monorepo for a virtual aviation squadron. It contains these independent services:

- **atobrief** — Tactical briefing web app (ATO packages, airspace, SPINS, real-time presenter/presentee sync)
- **sourcedcs-web** — Squadron public website (roster via Discord, events, applications, media, and crc-desktop's download page)
- **crc-sync** — Central multiplayer sync backend for crc-desktop (DCS-gRPC + SRS client, Casdoor-authed WebSocket feed). Also owns the **radar picture**: radars, sweep, terrain line-of-sight and per-Position coverage all live here rather than in each client (`docs/adr/0042`). Replaces the retired `asacs_link`.
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
npm test   # node --test test/*.test.js
```

### sourcedcs-web (Node.js, Express, port 7000 via `PORT`)
```bash
cd sourcedcs-web && npm install
PORT=7000 npm start   # server.js itself defaults to 3000 when PORT is unset; the compose stack sets 7000
npm test   # node --test test/*.test.js
```

### crc-sync (Node.js, Express + ws, port 3000)
```bash
cd crc-sync && npm install
npm start
npm test   # node --test tests/*.test.mjs
npm run freeze           # opt-in golden-replay suite (tests/freeze/, ADR 0095 §1); not part of npm test
npm run walk             # opt-in I11 control-release walk at depth 4 (npm test runs depth 3; CRCSYNC_WALK_DEPTH=n overrides)
npm run soak:selfcheck   # proves every soak detector fires (~40 s); not part of npm test
npm run soak:smoke       # 20 virtual minutes of simulated EFSP traffic; `npm run soak -- --minutes 240` for the §13 run
```
**A lane runs both unit suites (crc-sync and crc-desktop), whichever side it edits**: the client and server parity tests read each other's files. Test processes (all three Node suites) get a private `TMPDIR` that is removed on exit; crc-sync's preload also warns when the checkout's real `state/` changed during a run (fails under `CI`). Freeze goldens number ids per golden by first appearance and hash only `PROJECTION` (`tests/freeze/freeze-lib.mjs`); other fields are unhashed ext, cross-cutting counters go in `VOLATILE_KEYS`, and `table-mutations/` and `hub-op-matrix/` hold one file per op. Never hand-merge a golden: take either side, `npm run freeze:update`, check the diff is small, commit it separately.
The EFSP soak harness lives in `crc-sync/tools/soak/` (flags and profiles in its `run.js`). The literal four-hour
run is the manual-dispatch workflow `.github/workflows/crc-sync-soak.yml` ("crc-sync EFSP soak (manual)"). Run
`soak:selfcheck` after touching `board-store.js`, `board/**`, `efsp-ws.js`, `wire/**`, `ws-hub.js`, `sync/**` or
`tools/soak/host-core.js`. The wave-2 findings the soak used to fail on are fixed (`docs/efsp-briefing.md` §3I/§4 has the state), and the `drop-broadcast` selfcheck detector fires
again (`docs/wip/SOAK.md`). `memory.slope` and `memory.netGrowth` are judged only on runs of 3 hours or more whose
warm-up covers the soak's finished-Strip retention (the soak host keeps 2 h; production archives after 12 h, ADR 0107;
`--retention-min` overrides it): the heap keeps filling until the archiver starts removing
DROPPED Strips, so a shorter run (including `soak:smoke`) reports them as **not judged**, which is neither a failure
nor a pass. `--warmup-min <m>` overrides the warm-up and `--judge-memory` forces the gate (the selfcheck `leak` case
uses it). The not-judged rule is `memoryPolicy()` in `tools/soak/report.js` (`docs/wip/SOAKW.md`).
The soak host runs the surveillance hint monitor and the Boards' airborne observer as `createApp` builds them
(`surveillanceHints` is left unset), and the shadow clients track the six stores' seq/epoch like the shipped client
(`tools/soak/shadow.js`; heartbeat `stores`, store frames, a slice resync after two beats behind): a store still behind
after 6 heartbeats is the **`store-stale`** failure (`mutations.storeSync.stale`; selfcheck case `drop-store-delta`).
The soak never rolls the mission, so the mission reset (ADR 0108) is not exercised (`docs/wip/folded-phase3/NX-1.md`).

### crc-desktop (Electron)
```bash
cd crc-desktop && npm install
npm start           # runs the app locally via `electron .`
npm test             # node --test 'tests/*.test.{js,mjs}': five CommonJS tests (packaging, lxsrs-setup, patch-notes, proxy routes, sharded runner), the rest ES modules
npm run pack:linux   # electron-builder AppImage, unpublished, into dist/
npm run pack:win     # electron-builder NSIS installer, unpublished, into dist/
```
`app/` is its own package (its `package.json` declares "crc-server", the bundled local server, plain Node `http`/`https`, no Express) with its own `node_modules` — after `npm install` at the crc-desktop root, also run `npm install` inside `crc-desktop/app` before packaging or the asar will be missing `app/node_modules/dotenv`. See "How to build and release crc-desktop" below before touching packaging config.

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
`flake.nix` provides dev shells only (`nix develop`, `nix develop .#srs`); the per-service nix packages were removed (R3-67).

## Architecture

### atobrief

`server.js` is an Express server that also manages Socket.IO rooms for presenter/presentee session sync. The browser app is a vanilla-JS SPA (`public/index.html`).

Frontend structure under `public/js/`:
- `app.js` — core app logic, YAML package state
- `usmtf-ato.js` — exports the package as a USMTF ATO (`docs/adr/0078`), in the EXPORT dialog and at `GET /api/rooms/:id/ato.usmtf` / `POST /api/usmtf` (`usmtf-api.js`, service token `ATOBRIEF_USMTF_TOKEN` or a signed-in user's token). USMTF is the interface between systems; the YAML stays atobrief-internal
- `auth.js` — Casdoor OAuth flow
- `session.js` — Socket.IO session management (presenter broadcasts tab/scroll state to presentees)
- `editor/` — per-section YAML editors (ACO, COMMS, SPINS, etc.)
- `views/` — tab renderers (ATO, ACO, Weather, SPINS)
- `map/` — interactive SVG tactical map (routes, targets, airspace drawn from YAML data)
- `loadout.js` — decodes aircraft loadout CLSIDs

The presenter hashes their password with `crypto.scryptSync` + salt server-side; presentees join with a room code. Session state (current tab, scroll position) is broadcast to all presentees in real time.

YAML package schema is documented in `docs/atobrief/yaml-format.md` (seven sections: `header`, `registry`, `ato`, `aco`, `spins`, `comms`, `weather`).

### sourcedcs-web

`server.js` is a single Express server handling:
- Discord bot integration — syncs roster/roles into a local JSON cache
- JSON-file persistence for events, applications, and squadron data (stored in a Docker volume, `data/`)
- Multer file uploads (gallery images, and separately, crc-desktop release installers)
- Casdoor OAuth token exchange
- **crc-desktop release hosting** — `releases.js` (`parseReleaseManifest`; the token gate is `requireServiceToken` in `service-token.js`), `POST /api/releases/upload` (CI-only, bearer-token gated — see "How to build and release crc-desktop"), `GET /api/releases/latest`, static `/downloads`, and `public/download.html`. Installers land in `data/releases/`, same Docker volume as everything else.

`data/*.json` is gitignored runtime data (prod: the `sourcedcs-web-data` volume); first-boot defaults are in `data-seed/`, copied by `seed.js` only where absent.

Client secret (`DISCORD_BOT_TOKEN`, `CASDOOR_CLIENT_SECRET`, `RELEASE_UPLOAD_TOKEN`) never reaches the browser. `express-rate-limit` protects auth, upload, and release-upload endpoints.

### crc-sync

Central backend crc-desktop instances connect to — replaces the old asacs_link server-side role, minus its browser-facing GCI dashboard (crc-sync has no public UI and no `public/` directory; `GET /js/config.js` is its only browser-facing leftover).

- `src/app.js` — `createApp({ env })`, the composition root (ADR 0095 §4; the injected `env` is the **whole** environment, and config is built by factories — `createFacilityConfig`, `createStereoRoutes`, `createAptConfig`, `createPermission({ classOf })`, `state-paths` `dirs(env)` — never read at require time, which `tests/no-require-time-config.test.mjs` pins): the Express app, the `ws` hub, the EFSP runtime and the **named tickers** (`tickers`, which the soak reuses). Its pieces live in `src/app/` (HTTP routes, radar picture, monitors, tickers, feed handlers, archive, weather, active runway); the two remaining hub↔producer cycles are explicit named links in `src/app/late-binding.js`, which throw if used before they are bound. It serves `GET /js/config.js`, the Casdoor OAuth code exchange (`POST /api/auth/token`) and single-use short-TTL WebSocket connect tickets (`POST /api/ws-ticket`, `src/auth.js`) so a long-lived bearer JWT never rides in a `/feed` WebSocket URL. `server.js` only builds the gRPC and SRS clients and listens.
- `src/grpc-client.js` / `src/srs-client.js` — sole gRPC (DCS telemetry) and SRS-transponder client on behalf of every connected crc-desktop instance.
- `src/tracks.js` / `src/collab-store.js` / `src/collab-wiring.js` — in-memory DCS ground truth + the collaborative overlay (manual IFF declarations, tags). Truth never reaches a client. The overlay persists to `state/collab-overlay.json`, tied to the mission session and each entry's unit identity (ADR 0094).
- `src/surveillance/` — **what a controller is told about a contact** (`docs/adr/0059`). `presentation.js`'s `presentTrack()` is the single choke point: a session gets a position, and a code/altitude/name only if one of *its own* sensors could know it (radar `caps.ssr`/`caps.height`, the transponder model in `transponder.js`, the datalink feed in `datalink.js`, identity in `identity.js`: correlated Strip callsign > datalink > tag > track number). Sent by `src/ws-hub.js` every 500ms. Client-side, `crc-desktop/app/public/js/track-label.js` is the only code that turns it into text. Change how a contact is named or shown in those two files, not in consumers. **IFF colour comes from interrogation, not from the DCS coalition** (`docs/adr/0066`, `0084`): `iff.js`'s `classifyIff()` picks it per session from a declaration, the datalink, a valid Mode 4 reply (`transponder.js`'s `mode4Of()`) or a Mode 3/C reply, and automatic IFF never gives bandit/hostile. Radars carry `caps.mode4`; tactical radars and the military field radars (airport, approach, carrier approach) interrogate Mode 4. Nothing on the ground is hidden. `CRCSYNC_COALITION` sets which DCS coalition is "own" (it models the Mode 4 crypto key); two coalitions controlled at once means two crc-sync servers, one each.
- `src/efsp/` — the Electronic Flight Strip Panel's server half. Layout (ADR 0095): `board-store.js` is the `BoardStore` facade over `board/` (collaborators) and `board/ops/` (one file per Board op); `wire/` and `wire/families/` hold the `/feed` handler's skeleton and one file per wire family (`efsp-ws.js` binds them); `sync/` is the replay cache and sync log; `authority/` is the Position and strip-type tables (who may do what); the other `*-store.js` files are registered in `stores.js` and extend `synced-store.js`'s `SyncedStore` (seq/epoch, sync log, audit, the apply backstop). **Every EFSP frame is built in `wire/frames.js` and sent through `WsHub#deliverEfsp`**, the one delivery path (read-scope filter, directed frames, post-change hook); a new refusal code must join `refusal-codes.js`'s `REFUSAL_CODES`. A Position that is left keeps its Strips and the next controller on its `consolidation` offer list takes the hat (`hatOffers` on the wire, ADR 0110); only TACTICAL's `handBack` moves Strips. `docs/efsp-briefing.md` is its handoff note and `docs/efsp-usage-guide.md` the controller's guide, and **`docs/glossary.md`** maps the pre-W7 words (seat, occupied, held, covering chain, FDR, Strip Role, field state, …) to the FAA-based ones — read it before any ADR or note older than the rename; EFSP times come from the injected mission clock (in-game Zulu, `docs/adr/0079`), never `Date.now()`.

Deployed as a Docker image (`ghcr.io/niknam3/sourcedcs/crc-sync`) via `.github/workflows/crc-sync-docker.yml` — see "How the docker-image services deploy" below.

### crc-desktop

Electron app ("CRC") — the squadron's DCS multiplayer GCI/datalink client. See **`crc-desktop/README.md`** for the full picture (packaging gotchas, the Python venv auto-provisioning, autoupdate wiring); summary:

- `main.js` — Electron main process. Spawns the bundled local server (`app/server.js`, a plain Node `http`/`https` server serving the renderer UI and proxying a few on-demand crc-sync RPCs), creates the `BrowserWindow`, and drives `electron-updater`.
- `lxsrs-setup.js` — SRS radio bridge launch logic, deliberately kept Electron-free (`require('electron')` outside a running Electron process doesn't return the real API) so it's unit-testable. Creates a Python venv on first run and pip-installs `lxsrs_v2`'s third-party deps into it against whatever `python3` is actually on the machine, since those deps include compiled extensions tied to a specific CPython ABI that can't be reliably pre-bundled.
- `app/` — the bundled local server + the renderer UI (`app/public/`), **its own npm package** (see Commands above — this is the single most common source of packaging bugs, detailed in crc-desktop/README.md). The renderer is native ES modules (ADR 0095 §6, `crc-desktop/README.md` "Client modules"): `index.html` loads `/js/config.js` as a classic script, then one `<script type="module" src="./js/main.js">` that imports the rest. **The import graph has no cycle** (`tests/module-graph.test.mjs`, bound 0: never raise it): shared state lives in leaf modules that import nothing (`settings.js`, `map-handle.js`, `picture.js`, `view-state.js`, `panels/efsp/{facility-topology,sync-cursor,efsp-change-bus,board-data}.js`, …), `app.js` only owns the socket and writes them, and a handler marks a change-bus topic (`markEfspChanged`) instead of calling a renderer. **No `window.*` globals** (`tests/no-window-globals.test.mjs`); the Playwright specs reach modules through `window.crc.<module>`, which only the test helper `e2e/helpers/modules.js` sets, so a spec must follow a function that moves. Sync position is one cursor per Board/store in `sync-cursor.js`; acks go through `efsp-ws.js`'s `sendEfsp(msg, {onAck})`.
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
On `main`, a "Wire protocol gate" step runs first (`.github/scripts/protocol-gate.sh`, tested by `infra/tests/protocol-gate.test.js`). It resolves the crc-sync image to a digest, reads the `org.sourcedcs.wire-protocol` label `crc-sync-docker.yml` stamped on it, compares that with the newest published crc-desktop release, and **fails closed**; the SSH step then exports `CRC_SYNC_IMAGE=<that digest>` so compose pulls exactly the image that was checked (unset, compose uses `crc-sync:${TAG:-latest}`). A hold leaves only crc-sync alone. Recreate crc-sync by re-running the Deploy workflow, never by a bare `docker compose up -d` (`infra/RUNBOOK.md`).

**Two non-obvious things about this pipeline, both found the hard way:**
1. `docker compose pull` is deliberately scoped to just the three images we publish. Pulling every service (including third-party base images like `mariadb:11`) means one transient registry hiccup on an image that didn't even change aborts the *entire* deploy under `set -e` — this once blocked an unrelated nginx config fix for hours.
2. The `git pull` step is what actually gets a **non-image** config change (e.g. `infra/docker-compose.yml`, `nginx`'s embedded config, `.env.example`) onto the server. Before it existed, editing `docker-compose.yml` in the repo did nothing to the running stack until someone manually pulled on the server — `docker compose pull && up -d` alone only ever picks up new *images*.

**`crc-sync` has three directories, and the distinction matters for deploys.** `config/` holds shipped
squadron defaults (facility, airspace, sensor specs, alerting thresholds) and `data/` holds shipped read-only
reference tables (the airfield name-to-ICAO map) — both baked into the image. `state/` holds
everything the service writes, and is the `crc-sync-state:/app/state` volume. A read prefers `state/`
and falls back to the shipped default, so a new default added by an image update lands with no
migration (`crc-sync/src/state-paths.js`, `docs/adr/0048`). **`state/` is strict, not forgiving:** an old or unknown-key Board snapshot, invalid JSON in the Board snapshot, a missing/invalid facility file, or an unknown key in a tuning layer stops start-up with the file and the reason (`checkPersistedShape` in `src/efsp/stores.js`, `docs/adr/0095`; `checkLayerKeys` in `src/tuning-file.js`); an unparseable tuning layer is instead ignored with a warning (the shipped file applies), and so is an unreadable `apt-config.json` (starts empty); there is no migration or merge, so the fix is to correct or delete the named file.

`config/theaters.json` holds the fixed per-theater facts keyed by the name DCS-gRPC's `GetTheatre` returns: UTC
offset, **transition altitude** (Syria 10,000 ft, the rest 18,000 until someone checks the AIP), the Transverse
Mercator central meridian (grid convergence) and an optional **magnetic variation override** (`fixedDeg` or
`offsetDeg`; none shipped, otherwise the World Magnetic Model at the mission date, `docs/adr/0085`). It is read once
at startup, never written by code, and a copy in `state/theaters.json` overrides it theater by theater, field by
field (`crc-sync/src/theaters.js`). It replaced `theater-settings.json`, one of the seven lost-state items in the next paragraph.

Before that split, seven things were written into the image with no volume behind them and were
silently discarded by every `docker compose up -d` — the EFSP Board, the whole Mutation audit log, the
squadron squawk map, theater settings (the old `theater-settings.json`), per-airport ATIS config and the airspace definitions. Two of
them were also committed to git, so a recreated container restored an old snapshot rather than
starting empty. **Do not mount a volume over `/app/config` or `/app/data`**: an empty named volume shadows the shipped
files and presents as every one of them having reset.

`nginx`'s config is a mounted template, `infra/nginx/templates/` (plus `snippets/` and `entrypoint.d/30-reload-certs.sh`, the 12-hourly certificate reload); `.github/workflows/infra-nginx-check.yml` renders it and runs `nginx -t` on every change. `client_max_body_size` there is `350M` — needed for crc-desktop installer uploads; if you're debugging a `413` on any upload endpoint, check this first, and remember it only takes effect after the `git pull` + `docker compose up -d` sequence above actually runs on the server (not just after merging to `main`). The same config sends `X-Forwarded-For $proxy_add_x_forwarded_for` to the atobrief, sourcedcs-web and crc-sync upstreams, and all three apps set `trust proxy` to 1, so `express-rate-limit` keys on the real client address instead of the nginx container's (this too lands only after the `git pull` + `up -d`).

sourcedcs-web keeps the newest 3 versions of each crc-desktop installer type (`.exe`, `.AppImage`) in `data/releases/`: `pruneReleases` (`releases.js`) runs after every successful `POST /api/releases/upload`, deletes older installers and their `.blockmap`, and never deletes a manifest or the file the latest manifest names.

## How to build and release crc-desktop

Tag a commit `crc-desktop-vX.Y.Z` **on `main`** and push the tag — `.github/workflows/crc-desktop-release.yml` handles the rest (its `verify-main` job refuses a tag whose commit is not on `main`; the docker workflows do the same for `v*` tags):

1. Matrix build on `windows-latest` (NSIS `.exe`) and `ubuntu-latest` (`.AppImage`). Each leg: `npm ci` at the crc-desktop root, `npm ci` again inside `app/` (see "crc-desktop" architecture above for why), `npm test`, sets the version from the tag, runs `electron-builder --publish never`.
2. Uploads the installer + its `latest.yml`/`latest-linux.yml` manifest to `sourcedcs-web`'s `POST /api/releases/upload`, authenticated with the `RELEASE_UPLOAD_TOKEN` repo secret (must match the `RELEASE_UPLOAD_TOKEN` env var sourcedcs-web reads — set in `infra/.env` on the server, wired through `infra/docker-compose.yml`).
3. A final job triggers `crc-sync-docker.yml` (`workflow_dispatch`) **unconditionally** (`if: ${{ !cancelled() }}`, not `needs: build` alone) — a crc-desktop release always forces a crc-sync rebuild+redeploy, since many client-side changes are codependent on the server it talks to. This must stay unconditional: gating it on the build succeeding creates a deadlock if the actual failure is a stale server-side config the crc-sync redeploy itself would fix (this happened once with the nginx body-size limit above).

Installed crc-desktop instances autoupdate via `electron-updater` against `https://sourcedcs.page/downloads` (generic HTTP provider — `package.json`'s `build.publish`), polling `latest.yml`/`latest-linux.yml`. The public download page is `sourcedcs-web/public/download.html`, populated from `GET /api/releases/latest`.

**Wire protocol (`docs/adr/0103`).** `crc-sync/src/wire-protocol.js` and `crc-desktop/app/public/js/wire-protocol.js` each hold an integer `WIRE_PROTOCOL` (a parity test keeps them equal; the per-frame `version: 1` is a different thing and must stay 1). The client sends `protocol=<n>` on the `/feed` URL; a mismatch gets one `update-required` frame and close code 4426, and the client shows an "Update required" overlay instead of reconnecting. Any change to the wire: run `cd crc-sync && npm run wire:record` (`wire-protocol.test.mjs` fails until you do; it bumps both copies only if the last `crc-desktop-v*` tag already shipped the current number). The scan (`tools/wire-surface.js`) covers message types, the Board op table and every store family's op kinds, the carrier's handoff/Case/field names and stack, entry and view keys, `STORE_SYNC`, and the top-level keys of every hub frame and store delta; record contents, ack payloads and the snapshot's fixed keys are not scanned, so a change there needs `npm run wire:record -- --bump`. Release in this order: merge to `main`, tag `crc-desktop-vX.Y.Z`. `crc-sync-docker.yml` runs both unit suites before it builds, and `deploy.yml`'s protocol gate holds back only crc-sync's recreate (everything else still deploys) when the image's protocol label differs from the newest published release's, or when that release cannot be read (fails closed); `skip_protocol_gate` is the human-only override. See `infra/RUNBOOK.md`, "Wire protocol and the deploy gate".

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
| `CRCSYNC_DCS_GRPC_HOST`, `CRCSYNC_SRS_HOST`, `CRCSYNC_SRS_PORT` | crc-sync (DCS server upstream). These are the root `.env` / compose names and compose passes them to the container unrenamed; the code reads them from the injected env and falls back to the bare `DCS_GRPC_HOST`, `SRS_HOST`, `SRS_PORT` (what `crc-sync/.env.example` and the e2e harness set), the `CRCSYNC_` name winning |
| `DISCORD_BOT_TOKEN` | sourcedcs-web |
| `CRCSYNC_DOMAIN` | nginx (the crc-sync vhost's server name and certificate path; compose passes it to the nginx template). The retired `ASACS_DOMAIN` is no longer read |
| `CRCSYNC_URL` | sourcedcs-web (the crc-sync/CRC link on the public site, `store.CRCSYNC_URL`, exposed to pages as `var CRCSYNC_URL` in `/js/config.js`) and crc-desktop (the crc-sync WebSocket endpoint, default `wss://asacs.sourcedcs.page`; from the user's `config.json` key `crcSyncUrl`, which stays). **The name has two meanings**: an https page link on the web, a wss WebSocket endpoint in crc-desktop (they never share a value). The retired `ASACS_URL` and `CRC_SYNC_URL` are no longer read |
| `RELEASE_UPLOAD_TOKEN` | sourcedcs-web (accepts uploads) + the `crc-desktop-release.yml` repo secret (sends them) — must match. Every service token gate answers 503 "not configured" when its token is unset and 401 when wrong or missing (`service-token.js`, a hand copy per service under a parity test) |
| `CRCSYNC_COALITION` | crc-sync (which DCS coalition is "own": `3` BLUE, the default, or `2` RED; it models the Mode 4 crypto key, and carrier hulls are matched against it). In `.env.example` and forwarded by compose |
| `CRCSYNC_SOURCEDCS_WEB_URL` / `SOURCEDCS_CRCSYNC_URL` | A pair, one per direction. `CRCSYNC_SOURCEDCS_WEB_URL`: crc-sync reaching sourcedcs-web (EFSP flight-plan lookup and the booking pull; `http://main-website:7000` in the stack, default `http://localhost:7000`). `SOURCEDCS_CRCSYNC_URL`: sourcedcs-web reaching crc-sync's airspace registry (`crcsync-client.js`; compose hardcodes `http://crc-sync:3000`, default `http://localhost:3000`) |
| `FLIGHT_PLAN_SERVICE_TOKEN` | sourcedcs-web (accepts EFSP's filed-plan queries) + crc-sync (sends them) — must match |
| `AIRSPACE_SERVICE_TOKEN` | sourcedcs-web (sends it to crc-sync's `/api/airspace-registry`; accepts crc-sync's calendar read at `GET /api/bookings/service/upcoming`) + crc-sync (accepts and sends) — must match, as for `FLIGHT_PLAN_SERVICE_TOKEN` |
| `CRCSYNC_SOURCEDCS_WEB_PUBLIC_URL` | crc-sync (the booking-page link shown on an airspace card; not a secret) |
| `CRCSYNC_MAPTILER_KEY` | crc-sync (terrain masking for the radar picture — **optional**: without it every radar sees to its full range and nothing is masked, logged once at startup) |
| `CRCSYNC_MAPTILER_CLIENT_KEY` | crc-sync (the MapTiler key crc-desktop draws its basemap and contours with, served after login by `GET /api/client-config`; **optional**, falls back to `CRCSYNC_MAPTILER_KEY`). crc-desktop's package holds no key; rotation: `infra/RUNBOOK.md` |
| `CRCSYNC_TERRAIN_CACHE_DIR` | crc-sync (DEM tile cache; the Docker stack points it at the `crc-sync-state` volume) |
| `DCS_GRPC_POLL_RATE` / `DCS_GRPC_MAX_BACKOFF` | crc-sync (DCS-gRPC unit stream: seconds between polls, default 1, floor 1; longest re-poll wait for a unit that isn't changing, default 5). Leave unset |
| `CRCSYNC_DOWNLOAD_URL` | crc-sync (optional: the download page the `update-required` frame links an out-of-date crc-desktop to; compose defaults it to `https://sourcedcs.page/download.html`, unset means the frame carries no link) |
| `ATOBRIEF_USMTF_TOKEN` | atobrief (accepts USMTF ATO reads from a machine caller). **Nothing sends it yet**: crc-sync never reads it, and its ATO import (L14) is paste/drop of a USMTF file, not a fetch from atobrief. Only an external USMTF consumer needs it |
