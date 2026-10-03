# Supervisor handoff

## START HERE: end of phase 2 of the architecture fixes (2026-10-03)

You are the supervisor ("main") of parallel lanes in this monorepo. You dispatch background agents in git worktrees,
merge their branches into `efsp-wp5-correlation`, and keep the record. Older session history is in git and in
`docs/parallel/decisions.md`; this file only holds what you need now.

### Standing rules (the human's, in force)

- **H99:** merge finished lanes into `efsp-wp5-correlation` without asking. **Never push, never deploy** (R3-79: ask
  before any prod deploy).
- **H105:** **at most 3 agents at once.** Queue the rest and start the next when one finishes.
- **Models:** code-writing lanes run on Sonnet, design and analysis on Opus.
- **Lanes never run `git merge`/rebase** (the classifier refuses it). The supervisor runs every merge. If a merge
  conflicts badly, start it yourself in a fresh `integ/<name>` worktree and give an agent the conflicted tree to
  resolve and `git commit`.
- Every lane reads `docs/parallel/lane-rules.md`. That file covers the worktree in `../sourcedcs-<LANE>`, branch
  `lane/<LANE>-…`, `docs/wip/<LANE>.md`, clocks, strict state/, and Playwright only on its own `E2E_LANE`.
- **Never touch `crc-sync/state/`** (the human's local data), **:3000** (the human's crc-sync) or **:3117** (an orphan
  the human must stop). **Never `pkill -f`**: stop processes by PID only.
- **Questions for the human** go to the Decision Desk the moment they arise:
  https://claude.ai/artifact/A3gizEgbwfqCnnU831G4Y7 (`questions` collection; read answers by listing the whole
  `answers` collection with limit 1000).
- **Auth hardening is out of scope.** H106 AC-2: the localhost `POST /api/sync-config` hole stays a known finding.
- **After every merge:**
  - crc-sync: `npm test`, `npm run walk` (I11 depth 4), `npm run freeze` (on conflicts, take either side, then `freeze:update` once), `wire:record`
    (any wire change; the protocol is 2 and stays 2 until a crc-desktop release ships 2).
  - crc-desktop: `npm test`. Re-record `tests/fixtures/module-graph-exports.json` with
    `GOLDEN_RECORD=1 node --test tests/module-graph.test.mjs` when a client module was added.
  - After client merges, run the full sharded Playwright suite:
    `cd crc-desktop && npm run e2e:sharded -- --lanes 1,2,4,5 --rerun-failed`. Failures that pass alone come from load.
    Afterwards `git checkout -- docs/wip crc-desktop/e2e/tools/spec-timings.json`.
- **At the end of phase 3,** clean up again: remove worktrees and merged branches, rewrite this file, and give the
  human a relaunch prompt (memory `feedback_handoff_for_relaunch`).

### State

`efsp-wp5-correlation` is local only, about 1,230 commits ahead of `main`. Everything is merged and green:

| Suite | Result |
|---|---|
| crc-sync | 2433/2433 |
| walk (`npm run walk`, I11 depth 4) | 23/23 |
| freeze | 52/52 (109 goldens) |
| freeze:selfcheck | 18/18 |
| soak:selfcheck | PASS |
| crc-desktop | 1142/1142 |
| sourcedcs-web | 146/146 |
| Playwright (full, sharded, end of phase 2) | **189/189 on the first pass, no reruns** |

The only worktree is the main checkout. Two unmerged branches are kept on purpose and are superseded:
`lane/QA-sync-cleanup` and `lane/AIRSP-2P-B-geometry`.

- **Built:** every EFSP feature the usage guide and the post-refactor list name (undo 0100, Split/Join 0099, control
  release 0101, TOFI regime 0102, airspace registry 0098, wire protocol 0103, heartbeat 0104, GC/LC 0105, store sync
  0106). Status page https://claude.ai/artifact/RarbPFQsNAN58a3cD7nUbP.
