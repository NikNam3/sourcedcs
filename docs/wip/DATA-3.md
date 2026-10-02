# DATA-3 wip

## Code as found (step 0, by symbol, on 6ffc6b8)

1. `ANGLED_DECK_BY_TYPE` (`carrier/ship-state.js`, exported via `carrier/index.js`): `{CVN_71..CVN_75: 9}`, looked up by `_angledDeck(hull, type)`; the hull's own `angledDeckDeg` (null in `config/efsp-carriers.json`) won when set. Only the tests read the export. Value existed in code only. `angledDeckSource` ('HULL' | 'TYPE_DEFAULT') is on the wire; nothing client-side reads it.
2. `radars.js`: `AIRPORT_RADAR`, `APPROACH_RADAR`, `CVN_APPROACH_RADAR`, `AIRPORT_RADAR_HEIGHT_M`, `SHIP_RADAR_HEIGHT_M`; values only in code; read by `buildRadars` and `tests/radars.test.mjs`.
3. `||`/`??` fallbacks on tuning reads in `surveillance/**` and `radars.js`: `datalink.js` (`participants || []`, `pliPeriodMs || 4000`), `transponder.js` (`syntheticFor || ['own','neutral']`, `mode4For || ['own']`), `createSurveillance` (`sensorSpecs = null`). `presentation.js` `(r.sweepMs || 0)` is a data guard, not a tuning read. The `||` merges in `loadSensorSpecs` are layer merges over the shipped file.
4. `code-allocator.js` `SYNTHETIC_BLOCK_START/SIZE` (0o6000/0o1000), spelled "6000–6777" in `code-allocator.js`, `ato/ato-board.js` and `ato/ato-sets.js` (the third was found by the questioner). Code only.
5. `carrier/flight-record.js` `APPROACH_TYPES`, `APPROACH_BUTTON_MIN/MAX`; code only; refusal text spelled the range.
6. `grpc-client.js` `_weatherRef = {41, 41}`. See Defaults: dropped, not moved.
7. Duplicates (re-grepped): `MS_PER_KT` x3, `DAY_MS` x6 (+ `metrics.js` HOUR_MS/DAY_MS), ISA x2 (`altimetry.js`, `grpc-client.js`, the latter also `ISA_T0`, `H_TROP`, `T_REF_ALT`).
8. `tools/soak/report.js` thresholds `maxKeyLen`, `logRingMax`, `appliedMax` copied by hand.

## What was done (commits, `git log 6ffc6b8..HEAD`)

1. `efsp-carriers.json`: `angledDeckDeg: 9` on CVN-72; required by `validateHullConfig`; `hull-config.js` now throws on any invalid hull (was: warn and drop); `angledDeckSource` stays on the wire, always 'HULL'.
2. `sensor-specs.json`: `fieldRadar {airport, approach, carrierApproach: rangeNm, sweepMs, heightM}` and `shipRadarHeightM`, validated in `loadSensorSpecs` (file and key named).
3. `surveillance/sensor-config.js`: validators for `datalink` and `transponder`; constructors and `loadSensorSpecs` use them; `createSurveillance` defaults its specs to `loadSensorSpecs()`.
4. `transponder.syntheticBlock {first, last}` (octal strings); `src/synthetic-block.js` is the one reader; allocator, ATO board and ATO sets quote the range from it. `code-allocator.js` loads it on first use so the pure ATO parser (test "ato purity") reads no config at require time; `transponder.js` loads it eagerly so a bad block stops start-up. A block containing a reserved code is an error.
5. `config/comm-card.json` + `src/comm-card.js` (loader, validator, `state/` layer via `readLayer`, which rejects unknown keys). `flight-record.js` reads approach types and the button rule from it. Soak host (`tools/soak/host-client.js`) copies the file into its empty config dir (one word, outside the briefed ownership; needed or freeze and soak fail at start).
6. Weather: see Defaults.
7. `src/units.js` (`MS_PER_KT`, `HOUR_MS`, `DAY_MS`); ISA exported from `altimetry.js`, imported by `grpc-client.js`.
8. `report.js` requires the three numbers (`REBALANCE_KEY_LENGTH` newly exported from `order-key.js`).
9. Strict state/ layer for `sensor-specs.json` (questioner): `checkLayerKeys` with `freeMaps` for `radar`/`carrierRadar`; test covers a misspelled key in each new section.

