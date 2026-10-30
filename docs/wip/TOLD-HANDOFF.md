# TOLD: handoff (2026-10-30, after step 1 plan 1)

Work in the worktree `/home/nklx/dev/personal/sourcedcs-perf` (branch `perf-told`). Never switch the branch of the
main checkout `/home/nklx/dev/personal/sourcedcs` (a crc session works there on `main`).

## State

- **Step 0 (Foundations)** is merged into `main` (PR #146).
- **Step 1 plan 1 (data and figure functions) is done** on `perf-told`. Figures B2-4, B2-5 sheets 1 to 3, B2-6
  sheets 1 to 3, B7-1 and B7-2 sheets 1 and 2 are extracted. Each has a figure function in `perf/src/core/figures/`:
  `b2-4.ts`, `refusal-speed.ts`, `b2-5.ts`, `b2-6.ts`, `b7-1.ts` and `b7-2.ts`.
  - The extractor gained an unscaled axis (the line carried from one panel into the next), a `limit_line` panel type
    and the opt-in keys of rulings P1 and P3 to P6. Step 0's data stayed byte-identical.
- **Gates on the tip:** 318 tests (100 % lines on `src/core/`), typecheck, lint, format, `types:check`, `data:check`
  (0 problems) and build all pass. A full re-extraction with no ids is byte-identical (`dataVersion` 7).
- **Samples and checkpoints:** every manual sample for the step 1 figures passes within 2 %. B2-4 is 128.96 against
  129, B2-6 sheet 1 152.48 against 153, B7-1 136.05 / 125.35, and B7-2 3,901.9, 3,375.1 and 8,006.1 ft. The 15
  hand-read checkpoints (B2-5 sheets 1 to 3, B2-6 sheets 2 and 3) all pass within ±2 KIAS; the largest difference
  is 0.52.
- A trial merge of the tip into `main` is clean.
- **Where things are:**
  - Spec: `docs/wip/TOLD.md`. Section 1.6 is plan 1's spec, now in line with the build; "Notes carried from plan 1"
    holds the new Limitations notes and what plan 2 needs.
  - Plan 1, with the questioner's rulings P1 to P16 and the supervisor's rulings during execution:
    `docs/wip/TOLD-STEP1-P1.md`. Page evidence: `docs/wip/TOLD-STEP1-P1-EVIDENCE.md`.
  - Step 0 plan (rulings R1 to R14, the data contract): `docs/wip/TOLD-STEP0.md`. Commands, layout, spec keys and
    checkpoints: `perf/README.md`.
- The manual PDF is at `/home/nklx/dev/other/HAF-F16-Supplement.pdf` (SHA-256 verified against the pin). Export it as
  `PERF_PDF`; Python runs inside `nix develop` from the worktree root.
- **Watch:** one full `npm test` run after the B2-4 merge showed one failure, never identified. Every full run since
  passed 318/318 (5 runs, the last 4 on the plan 1 head): not reproduced in 5 runs; keep watching.

## Waiting on the human

1. **The plan 1 PR, `perf-told` into `main`**, merged with a real merge commit (never squash or rebase), as for step
   0. The manifest's `extractorCommit` (7a0c7acc, a lane commit) and the commits the plan cites need to stay
   reachable.

Nothing else is waiting on the human.

## Decisions taken in plan 1 that the human may want to revisit

All are written into TOLD.md 1.6 or the plan (step 0's two into TOLD.md 5.2 and 1.2). These are the ones most
likely to come back:

- **P2, B7-2 sheet 2 is two RCR families (a contract change).** Dry (4, 8, 16, 23) and wet (10, 12, 18), chosen by a
  `wet: boolean` input on `groundRollCorrected`, because Part 7 interpolates them separately and one family ordered
  by RCR is monotone nowhere. Plan 2's inputs carry `wet`. An RCR outside the chosen family's curves is out of chart
  (wet below 10 or above 18, dry below 4), so a wet runway cannot borrow a dry curve.
- **P7, a limit line is judged only where it is drawn.** Outside a line's drawn range the verdict is `null`, not
  "within the limit". The manual's own sample landing (2,000 ft, 40 °C, 28,000 lb) is therefore not judged against
  either tire line. The alternative is to extend the line or count "left of the line" as inside; both are readings
  the chart does not print.
- **P9 and P11, strict drawn ranges.** Nothing is extrapolated past what the chart draws:
  - an acceleration check speed under 60 KIAS with a drag index (B2-4's DI panel starts at 60 kt);
  - takeoff factors outside B2-4 [1.09, 6.00], B2-5 2.10 to 6.78 and B2-6 1.20 to 3.86;
  - a refusal entry outside the drawn wind or slope lines (B2-6 sheet 3 needs about 80 KIAS for a 20 kt tailwind).

  Each gives "—" with a reason line, and each is a Limitations note.
- **Step 0: conservative value = the pilot's per-point rounding** (TOLD.md 5.2, ADR 0149), decided by the supervisor
  after the step 0 Task 4 review, not the maximum over every combination; the human was told and may reverse it.
- **Step 0: R11, a B2-3 roll under 1,000 ft** is out of chart at the next guideline panel that moves it (TOLD.md 1.2,
  "Notes carried from step 0"; `docs/wip/TOLD-STEP0.md` R11).
- **Checkpoints live in their own files** (`perf/extraction/checkpoints/<spec id>.yaml`), not in the spec YAML as 1.6
  first said. This keeps the lane that writes a spec from editing the hand readings. TOLD.md 1.6 now says so.

## Next

**Step 1 plan 2: core.** It covers the chains for takeoff and landing (MIL and MAX AB; normal landing weight and
heavyweight; dry and wet), the runway rules with their paragraphs, the drag index builder on the B1-1 data, and input
parsing (pressure altitude, slope, wind, `wet`). TOLD.md 1.2 items 2 and 3, 1.3, 1.4, 5.2 and 5.3 hold the design.
"Notes carried from step 0" and "Notes carried from plan 1" list what the earlier work left for it: id prefixes for a
figure called twice, refusal speed interpolation by RCR, `limits` null semantics, the conservative limit verdicts
`evaluate` does not surface yet, `OutOfChart` values in chart units, quantity names and units that differ across
figures, the deferred minors and the open output-edge tolerance question.

Run plan 2 as plan 1 ran: `superpowers:brainstorming` on what TOLD.md leaves open (the RCR interpolation rule and its
ranges, how a chain prefixes ids, what the figure view needs from a chain), then a spec section in TOLD.md, then
`superpowers:writing-plans` into `docs/wip/TOLD-STEP1-P2.md`. Plans 3 (UI and state) and 4 (deployment, which waits on
the domain and certificate) follow. The infra commit (`PERF_DOMAIN`, compose, nginx, `deploy.yml`) stays its own final
commit until the human has the domain and certificate.

How plan 1 ran, for reuse: one lane worktree per task (`../sourcedcs-told-p1-t<N>` on `lane/told-p1-t<N>` off
`perf-told`), at most 4 agents at once including a questioner, all on Opus, and a task review after each lane. The
supervisor ran the gates (`nice -n 19`), merged, and resolved manifest conflicts by the procedure in the plan's
supervisor rulings. The other plan 1 lane worktrees and branches are removed; the close-out lane
(`../sourcedcs-told-p1-t7`) goes once it is merged into `perf-told`. The session ledger and task reports are uncommitted
scratch; what matters from them is copied into the plan, its evidence file and TOLD.md.
