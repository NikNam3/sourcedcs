# ARCH: is the 3,000-line Board necessary, and what to do about the god files (S-5, D-10, with D-9)

Lane ARCH, branch `lane/ARCH-refactor-plan`, cut from `integ/wave3-dry` at `0935ee5`. **Plan only**: no
production code changed. Companion files: `docs/wip/ARCH-plan-adr.md` (draft ADR 0095) and
`docs/wip/ARCH-plan-p0-briefing.md` (the briefing for the first lane, tests only).

The human's notes: S-5 "fix this, and also check if it's really necessary to have a 3000-line board-store.
There is probably an opportunity to make the code architecture more sensical and more readable". D-10
"probably an opportunity for architecture improvements".

Every number below was measured on this branch (scripts in the session scratchpad: a method/field scanner
for `board-store.js`, a cluster and call-matrix scanner, a client global-scope scanner, and
`node --test --experimental-test-coverage`). Line numbers are this branch's.

---

## 0. The answer in ten lines

1. `board-store.js` is 3,149 lines, but **1,269 of them (40%) are comment lines** of rationale and defect
   history. The code is 1,699 lines, and the existing tests cover **97.6% of its lines and 83.6% of its branches**.
   File size by itself is not the problem.
2. One third of the file, **coordination (478 lines) and TOFI (521 lines)**, touches the rest only through
   five kernel methods. These two clusters can be moved out verbatim, which takes the file to about 1,000 lines
   before anything else is done.
3. The real cost is **fan-out per capability**. One capability edits six to ten shared files. L18S's SFA rotation
   added 129 lines to `board-store.js`, 50 to `index.js`, 46 to `efsp-ws.js`, 98 to `permission.js` and 173 to
   `facility-config.js`, and also edited `replay-cache.js` and `ws-hub.js`. L28 changes one lifecycle in seven
   files. The lanes queue up on those files (plan §2, S-L8, S-R2-1, S-M24).
4. The same request skeleton is repeated by hand in six wire handlers: the session binding appears 7 times,
   `unaudited: true` 12 times and the replay lookup 6 times. The file's own comments say a new dispatch path "is
   exactly where that check gets forgotten" (it has happened twice). That repetition is a bug class.
5. `rules` holds 43 optional closures and is read behind 40 `this._rules.x &&` guards. A rule that is not wired
   in `index.js` switches its check off without any error.
6. The client's global script scope has a **live defect on `integ/wave3-dry` right now**.
   `const finite` is declared in both `pattern-board.js` and `final-panel.js`, so `final-panel.js` throws a
   SyntaxError and never loads. L18S fixed this on its own branch only. `_callsignOfFdr` is still being
   overridden without any error.
7. **Worth doing:** a golden-master test of the Board's behaviour (P0); registries for wire families and
   persisted stores (S1); moving coordination and TOFI out of `board-store.js` (S2a); `createRuntime()` in place
   of `server.js`'s module-level wiring, reused by the soak (S4); a test that every top-level client name is
   unique (C0). Total about 4.5 agent-lanes.
8. **Worth doing if more Roles and capabilities keep coming (they are):** an op-handler table for the Board
   (S2b), one file per Role family (S3), and a client message registry (C1a). About 3 more lanes.
9. **Not worth doing now:** moving the client to ES modules, a namespace rename across the client, DI containers
   or class hierarchies, and schema codegen. Splitting `bay-view.js` (C1b) and generating the client tables (C2)
   are optional.
10. The human decides: the scope tier, the freeze window (after L20, about 2–4 days on six core files), whether
    AIRSP phase 2 waits for S1, and the policy for re-recording golden fixtures (§7).

---

## 1. What the god files contain today (measured)

### 1.1 `crc-sync/src/efsp/board-store.js` — 3,149 lines, one class, 79 methods

| # | Cluster | Lines | Total | Code | Comment | `rules` keys read |
|---|---|---|---|---|---|---|
| A | Constants, pure helpers (`_replayRecord`, `newFlags`, `_validateAltitudeBlock`, `deepClone`, `_frequencyFromBlockValue`) | 1–140 | 140 | 57 | 72 | 0 |
| B | Store kernel: `_strips`, `_seq`/`_log` ring, `_epoch`, `_touch`/`drainTouched`, `getDeltaSince`, orderKey resolution and rebalance, `_nextCid` | 141–327 | 187 | 91 | 84 | 0 |
| C | Mutation pipeline: `applyMutation`, idempotency (`_appliedMutations`, `_replayResult`), `_dispatch` switch, takeoff stamp, `_recordAudit`, `_recordPeer` | 328–593 | 266 | 146 | 102 | 4 |
| D | Strip ops and placement: CreateStrip, ConvertToArrival, airspace entry, Move, SetBlock (+annotations, MARSA interlock), Transfer, CarrierTransfer, SetFlag, SetState, `_placementRack`, `_bayForNewOwner`, `_relocateForImpliedState`, `_validateBayImpliedTransition` | 594–1600 | 1,007 | 519 | 431 | 30 |
| E | NLA: `_nlaPrecheck`, rejected-replica rules, `nlaStatusFor`, `_applyInvokeNla`, `_applyUndo` | 1601–1850 | 250 | 103 | 130 | 4 |
| F | Retirement: DropStrip, `_retireStrip`, `_releaseFdrIfLastStrip` | 1851–1978 | 128 | 47 | 77 | 4 |
| G | Cross-Facility coordination (5 primitives × PROPOSE/ACCEPT/REJECT/STAND_BY/CANCEL, `receiveCoordination*`) | 1979–2456 | 478 | 298 | 154 | 7 |
| H | TOFI (ENTRY/EXIT, ACCEPT/REJECT, TRANSFER_COMMS, `receiveTofi*`) | 2457–2977 | 521 | 327 | 163 | 7 |
| I | Position lifecycle: `reassignPositionStrips`, `returnCoveredStrips` | 2978–3056 | 79 | 57 | 20 | 2 |
| J | Archive, `snapshot`/`restore` | 3057–3149 | 93 | 54 | 36 | 1 |
| | **Total** | | **3,149** | **1,699** | **1,269** | **43 distinct** |

**State fields, and how many methods touch each:**

