# CRC (crc-desktop)

Electron desktop client for SOURCE DCS's DCS multiplayer GCI/datalink picture ("CRC"). Connects to [`crc-sync`](../crc-sync) for live track data and the collaborative overlay (IFF declarations, renames), and bundles a local SRS Standalone radio bridge ([`lxsrs_v2`](../lxsrs_v2)) on Linux.

## Quick start

```bash
npm install
npm install --prefix app   # app/ is its own package -- see "Two package.json structure" below
npm start                   # runs via `electron .`
```

`config.json` holds runtime defaults (Casdoor client ID/endpoint, crc-sync URL, SRS host/port, radio frequencies) — copy and edit for local testing against a different environment; don't commit real secrets into it (there aren't any today — Casdoor's client secret never reaches this app, only the public client ID).

## Testing

```bash
npm test   # node --test 'tests/*.test.{js,mjs}'
```

`lxsrs-setup.js` and the `build` config in `package.json` are covered — see their test files' own comments for exactly which real bug each test reproduces:
- `tests/lxsrs-setup.test.js` — the ENOTDIR crash from spawning with a cwd inside `app.asar`, and a first-run Python venv setup that silently got reused after being interrupted mid `pip install`.
- `tests/packaging-config.test.js` — `package.json`'s electron-builder `build` config having the wrong shape (see "Two package.json structure" below), and `app/`'s own dependencies not actually being installed.

