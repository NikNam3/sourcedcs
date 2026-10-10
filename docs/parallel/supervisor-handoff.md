# Supervisor handoff

## START HERE: carrier and PAR panels designed and approved, build next (2026-10-08)

You are the supervisor ("main") of lanes in this monorepo. You dispatch background agents in git worktrees, merge their
branches into `efsp-wp5-correlation`, and keep the record. History is in git and in `docs/parallel/decisions.md`
(S-ARCH-1 to S-ARCH-35, H107 to H119); the EFSP state for any reader is `docs/efsp-briefing.md` (§1, §3K, §4, §5). This file
only holds what you need now.

### Standing rules (the human's, in force)

- **H99:** merge finished lanes into `efsp-wp5-correlation` without asking. **Never push, never deploy.**
- **H112: one agent at a time.** An agent the human stopped is not resumed unless they ask; its committed work may still be
  checked and merged by the supervisor. The human sometimes stops sessions to save usage: tell every lane to **commit at
  every green step**, and stop when the human says stop.
- **Dark-cockpit UI** (memory `feedback_dark_cockpit_ui`, H115–H119): grey unless something is a problem (amber needs
  attention, orange-red failed, red past a limit); show only what the controller needs, never tell them their job; panels
  are ordinary dockable panels; app-wide font only. Label anything we invented as ours, never as real-world practice; cite
  real sources (the human asks for them).
