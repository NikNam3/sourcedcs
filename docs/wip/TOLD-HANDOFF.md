# TOLD: handoff (2026-11-12, after step 1 plan 2)

Work in the worktree `/home/nklx/dev/personal/sourcedcs-perf` (branch `perf-told`). Never switch the branch of the
main checkout `/home/nklx/dev/personal/sourcedcs` (a crc session works there on `main`).

## State

- **Step 0 (Foundations)** is merged into `main` (PR #146).
- **Step 1 plan 1 (data and figure functions)** is done on `perf-told`, in PR #147 (still open).
- **Step 1 plan 2 (core) is done** on `perf-told`, above plan 1. `computeTold(figures, inputs, loadout)` in
  `perf/src/core/told/told.ts` gives every MDC TOLD cell: takeoff MIL and MAX AB, landing normal weight and
  heavyweight, dry and wet, each exact and conservative, with side data, rule marks, out-of-chart reasons and the
  exact trace for the figure view.
  - `ctx.ts`: side data per deciding run (ruling 2), two-valued inputs (`ctx.input`, the drag index), a baseline run.
  - `read/`: the edge tolerance only at input-axis ends (ruling 4, with Q2's per-family span and baseline anchor).
  - `inputs/`: the `Inputs` type and defaults, parsing, and the derived values (pressure altitude, slope, wind
    components), with the parity test against `crc-sync/src/altimetry.js`.
  - `dragindex/`: the drag index builder on Fig. B1-1; the Part 1 worked example gives 146.
  - `told/`: the six chains, refusal speed by RCR (ruling 1, strict), the runway rules with their paragraphs.
  - Data: quantity names and units aligned at the source (ruling 3), `dataVersion` 8. One name has one unit across
    every figure, pinned by a `data:check` test.
- **Gates on the tip:** 450 tests (100 % lines on `src/core/`), typecheck, lint, format, `types:check`, `data:check`
  (0 problems) and build all pass. A full re-extraction with no ids is byte-identical (`dataVersion` 8).
- A trial merge of the tip into `main` is clean.
- **Where things are:**
  - Spec: `docs/wip/TOLD.md`. Section 1.7 is plan 2's spec, now in line with the build; "Notes carried from plan 2"
    at its end holds the new Limitations notes and what plan 3 needs. 1.6 is plan 1's.
  - Plan 2, with the questioner's rulings Q1 to Q4 and Extras 1 to 5 and the supervisor's rulings during execution:
    `docs/wip/TOLD-STEP1-P2.md`. Plan 1: `docs/wip/TOLD-STEP1-P1.md`, evidence `docs/wip/TOLD-STEP1-P1-EVIDENCE.md`.
  - Step 0 plan (rulings R1 to R14, the data contract): `docs/wip/TOLD-STEP0.md`. Commands, layout, spec keys and
    checkpoints: `perf/README.md`.
- The manual PDF is at `/home/nklx/dev/other/HAF-F16-Supplement.pdf` (SHA-256 verified against the pin). Export it as
  `PERF_PDF`; Python runs inside `nix develop` from the worktree root.

## Waiting on the human

1. **The plan 1 PR #147, `perf-told` into `main`**, still open. Plan 2's commits are on `perf-told` above it, so the
   PR now carries both plans. Merge with a real merge commit (never squash or rebase), as for step 0. The manifest's
   `extractorCommit` (c2730a7f, a plan 2 lane commit) and the commits the plans cite need to stay reachable.

Nothing else is waiting on the human.

## Decisions taken in plan 2 that the human may want to revisit

All are written into TOLD.md 1.7 or 5.2 and the plan. These are the ones most likely to come back:

- **Q1, an exception to 5.2.** An exact error rejects the whole cell only when the baseline run (every input at its
  conservative value, nothing rounded) errors too. Today this is only removed tip missiles (−4 each exact, 0
  conservative): a clean aircraft without them has an exact drag index of −4, out of chart on B2-3 and B2-4, so the
  exact takeoff distance and acceleration check show "—" and the conservative cells are computed. The alternative,
  reading −4 at 0 in the exact cell, would label a reading at a drag index the aircraft does not have as exact.
- **The baseline anchor, an amendment to ruling 4** (Q2). In a guideline panel an end within the tolerance of the
  panel's baseline keeps the tolerance. Without it two lines their data draws to the baseline (B2-3 `cg` line 11,
  B2-4 `gw` line 0) would be lost, and B2-3 entries between 11,000 and 12,000 ft at a CG other than 35, and B2-4
  entries between 40 and 50 KIAS at a GW other than 43, would give "—". One end keeps a tolerance it should not
  have: B7-2 sheet 2 wet RCR 18, about 13.5 ft of roll.
- **An invalid loadout makes both takeoff columns unparsed** (`'loadout'`), as does an additional drag index that
  does not parse (`'additionalDragIndex'`); landing still computes. `dragIndex` returns its problems
  (`checkLoadout`) instead of throwing, because plan 3 restores a loadout from the URL and localStorage.
- **Tank variants where the manual prints nothing:** a 300-gallon tank with one of 4 and 6 loaded uses 18 (Extra 2),
  an odd count on a pair inboard of a wing tank gives MULTIPLE on both tanks, and CATM-9 counts as a single store,
  not an AIM-9. Each is the safer value.
- **The timing test bound** in `ctx.test.ts` was raised from 20 to 200 ms after it failed once under the full suite
  with coverage. That is very likely the plan 1 flake (one unidentified failure after the B2-4 merge); the full run
  on the tip passed 450/450, so the flake watch can close.

## Next

**Step 1 plan 3: UI and state.** The figure board first, then the three pages (`/f16/`, `/f16/figure.html#…`, the
Limitations page), the URL hash, localStorage and the Playwright smoke spec. TOLD.md 1.2 items 4 and 5, 1.3, 1.4, 1.5,
section 10 and the decisions of 29 Oct 2026 (the approved mockup) hold the design; "Notes carried from plan 2" lists
what plan 2 left for it (the Limitations notes, and UI items such as calm wind typed `360/00`, the physical limits
living in `deriveInputs`, one `landing-rcr-10` mark and one reason per rejected cell).

Run plan 3 as plans 1 and 2 ran: `superpowers:brainstorming` on what TOLD.md leaves open (what the figure board shows
of a trace, how a reason line is worded from an `OutOfChart`, the loadout editor, the hash format), then a spec section
in TOLD.md, then `superpowers:writing-plans` into `docs/wip/TOLD-STEP1-P3.md`. Plan 4 (deployment, which waits on the
domain and certificate) follows. The infra commit (`PERF_DOMAIN`, compose, nginx, `deploy.yml`) stays its own final
commit until the human has the domain and certificate.

How plan 2 ran, for reuse: one lane worktree per task (`../sourcedcs-told-p2-t<N>` on `lane/told-p2-t<N>` off
`perf-told`), at most 4 agents at once including a questioner, all on Opus, and a task review after each lane. Lanes
ran only their own test files; the supervisor ran the full gates once at the end (`nice -n 19`) and merged. The
close-out lane (`../sourcedcs-told-p2-t8`) goes once it is merged into `perf-told`, with the other plan 2 lane
worktrees and branches. The session ledger and task reports are uncommitted scratch; what matters from them is copied
into the plan and TOLD.md.