## Golden change (S-DATA3-0)

Only commit 1 re-recorded goldens. `hull.angledDeckDeg` on the wire went from `null` to `9` for the shipped hull (the ship-state function resolved 9 from the type table before, so `shipState.angledDeckDeg` and the final bearing were already 9). Traces that moved: hub-peer-marsa-order, hub-resync-metrics, hub-op-matrix, hub-walk-civil, hub-walk-manning, hub-walk-tactical, hub-crash-replay, hub-monitors, hub-order-keys, hub-random-seed1/2/3, scenario-carrier-l17, and one hash each in scenario-concurrency, scenario-resync, scenario-tactical. Client check: no client code reads `hull.angledDeckDeg` or `angledDeckSource` (grep of `crc-desktop` finds `angledDeck` only in a test that passes the "angled deck not configured" string as a literal), so what a controller sees is unchanged and no Playwright run was needed. Everything else: freeze green without re-recording.

## Defaults taken (P2) and rulings

- `angledDeckSource` stays 'HULL' (accepted). Invalid hull = start-up error (accepted).
- Weather (S-DATA3-1, supersedes the briefing): the theater and the airports arrive in the same fetch, so a per-theater `weatherRef` would never be used. No `weatherRef`, no 41/41: `_weatherRef` is null until the first airport; the poll asks nothing before it (ISA stands), then asks at once. Test: `tests/weather-ref.test.mjs`. The earlier weatherRef commit is in the log and reverted by the next one.
- `fieldRadar.approach.heightM` is 15 (the approach radar used `AIRPORT_RADAR_HEIGHT_M` before); `shipRadarHeightM` is a top-level key.
- Comm-card button entries are `{ button, label }`.
- Not done: `efsp/metrics.js` still has its own `HOUR_MS`/`DAY_MS` (frozen). Follow-up for the supervisor at merge: `const { HOUR_MS, DAY_MS } = require('../units')`.
- The acceptance grep for `SYNTHETIC_BLOCK_START` still matches: it is now the name of a value derived from the config (`synthetic-block.js`), not a literal.

## Squadron to verify (all [SOURCE-DEFINED])

- Angled deck 9 degrees for CVN-72 (`config/efsp-carriers.json`).
- Field radars (`sensor-specs.json` `fieldRadar`): airport 40 NM / 2000 ms / 15 m; approach 80 NM / 3000 ms / 15 m; carrier approach 50 NM / 4000 ms / 45 m; ship antenna 40 m.
- Synthetic code block 6000 to 6777.
- Approach types TACAN, ICLS, ACLS, PAR, VISUAL; button range 1..20 (`config/comm-card.json`).

## Comm card: what the human fills in (`config/comm-card.json`, a data-only commit)

```
{ "_comment": "...",
  "approachTypes": ["TACAN", "ICLS", "ACLS", "PAR", "VISUAL"],        // upper case, distinct, non-empty
  "approachButtons": { "min": 1, "max": 20,                          // integers, max < 100
    "buttons": [ { "button": 3, "label": "CVN-72 approach" } ] },    // empty = any integer min..max; filled = membership only
  "frequencies": [ { "id": "cvn-app", "name": "CVN-72 approach", "mhz": 305.5,
                     "use": "approach" } ] }                          // use: approach|tower|ground|departure|atis|other
```
A filled example with fake values is `crc-sync/tests/fixtures/comm-card/filled-example.json`. Frequencies have no consumer yet.

## For the release note

- An old `state/efsp-carriers.json` with `angledDeckDeg: null` (or none) now stops start-up naming the file and hull: set the number (9 for a Nimitz-class hull, 0 for a straight deck).
- A `state/sensor-specs.json` with an unknown or misspelled key now stops start-up naming the key.
- The first weather answer after start now comes as soon as mission data has an airport (it used to be polled at 41/41 before that).

## Tests

crc-sync unit suite 2128 pass; crc-desktop 882 pass; `npm run freeze` 48 pass; `soak:selfcheck` PASS (note: it and the full suite flaked once when run at the same time on a loaded machine; each passes alone).
