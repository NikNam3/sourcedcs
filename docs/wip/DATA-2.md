# DATA-2: tuning defaults move to their JSON twins; the literal inventory

## Report

Branch `lane/DATA-2-tuning-json`, base `e2cd0fa`.

- Moved (one `behaviour(DATA-2)` commit per module, titles per ruling S-DATA2-0): alerting `DEFAULTS`; instrumentation and surveillance-hints defaults; carrier `DEFAULT_HULL`; radars `DEFAULT_CAPS` / `DEFAULT_PRESENTATION` / `SHIP_RADAR_DEFAULT` / `EMPTY_SPECS` (into `sensor-specs.json`: new `defaultCaps`, `shipRadarDefault`); `DEFAULT_TRANSITION_ALT_FT` (into `theaters.json` `defaultTransitionAltFt`); stereo-routes and airspace-config `[]` defaults. New `src/tuning-file.js` (`readShipped`, `readLayer`): the shipped `config/` file is the only source, a missing or invalid one is a startup error naming it, a `state/` copy or test override layers over it. Instrumentation and hints keep their per-field fallback, now to the shipped values. P5 holds: every file is read once at load, nothing writes a tuning file (stereo-routes and airspace-config are state-written data, not tuning files, and are unchanged in that respect).
- Golden: identical after every commit (47 pass, no `freeze:update`). Selfcheck: not run (no mutation retargeted); `soak:selfcheck` not run (no Gates file touched).
- Suites: crc-sync 2050 tests (2047 pass, 2 timing fails under load) -> 2057 (2055 pass, 1 timing fail under load, passes alone; `ato tokenize: pathological inputs finish fast` is flaky both ways), 1 todo; crc-desktop 866 -> 866 (865 pass).
- Tests changed: `conformance`, `stca`, `efsp-block-altitude` (use `loadAlertingConfig()`), `efsp-instrumentation-config` (copies the shipped file into its temp config dir, adds a startup-error test), `efsp-carrier-ship-state` and `efsp-carrier-acceptance` (hull from `getDefaultHull()`), `radars` (shipped fallback, defaults from specs), `efsp-stereo-routes` (three load cases now expect a startup error), `efsp-station-coverage` (writes its empty airspaces file). New: `tests/tuning-defaults.test.mjs` (6).
- Outside Owns: `crc-sync/tools/soak/host-client.js` (`writeFixtures` copies the shipped tuning files into the soak's otherwise-empty config dir and writes pinned `theaters.json` / `sensor-specs.json` layers so the soak and the freeze world behave as before). `src/tuning-file.js` is new. No structure-fixture changes.
- Not moved, on ruling or scope: `ANGLED_DECK_BY_TYPE` (ruled data, but `ship-state.js` is pure and takes the hull as an argument; moving it needs the table injected through `hull-config` into `buildShipState`, an API change outside "defaults only"), `AIRPORT_RADAR` / `APPROACH_RADAR` / `CVN_APPROACH_RADAR` and the radar heights, `surveillance/datalink.js` `|| 4000`.
- Defaults taken (P2): missing tuning file = startup error (ruled); config-dir override is layered over the shipped file rather than replacing it; theaters default stored as a top-level key, not a pseudo-theater.
- Findings: `grpc-client.js:109` hardcodes the weather reference point 41.0/41.0 (a Caucasus location); it belongs in `theaters.json` (no test.todo written). ISA constants are duplicated in `altimetry.js` and `grpc-client.js`; `MS_PER_KT` in three files; `DAY_MS` in five.
- For the supervisor: rulings and the follow-up list are in sections C and E below.

`git log --oneline e2cd0fa..HEAD`:
```
cb8f867 refactor(DATA-2): station-coverage test writes its empty airspaces file
f78d59d behaviour(DATA-2): airspaces come from config/ (missing or invalid file is a startup error)
10c355a behaviour(DATA-2): stereo routes come from config/ (missing or invalid file is a startup error)
86ddf3f behaviour(DATA-2): default transition altitude comes from config/theaters.json (missing or invalid file is a startup error)
bfb3627 behaviour(DATA-2): radar defaults come from config/sensor-specs.json (missing or invalid file is a startup error)
fee1e1d behaviour(DATA-2): carrier hull defaults come from config/ (missing or invalid file is a startup error)
2ca4f4b behaviour(DATA-2): surveillance-hints defaults come from config/ (missing or invalid file is a startup error)
e37ddc1 behaviour(DATA-2): instrumentation defaults come from config/ (missing or invalid file is a startup error)
2c90157 behaviour(DATA-2): alerting defaults come from config/ (missing or invalid file is a startup error)
f059110 wip(DATA-2): step 0 baselines, code as found, the full literal inventory
```


## Baselines at e2cd0fa (step 0)

- crc-sync `node --test tests/*.test.mjs`: 2050 tests, 2047 pass, 2 fail (`ato tokenize: pathological inputs finish fast`, `a stream that stayed up resets the backoff`: timing tests on a loaded machine), 1 todo. Both re-run alone below.
- crc-desktop `node --test tests/*.test.js`: 866 tests, 865 pass, 0 fail.
- Freeze goldens `tests/freeze/freeze-*.test.mjs`: 47 pass.

## Code as found (by symbol, on e2cd0fa)

| Briefing item | Where | JSON twin | How they merge today | Only in code? |
|---|---|---|---|---|
| `DEFAULTS` | `src/alerting-config.js:15` | `config/alerting.json` (identical values) | `{...DEFAULTS.sec, ...file.sec}` per section; unreadable file warns and uses DEFAULTS | no |
| `DEFAULT_INSTRUMENTATION_CONFIG` | `src/efsp/instrumentation-config.js:23` | `config/efsp-instrumentation.json` (identical) | per-field validation falls back to the default; unreadable file returns the default | no |
| `DEFAULT_HINTS_CONFIG` | `src/efsp/surveillance-hints-config.js:15` | `config/efsp-surveillance-hints.json` (identical) | same per-field fallback | no |
| `DEFAULT_HULL` | `src/efsp/carrier/ship-state.js:49` | `config/efsp-carriers.json` `hulls[0]` (identical) | used only when the file yields no valid hull (and by `CarrierStore` when `hulls` is empty, plus tests) | no |
| `DEFAULT_CAPS` | `src/radars.js:64` | `config/sensor-specs.json` has no `caps` per kind | `capsFor(kind, spec)` = default kind caps, spread with `spec.caps` | YES, only in code |
| `DEFAULT_PRESENTATION` | `src/radars.js:83` | `sensor-specs.json` `presentation` (identical) | `{...base.presentation, ...cfg.presentation}`; `presentationFor` falls back to it | no |
| `SHIP_RADAR_DEFAULT` | `src/radars.js:48` | none (`carrierRadar` is keyed by ship type) | used when a ship type has no `carrierRadar` entry | YES |
| `EMPTY_SPECS` | `src/radars.js` (`datalink` 4000/2000, `transponder` lists) | `sensor-specs.json` `datalink`/`transponder` (identical) | spread under the file's sections | no (not in the briefing list, same file) |
| `DEFAULT_TRANSITION_ALT_FT` | `src/theaters.js:80` | per-theater `transitionAltFt` in `config/theaters.json`; no fallback entry | used for a theater the table does not list; imported by `theater-context.js`, `efsp/fdr-store.js`, `surveillance/index.js` | YES (the fallback value) |
| stereo-routes `[]` | `src/efsp/stereo-routes.js:127` | `config/efsp-stereo-routes.json` = `[]` | fallback when the file is unreadable or invalid | no |
| airspace-config `[]` | `src/efsp/airspace-config.js:144` | `config/efsp-airspaces.json` = `[]` | same | no |

Note on the last two: they are not tuning files. `setStereoRoutes`/`setAirspaces` write to `state/` (the reload step of guide §8.4), so P5 does not apply to them; only the code default goes.

## The literal inventory

### A. Named module-scope constants (374)

Counts: facility data 17, tunable threshold 9, doctrine table 135, engineering constant 197, unclear 16.

| Where | Name | Value | Class | Reason |
|---|---|---|---|---|
| alerting-config.js:15 | `DEFAULTS` | `{ conformance: { minGroundSpeedKt: 50, headingTo…` | TUNE | duplicates config/alerting.json; this lane removes it (moves) |
| altimetry.js:11 | `ISA_P0` | `101325` | ENG | ISA physics constants (duplicated in altimetry.js and grpc-client.js: a dedupe candidate, not a move) |
| altimetry.js:12 | `ISA_L` | `0.0065` | ENG | ISA physics constants (duplicated in altimetry.js and grpc-client.js: a dedupe candidate, not a move) |
| altimetry.js:13 | `ISA_G` | `9.80665` | ENG | ISA physics constants (duplicated in altimetry.js and grpc-client.js: a dedupe candidate, not a move) |
| altimetry.js:14 | `ISA_R` | `287.05287` | ENG | ISA physics constants (duplicated in altimetry.js and grpc-client.js: a dedupe candidate, not a move) |
| altimetry.js:17 | `H_TROP` | `11000.0` | ENG | ISA physics constants (duplicated in altimetry.js and grpc-client.js: a dedupe candidate, not a move) |
| altimetry.js:18 | `T_REF_ALT` | `288.97` | ENG | ISA physics constants (duplicated in altimetry.js and grpc-client.js: a dedupe candidate, not a move) |
| apt-config.js:23 | `KEY_MAX_LEN` | `40` | ENG | input length / count caps |
| apt-config.js:24 | `FREQ_MAX_LEN` | `16` | ENG | input length / count caps |
| apt-config.js:25 | `RWY_MAX_LEN` | `4` | ENG | input length / count caps |
| apt-config.js:26 | `INFO_MAX_LEN` | `1` | ENG | input length / count caps |
| apt-config.js:27 | `VIS_MAX_LEN` | `8` | ENG | input length / count caps |
| apt-config.js:28 | `COVER_MAX_LEN` | `4` | ENG | input length / count caps |
| apt-config.js:29 | `BASE_MAX_LEN` | `8` | ENG | input length / count caps |
| apt-config.js:30 | `MAX_CLOUD_LAYERS` | `3` | ENG | input length / count caps |
| apt-config.js:31 | `MAX_AIRPORTS` | `500` | ENG | input length / count caps |
| auth.js:26 | `TICKET_TTL_MS` | `30000` | ENG | security protocol (30 s ticket TTL, CLAUDE.md) |
| collab-store.js:20 | `FILE_NAME` | `'collab-overlay.json'` | ENG | file name / schema version / clock-resync windows (restart robustness) |
| collab-store.js:21 | `VERSION` | `1` | ENG | file name / schema version / clock-resync windows (restart robustness) |
| collab-store.js:26 | `PARK_MS` | `10 * 60 * 1000` | TUNE | how long an unstreamed overlay entry waits; operational behaviour, no doctrine |
| collab-store.js:30 | `CLOCK_GRACE_MS` | `15 * 1000` | ENG | file name / schema version / clock-resync windows (restart robustness) |
| coverage.js:29 | `SWEEP_BEAM_DEG` | `4` | ENG | sweep-beam/LOS cache sizes; render-fidelity knobs |
| coverage.js:36 | `LOS_CACHE_MS` | `1000` | ENG | sweep-beam/LOS cache sizes; render-fidelity knobs |
| coverage.js:38 | `LOS_CACHE_MAX` | `20000` | ENG | sweep-beam/LOS cache sizes; render-fidelity knobs |
| efsp/airborne.js:17 | `MS_PER_KT` | `0.514444` | ENG | unit conversions / phase enum |
| efsp/airborne.js:18 | `M_PER_FT` | `0.3048` | ENG | unit conversions / phase enum |
| efsp/airborne.js:19 | `FOOTPRINT_M` | `5000` | TUNE | how close to the field counts as "on the field" for airborne detection; same family as efsp-surveillance-hints.json |
| efsp/airborne.js:21 | `PHASES` | `Object.freeze({ AIRBORNE: 'AIRBORNE', ON_GROUND:…` | ENG | unit conversions / phase enum |
| efsp/airspace-config.js:47 | `AIRSPACE_TYPES` | `new Set([ 'MOA', // military operations area — F…` | DOCT | airspace type vocabulary (FAA naming) |
| efsp/airspace-config.js:60 | `MIN_ALTITUDE_FT` | `0` | ENG | validation bounds |
| efsp/airspace-config.js:61 | `MAX_ALTITUDE_FT` | `100000` | ENG | validation bounds |
| efsp/airspace-config.js:72 | `MIN_FREQUENCY_MHZ` | `30` | ENG | validation bounds |
| efsp/airspace-config.js:73 | `MAX_FREQUENCY_MHZ` | `400` | ENG | validation bounds |
| efsp/airspace-store.js:33 | `AIRSPACE_STATES` | `['SCHEDULED', 'ACTIVE', 'RELEASED', 'RETURNED']` | DOCT | airspace activation lifecycle states and legal transitions |
| efsp/airspace-store.js:40 | `LEGAL_TRANSITIONS` | `{ SCHEDULED: ['ACTIVE', 'RETURNED'], // RETURNED…` | DOCT | airspace activation lifecycle states and legal transitions |
| efsp/airspace-store.js:47 | `INITIAL_STATE` | `'RETURNED'` | DOCT | airspace activation lifecycle states and legal transitions |
| efsp/alert-scramble.js:41 | `SCRAMBLE_PRE_AIRBORNE` | `Object.freeze({ DEPARTURE: Object.freeze(['PROPO…` | DOCT | scramble state sets, [SOURCE-DEFINED] per guide silence |
| efsp/alert-scramble.js:45 | `GROUND_STATES` | `Object.freeze({ DEPARTURE: Object.freeze(['PUSHB…` | DOCT | scramble state sets, [SOURCE-DEFINED] per guide silence |
| efsp/archiver.js:27 | `ARCHIVE_AFTER_MS` | `2 * 60 * 60 * 1000` | UNCL | finished-Strip retention (ADR 0082). Source comment says "H36: a decision, not tuning, so a constant rather than a config file"; H88 says tunable thresholds go to JSON. Which wins? |
| efsp/ato/ato-board.js:33 | `ATO_IMPORT_ORIGIN` | `Object.freeze({ facilityId: 'TACTICAL', position…` | DATA | where an imported ATO lands (TACTICAL / TAC_C2 / bay id): facility topology as a literal [SOURCE-DEFINED] |
| efsp/ato/ato-board.js:38 | `DAY_MS` | `24 * 60 * 60 * 1000` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-board.js:39 | `ACTIONS` | `new Set(['CREATE', 'BIND', 'UPDATE', 'SKIP'])` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-board.js:40 | `CALLSIGN_RE` | `/^[A-Z0-9]{1,7}$/` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-board.js:41 | `MONTHS` | `['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL'…` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-board.js:46 | `SEED_PATH_OF` | `Object.freeze({ missionNumber: 'mission.missionN…` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-mapping.js:43 | `SEED_KEYS` | `Object.freeze(['callsign', 'flightSize', 'aircra…` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-mapping.js:49 | `ACCEPTANCE_FIELDS` | `Object.freeze(['packageId', 'vulWindowStartUtc',…` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-sets.js:37 | `CALLSIGN_RE` | `/^[A-Z0-9]{1,7}$/` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-sets.js:43 | `CONTROL_AGENCY_TYPES` | `Object.freeze({ AWAC: 'AWACS', CRC: 'CRC', OTR: …` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-sets.js:49 | `AR_SYSTEMS` | `new Set(['BOM', 'CDT', 'BOOM', 'DROGUE'])` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-sets.js:51 | `TACAN_RE` | `/^(?:\d{1,3}-\d{1,3}\|\d{1,3}[XY])$/` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-sets.js:55 | `IFF_CANDIDATE_RE` | `/^[1-3]\d{2}(?:\d{2})?$/` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-structure.js:28 | `HEADER_SETS` | `new Set(['OPER', 'EXER', 'MSGID', 'AKNLDG', 'TIM…` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-structure.js:29 | `TIMEFRAM_NAMES` | `['TIMEFRAM', 'PERIOD', 'PERID']` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-structure.js:30 | `GROUPING_SETS` | `new Set(['TSKCNTRY', 'SVCTASK', 'TASKUNIT'])` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-structure.js:31 | `FREE_TEXT` | `new Set(['AMPN', 'NARR', 'GENTEXT', 'RMKS'])` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-structure.js:33 | `MISSION_SETS` | `new Set(['MSNACFT', 'AMSNLOC', 'GTGTLOC', 'CONTR…` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-structure.js:37 | `KNOWN_UNMAPPED` | `new Set(['MTGTLOC', 'SHIPTGT', 'ESCDATA', 'RECCE…` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-structure.js:40 | `LOCATION_SETS` | `new Set(['GTGTLOC', 'MTGTLOC', 'SHIPTGT', 'ESCDA…` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/ato-structure.js:43 | `SINGLE_PER_MISSION` | `new Set(['AMSNLOC', 'CONTROLA', 'REFTSK', 'PKGCM…` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/callsign-fit.js:21 | `MAX_CALLSIGN` | `7` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/callsign-fit.js:22 | `FITS_RE` | `/^[A-Z0-9]{1,7}$/` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/callsign-fit.js:23 | `VOWELS` | `new Set(['A', 'E', 'I', 'O', 'U'])` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/usmtf-time.js:16 | `MONTHS` | `['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL'…` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/usmtf-time.js:20 | `DTG_RE` | `/^(\d{2})(\d{2})(\d{2})([A-Z])?(?:(JAN\|FEB\|MAR\|A…` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/usmtf-tokenize.js:20 | `MAX_INPUT_BYTES` | `1024 * 1024` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/usmtf-tokenize.js:25 | `MAX_FREE_TEXT` | `2000` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/usmtf-tokenize.js:28 | `FREE_TEXT_SETS` | `new Set(['AMPN', 'NARR', 'GENTEXT', 'RMKS'])` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/usmtf-tokenize.js:35 | `KNOWN_SET_NAMES` | `new Set([ 'OPER', 'EXER', 'MSGID', 'AKNLDG', 'TI…` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/usmtf-tokenize.js:46 | `DESCRIPTOR_RE` | `/^([A-Z][A-Z0-9]{0,5}):(.*)$/s` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/usmtf-tokenize.js:47 | `SET_NAME_RE` | `/^[A-Z0-9]+$/` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/ato/usmtf-tokenize.js:195 | `HEADER_CELL_RE` | `/^[A-Z][A-Z0-9]*$/` | ENG | USMTF/ATO protocol vocabulary, regexes and input caps (an external interface, atobrief/USMTF-defined; ATO field layouts are [SOURCE-DEFINED] but are a parser, not a tunable) |
| efsp/block-map.js:27 | `DEPARTURE_BLOCK_MAP` | `{ '1': { required: true, target: { kind: 'fdr', …` | DOCT | guide Block definitions (departure/arrival/overflight/mission/carrier), partly [SOURCE-DEFINED] |
| efsp/block-map.js:244 | `ARRIVAL_BLOCK_MAP` | `{ '1': { required: true, target: { kind: 'fdr', …` | DOCT | guide Block definitions (departure/arrival/overflight/mission/carrier), partly [SOURCE-DEFINED] |
| efsp/block-map.js:315 | `OVERFLIGHT_BLOCK_MAP` | `{ '1': { required: true, target: { kind: 'fdr', …` | DOCT | guide Block definitions (departure/arrival/overflight/mission/carrier), partly [SOURCE-DEFINED] |
| efsp/block-map.js:395 | `MISSION_BLOCK_MAP` | `{ 'M1': { required: true, target: { kind: 'fdr',…` | DOCT | guide Block definitions (departure/arrival/overflight/mission/carrier), partly [SOURCE-DEFINED] |
| efsp/block-map.js:446 | `_CARRIER_CHROME` | `{ '2': { required: true, target: { kind: 'system…` | DOCT | guide Block definitions (departure/arrival/overflight/mission/carrier), partly [SOURCE-DEFINED] |
| efsp/block-map.js:534 | `MILITARY_BLOCK_NAMESPACE` | `{ M9: { field: 'military.altrvRef', blockId: nul…` | DOCT | guide Block definitions (departure/arrival/overflight/mission/carrier), partly [SOURCE-DEFINED] |
| efsp/board-store.js:39 | `DEPARTURE_AIRBORNE_STATES` | `['DEPARTED', 'HANDED_OFF']` | DOCT | state machine facts |
| efsp/board-store.js:41 | `FLAG_KEYS` | `['offset', 'flipped', 'removeIndicator', 'highli…` | ENG | Strip flag key list |
| efsp/board-store.js:42 | `APPLIED_MUTATIONS_CAP` | `5000` | ENG | dedupe ring size (memory bound) |
| efsp/board-store.js:48 | `REPLAY_PERSIST_WINDOW_MS` | `10 * 60 * 1000` | ENG | how long a replay record is persisted across restart (10 min); memory/restart trade-off, a constant per its comment |
| efsp/board-store.js:58 | `REPLICA_STATE_ON_RECEIPT` | `{ OVERFLIGHT: { IN_SECTOR: 'INBOUND' } }` | DOCT | state machine facts |
| efsp/board-store.js:61 | `SENDER_STATE_ON_ACCEPT` | `{ HANDOFF: { OVERFLIGHT: { IN_SECTOR: 'HANDED_OF…` | DOCT | state machine facts |
| efsp/board-store.js:63 | `DEFAULT_INITIAL_STATE_BY_ROLE` | `{ DEPARTURE: 'PROPOSED', ARRIVAL: 'INBOUND', OVE…` | DOCT | state machine facts |
| efsp/carrier/flight-record.js:36 | `APPROACH_TYPES` | `Object.freeze(['TACAN', 'ICLS', 'ACLS', 'PAR', '…` | UNCL | [SOURCE-DEFINED] carrier vocabulary / validation range: squadron-specific values (approach types, button range) but no tuning intent; DOCT or TUNE? |
| efsp/carrier/flight-record.js:37 | `APPROACH_BUTTON_MIN` | `1` | UNCL | [SOURCE-DEFINED] carrier vocabulary / validation range: squadron-specific values (approach types, button range) but no tuning intent; DOCT or TUNE? |
| efsp/carrier/flight-record.js:38 | `APPROACH_BUTTON_MAX` | `20` | UNCL | [SOURCE-DEFINED] carrier vocabulary / validation range: squadron-specific values (approach types, button range) but no tuning intent; DOCT or TUNE? |
| efsp/carrier/flight-record.js:39 | `FUEL_MAX_LB` | `100000` | UNCL | [SOURCE-DEFINED] carrier vocabulary / validation range: squadron-specific values (approach types, button range) but no tuning intent; DOCT or TUNE? |
| efsp/carrier/flight-record.js:40 | `BINGO_FIELD_MAX_LEN` | `32` | ENG | message wording / field lists / length caps |
| efsp/carrier/flight-record.js:42 | `RULE_6` | `'store the approach button, not a frequency (§9.…` | ENG | message wording / field lists / length caps |
| efsp/carrier/flight-record.js:152 | `MARSHAL_MESSAGE_FIELDS` | `Object.freeze([ Object.freeze({ key: 'callsign',…` | ENG | message wording / field lists / length caps |
| efsp/carrier/hull-config.js:21 | `CARRIERS_FILE` | `'efsp-carriers.json'` | ENG | config file name |
| efsp/carrier/marshal-stack.js:45 | `ENTRY_KEYS` | `Object.freeze(['fdrId', 'stackIndex', 'status', …` | ENG | key lists / op kinds / messages |
| efsp/carrier/marshal-stack.js:46 | `STACK_KEYS` | `Object.freeze(['stackId', 'hullId', 'charlieTime…` | ENG | key lists / op kinds / messages |
| efsp/carrier/marshal-stack.js:47 | `ENTRY_STATUSES` | `Object.freeze(['HOLDING', 'PUSHED'])` | ENG | key lists / op kinds / messages |
| efsp/carrier/marshal-stack.js:48 | `STACK_DEFAULTS` | `Object.freeze({ maxIndex: 19 })` | UNCL | marshal maxIndex 19 [SOURCE-DEFINED] (angels 25, DME 40): squadron carrier-ops data (DATA, per hull?) or doctrine table? |
| efsp/carrier/marshal-stack.js:49 | `DEFAULT_STACK_ID` | `'MAIN'` | ENG | one stack in v1 (H29); an id |
| efsp/carrier/marshal-stack.js:52 | `MIN_ANGELS` | `6` | DOCT | guide §9.12 numbers (case I sanity ceiling 20 is [SOURCE-DEFINED]) |
| efsp/carrier/marshal-stack.js:53 | `DME_PLUS` | `15` | DOCT | guide §9.12 numbers (case I sanity ceiling 20 is [SOURCE-DEFINED]) |
| efsp/carrier/marshal-stack.js:54 | `PUSH_SPACING_MS` | `60_000` | DOCT | guide §9.12 numbers (case I sanity ceiling 20 is [SOURCE-DEFINED]) |
| efsp/carrier/marshal-stack.js:55 | `PUSH_TOLERANCE_MS` | `10_000` | TUNE | [SOURCE-DEFINED] tolerances (L4 briefing Q3) |
| efsp/carrier/marshal-stack.js:57 | `CASE_I_MIN_ANGELS` | `2` | DOCT | guide §9.12 numbers (case I sanity ceiling 20 is [SOURCE-DEFINED]) |
| efsp/carrier/marshal-stack.js:58 | `CASE_I_MAX_ANGELS` | `20` | DOCT | guide §9.12 numbers (case I sanity ceiling 20 is [SOURCE-DEFINED]) |
| efsp/carrier/marshal-stack.js:59 | `RADIAL_TOLERANCE_DEG` | `15` | TUNE | [SOURCE-DEFINED] tolerances (L4 briefing Q3) |
| efsp/carrier/marshal-stack.js:63 | `DERIVED_KEYS` | `Object.freeze([ 'angels', 'marshalDme', 'pushTim…` | ENG | key lists / op kinds / messages |
| efsp/carrier/marshal-stack.js:67 | `DERIVED_DETAIL` | `'angels/DME/push time are derived from the stack…` | ENG | key lists / op kinds / messages |
| efsp/carrier/marshal-stack.js:69 | `STACK_OP_KINDS` | `Object.freeze([ 'InsertAt', 'Append', 'Move', 'R…` | ENG | key lists / op kinds / messages |
| efsp/carrier/recovery-case.js:25 | `CASES` | `Object.freeze(['I', 'II', 'III'])` | DOCT | Case I/II/III set, legal transitions, ranks (guide §9.12) |
| efsp/carrier/recovery-case.js:30 | `LEGAL_CASE_TRANSITIONS` | `Object.freeze({ I: Object.freeze(['II', 'III']),…` | DOCT | Case I/II/III set, legal transitions, ranks (guide §9.12) |
| efsp/carrier/recovery-case.js:36 | `DEFAULT_CASE` | `'III'` | UNCL | "III" [SOURCE-DEFINED] (most restrictive default). Doctrine default or squadron setting? |
| efsp/carrier/recovery-case.js:39 | `RANK` | `Object.freeze({ I: 1, II: 2, III: 3 })` | DOCT | Case I/II/III set, legal transitions, ranks (guide §9.12) |
| efsp/carrier/ship-state.js:36 | `SHIP_CATEGORY` | `4` | ENG | unit conversion / DCS enum / wire key list |
| efsp/carrier/ship-state.js:37 | `MS_TO_KT` | `1.943844` | ENG | unit conversion / DCS enum / wire key list |
| efsp/carrier/ship-state.js:38 | `PA_PER_INHG` | `3386.389` | ENG | unit conversion / DCS enum / wire key list |
| efsp/carrier/ship-state.js:39 | `ALTIMETER_MIN_INHG` | `27.0` | ENG | altimeter sanity band [SOURCE-DEFINED]; validation bound |
| efsp/carrier/ship-state.js:40 | `ALTIMETER_MAX_INHG` | `32.0` | ENG | altimeter sanity band [SOURCE-DEFINED]; validation bound |
| efsp/carrier/ship-state.js:45 | `ANGLED_DECK_BY_TYPE` | `Object.freeze({ CVN_71: 9, CVN_72: 9, CVN_73: 9,…` | UNCL | per-DCS-ship-type angle [SOURCE-DEFINED]: reference data about ship models (DATA, could join efsp-carriers.json) or an engineering table? Kept in code until ruled |
| efsp/carrier/ship-state.js:49 | `DEFAULT_HULL` | `Object.freeze({ hullId: 'CVN-72', label: 'CVN-72…` | DATA | duplicates config/efsp-carriers.json hull; this lane removes it (moves) |
| efsp/carrier/ship-state.js:56 | `SHIP_INPUT_KEYS` | `Object.freeze(['altimeterInHg'])` | ENG | unit conversion / DCS enum / wire key list |
| efsp/carrier/sun.js:13 | `NIGHT_BELOW_DEG` | `-6` | UNCL | night = sun below -6 deg [SOURCE-DEFINED]: definition of night; DOCT or TUNE? |
| efsp/carrier/transfer-effects.js:13 | `CARRIER_TRANSFER_EFFECTS` | `Object.freeze({ MARSHAL_TO_APPROACH: Object.free…` | DOCT | carrier transfer/trigger tables, [SOURCE-DEFINED] where the guide is silent |
| efsp/carrier/transfers.js:33 | `TRIGGER_TYPES` | `Object.freeze(['CONTROLLER_INITIATED', 'RADAR_AC…` | DOCT | carrier transfer/trigger tables, [SOURCE-DEFINED] where the guide is silent |
| efsp/carrier/transfers.js:35 | `APP_LANES` | `Object.freeze(['CV_APP1', 'CV_APP2'])` | DOCT | carrier transfer/trigger tables, [SOURCE-DEFINED] where the guide is silent |
| efsp/carrier/transfers.js:93 | `GUIDE_TRANSFER_KINDS` | `Object.freeze(['MARSHAL_TO_APPROACH', 'APPROACH_…` | DOCT | carrier transfer/trigger tables, [SOURCE-DEFINED] where the guide is silent |
| efsp/carrier-store.js:40 | `TRANSITIONS_CAP` | `200` | ENG | history ring size |
| efsp/carrier-store.js:41 | `SHIP_OP` | `'SetShipInput'` | ENG | op names |
| efsp/carrier-store.js:42 | `CASE_OP` | `'SetCase'` | ENG | op names |
| efsp/clearance-migration.js:9 | `CLEARANCE_BLOCKS_BY_ROLE` | `{ DEPARTURE: { '21': 'altitude', '20': 'heading'…` | DOCT | legacy restore maps; BACKCOMPAT deletes them (H88) |
| efsp/code-allocator.js:28 | `RESERVED_CODES` | `new Set(['0000', '7500', '7600', '7700', '7400',…` | DOCT | squawk code doctrine (7500/7600/7700 etc.) |
| efsp/code-allocator.js:29 | `MONITOR_SET` | `new Set(['1200', '1202', '1203', '1255', '1277']…` | DOCT | squawk code doctrine (7500/7600/7700 etc.) |
| efsp/code-allocator.js:45 | `SYNTHETIC_BLOCK_START` | `0o6000` | UNCL | where synthetic Mode 3 codes are drawn (octal 6000-6777): [SOURCE-DEFINED] numbering plan; ENG or TUNE? |
| efsp/code-allocator.js:46 | `SYNTHETIC_BLOCK_SIZE` | `0o1000` | UNCL | where synthetic Mode 3 codes are drawn (octal 6000-6777): [SOURCE-DEFINED] numbering plan; ENG or TUNE? |
| efsp/conformance.js:34 | `MS_PER_KT` | `0.514444` | ENG | unit conversion (repeated in airborne.js, conformance.js, stca.js, radars.js) |
| efsp/conformance.js:35 | `FPM_PER_MS` | `196.850394` | ENG | unit conversion (repeated in airborne.js, conformance.js, stca.js, radars.js) |
| efsp/coordination.js:34 | `COORDINATION_PRIMITIVES` | `new Set(['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPE…` | DOCT | coordination primitives, effects, eligible states |
| efsp/coordination.js:36 | `COORDINATION_EFFECTS` | `{ HANDOFF: { radarIdTransfers: true, commsTransf…` | DOCT | coordination primitives, effects, eligible states |
| efsp/coordination.js:70 | `COORDINATION_ELIGIBLE_STATES` | `{ ARRIVAL: 'INBOUND', DEPARTURE: 'HANDED_OFF', O…` | DOCT | coordination primitives, effects, eligible states |
| efsp/coordination.js:86 | `TOFI_EFFECTS` | `{ ENTRY: { acceptPhrase: 'TOFI ACKNOWLEDGED — EN…` | DOCT | coordination primitives, effects, eligible states |
| efsp/coordination.js:108 | `TOFI_ELIGIBLE_STATES` | `{ DEPARTURE: 'HANDED_OFF', ARRIVAL: 'INBOUND', O…` | DOCT | coordination primitives, effects, eligible states |
| efsp/correlation-match.js:38 | `AFFINITY_EXACT` | `1.0` | UNCL | callsign affinity weights 1.0/0.9/0.8/0.7. Its comment says deliberately not config (ADR 0041 lesson), H88 says tunables go to JSON. Which wins? |
| efsp/correlation-match.js:39 | `AFFINITY_FORMATION` | `0.9` | UNCL | callsign affinity weights 1.0/0.9/0.8/0.7. Its comment says deliberately not config (ADR 0041 lesson), H88 says tunables go to JSON. Which wins? |
| efsp/correlation-match.js:40 | `AFFINITY_SUFFIXED` | `0.8` | UNCL | callsign affinity weights 1.0/0.9/0.8/0.7. Its comment says deliberately not config (ADR 0041 lesson), H88 says tunables go to JSON. Which wins? |
| efsp/correlation-match.js:41 | `AFFINITY_SAME_STEM` | `0.7` | UNCL | callsign affinity weights 1.0/0.9/0.8/0.7. Its comment says deliberately not config (ADR 0041 lesson), H88 says tunables go to JSON. Which wins? |
| efsp/correlation-reconciler.js:33 | `CORRELATION_TICK_MS` | `1000` | ENG | tick period / log-spam floors |
| efsp/correlation-reconciler.js:37 | `CORRELATION_RATE_TARGET` | `0.95` | DOCT | guide §6.6 rule 6 target (95%) |
| efsp/correlation-reconciler.js:42 | `RATE_WARN_MIN_ELIGIBLE` | `3` | ENG | tick period / log-spam floors |
| efsp/correlation-reconciler.js:43 | `RATE_WARN_INTERVAL_MS` | `60000` | ENG | tick period / log-spam floors |
| efsp/correlation-reconciler.js:54 | `INELIGIBLE_STATES` | `new Set([ // Pre-movement: the aircraft may not …` | DOCT | states with no contact to find |
| efsp/correlation-store.js:43 | `CORRELATION_STATES` | `['CORRELATED', 'PROVISIONAL', 'UNCORRELATED']` | DOCT | correlation state/enum vocabularies |
| efsp/correlation-store.js:46 | `MATCH_KEYS` | `['BINDING', 'BEACON', 'CALLSIGN_EXACT', 'CALLSIG…` | DOCT | correlation state/enum vocabularies |
| efsp/correlation-store.js:48 | `WARNING_KINDS` | `[ 'TRACK_IDENTITY_LOST', // the bound contact's …` | DOCT | correlation state/enum vocabularies |
| efsp/correlation-store.js:55 | `TRANSITION_REASONS` | `[ 'FIRST_MATCH', 'REBOUND_ON_BEACON', 'REBOUND_O…` | DOCT | correlation state/enum vocabularies |
| efsp/correlation-store.js:62 | `INITIAL_STATE` | `'UNCORRELATED'` | DOCT | correlation state/enum vocabularies |
| efsp/efsp-ws.js:45 | `RESYNC_RING_WINDOW` | `900` | ENG | resync ring size (protocol buffer) |
| efsp/facility-config.js:40 | `DEFAULT_FACILITY_ID` | `'INCIRLIK'` | UNCL | which Facility a client lands on by default: facility data, but also a code default; DATA-1 owns the file |
| efsp/facility-config.js:76 | `DERIVED_FACILITY_IDS` | `new Set(['RANGES'])` | ENG | schema vocabulary (view names, descriptor keys, selector kinds) |
| efsp/facility-config.js:78 | `DEFAULT_CONFIG` | `{ facility: 'INCIRLIK', positions: ['OPS', 'CD',…` | DATA | facility literals; DATA-1 removes them (not mine) |
| efsp/facility-config.js:298 | `DEFAULT_CENTER_CONFIG` | `{ facility: 'CENTER', positions: ['CTR'], positi…` | DATA | facility literals; DATA-1 removes them (not mine) |
| efsp/facility-config.js:347 | `DEFAULT_TACTICAL_CONFIG` | `{ facility: 'TACTICAL', positions: ['TAC_C2', 'A…` | DATA | facility literals; DATA-1 removes them (not mine) |
| efsp/facility-config.js:440 | `_CVN` | `{ kind: 'carrier', coalition: 'own', hull: 'CVN-…` | DATA | facility literals; DATA-1 removes them (not mine) |
| efsp/facility-config.js:590 | `BAY_VIEWS` | `Object.freeze(['pattern', 'final', 'sfa-freqs'])` | ENG | schema vocabulary (view names, descriptor keys, selector kinds) |
| efsp/facility-config.js:592 | `BAY_DESCRIPTOR_KEYS` | `Object.freeze(['bayId', 'rackIds', 'impliesState…` | ENG | schema vocabulary (view names, descriptor keys, selector kinds) |
| efsp/facility-config.js:618 | `SFA_MIN_MHZ` | `225` | DATA | SFA UHF pool range/min size [SOURCE-DEFINED]: squadron frequency data; DATA-1 owns the file |
| efsp/facility-config.js:619 | `SFA_MAX_MHZ` | `399.975` | DATA | SFA UHF pool range/min size [SOURCE-DEFINED]: squadron frequency data; DATA-1 owns the file |
| efsp/facility-config.js:620 | `SFA_MIN_POOL` | `5` | DATA | SFA UHF pool range/min size [SOURCE-DEFINED]: squadron frequency data; DATA-1 owns the file |
| efsp/facility-config.js:684 | `RADAR_SELECTOR_KINDS` | `new Set(['airport', 'approach', 'awacs', 'fighte…` | ENG | schema vocabulary (view names, descriptor keys, selector kinds) |
| efsp/fdr-store.js:34 | `VOID_DEADLINE_MINUTES` | `30` | DOCT | guide §3.8 / §4.6.2 values (cited) |
| efsp/fdr-store.js:35 | `EDCT_WINDOW_MINUTES` | `5` | DOCT | guide §3.8 / §4.6.2 values (cited) |
| efsp/fdr-store.js:36 | `CALL_FOR_RELEASE_BEFORE_MINUTES` | `2` | DOCT | guide §3.8 / §4.6.2 values (cited) |
| efsp/fdr-store.js:37 | `CALL_FOR_RELEASE_AFTER_MINUTES` | `1` | DOCT | guide §3.8 / §4.6.2 values (cited) |
| efsp/fdr-store.js:44 | `RELEASE_STATES` | `new Set(['RELEASED', 'HOLD_FOR_RELEASE', 'RELEAS…` | DOCT | FDR enums, writable-path set, labels (guide-derived) |
| efsp/fdr-store.js:45 | `DEGRADATION_STATES` | `new Set(['NONE', 'TRANSPONDER_FAILED', 'MODE_C_F…` | DOCT | FDR enums, writable-path set, labels (guide-derived) |
| efsp/fdr-store.js:46 | `DATALINK_INDICATOR_STATES` | `new Set(['NONE', 'ISSUED'])` | DOCT | FDR enums, writable-path set, labels (guide-derived) |
| efsp/fdr-store.js:53 | `TRACK_DEGRADATION_FLAGS` | `new Set(['NONE', 'CST', 'FAIL', 'IF', 'NT', 'TRK…` | DOCT | FDR enums, writable-path set, labels (guide-derived) |
| efsp/fdr-store.js:57 | `AIRSPACE_OWNERS` | `new Set(['CONTROLLING_AGENCY', 'USING_AGENCY'])` | DOCT | FDR enums, writable-path set, labels (guide-derived) |
| efsp/fdr-store.js:62 | `RADAR_SERVICE_STATES` | `new Set(['ACTIVE', 'TERMINATED'])` | DOCT | FDR enums, writable-path set, labels (guide-derived) |
| efsp/fdr-store.js:63 | `SEPARATION_REGIMES` | `new Set(['ATC', 'MARSA', 'USING_AGENCY', 'DUE_RE…` | DOCT | FDR enums, writable-path set, labels (guide-derived) |
| efsp/fdr-store.js:68 | `ORDNANCE_STATES` | `new Set(['CLEAN', 'LOADED', 'HUNG', 'EXPENDED'])` | DOCT | FDR enums, writable-path set, labels (guide-derived) |
| efsp/fdr-store.js:69 | `ALERT_STATUSES` | `new Set(['NONE', 'ALERT', 'SCRAMBLE'])` | DOCT | FDR enums, writable-path set, labels (guide-derived) |
| efsp/fdr-store.js:71 | `CALLSIGN_RE` | `/^[A-Za-z0-9]{1,7}$/` | ENG | callsign shape (also ato-board, ato-sets, callsign-fit): protocol/format |
| efsp/fdr-store.js:80 | `MAX_FREE_TEXT` | `2000` | ENG | free-text cap (also in stereo-routes, usmtf-tokenize) |
| efsp/fdr-store.js:116 | `WRITABLE_PATHS` | `new Set([ 'identity.callsign', 'identity.flightS…` | DOCT | FDR enums, writable-path set, labels (guide-derived) |
| efsp/fdr-store.js:237 | `MILITARY_WRITABLE_FIELDS` | `new Set(['ordnanceState', 'hookRequired', 'alert…` | DOCT | FDR enums, writable-path set, labels (guide-derived) |
| efsp/fdr-store.js:271 | `CLEARANCE_FIELDS` | `new Set(['altitude', 'heading'])` | DOCT | FDR enums, writable-path set, labels (guide-derived) |
| efsp/fdr-store.js:377 | `TYPED_TIME_LABELS` | `{ 'filed.proposedDepartureTimeUtc': 'proposed de…` | DOCT | FDR enums, writable-path set, labels (guide-derived) |
| efsp/fdr-store.js:394 | `WINDOW_END_OF` | `{ 'mission.vulWindowEndUtc': 'mission.vulWindowS…` | DOCT | FDR enums, writable-path set, labels (guide-derived) |
| efsp/field-state-store.js:43 | `REQUEST_EFFECTS` | `{ CLOSE: { from: 'OPEN', op: 'CloseRunway' }, OP…` | DOCT | runway/field state machine, gear types, wordings (some [SOURCE-DEFINED]) |
| efsp/field-state-store.js:49 | `REQUEST_VERBS` | `{ CLOSE: 'close', OPEN: 'open', WORKS: 'suspend …` | DOCT | runway/field state machine, gear types, wordings (some [SOURCE-DEFINED]) |
| efsp/field-state-store.js:53 | `SYSTEM_ACTOR` | `'crc-sync'` | DOCT | runway/field state machine, gear types, wordings (some [SOURCE-DEFINED]) |
| efsp/field-state.js:29 | `RUNWAY_STATUSES` | `['OPEN', 'CLOSED', 'SUSPENDED_WORKS', 'SUSPENDED…` | DOCT | runway/field state machine, gear types, wordings (some [SOURCE-DEFINED]) |
| efsp/field-state.js:40 | `LEGAL_TRANSITIONS` | `{ OPEN: ['CLOSED', 'SUSPENDED_WORKS', 'SUSPENDED…` | DOCT | runway/field state machine, gear types, wordings (some [SOURCE-DEFINED]) |
| efsp/field-state.js:56 | `SUSPENSION_KINDS` | `['WORKS', 'RUNWAY_CHANGE']` | DOCT | runway/field state machine, gear types, wordings (some [SOURCE-DEFINED]) |
| efsp/field-state.js:63 | `GEAR_TYPES` | `['BAK_12', 'E_5', 'OTHER']` | DOCT | runway/field state machine, gear types, wordings (some [SOURCE-DEFINED]) |
| efsp/field-state.js:64 | `GEAR_POSITIONS` | `['APPROACH_END', 'DEPARTURE_END', 'OVERRUN']` | DOCT | runway/field state machine, gear types, wordings (some [SOURCE-DEFINED]) |
| efsp/field-state.js:65 | `GEAR_STATES` | `['UP', 'DOWN', 'OUT_OF_SERVICE']` | DOCT | runway/field state machine, gear types, wordings (some [SOURCE-DEFINED]) |
| efsp/field-state.js:69 | `RUNWAY_CHANGE_STATES` | `['PROPOSED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'PEN…` | DOCT | runway/field state machine, gear types, wordings (some [SOURCE-DEFINED]) |
| efsp/field-state.js:70 | `RUNWAY_CHANGE_OPEN_STATES` | `['PROPOSED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'PEN…` | DOCT | runway/field state machine, gear types, wordings (some [SOURCE-DEFINED]) |
| efsp/field-state.js:84 | `REQUEST_ACTIONS` | `['CLOSE', 'OPEN', 'WORKS']` | DOCT | runway/field state machine, gear types, wordings (some [SOURCE-DEFINED]) |
| efsp/field-state.js:203 | `RUNWAY_GATED_STATES` | `Object.freeze({ DEPARTURE: Object.freeze(['RUNWA…` | DOCT | runway/field state machine, gear types, wordings (some [SOURCE-DEFINED]) |
| efsp/field-state.js:210 | `SUSPENSION_LABELS` | `{ WORKS: 'works in progress', RUNWAY_CHANGE: 'ru…` | DOCT | runway/field state machine, gear types, wordings (some [SOURCE-DEFINED]) |
| efsp/flight-plan-lookup.js:27 | `LOOKUP_TIMEOUT_MS` | `3000` | ENG | timeout of the call to sourcedcs-web (3 s); a network timeout, though arguably TUNE |
| efsp/forwarding-obligations.js:23 | `ADVANCE_FORWARDING_MINUTES` | `15` | DOCT | guide §4.6.1 minutes (cited) |
| efsp/forwarding-obligations.js:24 | `ETA_REVISION_THRESHOLD_MINUTES` | `3` | DOCT | guide §4.6.1 minutes (cited) |
| efsp/forwarding-obligations.js:25 | `AMENDMENT_WINDOW_MINUTES` | `30` | DOCT | guide §4.6.1 minutes (cited) |
| efsp/forwarding-obligations.js:26 | `DATA_ONLY_VERIFICATION_MINUTES` | `3` | DOCT | guide §4.6.1 minutes (cited) |
| efsp/index.js:426 | `LOG_TAIL_SLACK_MS` | `60 * 1000` | ENG | log-tail slack |
| efsp/instrumentation-config.js:21 | `CONFIG_NAME` | `'efsp-instrumentation.json'` | ENG | config file name |
| efsp/marsa-store.js:53 | `MARSA_STATES` | `['ACTIVE', 'ENDED', 'VOIDED']` | DOCT | MARSA states/events/causes; MIN_PARTICIPANTS 2 |
| efsp/marsa-store.js:56 | `START_EVENTS` | `['TANKER_ACCEPTED', 'MTR_ENTRY', 'LOCAL_DECLARAT…` | DOCT | MARSA states/events/causes; MIN_PARTICIPANTS 2 |
| efsp/marsa-store.js:57 | `END_CONDITIONS` | `['VERTICALLY_POSITIONED', 'MTR_COMPLETE', 'ATC_S…` | DOCT | MARSA states/events/causes; MIN_PARTICIPANTS 2 |
| efsp/marsa-store.js:58 | `VOID_CAUSES` | `['CONTROLLER_COURSE_CHANGE', 'CONTROLLER_ALTITUD…` | DOCT | MARSA states/events/causes; MIN_PARTICIPANTS 2 |
| efsp/marsa-store.js:65 | `END_CAUSES` | `['END_CONDITION', 'PARTICIPANT_RETIRED']` | DOCT | MARSA states/events/causes; MIN_PARTICIPANTS 2 |
| efsp/marsa-store.js:70 | `MARSA_EXPANSION` | `'Military Authority Assumes Responsibility for S…` | DOCT | MARSA states/events/causes; MIN_PARTICIPANTS 2 |
| efsp/marsa-store.js:74 | `MIN_PARTICIPANTS` | `2` | DOCT | MARSA states/events/causes; MIN_PARTICIPANTS 2 |
| efsp/marsa-store.js:76 | `TRANSITION_REASONS` | `[ 'DECLARED', 'RENDEZVOUS', 'PARTICIPANT_ADDED',…` | DOCT | MARSA states/events/causes; MIN_PARTICIPANTS 2 |
| efsp/metrics.js:54 | `VERSION` | `1` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/metrics.js:55 | `HOUR_MS` | `60 * 60 * 1000` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/metrics.js:57 | `TTF_SAMPLE_CAP` | `500` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/metrics.js:58 | `TIME_TO_FIND_TARGET_MS` | `3000` | DOCT | guide §11 success targets (cited) |
| efsp/metrics.js:59 | `CORRELATION_TARGET` | `0.95` | DOCT | guide §11 success targets (cited) |
| efsp/metrics.js:60 | `TRANSFER_FAILURE_TARGET` | `0.005` | DOCT | guide §11 success targets (cited) |
| efsp/metrics.js:61 | `GESTURES` | `Object.freeze(['OFFSET', 'FLIP', 'HIGHLIGHT', 'A…` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/metrics.js:64 | `FLAG_TO_GESTURE` | `Object.freeze({ offset: 'OFFSET', flipped: 'FLIP…` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/metrics.js:65 | `TRANSFER_KINDS` | `Object.freeze(['TRANSFER', 'NLA_TRANSFER'])` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/metrics.js:66 | `KNOWN_SOURCES` | `Object.freeze(['client', 'staleness'])` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/metrics.js:67 | `MAX_EVENTS_PER_REPORT` | `100` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/metrics.js:68 | `MAX_LATENCY_MS` | `600000` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/metrics.js:69 | `MAX_GESTURE_INPUTS` | `50` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/metrics.js:70 | `MUTATION_DEDUPE_CAP` | `5000` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/metrics.js:71 | `REPORT_DEDUPE_CAP` | `1000` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/metrics.js:72 | `SESSIONS_LISTED` | `50` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/metrics.js:73 | `MAX_WINDOW_HOURS` | `720` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/metrics.js:74 | `MINUTE_MS` | `60 * 1000` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/metrics.js:76 | `SESSION_RECORDS_KEPT` | `50` | ENG | sample / dedupe / report caps, bucket sizes, enums |
| efsp/mutation-log.js:33 | `DAY_MS` | `24 * 60 * 60 * 1000` | ENG | unit (ms per day), repeated in 5 files |
| efsp/nla.js:51 | `DEPARTURE_STATES` | `[ 'PROPOSED', 'PENDING_CLEARANCE', 'CLEARED', 'H…` | DOCT | per-role state machines and clearance labels (guide §3.4/3.5, [SOURCE-DEFINED] where silent) |
| efsp/nla.js:63 | `ARRIVAL_STATES` | `['INBOUND', 'HANDED_TO_TOWER', 'FINAL', 'LANDED'…` | DOCT | per-role state machines and clearance labels (guide §3.4/3.5, [SOURCE-DEFINED] where silent) |
| efsp/nla.js:72 | `OVERFLIGHT_STATES` | `['INBOUND', 'IN_SECTOR', 'HANDED_OFF', 'DROPPED'…` | DOCT | per-role state machines and clearance labels (guide §3.4/3.5, [SOURCE-DEFINED] where silent) |
| efsp/nla.js:81 | `MISSION_STATES` | `['TASKED', 'AIRBORNE', 'ON_STATION', 'OFF_STATIO…` | DOCT | per-role state machines and clearance labels (guide §3.4/3.5, [SOURCE-DEFINED] where silent) |
| efsp/nla.js:95 | `MARSHAL_STATES` | `['LAUNCH', 'IN_STACK', 'COMMENCED', 'DROPPED']` | DOCT | per-role state machines and clearance labels (guide §3.4/3.5, [SOURCE-DEFINED] where silent) |
| efsp/nla.js:97 | `FINAL_STATES` | `['ON_FINAL', 'BALL', 'BOLTER_WAVEOFF', 'DROPPED'…` | DOCT | per-role state machines and clearance labels (guide §3.4/3.5, [SOURCE-DEFINED] where silent) |
| efsp/nla.js:99 | `PATTERN_STATES` | `['IN_PATTERN', 'RECOVERED', 'DROPPED']` | DOCT | per-role state machines and clearance labels (guide §3.4/3.5, [SOURCE-DEFINED] where silent) |
| efsp/nla.js:124 | `REQUIRED_FOR_CLEARANCE` | `['route', 'requestedAltitude', 'departureAirport…` | DOCT | per-role state machines and clearance labels (guide §3.4/3.5, [SOURCE-DEFINED] where silent) |
| efsp/nla.js:138 | `CLEARANCE_BLOCK_LABELS` | `{ requestedAltitude: 'ALT', // Block 7 departure…` | DOCT | per-role state machines and clearance labels (guide §3.4/3.5, [SOURCE-DEFINED] where silent) |
| efsp/nla.js:144 | `CLEARANCE_LABEL_ORDER` | `['requestedAltitude', 'departureAirport', 'desti…` | DOCT | per-role state machines and clearance labels (guide §3.4/3.5, [SOURCE-DEFINED] where silent) |
| efsp/nla.js:171 | `WINDOWED_RELEASE_STATES` | `{ EDCT: { startKey: 'edctWindowStartUtc', endKey…` | DOCT | per-role state machines and clearance labels (guide §3.4/3.5, [SOURCE-DEFINED] where silent) |
| efsp/order-key.js:30 | `ALPHA` | `'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk…` | ENG | fractional-index alphabet |
| efsp/order-key.js:160 | `REBALANCE_KEY_LENGTH` | `40` | ENG | rebalance key length threshold |
| efsp/overflight-migration.js:11 | `LEGACY_OVERFLIGHT_STATE` | `{ TRANSITING: 'IN_SECTOR' }` | DOCT | legacy restore maps; BACKCOMPAT deletes them (H88) |
| efsp/permission.js:55 | `OP_KINDS` | `[ 'CreateStrip', 'MoveStrip', 'SetBlock', 'Trans…` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:85 | `COORDINATION_OP_KINDS` | `['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL…` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:92 | `APP_CTR_ONLY_OP_KINDS` | `['ConvertToArrival']` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:99 | `AIRSPACE_ENTRY_OP_KINDS` | `['ApproveAirspaceEntry', 'ClearAirspaceEntry']` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:105 | `TOFI_OP_KINDS` | `['TOFI']` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:121 | `MRU_OR_NON_ATC_CLASSES` | `new Set(['MRU', 'MRU_POSITION', 'NON_ATC'])` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:138 | `NO_STRIP_OP_CLASSES` | `new Set(['USING_AGENCY'])` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:147 | `NO_SCOPE_CLASSES` | `new Set(['NON_ATC'])` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:230 | `CREATE_ROLE_PERMISSIONS` | `{ OPS: new Set(['DEPARTURE']), // docs/adr/0023 …` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:413 | `CARRIER_CAPABILITIES` | `{ CV_MARSHAL: { setsCase: false, sequencesStack:…` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:457 | `FIELD_STATE_OP_OWNERS` | `{ CloseRunway: ['TWR'], OpenRunway: ['TWR'], Beg…` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:499 | `READ_SCOPES` | `['ALL', 'OWNED']` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:500 | `TACTICAL_CAPABILITIES` | `{ AIC: { handBackTo: ['TAC_C2'], tofiAnsweredBy:…` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:537 | `TOFI_ANSWER_ACTIONS` | `['ACCEPT', 'REJECT', 'TRANSFER_COMMS']` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:538 | `NON_OWNER_BLOCK_WRITES` | `[ { blockId: '14E', role: 'DEPARTURE', positions…` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:584 | `DEPARTURE_STATE_OWNERS` | `{ PROPOSED: ['OPS'], PENDING_CLEARANCE: ['CD'], …` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:610 | `ARRIVAL_STATE_OWNERS` | `{ // CTR added (docs/adr/0014) — a CENTER-held I…` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:629 | `OVERFLIGHT_STATE_OWNERS` | `{ INBOUND: ['APP', 'CTR'], IN_SECTOR: ['APP', 'C…` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:644 | `MISSION_STATE_OWNERS` | `{ TASKED: ['TAC_C2', 'GCI'], AIRBORNE: ['TAC_C2'…` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:659 | `CV_LANES` | `['CV_APP1', 'CV_APP2']` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:670 | `PATTERN_STATE_OWNERS` | `{ IN_PATTERN: ['CV_PRIFLY'], RECOVERED: ['CV_PRI…` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/permission.js:703 | `TOFI_COUNTERPARTS` | `{ CTR: [{ facilityId: 'TACTICAL', positionId: 'T…` | DOCT | authority tables. NOTE they embed Position ids (OPS, CD, TWR, TAC_C2, CV_*): that is facility topology inside doctrine; see the unclear note |
| efsp/read-scope.js:16 | `ALL` | `'ALL'` | ENG | enum |
| efsp/read-scope.js:17 | `OWNED` | `'OWNED'` | ENG | enum |
| efsp/replay-cache.js:18 | `REPLAY_CACHE_CAP` | `5000` | ENG | cache size |
| efsp/sfa-store.js:28 | `TRANSITIONS_CAP` | `100` | ENG | history ring size |
| efsp/sfa-store.js:29 | `SET_OP` | `'SetSfaRotation'` | ENG | op name |
| efsp/sfa.js:29 | `SFA_TRANSFERS` | `Object.freeze({ SFA_ROTATION: Object.freeze({ tr…` | DOCT | SFA rotation transfer table |
| efsp/station-coverage.js:34 | `ATC_CLASSES` | `new Set(['MILITARY_ATC', 'CIVIL_ATC'])` | ENG | sweep-beam/LOS cache sizes; render-fidelity knobs |
| efsp/stereo-routes.js:52 | `MAX_FREE_TEXT` | `2000` | ENG | input length cap (same value as fdr-store) |
| efsp/stereo-routes.js:54 | `OPTIONAL_STRING_FIELDS` | `[ 'description', 'departureAirport', 'destinatio…` | ENG | schema field list |
| efsp/stores.js:214 | `RESTORE_ORDER` | `['fdr', 'airspaces', 'boards', 'correlations', '…` | ENG | store restore order |
| efsp/surveillance-hints-config.js:13 | `CONFIG_NAME` | `'efsp-surveillance-hints.json'` | ENG | config file name |
| efsp/surveillance-hints-config.js:15 | `DEFAULT_HINTS_CONFIG` | `Object.freeze({ airborne: Object.freeze({ minGro…` | TUNE | duplicates config/efsp-surveillance-hints.json; this lane removes it (moves) |
| efsp/surveillance-hints.js:51 | `UNEXPECTING` | `Object.freeze({ DEPARTURE: Object.freeze(['PROPO…` | DOCT | states in which no contact is expected; advance-to state map |
| efsp/surveillance-hints.js:65 | `ADVANCE_TO` | `Object.freeze({ DEPARTURE: 'DEPARTED' })` | DOCT | states in which no contact is expected; advance-to state map |
| efsp/time-chains.js:34 | `TIME_CHAINS` | `{ departure: { blockId: '6', path: 'filed.propos…` | DOCT | ATD-2 time chains (guide §10.5) |
| efsp/time-chains.js:46 | `ESTIMATE_SOURCES` | `{ EST_DEPARTURE: 'departure', EST_OFF_BLOCK: 'of…` | DOCT | ATD-2 time chains (guide §10.5) |
| efsp/traffic-count.js:37 | `DAY_MS` | `24 * 60 * 60 * 1000` | ENG | unit (ms per day), repeated in 5 files |
| efsp/traffic-count.js:45 | `COUNTABLE_PRE_DROP_STATES` | `Object.freeze({ DEPARTURE: Object.freeze(['DEPAR…` | DOCT | what counts as a movement, [SOURCE-DEFINED] (ADR 0065) |
| efsp/traffic-count.js:59 | `EXCLUDED_WHEN_NOT_COUNTABLE` | `Object.freeze({ DEPARTURE: 'NEVER_DEPARTED', ARR…` | DOCT | what counts as a movement, [SOURCE-DEFINED] (ADR 0065) |
| efsp/traffic-count.js:69 | `POLICY` | `'[SOURCE-DEFINED] one record per DROPPED ATC Str…` | DOCT | what counts as a movement, [SOURCE-DEFINED] (ADR 0065) |
| efsp/traffic-count.js:176 | `RECONCILED_FIELDS` | `['stripId', 'droppedAt', 'hourUtc', 'role', 'cou…` | DOCT | what counts as a movement, [SOURCE-DEFINED] (ADR 0065) |
| efsp/wire/families/ato.js:24 | `ATO_ACK_CACHE_CAP` | `200` | ENG | wire protocol (version, slots, cache cap) |
| efsp/wire/frames.js:6 | `VERSION` | `1` | ENG | wire protocol (version, slots, cache cap) |
| efsp/wire/slots.js:7 | `SLOT_ORDER` | `['primary', 'peer', 'marsa', 'carrier', 'sfa']` | ENG | wire protocol (version, slots, cache cap) |
| efsp/zulu-time.js:20 | `DAY_MS` | `24 * 60 * 60 * 1000` | ENG | unit (ms per day), repeated in 5 files |
| geo.js:5 | `GROUND_RADIUS_M` | `5000` | ENG | "on the ground" test: 5 km / 50 m AGL. Borderline TUNE (same family as surveillance-hints airborne thresholds) |
| geo.js:6 | `GROUND_AGL_M` | `50` | ENG | "on the ground" test: 5 km / 50 m AGL. Borderline TUNE (same family as surveillance-hints airborne thresholds) |
| grpc-client.js:20 | `ALLOWED_CATS` | `new Set([1, 2, 3, 4])` | ENG | DCS category enum |
| grpc-client.js:23 | `ISA_T0` | `288.15` | ENG | ISA physics constants (duplicated in altimetry.js and grpc-client.js: a dedupe candidate, not a move) |
| grpc-client.js:24 | `ISA_P0` | `101325` | ENG | ISA physics constants (duplicated in altimetry.js and grpc-client.js: a dedupe candidate, not a move) |
| grpc-client.js:25 | `ISA_L` | `0.0065` | ENG | ISA physics constants (duplicated in altimetry.js and grpc-client.js: a dedupe candidate, not a move) |
| grpc-client.js:26 | `ISA_G` | `9.80665` | ENG | ISA physics constants (duplicated in altimetry.js and grpc-client.js: a dedupe candidate, not a move) |
| grpc-client.js:27 | `ISA_R` | `287.05287` | ENG | ISA physics constants (duplicated in altimetry.js and grpc-client.js: a dedupe candidate, not a move) |
| grpc-client.js:30 | `H_TROP` | `11000.0` | ENG | ISA physics constants (duplicated in altimetry.js and grpc-client.js: a dedupe candidate, not a move) |
| grpc-client.js:31 | `T_REF_ALT` | `288.97` | ENG | ISA physics constants (duplicated in altimetry.js and grpc-client.js: a dedupe candidate, not a move) |
| grpc-client.js:33 | `WEATHER_POLL_MS` | `60000` | ENG | gRPC client timing; DCS_GRPC_* env vars already expose the two the operator needs |
| grpc-client.js:38 | `UNIT_KEEPALIVE_MS` | `5000` | ENG | gRPC client timing; DCS_GRPC_* env vars already expose the two the operator needs |
| grpc-client.js:43 | `BACKOFF_BASE_MS` | `1000` | ENG | gRPC client timing; DCS_GRPC_* env vars already expose the two the operator needs |
| grpc-client.js:44 | `BACKOFF_CAP_MS` | `30000` | ENG | gRPC client timing; DCS_GRPC_* env vars already expose the two the operator needs |
| grpc-client.js:45 | `STREAM_STABLE_MS` | `5000` | ENG | gRPC client timing; DCS_GRPC_* env vars already expose the two the operator needs |
| grpc-client.js:46 | `END_LOG_WINDOW_MS` | `60000` | ENG | gRPC client timing; DCS_GRPC_* env vars already expose the two the operator needs |
| grpc-client.js:47 | `GAMETIME_POLL_MS` | `5000` | ENG | gRPC client timing; DCS_GRPC_* env vars already expose the two the operator needs |
| grpc-client.js:52 | `CHANNEL_OPTS` | `{ 'grpc.keepalive_time_ms': 10000, 'grpc.keepali…` | ENG | gRPC client timing; DCS_GRPC_* env vars already expose the two the operator needs |
| log-level.js:11 | `LEVELS` | `{ error: 0, warn: 1, info: 2, debug: 3 }` | ENG | log levels |
| log-level.js:12 | `DEFAULT_LEVEL` | `'info'` | ENG | log levels |
| log-level.js:15 | `METHOD_LEVEL` | `{ error: 'error', warn: 'warn', info: 'info', lo…` | ENG | log levels |
| magnetic.js:51 | `WGS84_A` | `6378.137` | ENG | WGS84 / WMM constants |
| magnetic.js:52 | `WGS84_F` | `1 / 298.257223563` | ENG | WGS84 / WMM constants |
| magnetic.js:54 | `WMM_RE` | `6371.2` | ENG | WGS84 / WMM constants |
| mission-clock.js:33 | `DEFAULT_STALE_MS` | `30000` | ENG | file name / schema version / clock-resync windows (restart robustness) |
| mission-clock.js:37 | `ISO_RE` | `/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}…` | ENG | file name / schema version / clock-resync windows (restart robustness) |
| mission-session.js:36 | `FILE_NAME` | `'mission-session.json'` | ENG | file name / schema version / clock-resync windows (restart robustness) |
| mission-session.js:37 | `VERSION` | `1` | ENG | file name / schema version / clock-resync windows (restart robustness) |
| mission-session.js:38 | `CLOCK_STEP_BACK_MS` | `5 * 60 * 1000` | ENG | file name / schema version / clock-resync windows (restart robustness) |
| mission-session.js:42 | `LAST_AT_PERSIST_MS` | `60 * 1000` | ENG | file name / schema version / clock-resync windows (restart robustness) |
| mission-session.js:46 | `CLOCK_ROLL_ADOPT_MS` | `2 * 60 * 1000` | ENG | file name / schema version / clock-resync windows (restart robustness) |
| mission-session.js:48 | `REASONS` | `Object.freeze(['FIRST', 'MISSION_START', 'MISSIO…` | ENG | file name / schema version / clock-resync windows (restart robustness) |
| radars.js:35 | `AIRPORT_RADAR_HEIGHT_M` | `15` | DATA | per-sensor range/sweep/height [SOURCE-DEFINED]; sensor-specs.json says it is "THE single home" for these. NOT in the briefing list, so NOT moved until ruled (UNCL on scope) |
| radars.js:36 | `SHIP_RADAR_HEIGHT_M` | `40` | DATA | per-sensor range/sweep/height [SOURCE-DEFINED]; sensor-specs.json says it is "THE single home" for these. NOT in the briefing list, so NOT moved until ruled (UNCL on scope) |
| radars.js:38 | `M_PER_NM` | `1852` | ENG | unit / enum / name heuristic |
| radars.js:43 | `AIRPORT_RADAR` | `{ rangeNm: 40, sweepMs: 2000 }` | DATA | per-sensor range/sweep/height [SOURCE-DEFINED]; sensor-specs.json says it is "THE single home" for these. NOT in the briefing list, so NOT moved until ruled (UNCL on scope) |
| radars.js:44 | `APPROACH_RADAR` | `{ rangeNm: 80, sweepMs: 3000 }` | DATA | per-sensor range/sweep/height [SOURCE-DEFINED]; sensor-specs.json says it is "THE single home" for these. NOT in the briefing list, so NOT moved until ruled (UNCL on scope) |
| radars.js:45 | `CVN_APPROACH_RADAR` | `{ rangeNm: 50, sweepMs: 4000, heightM: 45 }` | DATA | per-sensor range/sweep/height [SOURCE-DEFINED]; sensor-specs.json says it is "THE single home" for these. NOT in the briefing list, so NOT moved until ruled (UNCL on scope) |
| radars.js:48 | `SHIP_RADAR_DEFAULT` | `{ rangeNm: 40, sweepMs: 5000 }` | DATA | sensor-spec data; this lane removes the code copy (moves into config/sensor-specs.json) |
| radars.js:50 | `RADAR_TYPES` | `['airport', 'approach', 'awacs', 'fighter', 'car…` | ENG | unit / enum / name heuristic |
| radars.js:64 | `DEFAULT_CAPS` | `{ // H53: the squadron's fields and the carrier …` | DATA | sensor-spec data; this lane removes the code copy (moves into config/sensor-specs.json) |
| radars.js:83 | `DEFAULT_PRESENTATION` | `{ airport: 'ATC', approach: 'ATC', carrierApproa…` | DATA | sensor-spec data; this lane removes the code copy (moves into config/sensor-specs.json) |
| radars.js:87 | `PRESENTATIONS` | `new Set(['ATC', 'TACTICAL'])` | ENG | unit / enum / name heuristic |
| radars.js:107 | `HELIPAD_RE` | `/helipad\|farp\|fob/i` | ENG | unit / enum / name heuristic |
| srs-client.js:8 | `SRS_VERSION` | `'2.1.0.0'` | ENG | SRS protocol constants |
| srs-client.js:10 | `MSG_UPDATE` | `0` | ENG | SRS protocol constants |
| srs-client.js:11 | `MSG_SYNC` | `2` | ENG | SRS protocol constants |
| srs-client.js:12 | `MSG_RADIO_UPDATE` | `3` | ENG | SRS protocol constants |
| srs-client.js:13 | `MSG_CLIENT_DISCONNECT` | `5` | ENG | SRS protocol constants |
| stca.js:25 | `MS_PER_KT` | `0.514444` | ENG | unit conversion (repeated in airborne.js, conformance.js, stca.js, radars.js) |
| stca.js:26 | `M_PER_NM` | `1852` | ENG | unit conversion (repeated in airborne.js, conformance.js, stca.js, radars.js) |
| stca.js:27 | `FT_PER_M` | `3.28084` | ENG | unit conversion (repeated in airborne.js, conformance.js, stca.js, radars.js) |
| stca.js:28 | `AIRBORNE_CATEGORIES` | `new Set([1, 2])` | ENG | DCS category enum |
| surveillance/iff.js:20 | `IFF_STATES` | `['friendly', 'neutral', 'bogey', 'bandit', 'host…` | DOCT | IFF state vocabulary (ADR 0066) |
| surveillance/presentation.js:39 | `WIRE_KEYS` | `[ 'id', 'lat', 'lon', 'domain', 'onGround', 'ill…` | ENG | wire key list |
| surveillance/presentation.js:48 | `SCHEME_HOLD_SWEEPS` | `2` | TUNE | how many sweeps a presentation scheme holds [SOURCE-DEFINED-like]; display behaviour |
| surveillance/track-numbers.js:8 | `MAX` | `99999` | ENG | track number space (99999) |
| surveillance/transponder.js:33 | `EMERGENCIES` | `{ '7500': 'HIJACK', '7600': 'RADIO', '7700': 'GE…` | DOCT | 7500/7600/7700 emergency codes |
| terrain.js:33 | `LOS_DEM_ZOOM` | `10` | ENG | DEM/LOS fidelity and fetch limits (CRCSYNC_MAPTILER_KEY and CRCSYNC_TERRAIN_CACHE_DIR are the operator knobs) |
| terrain.js:34 | `LOS_SAMPLE_COUNT` | `24` | ENG | DEM/LOS fidelity and fetch limits (CRCSYNC_MAPTILER_KEY and CRCSYNC_TERRAIN_CACHE_DIR are the operator knobs) |
| terrain.js:35 | `GRID_CACHE_MAX` | `600` | ENG | DEM/LOS fidelity and fetch limits (CRCSYNC_MAPTILER_KEY and CRCSYNC_TERRAIN_CACHE_DIR are the operator knobs) |
| terrain.js:40 | `EFFECTIVE_EARTH_RADIUS_M` | `(4 / 3) * 6371000` | ENG | DEM/LOS fidelity and fetch limits (CRCSYNC_MAPTILER_KEY and CRCSYNC_TERRAIN_CACHE_DIR are the operator knobs) |
| terrain.js:42 | `TILE_SIZE` | `512` | ENG | DEM/LOS fidelity and fetch limits (CRCSYNC_MAPTILER_KEY and CRCSYNC_TERRAIN_CACHE_DIR are the operator knobs) |
| terrain.js:43 | `GRID_STRIDE` | `4` | ENG | DEM/LOS fidelity and fetch limits (CRCSYNC_MAPTILER_KEY and CRCSYNC_TERRAIN_CACHE_DIR are the operator knobs) |
| terrain.js:54 | `FETCH_TIMEOUT_MS` | `15000` | ENG | DEM/LOS fidelity and fetch limits (CRCSYNC_MAPTILER_KEY and CRCSYNC_TERRAIN_CACHE_DIR are the operator knobs) |
| terrain.js:55 | `MAX_CONCURRENT_FETCHES` | `6` | ENG | DEM/LOS fidelity and fetch limits (CRCSYNC_MAPTILER_KEY and CRCSYNC_TERRAIN_CACHE_DIR are the operator knobs) |
| terrain.js:57 | `PREWARM_MAX_TILES` | `1500` | ENG | DEM/LOS fidelity and fetch limits (CRCSYNC_MAPTILER_KEY and CRCSYNC_TERRAIN_CACHE_DIR are the operator knobs) |
| test-reset.js:24 | `RESET_EXIT_CODE` | `75` | ENG | test-only exit code |
| theater-context.js:22 | `DAY_MS` | `86400000` | ENG | magnetic-grid sampling and day length |
| theater-context.js:27 | `GRID_STEP_DEG` | `1` | ENG | magnetic-grid sampling and day length |
| theater-context.js:28 | `GRID_PAD_DEG` | `3` | ENG | magnetic-grid sampling and day length |
| theater-context.js:29 | `GRID_MAX_CELLS` | `40` | ENG | magnetic-grid sampling and day length |
| theaters.js:80 | `DEFAULT_TRANSITION_ALT_FT` | `18000` | TUNE | fallback for a theater absent from theaters.json; this lane moves it to a "default" entry in config/theaters.json |
| tracks.js:10 | `STALE_MS` | `12000` | TUNE | 12 s track staleness: how long a silent contact lives; operational, a threshold |
| ws-hub.js:10 | `VERSION` | `1` | ENG | wire version / name length cap |
| ws-hub.js:11 | `TICK_MS` | `500` | ENG | 500 ms picture push (ADR 0059); wire cadence |
| ws-hub.js:13 | `MAX_NAME_LEN` | `40` | ENG | wire version / name length cap |

### B. Inline numeric literals other than 0, 1, 2 and array indices (365; the 1057 literals 0/1/2/index are engineering by construction and not listed)

Counts: facility data 3, tunable threshold 7, doctrine table 19, engineering constant 328, unclear 8.

**B1. Not plainly engineering, one row each.**

| Where | Value | In | Class | Reason |
|---|---|---|---|---|
| atis-store.js:28 | 8000 | constructor | TUNE | ATIS entry TTL (ms): constructor default |
| atis-store.js:28 | 45000 | constructor | TUNE | ATIS presence TTL (ms): constructor default |
| efsp/board-store.js:1969 | 400 | _applyInvokeNla | TUNE | double-invoke NLA debounce (ms), inline |
| efsp/board-store.js:2032 | 30000 | _applyInvokeNla | TUNE | NLA undo window (ms), inline |
| efsp/carrier/recovery-case.js:113 | 1000 | caseFloor | DOCT | §9.12 Case III ceiling |
| efsp/carrier/recovery-case.js:113 | 5 | caseFloor | DOCT | §9.12 Case III visibility (nm) |
| efsp/carrier/recovery-case.js:114 | 3000 | caseFloor | DOCT | §9.12 Case II ceiling |
| efsp/fdr-store.js:836 | 60 | setField | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/fdr-store.js:836 | 1000 | setField | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/fdr-store.js:845 | 60 | setField | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/fdr-store.js:845 | 1000 | setField | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/fdr-store.js:846 | 60 | setField | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/fdr-store.js:846 | 1000 | setField | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/fdr-store.js:850 | 60 | setField | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/fdr-store.js:850 | 1000 | setField | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/fdr-store.js:851 | 60 | setField | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/fdr-store.js:851 | 1000 | setField | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/forwarding-obligations.js:48 | 60 | computeDueObligations | UNCL | "recently amended" window, 60 s inline in computeDueObligations (guide-derived or ours?) |
| efsp/forwarding-obligations.js:48 | 1000 | computeDueObligations | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/forwarding-obligations.js:63 | 60 | computeDueObligations | UNCL | "recently amended" window, 60 s inline in computeDueObligations (guide-derived or ours?) |
| efsp/forwarding-obligations.js:63 | 1000 | computeDueObligations | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/forwarding-obligations.js:75 | 60 | computeDueObligations | UNCL | "recently amended" window, 60 s inline in computeDueObligations (guide-derived or ours?) |
| efsp/forwarding-obligations.js:75 | 1000 | computeDueObligations | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/forwarding-obligations.js:76 | 60 | computeDueObligations | UNCL | "recently amended" window, 60 s inline in computeDueObligations (guide-derived or ours?) |
| efsp/forwarding-obligations.js:76 | 1000 | computeDueObligations | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/forwarding-obligations.js:86 | 60 | computeDueObligations | UNCL | "recently amended" window, 60 s inline in computeDueObligations (guide-derived or ours?) |
| efsp/forwarding-obligations.js:86 | 1000 | computeDueObligations | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/forwarding-obligations.js:147 | 60 | computePendingObligations | UNCL | "recently amended" window, 60 s inline in computeDueObligations (guide-derived or ours?) |
| efsp/forwarding-obligations.js:147 | 1000 | computePendingObligations | DOCT | minutes-to-ms of the guide-cited constant |
| efsp/instrumentation-config.js:24 | 30 | (module) | TUNE | part of DEFAULT_INSTRUMENTATION_CONFIG (this lane) |
| efsp/instrumentation-config.js:25 | 30 | (module) | TUNE | part of DEFAULT_INSTRUMENTATION_CONFIG (this lane) |
| efsp/instrumentation-config.js:27 | 400 | (module) | TUNE | part of DEFAULT_INSTRUMENTATION_CONFIG (this lane) |
| grpc-client.js:109 | 41 | constructor | UNCL | default weather reference point lat/lon 41.0/41.0 hardcoded in the gRPC client (a Caucasus location): facility/theater data in code |
| grpc-client.js:109 | 41 | constructor | UNCL | default weather reference point lat/lon 41.0/41.0 hardcoded in the gRPC client (a Caucasus location): facility/theater data in code |
| radars.js:102 | 4000 | EMPTY_SPECS | DATA | duplicates sensor-specs.json datalink.pliPeriodMs in EMPTY_SPECS (this lane: removed with the other radars.js code defaults) |
| radars.js:102 | 2000 | EMPTY_SPECS | DATA | duplicates sensor-specs.json datalink.lockPollMs in EMPTY_SPECS (this lane) |
| surveillance/datalink.js:46 | 4000 | constructor | DATA | `\|\| 4000` duplicates sensor-specs.json datalink.pliPeriodMs; NOT in the briefing list (surveillance/ is TIME-B-adjacent): proposed to follow the radars.js change |

**B2. Engineering, grouped by file** (unit conversions, geometry, HTTP statuses, format widths, rounding, USMTF field positions, hash/epoch/algorithm coefficients).

| File | Count | Distinct values |
|---|---|---|
| altimetry.js | 3 | 288.15, 0.3048 |
| auth.js | 8 | 443, 80, 200, 3, 7, 401, 60000 |
| coverage.js | 14 | 360, 180, 3, 4 |
| efsp/airborne.js | 1 | 1000 |
| efsp/ato/ato-sets.js | 46 | 3, 4, 5, 6, 11, 8, 9, 10, 100 |
| efsp/ato/usmtf-time.js | 7 | 31, 23, 59, 12 |
| efsp/ato/usmtf-tokenize.js | 4 | 65279, 10, 40 |
| efsp/board-store.js | 3 | 2000, 1000, 3 |
| efsp/carrier-store.js | 1 | 200 |
| efsp/carrier/angles.js | 7 | 360, 180 |
| efsp/carrier/flight-record.js | 1 | 100 |
| efsp/carrier/marshal-stack.js | 1 | 360 |
| efsp/carrier/ship-state.js | 8 | 45, 100, 360, 180 |
| efsp/carrier/sun.js | 19 | 180, 86400000, 2440587.5, 2451545, 280.46, 0.9856474, 360, 357.528, 0.9856003, 1.915, 0.02, 23.439, 4e-7, 18.697374558, … |
| efsp/code-allocator.js | 5 | 8, 4095, 4 |
| efsp/conformance.js | 10 | 360, 540, 180, 1000 |
| efsp/correlation-reconciler.js | 1 | 100 |
| efsp/fdr-store.js | 9 | 100, 3, 360 |
| efsp/field-state.js | 4 | 36, 180, 1e-9, 360 |
| efsp/flight-plan-lookup.js | 1 | 404 |
| efsp/metrics.js | 15 | 24, 0.5, 0.95, 128, 64, 60, 400, 200, 404, 503 |
| efsp/mutation-log.js | 1 | 10 |
| efsp/order-key.js | 1 | 4 |
| efsp/release-envelope.js | 1 | 10 |
| efsp/sfa-store.js | 1 | 20 |
| efsp/surveillance-hints.js | 1 | 1000 |
| efsp/traffic-count.js | 1 | 13 |
| efsp/zulu-time.js | 2 | 23, 59 |
| geo.js | 5 | 6371000, 180 |
| grpc-client.js | 28 | 10, 5, 5000, 60000, 30, 0.5, 1000, 3, 200, 4, 4000, 1.94384, 180, 270, … |
| magnetic.js | 9 | 180, 6, 1e-12, 360, 5, 90 |
| mission-clock.js | 2 | 1000, 3600000 |
| mission-session.js | 3 | 2166136261, 16777619, 16 |
| radars.js | 6 | 360, 4 |
| srs-client.js | 3 | 5002, 5000 |
| stca.js | 14 | 180, 111320, 110540, 1000, 1200, 3600, 10, 100 |
| surveillance/datalink.js | 2 | 31, 4 |
| surveillance/iff.js | 2 | 10, 3 |
| surveillance/presentation.js | 3 | 4, 100 |
| surveillance/track-numbers.js | 1 | 5 |
| surveillance/transponder.js | 5 | 4, 31, 8 |
| terrain.js | 57 | 180, 360, 6371000, 540, 137, 80, 78, 71, 13, 10, 26, 8, 4, 6, … |
| test-reset.js | 2 | 50, 404 |
| theater-context.js | 5 | 360, 89, 100 |
| ws-hub.js | 5 | 401, 36, 1000 |

### C. The unclear entries, as questions for the Decision Desk

1. efsp/archiver.js:27 `ARCHIVE_AFTER_MS`: finished-Strip retention (ADR 0082). Source comment says "H36: a decision, not tuning, so a constant rather than a config file"; H88 says tunable thresholds go to JSON. Which wins?
2. efsp/carrier/flight-record.js:36 `APPROACH_TYPES`: [SOURCE-DEFINED] carrier vocabulary / validation range: squadron-specific values (approach types, button range) but no tuning intent; DOCT or TUNE?
3. efsp/carrier/flight-record.js:37 `APPROACH_BUTTON_MIN`: [SOURCE-DEFINED] carrier vocabulary / validation range: squadron-specific values (approach types, button range) but no tuning intent; DOCT or TUNE?
4. efsp/carrier/flight-record.js:38 `APPROACH_BUTTON_MAX`: [SOURCE-DEFINED] carrier vocabulary / validation range: squadron-specific values (approach types, button range) but no tuning intent; DOCT or TUNE?
5. efsp/carrier/flight-record.js:39 `FUEL_MAX_LB`: [SOURCE-DEFINED] carrier vocabulary / validation range: squadron-specific values (approach types, button range) but no tuning intent; DOCT or TUNE?
6. efsp/carrier/marshal-stack.js:48 `STACK_DEFAULTS`: marshal maxIndex 19 [SOURCE-DEFINED] (angels 25, DME 40): squadron carrier-ops data (DATA, per hull?) or doctrine table?
7. efsp/carrier/recovery-case.js:36 `DEFAULT_CASE`: "III" [SOURCE-DEFINED] (most restrictive default). Doctrine default or squadron setting?
8. efsp/carrier/ship-state.js:45 `ANGLED_DECK_BY_TYPE`: per-DCS-ship-type angle [SOURCE-DEFINED]: reference data about ship models (DATA, could join efsp-carriers.json) or an engineering table? Kept in code until ruled
9. efsp/carrier/sun.js:13 `NIGHT_BELOW_DEG`: night = sun below -6 deg [SOURCE-DEFINED]: definition of night; DOCT or TUNE?
10. efsp/code-allocator.js:45 `SYNTHETIC_BLOCK_START`: where synthetic Mode 3 codes are drawn (octal 6000-6777): [SOURCE-DEFINED] numbering plan; ENG or TUNE?
11. efsp/code-allocator.js:46 `SYNTHETIC_BLOCK_SIZE`: where synthetic Mode 3 codes are drawn (octal 6000-6777): [SOURCE-DEFINED] numbering plan; ENG or TUNE?
12. efsp/correlation-match.js:38 `AFFINITY_EXACT`: callsign affinity weights 1.0/0.9/0.8/0.7. Its comment says deliberately not config (ADR 0041 lesson), H88 says tunables go to JSON. Which wins?
13. efsp/correlation-match.js:39 `AFFINITY_FORMATION`: callsign affinity weights 1.0/0.9/0.8/0.7. Its comment says deliberately not config (ADR 0041 lesson), H88 says tunables go to JSON. Which wins?
14. efsp/correlation-match.js:40 `AFFINITY_SUFFIXED`: callsign affinity weights 1.0/0.9/0.8/0.7. Its comment says deliberately not config (ADR 0041 lesson), H88 says tunables go to JSON. Which wins?
15. efsp/correlation-match.js:41 `AFFINITY_SAME_STEM`: callsign affinity weights 1.0/0.9/0.8/0.7. Its comment says deliberately not config (ADR 0041 lesson), H88 says tunables go to JSON. Which wins?
16. efsp/facility-config.js:40 `DEFAULT_FACILITY_ID`: which Facility a client lands on by default: facility data, but also a code default; DATA-1 owns the file
17. efsp/forwarding-obligations.js:48 (60): "recently amended" window, 60 s inline in computeDueObligations (guide-derived or ours?)
18. efsp/forwarding-obligations.js:63 (60): "recently amended" window, 60 s inline in computeDueObligations (guide-derived or ours?)
19. efsp/forwarding-obligations.js:75 (60): "recently amended" window, 60 s inline in computeDueObligations (guide-derived or ours?)
20. efsp/forwarding-obligations.js:76 (60): "recently amended" window, 60 s inline in computeDueObligations (guide-derived or ours?)
21. efsp/forwarding-obligations.js:86 (60): "recently amended" window, 60 s inline in computeDueObligations (guide-derived or ours?)
22. efsp/forwarding-obligations.js:147 (60): "recently amended" window, 60 s inline in computeDueObligations (guide-derived or ours?)
23. grpc-client.js:109 (41): default weather reference point lat/lon 41.0/41.0 hardcoded in the gRPC client (a Caucasus location): facility/theater data in code
24. grpc-client.js:109 (41): default weather reference point lat/lon 41.0/41.0 hardcoded in the gRPC client (a Caucasus location): facility/theater data in code

### D. How it was produced (completeness)

Script (kept out of the repo): parse every `crc-sync/src/**/*.js` (107 files) with acorn (`ecmaVersion: latest`), then
(A) list every module-scope `const`/`let` whose initialiser is built only from literals (arrays, objects, `Object.freeze`,
`new Set`, arithmetic of literals), and (B) list every numeric `Literal` outside those initialisers, with file, line,
enclosing function and source line. Strings that are not part of a named constant are identifiers, enum values, messages
or protocol tokens and were not listed; facility ids inside code were counted by `grep` for `'INCIRLIK'`, `'LTAG'`,
`'UNION'`, `'CVN-72'`, `'TACTICAL'`, `'CENTER'`, `'RANGES'`, `'TAC_C2'`, `'CV_MARSHAL'`, `'OPS'`: outside `facility-config.js`
they sit in `efsp/permission.js` (OPS x8, TAC_C2 x8, CENTER x2), `efsp/carrier/transfers.js`, `efsp/ato/ato-board.js`,
`efsp/sfa-store.js`, `efsp/index.js`, `efsp/efsp-ws.js`, `efsp/station-coverage.js` and `efsp/carrier/ship-state.js`.
All 93 `[SOURCE-DEFINED]` comments in `src` were read; the values they mark are classified in A/B above.
Not found by the scan (by design): constants computed from other values, class statics, and constants declared inside
functions (those appear in B as inline numbers).

### C2. Rulings (S-DATA2-0, supervisor)

- `ARCHIVE_AFTER_MS`: stays a named constant (H36 is the human's specific ruling).
- Correlation `AFFINITY_*`: engineering constant, stays.
- `DEFAULT_CASE`, marshal `maxIndex` 19, `NIGHT_BELOW_DEG`: doctrine, stay in code.
- `ANGLED_DECK_BY_TYPE`: unit data, belongs in the carrier hull JSON; not moved here (see E).
- Synthetic code block, approach types and button range: facility data (R3-53), later data lane.
- Weather reference point 41/41 in `grpc-client.js`: a finding; should come from `theaters.json`.
- `permission.js` Position ids: AUTH's registry, untouched.
- Every other unclear entry: stays in code, listed in E.

### E. Follow-up list (for a later data lane)

1. `ANGLED_DECK_BY_TYPE` into `efsp-carriers.json` (needs the table injected into `buildShipState`).
2. `AIRPORT_RADAR`, `APPROACH_RADAR`, `CVN_APPROACH_RADAR`, `AIRPORT_RADAR_HEIGHT_M`, `SHIP_RADAR_HEIGHT_M` into `sensor-specs.json`; `datalink.js` `|| 4000` follows.
3. `SYNTHETIC_BLOCK_START/SIZE`, `APPROACH_TYPES`, `APPROACH_BUTTON_MIN/MAX`, `FUEL_MAX_LB` (R3-53 comm card).
4. `grpc-client.js` weather reference point (41/41) from `theaters.json`.
5. `ATO_IMPORT_ORIGIN`, the facility ids in `sfa-store.js`, `index.js`, `efsp-ws.js`, `station-coverage.js`, `transfers.js` (facility topology in code), after DATA-1 and AUTH.
6. Remaining unclear: `DEFAULT_FACILITY_ID`, the inline "recently amended" 60 s in `forwarding-obligations.js`, `geo.js` on-ground thresholds (borderline tunable), `tracks.js` `STALE_MS`, `PARK_MS`, `SCHEME_HOLD_SWEEPS`, `PUSH_TOLERANCE_MS` / `RADIAL_TOLERANCE_DEG`, ATIS TTLs, NLA debounce/undo windows (all proposed TUNE, none moved).
