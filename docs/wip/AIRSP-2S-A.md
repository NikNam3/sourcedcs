# AIRSP-2S-A: the airspace registry core in crc-sync

## Step 0 (base 6ffc6b8)

Suites at base: crc-sync 2118 tests (2117 pass, 1 todo), freeze 48/48, crc-desktop 884 (882 pass, 2 todo).

### Code as found (by symbol, post-refactor)

- `src/efsp/airspace-store.js` `AirspaceStore(airspaceConfig, {occupancyFor, clock})`: one `Map` of records keyed by id, seeded from
  `airspace-config.js` at construction. `apply(mutation, actingPositionId, by)` runs NOT_FOUND, `baseRev`, then six ops
  (`_schedule` .. `_return`). `_isControlling`/`_isUsing`/`_denied` are store-local authority (the AUTH follow-up).
  `_recordAudit` writes `facilityId` from config (null for unknown), `after` is the record only (no definition).
  `snapshot()`/`restore()` are an array of records; definitions come from config on every boot.
  `isActive(id)` is read by `forwarding-obligations.js`. `currentSeq` is a `SyncLog` counter.
- `src/efsp/airspace-config.js`: require-free pure validator `validateAirspaces(list)`, lazy `_load()` of
  `config/efsp-airspaces.json` (array, `[]`), `getAirspace(s)`, `getRangePositionIds()`, `setAirspaces()` (no caller). Its
  `isValidFrequency`/`isValidAltitude`/limits are imported by `flight-data-store.js` and `board/strip-util.js`.
- `facility-config.js` `_rangesConfig()` derives the RANGES Facility's Positions from `airspaceConfig.getRangePositionIds()`
  inside `load()`, before any store exists.
- `stores.js` REGISTRY entry `airspaces` (audited; `build` closes `occupancyFor` over `facilities`), `ENTRY_SHAPES.airspaces`
  is `arrayOf(anyOf(...record keys))`; `RESTORE_ORDER` restores it second (before boards).
- `index.js` `createEfsp`: `_validateAirspaceReferences(facilities)` only warns; `airspaceFor` rule is `store.getAirspace`;
  `ctx.airspaceStore`, `ctx.airspaceConfig`; `_restore` reads the file once; `_reconcileLogTail` only voids lines with a `stripId`.
- `wire/families/airspace.js`: `gate: 'primary-somewhere'`, `apply` builds the store mutation, `ack` = airspace/reason/detail/warning/occupied/airspaceSeq,
  delta `{airspaces:{updated:[…]}}`, snapshot `getAll()`. `wire/skeleton.js` `run(family, ctx, session, msg, persist)`;
  replay cache stores `{ok,reason,detail,warning,id}` only (memory).
- `authority/`: Position families register `permissions` (Strip ops) and `capabilities`; there is **no airspace row anywhere**, so
  authority for airspace ops is only the store-local check. RANGES Positions have class `USING_AGENCY` (no family).
- `metrics.js` tap: `_post` counts any `*-mutation`; refusals before the store get an `unaudited` log line. No airspace classification exists.
- `app.js` builds `createEfsp({clock, transitionAltFt, paths})` before `missionSession`; the theater is `missionSession.current().theatre`.

### Design notes taken at step 0

- File renamed to `airspace-schema.js` (ARCH-plan 2.7 name); importers updated.
- RANGES Positions: createEfsp reads the saved snapshot once, up front, and derives them from every theater's saved definitions plus the
  unseeded standing list, handing the ids to `facility-config.js` (`setRangePositionIds`) before the Facility loop. The store applies the same seed after restore.
- Authority: a new `airspace` column on Position families (`create`/`edit`/`delete`/`use` scopes), a class row for `USING_AGENCY`, and a
  `SERVICE_ROWS` table (SQUADRON_ADMIN, SEED) in `authority/airspace.js`; the store asks the registry.
- The service path is `efsp.applyAsService(principal, msg)`, the same `skeleton.run` over the airspace family with a session that carries `servicePrincipal`.
