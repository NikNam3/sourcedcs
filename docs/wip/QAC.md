# QAC: crc-desktop cleanup (D-3, D-5, D-6, D-7, D-11)

All five findings verified against the code; none skipped.

- **D-3** MapTiler key: was literal in `elevation.js` and twice in `crc-desktop-scope-style.json`. Now `app/maptiler.js` holds the one shipped default; `app/server.js` reads `CRC_MAPTILER_KEY` (else the default) once, exposes it as `MAPTILER_KEY` in `/js/config.js`, and serves the style JSON with its `__MAPTILER_KEY__` placeholder filled in. Shipped behaviour unchanged. Guide/README could mention `CRC_MAPTILER_KEY` (not edited: shared docs).
- **D-5** Comments pointing at the deleted `ui.js` repointed to `panels/radar-panel.js`, `track-panel.js`, `tools-panel.js`, `los-panel.js` (dock.js, sync.js, los.js, los-panel.css, index.html). The "Split out of the former ui.js" history notes in `panels/*.js` were left: they are accurate history, not pointers.
- **D-6** `toMagneticDisplay` stub in `field-state-panel.js` removed. It was dead (magnetic.js loads earlier and defines the real one; the guard never fired). The panel's own `typeof` guard remains, so tests that load it without magnetic.js are unaffected.
- **D-7** Untracked with `git rm --cached` and gitignored: `/lxsrs_v2_state.json` (repo root) and `/crc-desktop/lxsrs_v2_state.json`. `lxsrs_v2` `_load_state` swallows a missing file and `save_state` recreates it in cwd, so nothing needs a committed copy. Existing checkouts keep their local file (ignored now).
- **D-11** `app/proxy-routes.js`: route table + `resolveProxyPath(url, method)`; `server.js` calls it. Order, exact/prefix/query matching and method restrictions are identical (including quirks: `/api/srs-clients?x` is not proxied). `/api/sync-config` untouched. New `tests/server-proxy-routes.test.js` spawns the real server against a fake crc-sync and checks upstream path, Authorization pass-through, forced Content-Type, body, status/content-type relay, 404 for non-routes and 502 `{error:'crc-sync unreachable'}`.

Findings for others: none. Defaults taken: none.
