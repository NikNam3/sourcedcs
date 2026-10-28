# FREEZE: characterization (golden master) of the EFSP server

> **Status (2026-10-04).** The freeze suite is opt-in, not part of `npm test`: `cd crc-sync && npm run freeze`
> (52 tests, about 14 s). After the BACKCOMPAT merge (2026-10-02) it was restructured by FREEZE-GRAIN
> (`docs/wip/FREEZE-GRAIN.md`): **ids are numbered per golden by first appearance and a hash covers a `PROJECTION`
> of each record, not the whole record**, so a change moves only the goldens that record it (an extra `randomUUID()`
> moved 3 of 109, a new non-empty ext field on every Strip moved none). A behaviour lane that changes behaviour on purpose
> re-records in its own commit (`npm run freeze:update`) and says which goldens moved; a pure refactor re-records nothing.
> Never hand-merge a golden: take either side, `npm run freeze:update`, check the diff is small, commit it separately.
> What follows is the original FREEZE lane's description, corrected where the grain changed it.

Lane FREEZE, branch `lane/FREEZE-characterization`, tests only (no production file touched, one `package.json`
edit: three script lines). Purpose: concern S-5 (the architecture refactor of `board-store.js` and friends,
plan on `lane/ARCH-refactor-plan`). Before any move, today's observable behaviour is frozen.

## The rule for a refactor lane

**Golden diffs must be empty except by an explicit, supervisor-approved change.** A refactor lane never
re-records. If a golden fails, the refactor changed behaviour: fix the refactor. A behaviour lane that
changes behaviour on purpose re-records in its own commit and lists the changed traces and steps in its report.

```bash
cd crc-sync
npm run freeze                             # the freeze suite; `npm test` no longer includes it (2026-10-02)
npm run freeze:update                      # UPDATE_GOLDEN=1: rewrite crc-sync/tests/freeze/golden/**/*.json
npm run freeze:selfcheck                   # proves the suite catches deliberate faults (about 5 min, not part of npm test)
FREEZE_DUMP=/some/dir node --test tests/freeze/freeze-scenarios.test.mjs tests/freeze/freeze-hub.test.mjs
GOLDEN_RECORD=1 node --test tests/module-graph.test.mjs   # in crc-desktop: re-record the module export fixture (the client guard)
```

Without `UPDATE_GOLDEN=1` nothing is ever written. A mismatch fails with the golden name, how many units
(steps or cells) differ, and for the first six the path-level difference, e.g.
`unit 8 [instance 0 step 8 efsp-mutation CreateStrip by c-OPS]  .audit[0].actorId: golden "c-OPS" | actual null`.

### What a hash covers, and seeing the rest

A heavy record (a whole Strip, a whole flight data record) is stored in a golden as one readable line carrying a hash of
its **projection** (`S #13 r4 DEPARTURE/HANDED_OFF @APP app-departures/main:V h=ab12cd34ef`). `PROJECTION` in
`crc-sync/tests/freeze/freeze-lib.mjs` lists, per record kind, the `core` fields (scalars: identity and placement, e.g.
`stripId stripType state ownerPositionId bayId rackId orderKey rev flightDataId`) and the `sparse` ones (objects, hashed
with null/false/""/[]/{} pruned: `flags coordination airspaceEntry tofiCoordination annotations previousLeg`; flight data
`identity filed assigned clearance airspace comms`). Every other field (`cid`, timestamps, `updatedBy`, `ato`,
`military`, ...) is **ext**: present in `FREEZE_DUMP` dumps, in no hash, so adding or changing one moves no golden.
**To freeze a field on purpose, promote it:** add it to `PROJECTION.<kind>.core` or `.sparse`, run `npm run freeze:update`,
own commit. Cross-cutting counters (`boardSeq`, `storeSeqs`, `undoable`, any `*Epoch`/`*Epochs`/`*EpochByFacility`) are
dropped everywhere by `VOLATILE_KEYS`/`VOLATILE_RE`; another one is one line there.

To see what changed inside a record: run with `FREEZE_DUMP=/tmp/after` on the changed tree and `FREEZE_DUMP=/tmp/before`
on the base (`git stash` or a worktree), then `diff` the `*.full.json` files (canonical, sorted keys, uuids normalised).

