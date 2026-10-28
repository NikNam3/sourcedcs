# ARCH: the executable refactor plan (S-5, D-9, D-10)

Rewritten 2026-10-01 against the human's rulings **S-ARCH, H78, H79–H87 and S-desk3** in
`docs/parallel/decisions.md` (they win over this text wherever the two disagree). The first version of this file
(lane ARCH, `0230128`) was a proposal with seven open decisions. Those decisions are settled now, so this version
is the plan the supervisor dispatches from. Companion files:

- `docs/wip/ARCH-plan-adr.md`: ADR **0095**, ready to copy into `docs/adr/` by lane BOARD-1 (see §8).
- `docs/parallel/refactor/README.md`: the dispatch order, the waves and the conventions every lane shares.
- `docs/parallel/refactor/<PHASE>.md`: one briefing for each lane.
- `docs/wip/FREEZE.md`: phase 0 (the golden master). It is done and merged, and it is the acceptance harness here.

Measured on `efsp-wp5-correlation` at `4f5e502`. Changes that `integ/merge4` (worktree `../sourcedcs-MERGE4`) is
merging right now are listed in §7. Every lane starts from the tree **after** that merge.

---

## 0. The plan in fifteen lines

1. **Scope: Tier B, starting with A** (ARCH-D1), plus what the later rulings added: the client moves to native ES
   modules (H87), facility data moves to JSON (S3-6/R3-72), a logging system (R3-33), one sync mechanism (S3-1),
   one authority registry (S3-2), one composition root (R3-29), and the clock rule (R3-16/S3-3).
2. **First-pass god files** (R3-32): `board-store.js`, `server.js`, `bay-view.js`. `efsp-ws.js`, `index.js` and
   `efsp-panel.js` go too, because their extension points are what serialises the lanes.
3. **Board:** a **facade plus collaborators** (H87/R3-8). `BoardStore` keeps its public API and delegates to
   `Placement`, `StripOps`, `Coordination`, `Tofi` and the sync and persistence collaborator. Each collaborator gets
   its dependencies explicitly in its constructor. No prototype mixins.
4. **Client:** native ES modules with no bundler. `<script type="module">`, node tests import the files, and packaging
   has no build step. `bay-view.js` and `efsp-panel.js` are split by feature once they are modules.
5. **Acceptance** (R3-9, reconciled in S-desk3): golden replay. A structural commit is golden-identical. Any change to
   the output is its own explicitly approved commit, and that commit re-records the fixtures. Fixtures are kept up
   only during the refactor window (ARCH-D6 b).
6. **Order** (H87): the current integration (merge4) first, then this refactor, then L20. No feature lane runs during
   the window (H78).
7. **20 phases (22 lane runs) in 6 waves.** About **18 agent-lanes** in total, and about **7–9 working days** elapsed including merges.
   At most 10 agents run at once, the questioner included (§5).
8. ADRs: **0095** (refactor), **0096** (clock policy, TIME-B), **0097** (logging, LOG-1), **0098** (reserved for the
   airspace registry, AIRSP phase 2). 0077 stays L20's.

---

## 1. What the god files contain (measured; still true)

### 1.1 `crc-sync/src/efsp/board-store.js`: 3,310 lines, one class

1,324 lines (40%) are comments. Coverage at the last measurement: 97.6% of lines and 83.6% of branches. Size is not the
problem. Fan-out and repetition are. Method map at `4f5e502`, used to cut the collaborators:

| Cluster | Lines | Goes to |
|---|---|---|
| Constants and pure helpers (`_replayRecord`, `newFlags`, `_validateAltitudeBlock`, `deepClone`, `_frequencyFromBlockValue`, the per-Role tables `REPLICA_STATE_ON_RECEIPT`, `SENDER_STATE_ON_ACCEPT`, `DEFAULT_INITIAL_STATE_BY_ROLE`) | 1–148 | helpers: `board/strip-util.js`; per-Role tables: the authority registry (AUTH, read by BOARD-3) |
| Kernel: strips map, `_touch`/`drainTouched`, `_log` ring, `getDeltaSince`, `_nextCid` | 150–271, 329–345 | `board/board-state.js` (BOARD-1); seq, ring and epoch move under the shared sync mechanism in SYNC |
| Order keys: `_resolveOrderKey`, `_keyAfterRebalance`, `_rebalanceRack`, `_appendOrderKey` | 273–328, 1645 | `Placement` (BOARD-1) |
| Audit: `_recordPeer`, `_recordAudit` | 346, 583 | `board/audit.js` (BOARD-1) |
| Pipeline: `applyMutation`, `_rememberApplied`, `_replayResult`, `_dispatch`, `_stampTakeoffOnStateChange` | 365–582 | the facade keeps `applyMutation`; `_dispatch` becomes the op table (BOARD-3); idempotency goes to SYNC |
| Placement: `_placementRack`, `_roleBayFor`, `_validateBayImpliedTransition`, `_requireKnownBay`, `_bayFullRefusal`, `_bayForNewOwner`, `_relocateForImpliedState`, `_fieldStateView`, `_nlaCtx` | 982–1182, 1659–1705 | `Placement` (BOARD-1) |
| Strip ops: Create, ConvertToArrival, airspace entry, Move, SetBlock and annotations, MARSA void, Transfer, CarrierTransfer, SfaRotation, SetFlag, SetState (incl. merge4's gated path) | 616–981, 1136–1758 | `StripOps` with one file per op (BOARD-3) |
| NLA: rejected-replica rules, `_nlaPrecheck`, `nlaStatusFor`, `_applyInvokeNla`, `_applyUndo` | 1759–2008 | `StripOps` (BOARD-3). The NLA⇄ops knot stays inside one collaborator |
| Retirement: `_applyDropStrip`, `_retireStrip`, `_releaseFdrIfLastStrip` | 2009–2136 | `StripOps` (BOARD-3) |
| Coordination (5 primitives × 5 actions, 4 `receiveCoordination*`) | 2137–2617 | `Coordination` (BOARD-2) |
| TOFI (ENTRY/EXIT, ACCEPT/REJECT, TRANSFER_COMMS, 3 `receiveTofi*`) | 2618–3138 | `Tofi` (BOARD-2) |
| Position lifecycle: `reassignPositionStrips`, `returnCoveredStrips` | 3139–3217 | the facade, delegating to `Placement` and `StripOps` (BOARD-3) |
| Archive, `droppedWallAtOf`, `snapshot`/`restore` | 3218–3310 | the persistence collaborator (SYNC) |

`rules` holds **49 distinct keys** read at 131 sites, many behind `this._rules.x &&` guards, so a rule that is not
wired switches its check off silently (FREEZE guard 1 now catches this in production wiring). The four-line block
"rev, updatedAt, updatedBy, touch" appears **31 times**.

**Surface reached from outside the file** (`tests/freeze/golden/guard-board-surface.json`): the public methods above
plus `setAirborneObserver` (merge4). Private members reached from outside: `_strips`, `_nlaHistory`,
`_appliedMutations`, `_bayForNewOwner`, `_retireStrip`, `_droppedWallAt`, `_fdrStore` (tests); `_cidSeq`, `_log`,
`_touch` (tools). **`tools/soak/host-core.js:112` monkeypatches `bs._touch`** to record touches, and **`:266` reads
`bs._log.length`**. The guard's `_dispatch`, `_recordAudit`, `_mutationLog`, `_clock` and `_seq` "used by src" rows
are name collisions with other stores (for example `airspace-store.js` has its own `_recordAudit`), not real reaches.

### 1.2 `efsp-ws.js` (1,202 lines), `replay-cache.js`, `ws-hub.js`

There are 11 wire families. Seven hand-written family handlers repeat one skeleton (find the store, bind the session,
check the replay cache, apply, remember, persist on ok, ack via `_subject`, broadcast). `replay-cache.js` has a fixed
`KINDS` set (`airspace, correlation, marsa, fieldState, carrier, sfa`). `ws-hub.js` sends `result.broadcast`,
`.peerBroadcast`, `.marsaBroadcast`, `.carrierBroadcast` and `.sfaBroadcast` by name, in that order (`ws-hub.js:603–626`).
`WsHub` starts its 500 ms tick in `attach()` and has no `stop()`.

### 1.3 `index.js` (687 lines): the EFSP composition root

`_restore` takes 10 positional parameters and `_persist` takes 9. Each Facility gets a 49-key `rules` literal. Paths are
resolved when the module is required (`BOARD_SNAPSHOT_PATH`). `facility-config.js` loads every Facility's config when
it is required (`configs = new Map(...)`, line 748). That is why the freeze harness and the soak purge the require
cache for every trace.

### 1.4 `server.js` (734 lines)

11 module-level `setInterval`s, 7 `require`s in the middle of the file (270, 391, 540, 564, 644–646), and a forward
reference from the mission-load closure to `correlationReconciler`. It has no unit coverage, because requiring it starts
the server. `tools/soak/host-core.js` (518 lines) re-implements the monitor wiring.

### 1.5 The client

55 local scripts are loaded as classic scripts (`index.html:919–980`), plus two CDN globals (maplibre, dockview) and
`/js/config.js`. The local server's `http.createServer` generates `/js/config.js` as four `var` globals. 34 of the
scripts carry a guarded `module.exports`. Their names share one global scope (1,187 top-level names). The FREEZE
client guard lists three duplicates. `finite` is fixed in the tree. `_el` and `_callsignOfFdr` are still duplicated,
and **the later script silently wins**.

- 53 client test files. 42 of them `require()` client scripts. 18 load script text into a `vm` context. 5 inject
  stubs through `globalThis` (`efsp-bay-views` 14 sites, `efsp-carrier-client` 5, `efsp-ui-a` 3, and others).
- 3 crc-sync tests read client files: `theater-context.test.mjs` requires `magnetic.js`,
  `wire-payload-contract.test.mjs` scans `app.js` and `efsp-state.js`, and `efsp-time-chains.test.mjs` compares
  `time-chains.js` byte for byte.
- `bay-view.js` is 3,070 lines (39% comments) and `efsp-panel.js` 1,598 lines. `app.js` has 22 `case 'efsp-…'`.
- `crc-desktop/app/package.json` declares `"type": "commonjs"`. Node is 22.22, so `require(esm)` works. Electron
  is 43, and it loads `http://localhost:<port>` (`main.js:140`), so module scripts have a real origin.

### 1.6 Facility data and literals

`facility-config.js` holds five `DEFAULT_*_CONFIG` literals (INCIRLIK, CENTER, TACTICAL, CARRIER, RANGES). It merges
the on-disk JSON over them shallowly (`{...defaults, ...onDisk}`) and falls back to the literal when the result does not
validate. Only `config/efsp-facility-incirlik.json` and `-center.json` ship. TACTICAL and CARRIER exist only as
literals, and RANGES is derived from the airspaces. Other code-side defaults with a JSON twin: `alerting-config.js`
`DEFAULTS`, `instrumentation-config.js`, `surveillance-hints-config.js`, `carrier/ship-state.js` `DEFAULT_HULL`,
`radars.js` `DEFAULT_CAPS`/`DEFAULT_PRESENTATION`/`SHIP_RADAR_DEFAULT`, `theaters.js` `DEFAULT_TRANSITION_ALT_FT`,
`stereo-routes.js` and `airspace-config.js` (both `[]`).

### 1.7 Clock and logging

There are 18 `Date.now()` sites in `src/efsp`, frozen per file by `guard-wall-clock.json`. ADR 0079's table puts
conformance on the mission clock ("the heading grace period runs from the clearance's own `at`"). L19's airborne hold
(5 s) and staleness (120 s) run on the mission clock in `surveillance-hints.js` `tick(now = this._clock.now())`.
Logging is bare `console.*`: 135 calls in 34 files. merge4 adds `src/log-level.js`, which wraps `console` by
`LOG_LEVEL`.

---

## 2. Target architecture

### 2.1 Principles

1. **Structural commits do not change output.** Each phase is mostly moves. Where a ruling asks for a behaviour change,
   that change is a separate, explicitly approved commit (§3, §6).
2. **A capability lives in its own files.** Shared files hold registrations, one line each.
3. **Extension points are tables and registries**, extending what already works (`COMPUTE_BY_ROLE`, the capability
   tables, `CARRIER_TRANSFER_EFFECTS`, the Bay `view` flags, `_stripAlerts`).
4. **Dependencies are explicit.** A collaborator gets what it needs in its constructor. A module does nothing when it is
   imported (no timers, no file reads, no paths fixed at import time).
5. **Data in JSON, rules in code** (R3-72, S3-6). Facility and squadron data live in `config/` (shipped) or `state/`
   (written), per ADR 0048 and `state-paths.js`. Code holds the schema, the rules and the interactions. Engineering
   constants (ring sizes, caps, retry windows) stay in code as named constants (§9 point 6). UI code is exempt.
6. **No machinery for its own sake.** No DI container, no event bus, no bundler, no codegen.
7. **Comments move with their code, verbatim.** L20 sweeps them afterwards on the new layout.
8. **Leave room for state versioning** (S3-4, R3-31). There is no version or migration now. The store registry and
   the persistence collaborator are the single place a `version` key and per-store upgrade hooks can be added later.
   Nothing may depend on the snapshot being unversioned.

### 2.2 Module map (target; **bold** = new)

```
crc-sync/
  server.js                    env → deps; createApp(deps); app.start(); listen. Nothing else.
  src/app.js                   ** createApp(deps) → { http, wsHub, efsp, monitors, tickers[{name,periodMs,tick}], start(), stop() } (R3-29)
  src/log.js                   ** logger(name) → {error,warn,info,debug,child(ctx)}; level/sink set once by createApp (R3-33; absorbs log-level.js)
  src/ws-hub.js                sends result.broadcasts[] in order; stop()
  src/efsp/
    index.js                   createEfsp({clock, transitionAltFt, paths, ...}): loops the registries; no positional store lists
    stores.js                  ** STORE REGISTRY [{key, build, snapshot, restore, after?}] in today's persist order
    board-store.js             FACADE: public API only (applyMutation, get*, getDeltaSince, drainTouched, receive*,
                                 nlaStatusFor, reassign/returnCovered, archiveStrip, snapshot/restore, setMutationLog,
                                 setAirborneObserver); builds its collaborators and passes each its dependencies
    board/
      board-state.js           ** kernel: strips map, bump/insert/touch, cid, getDeltaSince over the sync log
      audit.js                 ** recordAudit / recordPeer (ADR 0083 wording unchanged)
      placement.js             ** Placement: order keys + Bays + implied state + field-state view
      strip-ops.js             ** StripOps: the op table, dispatch, NLA, Undo, retirement
      ops/<op>.js              ** one file per op kind: {kind, authorize?, apply(ctx, strip, op, meta), auditFields?}
      coordination.js          ** Coordination: PROPOSE/ACCEPT/REJECT/STAND_BY/CANCEL + receiveCoordination*
      tofi.js                  ** Tofi: ENTRY/EXIT/ACCEPT/REJECT/TRANSFER_COMMS + receiveTofi*
      persistence.js           ** snapshot/restore/archive/droppedWallAt + replay window (SYNC)
      strip-util.js            ** deepClone, newFlags, block/frequency helpers
    sync/
      sync-log.js              ** ONE seq/ring/epoch/touched mechanism (S3-1), used by the Board and every store that syncs
      replay-cache.js          ** ONE idempotency cache (Board + families), replacing replay-cache.js and _appliedMutations
    wire/
      families/index.js        ** FAMILY REGISTRY (one line per family)
      families/<family>.js     ** airspace, correlation, marsa, field-state, carrier, sfa, ato, … : {type, ackType, replayKind,
                                 subject, gate, apply, ack, broadcasts, snapshotKey?, snapshot?, filter?}
    efsp-ws.js                 generic skeleton + Board path + resync + set-positions + snapshot + read scope
    authority/
      index.js                 ** AUTHORITY REGISTRY (S3-2): Position families and Role families register here
      positions/<family>.js    ** civil-atc, incirlik-military, tactical, carrier: capabilities, read scope
      roles/<role>.js          ** departure, arrival, overflight, mission, marshal, final, pattern: states, initial state,
                                 NLA, state owners, creators, countable states, replica state on receipt, eligibility
    permission.js, nla.js, coordination.js   facades over authority/ (exports unchanged, so client parity tests stay)
    facility-config.js         loader + accessors; NO literals
    facility-schema.js         ** the schema + validateConfig (types, required keys, cross-references)
    zulu-time.js               the one owner of HHMM rules (QAS); usmtf-time.js owns the DTG grammar (§9 point 9)
  config/efsp-facility-{incirlik,center,tactical,carrier}.json   the single source (tactical, carrier new)

crc-desktop/app/public/
  index.html                   CDN scripts + /js/config.js classic; then ONE <script type="module" src="./js/main.js">
  js/package.json              ** {"type":"module"} (scoped: app/server.js stays CommonJS)
  js/main.js                   ** imports every module once, in today's load order
  js/**/*.js                   ES modules: explicit import/export, no guarded module.exports
  js/panels/efsp/efsp-messages.js   ** client message registry: registerEfspMessage(type, handler) (CMSG)
  js/panels/efsp/bay-view.js   entry: render/reconcile/dispatch; re-exports its public names (ESM-2a)
  js/panels/efsp/bay/          ** selection, block-edit, strip-element, popover-portal, popovers/<feature>, drag, ops-cards
  js/panels/efsp/efsp-panel.js entry; re-exports its public names (ESM-2b)
  js/panels/efsp/panel/        ** the efsp-panel features
```

### 2.3 The Board: facade plus collaborators (H87)

```
BoardStore (facade)
  ├─ state       = new BoardState({ clock, syncLog })                    // kernel; owns the Strip map
  ├─ audit       = new BoardAudit({ state, clock, mutationLog: () => this._mutationLog })
  ├─ placement   = new Placement({ state, rules, clock })
  ├─ ops         = new StripOps({ state, audit, placement, rules, fdrStore, clock, touch })
  ├─ coordination= new Coordination({ state, audit, placement, ops, rules, clock, touch })
  ├─ tofi        = new Tofi({ state, audit, placement, ops, rules, clock, touch })
  └─ persistence = new BoardPersistence({ state, replay, clock })         // SYNC
```

- **The constructor signature `new BoardStore(fdrStore, rules, { clock })` does not change.** `index.js` and the
  ~84 unit tests that build partial `rules` keep working.
- **`touch` is a late-bound callback**, `(id) => this._touch(id)`. A collaborator never calls the kernel's touch
  directly. This keeps `host-core.js`'s monkeypatch of `bs._touch` working until APP or SYNC replaces it with an
  explicit `observeTouches(fn)`. `_log` stays readable on the facade as a getter until then.
- **Seam rules, enforced by `tests/board-seam.test.mjs` (written in R0, made strict lane by lane):**
  1. a file in `src/efsp/board/` never `require`s `board-store.js` or a sibling collaborator. It receives its siblings
     through its constructor;
  2. it never reads an underscore-prefixed property of anything other than `this` (so no `deps.state._strips`, no
     `this._ops._nlaHistory`);
  3. it has no module-level mutable state;
  4. it reads rules only as `this._rules.<name>` or `rules.<name>`, so FREEZE guard 1 still sees every rule.
- Private members reached by tests are allowed to move (R3-31). A lane that moves one updates the test and
  `guard-board-surface.json` (a structure fixture, §3.2) in the same commit and lists it in its report.

### 2.4 Registries

| Registry | Shape | A new one means |
|---|---|---|
| Wire family (WIRE) | `wire/families/<x>.js` `{type, ackType, replayKind, subject(msg), gate, apply(ctx, session, msg), ack, broadcasts(result, ctx), snapshotKey?, snapshot?, filter?}` | one file + one line in `families/index.js`. The skeleton enforces the session binding, `unaudited`, replay, persist-on-ok and broadcast order once |
| Persisted store (STORES) | `stores.js` `{key, build(deps), snapshot(store), restore(store, data, all), after?(all)}` | one entry. Array order = JSON key order = restore order |
| Board op (BOARD-3) | `board/ops/<op>.js` `{kind, authorize?, apply, auditFields?}` | one file + one line in `strip-ops.js`'s table |
| Authority (AUTH) | `authority/positions/<family>.js`, `authority/roles/<role>.js` | one file. The facades re-export, so client parity tests and freeze tables stay identical |
| Sync (SYNC) | a store that syncs owns a `SyncLog` and declares `{seqKey, epoch?}` | construct one `SyncLog`. No hand-written ring |
| Client message (CMSG) | `registerEfspMessage(type, handler)` in the family's module | one call. `app.js` dispatches through the registry |
| Client Bay view | ADR 0093's descriptor `view` → `bay-views.js` | (exists) |

### 2.5 Composition root and logging

`createApp(deps)` builds, in dependency order, what `server.js` builds today: Express app and routes (auth routes
moved verbatim; **auth hardening out of scope**), stores, picture, surveillance, coverage, `createEfsp`, `WsHub`,
the gRPC/SRS event handlers, the monitors (instrumentation, archiver, obligations, NLA status, correlation reconciler,
carrier tick, conformance, hints, STCA, alert compose) and merge4's test-reset mount (same guards). Timers become
`tickers: [{name, periodMs, tick}]`, and only `start()` installs them. `stop()` clears them and calls
`wsHub.stop()`. The soak (`tools/soak/host-core.js`) and the tests call `createApp` with fake gRPC and SRS clients and
drive `tickers` by name. The re-implemented monitor wiring goes away.

Logging (LOG-1, then LOG-2). `src/log.js` provides module-level loggers, `const log = require('../log').logger('efsp:board')`.
It has levels error, warn, info and debug, with `LOG_LEVEL` semantics kept from merge4/INFRA2, and structured
context: `log.info('persisted', { facilityId, ms })` and `log.child({ sessionId })`. The sink and format are
configured once in `createApp` (text lines by default). Tests capture logs through a test sink rather than by
patching `console`. Placed right after APP, so it is threaded once (§5).

### 2.6 Facility data (DATA-1, DATA-2)

The literals go. `config/efsp-facility-<id>.json` is the single source (TACTICAL and CARRIER are written from the
literals, and INCIRLIK and CENTER are re-checked against them). `facility-schema.js` validates them.
`facility-config.js` becomes a loader. `load({ paths })` is called by `createEfsp`, not at require time. It reads the
`state/` copy if one exists, else the `config/` copy (`state-paths.js` `readPath`), whole, with **no merge** over code
values. Shipped values are identical, so the goldens are identical. Two behaviours change (§6, items 6 and 7): a
missing or invalid file is a loud startup error instead of a silent fallback to literals, and a `state/` copy no
longer inherits keys it lacks. RANGES stays derived from the airspaces (code, as today).

### 2.7 The airspace registry seam (design only; AIRSP phase 2 builds it)

Per AIRSP-7, R3-12 and the MTR research (`docs/parallel/research/mtr-airspace.md`), an airspace definition record gains:

```
{ airspaceId, name, kind: 'AREA' | 'ROUTE', type,               // type stays descriptive (D14); ROUTE types IR/VR/SR/LLTR
  altLowerFt, altUpperFt,                                        // the envelope (ROUTE: min of lows, max of highs)
  geometry: { source: 'POLYGON', points: [[lat, lon], ...] }
          | { source: 'DCS_DRAWING', drawingRef: { layer, name, theater } }   // R3-12: an existing DCS drawing
          | null,                                                 // AREA without an outline (today's records)
  segments?: [{ fix, altLowerFt, altUpperFt, widthNm? }], defaultWidthNm?,    // ROUTE only
  activation: 'APPROVE' | 'CONFIRM',                              // per kind as data: ROUTE confirms, cannot be denied
  frequencies, positions..., rev }                                // unchanged fields
```

It plugs into: the definitions schema in `facility-schema.js`'s sibling (`airspace-schema.js`, keyed by theater per R3-22);
a `wire/families/airspace-definition.js` (Create/Edit/Delete, one audited op with `rev`, R3-25); a `stores.js` entry
once the definitions join the snapshot (AIRSP.md); a `SyncLog` (SYNC); the authority registry (controlling Position
plus OPS of the controlling Facility, R3-11; TAC_C2 excluded, AIRSP-6); and one `registerEfspMessage` call on the client.
Occupancy rules differ per kind (count, not block, for ROUTE) and are a rule in code keyed by `kind`. MTR free-text FDR
leaves (ADR 0062) stay and resolve to `airspaceId` by designator, read-only. **No lane in this plan builds the panel,
ops or geometry editor.** ADR **0098** is reserved for AIRSP phase 2.

### 2.8 Time and clocks

- **One owner per grammar** (R3-63). `zulu-time.js` owns typed HHMM ↔ epoch and nearest-occurrence (QAS consolidated it
  in merge4). `ato/usmtf-time.js` owns USMTF DTGs, a different grammar anchored on TIMEFRAM. `time-chains.js` parses
  nothing. The client's `time-chains.js` and `formatZuluHhmm` stay as hand copies under PARITY (ARCH-D7). TIME-B
  confirms that no other parser exists.
- **Clock rule** (R3-16/S3-3, refining ADR 0079/H11). The mission clock is for facts and gates: anything a controller
  reads as a time, anything stored on a record or compared with one, and every Mutation-log `at`. The wall clock is for
  pure durations and housekeeping. Wall time is **injected** (`WALL_CLOCK` from `mission-clock.js`, or a `wallClock`
  dependency), never a bare `Date.now()`. `tests/clock-policy.test.mjs` (R0) lists every `Date.now()`/`new Date()`
  site in `src/efsp` with its file, enclosing function and reason, and fails on any site not in the list.
- **The behaviour change** (TIME-B, approved separately, ADR 0096): L19's airborne hold and staleness duration, and
  conformance's heading grace, are measured on the wall clock. Every `at`/`since` they stamp or log stays mission time.

### 2.9 The client: native ES modules (ESM-1, ESM-2a/b, CMSG)

- `js/package.json` `{"type":"module"}`, so Node treats the client files as ESM. `app/server.js` stays CommonJS
  (`app/package.json` keeps `"type":"commonjs"`). electron-builder already packs `app/**/*`, and
  `tests/packaging-config.test.js` gains an assertion that the scoped `package.json` is packed.
- `index.html`: the CDN scripts (globals `maplibregl` and `dockview`) and `/js/config.js` (four `var` globals) stay
  classic and load first. A module reads them as globals. Then one `<script type="module" src="./js/main.js">`.
- **Evaluation order changes.** ESM evaluates depth-first in dependency order, not in tag order. ESM-1 lists every
  module with top-level statements that are not declarations, and proves that their order does not matter, or
  restores it through `main.js`. Import cycles are allowed only where no top-level code reads a binding across the
  cycle before it is initialised (TDZ). A module-graph test loads the whole graph under the DOM stub.
- **Duplicates become private, which changes behaviour.** Today the later `_callsignOfFdr` (`efsp-panel.js`, `''`
  fallback) and the later `_el` (`metrics-panel.js`) silently win. ESM-1 keeps today's effective behaviour by explicit
  imports and asks the human which fallback the UI wants (§9 point 3).
- **Tests:** 53 test files become ESM (`.test.mjs`). The `vm` loaders become imports. The `globalThis` stub injection
  becomes real state fed through the state module's setters, or an explicit hook where the code does I/O (for example
  `setEfspTransport(fn)` for the sender). The FREEZE client-global-surface guard is replaced by `module-graph.test.mjs`
  (every file reachable from `main.js`, every import resolves, the graph evaluates under the DOM stub, and the exported
  name set is frozen as a structure fixture).