| Field | Methods | Cohesion |
|---|---|---|
| `_rules` | 44 | everywhere (an untyped service locator) |
| `_clock` | 38 | everywhere (mission time, correct per ADR 0079) |
| `_fdrStore` | 20 | D, E, G, H (13 distinct FdrStore methods) |
| `_strips` | 16 | B, C, G/H's `receive*` (they mint replicas by `_strips.set`), J |
| `_activeCmid` | 12 | C sets it; G, H and F read it for `causedBy` (ADR 0083) |
| `_mutationLog` | 8 | C, G, H, I, J |
| `_droppedWallAt` | 7 | F, E (Undo), J |
| `_appliedMutations` | 6 | C and J only, so it is cohesive |
| `_nlaHistory` | 6 | E, D (transfer/carrier delete), J |
| `_seq`, `_log`, `_epoch`, `_touchedSinceDrain`, `_cidSeq` | 3–5 each | B and J only, so they are cohesive |

**Calls between clusters (distinct methods):** C→D 12, E→D 5, D→B 4, G→B 4, H→B 4, C→E 3, D→E 2, and every
other pair 1 or 2. The only real knot is **D⇄E**: an NLA press runs a transfer, a set-state, a retire or a
carrier transfer, and those ops call the NLA precheck. **G and H depend only on the kernel** (`_touch`,
`getRack`/`_resolveOrderKey`/`_appendOrderKey`, `_recordPeer`, `_activeCmid`, `_strips`), on `_retireStrip`
and on one placement helper. That is why they can be moved without rewriting.

**Repetition:** the four lines `strip.rev += 1; strip.updatedAt = …; strip.updatedBy = …; this._touch(…)`
appear **32 times**. `deepClone(strip)` appears 19 times.

**Public and private surface used from outside the file.** These names are frozen by P0 (§3) until a phase
renames one on purpose:
- Public: `applyMutation`, `getStrip`, `getAll`, `getRack` (9 callers), `currentSeq`, `epoch`,
  `getDeltaSince`, `drainTouched` (3), `hasApplied`, `nlaStatusFor` (3), `reassignPositionStrips`,
  `returnCoveredStrips`, `archiveStrip`, `droppedWallAtOf`, `snapshot`, `restore`, `setMutationLog` (6), and the
  seven `receive*` methods. A peer Board calls the `receive*` methods.
- Private, reached by tests and tools: `_strips` (7), `_nlaHistory` (3), `_appliedMutations` (4), `_touch` (2),
  `_log` (2), `_cidSeq`, `_droppedWallAt`, `_bayForNewOwner` (3), `_fdrStore` (3). Moving code with mixins
  (§2.3) keeps every one of these working without changing a test.

**Coverage** (all of `npm test`): `board-store.js` 97.62% lines, 83.60% branches, 100% functions. The uncovered
lines are almost all refusal branches (95–96, 395–397, 756–787, 906–911, 948–949, 1408–1462, 1858–1859, 2032–2033, …).
`efsp-ws.js` 99.4/86.1, `index.js` 99.4/87.9, `ws-hub.js` 91.5/80.1. **`server.js` has no unit coverage**:
nothing can require it, because it starts the server and its timers at module load.

### 1.2 `crc-sync/src/efsp/efsp-ws.js` — 1,158 lines (39% comment)

| Cluster | Lines |
|---|---|
| Header, `_stampStrip`, `_mergeFdrs`, `_touchedStrips`, `_boardDelta`, replay-cache helpers, `_subject` (a per-family switch) | 1–180 |
| `handleMessage` dispatcher (a 10-case switch) | 181–195 |
| Board Mutation path (`_handleMutation`): gate, apply, persist, ack, then the primary, peer, MARSA and carrier broadcasts | 197–324 |
| Resync (ADR 0006, 0081) | 326–402 |
| Airspace / correlation / MARSA / carrier / field-state / ATO family handlers | 404–711, 965–1157 |
| Set-positions (covering chain, persist) | 712–787 |
| Read scope (ADR 0080): `filterForSession` (a per-type switch), `supplementFor` | 788–864 |
| Snapshot (one key per family) | 866–964 |