Both are cheap, fast, offline checks — no Electron download, no real Python/pip. They will not catch every packaging bug (they don't run `electron-builder` itself or launch the packaged binary). Two scripts wrap the two levels of confidence you actually want:

- `npm run dev-check` — fast, in-place: runs `npm test` then `npm start`, so you can click through whatever you're working on in the real Electron window. Doesn't touch your existing `app/node_modules` or Python venv (those are real dev state), so it won't catch a fresh-checkout regression by itself — that's what `release-check` is for.
- `npm run release-check` — slower, run once before tagging a release: checks out a clean `HEAD` into an isolated `git worktree`, does the same two `npm ci`s CI does, runs the tests, packages a Linux AppImage, and actually launches it, failing if it crashes or logs a fatal error. This is the step that would have caught the v1.1.2 crash (`lxsrs-setup.js` missing from `build.files`) before it shipped. It only verifies the Linux/AppImage leg — CI remains the source of truth for the Windows/NSIS leg.

## Client modules

The renderer UI under `app/public/js/` is native ES modules, with no bundler and no build step (H87, ESM-1). `index.html` loads
the CDN scripts (`maplibregl`, `dockview`) and the local server's generated `/js/config.js` (four `var` globals) as
classic scripts first. It then loads one `<script type="module" src="./js/main.js">`. `main.js` imports every module once.
It then makes the start-up calls (atc-scope's beat, `app.js`'s `startApp()`, then `srs-radio.js`) after the whole
graph has been evaluated. A module does nothing at import beyond declaring its state, so the unit tests import
the files directly. `app/public/js/package.json` (`{"type":"module"}`) makes Node treat them as ES modules. It ships
in the asar (`app/**/*`; `tests/packaging-config.test.js` checks it), while `app/package.json` stays CommonJS for
`app/server.js`.

- **The import graph has no cycle.** `tests/module-graph.test.mjs` bounds the largest strongly connected component at
  `LARGEST_CYCLE_MAX = 0` (59 of 106 modules before phase 3); never raise it. Shared state lives in **leaf modules**, which
  import nothing from the app: `settings.js`, `map-handle.js` (the map, drag, measure), `picture.js` (tracks, coverage,
  mission data), `view-state.js`, `scope-constants.js`, `format.js`, `html-escape.js`, `dock-handle.js`, `map-style.js`, and under
  `panels/efsp/` `facility-topology.js`, `sync-cursor.js`, `efsp-change-bus.js`, `efsp-message-registry.js`, `board-data.js`.
  No module imports `app.js` for state (only `main.js` imports `startApp`); `app.js` owns the socket and writes the leaves.
  A new module that needs shared state reads a leaf; if it needs a leaf that would import it back, the leaf is wrong.
- **The change bus** (`panels/efsp/efsp-change-bus.js`) replaces hand-kept renderer lists: a message handler applies state and
  calls `markEfspChanged(topic, ...)`; a view subscribes once at load with `onEfspChanged(topics, fn, {order})` (order RESOLVE,
  PANEL, BAYS, VIEW). `dispatchEfspMessage` batches, so the flush is once per frame. An unknown topic throws.
- **No `window` globals.** Production code puts nothing on `window` and reads nothing custom from it
  (`tests/no-window-globals.test.mjs` allows browser APIs and the preload's `crcLinks` and `crcUpdate`). The one exception is
  the test-only `window.crc.<module>` that `e2e/helpers/modules.js` builds with dynamic imports; **a spec that calls a moved
  function must be updated to the module that now holds it** (e.g. `crc.dispatch._invokeNla`).
- No `innerHTML` with an unescaped dynamic part: `html-escape.js`'s `escapeHtml`, enforced by `tests/html-sinks.test.mjs`.
- A module imports what it uses from another module. Code outside a module replaces a function or a binding only
  through that module's explicit setter (`setSendToSync`, `setEfspSender`, `_set…`/`_set…ForTest`; 47 such seams remained after DESK-TIDY-2).
- Client unit tests are `tests/*.test.mjs`. They import `tests/helpers/client-env.mjs` first (the browser-ish globals),
  and `tests/helpers/fresh-graph.mjs` when a test needs a new instance of the module graph.
- `tests/module-graph.test.mjs` checks the graph: every file reachable from `main.js`, every module evaluates as an
  entry, no read of another module's export without an import, and the exported names frozen in
  `tests/fixtures/module-graph-exports.json` (re-record with `GOLDEN_RECORD=1` when the structure changes on purpose).
- The Playwright specs reach the client's modules through `e2e/helpers/modules.js` (`window.crc.<module>.<name>`, made with
  dynamic imports of the same module URLs); nothing in the client puts its names on `window`.

## The map

The scope's label glyphs are bundled (`app/public/fonts/`, served at `/fonts/` by `app/glyph-route.js`), so no label and no
track depends on MapTiler. The basemap is MapTiler's, with the key crc-sync serves after login (`GET /api/client-config`);
when MapTiler refuses (401/403/429), is down (5xx) or unreachable, `basemap-fallback.js` re-points the style's one vector
source at OpenFreeMap's keyless TileJSON and shows a grey FALLBACK BASEMAP note (NO BASEMAP if that fails too), until a new
key arrives. Elevation contours and the radar-debug line of sight read crc-sync's DCS terrain grid (`terrain-grid.js`,
`GET /api/terrain/grid`), not MapTiler. The e2e harness answers `tiles.openfreemap.org` with 503, so no run leaves the machine.

## Packaging

```bash
npm run pack:linux   # electron-builder AppImage, unpublished, into dist/
npm run pack:win     # electron-builder NSIS installer, unpublished, into dist/
```

Then actually launch the packaged binary (`dist/*.AppImage` or the installed `.exe`) before trusting it — `npm test` and a successful `electron-builder` run both pass even when the packaged app is broken (this has happened more than once; see below). `npm run release-check` (above) automates exactly this for the Linux leg.

### Two package.json structure — the most common way to break packaging

`app/` (the bundled local server + browser UI) is **its own npm package** — `app/package.json` declares it as `"crc-server"` with its own `dependencies` (currently just `dotenv`) and its own `node_modules`. This exists because `app/server.js` needs `dotenv`, and originally lived here as a self-contained unit.