- **Split by feature** (ESM-2a, ESM-2b). Each entry file re-exports its public names, so its importers do not change.
- **Hand copies of server tables stay**, with their PARITY tests (ARCH-D7). There is no generation (S3-7).

---

## 3. Acceptance

### 3.1 The golden rule (S-desk3)

No surface (wire, snapshot, audit) is frozen as a principle. Golden replay is how the refactor phases are accepted:

- **A structural commit is golden-identical.** `node --test tests/freeze/freeze-*.test.mjs` passes with no
  `UPDATE_GOLDEN`, and no behaviour fixture changes.
- **An output change is its own commit**, explicitly approved by the supervisor (and by the human where §6 says so),
  titled `behaviour(<LANE>): …`. It re-records the fixtures (`npm run freeze:update`) in that same commit, and the lane
  report lists every changed trace and step. It is never folded into a structural commit.
- Fixtures are kept up only during the refactor window (ARCH-D6 b). At the window's close (BACKCOMPAT, W6), the
  freeze suite leaves `npm test` and becomes opt-in (`npm run freeze`), with a dated note. Outside the window,
  behaviour lanes do not maintain fixtures.

### 3.2 Three kinds of fixture

| Kind | Files | In a structural commit |
|---|---|---|
| Behaviour goldens | `tests/freeze/golden/{hub,scenario,scenarios,table,tables}-*.json` | must be byte-identical |
| Structure fixtures | `guard-board-surface.json`, the clock allow-list (R0), crc-desktop `module-graph` export fixture (ESM-1) | may change when the structure does. Every change is listed in the commit message and the report |
| Harness-only fields | `uncarried` in `hub-*.json` (a soak-host accounting artefact, FREEZE finding) | R0 removes it from the compared record, once, so APP's host rewrite stays golden-identical |

