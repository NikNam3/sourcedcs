# P0 — Golden master for the EFSP server, plus three guard tests (tests only) — implementation briefing (DRAFT)

> Draft by lane ARCH for the supervisor to issue (fill the ⟨…⟩ fields). Self-contained: you have no memory of
> the conversation that produced this. Where this briefing and
> `/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md` disagree, **decisions.md wins**. Where it and
> the merged code disagree, **the code wins**. The lane rules are in `docs/parallel/lane-rules.md`. The plan
> this lane serves is `docs/wip/ARCH-plan.md` (§3 "Phase 0", §4 "What must never change").

---

## 1. Header

| | |
|---|---|
| Lane | **P0: characterization (golden master) of the EFSP server** (concerns S-5, D-10; plan ARCH) |
| Worktree / branch | `/home/nklx/dev/personal/sourcedcs-P0` on `lane/P0-golden-master`, cut from ⟨`integ/wave3-dry` or the real merge⟩ |
| ADR | none (tests only). ADR 0095 is drafted in `docs/wip/ARCH-plan-adr.md` and is **not** yours to commit |
| E2E lane | none |
| Model | Sonnet 5.5 (code) |
| Baseline | Run `npm ci` in `crc-sync`, `crc-desktop` and `crc-desktop/app` **first**. Without it crc-sync shows 10 false failures (`Cannot find module 'ws'`). Expected at `integ/wave3-dry` `0935ee5`: crc-sync 1,947 pass / 0 fail; crc-desktop 800 pass / 1 todo |
| Depends on | nothing |
| Runs beside | everything. You add **new files only**, plus two `package.json` script lines (§7) |
| Production code | **read-only.** If a test cannot be written without a production change, stop and report |

## 2. Mission

Freeze what the EFSP server does today, so that the refactor phases (S1–S3), and any later lane, can prove they
changed nothing they did not mean to change.

**Done means:**

1. `crc-sync/tests/golden/*.test.mjs` replays recorded traces through a real `createEfsp()` behind the real
   `WsHub`, and compares every observable output with fixtures in `crc-sync/tests/golden/fixtures/`. It passes
   on your base, runs in under **10 s** in `npm test`, and its fixtures total under **2 MB**.
2. `GOLDEN_RECORD=1 npm test -- tests/golden/` (or `npm run golden:record`) rewrites the fixtures. Without the
   variable, the suite **never writes**.
3. `npm run golden:selfcheck` (not part of `npm test`) applies at least **8 seeded source mutations**, each to a
   temporary copy of `src/`, and shows the golden suite fails for every one (§6).
4. Three guard tests, in crc-sync: **wiring completeness**, **the Board's external surface** and **`Date.now()`
   sites** (§5).
5. One guard test in crc-desktop: **global surface** (§5.4).
6. `docs/wip/P0.md`: the corpus inventory (what each trace covers, and which refusal reasons are unreachable
   and why), runtime, fixture size, the selfcheck table, and the re-record procedure for later lanes.
7. Both suites green and larger. `soak:selfcheck` still 5/5 (you must not touch `tools/soak`, but you may
   `require` from it).

