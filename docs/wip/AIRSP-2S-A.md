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

## What was built (final)

- `src/efsp/airspace-schema.js` (renamed from `airspace-config.js`, import-line-only commit `4e0fe88`): `validateAirspaceDefinition(def, {derived})`
  (pure; `refuse` for a client's definition, `recompute` for a stored or merged one), `loadStandingList({paths})`, the constants (`DEFINITION_HISTORY_CAP` 50,
  `MAX_NAME_LENGTH`, `MAX_ROUTE_SEGMENTS`, `MAX_WIDTH_NM`, the id pattern), `ACTIVATION_BY_KIND`. `setAirspaces`, the require-time/lazy load and `getRangePositionIds` are gone.
- `src/efsp/airspace/containment.js`: pure geometry (`MAX_POLYGON_VERTICES` 200, `CIRCLE_POLYGON_POINTS` 64, local equirectangular projection, boundary inclusive).
- `src/efsp/airspace-store.js`: the registry. `apply(mutation, actor)` (actor = `{positionId|service, via, controllerId}`; the old 3-argument form is gone), Create/Edit/Delete/Import/DelayActivation,
  `defRev` + `definitionHistory` + per-field conflicts, R3-23 gate, delete guard, occupied warning with `staleEntries`, `isActiveFor`/`activeContaining`/`containing`, `seed`, `snapshot`/`restore`
  (`{byTheater, seeded}`), `hasApplied` (log-tail reconcile), `checkReferences` (the hard check), `deriveRangePositionIds`.
- `src/efsp/authority/airspace.js` + an `airspace` column on the Position families (`civil-atc`: OPS 'FACILITY', CD/GC/LC/AP/CTR 'OWN'; `tactical`: TAC_C2 `use`), a `USING_AGENCY` class row (control frequency only, `use`),
  and `SERVICE_ROWS` (SQUADRON_ADMIN, SEED). The store keeps no authority code of its own.
- `wire/families/airspace.js` + `wire/skeleton.js` (`servicePrincipals` on a family, honoured by `_gate` for a pseudo-session the server builds) + `efsp.applyAsService(principal, msg)` in `index.js`.
- `stores.js` (`airspaces` entry, shape allow-list, an array where an object shape is expected is now a loud error for EVERY key), `index.js` (`currentTheater`, `standingPaths`, one up-front snapshot read via `_readSnapshot`
  with `checkPersistedShape`, RANGES ids via `facilityConfig.setRangePositionIds`, seed after restore, log-tail reconcile for airspace lines), `facility-config.js`, `app.js` (the one `currentTheater` line via a holder, because
  `MissionSession` is built after `createEfsp`), `config/efsp-airspaces.json` = `{}`, soak host (`SOAK_THEATER`) and freeze fixtures.

## Ack and wire contract (for 2S-B and sourcedcs-web; pinned by `tests/airspace-wire.test.mjs`)

`efsp-airspace-ack`: `{version, type, clientMutationId, airspaceId, ok, airspace, reason, detail, warning, occupied, staleEntries, conflicts, blockers, created, skipped, removed, effectiveAtRestart, theater, airspaceSeq}`.
Matches 2W's assumptions. Differences to report:
- `blockers` on a refused delete is a **string array** (`['it is ACTIVE', '1 flight is working it (VIPER 1)']`), not the `[{kind,id,callsign?}]` QA-AIRSP2SA-2 suggested: the web renders `o.callsign || o.stripId || JSON.stringify(o)`, so objects without a callsign would show as JSON. Strings render as they are.
- `occupied` is an array of `{stripId, callsign}` on an edit (`AIRSPACE_EDITED_OCCUPIED`) but stays a **number** on a release (`AIRSPACE_STILL_OCCUPIED`, unchanged from before, the client reads it that way).
- `ImportAirspaces` created/skipped: `created: [ids]`, `skipped: [{airspaceId, reason: 'EXISTS'}]`.
- `ack.airspace` is the record WITHOUT `definitionHistory` (bounded 50, kept in the store; `store.getHistory(id)`), `null` after a delete, and has `theater`.
- A replay answers with the same extra fields (QA-AIRSP2SA-2): the families' compact replay record's free `id` slot holds `{airspaceId, theater, extra}`; `replay-cache.js` is untouched.
- Delta: `{airspaces: {updated: [records], removed?: [ids]}}`. Not sent at all when the op's theater is not the loaded one (QA-AIRSP2SA-1); an import sends one delta with every created record.
- A service op needs `msg.theater`; `efsp.applyAsService(principal, msg)` returns `{ack, broadcasts}`: 2S-B (the router) hands `broadcasts` to the hub. The principal is `{service:'SQUADRON_ADMIN', sub, name}`, both strings required.
- Query surface for 2S-B: `airspaceStore.listTheaters()` -> `[{theater, count}]`, `getAllFor(theater)` -> records (`{definition, defRev, state, window, pendingRequest, ...}`).
- Edit/Delete require `baseDefRev` (an integer, a revision that exists).

## Answers to the questioner (questions-A.md)

