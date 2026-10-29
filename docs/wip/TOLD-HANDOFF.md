# TOLD: handoff (2026-10-29, after step 0)

Work in the worktree `/home/nklx/dev/personal/sourcedcs-perf` (branch `perf-told`). Never switch the branch of the
main checkout `/home/nklx/dev/personal/sourcedcs` (a crc session works there on `main`).

## State

- **Step 0 (Foundations) is done** on `perf-told`, pushed and open as a PR into `main`. Gates on the tip:
  184 tests (100 % lines on `src/core/`), typecheck, lint, format, `types:check`, `data:check` (0 problems), build.
  A full re-extraction is byte-identical. The manual's 13 sample answers for B2-1 to B2-3 pass within 2 % (largest
  0.77 %). A trial merge into `main` was clean; `main` has no ADR above 0147 (perf claims 0148–0153).
- Spec: `docs/wip/TOLD.md`. Step 0 plan, with its rulings R1–R14 and the data contract: `docs/wip/TOLD-STEP0.md`.
  The questioner's page evidence: `docs/wip/TOLD-STEP0-EVIDENCE.md`. Commands and layout: `perf/README.md`.
- The manual PDF is at `/home/nklx/dev/other/HAF-F16-Supplement.pdf` (SHA-256 verified against the pin). Export it as
  `PERF_PDF`. Python runs inside `nix develop` from the worktree root.

## Answered by the human (2026-10-29)

1. **Landing:** `perf-told` lands in `main` through a GitHub PR, merged with a real merge commit (never squash or
   rebase): the manifest's `extractorCommit` and the comments naming the prototype's removal commit need those
   commits reachable.
2. **B1-1 comparison (Task 8 step 5):** the human compared `perf/extraction/out/B1-1-tables.txt` with printed pages
   B1-6 to B1-12 and found it correct. No change to the spec or the data.

## Decisions taken in step 0 that the human may want to revisit

All are written into TOLD.md or the plan; the two most likely to come back:

- **Conservative value = the pilot's per-point rounding** (TOLD.md 5.2, ADR 0149). Each reading is tested rounded down
  and up, the worse direction kept per output, then one final run. The exhaustive all-combinations maximum is only a
  test oracle: equal where every reading is monotone or readings do not feed each other (B2-3 is pinned equal),
  otherwise within the sum of single-point effects. Decided by the supervisor after the Task 4 review; the human was
  told and may reverse it.
- **R11, under 1,000 ft:** a B2-3 roll under 1,000 ft is out of chart at the next guideline panel that moves it (the
  lowest guideline starts at 1,000 ft); with CG 35, DI 0, no slope and no wind it is returned as drawn.

## Next

Step 1 (TOLD, the MVP). Its design is already in TOLD.md (step 1, "Decisions of 28 Oct 2026", and "Notes carried from
step 0", which lists what step 0 left for it). Per TOLD.md 10.3, step 1 starts with the mockup: update the approved
boards (`docs/mockups/perf-*.html`) for anything step 0 changed (the grey reason line, a non-colour print cue for red,
the dotted underline), get approval, then `superpowers:writing-plans` for step 1. The infra commit (`PERF_DOMAIN`,
compose, nginx, `deploy.yml`) stays its own final commit until the human has the domain and certificate
(rollout order in TOLD.md "Deployment and operations").

How step 0 ran, for reuse: one lane worktree per task (`../sourcedcs-told-t<N>` on `lane/told-t<N>` off `perf-told`),
at most 4 agents at once including a questioner, all on Opus, a task review after each lane, the supervisor running
the gates (`nice -n 19`) and merging. All lane worktrees and branches are removed. An untracked `perf-handoff.zip` in
the main checkout root is the old planning handoff; its contents are committed, so it can go once the human agrees.
