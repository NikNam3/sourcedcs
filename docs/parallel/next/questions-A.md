# Questions, wave A (post-refactor code lanes)

Questioner, 2026-10-02. Read-only: nothing here changed code. Base `6ffc6b8`; lane state read from each worktree
`/home/nklx/dev/personal/sourcedcs-<DIR>` (committed + uncommitted) at the time of writing. File:line is in the main
checkout (`6ffc6b8` content) unless a lane worktree is named. decisions.md is not re-asked; where a point touches a
ruling it says which part the ruling did not reach.

Format: each point has evidence, why it matters, a recommended answer and an owner. **B** = blocking for the named step.

## Summary

| Id | Lane | Owner | Blocking |
|---|---|---|---|
| QA-ALL-1 | AUDIT-GAPS, DATA-3, MAPKEY, BRIDGE, ESM-GUARDS | supervisor | no (process) |
| QA-ALL-2 | all | supervisor | no (merge plan) |
| QA-VERSION-1 | VERSION | VERSION | **B** before the first post-VERSION `wire:record` |
| QA-VERSION-2 | VERSION | supervisor, human informed | **B** before step 6 (deploy gate) |
| QA-VERSION-3 | VERSION | VERSION | no |
| QA-DATA-3-1 | DATA-3 | DATA-3, supervisor OK | **B** before item 6 |
| QA-DATA-3-2 | DATA-3 | DATA-3 | no |
| QA-DATA-3-3 | DATA-3 | DATA-3 | no |
| QA-UNDO-S-1 | UNDO-S | UNDO-S, supervisor | **B** before SJ-S/CR-S are cut |
| QA-UNDO-S-2 | UNDO-S | UNDO-S | no (step 2) |
| QA-UNDO-S-3 | UNDO-S | UNDO-S | no (step 3) |
| QA-UNDO-S-4 | UNDO-S, CR-S | supervisor | no |
| QA-AIRSP2SA-1 | AIRSP-2S-A | AIRSP-2S-A | no (step 3) |
| QA-AIRSP2SA-2 | AIRSP-2S-A, 2S-B | AIRSP-2S-A | no (step 3/9) |
| QA-AIRSP2SA-3 | AIRSP-2S-A | AIRSP-2S-A | **B** before step 2 merges |
| QA-AIRSP2SA-4 | AIRSP-2S-A, 2W | supervisor | no |

Top five: QA-VERSION-2, QA-VERSION-1, QA-UNDO-S-1, QA-AIRSP2SA-3, QA-DATA-3-1.

---

## Cross-lane

### QA-ALL-1: five lanes have committed code with no step-0 note to review
- Evidence: no `docs/wip/AUDIT-GAPS.md`, `DATA-3.md`, `MAPKEY.md`, `BRIDGE.md` or `ESM-GUARDS.md` in their worktrees
  (BRIDGE and ESM-GUARDS have only a `docs/wip/<LANE>/` directory). Meanwhile AUDIT-GAPS has 6 commits (all items done),
  DATA-3 4, MAPKEY 3, ESM-GUARDS 4, BRIDGE 1. README line 94-96: "The questioner reads each lane's step-0 note … before
  the lane writes production code."
