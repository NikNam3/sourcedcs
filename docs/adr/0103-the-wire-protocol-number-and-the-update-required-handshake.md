# 0103 — The wire protocol number and the update-required handshake

## Context

W7 renamed every wire name (S-M-W7). An installed crc-desktop from before W7 connects to the new crc-sync, receives frames it does
not understand, and shows an empty or half-filled picture with no error. Nothing on either side knew which protocol the other
spoke. Every frame carries `version: 1`, but that number never changed and the client never read it. No crc-sync CI job ran the
tests, and `deploy.yml` deployed whatever image had built (H82: R3-1, S3-5).

## Decision

- **One integer per side**: `crc-sync/src/wire-protocol.js` (`WIRE_PROTOCOL`) and a hand copy
  `crc-desktop/app/public/js/wire-protocol.js`, with a parity test in crc-desktop that reads the crc-sync file. It is **2**,
  because W7 already broke 1. It does not come from the package versions: crc-desktop's version is the release tag, crc-sync's
  is never bumped, and a deploy that does not touch the wire must not lock anyone out.
- **The per-frame `version: 1` is the envelope's version, not the protocol, and stays 1.** The soak matches literals such as
  `'{"version":1,"type":"efsp-heartbeat"'` to inject faults; changing the value would silently switch that off.
- **Bump rule**: `tests/wire-protocol.test.mjs` compares the current wire surface (client and server message types, EFSP op
  kinds, top-level keys of the frames a hub test can build cheaply) with `tests/fixtures/wire-surface.json`. A difference fails
  the test with the instruction to run `npm run wire:record`. That script re-records the surface and bumps both copies only if
  the last `crc-desktop-v*` tag already shipped the current number (several lanes between two releases share one bump; no tag, or
  no file at the tag, means bump). A change the surface cannot see, such as a value's meaning, is bumped by hand with
  `wire:record --bump`.
- **Handshake**: the client appends `&protocol=<n>&client=<appVersion>` to the `/feed` URL. `ws-hub.js` `attach()`'s connection
  listener calls `_admit(ws, req)` before `_onConnect` (tests and the soak call `_onConnect` directly and are unaffected). A
  missing or non-integer `protocol` is 1. The policy is an exact match (S-M-BACKCOMPAT). On a mismatch the server sends one
  `{ version: 1, type: 'update-required', serverProtocol, clientProtocol, downloadUrl? }` frame (`downloadUrl` from the optional
  `CRCSYNC_DOWNLOAD_URL`) and closes with code **4426**, creating no session and sending no picture. It logs once per
  who+clientVersion at info, later attempts at debug. `verifyClient` stays: an HTTP refusal at upgrade reaches a browser only as
  close code 1006, so the server accepts and then closes. `client=` is informational; the server never decides on it.
- **Client**: the frame or close code 4426 stops the 2 s reconnect loop and shows an "Update required" overlay. Older than the
  server: "Check for update" runs electron-updater now, follows its status, offers "Restart to update". Newer than the server:
  "the server must be updated first". No updater, or `update-not-available`: "No update is published yet", with the download link.
  "Retry" connects once.
- **Deploy gate**: `crc-sync-docker.yml` has a `test` job (both unit suites) that `build-and-push` needs. `deploy.yml` refuses
  to deploy a crc-sync whose `WIRE_PROTOCOL` differs from the one in the published crc-desktop release (read from
  `/api/releases/latest` and `git show crc-desktop-v<version>:...`), fails closed, and has a human-only `skip_protocol_gate`
  input. The human still approves every prod deploy (R3-79, R3-4).

## Consequences

- **Accepted one-time cost**: clients installed from before this lane send no `protocol`. They are refused, see close code 4426
  without understanding it, and reconnect every 2 s with the topbar showing disconnected. They cannot show a message, because they
  have no code for it; electron-updater installs the new release on their next launch. They are not special-cased.
- Between the upload of a new client and the crc-sync deploy, updated clients see "the server must be updated first", correctly.
- Test hook: `POST /__test/wire-protocol` (same gates as the reset hook) lets the browser suite make a crc-sync speak another protocol.
