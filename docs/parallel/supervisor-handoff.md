# Supervisor handoff

## START HERE: end of phase 3 of the architecture fixes (2026-10-05)

You are the supervisor ("main") of parallel lanes in this monorepo. You dispatch background agents in git worktrees,
merge their branches into `efsp-wp5-correlation`, and keep the record. History is in git and in
`docs/parallel/decisions.md` (S-ARCH-1 to S-ARCH-32, H107 to H113); the EFSP state for any reader is
`docs/efsp-briefing.md` (§1 state, §3K phase 3, §4 what's left, §5 where to start). This file only holds what you need now.

### Standing rules (the human's, in force)

- **H99:** merge finished lanes into `efsp-wp5-correlation` without asking. **Never push, never deploy** (R3-79: ask
  before any prod deploy).
- **H112: one agent at a time.** (Was 3, H105.) An agent the human stopped is not resumed unless they ask; its committed
  work may still be checked and merged by the supervisor (S-ARCH-31 did that for DESK-SPLIT).
- **Models:** code-writing lanes on Sonnet, design and analysis on Opus.
- **Lanes never run `git merge`/rebase.** The supervisor runs every merge.
- Every lane reads `docs/parallel/lane-rules.md` (worktree `../sourcedcs-<LANE>`, branch `lane/<LANE>-…`,
  `docs/wip/<LANE>.md`, clocks, strict state/, Playwright only on its own `E2E_LANE`). Tell every lane to **commit at
  every green step**: the human stops sessions, and uncommitted work is lost.
- **Every lane runs both unit suites** (crc-sync and crc-desktop), whichever side it edits: the parity tests and
  several crc-sync tests read client source. Three integration breaks this phase came from skipping that.
- **e2e specs reach client modules through `crc.<module>`** (`e2e/helpers/modules.js`). A lane that moves a function
  must update every spec, including specs merged after it branched (S-ARCH-32).
- **Never touch `crc-sync/state/`** (the human's local data) or **:3000** (the human's crc-sync). **Never `pkill -f`**:
  stop processes by PID only. In this shell `grep` is a wrapper that skips ignored files (the scratchpad among them):
  use `command grep` or `awk` on logs there.
- **Questions for the human:** they have been answering in chat lately; the Decision Desk
  (https://claude.ai/artifact/A3gizEgbwfqCnnU831G4Y7) still exists for batches.
- **Auth hardening is out of scope.** The localhost `POST /api/sync-config` hole stays a known finding (AC-2).
- **After every merge:**
  - crc-sync: `npm test`, `npm run walk`, `npm run freeze` (on golden conflicts take either side, `freeze:update`
    once), `soak:selfcheck` when Board/wire/sync/hub/soak files moved, `wire:record` on any wire change (protocol 2;
    the last release speaks 1).
  - crc-desktop: `npm test`; re-record `tests/fixtures/module-graph-exports.json` with
    `GOLDEN_RECORD=1 node --test tests/module-graph.test.mjs` when exports change.
  - After client merges: `cd crc-desktop && npm run e2e:sharded -- --lanes 1,2,4,5 --rerun-failed`. Failures that pass
    alone come from load. **Never merge client files while it runs** (it serves the main checkout). Afterwards
    `git checkout -- docs/wip crc-desktop/e2e/tools/spec-timings.json`.

### State

`efsp-wp5-correlation` is local only, 1,401 commits ahead of `main`. Everything is merged and green. The only worktree
is the main checkout; the two superseded branches `lane/QA-sync-cleanup` and `lane/AIRSP-2P-B-geometry` (and their
checkpoint refs) are kept on purpose.

| Suite | Result |
|---|---|
| crc-sync | 2541/2541 |
| walk (I11 depth 4) | 23/23 |
| freeze | 53/53 |
| soak:selfcheck | PASS |
| local 240-min soaks | seed 1 and seed 2 PASS (seed 2 heap slope 0.92 MB/h, gate 1.0) |
| crc-desktop | 1198/1198 |
| sourcedcs-web / infra / pytest | 151 / 27 / 363 (last run during phase 3) |
| Playwright (full, sharded) | 190/195 on the DESK-SPLIT tree, the 5 fixed by the supervisor (6/6); 12/12 on the specs DESK-NOTICES touched |

**Phase 3 done** (S-ARCH-10 to S-ARCH-32): SEAMS, SERVER-SEAMS-1/2, DESK-ACKS, DESK-SYNC, DESK-TIDY-1/2, DESK-GRAPH,
DESK-SPLIT (client import graph has no cycle, bound 0), SERVER-TIDY, plus the human's decisions built: ARCHIVE-12H
(H107, ADR 0107), MISSION-CLEAR (H108, 0108), CARRIER-ATO (H109, 0109), consolidation as hat offers (H104/H111/H113,
0110: CONSOL-DESIGN, CONSOL-S, CONSOL-C), NX-1 (soak with hints, store-stale detector), THEATERS, DESK-NOTICES and
DOCFOLD-3 (phase-3 notes folded; originals in `docs/wip/folded-phase3/`).

### Next (one lane at a time)

From briefing §4/§5, in a sensible order:
1. **Decisions to put to the human** (each small): does a mission-reset drop count as traffic (H108 follow-up)?
   Should a carrier recovery remember its launch so a UNION cycle is LOCAL without a plan or ATO line?
2. `definitionHistory` on the wire.
3. A route from a DCS line drawing.
4. The correlation seq-jump decision (`correlations` `gapFromDeltas:false` costs ~25 slice resyncs per 20 min).
5. A soak that rolls the mission (exercises ADR 0108) and synthetic airborne-on-ground traffic (`airborneEver` is 0).
6. Cleanup row (briefing §4): `facilityView` instead of closures in the rules bag, 164 underscore exports, CSP,
   CSS split, attestation in the replay cache, bare `Date.now()` outside `src/efsp`.
7. Declutter goes last.

### Human actions outstanding

- **Push a backup of `efsp-wp5-correlation`** (it is local only).
- The repo root has two untracked items that are the human's: `crc-sync/│` (a stray file, likely a mistyped redirect)
  and `state-backup-2026-10-03/`.
- **Release, together, from `main`** (crc-sync and crc-desktop must ship together: the `efsp-position-offer` frame is
  gone, protocol stays 2):
  - merge, then tag `crc-desktop-vX.Y.Z`;
  - in the server's `infra/.env`: rename `ASACS_*` to `CRCSYNC_*`, set `AIRSPACE_SERVICE_TOKEN`,
    `CRCSYNC_MAPTILER_CLIENT_KEY` and `CRCSYNC_MAPTILER_KEY`;
  - delete the server's `state/efsp-board.json` and `state/efsp-mutations*.jsonl`, and check for any
    `state/efsp-facility-*.json` (strict state refuses the old `consolidation` shape; `infra/RUNBOOK.md`);
  - expect the first deploy to hold crc-sync until a labelled image exists, then check the Deploy log's digest
    against `docker inspect crc-sync`;
  - re-enter the airspace ranges in `/airspace-admin.html`; re-import the ATO for each mission (a mission reset clears
    MISSION lines too).
- **Live checks:** the 4 h soak workflow (`crc-sync-soak.yml`: minutes 240, seed 1, realistic, realtime false,
  selfcheck true; needs the branch pushed; watch the heap slope); wind direction; `mission_start` on a crc-sync
  restart (must log no "mission reset") and on a `.miz` restart (exactly one); a real carrier and FINAL track; a
  two-controller walk of undo, control release and the hat offers; a manual crc-desktop login.
- **Squadron data to confirm:** Incirlik runway headings 056/236; GND 275.8, TWR 251.0, CD and AP frequencies; SFA
  frequencies and pad names; comm-card values; the DAFMAN 13-204v3 ground/tower rule; projection data for
  MarianaIslandsWWII, Afghanistan and Iraq.
