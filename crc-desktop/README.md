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
npm test   # node --test tests/*.test.js
```

`lxsrs-setup.js` and the `build` config in `package.json` are covered — see their test files' own comments for exactly which real bug each test reproduces:
- `tests/lxsrs-setup.test.js` — the ENOTDIR crash from spawning with a cwd inside `app.asar`, and a first-run Python venv setup that silently got reused after being interrupted mid `pip install`.
- `tests/packaging-config.test.js` — `package.json`'s electron-builder `build` config having the wrong shape (see "Two package.json structure" below), and `app/`'s own dependencies not actually being installed.

Both are cheap, fast, offline checks — no Electron download, no real Python/pip. They will not catch every packaging bug (they don't run `electron-builder` itself or launch the packaged binary). Two scripts wrap the two levels of confidence you actually want:

- `npm run dev-check` — fast, in-place: runs `npm test` then `npm start`, so you can click through whatever you're working on in the real Electron window. Doesn't touch your existing `app/node_modules` or Python venv (those are real dev state), so it won't catch a fresh-checkout regression by itself — that's what `release-check` is for.
- `npm run release-check` — slower, run once before tagging a release: checks out a clean `HEAD` into an isolated `git worktree`, does the same two `npm ci`s CI does, runs the tests, packages a Linux AppImage, and actually launches it, failing if it crashes or logs a fatal error. This is the step that would have caught the v1.1.2 crash (`lxsrs-setup.js` missing from `build.files`) before it shipped. It only verifies the Linux/AppImage leg — CI remains the source of truth for the Windows/NSIS leg.

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

and commit whatever it changes under `python-pkg/`, alongside your `lxsrs_v2` change. To just check whether the two have drifted (e.g. someone edited `lxsrs_v2` and forgot to re-vendor) without changing anything, run `crc-desktop/scripts/check-lxsrs-sync.sh`. Neither script is currently wired into CI or `npm test`: `crc-desktop-release.yml`'s build matrix includes `windows-latest`, and this check depends on `bash`/`python3`/`pip3` being present and on `PATH`, which isn't guaranteed there — so for now this is a manual step, not an automated gate.

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
| `wsPort` | Port `app/server.js` (the bundled local Express server) listens on |
| `sourcedcsWebUrl` | Used for flight-plan lookups proxied through the local server |
| `freqs` / `txFreq` | Default monitored/transmit radio frequencies |
