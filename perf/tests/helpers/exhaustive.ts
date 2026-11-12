/**
 * The exhaustive conservative search, a test oracle only: never imported by src/. It tries every combination of
 * down and up over the reads each run makes (2^n runs), so a test can check the single-point test of `evaluate`
 * against it. Same signature and result shape as `evaluate`; a cell's conservative side is the deciding combination's.
 */

import { roundTo, runExact, WORSE } from '../../src/core/ctx.ts';
import type { Cell, Chain, ChainRun, Ctx, Evaluation, OutputKind } from '../../src/core/ctx.ts';
import { planCtx } from './bound.ts';

type Direction = 'down' | 'up';

export function evaluateExhaustive<K extends string, S>(
  chain: Chain<K, S>,
  kinds: Readonly<Record<K, OutputKind>>,
): Evaluation<K, S> {
  const keys = Object.keys(kinds) as K[];
  const exact = runExact(chain);

  // Backtracking: each prefix fixes the first reads' directions; a read past the prefix goes down, and every such
  // read off its step pushes the same choices with that read up. Every combination starts each input from its
  // conservative value, as every conservative run of `evaluate` does.
  const results: ChainRun<K, S>[] = [];
  const stack: Direction[][] = [[]];
  for (let prefix = stack.pop(); prefix !== undefined; prefix = stack.pop()) {
    const fixed = prefix;
    const choices: Direction[] = [];
    const offStep: boolean[] = [];
    const seen = new Set<string>();
    const point = (id: string, value: number, step: number, checked: readonly number[]): number => {
      if (seen.has(id)) throw new Error(`chain defect: rounding point '${id}' read twice in one run`);
      if (!Number.isFinite(step) || step <= 0)
        throw new Error(`chain defect: rounding point '${id}' has step ${String(step)}`);
      const bad = checked.find((v) => !Number.isFinite(v));
      if (bad !== undefined) throw new Error(`chain defect: rounding point '${id}' read ${String(bad)}`);
      seen.add(id);
      const dir = fixed[choices.length] ?? 'down';
      choices.push(dir);
      offStep.push(roundTo(value, step, 'down') !== roundTo(value, step, 'up'));
      return roundTo(value, step, dir);
    };
    const ctx: Ctx = {
      read: (id, value, step) => point(id, value, step, [value]),
      input: (id, value, step) => point(id, value.conservative, step, [value.exact, value.conservative]),
    };
    results.push(chain(ctx));
    for (let j = fixed.length; j < choices.length; j++) {
      if (offStep[j] === true) stack.push([...choices.slice(0, j), 'up']);
    }
  }

  // The baseline: every input at its conservative value, nothing rounded.
  const baseline = chain(planCtx(new Map()));

  const cells = {} as Record<K, Cell<S>>;
  for (const k of keys) {
    const worse = WORSE[kinds[k]];
    const exactRead = exact.run.outputs[k];
    const exactSide = exact.run.side;
    // An exact error rejects the whole cell only when the baseline errors too (Q1, as `evaluate`).
    if (!exactRead.ok && !baseline.outputs[k].ok) {
      cells[k] = { exact: exactRead, conservative: exactRead, exactSide, conservativeSide: exactSide };
      continue;
    }
    // The first combination that errored, else the worst (the first of equal ones).
    let decided: ChainRun<K, S> | undefined = results.find((run) => !run.outputs[k].ok);
    if (decided === undefined) {
      for (const run of results) {
        const read = run.outputs[k];
        const best = decided?.outputs[k];
        if (!read.ok || best?.ok === false) continue;
        if (best === undefined || (worse === 'higher' ? read.value > best.value : read.value < best.value)) {
          decided = run;
        }
      }
    }
    if (decided === undefined) throw new Error('unreachable: at least one combination is run');
    cells[k] = { exact: exactRead, conservative: decided.outputs[k], exactSide, conservativeSide: decided.side };
  }

  const roundingPoints = exact.trace.map((t) => t.id);
  return { cells, trace: exact.trace, roundingPoints, runs: results.length };
}
