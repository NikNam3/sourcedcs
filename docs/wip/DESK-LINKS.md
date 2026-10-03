# DESK-LINKS

## Code as found
- `crc-desktop/external-link.js`: `createExternalLinkGate()` holds ONE origin (the booking URL's, via `allow`); `canOpen` is an exact-origin compare.
  The overlay's `<a target=_blank href=downloadUrl>` goes to `setWindowOpenHandler`, which only opens the Casdoor authorize URL or the booking origin, so the download link is dead (B12).
- `main.js`: Casdoor popup allowed by `url.startsWith(process.env.CASDOOR_ENDPOINT + '/login/oauth/authorize')`, value fixed at startup from config.json;
  the connection widget changes the endpoint at runtime through `POST /api/sync-config` (`app/server.js` `syncConfig`), after which the popup is denied (B13).
  The popup inherits the main window's webPreferences (including the preload); `webPreferences` on the main window set only `contextIsolation` and `preload`. No `will-navigate` guard.
- lxsrs: `lxsrs_v2/lxsrs_v2/client.py` already has a 1.5 s keepalive expiry (`_ptt_heartbeat_at`), but inline in `_run_transmit_loop` after the mic is acquired:
  untestable, skipped while the mic is unavailable/suspended, and `get_ui_snapshot` (what the UI reads as `ptt`) reports a stale key as still active.
  The client re-sends `/ptt/start` every `PTT_REPEAT_MS = 400` (`ptt-controller.js`). The vendored copy is `crc-desktop/python-pkg/lxsrs_v2` (re-vendor with `scripts/sync-lxsrs.sh`).

## Radio watchdog
The briefing's premise was partly stale: a 1.5 s expiry existed, inline in the mic loop. It is now `SRSClient.ptt_watchdog_tick()`
(`PTT_KEEPALIVE_TIMEOUT_S = 1.5`, client re-sends every 400 ms, so 3 missed keepalives plus margin), run at the top of every
transmit-loop pass (also while the mic is unavailable/suspended) and on every `get_ui_snapshot`, so the UI cannot read a stale key as keyed.
Tests: `lxsrs_v2/lxsrs_v2/tests/test_ptt_watchdog.py` (incl. the real HTTP handler). Re-vendored by copy into `python-pkg`
(`sync-lxsrs.sh` does not overwrite an existing target: pip lacks `--upgrade`; `check-lxsrs-sync.sh` is clean).
Finding: `transmit_ptt_down` always stamps the heartbeat, so the stdin/pynput PTT modes (no keepalive) would be cut after 1.5 s; crc-desktop uses the web API only, so left alone.
Also: `sync-lxsrs.sh` should pass `--upgrade`.

## Not fixed (H106 AC-2 b)
Localhost `POST /api/sync-config` (cross-site) stays a known finding.
