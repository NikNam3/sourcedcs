# Supervisor handoff

## START HERE: the live test's fix batch is planned, research first (2026-10-12)

You are the supervisor ("main") of lanes in this monorepo. You dispatch background agents in git worktrees, merge their
branches into `efsp-wp5-correlation`, and keep the record. History is in git and in `docs/parallel/decisions.md`
(S-ARCH-1 to S-ARCH-47, H107 to H132); the EFSP state for any reader is `docs/efsp-briefing.md` (§1, §3K, §4, §5). This
file only holds what you need now.

**Do this first:**
1. Read `docs/parallel/live-test-2026-10-11.md` (the human's findings T1–T31 with causes and rulings) and
   `docs/parallel/next/LIVE-TEST-FIXES.md` (the lanes, order, dependencies, ADR numbers 0117–0121).
2. Read the Decision Desk answers (https://claude.ai/artifact/A3gizEgbwfqCnnU831G4Y7, `ArtifactData` list the whole
   `answers` collection, `limit: 1000`; questions **LT-Q1…LT-Q5**, round 8). Settle them into `decisions.md` (H133+),
   mark them settled.
3. Dispatch **LT-RESEARCH** (`docs/parallel/next/LT-RESEARCH.md`, Opus, docs only) first. Then the lanes in the order of
   `LIVE-TEST-FIXES.md`. After the research lands: put its label table (T8) and its questions on the Decision Desk.
4. The human said they will "send a new batch of agents": H112 (one agent at a time) is still the standing rule. Lanes
   0–4 of `LIVE-TEST-FIXES.md` are file-disjoint, so ask the human once whether to run them together.

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

`efsp-wp5-correlation` is local only, about 1,580 commits ahead of `main`. Everything is merged and green; the only
worktree is the main checkout (branches `lane/QA-sync-cleanup`, `lane/AIRSP-2P-B-geometry` kept on purpose). Last gates
(tree `07749161`, HULL-STRICT; everything after it is docs): crc-sync 2647, freeze 56/56, walk 23/23, soak:selfcheck PASS,
wire 2 unchanged, crc-desktop 1254; sharded Playwright 224/228 on the CARRIER-FOLLOWUP tree (the four pass alone).

**The live test (2026-10-11):** the human ran crc-desktop against a local crc-sync on :3000 (their `crc-sync/.env`, the
shared DCS server's Syria mission, SRS). It is stopped now; `crc-desktop/config.json` is back on
`wss://asacs.sourcedcs.page` (never commit a local endpoint). `crc-sync/state/` holds the test's Board and Mutation log
(the human's data: read only; T22/T31 were read from it). To run another local test: `cd crc-sync && node server.js` in the
background (stop it by PID), point `config.json` at `ws://localhost:3000` without committing, the human starts
`crc-desktop` and logs in; the MapTiler key is in `crc-sync/.env`.

New rulings since the panels (H128–H132): **FAA model, always** (H128, memory `feedback_faa_model_always`); strip
selection no longer rings the track, "Show on map" in the ⋯ menu (H129); the RSU answers (H130) and `IN_PATTERN` renamed
(H131); an alert for entering active airspace without approval (H132).

### Next (one lane at a time, Opus)

`docs/parallel/next/LIVE-TEST-FIXES.md`: LT-RESEARCH, LT-TERRAIN, LT-UI, LT-AIRSPACE-FIX, LT-CORRELATION, LT-SFA-PAR (ADR
0117), LT-STRIP-FIELDS, LT-MARSA (0118), LT-AIRSPACE-ALERT (0119), LT-RSU-DESIGN → LT-RSU (0120), LT-GROUND (0121).
After that, the older queue (briefing §4/§5): the flaky `grpc-client-connect` timing test; `wire:record` scanning refusal
codes / op argument names (asked, not answered); mission-reset drop as traffic; a carrier recovery remembering its launch;
`definitionHistory` on the wire; a route from a DCS line drawing; the correlation seq-jump decision; a soak that rolls the
mission; the cleanup row; declutter last (now with T30, the conflict-alert drawings switch).

### Human actions outstanding


- **Push a backup** of `efsp-wp5-correlation`.
- Untracked in the repo root, the human's: `crc-sync/│` (stray file), `state-backup-2026-10-03/`, `tools.zip`, and `state-backup-2026-10-10/` (the local Board the supervisor moved aside, H122).
- **Release together from `main`** (crc-sync and crc-desktop must ship together):
  - merge, then tag `crc-desktop-vX.Y.Z`;
  - in the server's `infra/.env`: `ASACS_*` → `CRCSYNC_*`, set `AIRSPACE_SERVICE_TOKEN` and both MapTiler keys;
  - delete the server's `state/efsp-board.json` and `state/efsp-mutations*.jsonl`, and check for any `state/efsp-facility-*.json`;
  - remove `approach` (or any unknown key) from a server `state/efsp-carriers.json`, or crc-sync refuses to start (H127);
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
  - the stereo routes for Incirlik's departures (T6), into `state/efsp-stereo-routes.json`;
  - Incirlik headings;
  - GND/TWR/CD/AP frequencies;
  - SFA frequencies and pads;
  - comm card;
  - the DAFMAN combining rule;
  - projection data for MarianaIslandsWWII, Afghanistan and Iraq;
  - the LTAG PAR plate (threshold, TDZE, TCH, DA, glidepath angle);
  - the carrier fix-to-ramp time (`fixToRampSec`, ours: 6 min) and CVN-72 data (the carrier glideslope is no longer needed, H125).
