# ARCH-S: architecture check of crc-sync (H103)

Read-only lane. Tree: `lane/ARCH-S-check` at `562d5724` (tip of `efsp-wp5-correlation`). Baseline for "grew back":
`c6a48f85` (S-REFACTOR-DONE). `npm test`: 2403/2403 pass, 25 s wall. No code changed.

Effort: **S** under half a day, **M** one lane, **L** several lanes. Risk is the risk of making the fix.

## Top 10, ranked by cost to the codebase

| # | Finding | Where | Effort | Risk |
|---|---|---|---|---|
| 1 | **BUG**: sign-on/sign-off never sees a control repair. `reconcileExchanges()` returns a number and the caller reads `.length`. A repair is not persisted, and a repair on another Facility's Board is not broadcast | `efsp-ws.js:377`, `handoff-control.js:547` | S | low |
| 2 | **BUG** (latent): the catch-all in `applyMutation` leaves an op's partial in-memory writes on the Board. They are broadcast but never audited or persisted, and the replay cache stores the result as `VALIDATION_ERROR` | `board-store.js:260-269`, `efsp-ws.js:123-127` | M | med |
| 3 | One delta frame has several builders, and WsHub has six broadcast entry points. Only two of them run the post-change hook | `ws-hub.js:190,297,305-336`, `wire/frames.js:77`, `families/ato.js:131`, `families/runway-status.js:6`, `efsp-ws.js:496` | M | med |
| 4 | Bare `Date.now()` in the Board, against ADR 0096's "injected, never bare". It forces real 410 ms sleeps in about 6 test files and makes the archive window untestable without patching `Date` | `board-store.js:269`, `strip-ops.js:608`, `persistence.js:51,85`, `ops/invoke-nla.js:16`, `index.js:612` | S | low |
| 5 | Env, paths and files are read at require time, against ADR 0095 §4. `facility-config` is a process-wide mutable singleton. As a result, 50+ test files must set `process.env` before they import | `state-paths.js:57`, `mutation-log.js:45`, `metrics.js:54`, `traffic-count.js:38`, `stereo-routes.js:141`, `apt-config.js:34`, `radars.js:74`, `terrain.js:47`, `iff.js:24`, `facility-config.js:168-190` | M | med |
| 6 | Seven stores each re-implement the same bookkeeping: SyncLog, the `currentSeq`/`epoch` getters, `setMutationLog`, `_recordAudit`, rev bump and a store-specific audit id field | `*-store.js` | M | low |
| 7 | The four-line `rev/updatedAt/updatedBy/touch` block is back in 14 Board sites (8 in `tofi.js`). The system TOFI entry bumps the rev of an unchanged Strip and borrows `placementOnly` to hide that from undo | `board/tofi.js:149..624`, `coordination.js:175,220,487`, `tofi.js:391` | S | low |
| 8 | **BUG** (minor): `warning` holds one value of mixed type (code, prose or object). The LUAW combination warning overwrites an op's own warning | `efsp-ws.js:103`, `ops/set-state.js:87`, `ops/join-formation.js:76`, `handoff-control.js:438` | S | low |
| 9 | Composition roots are god functions: `createApp` is 765 lines and `createEfsp` 323, including a 54-closure `rules` bag. Late-bound seams could be plain dependencies, and one of them fails silently (`regimeLocation` with no locator answers "unknown" forever) | `app.js:125`, `efsp/index.js:79-238,334`, `app.js:226,523` | M | med |
| 10 | Tests leave **146 temp dirs per `npm test`** (67 files). The fix is one line in the preload. There are also timing-flaky tests, and one test is 23 s of the 25 s critical path | `tests/helpers/isolate-state.mjs`, `grpc-client-stream.test.mjs:134,186`, `efsp-ato-tokenize.test.mjs:157`, `control-release-invariant.test.mjs` | S | low |

## What is fine