### 3.3 Gates for each lane (details in each briefing)

| Gate | When |
|---|---|
| Golden replay identical (§3.1) | every lane |
| `crc-sync`: `npm test` green | every lane |
| `crc-desktop`: `npm test` green | every lane (server lanes too: crc-desktop tests require crc-sync modules) |
| `npm run soak:selfcheck` all detectors fire | any lane touching `board-store.js`, `board/**`, `efsp-ws.js`, `wire/**`, `ws-hub.js`, `sync/**`, `host-core.js` |
| `npm run soak:smoke` PASS (memory "not judged" is fine) | APP, SYNC |
| `npm run freeze:selfcheck`: every mutation applies and is caught | any lane that moves code a mutation targets. The lane retargets its own mutations (R0 splits them one file each) |
| Playwright, full suite, on the lane's `E2E_LANE` | ESM-1 (as a unit with ESM-1T), ESM-2a, ESM-2b, CMSG. The supervisor runs the full suite once after each wave merges |
| `tests/board-seam.test.mjs` strict for the files the lane created | BOARD-1/2/3, SYNC |
| Boot smoke (`tests/app-boot.test.mjs`) | APP, LOG-1, TIME-B |

---

## 4. Phases

Tier: **A** = the old minimum (golden harness prep, wire and store registries, the kernel with coordination and TOFI
out, the composition root, the client move). **B** = the rest of the recommended tier plus the later rulings. "Size"
is in agent-lanes (about one agent-day each). Model: Sonnet 5.5 for code lanes, Opus where the lane designs a pattern
others follow.