- AUDIT-GAPS also committed the `metrics.js` subject-key edit (`976c21c`, `hullId`/`rackId`), which its briefing
  froze ("ask main first"). The edit itself is right: the tap's subject list is `stripId, airspaceId, flightDataId,
  marsaId` (`crc-sync/src/efsp/metrics.js:921`), and the carrier and SFA families' subjects are `hullId`/`rackId`
  (`wire/families/carrier.js:25`, `sfa.js:24`), so without it the new log entries name nothing.
- Why: the step-0 review cannot happen after the fact, and frozen-file edits slip through unseen.
- Update: AUDIT-GAPS and MAPKEY have since written their notes (reviewed below), and AUDIT-GAPS's note says the
  `metrics.js` edit was approved. DATA-3, BRIDGE and ESM-GUARDS still have none.
- Recommended: ask DATA-3, BRIDGE and ESM-GUARDS for their "Code as found" + "Defaults taken" notes (short). Since AUDIT-GAPS merges first, UNDO-S and
  2S-A pick that hunk up through the merge.
- Owner: supervisor.

### QA-ALL-2: shared files the README's table does not list (found in the lanes' diffs)
- Evidence (from `git diff 6ffc6b8` + untracked files in each worktree, and the briefings' Owns):
  - `crc-sync/src/efsp/authority/index.js`: AUDIT-GAPS (narrowing exports in `module.exports`) and 2S-A (the
    `airspace` column in `registerPositionFamily`, `AIRSPACE_ROWS`, exports). UNDO-S's "op-kind lines for `Undo`" may add a third.
  - `crc-sync/src/efsp/index.js` `createEfsp`: UNDO-S (build the history, one line per Board) and 2S-A (RANGES ids read
    up front, `applyAsService`, `currentTheater`, `routeOccupancyFor`; `docs/wip/AIRSP-2S-A.md` design notes).
  - `crc-sync/src/ws-hub.js`: UNDO-S needs "a few lines" to deliver `efsp-undo-voided` as directed frames
    (`sourcedcs-UNDO-S/docs/wip/UNDO-S.md:70-72`), beside VERSION's `attach`/`_admit` and WIRE-B's `_tick`.
  - `crc-sync/src/app.js`: VERSION adds `downloadUrl` to the `WsHub` constructor and a test-reset hook
    (`sourcedcs-VERSION`, `app.js` ~280, ~636); the table names only MAPKEY, 2S-B, TOFI-REGIME.
  - The `airspace-config.js` → `airspace-schema.js` rename (2S-A `4e0fe88`) changes the require line in
    `board/strip-util.js` (AUDIT-GAPS edits that file), `flight-data-store.js` (UNDO-S owns its write hook next),
    `stores.js`, `facility-config.js`. SJ-S and CR-S are cut before 2S-A merges, so any new `require('../airspace-config')`
    they add breaks only at merge.
  - `crc-desktop/tests/fixtures/module-graph-exports.json`: BRIDGE (bridge section), ESM-GUARDS (`altimetry.js`, maybe
    `app.js`), MAPKEY (`maptiler-key.js`, committed `e6af830`), and VERSION (two new modules) — four lanes, not two.
  - Freeze goldens: AUDIT-GAPS changed `scenario-carrier-l17.json` (`unaudited:true`), DATA-3 re-recorded 16 golden
    files (`hub-*`, `scenario-carrier-l17`, …).
  - VERSION adds `e2e/update-required.spec.js` and merges **before** BRIDGE, so BRIDGE's "no spec reads a bare app
    name" check never saw it.
- Why: each is a small conflict, but the two fixtures and the goldens are JSON blobs where a textual merge is wrong.
- Recommended: add these rows to the README table. At merge: regenerate the module-graph fixture on the merged tree
  (`GOLDEN_RECORD=1`, `crc-desktop/tests/module-graph.test.mjs:160`) and review the diff; on any golden conflict take
  one side and re-record with `npm run freeze:update` on the merged tree, listing the union of the moved traces; after
  merging BRIDGE, re-run its bare-name grep over VERSION's new spec.
- Owner: supervisor.

## VERSION

### QA-VERSION-1: `wire:record` bumps on every run until a release ships the file  **B**
- Evidence: `sourcedcs-VERSION/crc-sync/tools/wire-record.js:39-50`: `releasedProtocol()` returns `null` when the file is
  missing at the last tag, and `shouldBump(current, released)` is `released === null || current === released`. The last
  tag is `crc-desktop-v1.5.0` (`git tag -l 'crc-desktop-v*'`), which has no `wire-protocol.js`. The briefing asked for
  this (VERSION.md:76 "no tag, or the file is missing at the tag, it bumps"), but its deploy gate says "a tag without the
  file means protocol 1" (VERSION.md:138).
- Why: the README merges UNDO-S, 2S-A, WIRE-B and SYNC-B-S each with a `wire:record`. Each one bumps again (2→3→4→5…),
  where the rule's intent is "several lanes between two releases share one bump". Harmless for safety, but the number
  stops meaning anything, and the two halves of the design disagree.
- Recommended: a tag without the file reads as protocol **1** (as the gate does). `null` only when there is no tag at all.
  Then current 2 ≠ released 1 and nothing bumps until a client speaking 2 is released. Add the case to the protocol test.
- Owner: VERSION.

### QA-VERSION-2: the deploy gate blocks every deploy, including the fixes it may need  **B** (step 6)
- Evidence: `.github/workflows/deploy.yml` has one SSH step that does `git pull`, then pulls and recreates
  `main-website atobrief crc-sync`. The briefing puts the gate **before** that step and fails closed (VERSION.md:132-145),
  including when `GET https://sourcedcs.page/api/releases/latest` is unreachable; that API is served by `main-website`
  itself (`sourcedcs-web/server.js:167`). The release workflow uploads to that same server first, then dispatches the
  crc-sync rebuild unconditionally (`crc-desktop-release.yml:101-119`). CLAUDE.md records why the dispatch is
  unconditional: once a stale server-side config (the nginx body limit) blocked the upload, and only the redeploy's
  `git pull` could fix it. The gate also applies to `dev` (`deploy.yml` runs for `main` and `dev`), where crc-sync is
  normally ahead of the client released from main.
