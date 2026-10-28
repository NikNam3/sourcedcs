# QAS — crc-sync cleanup (concerns S-6, S-11, S-14, O-5)

Branch `lane/QA-sync-cleanup`. crc-sync 1947 -> 1957 pass (10 new: golden table, resolveTypedTime, log-level). crc-desktop 800 pass / 1 todo, unchanged.

## S-6 IFF_STATES duplicate — left as is, parity test is the mechanism
`crc-desktop/app/public/js/iff.js` is a classic browser script (loaded by `<script src>` in index.html, no module system, no fetch of data files) in a package that ships in an Electron asar; crc-sync ships as a Docker image. The two packages share no directory at runtime (ADR 0001), and a JSON file read by both would need either a build step to copy it into each package or a runtime fetch of the list from the server (which would make the client's pre-send gate async). `client-mirror-parity.test.js` already pins the list and its order, plus the fallback colour keys. Nothing changed.

## S-11 exports with no consumer
Scanned every `module.exports = {…}` in crc-sync/src (not the lane-forbidden files) for names referenced in no other file of crc-sync (src, server.js, tools, tests) or crc-desktop. Removed from the export lists (definitions stay, now private; some may now be dead locally, left for a later pass):
coverage LOS_CACHE_MS; magnetic parseCof; radars CVN_APPROACH_RADAR, DEFAULT_PRESENTATION, RADAR_TYPES, SENSOR_SPECS_PATH, capsFor, presentationFor; stca predictConflict; terrain CACHE_DIR; airborne FOOTPRINT_M, footprintElevationM; airspace-config AIRSPACES_PATH, AIRSPACE_TYPES, MAX/MIN_ALTITUDE_FT, airspacesForUsingPosition, setAirspaces; clearance-migration CLEARANCE_BLOCKS_BY_ROLE; code-allocator MONITOR_SET; coordination TOFI_EFFECTS, tofiEffect; correlation-reconciler CORRELATION_RATE_TARGET, RATE_WARN_*; correlation-store CORRELATION_STATES, WARNING_KINDS; facility-config DEFAULT_CONFIGS, RADAR_SELECTOR_KINDS; fdr-store CLEARANCE_FIELDS, RELEASE_STATES, defaultClearance; field-state-store SYSTEM_ACTOR; field-state GEAR_POSITIONS, GEAR_STATES, RUNWAY_CHANGE_STATES, RUNWAY_CHANGE_OPEN_STATES; flight-plan-lookup LOOKUP_TIMEOUT_MS, SOURCEDCS_WEB_URL; marsa-store MARSA_STATES, START_EVENTS, END_CONDITIONS, VOID_CAUSES, END_CAUSES; metrics FLAG_TO_GESTURE, GESTURES, KNOWN_SOURCES, METRICS_PATH, hourRange; mutation-log utcDay; nla-status-monitor statusKey; replay-cache REPLAY_CACHE_CAP; stereo-routes STEREO_ROUTES_PATH; surveillance-hints ADVANCE_TO; traffic-count TRAFFIC_COUNT_PATH, countIdFor, emptyTotals, expectedFromLog, isNotPersistedDrop, liveCountRecords, logDerivedRecord; ato-board SEED_PATH_OF, arLinksByLine, atoTaskingFor, isAssignableModeThree, sha1; ato-sets AR_SYSTEMS, TACAN_RE, extractAknldg/FreeText/Grouping/Oper; ato-structure KNOWN_UNMAPPED, LOCATION_SETS, MISSION_SETS, SINGLE_PER_MISSION; callsign-fit MAX_CALLSIGN; usmtf-tokenize FREE_TEXT_SETS, KNOWN_SET_NAMES, makeField; hull-config CARRIERS_FILE, getDefaultHull, getHull; sun NIGHT_BELOW_DEG; presentation domainOf; transponder EMERGENCIES, coalitionClass.
Not touched: crc-desktop exports (browser scripts expose globals, a different question), and the lane-forbidden files.

## S-14 time-resolution overlap — smaller than the concern says
Mapped: `zulu-time.js` (typed HHMM <-> epoch, nearest-occurrence), `ato/usmtf-time.js` (USMTF DDHHMMZ DTGs, a different grammar anchored on the ATO's TIMEFRAM), `time-chains.js` (§10.5 provenance: picks WHICH stored source wins; no parsing), and fdr-store's `normalizeTypedTime` (wrapper over zulu-time). Only the last overlapped: it re-implemented number/empty/text handling in front of zulu-time.
Done: golden table (`tests/fixtures/zulu-time-golden.json`, 31 texts x 14 clocks etc., captured from the OLD code before any change, `tests/zulu-time-golden.test.mjs`), then `resolveTypedTime(value, nowMs, afterMs)` moved into zulu-time.js; fdr-store's wrapper now only adds the field label to the refusal. Behaviour identical (golden + full suite).
Cannot / should not merge: time-chains.js has a byte-identical client copy (ADR 0001, guarded by a parity test); usmtf-time.js has different rules (year/month inference, zone letters) and merging would risk the ATO import. The client's `formatZuluHhmm` mirror stays (PARITY's test).

## O-5 LOG_LEVEL
`crc-sync/src/log-level.js`: `LOG_LEVEL=error|warn|info|debug`, default info, case-insensitive, unknown value warns once and uses info. `install()` wraps console.error/warn/info/log/debug in place (console.log = info), called in server.js right after dotenv so a `.env` value applies and no call site (including lane-forbidden files) changed. Tests: `tests/log-level.test.mjs`. For INFRA2: same file is copyable to atobrief/sourcedcs-web; compose must forward `LOG_LEVEL` to crc-sync (`${LOG_LEVEL:-info}`) and `.env.example` re-gain the entry (HYG removed it). CLAUDE.md env table: add `LOG_LEVEL`.

## Other
`soak:smoke` run (src/efsp touched): fails only on `memory.slope 1.74 MB/h`, the known wave-2 finding; no new detector. Defaults taken: none needing a decision.

## Integrator note (integ/merge4)
QAS was not merged as a branch (it conflicted with L18-server in facility-config.js). Its LOG_LEVEL, zulu-time golden
table and typed-time consolidation commits were cherry-picked. The S-11 dead-export list above is superseded: the scan
was re-run on the merged tree (ruling R3-64) and the result is in the commit "refactor(crc-sync): drop exports nothing
imports" on integ/merge4. 78 names removed; kept on purpose (planned hook, documented API or half of a pair):
setAirspaces, AIRSPACE_TYPES, MIN_ALTITUDE_FT, MAX_ALTITUDE_FT (AIRSP phase 2 editor), isNotPersistedDrop (ADR 0081 /
briefing name it as exported), readScopeOf (family with filterForSession/supplementFor/readScopeKey), sfaDelta (pair of
carrierDelta), extractOper/Aknldg/Grouping/FreeText (the USMTF set-extractor family, ato-sets.js), getHull (accessor
beside getHulls).
