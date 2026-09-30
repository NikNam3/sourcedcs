# Supervisor handoff

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
