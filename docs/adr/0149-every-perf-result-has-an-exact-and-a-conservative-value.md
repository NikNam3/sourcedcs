# 0149: Every perf result has an exact and a conservative value

**Status.** Accepted (TOLD step 0 design review, 2026-10-28; the single-point test chosen by the human that day). The per-point
definition of the conservative value (Decision 2) was decided by the supervisor after the Task 4 review on 29 Oct 2026; the
human was told and may reverse it. Spec: `docs/wip/TOLD.md`, "Goal and principles" 2 and
sections 5.1 and 5.2.

## Context

A pilot reading a chart by hand rounds at every step: the input, each line followed, each intermediate value. The
calculator interpolates without rounding, so its answer can be slightly better than any hand-worked one. One number
alone hides how far that gap goes. Which way is "worse" is also not always obvious: the manual itself warns that
refusal speed can rise with gross weight at low RCR.

## Decision

1. **Two values for every result.** *Exact*: interpolated from the chart curves without rounding. *Conservative*: every
   input and every intermediate value read off a chart rounded to its step in the worse direction.
2. **One read path.** Every chart read in a figure file goes through `ctx.read(id, value, step)` (`src/core/ctx.ts`),
   where `id` names the rounding point (for example `b2-3.gw`). Inputs are rounding points like any other.
   - Exact pass: `ctx.read` returns the value unchanged and records the path points for the figure view.
   - Conservative pass, by a **single-point test**:
     1. Each rounding point is tested on its own: the chain is run once with that point rounded down to its step and
        once rounded up, every other point exact. For each output, the direction that makes it worse is that point's
        direction for that output. A value already on its step needs no test.
     2. Then one final run per output rounds every point in its own direction for that output.
     3. If the final run reads a point the single-point runs never saw (a branch inside a procedure switched, for
        example the acceleration check at 1,000 ft or 2,000 ft depending on the rounded takeoff roll), that point gets
        the same test, with the other points in their chosen directions, and the final run is repeated.
     4. The conservative value is the worst of the final run and every single-point run.

   This per-point rounding is the conservative value, by definition: each point rounded in its own worse direction,
   every later reading taken from the rounded earlier ones. It is the pilot's procedure (principle 2).
3. **The worst value per output.** One evaluation covers all outputs of a chain and keeps, per output, the worst value
   found. Two outputs sharing an intermediate (the takeoff factor feeds distance, acceleration check and refusal speed)
   may use different rounded values of it.

   | Output | Worse means |
   | --- | --- |
   | Takeoff distance, landing distance, runway used | longer |
   | Refusal speed | lower |
   | Rotation, takeoff, final approach, touchdown speed | higher |
   | Acceleration check speed | higher (a check computed too low hides a real problem) |

4. **Why not every combination.** Trying both directions at every point in every combination doubles the runs per
   rounding point (2^n). Step 1's takeoff chain has about 45 rounding points: about 3·10^13 runs. The single-point
   test takes about two runs per rounding point plus one per output, about 100 runs there, well under a millisecond.
   The exhaustive search is kept as a **test oracle only**, never in the app (human decision, 2026-10-28, after the
   exponential cost was raised). Its maximum is not the definition. It can round an earlier value the better way so
   that a later reading crosses a step and rounds up a whole step, which no pilot does.

5. **Steps.**

   | Quantity | Step |
   | --- | --- |
   | Pressure altitude | 100 ft |
   | Temperature | 1 °C |
   | Gross weight | 100 lb |
   | Drag index | 1 |
   | CG | 0.5 % MAC |
   | Wind, gust | 1 kt |
   | Slope | 0.1 % |
   | RCR | 1 |
   | Takeoff factor | 0.01 |
   | Speeds | 1 kt |
   | Distances | 10 ft |

6. **Out of chart.** If a rounding step leaves the drawn data (the exact value is inside, the step up or down is not),
   the conservative cell shows "—" with the figure and input named, and the exact cell is still shown. If the exact
   value itself is out of chart, the whole cell (exact and conservative) is rejected.
7. **Rules per cell.** The exact and the conservative cell are each checked against the AFMAN 11-2F-16V3 runway rules
   and marked red on their own, so a conservative value can be red while the exact one is not.

## Consequences

- The direction is found by test, not set by hand per quantity. Trying both directions at every point is never wrong.
- The cost is linear in the rounding points, so a longer chain (step 1's takeoff, step 3's leg chain) stays cheap.
- Tests compare the conservative value with the exhaustive oracle. Where the output is monotone in every reading
  (B2-3 included) or the readings do not feed each other, they require equality. Elsewhere they require the
  conservative value to be no better than the exact one, and within the sum over the rounding points of each point's
  own |o(up) − o(down)| of the exhaustive value. That sum is the tests' criterion. It is not proven for branching
  chains.
- A test pins the list of rounding point ids per chain, so adding or losing a read is a visible change.
- `ctx` is tested on small synthetic chains, one with a branch, so the single-point test, the branch re-test and the
  per-output worst values are tested without chart data.
- The rule is the project's own, not the manual's. The Limitations page states it.
- Some outputs have no meaningful worse direction (step 2's optimum altitude and Mach). Those are shown exact only, by
  a deliberate decision per value.
