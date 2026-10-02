# TOFI-REGIME (server part): the regime picked at accept becomes effective at airspace entry (ADR 0102)

## Code as found (step 0, base bc1f5075)
- `Tofi._applyTofiAccept` (`board/tofi.js`) wrote the picked regime via `flightDataStore.setTofi`. Readers of `tofi.separationRegime`: the EXIT gate (same file), SetBlock SREG (`board/ops/set-block.js`), the MARSA store (writes it back), the block map.
- 2S-A is on the base: `ctx.airspaceStore.activeContaining/isActiveFor/containing`, indicated feet. No stub. Mapping is in ADR 0102 "Depends on".
- Names are post-rename: `flightDataId`, `stripType`.

## What was built
- `flight-data-store.js` `setTofi`: `pendingSeparationRegime` (not ATC), `pendingSince`, `pendingFacilityId`, `regimeEffective {at, trigger, airspaceId, facilityId, by}`; `stores.js` shape allow-list; the MARSA store's regime write clears pending (a relation owns the regime).
- `board/tofi.js`: ACCEPT writes ATC plus pending (effective at once if already inside, trigger AIRSPACE); `markEntered` (the one promotion function); `MARK_ENTERED` op (MISSION Strip, ACTIVE ENTRY, pending present; warning `NOT_IN_ACTIVE_AIRSPACE` without containment); `markEnteredBySystem` (monitor). EXIT accept and ENTRY reject clear pending. `ops/tofi.js` `auditFields` adds `tofiRegime {trigger, airspaceId, regime, warning}`. `ops/set-block.js` SREG: before entry non-ATC replaces pending, ATC clears it; after entry as before (ATC also drops the stamp).
- Authority: `MARK_ENTERED` joins `TOFI_ANSWER_ACTIONS` (tactical.js), so TAC_C2 may mark on an AIC-held line; the MISSION owner already holds the TOFI op.
- `src/efsp/tofi-regime-monitor.js` (`evaluateRegime`, `TofiRegimeMonitor`), ticker `tofi-regime` 1 s in `app.js`; `config/alerting.json` `tofiRegime.regimeExitGraceS: 10` (`alerting-config.js`; there is no separate schema file). Entry on the 2nd consecutive inside tick; grace is wall time; `since` mission time. Skips flights in an active MARSA relation.
- The monitor writes through the Board facade: `efsp.markTofiEntered` -> `BoardStore.markTofiEntered` -> `Tofi.markEnteredBySystem`, audit op `TofiRegimeEntered` (actor `system`, one entry), persisted, board-delta via `wsHub.broadcastEfspMessage`.
- Locator seam: `efsp.setRegimeLocator(fn)`; rule `regimeLocation` (new required rule). `app.js` builds the locator (correlated track, `indicatedAltFt`, `airspaceStore.activeContaining`).
- Wire: `efsp-alerts` gains `tofiRegime: [{flightDataId, kind: 'REGIME_OUTSIDE_AIRSPACE'|'AWAITING_ENTRY_UNKNOWN', since}]` (read-scope filtered by flight). `npm run wire:record`: surface unchanged, protocol stays 2.

## For the supervisor at merge
- OBSERVED_PATHS (UNDO-S): the monitor's writes touch only `flightData.tofi.separationRegime`, `.pendingSeparationRegime`, `.pendingSince`, `.pendingFacilityId`, `.regimeEffective`. Add them if the executor needs it. They also go through `setTofi`, so `changedAt/changedBy` move.
- MARK_ENTERED undo scope not declared (executor not on this base): a `test.todo` in `tests/tofi-regime.test.mjs`. Restoring pending needs `separationRegime` (ATC), the four pending/effective fields and the Strip rev. The automatic entry is not undoable.
- Merge note: `tests/helpers/full-rules.mjs`, `required-rules.js` (51 rules), `app-boot` ticker list and `efsp-alerts-compose` test changed; re-run `wire:record` and `freeze:update` after merging Split/Join.
- Freeze goldens: every trace that holds a flight data moved (four new `tofi` fields) plus `guard-board-surface.json` (`markTofiEntered`). Re-recorded in 311ca9af.

## Defaults taken
- `regimeEffective` also carries `facilityId` (the monitor needs the MRU Facility after pending is cleared).
- Monitor uses a locator dep instead of the briefing's raw store deps (one answer shared with ACCEPT and MARK_ENTERED); only CORRELATED (not PROVISIONAL) counts as located.
- Rejecting an EXIT does not clear pending.
- `unknown` geometry while effective is not outside (no alert).

## Not done
- Client part (pending SEP REG display, `[Entered]` button, alert chip, `tofiRegime` handler, CSS), usage guide paragraph: after BRIDGE and CR-C.
- Manual walk with a drawn AREA/ROUTE on a live server not done; covered by unit tests with a fake locator (containment geometry is 2S-A's tests).

## Release note
The separation regime a TOFI accept picks now waits: ATC stays the regime until the flight is inside an airspace active for the MRU, or the MRU marks it entered. Leaving the airspace raises an alert; it never changes the regime.
