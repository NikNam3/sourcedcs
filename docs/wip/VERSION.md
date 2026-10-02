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
  SSH step, triggered by `workflow_run` of the three image workflows or `workflow_dispatch`. CORRECTION (supervisor): `verify-main` IS in the base, in `crc-desktop-release.yml`
  (`trigger-crc-sync-release` needs it, `!cancelled() && needs.verify-main.result == 'success'`), plus the tag-on-main step in each docker workflow. This lane does not touch `crc-desktop-release.yml`. `sourcedcs-web` `GET /api/releases/latest` returns `{ win, linux }`, each
  `{ version, url, size }` or null (`releases.js` `parseReleaseManifest`).
- E2E: the harness (`playwright.config.js`) runs crc-sync under `e2e/helpers/sync-supervisor.js` with `CRCSYNC_TEST_RESET=1`; lane 3 = ports 3013/3113.

## Design notes / defaults taken

- D1: The e2e spec needs a crc-sync speaking another protocol, but the supervisor fixes the env at start. Instead of the env var
  `CRCSYNC_TEST_WIRE_PROTOCOL`, a `POST /__test/wire-protocol {protocol}` route in `test-reset.js` (same gates: `CRCSYNC_TEST_RESET=1`, loopback, never
  in production) sets the hub's protocol at runtime; the next reset restarts the process, which clears it. Same safety, no process juggling.
- D2: gate placement (S-VERSION1 / QA-VERSION-2): the gate is `.github/scripts/protocol-gate.sh`, run as a step of `deploy.yml` on main only. It never fails the job:
  it sets `hold`, and the SSH script then skips `pull`/recreate of crc-sync only (`up -d --no-deps` of every other service). Unreachable releases API: warning, no hold.
  A published version with no tag in the repo: hold (fail closed). `skip_protocol_gate` clears the hold. The gate reads the protocol at the triggering workflow's
  head sha, which can lag the `latest` image when a different image's workflow triggered the deploy; it is a safety net, not an exact image check.
- D3: QA-VERSION-1: no tag, or a tag without `wire-protocol.js`, is protocol 1 (the pre-handshake baseline); `wire:record` bumps only on a real surface change (or `--bump`) and only when the current number equals the released one, so running it twice, or at merge time, never re-bumps. The first record (no fixture) never bumps.
- D4: `CRCSYNC_DOWNLOAD_URL` defaults (compose) to `https://sourcedcs.page/download.html`; passed through `infra/docker-compose.yml`, in `.env.example` and `crc-sync/.env.example`.
- D5: `tests/ws-message-contract.test.mjs` (client) got a `SERVER_ONLY_OK` entry for `update-required` (handled in `connect()` ahead of the switch). `module-graph-exports.json` re-recorded: two new modules.
- The wire surface fixture covers message types both ways, EFSP op kinds, and top-level keys of status, weather, game-time, atis, apt-config, init and update-required. Not covered (step 0 left it open, kept the scan fast): keys of snapshot/delta/coverage, board deltas and the efsp snapshot (they need session or EFSP state to build); use `wire:record --bump` for those.

## Mistake and its fix (for the record)

While proving the gate I ran a scratch `git rm` + commit in the real worktree instead of in the throwaway clone: commit `a95a827` ("x") deleted `crc-desktop/app/public/js/wire-protocol.js`, and a scratch tag `crc-desktop-v9.9.9` was created in the shared repo. The tag was deleted at once (never pushed) and the next commit but one restores the file; the net tree is correct. Nothing was pushed.

## Tests

crc-sync `npm test` 2134 tests, 2133 pass on rerun (one `test-reset.test.mjs` boot test failed once under full-suite load on a random-port collision; passes 3 of 3 alone), crc-desktop 894/892. `npm run freeze` 48/48, no trace moved. `soak:selfcheck` PASS. Playwright (E2E_LANE=3): `smoke.spec.js` and `update-required.spec.js` 4/4. No actionlint on this machine: both workflows parse as YAML (python yaml) and the gate script was run against fake releases JSON and a scratch tag in throwaway clones (pass, mismatch, tag-without-file, no tag, unreachable, skip). The deploy.yml SSH hold branch is not exercised locally.

## Release note

Release note: CRC now checks that it speaks the same protocol as the server and shows an "Update required" screen (with a button to fetch the update) instead of a blank picture. If you are on a version older than this one you will see "disconnected" until CRC updates itself on its next launch.

## Human release steps

1. Merge `lane/VERSION-wire-handshake` to main (the supervisor). Expect that crc-sync's image build now runs both unit suites first.
2. Add `CRCSYNC_DOWNLOAD_URL` to `infra/.env` only if you want a link other than the compose default; `git pull` on the server picks up the compose line.
3. Tag `crc-desktop-vX.Y.Z` from main so a published client speaks protocol 2 (until then the deploy gate holds crc-sync's recreate, because v1.5.0 has no protocol file = 1; everything else deploys).
4. Approve the production deploy as usual (R3-79). `skip_protocol_gate` only if you knowingly want to recreate crc-sync before the release is published.