- **Architecture check (H103):** reports `docs/wip/ARCH-S.md`, `ARCH-W.md`, `ARCH-C.md`; plan
  `docs/parallel/arch-check-plan.md`. Human answers H106: AC-1 all three phases in order; AC-2 leave the localhost
  hole; AC-3 warn plus automatic repair on sign-off; AC-4 restructure the goldens.
- **Phase 1 (bugs B1-B14)** done: decisions.md S-ARCH-1 to S-ARCH-4.
- **Phase 2 (tests and tooling)** done: S-ARCH-5 to S-ARCH-8 plus the E2E-STAB merge. Lane notes in
  `docs/wip/{TMP-HYGIENE,E2E-STAB,FREEZE-GRAIN,STORE-THROWS}.md`. What changed for you as integrator:
  - Test processes get a private TMPDIR; the crc-sync preload warns (fails under `CI`) when `crc-sync/state/` changed.
  - **Goldens:** never hand-merge. Take either side, `npm run freeze:update`, check `git diff --stat` is small, commit
    separately. Ids are numbered per golden; hashes cover `PROJECTION` in `tests/freeze/freeze-lib.mjs`.
  - The Board's NLA guard reads the injected wall clock; e2e sets it to 0 (`CRCSYNC_NLA_GUARD_MS` /
    `POST /__test/nla-guard`, only with `CRCSYNC_TEST_RESET=1`). Playwright resets the Board **per test** by default
    (`resetScope`; only `runway-status` is `'file'`). One `waitForTimeout` remains (signon-reconnect's 15 s grace);
    the hygiene test bans new ones, sub-5 s timeouts and bare `locator('select')`.
  - `crc-desktop/tests/e2e-boot.test.mjs` boots real crc-sync with Playwright's env (`e2e/helpers/harness-env.js`).
  - The six non-Board stores answer `INTERNAL_ERROR` on a throw and audit/persist/broadcast a partial write
    (`src/efsp/store-throw.js`, `wire/skeleton.js` on `ok || partial`).

### Next: phase 3 (structure)

Give each lane its report section plus `arch-check-plan.md`. Run 3 at a time. Lanes that share files must not run
together: SERVER-SEAMS touches `ws-hub.js`, `app.js`, `efsp/index.js` and every store; DESK-ACKS and DESK-SYNC both
touch the client's EFSP messaging (`efsp-ws.js`, `efsp-messages.js`, `efsp-state.js`); DESK-GRAPH touches nearly every
client module. A sensible order: **wave A** SERVER-SEAMS + DESK-ACKS + SEAMS (SEAMS is web/env, small); **wave B**
DESK-SYNC + DESK-TIDY; **wave C** DESK-GRAPH alone (or with a server lane), then the file splits it unblocks.

1. **SERVER-SEAMS (M–L).**
   - Inject the clock at the remaining bare `Date.now()` sites: `efsp/index.js:617`, `correlation-reconciler.js:338`,
     the `wallNow` defaults in `archiver.js`, `metrics.js`, `traffic-count.js`, `mutation-log.js`.
   - Read config at start, not at require time (`stereo-routes`, `apt-config`, the env reads). End the
     `facility-config` singleton.
   - One delta builder per family and one broadcast path in `ws-hub.js` (six today).
   - Shared store bookkeeping: sync counter, getters, `setMutationLog`, audit subject id (`store-throw.js` is a start).
   - Bring back the rev/updatedAt helper.
   - Split `createApp` (765 lines) and `createEfsp` (323 lines, 54-closure `rules`).
   - Make the late-bound hooks plain dependencies. The regime locator fails silently today.
   - Carry-overs from phase 2: switch `efsp-scenarios.test.mjs` and `efsp-scenario-runway-status.test.mjs` from real
     410 ms sleeps to the stepped wall clock (re-record their goldens once); `hub-random-seed1/2` alert hashes follow
     raw id values; the timing-flaky `ato tokenize: pathological inputs finish fast` (fails at load ~40) and
     `grpc-client-stream` jitter tests (ARCH-S §5c); the duplicated test fixtures (`fakeWs` ×7, `fresh()` ×9, ARCH-S §5d).
   - Source: ARCH-S #3, 5, 6, 7, 9, §5c, §5d.
2. **DESK-ACKS (M, plus server S).** One `send(msg, {onAck})` in place of five ack trackers. Attestation and warnings
   become structured, with no regex on prose; `warnings[]` already exists server-side. Five refusal codes reach the
   controller raw (add `INTERNAL_ERROR` wording too). A popover keeps its input on refusal. Source: ARCH-C #6.
3. **DESK-SYNC (S–M).** One sync cursor for Boards and stores. Delete `efspBoardSeq`. Source: ARCH-C #7.
4. **DESK-GRAPH (M–L).** Break the 59-module import cycle: leaf modules instead of importing `app.js`, an end to
   `window.getLatestTrack` in production and to `bay-view`'s 50 re-exports, then a change bus. Source: ARCH-C #5.
   It unblocks splitting `efsp-state.js`, `airspace-panel.js`, `strip-view.js`, `airspace-editor.js` and
   `map-setup.js` (ARCH-C #9).
5. **SEAMS (S).** One service-token helper and status policy (B15). Env naming: `SOURCEDCS_CRCSYNC_URL` and
   `CRCSYNC_URL`'s two meanings. The 20 undocumented path overrides. The dead `PUBLIC_DIR`. Source: ARCH-W #7, #10, §1.4.
6. **DESK-TIDY (S).** A topology module. Parity tests for the four client rule tables. Dead exports, naming and CSS.
   The `innerHTML` sinks. `openPopover`. A real-server airspace e2e. Also: `docs/wip/FREEZE.md` is stale (whole-record
   hashes), and the briefing should say a double tap on "Hand Off" is guarded only client-side (transfer NLAs never set
   the server latch). Source: ARCH-C #8, #10.

**After phase 3:**
- NX-1, a soak-with-hints lane: wire the hint monitor and airborne observer into the soak, add the store-stale
  detector from SYNC-B-S, then the human runs the 4 h soak once.
- The other consolidation links, CD→GC, LC→AP and carrier (H104 GCLC-3), as their own design lane.
- `definitionHistory` on the wire.
- A route from a DCS line drawing.
- An undone split telling clients its flight data is gone.
- `sync-lxsrs.sh --upgrade`.
- Declutter goes last.

### Human actions outstanding

- Push a backup of `efsp-wp5-correlation`.
- Stop the orphan on :3117.
- Local crc-sync: the old `state/` files must be moved aside (the human was given the `mv` command on 2026-10-03).
  Expect a fresh Board.
- **Release, together, from `main`:**
  - merge, then tag `crc-desktop-vX.Y.Z`;
  - in the server's `infra/.env`: rename `ASACS_*` to `CRCSYNC_*`, and set `AIRSPACE_SERVICE_TOKEN`,
    `CRCSYNC_MAPTILER_CLIENT_KEY` and `CRCSYNC_MAPTILER_KEY`;
  - delete the server's `state/efsp-board.json` and `state/efsp-mutations*.jsonl` (the strict state check refuses
    them);
  - expect the first deploy to hold crc-sync until a labelled image is built (DEPLOY-GATE-2), then check that the
    digest in the Deploy log matches `docker inspect crc-sync`;
  - re-enter the airspace ranges in `/airspace-admin.html`;
  - expect one mission-session roll for missions with named drawings.
- **Live checks:** the 4 h soak workflow; wind direction; `mission_start` on restart; a real carrier and a real FINAL
  track; a two-controller walk of undo, control release and the GC offer; a manual crc-desktop login (popup sandbox,
  navigation guards).
- **Squadron data to confirm:**
  - Incirlik runway headings 056/236;
  - GND 275.8 and TWR 251.0, plus the CD and AP frequencies;
  - SFA frequencies and pad names;
  - comm-card values;
  - the USAF ground/tower combining rule (DAFMAN 13-204v3).
