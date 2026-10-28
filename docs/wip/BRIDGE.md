# BRIDGE: specs off the classic-globals bridge

## Code as found
Bridge as briefed (121 lines, 54 modules, SETTERS for 7 senders, `history` proxy). Scan of `e2e/**` incl. `window.X`: 72 names in 32 files (`docs/wip/BRIDGE/names.txt`). index.html loads `./js/main.js` with no query string, so a dynamic `import('/js/...')` yields the module records the app runs.

## Done
- `e2e/helpers/modules.js`: `installAppModules(page)` sets `window.crc = {state, ws, sync, dock, app, bayView, carrier, nla, sfa, metricsClient, metricsPanel, stereo, fields, template, drag, marsaBadge, geojson, geo, atc}` (page-side only, no production reader). Called from `openEfspPanel` and after the one spec reload outside `openPanel` (runway-status).
- All specs read `crc.<key>.<name>`; senders go through `crc.ws.setEfspSender` / `crc.sync.setSendToSync` (l2, l15, helpers/app.js wrap loop); `history` is `crc.app.history`; `dock` is `crc.dock.dock`.
- Bridge file, its main.js import, the fixture `bridge` section and test 7 deleted; comments in sync.js / efsp-ws.js repointed. Hygiene rule added to `tests/e2e-spec-hygiene.test.mjs`.
- Titles/locals: LC/GC/AP, flight data (FLIGHT_DATA), runway status, "position" for seat. Kept: "uncovered" (layout), AIC-held line, screenshot/trace names, spec file names.
- L20-STR strings: none asserted by `e2e/**` (only `runway-status:284` "is not held", a different server string; fixed in 4fbf057, unchanged).

## Defaults taken
- `crc-desktop/README.md` bullet on the bridge rewritten (acceptance: grep finds nothing outside docs/).
- Dynamic-import identity proven by smoke (seedStrip reads `crc.state.efspStrips` and the panel renders it) and by l2/l15 setter specs passing.

## Findings
- Root `CLAUDE.md` still says the bridge exists ("crc-desktop" architecture bullet): supervisor to edit.
- Machine load was 40-56 during runs. `runway-status:318` ("needs OPS and AP") fails the same way (click timeouts) at base 6ffc6b8 under that load; l1-marsa:95, l1-popovers:174 TOFI/highlight, runway-status:211/412 failed once in the sequence and passed alone.
- Spread forms (`[...efspStrips.values()]`) were missed by the first codemod; fixed by a scan for bare names.