This shape happens to exactly match electron-builder's built-in ["two package.json structure"](https://www.electron.build/tutorials/two-package-structure) convention: if `build.directories.app` isn't set, electron-builder auto-detects a subdirectory literally named `app` containing its own `package.json` and treats *that* as the real application root — packaging relative to `app/` instead of the project root, using `app/package.json`'s `"main": "server.js"` as the entry point instead of the root's `"main": "main.js"`. The result packages "successfully" but silently drops `main.js` entirely, and crashes on launch with something like:

```
Application entry file "server.js" in the ".../app.asar" is corrupted: Error: "server.js" was not found in this archive
```

This repo avoids that by explicitly setting `"directories": { "app": "." }` in `package.json`'s `build` config, and listing `package.json` and `main.js` explicitly in `build.files` (a custom `files` array replaces electron-builder's defaults rather than extending them, so the root manifest isn't picked up automatically). **Do not remove either of these** — `tests/packaging-config.test.js` asserts both, but treat that as a safety net, not a substitute for understanding why they're there if you're touching `build` config.

A related, quieter failure: `build.files` must *not* exclude `app/node_modules` (an earlier version of this config did, to avoid double-bundling `node_modules` — reasonable-looking, wrong). `app/server.js`'s `require('dotenv')` resolves from `app/node_modules/dotenv`; excluding it packages fine and crashes on first launch with `Cannot find module 'dotenv'`.

`app/node_modules` is gitignored like any `node_modules`, so **CI needs its own `npm ci` inside `app/`** in addition to the one at the project root — `.github/workflows/crc-desktop-release.yml` does both. If you add a new CI job that packages this app, copy that pattern.

### The Python SRS radio bridge (Linux only)

On Linux, `main.js` spawns `lxsrs_v2` (bundled as pure-Python source under `python-pkg/`, via `electron-builder`'s `build.linux.extraResources`) for the SRS radio connection. `lxsrs_v2` needs three third-party packages — `numpy`, `sounddevice`, `opuslib` — that are **not** bundled at package time and never will be: they include compiled C extensions tied to the exact CPython ABI they were built against, and there's no way to know at build time which Python version an end user's machine will have (Fedora, Ubuntu, Arch... all ship different, unpredictable ones, and none will match whatever CI's runner happens to have either).

Instead, `lxsrs-setup.js`'s `ensureLxsrsVenv()` creates a venv under Electron's `userData` dir on first run, against whichever `python3` is actually on that machine, and `pip install`s into it — so pip always resolves ABI-correct wheels for the system that's about to run them. This needs network access on first run only; a completion marker file (not just the venv's `python3` existing) gates whether setup re-runs, since a half-finished install — app closed, network dropped mid `pip install` — would otherwise be silently treated as done forever, permanently missing its dependencies. This exact failure mode shipped once and is now a regression test (`tests/lxsrs-setup.test.js`).

`pynput` is deliberately **not** in that dependency list, even though `lxsrs_v2`'s own `pyproject.toml` declares it: it's only needed for an alternate `--ptt-mode pynput` (hold-to-talk) path this app never selects (default is stdin/Enter-toggle), and `lxsrs_v2`'s `client.py` already lazy-imports it itself for that path. On Linux, `pynput` hard-requires `evdev`, which has no prebuilt wheel on PyPI at all — every install would need a C compiler and matching kernel headers, which most end-user desktops don't have. Don't add it back without solving that first.

If you change what `lxsrs_v2` needs (e.g. bump its own `pyproject.toml` dependencies), update `LXSRS_VENV_DEPS` in `lxsrs-setup.js` to match, and re-verify by actually deleting `~/.config/crc-desktop/lxsrs-venv` (Linux) and relaunching a packaged build — `npm test`'s stubbed-python3 tests exercise the *logic* (retry-on-incomplete, marker semantics) but not real package installation.

#### Keeping `python-pkg/lxsrs_v2` in sync