- **The Board facade seam holds.** `tests/board-seam.test.mjs` enforces the four rules of ADR 0095 §2. No module under `src/` reads another object's underscore members; the only hits are an object's own fields at `metrics.js:1016` and `replay-cache.js:100`. No collaborator requires a sibling.
- **The registries work as designed**: `stores.js` REGISTRY (persist, restore, `STORE_SYNC`), the wire families with one `skeleton.run`, `board/ops/<op>.js`, `authority/`, and `required-rules.js` (54 rules, checked at construction). New stores and families since the refactor (airspace registry, SFA, sync) used them rather than branching.
- **The clock allow-list test is a good guard**, and every listed site has a reason. Its weakness is that it allows bare sites the ADR forbids (finding 4).
- **Strict persisted shape for EFSP**: `checkPersistedShape`, the TRANSITING/0058/pre-WP4A refusals and the tuning `checkLayerKeys` are consistent and well tested (`efsp-restore-refusal.test.mjs`). The legacy-`board` exemption at `index.js:570` is intentional: it routes to a clearer error in `stores.js:59`.
- **Vocabulary in identifiers is clean.** The glossary's old words occur in `src/` only inside comments, as English prose ("on-station", "covering a Block"), or as the departure strip state `PROPOSED` and runway-change `PROPOSED`, which the glossary keeps.
- **The suite is fast and green**: 2403 tests in 25 s. The freeze suite is opt-in as decided.
- **One undo history** for the process, one `SyncLog` class, and `canServeDelta` as a pure function. The overlap between the undo history, the replay cache and the sync log is mostly apparent: they answer different questions (may this be undone, was this already applied, what changed since seq N). See 1d for the part that does overlap.

## 1. Wiring

**1a. BUG: the control-repair result is read as an array.** `efsp-ws.js:377`
`if (b && b.reconcileExchanges().length) controlRepaired = true;`. `HandoffControl#reconcileExchanges` (`handoff-control.js:547-556`) returns a **count**, so `.length` is always `undefined` and `controlRepaired` never becomes true. The `BoardStore` doc comment (`board-store.js:335`) says it returns "the repairs made".
- *Effect*: a Position vacated with no consolidation target leaves `reassignedIds` empty. The repair that moved comms or control to the live side is then **not persisted**. A restart restores the pre-repair holder, and boot runs `reconcileExchanges({staffing:false})` (`index.js:587`), which by design does not re-repair for staffing. The repair made on **another** Facility's Board is also not drained or broadcast in this round trip: it rides on that Board's next Mutation, or is healed by the heartbeat seq gap (ADR 0104) one heartbeat later.
- *Fix*: return the repairs array, or test `> 0`. Then collect the touched Strips of each repaired Board into a `slots.peer`-style broadcast, or one board-delta per repaired Facility. Add a test: sign-off with no consolidation, then repair, then restart, and the holder is still the repaired one.
- Effort S. Risk low.

**1b. Delta frames have several builders.** The same wire frame is assembled in more than one place, and the copies already differ in detail:
- `efsp-board-delta`: `wire/frames.js:77` `boardDelta()`, `ws-hub.js:190` `broadcastEfspBoardDelta` (always `positions:{updated:[]}`, flight data gone-only), and `wire/families/ato.js:131`.
- `efsp-correlation-delta`: `ws-hub.js:313`, `families/correlation.js:66`, and the seq-less supplement at `efsp-ws.js:496`.
- `efsp-runway-status-delta`: `families/runway-status.js:6` and `ws-hub.js:331`. The second one goes out through `_broadcast`, not `_broadcastEfsp`, so it **skips the read-scope filter**. That is harmless today only because the family has no `filter`.
- *Fix*: frame builders only in `wire/frames.js` (or the family). WsHub should receive finished frames and never build EFSP frames.
- Effort S-M. Risk low, because the goldens catch shape drift.

**1c. WsHub has six ways to broadcast, with different post-steps.**
- `_broadcast`, `_broadcastEfsp`, `broadcastEfspAlerts` (its own loop), `broadcastEfspFrames` (+`onEfspChange`), and `broadcastEfspMessage` and `broadcastEfspCarrierDelta`, which are identical one-liners at `ws-hub.js:308,311`. On top of those are `_onMessage`'s broadcasts, `directed` and `onEfspChange` (`ws-hub.js:675-697`).
- Server-originated changes skip the obligation re-check (`onEfspChange`): the TOFI monitor's `onEntered`, the NLA monitor's `setOnDelta`, the carrier tick and the archiver.
- *Fix*: one `deliver({ broadcasts, directed })` used by `_onMessage`, the HTTP service path and every monitor, which always runs `onEfspChange` when anything was sent.
- Effort M. Risk med: the obligation tick would then run more often.

