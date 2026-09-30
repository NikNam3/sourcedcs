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
- **U7 (bug, high: a stuck Strip)** A POINT_OUT from DEP to CTR: CTR accepts, then CTR drops its (replica/peer) Strip. DEP's Strip is left with an ACTIVE point-out it can't advance or clear, and CTR no longer has a Strip, so nobody can act on it. Fix: dropping or vacating the receiver's side of an ACTIVE point-out must end the coordination on the proposer's Strip (return it to no coordination, audited), and DEP must always have a way to cancel or close its own point-out. Add a scenario test (propose → accept → receiver drops → proposer advances). Likely in `coordination.js` / board-store's drop path. Owner: L23 (it holds the coordination/permission area) or the UI follow-up lane if L23 is already full.
