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
