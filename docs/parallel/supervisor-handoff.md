# Supervisor handoff

## START HERE: state at the end of session 2 (2026-10-01)

Everything older in this file is history; `docs/parallel/decisions.md` (rows H78, S-M-wave3 and the S-* rows above it) is the record.

**Rules in force.** Never push or merge without the human's go (the human said "merge what's finished" once; the merges below used it). **H78: no new agents until the running ones finish; the architecture refactor takes priority after them (and maybe L20).** Auth hardening is out of scope (memory `project_auth_out_of_scope`). Questions to the human go to the Decision Desk (https://claude.ai/artifact/A3gizEgbwfqCnnU831G4Y7); answers are read back with ArtifactData (`answers` collection) and logged as `H<n>` rows.

**Branches.** `efsp-wp5-correlation` (local only: nothing is on GitHub; 345+ commits over `origin/main`; **back it up first, needs the human's go**) now holds waves 1 to 3: `integ/wave3-dry` (GRPC, SOAK, DOCFOLD, TA, HYG, PARITY, L17, L19, UI-A) plus L18-server, SOAKW, QAC, INFRA2, S13, DOCS2, L28, FREEZE, ARCH, AIRSP, L20-prep. Tests on it: crc-sync 2006 pass, crc-desktop 825 pass / 2 todo. A full Playwright run (`E2E_LANE=7`, log `scratchpad/pw-real.log`, may be gone) was in progress. Branch map and merge forecast: https://claude.ai/artifact/DCTL7FNCx7jqvGiTaTRAtw (written before the last merges; the merged part is now done).

**Not merged yet.**
- `lane/QA-sync-cleanup` (QAS): conflicts with L18-server in `facility-config.js`; do not hand-merge, re-run its dead-export scan on the merged tree.
- `lane/UI-B-followup`: conflicts in 5 files (client `efsp-ws.js`, `board-store.js`, 3 test files); it cherry-picked PARITY's four test commits. After merging it, add the two one-liners in `docs/wip/UI-B.md` (the chip's `observedAirborne: true`, and `setAirborneObserver(...)` where L19's hint monitor is built).
- `lane/E2E-harden` (E2EH): may still be running; it also fixed `l15-metrics` (expects `NO DATA`) differently from the merge-time fix (`nothing in this window`): reconcile when merging. It conflicts only in `final-panel.js` (take the merged version).
- Phase 2 of AIRSP (airspaces panel build) waits for the refactor's registry phase and the desk answers.

**Unverified by the merge.** The INFRA2/nginx resolution (a 12-hourly cert-reload loop moved to `infra/nginx/entrypoint.d/30-reload-certs.sh`, never run against a real nginx); commit `e398dc6` ("docs(parallel): S-UIA...") also swept the human's uncommitted edit of that reload loop into history under a wrong message (not rewritten).

**Next, in order.** 1) Read the Playwright result and fix real failures (known flake classes: `tactical-positions`, `l17-carrier`, `l4-drag` under load; a worktree without `npm ci` shows exactly 10 crc-sync failures). 2) Merge QAS, UI-B, E2E-harden (each needs the human's go to push, not to merge). 3) Remove DOCS2's "on a branch" markers (grep `lane/L18-server` and `SOAKW` in CLAUDE.md, briefing, guide). 4) Read the desk answers (99 new questions: S3-1..10, AIRSP-1..7, ARCH-D1..D7, R3-1..82); the blocking ones are R3-1/2/3 (merge), R3-6/7 (S13), R3-8/9/10 and ARCH-D1/D2 (refactor), R3-11/12 and AIRSP-1 (airspace panel). 5) Decide L20 before the freeze window, then the refactor per `docs/wip/ARCH-plan.md` (phase 0 = the FREEZE lane, merged; refactor rule: golden diffs must be empty except by an explicit approved change). 6) Human actions: push a backup; `docker run` check of the nginx changes; the MariaDB init path and the O-9 server checks in `docs/wip/INFRA2.md`; check the live `state/` for a persisted `efsp-facility-*.json` lacking `holdsRole` (L28); live DCS checks (wind, `mission_start`, 10-minute gRPC, carrier ship, FINAL panel, the L19 chip during a runway suspension); the 4-hour soak workflow.

