# L20-SYNCTOP wip

## Step 0 (base 277e65f)
l20scan SYNCTOP column: files 264, comment lines 7163, stale file ptr 12, stale _method ptr 2, board-store lines 7, vocab 51, SOURCE-DEFINED 12.
crc-sync part of the stale file ptrs: mission-clock.js:15, state-paths.js:15 (kept, "since removed"), terrain.js:8 (test file exists: false positive, verify), theater-context.js:14, ws-hub.js:283. _method: radars.js:4, soak/report.js:20.
sourcedcs-web/atobrief hits: kept senses (JWT claims, Casdoor roles, "discord.js" npm package, CSS "APP SHELL", map "covering" tiles, weather "station", grading "claimed").

## Code as found
Filled in as rows are applied (see Rows).

## Rows
| Row | Where | Result |
|---|---|---|
| C1 | config/alerting.json `_comment` (tuning loader skips `_`) | [SOURCE-DEFINED] token, CA |
| C5, C7, C8, C9 | transponder.js, conflict-alert.js, presentation.js, iff.js | markers added |
| D9 | datalink.js | "loosely modelled on a Link 16 PPLI" |
| U9 | presentation.js SCHEME_HOLD_SWEEPS | marker, ADR 0088 H41/H71 |
| U1 | config/efsp-instrumentation.json `_note` (tuning loader) | token, guide D-6, ADR 0065 |
| U2 | config/sensor-specs.json `_comment` | `presentation` section described, ADR 0088 |
| L19 | config/efsp-surveillance-hints.json `_note` | token added |
| U5 | theater-context.js `transitionAltFt()`, surveillance/index.js env fallback | marked; no literal 18000 left (it is config/theaters.json `defaultTransitionAltFt`); altimetry.js takes it as a parameter, no fallback, left alone |
| U12 | mission-session.js | CLOCK_STEP_BACK_MS, CLOCK_ROLL_ADOPT_MS marked ADR 0086; LAST_AT_PERSIST_MS "engineering bound" |
| U14 | soak/report.js | THRESHOLDS header; ring/applied caps point to sync-log.js / replay-cache.js; key length 40 mirrors order-key.js |
| U16 | tools/miztoyaml/build_doc.py | `#` comment added |
| pointers | mission-clock.js, theater-context.js, ws-hub.js:283, radars.js, terrain.js, app.js/server header, soak host-env/host-core | fixed; state-paths.js:15 kept ("since removed") |

board-store lines (7 at base): app.js:547, host-core.js:113, host-env.js:91 and :143 verified/reworded (current names); host-env.js:78 now board/board-state.js rack(); report.js two lines replaced. 4 remain, all true.

## Kept senses (other services)
atobrief/sourcedcs-web: JWT "claims"/Casdoor roles, grading "claimed", CSS "APP SHELL"/"Role color badge", map tiles "covering", weather "station", npm package `discord.js`, `config.js` file refs (exist), skills-admin.js refs (exist), wing-admin "Role assignment" (Discord role). tools/miztoyaml weapons.py "rack station" (aircraft stores station). atobrief usmtf-ato.js L11 markers kept. No stale pointer in those services.
crc-sync kept: terrain.js "covering tiles" (geometry), app.js "claim" (assertion), tuning-file.js `stca` (quoted old key), driver.js `x.holds` code name.

## Findings (code or string, not L20-SYNCTOP)
- crc-sync/src/app.js:409 log string 'archived Strips and FDRs' (L20-STR).
- crc-sync/tools/soak/report.js:124 string "orphan FDRs" (L20-STR).
- report.js copies 2000/5000 and 40 (README "Not L20").
- host-core.js wraps the facade private `_rebalanceRack` by name (noted in a comment).
No Mirror lines, no ADR errata.
