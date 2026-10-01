# DATA-1 report (facility data has one source, the JSON)

Branch `lane/DATA-1-facility-json`, base e2cd0fa.
```
adf6a62 behaviour(DATA-1): a missing or invalid facility file is a startup error; no merge with the shipped copy
78eb359 refactor(DATA-1): facility-schema.js and a lazy facility load
8476c41 refactor(DATA-1): facility-config.js holds no Facility literals
1387ae9 refactor(DATA-1): four complete shipped facility JSONs equal to the literals
9685e2b refactor(DATA-1): soak fixtures copy the shipped facility JSONs
```
- Suites (clean archive of e2cd0fa -> now): crc-sync 2098 tests / 2097 pass -> 2121 / 2120 (+23: 13 schema, 10 loading; 1 todo both); crc-desktop 866 / 865 -> 866 / 865. 0 failures either side (an unrelated timing test, "ato tokenize: pathological inputs", failed once under load and passed alone).
- Golden: identical in every commit (freeze 47/47); the behaviour commit changed no trace, so nothing was re-recorded. `freeze:selfcheck` not run (no mutation retargeted); `soak:selfcheck` not run (no board-store/wire/hub file touched; the soak fixture change is exercised by the freeze run).
- Acceptance: `grep -n DEFAULT_ facility-config.js` shows only `DEFAULT_FACILITY_ID` (kept in code, P2 default; no config file names a default Facility). `setFacilityConfig` still writes `state/` (override path if set), never `config/` (tested).

## Code as found (step 0)
- Shipped INCIRLIK/CENTER JSON vs `{...literal, ...onDisk}`: every key present in both was EQUAL. Literal-only keys: INCIRLIK `positionClasses, positionLetters, positionRadars, singleFrequencyApproach, dataOnly, standingReleases, aitAuthorized, fieldState`; CENTER `positionClasses, positionLetters, positionRadars`. Script: `node -e` over `fc.DEFAULT_CONFIGS` and `config/*.json` comparing `JSON.stringify` per key (kept in the lane scratchpad `step0.js`/`eq.js`); after generating the four JSONs, deep-equal and key-order-equal to the literals held for all four.
- Require-time consumers: facility-config itself (the `configs` Map and the shipped read) was the only require-time reader; no other module calls an accessor at require time except `server.js:695` (`for (const facilityId of efspFacilityConfig.getFacilityIds())`, a top-level loop in server.js, so it now triggers the lazy load when server.js loads; APP owns that file). The soak/freeze harness pointed `CRCSYNC_CONFIG_DIR` at an empty dir to force the literals.
- RANGES stays derived in code (`_rangesConfig()`, rebuilt on load); no JSON for it.

## What changed
- `config/efsp-facility-{incirlik,center,tactical,carrier}.json`: complete, no merge needed. JSON carries no comments, so the doctrinal/[SOURCE-DEFINED] comments that sat in the literals live only in git history (8476c41^) - L20 may want them restated in the guide.
- `src/efsp/facility-schema.js`: `validateConfig` + helpers moved verbatim; new `validateFacilityConfig(config, expectedId)`: required keys and types, facility id matches, unique non-empty positions, a class for every Position, covering chain names known Positions and has no loop, Bay Racks non-empty/unique, bayId unique per Facility, `holdsRole` a known Role, `hiddenBlocks` Roles known. facility-config re-exports `validateConfig`, `validateRadarSelector`, `validateSfaRotationRecord`, `BAY_VIEWS`.
- `facility-config.js`: `load()` (idempotent, `{reload}` to force) reads env overrides and files on first accessor use; `createEfsp` calls it (one line in index.js). `getShippedConfig(id)` (config/ only) replaces the exported `DEFAULT_*` literals for tests.
- Read order (S-DATA1-0 (3)): override path if it exists, else `state/`, else `config/`; write path unchanged.

## Behaviour commit (plan 6/7)
Missing file (all three places), unparseable JSON, or a file failing `validateFacilityConfig`: `load()` throws `[efsp-facility-config] <ID>: ...` (naming the file and message). No fallback, no merge. `setFacilityConfig` takes the whole file. Tests that asserted the old behaviour: "loading an on-disk config that fails validation falls back to ..." and "the actual committed seed ... round-trips" were vacuous (ESM `?query` re-imports reuse the cached CJS module), replaced by 12 child-process tests (each read branch, missing-everywhere, invalid, partial/no-merge, non-JSON, legacy blockVisibility, state/ write and re-read, whole-file setFacilityConfig, id mismatch). `setFacilityConfig` tests in efsp-facility-config now patch `aitAuthorized` instead of renaming `facility`.

## Files touched outside Owns
`crc-sync/tools/soak/host-client.js` (writeFixtures copies the four JSONs into config-empty; own commit 9685e2b, approved S-DATA1-0) and a comment in `tools/soak/host-env.js`; `tests/efsp-alert-scramble.test.mjs`, `tests/efsp-incirlik-l18-config.test.mjs` (use `getShippedConfig`); `tests/freeze/freeze-tables.test.mjs` (reads the loaded configs, golden identical); `crc-desktop/tests/overflight-shared-state-names.test.js` (drops facility-config.js from ALLOWED: the INBOUND/HANDED_OFF names left the file). Commit order note: 9685e2b copies tactical/carrier JSONs that arrive in 1387ae9, so the soak commit alone is not green; carry both together.

## Defaults taken (P2)
`DEFAULT_FACILITY_ID` kept in code; legacy `blockVisibility` warning kept (BACKCOMPAT); impliesState is only checked to be a string (nla.js requires facility-config, so the state list cannot be imported without a cycle).

## Findings for other lanes
- Stale prose naming `DEFAULT_CONFIG` in shared docs: `docs/efsp-briefing.md` (~467, ~973), `docs/efsp-wp6-plan.md` 297/304, `docs/efsp-parallel-plan.md` 148; CLAUDE.md's "config/ holds shipped defaults ... a read prefers state/ and falls back" still true, but a state/ facility copy is now whole-file.
- A deployed `state/efsp-facility-*.json` written by an old build (partial or whole) will now be a startup error if it lacks keys; the old loader merged. Supervisor: check the server's state volume before deploying.
- server.js top-level `getFacilityIds()` (line 695) now triggers the load at server require time; fine, but APP may prefer an explicit `efsp.facilityConfig.load()` there.