- QA-AIRSP2SA-1 (cross-theater broadcast): done as recommended; test `a change to ANOTHER theater ... reaches no connected panel`; the ack carries `theater`; `fromCached` reads by `(theater, id)`.
- QA-AIRSP2SA-2 (ack fields and replay): the field names are 2W's; replay keeps every extra; `blockers` stays strings (above); test `a replayed refusal or success ...`.
- QA-AIRSP2SA-3 (old array passes silently, B): `checkPersistedShape` refuses an array where the shape is an object, for any key, naming the file and path; the store's `restore` also throws on the old array; the early up-front read uses the same check; tests for the old array, unknown keys, a bad definition, byte-identical file.
- Coordinator conditions: (1) one read, same strict check, test counts the reads (`tests/airspace-wire.test.mjs`); (2) the import-line-only rename commits `4e0fe88`, `9047a3e`; (3) the ack contract test.

## Defaults taken (P2)

- The route occupancy counts **distinct flights** (flight data), not Strips: a handoff leaves a Strip on each Board for one flight, and the ADR's "non-DROPPED Strips" would count it twice (found by the scenario test).
- Edits with no actual change answer ok with `changes: []` and bump nothing (no defRev, no seq, no history).
- An edit that changes `usingPositionId` to a Position id that belongs to a shipped Facility is refused (a RANGES Position needs an id of its own); not in the ADR text, needed because RANGES Positions are derived from it.
- Delete conflict: any edit since `baseDefRev` is a STALE_REV listing the touched fields (the deleter has not seen what it deletes).
- `definition` and `definitionHistory` in the persisted shape are a deliberate `true`; the definition is re-validated on restore (a failure is a start-up error naming theater and id), the history is trusted.
- A restored definition whose Facility or Position this build no longer has is a **warning** at restore (a Facility file may change), a hard error only for the seed and every write.
- Position ids: the class row for `USING_AGENCY` (RANGES Positions) gives `use: true`, `edit: 'FREQUENCY'`. RSU, SFA, PAR and the carrier Positions get no airspace row (they control no airspace).
- `metrics.js` needed no classification: traffic count only reads entries with a `stripId`, the airspace lines have none. A test (`none counts as traffic`) pins it. The service path bypasses the tap (`efsp.handleMessage` is what it wraps).

## Goldens and fixtures changed

Every freeze golden (`tests/freeze/golden/*.json`, 36 files: all hub-* and scenario-* traces plus scenarios.json) was re-recorded in `0d1662d`'s follow-up: each trace's snapshot digest embeds the airspaces list, whose shape is now
`{byTheater, seeded}` with `theater`/`defRev` on records and normalised definitions; no other change in the traces (the freeze suite was 48/48 on the base). Fixtures: ~35 test files wrote `[]` for the standing list
(now `{}`); the nine that load airspaces write `{ Test: [...] }` and pass `currentTheater: () => 'Test'`; `tools/soak/host-client.js` writes `{ Soak: [...] }` and `host-core.js` puts its MissionSession in `Soak`.

## Findings and notes for other lanes

- **Client (2P-A)**: the snapshot `airspaces` is now the current theater only; records carry `theater`, `defRev`, and a normalised definition (null for empty optionals, `kind`, `usingFacilityId`, `geometry`, `segments`); the delta may carry
  `airspaces.removed`. The client mirror of the authority rows is a hand copy plus a parity test (ARCH-D7), 2P-A's. The client ignores `removed` until 2P-A.
- **2S-B**: needs only `applyAsService`, `listTheaters`, `getAllFor`. The drawing-name finding (F1) and `missionFingerprint` are untouched.
- **TOFI-REGIME**: the queries are on the store (`isActiveFor`, `activeContaining`, `containing`); `ctx.airspaceStore` is already in `ctx`. The caller converts to indicated feet with `altimetry.js`.
- **wire:record**: the lane was cut before VERSION; the supervisor runs it at merge (the ack and delta fields changed).
- **Release note**: "Airspace definitions are now data: wipe `state/efsp-board.json` and `state/efsp-mutations.jsonl` (the old airspace array is refused at start-up). `config/efsp-airspaces.json` is theater-keyed (`{}`)."
- `state/efsp-airspaces.json` (the pre-0098 live copy, if one exists on a server) is read as the standing list and refused as an array: delete it.
- Walks not done: a live two-process race (covered at the store with two baseDefRevs), and the human's real `state/` (never touched).

## What the briefing (3A) and usage guide (8A) should now say

- Briefing: airspace definitions are data in the registry (ADR 0098), per theater; the panel and the web edit the same list; ops `CreateAirspace`, `EditAirspace` (`baseDefRev`, per-field conflicts), `DeleteAirspace` (guarded),
  `ImportAirspaces` (service/seed only), `DelayActivation` (ROUTE); `ApproveActivation` on a ROUTE is Confirm and `DenyActivation` is refused; the ack field list above; authority rows live in `authority/` (the `airspace` column,
  `SERVICE_ROWS`), not in the store; the standing list seeds once per id; RANGES Positions come from every theater's definitions at start-up.
- Usage guide: a controller creates or edits an airspace for which it is the controlling Position (OPS for its Facility); while an airspace is scheduled, active or released only its name and frequencies change; an edit of an occupied area
  warns and lists the flights whose entry frequency is stale; a delete needs the airspace RETURNED, no request and nobody working it; TAC_C2 schedules, requests and releases for an airspace used by TACTICAL but never edits it; a route is confirmed or delayed, never denied.