- **Models:** every agent on Opus 5.5 (human, 2026-10-10). Lanes never merge or rebase; the supervisor merges.
- **Every lane runs both unit suites** (client and server tests read each other's files). **e2e specs reach client modules
  through `crc.<module>`**: a lane that moves a function updates every spec, including specs merged after it branched.
- Never touch `crc-sync/state/` (the human's data) or **:3000** (the human's crc-sync). Never `pkill -f`; stop by PID. In this
  shell `grep` is a wrapper that skips ignored files (the scratchpad among them): use `command grep` or `awk` on logs there.
  The scratchpad is cleared between days: re-stage artifact files from the repo before publishing.
- **Auth hardening is out of scope.**
- **After every merge:** crc-sync `npm test`, `npm run walk`, `npm run freeze` (golden conflicts: take either side,
  `freeze:update` once), `soak:selfcheck` when Board/wire/sync/hub/soak files moved, `wire:record` on any wire change
  (protocol 2; the last release speaks 1); crc-desktop `npm test` (re-record `tests/fixtures/module-graph-exports.json`
  with `GOLDEN_RECORD=1 node --test tests/module-graph.test.mjs` when exports change). After client merges:
  `cd crc-desktop && npm run e2e:sharded -- --lanes 1,2,4,5 --rerun-failed` (never merge client files while it runs; it
  serves the main checkout), then `git checkout -- docs/wip crc-desktop/e2e/tools/spec-timings.json`.
- To check a mockup or page headless: Playwright is in crc-desktop (`NODE_PATH=crc-desktop/node_modules node script.cjs`).

### State

`efsp-wp5-correlation` is local only, 1,430 commits ahead of `main`. Everything is merged and green; the only worktree is
the main checkout (kept on purpose: branches `lane/QA-sync-cleanup`, `lane/AIRSP-2P-B-geometry`).

| Suite | Result (2026-10-08) |
|---|---|
| crc-sync | 2544/2544 |
| freeze | 53/53 |
| crc-desktop | 1198/1198 |
| walk / soak:selfcheck | 23/23 / PASS at the last server merge (GRPC-CONNECT) |
| Playwright (full, sharded) | 190/195 + the 5 fixed (6/6) on the DESK-SPLIT tree; the later client changes ran their own specs |

Since phase 3 (S-ARCH-31 to S-ARCH-35):
- **Live findings fixed:**
  - your own new Strip made into a Bay out of view is announced ("from you");
  - the amber tab mark shows only for the LC + non-local combination;
  - a DCS-gRPC connect attempt not READY after 10 s is abandoned and rebuilt (`grpc-client.js`, one shared channel);
  - the first-run Board log names `state/`.
- **Mission reset vs crc-sync restart:** explained to the human (`mission-session.js`). The live checks are still owed (below).
- **Designs approved** (mockups in `docs/mockups/`, published at https://claude.ai/artifact/EA92HZDXSC7cmDHdAMmx7X):
  - **PAR panel** (H115, H116);
  - **Marshal / recovery board** (H117, H118);
  - **carrier map** and **carrier management** (H119 plus the 2026-10-08 notes).
- Research note `docs/wip/PANELS-DESIGN.md`. Its designs are superseded by the mockups; its research and code findings hold.

### Next (one lane at a time)

1. **Build the panels:** briefing **`docs/parallel/next/CARRIER-PANELS.md`**, lanes in this order:
   1. SETTINGS-TABS;
   2. CARRIER-STATE (ADR 0113);
   3. MARSHAL-BOARD (ADR 0114);
   4. CARRIER-MAP;
   5. PAR-1 (ADR 0112);
   6. PAR-2.
   Done 2026-10-10: SETTINGS-TABS, DIVERT, CARRIER-STATE, MARSHAL-BOARD (S-ARCH-37, H120–H122). After CARRIER-MAP:
   **MARSHAL-FIX** (S-ARCH-38: control-release.spec.js:141 fails, the Marshal stack Strip rebuilds during a press), then **MARSHAL-MARKS** (H123: the passed/changed marks on the server), then **SIDE-SWAP** (H122: side number and callsign swap places on carrier Strips), then PAR-1, PAR-2.
2. **DIVERT** (ADR 0111): briefing **`docs/parallel/next/DIVERT.md`**. The supervisor recommends running it right after
   SETTINGS-TABS. Ask the human first whether an ARRIVAL may divert too (proposed, not yet answered).
3. **Older queue** (briefing §4/§5):
   - does a mission-reset drop count as traffic;
   - should a carrier recovery remember its launch;
   - `definitionHistory` on the wire;
   - a route from a DCS line drawing;
   - the correlation seq-jump decision;
   - a soak that rolls the mission;
   - the cleanup row;
   - declutter last.
4. **Settings tabs** are a human request (H116): every panel gets a tab. SETTINGS-TABS builds the frame first so later lanes
   only register their tab.

### Human actions outstanding

- **Push a backup** of `efsp-wp5-correlation`.
- Untracked in the repo root, the human's: `crc-sync/│` (stray file) and `state-backup-2026-10-03/`.
- **Release together from `main`** (crc-sync and crc-desktop must ship together):
  - merge, then tag `crc-desktop-vX.Y.Z`;
  - in the server's `infra/.env`: `ASACS_*` → `CRCSYNC_*`, set `AIRSPACE_SERVICE_TOKEN` and both MapTiler keys;
  - delete the server's `state/efsp-board.json` and `state/efsp-mutations*.jsonl`, and check for any `state/efsp-facility-*.json`;
  - check the deploy digest;
  - re-enter the airspace ranges;
  - re-import the ATO each mission.
- **Live checks:**
  - the 4 h soak workflow (needs the branch pushed; watch the heap slope);
  - wind direction;
  - restart crc-sync while DCS runs a mission (the log must show no "mission reset"), then restart the `.miz` (exactly one);
  - a real carrier and FINAL track;
  - a two-controller walk;
  - a manual crc-desktop login.
- **Squadron data:**
  - Incirlik headings;
  - GND/TWR/CD/AP frequencies;
  - SFA frequencies and pads;
  - comm card;
  - the DAFMAN combining rule;
  - projection data for MarianaIslandsWWII, Afghanistan and Iraq;
  - the LTAG PAR plate (threshold, TCH, DA);
  - the carrier glideslope (3.5°?).