| Phase | Tier | Wave | Goal | Owns (writes) | Depends on | Size | Model |
|---|---|---|---|---|---|---|---|
| **R0** | A | 1 | Harness prep: peer+MARSA order trace, `uncarried` out of compare, selfcheck one file per mutation, guards made collaborator- and registry-aware, clock allow-list, seam test | `crc-sync/tests/freeze/**`, `tests/clock-policy.test.mjs`, `tests/board-seam.test.mjs`, `crc-sync/package.json` (freeze script lines) | merge4 | 0.5 | Sonnet |
| **ESM-1** | A | 1 | Client to native ES modules: package scope, `main.js`, `index.html`, every client file's import/export, local server MIME, packaging assertion, module-graph test, the 3 crc-sync tests that read client files | `crc-desktop/app/public/js/**` (module syntax only), `index.html` script block, `app/server.js` MIME map, `crc-desktop/package.json` test script, `tests/packaging-config.test.js`, `tests/client-global-surface.test.js` → `tests/module-graph.test.mjs` + fixture, `tests/helpers/**`, `crc-desktop/README.md` (module section), crc-sync `tests/{theater-context,wire-payload-contract,efsp-time-chains}.test.mjs` | merge4 | 1 | Opus |
| **ESM-1T** ×3 | A | 1 | Convert the client test files to ESM, in three disjoint partitions; cut from ESM-1's first commit with converted sources, merged as one unit with ESM-1 | the partition's `crc-desktop/tests/*.test.js` → `.test.mjs` | ESM-1 (sources) | 3 × 0.5 | Sonnet |
| **BOARD-1** | A | 2 | Facade skeleton; `BoardState` (kernel, `bump`, `insert`); `BoardAudit`; `Placement` (order keys + Bays); ADR 0095 committed | `src/efsp/board-store.js`, `src/efsp/board/{board-state,audit,placement,strip-util}.js`, selfcheck M3/M4/M7, board-store unit tests reaching moved privates, `guard-board-surface.json`, `docs/adr/0095-*.md` | R0 | 1 | Opus |
| **WIRE** | A | 2 | Family registry + skeleton; `replay-cache` kinds from the registry; `ws-hub` sends `broadcasts[]`; `WsHub.stop()` | `src/efsp/efsp-ws.js`, `src/efsp/wire/**`, `src/efsp/replay-cache.js`, `src/ws-hub.js`, ws-hub/efsp-ws tests reading named keys, `tests/freeze/freeze-tables.test.mjs` (dispatch scraper only), selfcheck M5/M5b/M13 | R0 | 1 | Sonnet |
| **STORES** | A | 2 | Store registry; `_persist`/`_restore` loop it; `createEfsp({paths})` resolves paths at call time; `ctx` keys unchanged (+`ctx.stores`) | `src/efsp/index.js`, `src/efsp/stores.js`, persistence/index tests, selfcheck M9/M10 | R0 | 0.5 | Sonnet |
| **APP** | A | 2 | `createApp(deps)` with tickers, start/stop; `server.js` thin; soak host uses `createApp`; boot smoke | `crc-sync/server.js`, `src/app.js`, `tools/soak/{host-core,host,host-env}.js`, `tests/freeze/{freeze-world,freeze-hub-runner}.mjs` (host wiring only), `tests/app-boot.test.mjs` | R0; merges after WIRE (`wsHub.stop()`) and STORES (`paths`) | 1 | Sonnet |
| **BOARD-2** | A | 3 | `Coordination` and `Tofi` collaborators; facade `receive*` delegate | `board-store.js` (clusters G, H), `board/{coordination,tofi}.js`, their unit tests' private reaches | BOARD-1 | 1 | Sonnet |
| **AUTH** | B | 3 | Authority registry; Position and Role families; `permission.js`/`nla.js`/`coordination.js` become facades with identical exports; `traffic-count` countability from the registry | `src/efsp/{permission,nla,coordination,read-scope}.js`, `traffic-count.js` (countability constants only), `src/efsp/authority/**`, selfcheck M12/M14 | W2 merged | 1.5 | Opus |
| **DATA-1** | B | 3 | Facility JSON as the single source; schema; loader without literals, called from `createEfsp` | `src/efsp/facility-config.js`, `src/efsp/facility-schema.js`, `config/efsp-facility-*.json`, `index.js` (the facility load call only), `freeze-tables.test.mjs` (defaults reader only), facility-config tests | W2 merged | 1 | Sonnet |
| **DATA-2** | B | 3 | Tuning defaults out of code into their JSON twins; literal inventory for the human | `src/alerting-config.js`, `src/efsp/{instrumentation-config,surveillance-hints-config,stereo-routes,airspace-config}.js` (defaults only), `src/efsp/carrier/{hull-config,ship-state}.js`, `src/radars.js` (defaults only), `src/theaters.js` (default TA only), matching `config/*.json`, `docs/wip/DATA-2.md` | W2 merged | 1 | Sonnet |
| **LOG-1** | B | 3 | `src/log.js`; configured in `createApp`; `log-level.js` absorbed; test sink; ADR 0097 | `src/log.js`, `src/log-level.js` (removed), `src/app.js` (logger setup only), `server.js` (its own console calls), `tests/log.test.mjs`, `docs/adr/0097-*.md` | APP | 0.5 | Sonnet |
| **CMSG** | B | 3 | Client message registry; `app.js` dispatches through it | `js/app.js`, `js/panels/efsp/efsp-ws.js` (client), new `efsp-messages.js`, registration lines in `airspace-panel.js`, `carrier-panel.js`, `field-state-panel.js`, `metrics-panel.js`, `tests/ws-message-contract.test.mjs` | ESM-1 unit | 0.5 | Sonnet |
| **ESM-2a** | B | 3 | Split `bay-view.js` by feature into `panels/efsp/bay/` | `js/panels/efsp/bay-view.js`, `js/panels/efsp/bay/**`, bay-view unit tests | ESM-1 unit | 1 | Sonnet |
| **ESM-2b** | B | 3 | Split `efsp-panel.js` by feature into `panels/efsp/panel/` | `js/panels/efsp/efsp-panel.js`, `js/panels/efsp/panel/**`, efsp-panel unit tests | ESM-1 unit | 0.75 | Sonnet |
| **BOARD-3** | B | 4 | `StripOps` + op table + NLA/Undo + retirement; per-Role tables read from the authority registry; Position lifecycle delegates | `board-store.js` (clusters ops/NLA/retire/dispatch/lifecycle), `board/{strip-ops}.js`, `board/ops/**`, selfcheck M1/M2/M6/M15, unit tests' private reaches | BOARD-2, AUTH | 1.25 | Sonnet |
| **LOG-2** | B | 4 | Every `console.*` in crc-sync to module loggers with context; tests that spy `console` use the test sink | `crc-sync/src/**` console call lines **except** `board-store.js`, `board/**`, `surveillance-hints.js`, `conformance.js`; `tools/soak/**` console lines; tests spying console | LOG-1 | 0.75 | Sonnet |
| **TIME-B** | B | 4 | **Approved change**: L19 hold and staleness, conformance grace on wall time; ADR 0096; HHMM single-owner check | `src/efsp/{surveillance-hints,conformance}.js`, `src/app.js` (their two constructor calls), `tests/clock-policy.test.mjs` allow-list, their unit tests, re-recorded goldens (behaviour commit), `docs/adr/0096-*.md` | APP, R0 | 0.5 | Sonnet |
| **SYNC** | B | 5 | One `SyncLog` and one replay cache for the Board and every store that syncs; Board persistence collaborator; `observeTouches` replaces the monkeypatch | `board-store.js` (kernel, idempotency, snapshot/restore), `board/{board-state,persistence}.js`, `src/efsp/sync/**`, `src/efsp/replay-cache.js` (removed into `sync/`), `airspace-store.js` (`airspaceSeq` only), `efsp-ws.js` (resync path only), `tools/soak/host-core.js` (touch observer), selfcheck M8 | BOARD-3, WIRE, STORES | 1 | Opus |
| **BACKCOMPAT** | B | 6 | **Approved change**: back-compat removal; a missing rule is a loud startup error (ARCH-D5); close the fixture window | `index.js` (aliases, legacy `data.board`), `board-store.js` + `board/**` (`this._rules.x &&` guards → required-rules check), `facility-config.js` (legacy `blockVisibility`), `clearance-migration.js`/`overflight-migration.js` (only if §9 point 7 is answered "remove"), a `fullRules()` test helper, `crc-sync/package.json` (freeze out of `npm test`) | all above | 0.5 | Sonnet |