**1d. Overlapping change observation.** One Strip write is observed in three ways:
- `BoardState.recordTouch` calls `_onTouch`, a single-slot `setTouchHook` used by undo (`board-state.js:27,51`);
- `SyncLog.touch`, which handles the ring and touched set and also calls `observeTouches` listeners (soak);
- the flight data's single-slot `setWriteObserver` (`flight-data-store.js:512`). Two writers race for that slot: `index.js:108`, and `board-store.js:163` guarded by `hasWriteObserver`.

*Fix*: one listener list per store (`onChange(fn)` returning an unsubscribe). Undo, soak and future taps subscribe to it. This deletes `setTouchHook`, `hasWriteObserver` and the `_ownUndoHistory` special case. Effort S. Risk low.

**1e. Two idempotency caches.** The Board's `ReplayCache.forBoard()` (persisted 10-minute window) and `ctx.replayCache` for the families (memory only, `index.js:313`). The store side is defended by `_reconcileLogTail`'s airspace branch (`_reconcileLogTail` in `index.js`). After a restart, a retried store Mutation answers `STALE_REV` instead of its original success. This is accepted per S-SYNC0, so it is listed here, not ranked.
*Fix, if wanted*: persist the families' cache through the same `BoardPersistence` window. Effort M.

**1f. Late-bound seams that can be plain dependencies.**
- `theaterSource = { current: () => null }`, reassigned at `app.js:327`. `MissionSession` needs only the clock, so build it before `createEfsp` (`app.js:226`) and pass `currentTheater` directly. S.
- `efsp.setRegimeLocator` (`index.js:334`, `app.js:523`). Until it is called, `rules.regimeLocation` silently answers `{located:false}` (`index.js:199`), so TOFI regimes stay pending forever. The track store already exists before `createEfsp` (`app.js:204`). Pass `locateTrack(trackId)` plus an altitude function into `createEfsp` and build the locator inside it. Failing that, make a missing locator a required-rule error. S.
- `setMutationLog` on the Board and on 6 stores (`index.js:247,251`) is redundant: `mutationLog` is already in `buildDeps` (`index.js:97`). The late `mutationLog: () => this._mutationLog` thunks in `BoardAudit` and `HandoffControl` exist only for this. Pass it in the constructor. S.
- Cyclic collaborator lambdas: `retire: (s,b) => this._stripOps.retire(...)` and `rejectedReplicaRefusal` (`board-store.js:101-130`). StripOps is constructed last, but Coordination, Tofi and Placement call into it. This is acceptable under the seam rules. A `Retirement` collaborator built before them would remove the cycle. S-M.

**1g. Logic in the facade.** `reassignPositionStrips` and `returnConsolidatedStrips` (`board-store.js:370-423`) hold the same move-to-new-owner block twice (bay lookup, order key, bump, `followOwner`, `recordSystem`). `receiveUndoRestore` writes the Mutation log directly (`board-store.js:186`) instead of through `BoardAudit`. *Fix*: move them to `Placement`/`StripOps` as one `moveToOwner(strip, positionId, reason)`, and the audit write to `BoardAudit.recordPeer`. S.

**1h. The bespoke Board handlers sit beside the skeleton.** ADR 0095 §3 calls `efsp-ws.js` "the one skeleton", but `efsp-mutation` (`_handleMutation`, 144 lines), `efsp-resync` and `efsp-set-positions` (82 lines) are hand-written beside `skeleton.run`. Each repeats the facility resolution, the binding gate, persist, ack and broadcast steps. The ack refusal shapes differ (2c). *Fix*: make the Board mutation a family with a `handle` that reuses the skeleton's `refuse`/`prefix`, and move `_handleSetPositions` into a `positions` module. M. Risk med (wire goldens).

**1i. Three ways to build a Strip.** `ops/create-strip.js:75`, `strip-util.js:103` (`mintReplica`) and `ops/split-formation.js:73` each assemble a Strip record and mint `crypto.randomUUID()`. The soak and freeze make ids deterministic by **monkey-patching global `crypto.randomUUID`** (`tests/freeze/freeze-determinism.mjs:19`). *Fix*: one `newStrip(fields)` in `strip-util`, plus an injected `ids` dependency (default `crypto.randomUUID`). S-M.

