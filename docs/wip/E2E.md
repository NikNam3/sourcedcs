# E2E — triage of the post-merge Playwright failures (lane 9)

## What was found

Two full runs on the merged code failed 6 and 8 tests with no overlap except
`mtr-fields.spec.js:231`. Each failing spec file was then run alone three times
on lane 9 (fresh crc-sync per run): 106 of 108 test runs passed. The two
failures had the same signature:

- `l3-coordination.spec.js:289` (TOFI note): `.efsp-strip-menu-btn` click timed
  out — "element was detached from the DOM, retrying".
- `mtr-fields.spec.js:59`: `locator.screenshot: Element is not attached to the DOM`.

Cause, measured with a MutationObserver probe: a Strip seeded in a
correlation-eligible state (anything not in crc-sync's
`correlation-reconciler.js` `INELIGIBLE_STATES`) is drawn once, then **rebuilt**
when its correlation record arrives on the reconciler's next 1 s tick
(`cor:` changes in `bay-view.js` `_stripRenderSignature`). Idle that is
400–900 ms after seeding; on a machine at load 20–60 it is seconds, so any spec
acting on the Strip right after `seedStrip` could hold a detached element. Which
test lost the race depended on load, which is why the two runs disagreed.

Not a product bug: rebuilding on a new correlation record is the intended
reconciler behaviour (the F-305 fix).

## Fix

`crc-desktop/e2e/helpers/app.js` — `seedStrip` now waits (up to 10 s) until the
drawn Strip's `data-sig` carries its correlation record, for eligible states
only. Two full runs on lane 9 afterwards are green.

## Notes for other lanes

- `--repeat-each` is not a valid way to re-run most specs here: the Board lives
  for the whole run and several specs use fixed callsigns (`NOTE01`, `OBR1`,
  `VIPER11`, `MTR10x`). Re-run by separate invocations instead.
- A Playwright run killed by an outer `timeout` leaves its `webServer`
  processes listening on the lane's ports; the next run then fails with
  "port is already used". Stop them by PID.
- If `correlation-reconciler.js`'s `INELIGIBLE_STATES` changes, update the copy
  in `helpers/app.js` (`CORRELATION_INELIGIBLE`).

## Second full run after the fix (load 30): 94/98

- `l3-coordination.spec.js:214` — `seedStrip`'s count+1 missed its 5 s default
  (no new Strip drawn at all; no refusal on screen). Raised to 10 s.
- `l5-arrivals.spec.js:86` — `taxiToTower`'s 3 s poll for one NLA round trip.
  Raised to 10 s (spec budget is 90 s).
- `l5-arrivals.spec.js:99` / `:127` — **ENV**. `toggleDockPanel` threw on a null
  `dock` (`initDock()` never completed), and in the next test `toggleDockPanel`
  was never defined within 90 s. `index.html` loads `dockview-core` from
  cdn.jsdelivr.net and `maplibre-gl` from unpkg.com, so every e2e page load
  depends on those CDNs; ~12 agents reloading at once is the likely trigger.
  Owner if it is to be fixed: whoever owns `crc-desktop/app/public/index.html`
  (vendor the two scripts, or a `page.route` in the e2e harness serving them
  from `node_modules`). Not changed here. **Confirmed**: a probe with
  `page.route(/cdn\.jsdelivr\.net/, abort)` reproduces the exact error
  (`toggleDockPanel`: "Cannot read properties of null (reading 'api')"). Seen
  again in run 4 on `mtr-pilot-walk.spec.js:56`.

## Third full run (load 26): 93/98

- All five `l4-drag.spec.js` tests failed together. The failure screenshot shows
  the top bar at RECONNECTING and the previous test's Strips (L4A2..4) still in
  the Bay: the page lost its connection mid-spec, so cleanup and the drag
  mutations never landed. **ENV/load**. Alone, twice: 5/5 and 5/5.

## Fourth full run (load 19): 97/98

- Only `mtr-pilot-walk.spec.js:56`, the CDN failure above.
