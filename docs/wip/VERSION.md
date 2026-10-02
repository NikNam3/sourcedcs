# VERSION (lane `VERSION`): wire protocol number, update-required handshake, deploy gate (ADR 0103)

## Code as found (step 0)

Baseline at `6ffc6b8`: crc-sync `npm test` 2118 tests, 2117 pass, 0 fail (1 skipped); crc-desktop `npm test` 884 tests, 882 pass, 0 fail.

- `crc-sync/src/ws-hub.js`: `const VERSION = 1` (line 12) stamps every frame (`version: VERSION` in about 12 builders). `attach()` makes the
  `WebSocketServer` with `verifyClient` (ticket only, `consumeTicket`), and `this._wss.on('connection', (ws, req) => this._onConnect(ws, req))`.
  `_onConnect(ws, req)` reads `req.crcUser`, builds the session, sends status, init, weather, game-time, theater, apt-config, atis, ... `_tick`
  sends the `efsp-heartbeat` (line ~540). The check goes in the listener (`_admit`), not in `_onConnect`.
- Literal `"version":1` matchers (must not change): `tools/soak/driver.js`, `tools/soak/host-core.js`, `tests/freeze/freeze-world.mjs`. Other `version: 1`
  producers: `efsp/wire/frames.js`, `efsp/efsp-ws.js`, `efsp/metrics.js`, `collab-store.js`. All untouched.
- Tests that call `_onConnect` directly or build a hub (none need a parameter, `_admit` is only in the listener):
  `ws-hub-read-scope.test.mjs`, `wire-skeleton.test.mjs`, `theater-context.test.mjs`, `freeze/*` (hub runner), `tools/soak/host-core.js`.
  Freeze table `tables-wire-message-types` (`tests/freeze/freeze-tables.test.mjs` ~line 90) scans `efsp-*` literals only; the new
  `update-required` type is not `efsp-*`, so the golden does not move. The wire-surface fixture computes its own scan.
- Client: `app/public/js/sync.js` `fetchSyncTicket()`/`getSyncFeedUrl()` (`.../feed?ticket=`), `showLoginGate()` is the overlay style to follow;
  `app.js` `connect()` has `ws.onmessage` -> `onSyncMessage`, `ws.onclose` -> `setTimeout(connect, 2000)`.
  `main.js`: autoUpdater events -> `sendUpdateStatus`, `ipcMain.on('update-restart-now')`, `get-last-patch-notes`; `app/preload.js` exposes `crcUpdate`.
- Workflows: `crc-sync-docker.yml` has one job (`build-and-push`, with the R3-37 tag-on-main refusal); `deploy.yml` has one job, a single
  SSH step, triggered by `workflow_run` of the three image workflows or `workflow_dispatch`. The `verify-main` guard CLAUDE.md mentions is not in
  this base (only the tag-on-main step in `crc-sync-docker.yml`). `sourcedcs-web` `GET /api/releases/latest` returns `{ win, linux }`, each
  `{ version, url, size }` or null (`releases.js` `parseReleaseManifest`).
- E2E: the harness (`playwright.config.js`) runs crc-sync under `e2e/helpers/sync-supervisor.js` with `CRCSYNC_TEST_RESET=1`; lane 3 = ports 3013/3113.

## Design notes / defaults taken

- D1: The e2e spec needs a crc-sync speaking another protocol, but the supervisor fixes the env at start. Instead of the env var
  `CRCSYNC_TEST_WIRE_PROTOCOL`, a `POST /__test/wire-protocol {protocol}` route in `test-reset.js` (same gates: `CRCSYNC_TEST_RESET=1`, loopback, never
  in production) sets the hub's protocol at runtime; the next reset restarts the process, which clears it. Same safety, no process juggling.