Ids: a recording keeps its deterministic uuids; the golden is renumbered `#1, #2, ...` by first appearance **in that
file** when it is written or compared. The table's client mutation ids are `freeze-cmid-NNNNN`, not uuid-shaped (a
uuid-shaped literal collides with the counter; scenario tests use plain cmids for the same reason).

## What is frozen (the corpus)

All of it lives in `crc-sync/tests/freeze/` (`golden/` holds the fixtures); `crc-desktop/tests/` has the client guard.

| Layer | File | What it drives | Golden | Units |
|---|---|---|---|---|
| Scenario corpus | `freeze-scenarios.test.mjs` + `freeze-recorder.mjs` | Every `tests/efsp-scenario*.test.mjs` (21 files, every operation sequence the suites run, with their own builders and fixtures, unchanged) executed in a child with a preload that pins ids, randomness and wall time and records every `createEfsp().handleMessage()` call: input, the whole result (ack plus every broadcast, peer, MARSA and carrier delta), the audit entries written during the step, and the final state of every store (Boards, FDRs, airspaces, correlations, MARSA, field state, carriers) | `scenario-*.json` (26), `scenarios.json` | about 2,800 steps |
| Mutation table | `freeze-table.test.mjs` | One mutation for every Role (DEPARTURE, ARRIVAL, OVERFLIGHT, MISSION) x state x owner variant (creator-owned / state-owner-owned) x acting Position (every Position of the Facility plus one that holds nothing) x op kind (17 kinds), permitted and refused; `CreateStrip` x Position x Role; what the NLA button offers per Role x state x owner; and the `snapshot()` / persist / `createEfsp()` / restore round trip must reproduce the Boards and FDRs (asserted, not just recorded) | `table-mutations/<op>.json` (17, one per op kind), `table-create.json`, `table-nla.json`, `table-roundtrip.json` | 4,624 + 52 + 66 + 66 |
| Hub traces | `freeze-hub.test.mjs`, `freeze-world.mjs`, `freeze-traces.mjs`, `freeze-hub-runner.mjs` | The real `WsHub` over fake sockets (tools/soak's host, required not edited) with 17 clients (one per Position, an observer, a ghost, AIC/JTAC read-scoped). Per step: input, every `efsp-*` frame every socket received in order (identical consecutive frames folded), the Mutation-log lines appended, the persisted Board file (a projection hash every step, whole summarised state at checkpoints and after every restart). Traces: `op-matrix` (every op kind with success and each reachable refusal, replay, the 400 ms latch, Undo window, all five coordination primitives x PROPOSE/ACCEPT/REJECT/CANCEL/STAND_BY, TOFI, airspace ops, MARSA, correlation, field state, carrier, ATO preview/import, resync delta/epoch/owned-scope), `walk-civil`, `walk-manning` (disconnect, covering chain, observer, combined Positions, vacate), `walk-tactical` (read scope), `crash-replay` (mode A ack lost, mode B audited but not persisted, a crash mid-coordination, resync across a restart), `order-keys` (300 moves into one slot until the Rack is re-keyed past `REBALANCE_KEY_LENGTH`), `monitors` (reconcile, conformance/STCA, obligations, NLA status, archiver after retention, metrics, heartbeat), `peer-marsa-order` (one Mutation that yields both a peer and a MARSA delta), `random-seed1/2/3` (tools/soak `Driver`, seeds 1-3, smoke and stress profiles, restarts, reconnects, resyncs, mission reload) | `hub-op-matrix/<op>.json` (one per op, plus `setup`, `resync-*`, `ato-*` and `_checkpoints.json` for the whole-state checkpoints and counters), `hub-<trace>.json` | about 4,900 steps |
| Decision tables as data | `freeze-tables.test.mjs` | `permission.js` tables (`PERMISSIONS`, `STATE_OWNERS_BY_ROLE`, `CREATE_ROLE_PERMISSIONS`, coordination/TOFI/airspace op sets, tactical and carrier capabilities, read scopes), the decisions they yield (`canMutate` Position x op kind, `canCreateStripRole`, `canActOnState` Position x Role x state, hand-back and TOFI counterparts), NLA state sets, coordination and TOFI effect tables, block-map block ids, the shipped facility defaults, and the wire message-type set (client-to-server cases scraped from `efsp-ws.js`'s dispatch, and every `efsp-*` type literal sent) | `tables-*.json` | |
| Guards | `freeze-guards.test.mjs` | (1) every `this._rules.<name>` board-store reads is supplied by `createEfsp()` for every Facility; (2) the Board's external surface (public methods used from `src/`, `server.js`, `tools/`, and the private members tests and tools reach, each asserted to still exist); (3) `Date.now()` / bare `new Date()` sites per file under `src/efsp` | `guard-*.json` | |
| Client guard | `crc-desktop/tests/module-graph.test.mjs` | The whole client ES-module graph evaluates under the DOM stub, and every module's exported names are frozen in `tests/fixtures/module-graph-exports.json` (it replaced the classic-script `client-global-surface` guard when the renderer became native modules) | fixture | |

Determinism: scenario files and hub traces each run twice and the two recordings must be byte-identical (they are).
Every trace runs in its own process (`setupHostEnv` patches process globals and every `src/` module reads its paths at
require time). Time is virtual (`Date.now` moves only when a collapsed `setTimeout` waits or a trace advances it),
`crypto.randomUUID` and `Math.random` are seeded, so no normalisation pass is needed beyond scrubbing temp paths.

## Size and runtime

Freeze suite: about 14 s wall (children in parallel), 52 tests. Goldens: 109 files, about 13 MB working tree (mostly the
verbatim inputs and outputs of the scenario corpus), well under 1 MB gzipped in git. crc-sync `npm test` is separate
(about 18 s; 2448 tests at the SEAMS merge) and does not include the freeze suite.

## Deliberately NOT frozen

* Anything authentication (out of scope for the lane): `server.js` routes, tickets, Casdoor.
* Wall-clock durations, latency numbers, the order of console output, memory, `persistMs` and any other host metric.
* Frames that are not `efsp-*` (tracks, status, coverage) and `efsp-heartbeat` timing.
* Persisted-file bytes other than the Board file: its sha1 is frozen (key order included), the Mutation log is frozen
  as parsed lines, but the metrics file, the traffic-count file and the archive are not recorded.
* The carrier Strip flow (MARSHAL / FINAL / PATTERN Roles at the CARRIER Facility) is covered by the scenario corpus
  (`efsp-scenario-carrier-l17`) and by hub-level carrier-store ops, but not by the Role x state table: that table
  uses the four Roles creatable at INCIRLIK, CENTER and TACTICAL.
* Real tracks, the DCS-gRPC and SRS clients, the Express routes, `ws-hub.js`'s 500 ms track tick.
* Anything in `crc-desktop` other than its exported module names: the client is characterised by its existing tests and the
  Playwright suite; the DOM-level rendering golden was out of scope.
* The Mutation table does not seed OVERFLIGHT/MISSION owner variants beyond what `SetState` and `TransferStrip`
  allow; a cell that cannot be seeded is recorded as `seeded:false` with the refusal (none today).
* Branches the corpus cannot reach are not enumerated: no line-coverage checklist was produced (child processes
  are not instrumented by the in-process coverage flag). The op x outcome matrix was built from the reason codes,
  not from an uncovered-line list.

## Parts of the ARCH P0 briefing not done as written, and why

The supervisor sent the P0 briefing (`docs/wip/ARCH-plan-p0-briefing.md` on `lane/ARCH-refactor-plan`) mid-lane; the
lane kept what existed and extended it. Differences:

* Paths and names: tests live in `crc-sync/tests/freeze/` (not `tests/golden/`), the guards are one file
  (`freeze-guards.test.mjs`), the switch is `UPDATE_GOLDEN=1` / `npm run freeze:update` (not `GOLDEN_RECORD` /
  `golden:record`; the client fixture does use `GOLDEN_RECORD=1`), the detector proof is `npm run freeze:selfcheck`.
* Fixtures are not under 2 MB (about 11 MB raw, 0.8 MB gzipped) and the runtime is not under 10 s (about 16 s): the
  scenario corpus replays every existing suite verbatim, which is what makes it broad. Trimming the scenario
  goldens to hashes only would get under 2 MB at the cost of readable diffs.
* T2 "walks rewritten as traces": the walks are not rewritten; the scenario suites themselves are the corpus, run
  through `handleMessage` (not through the hub), plus the hub-level walks listed above. So the scenario corpus does
  not see `ws-hub.js` filtering and frame order; the hub traces do, for the flows they cover.
* The soak's `host-core.js` is the hub harness (required, not edited). The in-process restart purges the `src/`
  require cache the way `InprocHost` does.
* The unreachable-refusal-branch inventory and the coverage checklist (V5) were not produced.
* Q2 (metrics instrumentation in the world): yes, `host-core.js` wires `createEfspInstrumentation` as `server.js`
  does, and the run is deterministic with it.
* The client `todo` for duplicate top-level names (`finite`, `_el`, `_callsignOfFdr`) is gone with the classic scripts:
  each is now a module-local name.

## Detector proof (`npm run freeze:selfcheck`, about 4.5 min, not part of `npm test`)

Each mutation is one file, `crc-sync/tests/freeze/selfcheck/M<n>.mjs` (`file`, `find`, `replace`, `detect`). It is applied
to a temporary copy of `crc-sync` (`node_modules`, `atobrief` and `docs` symlinked), the freeze test files run there in
parallel, and the mutation counts as caught when a file named in `detect` fails. A lane that moves the code a mutation
targets retargets **that one file** and re-proves it with `npm run freeze:selfcheck M<n>`. A mutation
whose find-text matches other than once is reported as "did not apply" rather than silently skipped.

| Id | Mutation | Caught by |
|---|---|---|
| M1 | an ack reason: `NOT_OWNER` -> `NOT_YOURS` | table, scenarios, hub |
| M2 | a state transition: `ConvertToArrival` lands in `HANDED_TO_TOWER` | table, scenarios, hub |
| M3 | an audit field: `actorId` dropped from the Mutation-log entry | table, scenarios, hub |
| M4 | a missing `_touch` in `SetFlag` | scenarios, hub |
| M5 | frame order: ws-hub sends the peer delta before the primary delta | hub |
| M5b | frame order: ws-hub sends the MARSA delta before the primary delta | hub |
| M6 | a refusal `detail` string | scenarios, hub |
| M7 | `causedBy` dropped from a peer-write audit entry | table, scenarios, hub |
| M8 | `REPLAY_PERSIST_WINDOW_MS` set to 0 | scenarios, hub |
| M9 | the persisted body's key order (`fdr` before `boards`) | hub |
| M10 | a rule (`liveStripsForFdr`) dropped from `createEfsp()`'s wiring | guards, scenarios, hub |
| M11 | `REBALANCE_KEY_LENGTH` 40 -> 400 | hub (the `order-keys` trace) |
| M12 | a permission table row changed (`HELD` also CTR's) | tables, table |
| M13 | the wire dispatch loses `efsp-resync` | tables, scenarios, hub |
| M14 | a new `Date.now()` site in `nla.js` | guards |
| M15 | a Board method used from outside is renamed (`getDeltaSince`) | guards, scenarios, hub |
| M16 | an extra `randomUUID` draw in `fdr-store.js` | table, scenarios, hub |
| M17 | frame order: the skeleton sends the MARSA delta before the peer delta (`wire/slots.js` `SLOT_ORDER`) | hub (`peer-marsa-order`) |

18 of 18 caught (M1-M17 plus M5b). The first run caught 13 of 16; the three misses were M4 (the find-text was wrong, fixed), M5 as first
written (swap of the peer and MARSA deltas: **no Mutation in the corpus yields both a peer and a MARSA broadcast**, 200
steps yield a peer one and 34 a MARSA one, never both, so that order was unobserved then; M5 and M5b now swap each with the
primary delta) and M11 (no trace grew a key to 40 characters; the `order-keys` trace was added). M17 and the `peer-marsa-order` trace were added later
to freeze the relative order of a peer and a MARSA delta in one round trip.

## Findings for other lanes

* `reply.uncarried` from the soak host reports `cause: UNKNOWN` for ordinary mutations such as `MoveStrip` in the hub
  traces (it is recorded in `hub-*.json` as `uncarried`). It looks like a host-side accounting artefact (the host counts
  deltas through `hub._broadcast`, which `_broadcastEfsp` may bypass), not a server fault; it is deterministic, so the
  golden freezes it. Lane S4 (`createRuntime`, which rewrites `host-core.js`) should expect this field to move.
* (Resolved) the duplicate top-level names in `crc-desktop`'s `index.html` went with the classic scripts; the renderer is native ES modules.
* Nothing in the Board showed nondeterminism once ids, `Math.random` and `Date.now` are pinned; the only nondeterminism
  met was the harness's own (counters shared between two runs of a table, fixed by resetting them).