`python-pkg/lxsrs_v2` is a **vendored copy** of the top-level [`lxsrs_v2`](../lxsrs_v2) package's source — `pip install --no-deps --target=python-pkg lxsrs_v2/`, committed to git (see repo CLAUDE.md). This is a separate concern from the venv above: this copy is `lxsrs_v2`'s own Python source (`client.py`, `audio.py`, ...), bundled via `extraResources` at package time; the venv only holds its third-party *dependencies*, installed on the end user's machine at first run.

There is no build step that keeps this copy in sync automatically — a bugfix to `../lxsrs_v2/lxsrs_v2/*.py` does **not** reach crc-desktop until this vendored copy is regenerated and committed. After changing anything under `../lxsrs_v2/lxsrs_v2/`, run:

```bash
crc-desktop/scripts/sync-lxsrs.sh
```

and commit whatever it changes under `python-pkg/`, alongside your `lxsrs_v2` change. **`npm test` checks the two copies are identical** (`tests/lxsrs-copies-identical.test.mjs`: a plain Node tree diff of the `*.py` files, ignoring `__pycache__`, so it runs on the Windows release leg too) and fails naming every file that differs or exists in only one copy. `crc-desktop/scripts/check-lxsrs-sync.sh` stays as the deeper manual check: it pip-installs `lxsrs_v2` into a scratch dir and diffs that, so it also catches a packaging change a tree diff cannot see; it needs `bash`/`python3`/`pip3` on `PATH`, which `windows-latest` does not guarantee, so it is not in CI.

## Release / autoupdate

Installers are built and published by `.github/workflows/crc-desktop-release.yml` (triggered by pushing a `crc-desktop-vX.Y.Z` tag) and hosted by `sourcedcs-web` — see the root `CLAUDE.md`'s "How to build and release crc-desktop" section for the full pipeline, including why the crc-sync-rebuild trigger at the end must stay unconditional.

Installed apps autoupdate via `electron-updater` (`main.js`) against the generic HTTP provider configured in `package.json`'s `build.publish` — no code changes needed here to ship a new version, just push the tag.

**Patch notes**: before tagging a release, edit `build-assets/release-notes.md` to describe what's new. `electron-builder` auto-detects a `release-notes.md` in its "build resources" directory by convention and embeds its contents into `latest.yml`/`latest-linux.yml` as `UpdateInfo.releaseNotes` — that directory defaults to `build/`, but this repo's root `.gitignore` ignores every `build/` dir, so `package.json`'s `build.directories.buildResources` repoints it at `build-assets/` instead (don't move `release-notes.md` back under `build/`, it'll stop being tracked). `main.js` persists those notes to a file in `userData` when the update finishes downloading (the download happens in the *old* process, before restart, so there's no window left to show a dialog in yet), then reads and clears that file on the next launch once `app.getVersion()` confirms the update actually landed, showing a one-time "What's New in CRC vX.Y.Z" dialog. See `patch-notes.js` (Electron-free, unit tested in `tests/patch-notes.test.js`) for the read/write logic. If `release-notes.md` is left unchanged or empty, no notes are persisted and no dialog appears — this is opt-in per release, not a hard requirement.

## config.json fields

| Field | Purpose |
|---|---|
| `crcSyncUrl` | WebSocket URL of the crc-sync backend (`wss://asacs.sourcedcs.page` in production) |
| `casdoorClientId` / `casdoorEndpoint` | Casdoor OAuth — public client ID only, no secret |
| `srsHost` / `srsPort` | Upstream SRS server the bundled `lxsrs_v2` bridge connects to |
| `srsApiPort` | Local HTTP API port `lxsrs_v2` exposes for the renderer's radio panel |
| `wsPort` | Port `app/server.js` (the bundled local Node server) listens on |
| `sourcedcsWebUrl` | Used for flight-plan lookups proxied through the local server |
| `freqs` / `txFreq` | Default monitored/transmit radio frequencies |
| `defaultFreq` | Frequency a radio added in the SRS panel tunes to (passed to `lxsrs_v2` as `--default-freq`); unset, it starts untuned. No station frequency is hardcoded in the bridge |