**Totals:** Tier A ≈ 7.5 lanes (R0 0.5, ESM-1 1, ESM-1T 1.5, BOARD-1 1, WIRE 1, STORES 0.5, APP 1, BOARD-2 1).
Tier B ≈ 10.25 lanes. **All ≈ 18 agent-lanes**: 20 phases, 22 lane runs (ESM-1T is three).

**Superseded from the first plan:** prototype mixins and the mixin seam test (→ collaborators, §2.3); "not ES modules"
and the C0 uniqueness test (→ ESM-1; duplicates become module-private); C2 generated client tables (→ ARCH-D7,
hand copies stay); "after L20" (→ before L20, H87); "no surface ever changes" (→ S-desk3's reconciliation, §3.1);
`createRuntime` (→ `createApp`, R3-29). S2c (one role-change transfer for carrier and SFA) is folded into BOARD-3 as an
optional last step, only if it is golden-identical.

---

## 5. Waves, parallelism and the freeze

The supervisor runs at most **10 agents at once, one of them the questioner**. The questioner (Opus) reads each lane's
first report ("Code as found" plus its design notes) before the lane writes code, and challenges assumptions against
this plan, `decisions.md` and the code. File ownership inside a wave is disjoint, except where a row says "one line".

| Wave | Runs in parallel | Agents | Starts when | Merges as |
|---|---|---|---|---|
| **W1** | R0 · ESM-1 · ESM-1T-a · ESM-1T-b · ESM-1T-c (the T lanes start from ESM-1's first sources-converted commit) · questioner | ≤ 6 | merge4 and the R3-47 follow-up are merged and the goldens re-recorded there | R0 alone; ESM-1 + 3×ESM-1T as one unit (both suites + full Playwright) |
| **W2** | BOARD-1 · WIRE · STORES · APP · questioner | 5 | R0 merged | order WIRE → STORES → BOARD-1 → APP (APP needs `wsHub.stop()` and `paths`; it adds the one-line `paths` pass-through at its merge) |
| **W3** | BOARD-2 · AUTH · DATA-1 · DATA-2 · LOG-1 · CMSG · ESM-2a · ESM-2b · questioner | 9 | W2 merged (A has been proven golden-identical across four lanes) | any order; DATA-1 and STORES's `index.js` do not meet (DATA-1 edits one call) |
| **W4** | BOARD-3 · LOG-2 · TIME-B · questioner | 4 | BOARD-2, AUTH and LOG-1 merged | BOARD-3 → LOG-2 → TIME-B (TIME-B's behaviour commit re-records last) |
| **W5** | SYNC · questioner (AIRSP phase 2 may draft its design and mockup changes against §2.7, without code) | 2 | W4 merged | alone |
| **W6** | BACKCOMPAT · questioner | 2 | W5 merged | alone, then the window closes and **L20 starts** |

Why the waves are shaped like this:

- `board-store.js` is one file, so BOARD-1 → BOARD-2 → BOARD-3 → SYNC → BACKCOMPAT are strictly sequential on it.
  Everything else is placed around that chain.
- Tier A finishes in W3 (BOARD-2). The B lanes start in W3, once W2 has shown that the golden master holds across four
  parallel structural lanes. That is the reading of "Tier B, starting with A" (§9 point 1).
- The client track (W1, W3) is disjoint from the server track, apart from the three crc-sync tests ESM-1 owns.
- AUTH waits for W2 only to keep W2 small and reviewable. It owns no W2 file, so if W2 runs long it can be pulled
  into W2.

### 5.1 Frozen files (no lane outside the named owner may edit them; no feature lane runs at all, H78)

| File(s) | Frozen from | Until | Owner(s) during the freeze |
|---|---|---|---|
| `crc-sync/tests/freeze/**` (except as listed per lane) | W1 start | W6 end | R0, then each lane's own selfcheck mutation file |
| `crc-desktop/app/public/**`, `crc-desktop/tests/**` | W1 start | W3 end | ESM-1/ESM-1T (W1), CMSG/ESM-2a/ESM-2b (W3) |
| `src/efsp/board-store.js`, `src/efsp/board/**` | W2 start | W6 end | BOARD-1 (W2), BOARD-2 (W3), BOARD-3 (W4), SYNC (W5), BACKCOMPAT (W6) |
| `src/efsp/efsp-ws.js`, `src/efsp/wire/**`, `src/ws-hub.js`, `src/efsp/replay-cache.js` | W2 start | W5 end | WIRE (W2), SYNC (W5, resync path and replay cache) |
| `src/efsp/index.js`, `src/efsp/stores.js` | W2 start | W6 end | STORES (W2), DATA-1 (W3, one call), BACKCOMPAT (W6) |
| `crc-sync/server.js`, `src/app.js`, `tools/soak/host-core.js` | W2 start | W5 end | APP (W2), LOG-1 (W3), TIME-B (W4, two lines), SYNC (W5, host-core touch observer) |
| `src/efsp/{permission,nla,coordination,read-scope,traffic-count}.js`, `authority/**` | W3 start | W4 end | AUTH (W3); BOARD-3 reads, never writes |
| `src/efsp/facility-config.js`, `config/efsp-facility-*.json` | W3 start | W6 end | DATA-1 (W3), BACKCOMPAT (W6) |
| every other `crc-sync/src/**` file | W4 start | W4 end | LOG-2 (console lines only) |

**Elapsed estimate:** W1 1–1.5 days, W2 1.5 days, W3 1.5–2 days, W4 1–1.5 days, W5 1 day, W6 0.5 day, plus merges and
gates. Total **7–9 working days**. The minimum useful stop is after W3 (all of Tier A plus the registries, the client
move and the data move).

**An urgent bug fix during the window** lands as its own behaviour commit with a re-record. The next lane in the
affected chain is cut after it (the supervisor merges it between lanes).

---

## 6. Approved-change queue (output changes; each its own commit, never inside a structural one)

| # | Change | Ruling | Lane | Approval |
|---|---|---|---|---|
| 1 | L19 airborne hold and staleness, conformance heading grace on the wall clock | R3-16, S3-3 | TIME-B | **given** (human); re-record in the commit |
| 2 | Back-compat removal; a missing rule is a loud startup error | ARCH-D5 | BACKCOMPAT | **given** (human) |
| 3 | `_callsignOfFdr` / `_el`: which variant each panel uses once they are module-private | none yet | ESM-1 keeps today's effective behaviour | **settled** (S-ARCH2: keep as is) |
| 4 | Extend sync, epoch and delta resync to every store that has none (beyond SYNC's structural unification) | S3-1 says "one mechanism", not "every store resyncs" | SYNC-B, a follow-up after W5 | **given** (H88) |
| 5 | Per-Facility heartbeat (today only the default Facility's seq is named) | S-UIB limit ("for the refactor's wire phase") | WIRE-B, a follow-up after W2 | **given** (H88) |
| 6 | A missing or invalid facility JSON is a startup error, not a silent fallback to literals | S3-6 + ARCH-D5 spirit | DATA-1 (separate commit) | **given** (S-ARCH2) |
| 7 | A `state/` facility copy no longer inherits keys it lacks (no shallow merge) | S3-6 | DATA-1 (same commit as 6) | **given** (S-ARCH2) |
| 8 | The restore migrations (`clearance-migration.js`, `overflight-migration.js`) go | R3-2 vs S-L28 | BACKCOMPAT | **given** (H88: delete) |

---

## 7. What merge4 changes (plan from the current tree, then re-check on the merged one)

`integ/merge4` (UI-B, E2E-harden, QAS-redo, and the R3-47 follow-up being committed) touches files this plan cuts:

- `board-store.js` +43 lines: UI-B's observed-departure bypass in the SetState path (`_applySetStateGated` region) and
  a new public `setAirborneObserver(fn)`. `guard-board-surface.json` was re-recorded for it. BOARD-1 and BOARD-3 cut
  from the merged file. The observer belongs to `StripOps`, and the facade keeps the public setter.
- `efsp-ws.js`: the ATO import's ack and board-delta carry `boardEpoch` (R3-73). R3-47's server half (an `efsp-resync`
  reply type) is in an uncommitted diff there now. WIRE starts after both are in.
- `server.js` +11 lines: the `setAirborneObserver` wiring and the `src/test-reset.js` mount (`CRCSYNC_TEST_RESET`,
  loopback only, refuses `NODE_ENV=production`). APP moves both into `createApp` unchanged.
- New `src/log-level.js` (`LOG_LEVEL` wraps `console`). LOG-1 absorbs it, keeping its semantics.
- `zulu-time.js` consolidation (S-14) and its golden table: the time-owner baseline for TIME-B.
- About 35 `crc-sync/src` files lose dead exports (S-11 re-scan). Everyone bases on that.
- `facility-config.js` (4 lines): DATA-1 cuts from the merged file.
- Client `app.js`, `efsp-state.js`, `efsp-ws.js`: per-Facility seq and epoch, resync triggers, and R3-47 dropping the
  reconnect resync. `client-global-surface.json` +17 names. New `tests/efsp-resync-state.test.js` and
  `e2e/ui-b-resync.spec.js`. ESM-1 and CMSG base on these.
- E2E harness: `e2e/helpers/sync-supervisor.js`, `e2e/tools/run-order.js` and the test-reset route. Playwright gates
  use that harness.
- The freeze goldens were re-recorded in merge4 (`9d233cd`). R0 starts from them and re-records only if the R3-47
  follow-up changed output, which is expected for the resync reply.

---

## 8. ADRs (R3-68: numbers assigned now)

| Number | Title (short) | Written by | Notes |
|---|---|---|---|
| **0095** | EFSP and CRC code structure: facade + collaborators, registries, `createApp`, native ES modules on the client, JSON as the single source for facility data, golden-replay acceptance | BOARD-1 copies `docs/wip/ARCH-plan-adr.md` into `docs/adr/0095-…md` at its first commit | it refines 0048 (no code-side defaults behind `config/`) without contradicting it |
| **0096** | Durations and housekeeping run on the wall clock; facts and gates on the mission clock | TIME-B | supersedes 0079's conformance row and adds L19's rows; 0079 is not edited (P4) |
| **0097** | A logging system for crc-sync | LOG-1 | |
| **0098** | Airspace registry: `kind` AREA/ROUTE, geometry from a polygon or a DCS drawing, activation per kind | AIRSP phase 2 (reserved) | |
| 0077 | (L20's, unchanged) | L20 | |

0090 and 0092 are unused gaps (UI-A and TA left them free). This plan does not fill them (§9 point 10).

---

## 9. Ambiguities and contradictions found (the supervisor or the human decides; each briefing carries the default)

1. **"Tier B, starting with A" (ARCH-D1).** This could mean that A must be merged and proven before any B work starts,
   or only that A has priority. Default: B starts in W3, after W2 (four A lanes) has merged golden-identical. A
   finishes in W3 (BOARD-2) beside the first B lanes.
2. **R3-29 names `createApp(deps)`; the first plan said `createRuntime`.** Default: `createApp` (the human's word).
   It includes the Express routes, so tests can drive them, and `listen` stays in `server.js`.
3. **ESM makes duplicate names private, which changes behaviour silently.** Today `efsp-panel.js`'s `_callsignOfFdr`
   (`''` fallback) overrides `carrier-panel.js`'s (fdrId fallback), and `metrics-panel.js`'s `_el` overrides the two
   others. Default: ESM-1 keeps today's effective behaviour through explicit imports, and asks the human (queue item 3).
4. **"Collaborators receive explicit dependencies" vs `host-core.js` monkeypatching `bs._touch`.** Default: a late-bound
   `touch` callback keeps the patch working until SYNC adds `observeTouches(fn)` (§2.3).
5. **S3-1 "one sync/replay mechanism for every store".** This could be a structural unification (identical output) or
   every store gaining an epoch and delta resync (a wire change). Default: SYNC does the structural part. The extension
   is queue item 4, for the human.
6. **"No magic values in code except UI code" (S3-6) vs "code holds rules and interactions" (R3-72).** It is not clear
   whether doctrine tables (state machines, permission and capability rows), engineering constants
   (`APPLIED_MUTATIONS_CAP`, `REPLAY_PERSIST_WINDOW_MS`, `RESYNC_RING_WINDOW`, `REBALANCE_KEY_LENGTH`) and
   `[SOURCE-DEFINED]` doctrine values (marshal `maxIndex: 19`, `DEFAULT_CASE 'III'`, `DEFAULT_STACK_ID`) are "magic
   values". Default: facility and squadron data and tunable thresholds go to JSON (DATA-1, DATA-2). Doctrine tables are
   rules and stay in code in the authority registry. Engineering constants stay named in code. DATA-2 writes the full
   inventory with a proposed class for each literal, for the human to confirm.
7. **R3-2 (prod is a clean start; no back-compat) vs S-L28** ("a persisted `state/efsp-facility-*.json` on the human's
   live server will lack `holdsRole`: check before deploy"; L28 wrote a restore migration for `TRANSITING`). Default:
   BACKCOMPAT asks before removing `overflight-migration.js` and `clearance-migration.js` (queue item 8). Everything
   else in ARCH-D5 is removed.
8. **S3-2 "Position families register into one authority registry" vs JSON for facility data.** Positions per Facility
   are facility data (JSON), while what a Position kind may do reads as a rule. Capability rows today are keyed by
   Position id (`RSU`, `SFA`), which ties rules to data ids. Default: capability rows stay in code, in the registry,
   keyed by Position id. The facility JSON lists the Positions, and the schema refuses an id with no registered family.
9. **R3-63 "one owner of the time-parsing rules" vs QAS's finding** that `usmtf-time.js` is a different grammar and
   merging it risks the ATO import. Default: one owner **per grammar** (§2.8). Merging them would be a human call.
10. **R3-68 "assign ADR numbers now".** It does not say whether to fill the gaps 0090 and 0092. Default: leave them
    and number upward (0095–0098).
11. **Conformance on the wall clock contradicts ADR 0079's own rule.** The grace runs from the clearance's mission-time
    `at`, a record time. To measure it on the wall clock, TIME-B needs the clearance's wall arrival time (the Mutation
    log's `wallAt`, or a wall stamp when the conformance monitor first sees the clearance). Default: the monitor stamps
    the wall time when it first sees the clearance, and the shown `since` stays mission time. ADR 0096 says so.
12. **The client's local server is plain `http.createServer`, not Express** (CLAUDE.md says "bundled local Express
    server"). This does not matter for ESM-1 (only the MIME map changes). A CLAUDE.md fix belongs to L20.
13. **The lane rules still say "EFSP times come from the injected mission clock, never `Date.now()`"** (lane-rules §5,
    H11). R3-16 narrows that. The supervisor should update `lane-rules.md` when TIME-B merges. This plan does not edit it.
14. **ARCH-D6 b closes the fixture window, but it does not say whether the suite is deleted or parked.** Default:
    parked, opt-in, with a dated "stale after" note (BACKCOMPAT).
15. **merge4's R3-47 server change is uncommitted** in `../sourcedcs-MERGE4` right now. R0 must not start until it is
    committed and the goldens are re-recorded on it. Otherwise the first structural lane inherits a pending output
    change.

---

## 10. Invariants that hold through every structural commit (verified by the goldens and the existing suites)

The wire format and message order (ADR 0001, 0004, 0022, 0081: broadcast → peer → MARSA → carrier → SFA); one Board
event, one broadcast; epoch minted on construction and restore, never persisted; replay records compact, the last 10
minutes persisted, replay acks only; audit semantics (0065, 0081, 0083: a store logs what reaches it, `unaudited`
never on the wire, `causedBy` on peer entries); the persisted snapshot's shape and key order (0002, 0048, 0081); the
mission clock for facts and gates (0079, until 0096 lands); one Board per Facility, peers in-process (0013, 0015); read
scope (0080); one carrier hand-over implementation (0074); Bay descriptor flags (0093); ADRs never edited (P4); tuning
files read once (P5); no `pkill` (P7). These are not frozen as principles (R3-31). They change only through §6.

## 11. Risks

| Risk | Mitigation |
|---|---|
| A collaborator split loses a `this` or a side effect | golden replay; the seam test; freeze:selfcheck re-proven per lane |
| ESM evaluation order or a TDZ cycle breaks start-up | ESM-1's top-level-statement inventory; the module-graph test evaluates the whole graph; full Playwright as a unit |
| The ESM test conversion stalls the client track | three parallel T lanes cut from ESM-1's converted sources; the unit merges together |
| Parallel lanes conflict on shared harness files | R0 splits selfcheck mutations one file each; lanes edit only their own |
| APP changes soak accounting | `uncarried` removed from the compared record in R0; boot smoke; soak:smoke |
| DATA-1 changes a shipped value while transcribing literals | identical goldens (the tables golden digests the shipped defaults); a test that the JSON equals the old literal, deleted with the literal |
| The window runs long | stop after W3 is viable; W4–W6 are independent improvements |