**1j. Two mission identities.** `ws-hub.js:140` mints `_missionId` from `Date.now()` and `Math.random()` on every `setMissionData`. `MissionSession` already has a persisted `seq` and `fingerprint`. A client that keys on `missionId` sees a "new mission" after every gRPC reconnect. *Fix*: send `missionSession.current().seq` (or the fingerprint). S. Risk: client semantics; check `app.js` in crc-desktop first.

## 2. God files

Sizes are total lines (code lines without comments in brackets). "Then" is `c6a48f85`.

| File | Then | Now | Growth | Mixes |
|---|---|---|---|---|
| `efsp/flight-data-store.js` | 1420 | 1681 (920) | +261 | record creation (`createFlightData` 213 lines), 13 hand-validated setters, `setField` (149), ATO tasking, split/join, undo restore, validation Sets |
| `app.js` | 824 | 891 (564) | +67 | `createApp` is **765 lines**: 12 inline HTTP routes, radar picture wiring, 8 monitors, weather cache, 14 tickers, ws attach |
| `efsp/airspace-store.js` | 377 | 777 (566) | +400 | per-theater map, apply/edit/import/seed, audit, occupancy, activation schedule (ADR 0098 put this in one file) |
| `ws-hub.js` | 689 | 762 (439) | +73 | connection admission, picture tick, coverage, labels, 6 broadcast paths, EFSP frame building (1b), collab and ATIS messages |
| `efsp/index.js` | 564 | 634 (351) | +70 | `createEfsp` (323 lines, of which the `rules` bag is 140), restore reconcile, log-tail reconcile, persist |
| `efsp/efsp-ws.js` | 457 | 606 (330) | +149 | the three bespoke handlers, resync, store slices (ADR 0106), read scope, heartbeat |
| `efsp/board/strip-ops.js` | 509 | 674 (335) | +165 | dispatch (104 lines) with undo frames, NLA, retirement, undo restore |
| `efsp/board/tofi.js` | 568 | 633 (379) | +65 | propose/accept (134-line `_applyTofiAccept`)/reject/exit, regime marks, system entry |
| `efsp/board/handoff-control.js` | 0 | 557 (394) | new | CR-S's comms/control/release steps and the invariant |
| `efsp/board-store.js` | 367 | 445 (212) | +78 | still a facade; the extra is 1g and undo plumbing |
| `efsp/board/coordination.js` | 498 | 496 | 0 | stable (CR-S moved its new work to `handoff-control.js`) |
| `efsp/metrics.js` | 988 | 1035 (784) | +47 | `_aggregate` (194), `createEfspInstrumentation` (232) |

`src/` as a whole grew from 30,780 to 35,440 lines (+15%) since the refactor.

**2a. `createApp`**, 765 lines (`app.js:125-890`; it was 704 at the refactor and was never split). *Fix*: `routes/{auth,radio,efsp,weather}.js`, each `(router, deps)`; `monitors.js` returns the monitors and `broadcastEfspAlerts`; `tickers.js` builds the list. `createApp` keeps only the order. M. Risk low, because the soak and `app-boot.test` drive it.

**2b. The `rules` bag in `createEfsp`** (`index.js:113-235`): 54 closures, most of them one-line forwards to module functions (`permission.*`, `blockMap.*`, `facilityConfig.*(…, facilityId)`). It is a service locator: ADR 0095 named the 49-closure `rules` as a cost, and making the rules required kept the bag. Real logic lives inside it (`sfaFrequencyFor`/`sfaRackFor`, `liveStripsForFlightData`). *Fix*: pass `facilityView = facilityConfig.forFacility(id)`, `permission` and `blockMap` as modules, and the stores as objects. Keep closures only for cross-Facility lookups. Move the SFA logic into `sfa-model`. L, because it touches every collaborator. Risk med. Do it only when a lane is already in those files.

**2c. `flight-data-store.js`**: split it into `flight-data/create.js`, `flight-data/setters.js` (driven by a path, validator and provenance table; see 3g), `flight-data/ato-tasking.js` and `flight-data/formation.js` behind the existing class. M. Risk low (pure moves).