- Why: with the gate in front, a wire bump on the server side blocks the `git pull` and the atobrief/sourcedcs-web images
  too. If the client upload needs a server config fix, the release never publishes, so the gate never passes. If
  sourcedcs-web is down, a deploy that would fix it is refused. This is the same deadlock CLAUDE.md warns about, and the
  only way out is the human's `skip_protocol_gate`.
- Recommended: the gate decides only about **crc-sync**. Always do `git pull` and pull/recreate the other services.
  On a mismatch (or an unknown published version), leave crc-sync on its running image
  (`docker compose up -d --no-deps` for the other services) and fail the job at the end with the message, so it is red
  and visible. Run the gate only for the `main`/production deploy. Keep `skip_protocol_gate`.
- Owner: supervisor rules (it changes a settled design); human informed (R3-79 deploy policy).

### QA-VERSION-3: the default `downloadUrl` opens the homepage, and prod never gets the env
- Evidence: the briefing's default is `https://sourcedcs.page/download` (VERSION.md:89). sourcedcs-web serves `public/`
  with `express.static` and no `extensions` option (`sourcedcs-web/server.js:116-121`), so `/download` falls through to
  the SPA fallback `index.html` (`:232-234`). The page is `download.html` (linked as `href="download.html"`,
  `public/index.html:82`). VERSION reads `env.CRCSYNC_DOWNLOAD_URL` in `createApp` but owns only `crc-sync/.env.example`.
  Without a compose pass-through line, the container never sees it.
- Recommended: use `https://sourcedcs.page/download.html`, add the pass-through line to `infra/docker-compose.yml` and the
  root `.env.example` (the README table already gives VERSION one line in each), and say in RUNBOOK that the key is
  omitted when unset.
- Owner: VERSION.

Checked, no point: the per-frame `version: 1` stays, and the soak never goes through `attach()`
(`tools/soak/host-core.js:87` "never attach()", `:159` `_onConnect` direct), so `_admit` cannot touch soak fault injection.
VERSION's D1 (a `POST /__test/wire-protocol` route instead of a process env) avoids patching the shared e2e crc-sync. That is right.

## DATA-3

### QA-DATA-3-1: item 6's `weatherRef` can never be used  **B** (item 6)
- Evidence: the theater and the airports arrive in **one** fetch: `fetchMissionData` runs `GetTheatre` in the same
  `Promise.allSettled` as the airbases (`crc-sync/src/grpc-client.js:448-469`). `mission-load` is emitted only when
  `airports.length > 0`, and `_weatherRef` is set from `airports[0]` in that same callback (`:164-176`). There is no
  moment when the theater is known and an airport is not.
- Why: item 6 would ship 14 `[SOURCE-DEFINED]` points for the squadron to verify, plus a validator and an override rule,
  for a value no code path reaches. The real behaviour change is only "no poll before mission data".