**Artifacts.** Feature map and concern triage (the human's fix/later/wontfix decisions live in its database): https://claude.ai/artifact/X4WHNNk45QQXCDyiranAxE; "How CRC works" walkthrough (20 levels): https://claude.ai/artifact/P2MMksGLE9ATgP7FBWx6jv; airspace panel mockup: https://claude.ai/artifact/JH2NYvGPM1zcrqRaEzgiqv; git story: https://claude.ai/artifact/DCTL7FNCx7jqvGiTaTRAtw. Worktrees: `../sourcedcs-<lane>` (about 30; remove after the merges), checkpoint loop `tools/checkpoint-worktrees.sh` (dies with the session).

---


Start here if you are the supervising session for the EFSP parallel lanes. Read, in order:

1. `docs/efsp-parallel-plan.md`: the lanes, the waves, the shared-file rules (§2), and your role (§1).
2. `docs/parallel/decisions.md`: **the record.** Every ruling (P = process, D = supervisor round 1,
   H = human, S-* = supervisor). It wins over any briefing. Lanes read it by absolute path
   (`/home/nklx/dev/personal/sourcedcs/docs/parallel/decisions.md`), so a new row reaches them
   without a rebase.
3. `docs/parallel/wave1/L1.md` … `L11.md`: the wave-1 briefings. Each ends with a supervisor addendum
   that points back at `decisions.md`.

## State (2026-09-30, end of wave 1)

- **Integration branch:** `efsp-wp5-correlation` @ `cfcf344`. **Nothing merged yet: waits for the human's go-ahead.**
- **Wave 1 is finished.** Every lane is committed on its branch, in worktree `/home/nklx/dev/personal/sourcedcs-L<n>` (S-W1):

  | Lane | Branch @ head | Notes |
  |---|---|---|
  | L1 | `lane/L1-field-state` @ `9db3fc3` | ADR 0061 (H8 read); S-L1a–d, S-R2-1 |
  | L2 | `lane/L2-mtr` @ `21111a3` | ADR 0062 (H8); mockup approved H51; S-L2b |
  | L3 | `lane/L3-ato-parser` @ `9b08805` | ADR 0063; S-L3 |
  | L4 | `lane/L4-carrier-model` @ `07ecfd5` | ADR 0064 (H8); S-L4 |
  | L5 | `lane/L5-metrics` @ `21e54e6` | ADR 0065; S-L5 |
  | L6 | `lane/L6-soak` @ `de6db8b` | soak FAILs as expected; S-L6 |
  | L7 | `lane/L7-obligations` @ `fbd154e` | ADR 0067; S-L7 |
  | L8 | `lane/L8-test-debt` @ `3f252e7` | B1–B7 as todo tests; S-L8 |
  | L9 | `lane/L9-sd-inventory` @ `74dcf4d` | report only; S-L9 |
  | L10 | `lane/L10-iff` @ `b23bdc0` | ADR 0066 (H8), colour table in wip; desk L10-W1 |
  | L11 | `lane/L11-atobrief-usmtf` @ `6057bf1` | ADR 0078; S-L11 |
  | LG | `lane/LG-grpc-stream` @ `48a0014` | gRPC poll_rate 0 loop; needs a live 10-min DCS check (`docs/wip/LG.md`) |

- **Dry-run integration passed (S-DRY1):** merge order L1, L2, L3, L4, L7, L5, L8, L9, L10, L11, LG (+ L6, which is tools-only and conflict-free). The one conflict and its resolution are in S-DRY1. crc-sync 1565 pass / 8 todo, crc-desktop 517, atobrief 77. The scratch worktree is `/home/nklx/.claude/jobs/142e4342/tmp/integ` (detached; remove with `git worktree remove`).
- **At merge:** H8 ADRs to the human first; full Playwright suite; fold `docs/wip/*.md` into the guide and briefing; wire `ATOBRIEF_USMTF_TOKEN` (L11 wip); L6's npm scripts; `.env.example` gains `DCS_GRPC_POLL_RATE`/`DCS_GRPC_MAX_BACKOFF` (LG); apply the L10-W1 answer (a one-line `DEFAULT_CAPS` flip).
- **Between waves, supervisor fixes:** F2 magnetic module (S-R2-12, variation source per desk R2-11), F3 mission-session module (S-R2-2), F4 typed time Blocks via `zulu-time.js` (S-R2-17).
- **Wave 2 briefings are drafted** in `docs/parallel/wave2/`: L1b, L12, L13, L14, L15, L16, L23. **Still to write:** L24 (H36 archiving + L6 F3/F4), L26 (audit completeness, S-L5 + F12), L27 (Board sync correctness, S-L6; before L23 on `board-store.js`/`efsp-ws.js`). L22 (STARS) waits for L10 and L1b and starts with a mockup (H49). L25 (miztoyaml H43 fields) can run any time after L11.
- **Merge order in wave 2:** L16 before L14 (S-W2B), L27 before L23.
- **The local crc-sync on :3000 was killed** by L11's `pkill` (P7). The supervisor's restart was blocked by the permission classifier; the human restarts it.

## The Decision Desk (how questions reach the human)

- Page: https://claude.ai/artifact/A3gizEgbwfqCnnU831G4Y7. The source is
  `docs/parallel/decision-desk.html`. Republish from that file with `url` set to the link above;
  read the artifact first.
- Capabilities: `db` with rule `{path:"questions", read:"view", write:"admin"}`, plus `user`.
- The `questions` collection is written by you. Fields:
  - identity and grouping: `lane`, `laneName`, `title`, `round`, `order`;
  - content: `context`, `question`, `options[{key,label,description}]`;
  - recommendation: `recommended`, `recommendNote`;
  - state: `blocking`, `status` (`open` | `settled` | `withdrawn`), `resolution`.
- The `answers` collection is written by the human and keyed by question id:
  `{choice, note, updatedAt}`. `choice` may be null when only a note is given.
- The loop:
  1. List `answers` via ArtifactData.
  2. For each new answer, log an `H<n>` row in `decisions.md`.
  3. Update the question to `status:'settled'` with a one-line `resolution`. Updates to existing
     docs need `if_version`; read the doc first.
- Put new questions from the lanes or the questioner here, with options and a recommendation.
  Rule on anything that isn't genuinely the human's call yourself (P2), and log it.

### Open on the desk now (none blocking)

L1-W1, L10-W1, L11-8 (re-asked with `research/usmtf-control-agency.md`), L3-W1, R2-9, R2-11, R2-16,
L9-E1/E2/E3/E4/E7/E8, L1b-Q1, L12-Q2, L13-Q2, L23-Q6, L23-Q7, Q-L14-1, Q-L14-2, Q-L15-1, Q-L16-5.

## Things waiting on a lane or a later wave

- **L2 mockup gate (H10):** L2 makes a Strip mockup, and you publish it as an artifact for the human.
  L2 continues with server work only until the human approves.
- **ATC scope:**
  - Approved as variant B of `docs/parallel/research/stars-mockups.html`
    (https://claude.ai/artifact/WX2iTcgENzLETakrdXLfDq), recorded as H41.
  - Built by **L22**, after L10 and L1b, **starting with a mockup for approval (H49)**; the later ERAM lane too. It includes a per-user "ATC map background" toggle for the
    strict look.
  - ERAM for CTR is a later lane.
- **Coalitions:** one crc-sync server per coalition (H42); L21 is dropped.
- **L11 is bigger than its main briefing says:** H43 puts Appendix A (every missing ATO field) in scope.
- **Bugs for later lanes:**
  - **L8:**
    - B1: a transfer to JTAC strands the Strip.
    - B2: TOFI exit is blocked while the AIC holds the line.
    - B3: a covering reassign doesn't move the Bay.
    - B4: a transfer lands in another Position's Bay.
    - B5: the JTAC may bind or declare MARSA. H40 says the JTAC sees only Strips handed to it.
  - **L1:**
    - SetState bypasses runway suspension.
    - NLA always queues to `rwy-05`.
  - **L6 / wave 2:**
    - Order keys grow without rebalancing.
    - DROPPED Strips and FDRs are never evicted. The fix is scheduled by H36.
  - **Questioner Q43:** typed time Blocks store strings where epoch ms is expected. Any HHMM editor
    must resolve against the mission clock's date (`missionNow()`), never the wall date (F1 note).
- **F1 follow-ups:**
  - Check the theater offsets for Normandy (0), TheChannel (+2) and SinaiMap (+2) in the mission
    editor. They sit in `crc-sync/config/theaters.json`.
  - Magnetic variation (H15) is to be added to that same per-theater table.
- **Pre-existing, not caused by F1:** crc-sync logs `[grpc] unit stream ended, reconnecting` in a
  tight loop, about 5,000 times per session. It is worth a look outside the lanes.

## Rules you must keep

- **Never commit without the human's go-ahead.** Lanes commit on their own branches only. You merge
  in plan §3 order, but only when the human says so.
- **ADRs are never edited once committed** (P4). Corrections go in new ADRs.
- **Tuning files are read once at startup and never written by code** (P5).
- No backwards compatibility (alpha). The wire carries only what sensors know (ADR 0059).
- Declutter behaviours stay off until the end of the EFSP work (H6).

## Update (2026-09-30, after the wave-1 merge)

- **Wave 1 is merged** into `efsp-wp5-correlation` (merges up to `3b27390`, then `8feeca0` = H53 + H70, ADR 0084). crc-sync 1565 pass / 8 todo, crc-desktop 517, atobrief 77. Not pushed.
- The full Playwright run (`E2E_LANE=9`) was started just before the session paused, and its result wasn't seen: **re-run it.**
- **Restart the local crc-sync on :3000.** `crc-sync/src` changed with the merge.
- Desk answers H51b–H70 are logged and settled. L11-8 is still open.
- A drafter was writing `docs/parallel/wave2/L24.md`, `L26.md` and `L27.md` (ADRs 0081–0083). Check whether they exist; they're uncommitted.
- Next steps: integrator doc fold (`docs/wip/*.md`), F2 (WMM + theaters.json incl. Syria TA 10,000 ft, H62/H69), F3, F4, then dispatch wave 2 (L1b, L12–L16, L23, L24, L26, L27, L28, L25; L22 mockup first). The lane worktrees `../sourcedcs-L*` can be removed.

## Update (2026-09-30 ~12:00)

- **Merged into `efsp-wp5-correlation`** (not pushed): wave 1, H53/H70, F4, L25, the DOC fold, F3, F2, plus small fixes. crc-sync 1601 pass / 8 todo; two timing tests flake under heavy load (`ato tokenize: pathological inputs`, `grpc backoff reset`) and pass alone. crc-desktop 525. atobrief 77. python 360.
- **Running lanes** (worktree `../sourcedcs-<id>`; agent ids in `/home/nklx/.claude/jobs/142e4342/tmp/agents.txt`): L1b, L13, L14, L15, L16, L22 (build; approved H71), L24, L27, E2E (Playwright triage: 90/98 on the last full run), and F2's follow-up (conformance grid→magnetic, S-F2).
- **Done, awaiting merge:** L12 (`c0887fe`; merge after L27 and L1b; fix the F3 argument `missionKey`→`missionSession` in its ordnance scenario sortie 3 at merge).
- **Not started:** L23 (after L27), L26 (after L23), L28 (last; H74/H75 answered).
- **Merge order:** L27 → L1b → L12 → L13 → L16 → L14 → L15 → L23 → L26 → L24 → L28; L22 whenever it's ready.
- **Safety net (P8):** `tools/checkpoint-worktrees.sh` snapshots every worktree into `refs/checkpoints/<branch>`. Restore with `git checkout refs/checkpoints/lane/<name> -- .` inside the worktree. The 10-minute loop dies with the session; re-start it.
- **To resume a lane after a session loss:** its worktree and commits survive. Re-launch an agent with its briefing + lane-rules + "continue from your branch and `docs/wip/<LANE>.md`".
- **Desk open:** F2-W1 (wind true vs magnetic), L11-8. **The human restarts crc-sync on :3000** after merges touching `crc-sync/src` (the supervisor's restarts are blocked).

## Update (2026-09-30, ~90% session usage)

- **Merged since the last update:** F2 + its follow-up (S-F2, S-F2b, H76), L22 (ADR 0088). crc-sync 1621 pass / 8 todo, crc-desktop 547.
- **Done, unmerged, in merge order:** L27 (running) → L1b (running) → **L12** `c0887fe` → **L13** `6566dff` → **L16** `92d2a51` → **L14** `6fde891` → **L15** `e2a4ea8` → (L23) → (L26) → **L24** `14e0c1f` → (L28). Merge notes: S-L12 (F3 argument in the ordnance scenario), S-L13 (`pads:` line), S-L14 (keep both `_stripRenderSignature` lines), S-L16.
- **Still running:** L27 (5 commits; also has persist cost + `delta.gone`, S-L24), L1b (6 commits), E2E triage (0 commits, 8 dirty files: check `refs/checkpoints/lane/E2E-triage`).
- **Not started (new session, per the memory note: Sonnet 5.5 for code, Opus for design):** L23 (after L27; + S-L13 OPS-writes-14E, F10, B1–B7), L26 (after L23; + SetBlock id/value in the log, the cancelled-scramble count), L28 (last; H74/H75), a UI follow-up lane (S-L15, S-L16 W2/W3/W5, vul validation), wave 3 (L17/L18/L19), wave 4 (L20).
- **Human:** restart crc-sync after merges; the live wind check (S-F2b); the live `mission_start` check (S-F3); the LG 10-minute live check; the 4-hour soak workflow; desk L11-8b.

## Human-reported issues after the wave-2 merges (2026-09-30) — for the UI follow-up lane unless noted

- **U1** OPS has no ORDNANCE (`3G`) field; OPS must be able to set CLEAN / HUNG. (Extends H55/S-L12: add OPS to who records HUNG.)
- **U2** A HANDOFF proposal to CTR does not trigger the "new Strip" arrival notification at CTR (check L8/B4-adjacent transfer paths and the client's new-Strip announcement from cb96223).
- **U3** The `IFR` field is unclear to the human. It is TOFI's `ifrActive` (guide §4.6.3: whether a flight under tactical control stays IFR, i.e. ATC keeps separation). Needs a clearer label/tooltip, or a question on the desk whether it belongs on the face at all.
- **U4** TYPE cannot be edited.
- **U5** A RELEASED field is missing on DEP/APP and CTR Strips.
- **U6** ALT doesn't accept block altitudes (e.g. `FL220-FL240`, `FL220B240`), which are common in military flying. Touches `parseAltitudeFt`, the ALT/HDG conformance of ADR 0058 (a block is conformant anywhere inside it), and STCA.
- **U7 (bug, high: a stuck Strip)** The same for HANDOFF and POINT_OUT (every cross-Facility coordination primitive). E.g. a POINT_OUT from DEP to CTR: CTR accepts, then CTR drops its (replica/peer) Strip. DEP's Strip is left with an ACTIVE point-out it can't advance or clear, and CTR no longer has a Strip, so nobody can act on it. Fix: dropping or vacating the receiver's side of an ACTIVE point-out must end the coordination on the proposer's Strip (return it to no coordination, audited), and DEP must always have a way to cancel or close its own point-out. Add scenario tests for both HANDOFF and POINT_OUT (propose → accept → receiver drops → proposer can still act; and propose → receiver drops before answering). Likely in `coordination.js` / board-store's drop path. Owner: L23 (it holds the coordination/permission area) or the UI follow-up lane if L23 is already full.
- **U8 (UI gap)** CTR's "TOFI Exit…" exists only inside the Strip's ⋯ menu (`strip-view.js:564`, enabled while TOFI is ACTIVE, `bay-view.js:1699`). Nothing surfaces it when the mission line goes OFF_STATION/RTB, so CTR sees no obvious exit button. Fix: when the paired mission Strip is OFF_STATION or RTB, CTR's Strip shows TOFI Exit as its primary (NLA-slot) action, or a quiet indicator + one-click button, without colour unless something is wrong (ADR 0056/0058). Needs the mission Strip's state visible to CTR's client (it already receives every Strip). Also check B2 (L23): EXIT can't be accepted while AIC holds the line. Owner: the UI follow-up lane (client), with L23 for B2.

## State at the end of the session (2026-09-30)

- `efsp-wp5-correlation` holds wave 1 plus F2/F3/F4, L22, L25, L1b, L12, L13, L16, L14, L15, L27 and L24. crc-sync 1795 pass / 8 todo; crc-desktop 707. Not pushed. (The "U1–U8" commits are handoff notes, not fixes.)
- **Playwright on the merged branch (S-M-e2e9 in decisions.md): 13 consistent failures**, first job of the next session:
  - stale tests: L12's field-state stand-in, L13's placeholder wording, L16's opt-in env;
  - cross-spec state leak: no field-state reset between spec files (a suspended 05/23 leaks into l4-chain/l4-drag);
  - a duplicate reason line once field-state, ordnance and scramble coexist;
  - L14 Mode 1/2 in the expanded view;
  - l4-badges height (30 > 28 px);
  - 4 l5-arrivals assertions.
  The E2E triage lane (`lane/E2E-triage`, worktree `sourcedcs-E2E`) was cut before wave 2 and may still be running. Merge its test hardening only if it's still relevant.
- **Next session** (Sonnet 5.5 for code, Opus for design): E2E fixes, then L23 (+U7, B1–B7, F10, S-L13), L26, L28, the UI follow-up lane (U1–U6, U8, S-L15, S-L16, S-L1b findings), then waves 3–4.
- **E2E triage merged:** `seedStrip` now waits for the correlation redraw (the main race). Wave-1-era failures were flaky/ENV. **Open for the next session:** `index.html` loads dockview-core (jsdelivr) and maplibre-gl (unpkg) from CDNs; vendor them or serve them from node_modules in the harness (`page.route`), otherwise CDN hiccups keep producing ENV failures. The 13 consistent post-wave-2 failures above are separate and still open.