**Out of scope:** any production change; any refactor; Playwright; the client golden for rendering (the
existing Playwright suite is the client's characterization).

## 3. Setup and working rules

- The lane rules apply in full. Never touch :3000. No `pkill` by pattern. Commit at every green step, with the
  trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Read first: `docs/adr/0001`, `0004`, `0006`, `0065`, `0079`, `0080`, `0081`, `0083`, `0093` (when merged), and
  `crc-sync/tools/soak/host-env.js` and `host-core.js` (you will reuse their technique).
- Read `crc-sync/tests/efsp-scenarios.test.mjs` and `crc-sync/tests/helpers/efsp-scenario.mjs` (`crew`, `hold`)
  for how a sortie is driven over the wire.

## 4. Verify against merged code, before writing any

| # | Check | Why |
|---|---|---|
| V1 | `setupHostEnv()` (`tools/soak/host-env.js`) points every state path at a temp dir, replaces `Date.now`, seeds `Math.random` and replaces `crypto.randomUUID` on the module object. Confirm that `board-store.js`, `fdr-store.js`, `marsa-store.js`, `field-state-store.js` and `metrics.js` all call `crypto.randomUUID()` through the module object (not destructured), so the patch reaches them | deterministic ids mean no normalisation pass. If any destructures, you need a normaliser that maps ids to ordinal tokens by first appearance |
| V2 | How `host-core.js` builds `WsHub` without `attach()` (`hub._wss = { clients: new Set() }`), registers fake sockets and drives `_onConnect`/`_onMessage` | you need every socket's received messages, in order, through the real `_broadcastEfsp` filtering (ADR 0080) |
| V3 | Which env vars `facility-config.js`, `airspace-config.js`, `index.js` and `mutation-log.js` read for paths, and that they are read at `require` time | set them before the first import, as the scenario files do |
| V4 | The persist body's key order in `index.js` `_persist`, and `persistedWallAt` | record the parsed object, and also a hash of the raw body (key order is part of the contract) |
| V5 | Run crc-sync with coverage (`node --test --experimental-test-coverage --test-coverage-include='src/efsp/*.js' tests/*.test.mjs`) and take `board-store.js`'s uncovered line list | it is your T1 checklist of refusal branches |

## 5. Design

### 5.1 The recorder (`crc-sync/tests/golden/harness.mjs`)

- `openWorld({ seed, startNow, fixtures })` sets env paths to a fresh temp dir, writes the facility and
  airspace fixtures (copy the shipped `config/efsp-facility-*.json`, plus the airspace set from
  `efsp-scenarios.test.mjs`), calls `setupHostEnv`, imports `createEfsp` and `WsHub`, and wires the hub with
  fake sockets.
- `step(world, { as, msg })` sends one message from one fake client through `hub._onMessage`. It returns a
  record:
  ```
  { i, as, in: msg,
    out: { [clientId]: [msg, …] },        // every frame each socket received, in order
    log: [entry, …],                      // Mutation-log lines appended during the step
    snap: { hash, body? } }               // sha1 of the raw persisted body; full parsed body at checkpoints
  ```
- Checkpoints: every 25 steps, after every restart, and at the end of the trace.
- Clock steps (`{ advance: ms }`) move the virtual clock. Tick steps (`{ tick: 'nlaStatus'|'archiver'|… }`)
  call the monitor the way `server.js` does.
- `restart(world)` runs persist, builds a new `createEfsp` and hub on the same state dir, and reconnects every
  fake client. A new epoch is expected.
- `crash(world)` drops the persist of the next Mutation (use the technique in `efsp-crash-replay.test.mjs`),
  then calls `restart`, so the NotPersisted marker path is recorded.
- Comparison: deep-equal per step. On a mismatch, fail with the trace name, the step index, the client id and
  the first differing JSON path, never a multi-megabyte dump.

### 5.2 The corpus (`crc-sync/tests/golden/traces/*.mjs`, each exporting a list of steps)

| Trace | Content | Size target |
|---|---|---|
| T1 `op-matrix` | Every op kind in `permission.js` `OP_KINDS`, every coordination primitive × action, every TOFI action, every `CarrierTransfer` kind (and `SfaRotation` if merged), each once successful and once per reachable refusal reason (`PERMISSION_DENIED`, `NOT_OWNER`, `STALE_REV`, `NOT_FOUND`, `VALIDATION_ERROR` variants, `NLA_INHIBITED`, `NO_RECEIVING_POSITION`, `NOT_HOLDING_POSITION`, unknown `facilityId`); replays of the same `clientMutationId` (Board and the five non-Board families); the 400 ms double tap and the 30 s Undo window | ~300 steps |
| T2 `walks` | The sequences of the scenario suites rewritten as traces (do not instrument the suites): civil IFR round trip; military round trip with TOFI; coordination (5 primitives, cancel, peer gone); tactical (L23); carrier (L17); manning (vacate, covering chain, retake); field state; MARSA (declare, interlock void, retire); airspace; correlation; ATO import; scramble; ordnance; release; time chains | ~600 steps |
| T3 `random` | 3 seeds × ~1,500 messages from `tools/soak/traffic.js` with `prng.js`, in-process; with reconnect + `efsp-resync` (both epoch-match and epoch-change), Position changes, clock advances past the archive retention, and two `restart`s at fixed steps | 4,500 steps, snapshot hash only except at checkpoints |
| T4 `crash` | One crash between audit and persist, the restart, the client retry (mode A), and the NotPersisted marker (mode B) | ~30 steps |
| T5 `monitors` | `nlaStatusMonitor.tick` after a release time passes; `archiver.sweep` after retention; reassign on vacate | ~40 steps |

Keep fixtures compact: one JSONL file per trace, no pretty-printing, and full snapshots only at checkpoints. If
T3 pushes the total over 2 MB, shorten it and say so in `P0.md`.

### 5.3 Guard tests (crc-sync)

1. **`golden-wiring-complete.test.mjs`.** Collect every `this._rules.<name>` in `src/efsp/board-store.js` (and
   in any `src/efsp/board/**` file once it exists) by source scan. Assert that each name is a key of the `rules`
   that `createEfsp()` builds for **every** Facility (reach it through `boardStoreFor(f)._rules`). Today 43 keys
   are read. A miss means a check is silently off in production.
2. **`golden-board-surface.test.mjs`.** Freeze two lists:
   - the Board's public methods called from outside `board-store.js` (`src/`, `server.js`, `tools/`), found by
     source scan, as an exact set;
   - the private members tests and tools reach (`_strips`, `_nlaHistory`, `_appliedMutations`, `_touch`,
     `_log`, `_cidSeq`, `_droppedWallAt`, `_bayForNewOwner`, `_fdrStore`, …), with an assertion that each still
     exists on a constructed `BoardStore`.

   The failure message says: "a refactor must keep this name, or update this list in the same commit and say
   why".
3. **`golden-wall-clock.test.mjs`.** Freeze the list of `Date.now()` call sites per file under `src/efsp/` (file
   and count, not line). `board-store.js`'s documented ones are the NLA latch, `appliedWallAt`,
   `droppedWallAt` and the replay persist horizon. `index.js` has `persistedWallAt`. ADR 0079 / H11: a new site
   is a review question.

### 5.4 Guard test (crc-desktop): `client-global-surface.test.js`

- Read `app/public/index.html` and take every local `<script src>` in document order.
- In one `vm` context with the existing DOM stub (`tests/helpers/dom-stub.js`), run each script in order. Assert
  that none throws at load. **This fails today on `integ/wave3-dry`** (`final-panel.js`: duplicate `finite`)
  unless L18S's fix has merged. If it is still unmerged, mark that one assertion `todo` with the reason, and
  say so in `P0.md`.
- Assert that no top-level `function`/`const`/`let`/`var`/`class` name is declared by two scripts. Today that
  also finds `_el` (three scripts) and `_callsignOfFdr` (`carrier-panel.js`, `efsp-panel.js`). Use `todo` for
  any that are still present, naming the owning lane (C0, UI-B).
- Freeze the full set of top-level names as a sorted list in `tests/fixtures/client-global-surface.json`, with
  `GOLDEN_RECORD=1` to rewrite it. This is what the optional `bay-view.js` split (C1b) must keep equal.

## 6. The detector proof (`crc-sync/tests/golden/selfcheck.mjs`, `npm run golden:selfcheck`)

Copy `src/` to a temp dir. For each mutation, patch the copy, run the golden suite against it (point the
harness's `SRC` at the copy), and expect a failure. Print a table: mutation, expected detector, result. At least:

| # | Mutation | Must be caught by |
|---|---|---|
| M1 | delete one `this._touch(strip.stripId)` in `_applySetFlag` | `out` (the broadcast lacks the Strip on the next delta/resync) |
| M2 | swap the order in which ws-hub sends `peerBroadcast` and `marsaBroadcast` | `out` order |
| M3 | change one refusal `detail` string | `out` (ack) |
| M4 | drop `causedBy` from `_recordPeer` | `log` |
| M5 | set `REPLAY_PERSIST_WINDOW_MS` to 0 | T4 (retry after restart re-applies) |
| M6 | persist `_epoch` in `snapshot()` and restore it | T3 (epoch unchanged after restart) |
| M7 | remove `unaudited: true` from the correlation `NOT_HOLDING_POSITION` return | `log` (the tap writes an extra line) |
| M8 | change `REBALANCE_KEY_LENGTH` from 40 to 400 | `out`/`snap` (orderKeys differ in T3) |
| M9 | in `_persist`, swap `fdr` and `boards` in the body literal | `snap.hash` |
| M10 | remove the `rules.liveStripsForFdr` key in `index.js` | wiring-completeness test |

If a mutation is not caught, extend the corpus until it is, and record what you added. Like
`soak:selfcheck`, this is not part of `npm test`.

## 7. Files

- **New (yours):** `crc-sync/tests/golden/**` and the three `crc-sync/tests/golden-*.test.mjs` files.
  crc-sync's `test` script is a bare `node --test`, which uses Node's default glob (`**/*.test.{js,mjs,cjs}`
  and more), so files under `tests/golden/` are picked up. Check that nothing under `tests/golden/fixtures/`
  or `traces/` matches that glob by accident,
  `crc-desktop/tests/client-global-surface.test.js`, `crc-desktop/tests/fixtures/client-global-surface.json`,
  and `docs/wip/P0.md`.
- **Shared, minimal:** `crc-sync/package.json`. Add the `golden:record` and `golden:selfcheck` scripts only.
- **Read-only:** everything else, including `tools/soak/**` (`require` it; do not edit it).

## 8. Acceptance

- Both suites green. Test counts before and after are in the report.
- The golden suite runs in under 10 s and its fixtures are under 2 MB (state both numbers).
- The selfcheck table shows every mutation caught.
- `soak:selfcheck` is 5/5 and `soak:smoke` PASS (unchanged, since nothing in `src/` changed).
- `P0.md` has the corpus inventory, the list of unreachable refusal branches with reasons, and the re-record
  procedure:
  "a behaviour lane runs `npm run golden:record`, commits the fixtures in their own commit, and lists the
  changed traces and steps in its report. A refactor lane never re-records."

## 9. Traps

- crc-sync's `npm test` is a bare `node --test` (default recursive glob). crc-desktop's is
  `'tests/*.test.js'` (no recursion), so the client test goes directly in `crc-desktop/tests/`.
- Every scenario file needs its own temp state dir (the Board and the airspaces are durable, ADR 0002). So does
  every trace. Never share one across traces.
- The NLA double-tap latch is wall time (400 ms). With the virtual `Date.now`, advance it explicitly between
  presses, or you record a swallowed press.
- `facility-config.js` derives the RANGES Position set from the airspace file at `require` time. Write the
  fixtures before the first import.
- `metrics.js` mints a `sessionId` with `crypto.randomUUID`. If you include instrumentation, the seeded UUID
  covers it. If you do not, leave it out of the world entirely, rather than half-wired.
- Do not record `efsp-heartbeat` timing or anything `ws-hub.js` sends on its 500 ms track tick. Filter the
  socket capture to `efsp-*` frames, plus `efsp-alerts` once per checkpoint.
- If L18S, UI-B or L28 merge into your base mid-lane, re-record once in its own commit, and say which.

## 10. Report back (≤ 40 lines; the same at the top of `docs/wip/P0.md`)

Branch and commit range; test counts before and after (both suites); golden runtime and fixture size; the
selfcheck table; the corpus inventory summary; the unreachable branches; the `todo`s in the client test and
who owns them; and anything in the Board that the traces showed to be nondeterministic (that would be a finding
in its own right).

## 11. Questions (take the default, log it, carry on: P2)

- **Q1** Record on `integ/wave3-dry`, or wait for the real merge? **Default:** record on your base now. The
  freeze re-records once.
- **Q2** Include `metrics.js` instrumentation in the world? **Default:** yes, through `createEfspInstrumentation`
  exactly as `server.js` wires it, because the traffic count reads the log the golden master already records.
  If it makes T3 nondeterministic, drop it and say so.
- **Q3** Exercise ATO import (`efsp-ato-*`) in T2? **Default:** yes, with one fixture ATO from
  `tests/fixtures`.