Each family handler repeats the same skeleton: find the store, bind the session ("Primary at" or "Primary
somewhere"), look up the replay cache, `apply`, remember the outcome, `persist()` on ok, build the ack with
`_subject`, then build the broadcast. Counted: `primaryOf(` 7, `unaudited: true` 12, `_cachedOutcome(` 6.
`replay-cache.js` has a fixed `KINDS` set, edited by L17 (carrier) and L18S (sfa). `ws-hub.js` sends
`result.broadcast`, `.peerBroadcast`, `.marsaBroadcast` and `.carrierBroadcast` by name, and every new
family adds one more key.

### 1.3 `crc-sync/src/efsp/index.js` — 643 lines (43% comment): the composition root

Seven shared stores are built before the per-Facility loop. Each Facility gets a `rules` object of
**43 keys**: closures over `facilityConfig`, `blockMap`, `nla`, `permission`, `coordination`, the
`positionStore`, `airspaceStore`, `marsaStore`, `fieldStateStore`, `carrierStore` and `carrierModel`.
`_persist` and `_restore` take the stores **as positional arguments, 8 and 9 of them**. Adding a store
therefore means editing both signatures, both call sites, the `JSON.stringify` literal and the restore
sequence. S-M24 and S-M27 had their merge conflicts in exactly that block and in the `ctx` literal.
Back-compat aliases are still present: `efsp.boardStore` is INCIRLIK, and `_restore` still accepts the
pre-WP4A `data.board` shape.

### 1.4 `crc-sync/server.js` — 732 lines: a composition root with module-level side effects

| Cluster | Lines |
|---|---|
| Express app, auth, ws-ticket | 1–124 |
| Stores, picture, surveillance, coverage, 2 intervals | 125–245 |
| gRPC events (9 `grpcClient.on`), weather, mission session, mission-load | 246–400 |
| REST endpoints | 400–535 |
| EFSP monitors: instrumentation, archiver, obligations, NLA status, correlation reconciler, carrier tick, conformance, hints, STCA, alert compose | 536–724 |

There are **11 `setInterval`** calls at module scope and **6 `require`s in the middle of the file** (270, 538,
562, 642–644). The mission-load closure at line 299 calls `correlationReconciler`, which is declared at line 625.
This only works because the closure runs later. `tools/soak/host-core.js` (518 lines) **re-implements** the
monitor wiring (obligations, NLA status, reconciler, conformance, STCA, archiver) so that it can drive them one
tick at a time. As a result the soak does not exercise `server.js`'s real wiring, and the two copies can drift
apart.

### 1.5 `crc-desktop/app/public/js/panels/efsp/bay-view.js` — 3,066 lines (39% comment), 160 top-level names

| Cluster | Lines | Size |
|---|---|---|
| Selection state, refusal seeding, advance swallow | 1–127 | 127 |
| Block cells and inline editing (enum select, boolean toggle) | 128–512 | 385 |
| Drop arming, annotation history chips, expanded view, `_buildStripEl` | 513–901 | 389 |
| Popover portal infrastructure | 902–1102 | 200 |
| Bind and MARSA popovers and forms, dispatch helpers | 1103–1402 | 300 |
| Selection, keyboard, acting Position, NLA/move/transfer dispatch | 1403–1568 | 166 |
| Coordination: permissions, dispatch, display helpers, popover | 1569–1666, 1989–2165 | 275 |
| TOFI and hand-back | 1667–1892 | 226 |
| Convert to arrival, airspace entry popover | 1893–1988 | 96 |
| Gestures, highlight popover | 2166–2245 | 80 |
| Pointer-events drag, autoscroll | 2246–2600 | 355 |
| OPS filed-plan cards | 2601–2713 | 113 |
| Bay/Rack render, reconcile, render signature, scheduling | 2714–3066 | 352 |

**Coupling through the global scope:** 59 of `bay-view.js`'s 160 top-level names are read by other scripts, 48 of
them by `strip-view.js`. `bay-view.js` itself reads 21 names from `efsp-state.js` and 14 from `strip-template.js`.
Across all 53 client scripts there are 1,186 top-level names, and **three are declared twice**:
- `finite` (`const`): `pattern-board.js:40` and `final-panel.js:43`. Loading both as classic scripts throws
  `SyntaxError: Identifier 'finite' has already been declared` (reproduced in a vm), so `final-panel.js` does not
  load on `integ/wave3-dry`. L18S fixed this on its branch (decision S-L18S).
- `_el`: declared in three scripts with two different signatures, and `metrics-panel.js` loads last and wins.
- `_callsignOfFdr`: `carrier-panel.js:146` falls back to the fdrId and `efsp-panel.js:904` falls back to `''`.
  `efsp-panel.js` loads later and wins, without any error. L18S's uniqueness test only covers the Bay-view
  scripts, so it does not catch this one.

The file also holds six hand-copied server authority tables (`COORDINATION_TARGETS`, `TOFI_COUNTERPARTS`,
`HAND_BACK_TO`, `TOFI_ANSWERED_BY`, `AIRSPACE_ENTRY_POSITIONS`, `CONVERT_TO_ARRIVAL_POSITIONS`). PARITY found no
drift, and those tests hold them in step (`docs/wip/PARITY.md`).

### 1.6 The other client files

- `efsp-panel.js`: 1,598 lines (36% comment). It defines 95 top-level names, 22 of them read elsewhere.
- `app.js`: 870 lines (27% comment). It has **20 `case 'efsp-…'`** branches in one `ws.onmessage` switch, two for
  each family (delta and ack).
- `strip-view.js`: 890 lines. It already has an extension point: plan §2 says to add a case through
  `_stripAlerts`/`_buildIndicator` rather than restructure.

### 1.7 What the shared-file rules in plan §2 are a symptom of

The ownership table in `docs/efsp-parallel-plan.md` §2 lists eleven shared files. Five of them are
**serialised outright** (`block-map.js`, `nla.js`, `permission.js` handed from lane to lane, `facility-config.js`
by wave). The rest have **append-only rules** (`index.js`, `efsp-ws.js`, `app.js`, `index.html`). Decisions
S-L8, S-R2-1 and S-L6 made L27 go before L23 on `board-store.js` and `efsp-ws.js`, and let L23 edit "only the
functions L8 named". L28's briefing waits on four lanes for three files. Each of these rules exists because a
**capability has no home of its own**: its states, owners, NLA, wire path and persistence sit as rows and
branches inside shared files. The fix is to give each capability a home and make the shared files tables of
registrations.

---

## 2. Target architecture

### 2.1 Principles

1. **Behaviour does not change.** The wire, the audit log, replay and epoch behaviour and the persisted snapshot
   come out byte-equal (§4). Each phase is a move, not a redesign.
2. **A capability lives in its own files.** A shared file only lists registrations, appended one line at a time,
   so two lanes adding two capabilities conflict on at most one line each.
3. **Extension points are tables, not branches.** The codebase already works this way where it works well:
   `nla.js`'s `COMPUTE_BY_ROLE`, `permission.js`'s capability tables (ADR 0080),
   `CARRIER_TRANSFER_EFFECTS` (ADR 0074), the Bay descriptor `view` flags (ADR 0093, L18S), and
   `strip-view.js`'s `_stripAlerts`. This plan extends that pattern. It does not invent a new one.
4. **No new machinery.** No DI container, no event bus, no class hierarchy, no build step, no codegen at runtime.
   Each registry is a plain array or object in a plain file.
5. **Comments move with their code, verbatim.** They are 40% of these files and carry the defect history.

### 2.2 The seams: what is pure, what holds state, what is the wire

| Layer | Holds state? | Examples (after the refactor) |
|---|---|---|
| Doctrine tables and pure rules | no | `roles/*.js` (S3), `block-map.js`, `coordination.js`, `carrier/transfers.js`, `field-state.js`, `board/placement.js` (pure functions over a Bay list and a runway view), `board/order.js` |
| Stores (one record home each) | yes, persisted | `board/board-store.js` (kernel), `fdr-store.js`, `airspace-store.js`, `marsa-store.js`, `carrier-store.js`, `field-state-store.js`, `correlation-store.js`, `sfa-store.js` |
| Board behaviour, split by concern | uses the kernel only | `board/ops/*.js`, `board/nla-apply.js`, `board/retire.js`, `board/protocols/coordination.js`, `board/protocols/tofi.js`, `board/admin.js` |
| Wire | no domain state | `wire/efsp-ws.js` (the generic skeleton, resync, snapshot, read scope), `wire/families/*.js` |
| Runtime wiring | owns timers | `src/runtime.js` `createRuntime(deps)` → `{ wsHub, efsp, monitors, tickers, start(), stop() }`; `server.js` builds the deps and calls `start()` |

### 2.3 crc-sync directory layout (target; new paths in **bold**)

```
crc-sync/
  server.js                      env → deps, createRuntime(deps).start(), app.listen. No setInterval here.
  src/runtime.js                 ** createRuntime: builds stores, monitors, WsHub; `tickers` = [{name, periodMs, tick}]
  src/ws-hub.js                  sends result.broadcasts[] in order (no named broadcast keys)
  src/efsp/
    index.js                     createEfsp: loops the registries below; no positional store lists
    stores.js                    ** STORE REGISTRY: [{key:'fdr', build, snapshot, restore, after?}, …] in today's persist order
    board/
      board-store.js             ** kernel (clusters A–C, I, J): strips map, _bump/_touch, seq ring, epoch,
                                    idempotency, dispatch by OPS table, audit, snapshot/restore  (~750 lines)
      order.js                   ** _resolveOrderKey/_keyAfterRebalance/_rebalanceRack/_appendOrderKey (mixin)
      placement.js               ** _placementRack, _bayForNewOwner, _relocateForImpliedState,
                                    _validateBayImpliedTransition, _requireKnownBay (mixin)
      ops/index.js               ** OPS TABLE: { MoveStrip: require('./move'), … } plus per-op `authorize`
      ops/create.js, convert-to-arrival.js, airspace-entry.js, move.js, set-block.js, transfer.js,
      ops/set-flag.js, set-state.js, role-transfer.js (carrier + SFA, S2c)
      nla-apply.js               ** cluster E
      retire.js                  ** cluster F
      protocols/coordination.js  ** cluster G
      protocols/tofi.js          ** cluster H
    roles/                       ** (S3) one file per Role family; roles/index.js aggregates and re-exports
      departure.js arrival.js overflight.js mission.js marshal.js final.js pattern.js
    wire/
      efsp-ws.js                 ** generic family skeleton + Board path + resync + snapshot + read scope
      families/index.js          ** FAMILY REGISTRY (append one line per family)
      families/airspace.js correlation.js marsa.js field-state.js carrier.js ato.js sfa.js …
    nla.js, permission.js        stay as facades re-exporting from roles/ (S3), so no consumer changes
```

**Moving a class's methods out without rewriting them.** In S2 every moved cluster is a mixin:
`Object.assign(BoardStore.prototype, require('./protocols/coordination'))`. The method bodies keep `this`
exactly as written, every private name that tests and tools reach still resolves, and the diff is a pure move.
One source-scan test is the seam check: a mixin file may not read `this._strips`, `this._log`, `this._seq`,
`this._epoch`, `this._touchedSinceDrain` or `this._appliedMutations`. It goes through the kernel's methods
instead (`getStrip`, `getAll`, `getRack`, **`_insertStrip`** for replica minting, `_touch`, **`_bump`**,
`_recordPeer`, `_activeCmid`). Plain functions taking a `board` argument would read better in theory. They
would also rewrite every `this.` in 2,000 lines, which is the risk this plan is avoiding. They can come later,
one file at a time, if anyone still wants them.

**The `rules` object keeps its shape.** It holds 43 keys and 84 board-store unit tests build partial `rules`
fixtures, so regrouping it into typed ports would churn every one of those fixtures for no change in behaviour.
Instead:
- P0 adds a **wiring-completeness test**: every `this._rules.X` that board-store reads (by source scan) is a key
  of the `rules` that `createEfsp` builds for every Facility. That closes the "silent off" hole for the
  production path while leaving the unit fixtures alone.
- Removing the `this._rules.x &&` guards is allowed by "no backwards compatibility", but it changes behaviour for
  partial fixtures. It is a separate small lane after S2 (decision D5).

### 2.4 Extension points: how a new capability plugs in without editing a god file

| Extension point | Shape | Today, a new one means editing | After |
|---|---|---|---|
| **Wire family** (`efsp-<x>-mutation`) | `families/<x>.js` exports `{ type, ackType, deltaType, replayKind, subject(msg), gate: 'primary-at-facility'\|'primary-somewhere'\|fn, apply(ctx, session, msg), ack(result, ctx), broadcasts(result, ctx), snapshotKey?, snapshot?(ctx, session), filter?(ctx, session, msg) }` | the `efsp-ws.js` switch, a hand-written handler, the `_subject` switch, the snapshot literal, `filterForSession`'s switch, `replay-cache.js` `KINDS`, a new `ws-hub.js` broadcast key | one new file and one line in `families/index.js`. The skeleton enforces the session binding, `unaudited`, the replay cache, persist-on-ok and broadcast order once, for every family |
| **Persisted store** | `stores.js` entry `{ key, build(deps), snapshot(store), restore(store, data), after?(all) }` in today's order | `_persist`'s and `_restore`'s positional parameters, both call sites, the JSON literal, `setMutationLog` calls, `ctx` and the return literal | one entry, appended. Persist order is the array order, so the JSON key order stays byte-equal (§4) |
| **Board op** | `ops/<op>.js` exports `{ kind, authorize?(rules, actingPositionId, op), apply(board, strip, op, meta) }` | the `_dispatch` switch, plus a special case before `canMutate` (CarrierTransfer, SfaRotation), plus `_recordAudit` fields | one new file, one line in `ops/index.js`, and an `auditFields(result)` hook for its audit extras |
| **Role-change transfer** (carrier's four, SFA rotation, the next one) | a row in `transfers` `{ kind, fromRole, fromState, toRole, toState, owner: 'TO'\|'SAME', receiver(rules, strip, op), trigger, label, auditKeys: {kind:'carrierTransfer', trigger:'carrierTrigger'}, effect?(rules, strip, meta) }` | a ~80-line copy of `_applyCarrierTransfer` (L18S's `_applySfaRotation` is that copy) | one table row. The one implementation keeps each family's existing audit field names, so the audit log does not change |
| **Role family** (S3) | `roles/<role>.js` exports `{ role, states, initialState, computeNla, stateOwners, creators, countableStates, replicaStateOnReceipt, coordinationEligibleState, tofiEligibleState }` | `nla.js` (states, sets, compute), `permission.js` (owners, creators), `board-store.js` (`DEFAULT_INITIAL_STATE_BY_ROLE`, L28's `REPLICA_STATE_ON_RECEIPT`), `traffic-count.js` countability, `coordination.js` eligibility, the client mirrors | one file, plus Block Map rows (`block-map.js` stays the Block table) and Bays in facility config. The client tables regenerate (C2) |
| **Client message family** (C1a) | `registerEfspMessage(type, handler)` in the family's own script | two `case`s in `app.js`'s switch | one call in the family's own file. `app.js` keeps a one-line dispatch |
| **Client Bay view** | already done: ADR 0093's descriptor `view` → `bay-views.js` | (exists) | (exists) |

**Walkthroughs** (what each upcoming item would touch once the relevant phase has landed):

- **L28, the OVERFLIGHT lifecycle (if it lands after S3):** `roles/overflight.js` (states, initial `INBOUND`,
  `computeNla`, owners, countable states, replica state on receipt), the two Bay lines in the facility config,
  and the regenerated client tables. If it lands **before** S3, which is the expected order, it edits today's
  seven files and S3 moves its tables like everyone else's. L28 should not wait for the refactor.
- **AIRSP phase 2, editing airspace definitions:** a `families/airspace-definition.js` (gate: the controlling
  Position, refusals, an audit through the store, a broadcast of an `efsp-airspace-delta` with the new
  definitions), an `AirspaceStore`/`airspace-config.js` method that writes `state/` (ADR 0048), a `stores.js`
  entry if definitions join the snapshot, and on the client one `registerEfspMessage` call in
  `airspace-panel.js`. No edit to `efsp-ws.js`, `ws-hub.js`, `index.js` or `app.js`. **This is the reason to land
  S1 before AIRSP phase 2.**
- **A carrier/SFA-like Role family (for example a second ship, or RSU Roles):** `roles/<role>.js`, one
  `transfers` row for each role-changing hand-over, a `stores.js` entry plus a `families/<x>.js` if it has its
  own record (as the carrier stack and the SFA rotation do), its Bays with a `view` flag (ADR 0093), and a
  client view registered in `bay-views.js`. No edit to `board-store.js`.

### 2.5 What the client mirrors become (D-9)

There are two kinds, and they are treated differently:
1. **Code constants** (state lists, owner tables, op-kind groups, the TOFI and hand-back capability rows, carrier
   transfer labels, field-state owners, separation regimes, IFF states). A generator (C2) writes
   **`crc-desktop/app/public/js/panels/efsp/efsp-tables.generated.js`** from the crc-sync modules at development
   time. It declares exactly one global, `EFSP_TABLES`, and also `module.exports` for tests. It is checked in,
   because crc-desktop never requires crc-sync at runtime (ADR 0001, and packaging). A **freshness test**
   regenerates it in memory and diffs it against the checked-in copy. The client reads `EFSP_TABLES.X` in place
   of hand-written literals, and the parity tests for those tables retire, because the freshness test replaces
   them. This removes the triple edit (server table, client copy, parity test) that every `permission.js` or
   `nla.js` change costs today.
2. **Config-derived data** (Bays, Positions per Facility, airspaces, runway inventories) already travels in the
   snapshot (Bays since ADR 0093). It stays on the wire. It is never generated, because a config edit must not
   need a client release.

**Mirrors of behaviour** (`ordnance-advisory.js`, the logic in `field-state-rules.js`, `time-chains.js`,
`zulu-time`) stay as hand mirrors under the existing parity tests. Generating code is out of scope.

C2 is **optional**. PARITY found no live drift, and every mirror already has a test, so the gain is less
editing rather than correctness. Do it together with S3, when the role tables move anyway.

### 2.6 What the client architecture does *not* become

- **Not ES modules.** Electron could load `type="module"`, but 27 scripts carry a guarded `module.exports` for
  `node:test`, and the 46 client test files `require()` the scripts and inject globals through `globalThis`.
  Moving to ESM would rewrite the test harness (800 tests), change the load and defer order, and conflict with
  every UI lane, while the explicit imports it buys are partly already provided by the uniqueness test.
  Revisit only if the client ever gets a build step.
- **Not a namespace rename.** Moving 1,186 top-level names behind `window.EFSP.*` would touch every client file.
  The failure that actually happens (a duplicate name) is caught by a cheap test (C0). New files follow the
  rule "prefix your private top-level names with the file's short name". L18S's `bay-views.js` does not do this
  yet (`_send`, `_heldAt`, `_mountPoint`), and only the C0 test keeps those names safe.

---

## 3. Migration plan (each phase merges on its own and stays green)

### Phase 0: characterization (golden master). Tests only, start now

Full briefing: `docs/wip/ARCH-plan-p0-briefing.md`. Summary:

- **Harness:** a real `createEfsp()` behind the real `WsHub`, with fake sockets (the `host-core.js` technique),
  three Facilities, fixed facility and airspace fixtures, a manual mission clock, a deterministic `Date.now`
  and a seeded `crypto.randomUUID` (patched on the module object that board-store and fdr-store call through).
  Each step records the input message, every message each fake socket receives in order (this covers ack and
  broadcast order and ADR 0080 read-scope filtering), the Mutation-log lines appended, and the persisted
  `efsp-board.json`, parsed: in full at checkpoints and as a hash at every other step.
- **Corpus:**
  - T1, the op × outcome matrix. Every op kind, every coordination primitive × action, every TOFI action and
    every CarrierTransfer kind, each with its success and every reachable refusal reason. The coverage report's
    uncovered branch list (§1.1) is the checklist.
  - T2, sortie walks. The step sequences of the existing scenario suites, rewritten as traces: civil and
    military round trips, coordination, carrier, tactical, manning, field state, MARSA, airspace, correlation,
    ATO, scramble, ordnance, release, time chains, concurrency.
  - T3, seeded random traffic. `tools/soak/traffic.js` and `prng.js` in-process, 3 seeds × about 1,500
    messages, with reconnects and resyncs, Position changes, time advances that trigger archiver sweeps, and a
    restart (persist, a new `createEfsp`, restore, a new epoch) at fixed points.
  - T4, crash and restart. The NotPersisted-marker path, using `efsp-crash-replay.test.mjs`'s technique.
  - T5, monitor ticks. `nlaStatusMonitor.tick`, `archiver.sweep`, and the covering-chain reassign through
    set-positions.
- **Guards added alongside:** the wiring-completeness test (§2.3), a frozen list of the Board's public and
  private surface used outside the file (§1.1), and a client "global surface" test: load every `index.html`
  script in order in a vm with the DOM stub, require no load error, require no duplicate top-level name across
  all scripts, and freeze the set of names.
- **Detector proof** (`npm run golden:selfcheck`, not part of `npm test`, like `soak:selfcheck`): at least eight
  seeded source mutations applied to a temporary copy of `src/` (drop a `_touch`; swap the peer and MARSA
  broadcast order; change a refusal detail; drop `causedBy`; persist the replay window as 0; persist the epoch;
  drop an `unaudited`; skip the proactive rebalance). Each must make the golden test fail.
- **Fixtures:** compact JSONL under `crc-sync/tests/golden/fixtures/`, under 2 MB, and under 10 s in `npm test`.
  Recorded on `integ/wave3-dry` now, and **re-recorded once at the start of the freeze**. After that, no refactor
  phase may re-record (§7, D6).
- **Effort:** 1 lane (Sonnet), about one agent-day. **No conflicts:** new files only.

### Phase C0: client uniqueness (small, now)

Widen L18S's top-level-name uniqueness test to **every** script `index.html` loads, and fix `_callsignOfFdr`.
Keep `carrier-panel.js`'s fdrId fallback under a private name. Which fallback the UI wants is a one-line
question for UI-B. If L18S has not merged, this lane also fixes `finite` and `_el`, or waits for L18S.
Effort: 0.25 lane. It fits inside UI-B, or a hygiene lane.

### Phase S1: registries for wire families and persisted stores

- `wire/families/*.js` and the generic skeleton. The six family handlers move verbatim into family files, and
  their shared head and tail (session gate, replay, `unaudited`, persist, `_subject`) move into the skeleton.
  The Board path (`_handleMutation`), resync, set-positions and the snapshot stay in `wire/efsp-ws.js`.
- `replay-cache.js` `KINDS` is derived from the registry.
- `stores.js` registry. `_persist` and `_restore` loop over it in today's order, so the JSON key order and the
  restore order stay exactly as they are (fdr before boards before correlations, and so on).
- The handler result carries `broadcasts: [...]` in today's send order (broadcast, peer, MARSA, carrier).
  `ws-hub.js` sends them in a loop, and `onEfspChange` fires when the list is non-empty. The internal result
  object changes but the wire does not. `tools/soak/host-core.js` and the ws-hub tests that read the named keys
  are updated in the same lane.
- **Gate:** golden byte-equal; `npm test` (crc-sync, crc-desktop); `soak:selfcheck` 5/5; `soak:smoke` PASS;
  `wire-payload-contract`, `ws-message-contract`.
- Effort: 1 lane.

### Phase S2a: the Board kernel, and coordination and TOFI out

- Add `_bump(strip, by)` (rev, updatedAt, updatedBy, `_touch`) and `_insertStrip(strip)`, and replace the 32
  repeated four-line blocks. Behaviour is identical. The mission-clock read stays one `this._clock.now()` per
  bump; check the two sites that read `now` once and reuse it (`_applyCarrierTransfer`, create).
- Move clusters G and H verbatim into `board/protocols/coordination.js` and `board/protocols/tofi.js` as
  prototype mixins. Move orderKey resolution into `board/order.js`.
- Add the mixin seam test (§2.3).
- **Result:** `board-store.js` drops to about 1,900 lines, and each protocol is one file.
- Gate: as S1. Effort: 1 lane (mostly mechanical).

### Phase S2b: the op table, NLA, retirement, placement

- `_dispatch`'s switch becomes `OPS[kind]`, with `authorize` per op (CarrierTransfer, and SfaRotation once
  merged). `_recordAudit`'s per-op extras become `auditFields(result)`, which emits the same keys in the same
  order.
- Clusters D, E, F and the placement helpers move into `ops/*.js`, `nla-apply.js`, `retire.js` and
  `placement.js`. The D⇄E knot stays a knot, now across two files that call each other through `this`.
- **Result:** the `board-store.js` kernel is about 750 lines (A, B, C, I, J).
- Gate: as S1. Effort: 1 lane.

### Phase S2c (optional; after L18S): one role-change transfer

`_applyCarrierTransfer` and `_applySfaRotation` become one `_applyRoleTransfer` over a `transfers` table. Each
row keeps its own audit keys (`carrierTransfer`/`carrierTrigger`, `sfaTransfer`/`sfaTrigger`), its refusal
wordings and its stack effect. The golden test proves the audit lines and refusals are unchanged.
Effort: 0.5 lane.

### Phase S3: Role families

`roles/*.js` as in §2.4. `nla.js` and `permission.js` keep their exports as facades (`STATES_BY_ROLE`,
`STATE_OWNERS_BY_ROLE`, `computeNla`, `canActOnState`, …), so callers, the client parity tests and the soak do
not change. The `board-store.js` constants that are per Role (`DEFAULT_INITIAL_STATE_BY_ROLE`, the replica
state on receipt) move into the role files. `traffic-count.js` countability reads `roles`.
Gate: as S1, plus the client parity tests. Effort: 1–1.5 lanes. **After L28 merges**, so that the OVERFLIGHT
tables move once.

### Phase S4: `createRuntime()` (parallel with S2/S3; disjoint files)

`src/runtime.js` builds everything `server.js` builds today, in today's order. Timers become
`tickers: [{ name, periodMs, tick }]`, and `start()` installs the intervals. The `grpcClient.on` handlers are
attached in `start()` too. `server.js` keeps env parsing, Express routes, `start()` and `listen`.
`tools/soak/host-core.js` calls `createRuntime` with fakes and drives `tickers` by name instead of
re-implementing the wiring. The forward reference to `correlationReconciler` disappears, because the runtime
builds in dependency order.
- **Gate:** a new boot smoke test (`createRuntime` with fake gRPC and SRS clients; assert the ticker names and
  periods match today's 11 intervals; one tick of each); `soak:selfcheck`; `soak:smoke`; a manual local start
  on a non-3000 port.
- **Conflicts:** S13 (collab persistence, `server.js` 14 lines), and any lane adding a monitor.
- Effort: 1 lane.

### Phase C1: the client

- **C1a:** an `efsp-messages.js` registry. Each family's script registers its delta and ack handlers. `app.js`'s
  20 cases become one dispatch line. `ws-message-contract.test.js` reads the registry. Effort 0.5 lane.
  **Before AIRSP phase 2**, for the same reason as S1.
- **C1b (optional):** split `bay-view.js` by the clusters in §1.5 into classic scripts with the **same global
  names** (block edit, strip element, popover portal, one popover script per feature, drag, OPS filed cards).
  `bay-view.js` keeps selection, dispatch and render/reconcile (about 650 lines). Gate: the C0 global-surface
  test (the name set is unchanged), `npm test`, the full Playwright suite. Effort: 1 lane. Do it only in a client
  freeze window (UI-B, AIRSP and L28's client step all touch these files).

### Phase C2 (optional): generated client tables

As §2.5. Do it with or after S3. Effort: 1 lane.

### Order relative to the lanes in flight, and the freeze

```
NOW (no conflicts)      P0 harness + fixtures on integ/wave3-dry   C0 (inside UI-B, or a hygiene lane)
                        S-14 time-module check (separate, not architecture; see §8)
THEN (already queued)   real merge → L18S → UI-B → L28 → L20 (L20 runs solo, as planned)
FREEZE W1 (server core) re-record golden → S1 → S2a → S2b → (S2c) → S3 → (C2)
   in parallel          S4 (server.js, runtime.js, tools/soak)      C1a (app.js, client registry)
                        C1b only if the client is also frozen
AFTER S1                AIRSP phase 2 (its first consumer of the family registry)
```

- **Why after L20:** L20 edits comments and UI text everywhere, and runs alone. S2 moves 1,000+ comment lines.
  Running them concurrently would conflict on every hunk. L20's inventory (L9, L20PREP) quotes text, so if L20
  went second its rows would survive the move. But L20 changes refusal details (wire text), which would force a
  golden re-record in the middle of the freeze. L20 first is cleaner.
- **The freeze (W1):** from the S1 dispatch until S3 merges, no other lane edits
  `crc-sync/src/efsp/{board-store,efsp-ws,index,nla,permission,replay-cache,coordination,traffic-count}.js` or
  `crc-sync/src/ws-hub.js`. All other work continues: new stores in new files, client panels, atobrief,
  sourcedcs-web, infra. Expected length: **4 sequential lane slots, about 2–4 working days** including merges and
  gates. The minimum version, S1 and S2a only, takes 2 slots.
- **If AIRSP phase 2 must start before S1:** let it build the old way. S1 then moves it like the other families,
  which costs about an hour.
- **QAS** (crc-sync cleanup, not started; its scope is unknown to this lane): must not touch the frozen files
  during W1.

---

## 4. What must never change, and how each is verified

| Invariant | Source | How it is verified |
|---|---|---|
| Wire format: every message type and field, the `version: 1` envelope, JSON | ADR 0001; PARITY's contracts | golden (every socket's received messages, byte-equal); `wire-payload-contract.test.mjs`; `ws-message-contract.test.js` |
| Immediate broadcast in the same synchronous pass; send order broadcast → peer → MARSA → carrier | ADR 0004, 0022 | golden (per-socket order); `ws-hub` tests |
| One Board event, one broadcast; touched Strips drained; DROPPED goes to `gone`; `boardEpoch` on every delta and ack | ADR 0081 | golden; `efsp-ws-replay`; `soak:selfcheck` (detectors for missed touches and seq gaps) |
| Epoch minted on construction and on `restore()`, never persisted; delta only within one epoch; `RESYNC_RING_WINDOW` 900 against pruning at 2,000/1,000 | ADR 0081, 0006 | golden T3 restart points; resync tests |
| Replay records compact and frozen; the last 10 minutes of wall time persisted; a replay acks only (no persist, audit or broadcast); a cmid-less Mutation is never cached; the non-Board replay cache is consulted after the gates | ADR 0081 | golden T1 (retries), T4; `efsp-crash-replay`; the detector proof |
| Audit: a store logs what reaches it, and the tap logs what does not; `unaudited` never reaches the wire; peer entries have `clientMutationId: null` and `causedBy`; every entry names `facilityId`/`fdrId`; SetBlock records `blockId`/`value`; the audit line is written before the snapshot | ADR 0083, 0065, 0081 | golden (log lines per step); traffic-count tests; the soak ledger |
| Persisted snapshot shape and key order (`persistedWallAt`, `boards{}`, `fdr`, `airspaces`, `correlations`, `marsa`, `fieldStates`, `carriers`, plus `sfa` once L18S lands); the dirty-only write; temp file then rename | ADR 0002, 0048, 0081 | golden (parsed snapshot at checkpoints, raw body hash every step); a restore round-trip test |
| Mission clock for every EFSP time; `Date.now` only for the four documented wall-time uses (NLA latch, `appliedWallAt`, `droppedWallAt`, `persistedWallAt`) | ADR 0079, H11 | a source-scan test that freezes the list of `Date.now()` sites per file (P0) |
| A Strip never crosses a Facility; one `BoardStore` per Facility; peers are called in-process | ADR 0013, 0015 | golden T2 coordination and TOFI walks |
| Read scope per session; a filtered snapshot on scope change | ADR 0080 | golden (per-socket filtering); `ws-hub-read-scope` |
| Carrier hand-overs have one implementation; four triggers recorded | ADR 0074 | golden T1; carrier scenario |
| Bay descriptor flags reach the client unchanged | ADR 0093 | `bay-descriptor-parity`; L18S tests |
| ADRs are never edited (P4); tuning files are read once (P5); no `pkill` (P7) | lane rules | review |
| The client's behaviour and DOM | n/a | crc-desktop `npm test` (800); the full Playwright suite after every C phase and once at the end of W1; the C0 global-surface test |

**The hard rule for every refactor phase:** golden fixtures are compared, never re-recorded. If a phase needs
to re-record, it is not a refactor. The lane stops and reports.

---

## 5. Effort, value, and an honest answer to "is it really necessary"

| Phase | Lanes | Value | Risk | Verdict |
|---|---|---|---|---|
| P0 golden master + guards | 1 | High. It protects every future lane, not only this refactor | none (tests only) | **Do** |
| C0 uniqueness test + `_callsignOfFdr` | 0.25 | High. It fixes a live defect class | none | **Do** |
| S1 wire families + store registry | 1 | High. It removes the copy-paste gate class and the `index.js`/`efsp-ws.js` fan-out | low with P0 | **Do** |
| S2a kernel, `_bump`, coordination and TOFI out | 1 | High. It halves the file with a verbatim move | low | **Do** |
| S4 `createRuntime` | 1 | Medium-high. The soak tests the real wiring, and the forward reference goes away | low-medium | **Do** |
| S2b op table, NLA, retire, placement | 1 | Medium. New ops stop editing `_dispatch` and `_recordAudit` | low-medium | Do if more ops are coming (they are) |
| S3 Role families | 1–1.5 | Medium-high for "carrier/SFA-like Roles". It turns L28's 7 files into about 2 | medium (core tables) | Do after L28 |
| C1a client message registry | 0.5 | Medium. It takes `app.js` off every family lane's path | low | Do before AIRSP phase 2 |
| S2c one role-change transfer | 0.5 | Low-medium. It deletes one 80-line copy | low | Optional |
| C1b `bay-view.js` split | 1 | Medium for UI lanes' conflicts, low for behaviour | medium (Playwright-only coverage of the DOM) | Optional, client freeze only |
| C2 generated client tables | 1 | Low-medium. Parity tests already catch drift | low | Optional, with S3 |
| ESM, namespace rename, DI, typed ports, schema codegen | 3+ | Low | high | **Don't** |

**Tiers:** **A** (minimum) = P0, C0, S1, S2a, S4 ≈ **4.25 lanes**. **B** (recommended) = A + S2b, S3, C1a ≈
**7.25–7.75 lanes**. **C** (everything sensible) = B + S2c, C1b, C2 ≈ **9.75–10.25 lanes**.

**Is a 3,000-line `board-store.js` really necessary?** No. Size, though, is the least of it:

- **It is not as big as it looks.** 40% of it is comments, and they are good ones: rationale, defect ids and ADR
  pointers. The code is 1,700 lines with 97.6% line coverage. Nobody has to read all of it to change it, and
  the lane notes report almost no "I could not find where" trouble in it. The traps the lanes did hit
  (L1's "never add field-state kinds to `OP_KINDS`", L17's `ReplayCache` kind list, L14's render signature,
  L1b's detached dockview DOM) are **registration and fan-out traps**, not size traps.
- **The cost is serialisation and repetition.** One capability touches 6–10 shared files. The same gate is
  re-typed for each family, and the same "rev, updatedAt, updatedBy, touch" block 32 times. Optional rules switch
  checks off when they are not wired. The composition root is untestable and has been duplicated for the soak.
  These are the reasons the parallel plan needs an ownership table, serialised lanes and merge orders, and they
  get worse with every Role family (L17 added three Roles, L18 three Positions and a rotation, L28 a lifecycle).
- **So the refactor worth doing is the one that gives capabilities a home (S1, S2b, S3) and halves the file by a
  verbatim move (S2a).** A clever Board decomposition into many classes, typed ports or an event bus would be
  over-engineering. The existing table-driven pattern (`COMPUTE_BY_ROLE`, the capability tables, the transfer
  effects, the Bay `view` flags) already works and only needs extending.
- **The client is the same story at lower stakes.** `bay-view.js` is large but cohesive per feature. The actual
  defects come from the shared global scope (a live one today) and are fixed by a test, not by an ESM migration.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| A verbatim move still changes behaviour (method name shadowing between mixins, a `this` lost in a callback) | P0 golden byte-equal; the mixin seam test; `Object.assign` throws nothing on a clash, so the S2 lane adds a test that the mixins define disjoint names |
| The golden corpus misses a path | the T1 matrix is built from the coverage report's uncovered-branch list; the detector proof; the existing 1,947 tests stay |
| Fixtures go stale while lanes merge before the freeze | re-record exactly once at the freeze start, as a single reviewed commit |
| A phase drifts into a redesign | the hard rule in §4 (no re-record in a refactor phase); the supervisor reviews each diff for "moves only" |
| The freeze blocks urgent fixes | a bug fix may land during W1 if it re-records the golden in its own commit and the next refactor lane rebases onto it (the supervisor merges in between) |
| S4 boot ordering changes timer phase | the boot smoke test asserts the same names and periods. Timer phase is not behaviour anything depends on (the soak drives ticks explicitly) |
| C1b breaks load order | the C0 global-surface test plus the full Playwright run |

---

## 7. Decisions the human must make

- **D1 — scope.** Tier A, B or C (§5). **Recommended: B**, done as A first, then S2b, S3 and C1a once A has
  shown the golden master holds.
- **D2 — the freeze window.** W1 after L20, about 2–4 working days on the files listed in §3, with S4 and C1a in
  parallel. **Recommended: yes.** The alternative, refactoring between lanes with no freeze, means every
  in-flight lane re-merges against moved code.
- **D3 — AIRSP phase 2.** Wait for S1 and C1a (recommended), or build it now the old way and let S1 move it.
- **D4 — the client.** Confirm no ESM migration and no namespace rename. Confirm C0, the all-scripts
  uniqueness test, instead. **Recommended: confirm.**
- **D5 — back-compat removal** (`efsp.boardStore`/`positionStore` aliases, pre-WP4A `data.board` restore, the
  optional `rules` guards). The lane rules say "no backwards compatibility", but this is a behaviour change
  (partial fixtures) and so not part of a refactor phase. **Recommended:** one small lane after S2b, with its own
  golden re-record.
- **D6 — the golden-fixture policy for every lane after P0.** A lane that changes behaviour on purpose
  re-records the fixtures and lists the diff in its report. A refactor lane never re-records. This adds a small
  step to every behaviour lane. **Recommended: adopt**, because it is how the next L6-style regression gets
  caught before merge rather than in the soak.
- **D7 — C2 (generated client tables).** Recommended: only together with S3. Otherwise keep the parity tests.

## Defaults taken (P2)

- ADR number 0095, as the briefing gave it. The draft is in `docs/wip/ARCH-plan-adr.md`, not in `docs/adr/`.
- Measurements on `integ/wave3-dry` at `0935ee5`. L18S, UI-B and L28 were read from their branches for the
  fan-out evidence, not merged.
- No production code edited. `npm ci` was run in this worktree only, to measure (see the findings).

## Findings for other lanes

1. **Integrator / L18S:** on `integ/wave3-dry`, `final-panel.js` throws `SyntaxError: Identifier 'finite' has
   already been declared` when loaded after `pattern-board.js`, and `_el` is declared three times with two
   signatures. L18S's branch fixes both. If L18S does not merge with the real merge, the fix must go in on its
   own.
2. **UI-B (or a hygiene lane):** `_callsignOfFdr` is declared in both `carrier-panel.js:146` (fdrId fallback)
   and `efsp-panel.js:904` (`''` fallback). The second loads later and silently wins. L18S's uniqueness test only
   covers the Bay-view scripts. Widen it to every script (C0).
3. **Supervisor (S-M-wave3a):** in a worktree without `npm ci`, crc-sync's `npm test` reports exactly **10
   failures** (`Cannot find module 'ws'`: ws-hub-*, efsp-ws-replay, efsp-alerts-compose, theater-context,
   grpc-client-stream, efsp-field-state-l1b, the archiver delta). U6's "10 failures, load flakes" were very
   likely this, not load. After `npm ci`: **crc-sync 1,947 pass / 0 fail / 0 todo; crc-desktop 800 pass /
   1 todo**.
4. **Everyone touching `board-store.js`:** 40 `this._rules.x &&` guards mean a rule missing from `index.js`
   disables its check without an error. Until P0's wiring-completeness test lands, every lane adding a rule
   should check that it is wired, as `efsp-scenarios.test.mjs` already notes.
5. **SOAK owners:** `tools/soak/host-core.js` re-implements `server.js`'s monitor wiring. A monitor added to
   `server.js` and not to `host-core.js` is never soaked. S4 removes the duplication.

## 8. Out of scope here, noted

- **S-14** (three HHMM parsers: `zulu-time.js`, `usmtf-time.js`, `time-chains.js`, plus `nla.js` deadline
  checks) is a correctness check, not architecture. It is a 0.25-lane task: a table-driven test feeding the same
  edge cases (midnight wrap, ±12 h nearest occurrence, `2400`, malformed) to every parser, and sharing the
  nearest-occurrence function if they agree. It can run any time and touches no frozen file.
- `fdr-store.js` (1,427 lines) and `metrics.js` (992 lines) were not studied in depth. S-5 names them, but
  neither is on the lanes' serialisation path. Revisit after W1 using the same method.