- Recommended: drop `weatherRef` from `theaters.json`. `_weatherRef = null` in the constructor, and `_fetchWeather`
  returns while it is null (the client keeps ISA, the briefing's own default). The airport rule stays as it is. Still a
  `behaviour(DATA-3)` commit. Take it off the squadron-to-verify list.
- Owner: DATA-3, with the supervisor's OK (deviation from the briefing).

### QA-DATA-3-2: one more copy of "6000–6777" outside the lane's Owns
- Evidence: `crc-sync/src/efsp/ato/ato-sets.js:316` (`MODE3_SYNTHETIC` warning text) still spells the range in
  `sourcedcs-DATA-3` after `14b58ff`. The acceptance grep (DATA-3.md:147) does not look for it.
- Recommended: build that text from `synthetic-block.js` too (one line). Ask "main" for the file.
- Owner: DATA-3.

### QA-DATA-3-3: the new sensor-specs/theaters keys are not under the strict state/ key check
- Evidence: S-RENA2 says "the state/ tuning layers check keys against an explicit allow-list". `tuning-file.js`
  `readLayer(name, override, shipped)` does that (`:31-56`), but `loadSensorSpecs` hand-merges its layer
  (`radars.js:88-117`) and `loadTheaters` merges entries itself (`theaters.js:45-55`). Neither checks keys. A
  `state/sensor-specs.json` with `fieldRadars` (typo) or a stale `transponder.syntheticBlock` shape would be ignored
  silently. Also, a `state/efsp-carriers.json` copied from the old shipped file has `"angledDeckDeg": null`, which
  `50ed054` now makes a load error.
- Recommended: in this lane, validate the **merged** values (as `sensor-config.js` does) and run `checkLayerKeys` on the
  sensor-specs layer, which is a few lines since `readShipped` is already loaded. Leave theaters' warn-and-drop rule alone.
  Add a release-note line: "a state/efsp-carriers.json copy must give every hull an `angledDeckDeg`".
- Owner: DATA-3.

## UNDO-S

### QA-UNDO-S-1: the contract cannot say "only some actions of this op are undoable"  **B** (before SJ-S/CR-S cut)
- Evidence: the contract is per op module: `undo: 'none' | { label, scope, created? }`
  (`sourcedcs-UNDO-S/crc-sync/src/efsp/undo/undo-history.js:4-24`, commit `069fdb7`). `board/ops/coordination.js` and
  `board/ops/tofi.js` each carry many actions. ADR 0100 §1 (draft :59-60) makes only HANDOFF `TRANSFER_COMMS`,
  `TRANSFER_CONTROL` and TOFI `MARK_ENTERED` undoable, plus TOFI `PROPOSE` (UNDO.md "the H95 four"). `begin()` accepts
  `scope: null` ("not undoable, but observed", :26-27), but the contract never says a module's `scope()` may return null.
- Why: CR-S and TOFI-REGIME are cut from this commit and will each invent a way: a second key, a per-action table, or
  `'none'` on the whole module.
- Recommended: amend the contract comment and the op-table test now, before the commit id goes to "main": "`scope()`
  may return `null`: this instance is not undoable (no record, no `undoable` in the ack); `label` is then not called".
  Show it with TOFI (PROPOSE undoable, other actions null). Tell SJ-S that S10/S11 (restore) can only go green after
  UNDO-S step 2 merges, so they stay `test.todo` until then.
- Owner: UNDO-S. The supervisor relays it to SJ-S/CR-S.

### QA-UNDO-S-2: frameless controller writes count as "system changes"
- Evidence: the design says a write outside an `applyMutation` frame "is a system change … and blocks"
  (`undo-history.js:28-31`; `UNDO-S.md:53-60`). Controller actions that write flight data outside a Board frame include:
  the MARSA family (Declare/End write `tofi.separationRegime` through the injected writer, `marsa-store.js:96`, `:526`,
  `efsp/index.js:170`); the ATO import (`ato/ato-board.js:519` `applyAtoTasking`); and every carrier/SFA/runway-status
  family op that reaches flight data. These go through `wire/skeleton.js` `run`, not `applyMutation`.
  `correlation-reconciler.js:318` `setBeaconObserved` is observed and is correctly ignored.
- Why: a MARSA declared on a just-handed-off flight within 10 s would refuse the undo with "a system change". ADR 0100 §4
  treats a later controller change as void-or-block **naming that Mutation**.
- Recommended: open a frame in `skeleton.run` too, or in efsp-ws's dispatch, with the session's Position and Facility.
  Then these writes are attributed Mutations: they block, since they reach a side store, and the refusal names them. In
  "Code as found", list every frameless writer with its class (observed / system / Mutation). Test: a correlation match
  inside the window does not block; a MARSA declare blocks and is named.
- Owner: UNDO-S. `skeleton.js` is shared with AUDIT-GAPS (merged first) and 2S-A, so it is a one-line hunk to ask "main" about.

### QA-UNDO-S-3: putting `undoable`/`actionId` into the replay record breaks restart
- Evidence: U12 wants cached acks on a re-sent action. The Board replay record is built by `replayRecord()`
  (`sync/replay-cache.js:52-66`), and the last 10 min of it is **persisted** in the Board snapshot. On restore the
  keys are allow-listed: `stores.js:297-298` (`ok, reason, detail, warning, routedTo, selfCoordinated, stripId,
  flightDataId, peerFacilityId, peerStripId, appliedWallAt`), and an unknown key is a startup error (`:332`).
  `stores.js` belongs to 2S-A this wave.
- Recommended: keep undo fields out of `replayRecord`. A replayed original action answers without `undoable` (U13
  already says nothing survives a restart, so a replay inside the process can read `history.recordOf(actionId)`).
  If a field must persist, ask "main" for the `stores.js` line.
- Owner: UNDO-S.

### QA-UNDO-S-4: U23 needs CR-S's holders, which do not exist yet
- Evidence: U23 (UNDO.md table) and ADR 0100 :106-109 refuse a restore whose HANDOFF record names a retired comms or
  control holder. Those holders and `assertControlInvariant` are CR-S's (S-DESK4; CONTROL-RELEASE.md:41, :132-133). CR-S
  merges after UNDO-S.
- Recommended: UNDO-S provides a restore-guard hook (a list of `(plan) → refusal|null` that the Undo op runs in its
  "validate, then apply" phase), and leaves U23 as `test.todo` naming CR-S. CR-S registers the invariant guard and turns
  U23 into its I8 case.
- Owner: supervisor (splits the test between the two lanes).

## AIRSP-2S-A

### QA-AIRSP2SA-1: a web edit to another theater is broadcast into the current theater's panels
- Evidence: the service path names its theater (ADR 0098 §9, web `crcsync-client.js:73-77`). The family broadcasts every
  ok result as `airspaces.updated` to every session (`wire/families/airspace.js:52-58`). Ids are unique only per theater
  (ADR 0098 draft :54-55). The client keys airspaces by id. `fromCached` re-reads with `getAirspace(id)`, which after
  2S-A sees the current theater only (`airspace.js:41`).
- Why: an admin editing Syria's `R-1` while Caucasus is loaded overwrites Caucasus's `R-1` on every panel until the next
  snapshot.
- Recommended: broadcast (and bump the seq) only when the record's theater is `currentTheater()`. The service caller still
  gets the ack. Put `theater` on the ack. A cached replay reads the record by `(theater, id)`.
- Owner: AIRSP-2S-A.

### QA-AIRSP2SA-2: pin the ack fields the merged web side already reads, including on replay
- Evidence: the web reads `ok`, `reason`, `detail`, `conflicts:[{field, base, theirs}]`, `warning ===
  'AIRSPACE_EDITED_OCCUPIED'`, `occupied` (strings or `{callsign|stripId}`), and `blockers || occupied` on a delete
  refusal (`sourcedcs-web/public/js/airspace-admin.js:333-358`; `docs/wip/AIRSP-2W.md:41-46`, S-M-AIRSP2W "ack field
  names assumed"). The families' replay record keeps only `{ok, reason, detail, warning, id}`
  (`wire/skeleton.js:62`, `sync/replay-cache.js:69-78`), so a retried POST loses `conflicts`, `occupied`,
  `staleEntries`, `created/skipped` and `effectiveAtRestart`.
- Recommended: use exactly those names. Add `blockers: [{kind, id, callsign?}]` on a delete refusal, besides the detail
  text. Keep the extra ack fields in the remembered outcome (`familyRecord`; DATA-3 touches only the export line of
  that file). Add one test that replays a STALE_REV and gets the same `conflicts`. 2S-B's "idempotent replay" test
  depends on it.
- Owner: AIRSP-2S-A.

### QA-AIRSP2SA-3: the old persisted array passes the shape check silently  **B** (step 2)
- Evidence: `ENTRY_SHAPES.airspaces` is `arrayOf(...)` today (`stores.js:303`), and the new entry is
  `{byTheater, seeded}` (ADR §10). `checkPersistedShape` returns without a check when the value is an array and the
  shape has no `'[]'` (`stores.js:327`). So a production `state/efsp-board.json` with `airspaces: [...]` passes,
  restores as an empty registry, and the next persist overwrites it: silent loss. The same applies to a
  `state/efsp-airspaces.json` array copy, which ADR §10 says overrides the standing list "whole". H88 item 8 / S-RENA2
  require a loud start-up error.
- Recommended: refuse an array (or any type mismatch: object shape, array value) loudly, naming the file and key. Better
  still, make `checkPersistedShape` fail on object/array mismatch generally, with a test. Give `definition`/
  `definitionHistory` explicit shapes (or a deliberate `true`, stated). Test that both old files stop start-up.
- Owner: AIRSP-2S-A.

### QA-AIRSP2SA-4: theater names typed by hand on the web are stored as given
- Evidence: the web's theater picker "can add a theater name by hand" (`docs/wip/AIRSP-2W.md:36-37`). The registry keys
  on the string. RANGES Positions are derived from **every** theater's definitions (ADR §8). `config/theaters.json` lists
  the 14 known `GetTheatre` names.
- Why: a typo (`Caucausus`) makes a theater that never loads, and it can still add RANGES Positions at restart.
- Recommended: the service path refuses a theater that `loadTheaters()` does not know (config + state layer):
  `VALIDATION_ERROR` "unknown theater …; add it to theaters.json". A new DCS map then needs one data line, consistent with H13.
- Owner: supervisor (2S-A builds it; 2W's picker shows the refusal as it already shows refusals).

## Pre-check items found clean

- BRIDGE: production code reads no bridged global. 0 `window.<export>`/`globalThis[...]` reads and 0 `typeof` guards on
  an undeclared bridged name, scanned against the fixture's 674 names. `airspace-panel.js:79` `window.fromUtc` is a
  parameter named `window`. Deleting the bridge changes no app behaviour.
- BRIDGE vs ESM-GUARDS: the fixture sections are disjoint, but see QA-ALL-2 (four writers).
- Old names: UNDO.md's pre-RENAME symbols all map through the glossary (`reacquireFdr` → `reacquireFlightData`,
  `_applyCarrierTransfer` → `_applyCarrierHandoff`, `_releaseFdrIfLastStrip` → `_releaseFlightDataIfLastStrip`), and
  UNDO-S's step 0 did it. AIRSP-2-server's `NOT_HOLDING_POSITION` is still the code (`wire/skeleton.js:45`).
  AUDIT-GAPS's "NOT_SIGNED_ON" does not exist as a code and needs nothing.
- DATA-3's comm card goes through the strict `readLayer(..., shipped)` (`sourcedcs-DATA-3/crc-sync/src/comm-card.js:55-57`).

## Step-0 reviews

- **VERSION** (`docs/wip/VERSION.md`): the code as found is accurate (the `verify-main` correction included). D1 is
  good. Open: QA-VERSION-1 (already built as briefed, `4b99677`), QA-VERSION-2 (step 6 not started), QA-VERSION-3.
- **UNDO-S** (`docs/wip/UNDO-S.md`, contract `069fdb7`): the symbol map is complete and correct after RENAME. The
  side-effect table is the useful part. Open: QA-UNDO-S-1..4. The "few lines in ws-hub.js" are in QA-ALL-2.
- **AIRSP-2S-A** (`docs/wip/AIRSP-2S-A.md`): the code as found matches the base. Reading the RANGES ids from the
  snapshot before the Facility loop is sound. Open: QA-AIRSP2SA-1..4. The rename's reach is in QA-ALL-2.
- **AUDIT-GAPS** (note written after the code): all six items done, and freeze identical for the refactor commits.
  The `metrics.js` edit was approved by "main" (its note says "the approved key-list edit"). The SFA subject is
  `op.rackId`, which needed one more line. Nothing further. `mintReplica` sits in `board/strip-util.js`, which 2S-A's
  rename also touches (one require line; QA-ALL-2).
- **MAPKEY** (note written after the code): the TileJSON source became inline `tiles` so that the map `load` event never
  waits on a failed TileJSON request. The listener fires only when the key changes (`maptiler-key.js`), so reconnects do
  not reload tiles. Sound. The remaining risk is the `maxzoom 14` assumption, which the lane states; a live check with a
  real key is the human's. No point.
- **DATA-3, BRIDGE, ESM-GUARDS**: no step-0 note yet (QA-ALL-1). DATA-3 was reviewed from its commits (QA-DATA-3-1..3).
  BRIDGE's and ESM-GUARDS's risks were cleared by the pre-check scan (see "Pre-check items found clean").