**2d. `airspace-store.js`** doubled in size. Split it by op: `airspace/ops/{create,edit,delete,import,activate}.js`, the shape `board/ops` already uses. M.

## 3. Paradigms

**3a. BUG (latent): exceptions leave partial writes.** `board-store.js:260-269` catches any throw from `dispatch` and turns it into `{ok:false, reason:'VALIDATION_ERROR', detail:'internal error…'}`. The op may already have mutated the Strip, a peer Board, flight data or MARSA.
- `efsp-ws.js:123-127` then broadcasts the touched Strips, deliberately, but `persist()` runs only on `ok` (`efsp-ws.js:80`) and `recordAudit` is skipped, because the throw happens before it (`strip-ops.js:179-181`).
- The replay cache records the refusal (`board-store.js:269`), so the client's retry is told "refused" while the Board shows the change.
- The in-memory Board, the snapshot and the audit then disagree until the next persist writes the half-change **without** an audit line.
- *Fix*: snapshot the touched Strips (the undo frame's before-images already exist for scoped ops) and restore them on throw. Alternatively, `persist()` and write an `InternalError` audit line on any refusal with touches. Name it `INTERNAL_ERROR`, not `VALIDATION_ERROR`. M. Risk med.

**3b. Exceptions as flow control** (minor):
- `placement.js:44` catches `ORDER_KEY_EXHAUSTED` to choose the rebalance path. `keyBetween` could return `null` instead.
- `metrics.js:858` maps `RangeError` to 404.
- `carrier/handoffs.js:142` catches around `isStaffed`.
- `CRCSYNC_CONTROL_INVARIANT=throw` makes production code (`handoff-control.js:506`) throw under test; it is read from `process.env` on every call (`board-store.js:114`). Pass `invariantMode` as a constructor option.

S each.

**3c. Hidden time sources** (finding 4).
- ADR 0096: "Wall time is **injected** … never a bare `Date.now()`". Yet the allow-list (`tests/clock-policy.test.mjs:20-45`) permits 12 bare sites. Six of them are in the Board path: `board-store.js:269`, `strip-ops.js:608`, `persistence.js:51,85`, `ops/invoke-nla.js:16`, `index.js:612`. Outside `src/efsp`, which the test does not scan: `tracks.js`, `atis-store.js`, `collab-store.js:107,126`, `srs-client.js`, `grpc-client.js`, `ws-hub.js:479,652`, `app.js:268,315,756`.
- Cost: the NLA double-tap latch on a bare clock makes `efsp-board-store`, `efsp-scenarios`, `undo-scenarios`, `efsp-ui-findings`, `efsp-scenario-time-chains` and others **really sleep 410 ms** per guarded press. The F-102 tests take 3.4 s and 2.5 s.
- `grpc-client-stream.test.mjs:153` has to `t.mock.method(Date, 'now')` to age tracks.
- *Fix*: hand `wallClock` to `BoardStore` → `StripOps`/`BoardPersistence`, and to `createEfsp` `_persist`, `TrackStore`, `GrpcClient` (plus `random` and timer functions), then shrink the allow-list to `mission-clock.js`. Extend the scan to `src/`. S-M. Risk low.

**3d. Mutable module state and require-time configuration** (finding 5). ADR 0095 §4: "no file reads, no paths fixed at require time". Violations:
- **file reads at require**: `stereo-routes.js:141` (`let stereoRoutes = _load()`) and `apt-config.js:34-39`;
- **paths fixed at require**: `state-paths.js:57-58` (`CONFIG_DIR`, `STATE_DIR`), `mutation-log.js:45`, `metrics.js:54`, `traffic-count.js:38`, `radars.js:74`, `terrain.js:47-52`;
- **behaviour fixed at require**: `iff.js:24` (`USER_COALITION`), `grpc-client.js:11-19`, `srs-client.js:7-8`, `auth.js:22-24`, `flight-plan-lookup.js:28-30`;
- **process singletons**: `facility-config.js:35,168` (`configs`, `rangePositionIds`; `load()` writes `process.env` overrides into the module-level `FACILITY_CONFIG_FILES` table at `:177-180`) and `code-allocator.js:50`.

That is why 12+ test files set `CRCSYNC_EFSP_FACILITY_CONFIG_PATH*` and others before importing. Two `createEfsp` calls in one process share facility state (`setFacilityConfig` mutates the live Map).
*Fix*: `createApp(env)` resolves one `paths` object and passes it down, and `facilityConfig.load()` returns an instance that `createEfsp` owns. M-L. Risk med. Do it incrementally, starting with `stereo-routes` and `apt-config`, which are the two real file reads.

**3e. Boolean-flag parameters.**
- `flightDataStore.setTofi(id, patch, { by, system })` (`flight-data-store.js:1103,1144`): `system` changes which paths the undo observer is told about. It also stamps `provenance.tofi = 'CONTROLLER_ENTERED'` on a system write. *Fix*: a separate `recordRegimeEntered(id, entry)` that writes only the observed paths with system provenance. S.
- `carrierStore._stackOp(record, op, by, quiet)` (`carrier-store.js:304,339,370,440`) and `airspaceStore._theaterMap(theater, create)` (`airspace-store.js:149`). These are minor. Fix them with named methods: `_stackOpQuiet`, and `_theaterMapOrCreate`. S.
- `touch(id, { placementOnly: true })` is used at `tofi.js:392` for a non-placement write, to mean "not a change for undo". Rename the option to `observed`, or `undo: 'ignore'`. S.

**3f. System writes outside Mutation frames.**
- `SystemReassign` (`board-store.js:370-423`), the control repair (`handoff-control.js:483-531`, written by `_recordRepair` directly to the log, not via `BoardAudit`), `markTofiEntered` (`index.js:340-350`, which repeats persist and delta assembly by hand), the archiver, carrier tick, correlation reconciler and runway status from wind. Each audits correctly, but each re-implements persist plus drain plus delta plus broadcast.
- `markEnteredBySystem` bumps the MISSION Strip's `rev` although "the Strip itself is unchanged" (`tofi.js:389-392`). A controller's next op on that Strip, if built on the old rev, is refused `STALE_REV` (probable; not reproduced).
- *Fix*: a `board.applySystem(kind, fn)` frame that does bump/audit/drain and returns the `{broadcasts}` shape, so the system paths and the wire paths share one tail. Push the Strip delta without a rev bump if the client accepts that, or don't push it at all: the flight data delta carries the change. M. Risk med.

**3g. Validation scattered.** Of 244 `VALIDATION_ERROR` sites, 53 are in `flight-data-store.js`: each setter hand-checks against its own Set (`setTofi` alone runs 7 checks, `:1112-1135`). There are schema modules for facility and airspace data, but none for flight data or wire ops. *Fix*: a per-path table `{ path, validate, provenance, observed }` that the setters and `WRITABLE_PATHS` read from. M. Risk low.

**3h. Ack and refusal shapes differ.**
- `efsp-positions-ack` refusals have `reason`/`detail` but **no `ok`** (`efsp-ws.js:336`).
- `efsp-mutation-ack` refusals carry `strip` for STALE_REV and NOT_OWNER but not for the others.
- ATO refusals carry `results: []`.
- Metrics answer `INTERNAL_ERROR` where the Board answers `VALIDATION_ERROR` for the same condition.
- `NOT_STAFFED` and `UNSTAFFED` (`runway-status-store.js:466`) mean the same thing.
- Two internal flags leak into handler results: `unaudited` (a metrics-tap hint) and `replayed`.

*Fix*: one `refusal(reason, detail, extra)` in `wire/frames.js`, `ok` on every ack, an `INTERNAL_ERROR` code, and drop `UNSTAFFED`. S. Risk: client handlers (check `efsp-messages.js`).

**3i. `warning` is single-valued** (finding 8). `efsp-ws.js:103` is `luawWhileCombined(...) || result.warning`. If LC moves a Strip to LUAW while combined, and `set-state.js:87` also warned ("no LC Bay for LUAW"), the second warning is lost.
- The values have mixed types: codes (`LUAW_WHILE_COMBINED`, `AIRSPACE_EDITED_OCCUPIED`, `DUPLICATE_IGNORED_WARNING`), prose (`set-state.js:87`, `handoff-control.js:438`), `'; '`-joined prose (`join-formation.js:76`), and objects (correlation, ATO).
- The replay records keep one value (`replay-cache.js:57`, `skeleton.js:68`).
- *Fix*: `warnings: [{ code, detail }]` on every ack and replay record. Keep `warning` as the first element's code for one release. S-M. Risk low.

**3j. Four strict-state policies.**
1. **Stop start-up**: Board snapshot, facility, airspace list, tuning keys, comm card.
2. **Move aside and start empty**: `collab-store.js:267-270`, `mission-session.js:216-220`, `metrics.js:204-208`.
3. **Warn and start empty or ignore**: `apt-config.js:37`, `theaters.js:25-68` (each bad field is ignored), an unparseable tuning layer (`tuning-file.js:37`), and `traffic-count.js:391`, which skips bad lines.
4. **Warn on a write failure**: `mutation-log.js:110`, where a failed append loses the audit line silently except for a WARN, and `index.js:629` `_persist`.

CLAUDE.md documents 1 and parts of 3. The move-aside group is undocumented. *Fix*: decide per file, write the decision into the `state-paths.js` header, and test it once. A failed append to the audit log should at least raise a metric or an alert. S (doc) / M (behaviour).

**3k. Strip-state classifications live outside the authority registry.** The departure ground and pre-movement list is repeated in `alert-scramble.js:42-46`, `correlation-reconciler.js:53-60`, `surveillance-hints.js:54-58` and `authority/strip-types/departure.js:262` (`groundStates`). Tests pin them, but ADR 0095 §3 says the Role families register this. *Fix*: each strip-type family declares `phaseOf(state) ∈ {PRE_MOVEMENT, GROUND, AIRBORNE, NONE}`; the four tables derive from it. S-M. Risk low.

## 4. Naming

- **Underscore getters as public API**: `board-store.js:221-222,277,442` (`_strips`, `_cidSeq`, `_appliedMutations`, `_droppedWallAt`) and `_rebalanceRack`, kept "for tools and tests". They read as private while being a contract (`guard-board-surface.json`). *Fix*: `debugView()` returning them, or plain names. S.
- **`theatre` vs `theater`**: 76 against 431 occurrences. `MissionSession.current().theatre` (`mission-session.js:98`) feeds `currentTheater` (`app.js:327`). DCS-gRPC's `GetTheatre` explains the gRPC edge, not the rest. *Fix*: `theater` everywhere past `grpc-client.js`. S.
- **Wall-clock injection under two names**: `wallNow` (a function, 77 occurrences) and `wallClock` (an object with `.now`, 22). Pick `wallClock`. S.
- **`boardFor` vs `boardStoreFor`** for the same lookup (`undo-history` env against everywhere else). S.
- **`flightDataList`**: a mechanical rename of `fdrs` (`evictMissingFlightDataList`, `mergeFlightDataList`, `regimeFlightDataList`, the store's `_flightDataList` Map). It reads as "a list" while being a Map or a set of ids. Wire names stay. In code, `flightData` (Map) and `flightDataIds` read better. S, code only.
- **Misleading names**:
  - `placementOnly` at `tofi.js:392`;
  - the `system` flag at `setTofi` (3e);
  - `facilityConfig_positionIds` (`efsp-ws.js:327`), a one-caller wrapper with snake-ish casing, followed by a `require` in mid-file at `:329`;
  - `_facilityOrThrow` (`index.js:542`) returns `undefined` for an unknown id rather than throwing, and its callers then test `f ? … : null`.
- **`VERSION = 1` (frame version) is defined three times**: `ws-hub.js:14`, `wire/frames.js:6`, `metrics.js:56`. `collab-store` and `mission-session` also have a `VERSION`, but theirs is a file version. Use one import from `wire/frames.js`. S.
- The **audit subject is one of six id fields**: `stripId`, `airspaceId`, `flightDataId`, `marsaId`, `runwayStatusFacilityId` and `flightDataIds` ("readers key on whichever id is present", `correlation-store.js:206`, `marsa-store.js:227`, `runway-status-store.js:203`). *Fix*: `subject: { kind, id }` alongside the existing fields, then readers move over. M, because it is an audit format change.

## 5. Tests

**5a. Temp-dir leak.** I set `TMPDIR` to a scratch directory, ran `npm test` with the same preload, and diffed `/tmp` before and after. `/tmp` itself gained nothing, because every test uses `os.tmpdir()`. The private TMPDIR was left with **146 directories from one run**. Only the preload's own `crcsync-test-state-*` directories are removed. 67 test files call `mkdtempSync` and never `rmSync` the directory: some remove only the snapshot file inside it, such as `undo-hub.test.mjs:34` and `control-release-carrier.test.mjs:21`. The worst offenders:

| Directory prefix | Directories left per run | Test file |
|---|---|---|
| `efsp-mutation-log-test-` | 16 | `efsp-mutation-log.test.mjs` |
| `efsp-facility-load-` | 12 | |
| `crcsync-terrain-` | 10 | |
| `crcsync-comm-` | 8 | |
| `collab-` | 6 | `collab-store` / `collab-persistence` |
| `seed-` | 6 | |
| `tuning-empty-` | 5 | |

The rest leave one or two each. To list the 67 files, run `grep -L rmSync $(grep -l mkdtemp tests/*.test.mjs)`.
*Fix*: one change in `tests/helpers/isolate-state.mjs`: create a per-process root (`mkdtempSync(os.tmpdir()/crcsync-test-)`), set `process.env.TMPDIR` to it **before** any test code runs (`os.tmpdir()` reads `TMPDIR` on every call), and `rmSync` it on `exit`, as it already does for the state dir. No test file changes. A killed run still leaks one directory. S. Risk low.

**5b. Slow tests.** `npm test` takes 25 s wall, and the critical path is one test: `control-release-invariant.test.mjs` "I11 bounded exhaustive walk" at **23 s**. *Fix*: cap the walk depth in `npm test` at 3 and run depth 4 under `npm run freeze` or a `SLOW=1` flag. That takes the suite to about 8 s.
Next slowest: the traffic-count reconcile scenario (6.1 s), "held-open unit stream" (5.2 s, which is a literal `sleep(5000)`, `grpc-client-stream.test.mjs:134`), and the sortie and F-102 tests (2.5-3.9 s, mostly the 410 ms double-tap sleeps of 3c).

**5c. Timing-flaky tests.**
- `grpc-client-stream.test.mjs` runs a real gRPC server and real timers. `assertBackoff` (`:186-195`) checks jitter windows of ±80 ms and a "never shrinks" condition with 20 ms slack, and these fail under load. *Fix*: inject `random` and `setTimeout` into `GrpcClient` (3c), use `t.mock.timers`, and assert on the computed delays. M.
- `efsp-ato-tokenize.test.mjs:151-158` "pathological inputs finish fast" times 7 inputs of up to 600 KB against a 1000 ms wall budget, while 2400 other tests run in parallel. *Fix*: assert linear behaviour (time at 2N < 3 × time at N), or count tokenizer steps; keep the 1 MiB `INPUT_TOO_LARGE` cap as the real guard. S.
- `collab-store.test.mjs:70` (an 80 ms sleep) and `airspace-service.test.mjs:200` (150 ms) wait for real file or HTTP timing. S.

**5d. Duplicated fixtures.**
- `fakeWs` is defined separately in 7 files: `ws-hub-heartbeat`, `ws-hub-read-scope`, `ws-hub-coverage`, `ws-hub-wire-strictness`, `theater-context`, `undo-hub` and `efsp-runway-status-l1b`.
- `fresh()` is defined in 9.
- `sleep` and `until` are defined in 3 each (`grpc-client-stream`, `airspace-service`, …).
- 53 files call `createEfsp(`, but only 45 import `helpers/efsp-scenario.mjs`.
- 12+ files hand-set the facility path env block.

*Fix*: `helpers/ws.mjs` (`fakeWs`, `until`) and `helpers/env.mjs` (one `withPaths(dir)`), and move the stragglers onto `efsp-scenario.mjs`. S-M. Risk low.

## Known items confirmed, not re-ranked

- "Sign-off only warns, never blocks" (CR-S, DR-6) is by design. Finding 1 is a different defect in the same function.
- The airspace lanes ran no Playwright, and the external-link gate trusts the renderer. These are process and client findings outside crc-sync's tree.
- The temp-dir leak is quantified in 5a.
