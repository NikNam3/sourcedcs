# Supervisor handoff

## START HERE: the carrier and PAR panels are built and merged (2026-10-11)

You are the supervisor ("main") of lanes in this monorepo. You dispatch background agents in git worktrees, merge their
branches into `efsp-wp5-correlation`, and keep the record. History is in git and in `docs/parallel/decisions.md`
(S-ARCH-1 to S-ARCH-46, H107 to H127); the EFSP state for any reader is `docs/efsp-briefing.md` (§1, §3K, §4, §5), brought
up to date by DOCS-PANELS. This file only holds what you need now.

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

`efsp-wp5-correlation` is local only, about 1,550 commits ahead of `main`. Everything is merged and green; the only
worktree is the main checkout (branches `lane/QA-sync-cleanup`, `lane/AIRSP-2P-B-geometry` kept on purpose).

| Suite | Result (2026-10-11, tree `07749161`) |
|---|---|
| crc-sync | 2647/2647 (`grpc-client-connect.test.mjs` fails now and then under load, passes alone: a timing bound) |
| freeze | 56/56 |
| crc-desktop | 1254/1254 |
| walk / soak:selfcheck / wire:record | 23/23 / PASS / protocol 2, surface unchanged |
| Playwright (full, sharded) | 224/228 on the CARRIER-FOLLOWUP tree; the two failures and `runway-status` (serial, skipped 2) pass alone. HULL-STRICT is server-only and ran no Playwright |

Built 2026-10-08 to 2026-10-11 (S-ARCH-37 to S-ARCH-46; every agent on Opus 5.5 since H121):
SETTINGS-TABS, DIVERT (ADR 0111), CARRIER-STATE (0113), MARSHAL-BOARD (0114), MARSHAL-FIX, CARRIER-MAP, MARSHAL-MARKS (0115),
SIDE-SWAP, WIRE-RECORD, PAR-1 (0112), PAR-2, CARRIER-FOLLOWUP (0116: PAR is airfield-only, H125), DOCS-PANELS, HULL-STRICT.
The usage-guide wording of every lane is placed; `docs/wip/<LANE>.md` hold the details.

### Next (one lane at a time, Opus)

Nothing is queued. Ask the human what next. Candidates (briefing §4/§5):
- the flaky `grpc-client-connect` timing test;
- `wire:record` also scanning refusal codes / op argument names (asked, not answered);
- the older queue: does a mission-reset drop count as traffic; should a carrier recovery remember its launch;
  `definitionHistory` on the wire; a route from a DCS line drawing; the correlation seq-jump decision; a soak that rolls
  the mission; the cleanup row; declutter last;
- a deck-state board (foul deck) if the human wants it; a basemap under the carrier map only to show land (H123, later).

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
  - Incirlik headings;
  - GND/TWR/CD/AP frequencies;
  - SFA frequencies and pads;
  - comm card;
  - the DAFMAN combining rule;
  - projection data for MarianaIslandsWWII, Afghanistan and Iraq;
  - the LTAG PAR plate (threshold, TDZE, TCH, DA, glidepath angle);
  - the carrier fix-to-ramp time (`fixToRampSec`, ours: 6 min) and CVN-72 data (the carrier glideslope is no longer needed, H125).
