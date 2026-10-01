# SOURCE DCS

Open-source tooling and infrastructure for the SOURCE virtual aviation squadron. This monorepo contains the squadron website, a tactical briefing application, a DCS multiplayer GCI/datalink client + its sync backend, and a Python converter that turns raw DCS mission files into brief packages.

---

## Repository Layout

```
sourcedcs-web/    Squadron website — Node.js / Express (also hosts crc-desktop downloads)
atobrief/         Tactical briefing app — Node.js / Express + Socket.IO
crc-sync/         crc-desktop's multiplayer sync backend — Node.js / Express + WebSocket
crc-desktop/      DCS GCI/datalink desktop client — Electron
lxsrs_v2/         Linux SRS Standalone client library, bundled into crc-desktop — Python 3
tools/miztoyaml/  .miz → YAML converter — Python 3
infra/            Docker Compose production stack (Nginx, MariaDB, Casdoor, MediaWiki)
docs/             Reference documentation
```

> `asacs_link` no longer exists in this repo — it was retired and replaced by `crc-sync` (backend) + `crc-desktop` (client). If you find references to it elsewhere, they're stale.

---

## Components

### sourcedcs-web — Squadron Website

Public-facing squadron website. Handles roster display, event scheduling, gallery, squadron/wing pages, join applications, and Casdoor SSO login.

**Quick start**

```bash
cd sourcedcs-web
npm install
npm start          # → http://localhost:3000 (the Docker stack sets PORT=7000)
```

See [`sourcedcs-web/CASDOOR_SETUP.md`](sourcedcs-web/CASDOOR_SETUP.md) for authentication configuration.

---

### atobrief — Tactical Briefing Application

Browser-based briefing tool for presenting Air Tasking Orders (ATOs), Airspace Control Orders (ACOs), SPINS, COMMS, and Weather data. Features live editing, YAML import/export, an interactive SVG map, and real-time presenter/presentee synchronisation over Socket.IO.

**Quick start**

```bash
cd atobrief
npm install
npm start          # → http://localhost:4000
```

Load a YAML package via the upload screen (drag-drop or file picker) or join an active presenter's session with a session ID and password.

**Tabs**

| Tab | Content |
|-----|---------|
| ATO | Mission cards, intel strip, Gantt timeline |
| ACO | Airspace control measure table |
| SPINS | Flexible section-based operational procedures |
| COMMS | UHF / VHF preset frequency grids |
| WX | Decoded METAR / TAF + mission weather notes |
| MAP | Interactive SVG map — routes, airspace, targets, marshal points |

**Themes** — toggle between **Pro** (light, professional) and **Movie** (dark CRT green).

**YAML format** — see [`docs/atobrief/yaml-format.md`](docs/atobrief/yaml-format.md).

---

### crc-sync — crc-desktop Multiplayer Sync Backend

Central sync backend for `crc-desktop`: the sole gRPC (DCS telemetry) and SRS-transponder client on behalf of every connected desktop client, broadcasting merged track state + a collaborative overlay (manual IFF declarations, renames, track numbers) over a Casdoor-authed WebSocket. Replaces the retired `asacs_link`.

**Quick start**

```bash
cd crc-sync
npm install
npm start          # → http://localhost:3000
npm test
```

See [`crc-sync/README.md`](crc-sync/README.md) for architecture details.

---

### crc-desktop — DCS GCI/Datalink Desktop Client ("CRC")

Electron desktop client that connects to `crc-sync` for the live tactical picture. Bundles a local Express server and, on Linux, an SRS Standalone radio bridge (`lxsrs_v2`) with its own first-run Python environment setup.

**Quick start**

```bash
cd crc-desktop
npm install
npm install --prefix app   # app/ is its own package -- see crc-desktop/README.md
npm start
npm test
```

**Building an installer**

```bash
npm run pack:linux   # AppImage
npm run pack:win     # NSIS installer
```

Production installers are built and published by CI on a `crc-desktop-vX.Y.Z` tag push, hosted at [sourcedcs.page/download.html](https://sourcedcs.page/download.html), and autoupdate via `electron-updater`. See [`crc-desktop/README.md`](crc-desktop/README.md) for the packaging gotchas (there are a couple of sharp edges — read it before touching `package.json`'s `build` config) and the root [`CLAUDE.md`](CLAUDE.md) for the full CI/deploy pipeline.

---

### tools/miztoyaml — DCS .miz to YAML Converter

Python 3 command-line tool that extracts flights, waypoints, airspace drawings, SAM sites, weather, and loadout data from a DCS `.miz` file and outputs a ready-to-load ATO brief YAML package.

**Requirements**

```bash
pip install pyyaml
```

**Usage**

```bash
# Basic — outputs mission.yaml in the current directory
python3 -m tools.miztoyaml mission.miz

# Choose coalition and output file
python3 -m tools.miztoyaml mission.miz --coalition red --output brief.yaml

# Verbose logging
python3 -m tools.miztoyaml mission.miz --verbose
```

**Tests**

```bash
python3 -m pytest tools/tests/ -v
```

---

## Infrastructure

The production stack is in `infra/` and runs with Docker Compose.

**Services**

| Service | Description |
|---------|-------------|
| nginx | Reverse proxy + SSL termination (Let's Encrypt via Certbot) |
| main-website | `sourcedcs-web` container |
| atobrief | `atobrief` container |
| crc-sync | `crc-sync` container |
| casdoor | SSO identity provider (OAuth 2.0 / JWT) |
| mediawiki | Squadron wiki |
| mariadb | Shared database (MediaWiki + Casdoor) |

**Deploy**

```bash
cp .env.example infra/.env
# Edit infra/.env — set domains, passwords, Casdoor credentials, Discord tokens
cd infra
docker compose up -d
```

See `.env.example` for a full list of environment variables.

`main-website`, `atobrief`, and `crc-sync` are built and pushed by their own GitHub Actions workflow on push to `main`/`dev`; a fourth workflow then SSHes in, `git pull`s, and redeploys automatically. See `CLAUDE.md`'s "How the docker-image services deploy" section before changing anything in this pipeline — there are two non-obvious gotchas in it that have caused real outages.

---

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/atobrief/yaml-format.md`](docs/atobrief/yaml-format.md) | ATO brief YAML package schema reference |
| [`docs/atobrief/weather-txt.md`](docs/atobrief/weather-txt.md) | `weather.txt` supplemental METAR/TAF format |
| [`crc-desktop/README.md`](crc-desktop/README.md) | crc-desktop dev setup, packaging gotchas, Python SRS bridge, autoupdate |
| [`crc-sync/README.md`](crc-sync/README.md) | crc-sync architecture and deploy |
| [`sourcedcs-web/CASDOOR_SETUP.md`](sourcedcs-web/CASDOOR_SETUP.md) | Casdoor SSO configuration guide |
| [`CLAUDE.md`](CLAUDE.md) | Full commands/architecture reference, including the crc-desktop release pipeline and docker-image deploy chain |

---

## License

MIT
