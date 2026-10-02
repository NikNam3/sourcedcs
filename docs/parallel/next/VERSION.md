# VERSION: the client/server wire-protocol handshake and the deploy gate

> Read `README.md` in this folder, `docs/parallel/refactor/README.md` (conventions, **Test policy**) and
> `docs/parallel/lane-rules.md` first. Rulings: decisions.md **H82** (R3-1 "refuse an out-of-date client with 'update
> required'", **S3-5** "both a wire version handshake and a test gate before deploy", R3-4 required reviewer on
> "production", R3-13 main first then tag, R3-37 refuse tags not on main, R3-79 "always ask before deploying"),
> S-desk3 (S3-4: no state versioning now; R3-79), S-M-W7 (every wire name changed in W7), S-M-BACKCOMPAT (no
> backwards compatibility). **decisions.md wins over this file; the merged code wins over its line numbers.**

| | |
|---|---|
| Wave | A (first wave after L20) |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-VERSION` on `lane/VERSION-wire-handshake` |
| ADR | **0103** "the wire protocol number and the update-required handshake" (new; write it in your first commit) |
| Size / model | 1.25 lanes / Sonnet 5.5 (the design below is settled; the lane builds it) |
| E2E lane | `E2E_LANE=3` (boot smoke plus one new spec) |
| Merge | before **WIRE-B** (both edit the connect path and the tick in `ws-hub.js`); WIRE-B is cut after this merges |

## Why

W7 renamed every wire name (S-M-W7). An installed crc-desktop from before W7 now connects to the new crc-sync,
receives frames it does not understand, and shows an empty or half-filled picture with no error. Nothing on either
side knows which protocol the other speaks: every frame carries `version: 1` (`ws-hub.js` `VERSION`, also
`wire/frames.js`, `efsp-ws.js`, `metrics.js`, `collab-store.js`), but that number has never changed and the client never
reads it. No crc-sync CI job runs `npm test` (questions-W6 Q6-BC-8), and `deploy.yml` deploys whatever image built.

## Goal

1. **A wire protocol number** (`WIRE_PROTOCOL`, a positive integer) that both sides compile in, bumped whenever the
   wire changes incompatibly. A test makes the bump impossible to forget.
2. **A handshake at connect.** The client says which protocol it speaks. On a mismatch the server sends one
   `update-required` frame and closes the socket with code **4426**. It creates no session and sends no picture.
3. **The client shows "Update required"** and stops reconnecting. When it is older than the server it asks
   electron-updater to fetch the release now and offers "Restart to update". When it is newer than the server it says
   the server must be updated first.
4. **A test gate before deploy.** crc-sync's image builds only after both unit suites pass. `deploy.yml` refuses to
   deploy a crc-sync whose protocol differs from the protocol of the **published** crc-desktop release.

## Design (settled here; ADR 0103 records it)

**Where the number comes from.** It does not come from the package versions. `crc-desktop/package.json`'s version is
set from the release tag at build time, and `crc-sync/package.json` says `1.0.0` and is never bumped. The image is
tagged by branch and sha. The two never move together, and a crc-sync deploy that does not touch the wire must not
lock anyone out. So there is one integer per side:

- `crc-sync/src/wire-protocol.js`: `module.exports = { WIRE_PROTOCOL: 2 }`. It is **2** because W7 already broke 1.
- `crc-desktop/app/public/js/wire-protocol.js`: `export const WIRE_PROTOCOL = 2;`. A hand copy, following ARCH-D7's
  hand copies with parity tests.
- A crc-desktop parity test reads crc-sync's file, as `client-mirror-parity.test.mjs` already reads crc-sync sources,
  and fails if the two differ.
- **The per-frame `version: 1` stays exactly as it is.** It is the envelope's version, not the protocol. The soak
  matches literal prefixes such as `'{"version":1,"type":"efsp-heartbeat"'` (`tools/soak/driver.js` ~169,
  `host-core.js` ~138/142, `tests/freeze/freeze-world.mjs` ~69). Changing the value would silently switch off the
  soak's fault injection. Say so in the ADR, and in a one-line comment beside `ws-hub.js`'s `VERSION`.

**When to bump: the wire-surface fixture.** New `crc-sync/tests/wire-protocol.test.mjs` compares the current wire
surface with `crc-sync/tests/fixtures/wire-surface.json` (`{ protocol, surface }`). The surface is at least:

- the client→server and server→client message types (the same scan as the freeze table `tables-wire-message-types`,
  which is opt-in, so compute it in this test rather than read the golden);
- the efsp op kinds (`authority/op-kinds.js`);
- the top-level keys of each frame a hub test can build cheaply (`_statusMsg`, `_initMsg`, the snapshot, a
  board delta, the heartbeat).

Step 0 decides how far the key sets go. Keep the scan under one second.

When the surface changes and the fixture does not, the test fails with the instruction: "the wire changed: run `npm run
wire:record` (bumps WIRE_PROTOCOL in both copies if the last release already shipped this number)". The new script
`crc-sync/tools/wire-record.js` (npm script `wire:record`) does the following:

1. It re-records the surface.
2. It reads the protocol of the last released client with `git tag -l 'crc-desktop-v*' --sort=-v:refname`, then
   `git show <tag>:crc-desktop/app/public/js/wire-protocol.js`.
3. If the current number equals that released number, it bumps both copies by one. Otherwise it leaves them, because
   the number is already ahead of the release, and several lanes between two releases share one bump.
4. If there is no tag, or the file is missing at the tag, it bumps.

An incompatible change that the surface misses, such as a value's meaning, is bumped by hand with `wire:record
--bump`. Document both cases in the ADR and in the script's `--help`.

**The handshake (server, `ws-hub.js`).**

- The client appends `&protocol=<n>&client=<appVersion>` to the `/feed` URL, next to `ticket`.
- The check runs in the `'connection'` listener in `attach()`, **before** `_onConnect`, as `_admit(ws, req)`.
  Tests and the soak call `_onConnect` directly with fake requests, and must keep working untouched.
- A missing or non-integer `protocol` counts as protocol 1. Pre-handshake clients send none.
- Policy: **exact match** (no backwards compatibility, S-M-BACKCOMPAT). On a mismatch:
  - send `{ version: 1, type: 'update-required', serverProtocol, clientProtocol, downloadUrl }`, where `downloadUrl`
    is `https://sourcedcs.page/download` from a new optional env var `CRCSYNC_DOWNLOAD_URL` (absent: the key is
    omitted);
  - then `ws.close(4426, 'update required')`;
  - log it at info with `{ who, clientVersion, clientProtocol }`, once per `who`+`clientVersion` per process, so a
    reconnecting old client cannot flood the log (later attempts at debug);
  - no session, no coverage, no snapshot.
- `verifyClient` stays as it is. An HTTP refusal at upgrade reaches the browser only as close code 1006, with no
  readable status, which is why the server accepts and then closes.
- The `update-required` type joins the wire surface and the message-type tables.

**The handshake (client).**

- `sync.js` `getSyncFeedUrl()` adds the two query parameters. `client` comes from the preload: add
  `getAppVersion: () => ipcRenderer.invoke('get-app-version')` to `app/preload.js`'s `crcUpdate`, and an
  `ipcMain.handle('get-app-version', () => app.getVersion())` in `crc-desktop/main.js`. Outside Electron (Playwright,
  where there is no preload) it is `dev`.
- `app.js` `connect()`: `onmessage` handles `update-required` before `onSyncMessage`, and `onclose` checks
  `event.code === 4426`. Either one sets a module flag that stops `setTimeout(connect, 2000)` and shows the overlay.
- New `js/update-required.js` owns the overlay, built in the style of the login gate (`showLoginGate`):
  - Client older than the server: "Update required. This crc-sync speaks a newer protocol (server N, CRC M)."
    The button "Check for update" calls a new preload `crcUpdate.checkNow()` (IPC `update-check-now` →
    `autoUpdater.checkForUpdates()` in `main.js`).
  - The overlay then follows the existing `update-status` stream (`topbar.js` `renderUpdateStatus`'s states). At
    `ready` it shows "Restart to update" (`crcUpdate.restartNow()`).
  - Without `window.crcUpdate` (dev or Playwright), or when `update-not-available` comes back, it says "No update is
    published yet. Ask the server admin." and links `downloadUrl` if present.
  - Client newer than the server: "This CRC is newer than the server (server N, CRC M). The server must be updated
    first." No updater call.
  - A "Retry" button reconnects once, for when the server is updated while the overlay is up.
- UI text is UI code (S3-6 exemption). Keep it plain.
- `main.js`: `update-check-now` must be idempotent while a download is running, and must not throw when unpackaged
  (`app.isPackaged` false: reply `{state:'idle'}` at once).

**Pre-handshake clients.** Installed clients from before this lane send no `protocol`. They are refused, see close
code 4426 without understanding it, and keep reconnecting every 2 s with the topbar showing disconnected. They cannot
show the message, because they have no code for it. electron-updater on their next launch installs the new release.
Put this in the release-note line, and in the ADR as an accepted one-time cost.

**The deploy gate (`.github/workflows/`).**

- `crc-sync-docker.yml` gets a `test` job: checkout, Node 20, `npm ci` in `crc-sync`, `crc-desktop` and
  `crc-desktop/app`, then `npm test` in crc-sync and in crc-desktop (the parity test needs both trees). The
  `build-and-push` job `needs: test`. A `workflow_dispatch` from the crc-desktop release runs the tests too.
- `deploy.yml` gets a step before the SSH step:
  - check out the deployed sha with `fetch-depth: 0` and tags;
  - read `WIRE_PROTOCOL` from `crc-sync/src/wire-protocol.js`;
  - read the published client's version from `GET https://sourcedcs.page/api/releases/latest`, using `win.version`
    (or `linux.version`) as `sourcedcs-web/server.js` returns it;
  - read that client's protocol with `git show crc-desktop-v<version>:crc-desktop/app/public/js/wire-protocol.js`.
    A tag without the file means protocol 1.
  - If the protocols differ, fail with "crc-sync speaks protocol N, the published CRC v<x> speaks M: publish a
    crc-desktop release first (tag `crc-desktop-vX.Y.Z` from main) or revert the wire change".
  - The step fails closed: an unreachable releases API or an unknown tag fails the deploy. A
    `workflow_dispatch` input `skip_protocol_gate: true` exists for the human only, documented in RUNBOOK.
  - This runs whichever image triggered the deploy, because every deploy pulls crc-sync.
- The release order stays as `crc-desktop-release.yml` has it: upload the installers, then dispatch crc-sync. The
  gate passes once the new client is published. Between the upload and the crc-sync deploy, updated clients see "the
  server must be updated first" for a few minutes, which is correct.
- Never deploy from this lane. R3-79: the human approves every prod deploy. The "production" environment's required
  reviewer is a GitHub setting (R3-4), not this lane's.

## Owns

- crc-sync:
  - new `src/wire-protocol.js`;
  - `src/ws-hub.js`: `attach()`'s connection listener, new `_admit`, and the comment beside `VERSION`. **Not
    `_onConnect` or `_tick`**, which are WIRE-B's later.
  - the message-type table rows for `update-required` (the freeze table's scan and the PARITY contract test, if
    they enumerate hub literals);
  - new `tests/wire-protocol.test.mjs`, `tests/fixtures/wire-surface.json`, `tests/ws-hub-admit.test.mjs` (a real
    `ws` server: matching protocol admitted; missing, lower and higher refused with the frame and 4426; nothing else
    sent);
  - new `tools/wire-record.js` and its `package.json` script;
  - the `CRCSYNC_DOWNLOAD_URL` line in `crc-sync/.env.example`.
- crc-desktop:
  - new `app/public/js/wire-protocol.js` and `js/update-required.js` (plus its markup or CSS where the login gate's
    lives);
  - `sync.js` `getSyncFeedUrl` only;
  - `app.js` `connect()`'s `onmessage`/`onclose` only;
  - `main.js`: the two IPC handlers;
  - `app/preload.js`;
  - new `tests/wire-protocol-parity.test.mjs` and `tests/update-required.test.mjs` (the decision table: older, newer,
    no updater, not available);
  - new `e2e/update-required.spec.js`. Start a crc-sync with a patched protocol (env `CRCSYNC_TEST_WIRE_PROTOCOL`,
    honoured only with `CRCSYNC_TEST_RESET=1` like the reset hook), then assert the overlay and that no reconnect
    storm follows: at most one connect per Retry.
- `.github/workflows/crc-sync-docker.yml` and `deploy.yml`.
- Docs:
  - `docs/adr/0103-…md`;
  - `infra/RUNBOOK.md`: a "Wire protocol and the deploy gate" section covering the bump rule, the gate's failure text,
    the release order and `skip_protocol_gate`;
  - CLAUDE.md: one paragraph under "How to build and release crc-desktop" and one row in the env table
    (`CRCSYNC_DOWNLOAD_URL`);
  - `docs/wip/VERSION.md`, including the release-note line, which the supervisor folds into
    `crc-desktop/build-assets/release-notes.md`.

## Frozen for you

`ws-hub.js` outside the listed functions. `efsp-ws.js`, `wire/**` (other lanes), and every other client file. ESM-GUARDS
edits guards in `app.js`/`sync.js` but not `connect()`/`getSyncFeedUrl`, and you edit nothing else in those files.
`tools/soak/**` beyond what the protocol test needs: the soak calls `_onConnect` directly, so it needs no change.
Check this at step 0.

## Steps

0. Step 0 per the refactor README (install, suite counts, "Code as found" in `docs/wip/VERSION.md`). Re-find by symbol:
   - `ws-hub.js` `VERSION`, `attach`/`verifyClient`, `_onConnect`, `_tick`'s heartbeat;
   - every `version: VERSION` site and every literal `"version":1` matcher in `tools/` and `tests/`;
   - `sync.js` `getSyncFeedUrl`/`fetchSyncTicket`, `app.js` `connect`;
   - `main.js` autoUpdater wiring and `app/preload.js`;
   - `deploy.yml`, `crc-sync-docker.yml`, `crc-desktop-release.yml` (the dispatch job);
   - `sourcedcs-web` `GET /api/releases/latest`'s shape.
   List every test that calls `_onConnect` or opens a socket (they must not need the parameter).
1. ADR 0103 (the design above, the pre-handshake cost, the envelope-vs-protocol note).
2. Server: `wire-protocol.js`, `_admit`, the admit test.
3. Surface fixture, `wire:record`, the protocol test. Record at 2.
4. Client: protocol copy, parity test, URL params, the overlay module and its decision-table test, the preload and IPC.
5. The e2e spec on `E2E_LANE=3`, plus the boot smoke.
6. CI: the test job and `needs:`, then the deploy gate step. Prove the gate's script locally against a fake releases
   JSON and a scratch tag in a throwaway clone. Never push a tag.
7. RUNBOOK, CLAUDE.md lines, wip with the release-note line. Run both full unit suites once and `soak:selfcheck` once
   (you touched `ws-hub.js`).

## Acceptance

- A client with the same protocol connects exactly as before: same send order, and the boot smoke passes.
- A missing, lower or higher protocol gets one `update-required` frame and close 4426, with no other frame. The overlay
  shows the right text for older and for newer, stops reconnecting, and its Retry connects once.
- Changing a message type name in a scratch edit fails `wire-protocol.test.mjs` with the instruction. `wire:record`
  bumps both copies only when the last release tag already has the current number, and the parity test catches a
  one-sided bump.
- `crc-sync-docker.yml` cannot push an image when a suite fails. `deploy.yml` fails, with the message, when the
  protocols differ, and passes when they match (both shown with the local script run).
- Both unit suites green, `soak:selfcheck` PASS. Freeze not maintained (window closed). If you run `npm run freeze`,
  list any trace that moved: none should.

## Defaults (P2)

- Exact match, no supported range. A range can come with state versioning after V2 (S-desk3).
- The deploy gate fails closed, with a human-only skip input.
- `client=` is informational only (logs). The server never decides on the app version.
- If electron-updater reports `update-not-available` while the server is ahead, the overlay says so and does not
  retry the updater by itself.
- Pre-handshake clients are not special-cased (no fake `status` frame to make them show text).
