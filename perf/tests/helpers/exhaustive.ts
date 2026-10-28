/**
 * The exhaustive conservative search, a test oracle only: never imported by src/. It tries every combination of
 * down and up over the reads each run makes (2^n runs), so a test can check the single-point test of `evaluate`
 * against it. Same signature and result shape as `evaluate`.
 */

import { roundTo, runExact, WORSE } from '../../src/core/ctx.ts';
import type { Cell, Chain, Ctx, Evaluation, OutputKind } from '../../src/core/ctx.ts';
import { ok } from '../../src/core/result.ts';
import type { Read } from '../../src/core/result.ts';

type Direction = 'down' | 'up';

export function evaluateExhaustive<K extends string>(
  chain: Chain<K>,
  kinds: Readonly<Record<K, OutputKind>>,
): Evaluation<K> {
  const keys = Object.keys(kinds) as K[];
  const exact = runExact(chain);

  // Backtracking: each prefix fixes the first reads' directions; a read past the prefix goes down, and every such
  // read off its step pushes the same choices with that read up.
  const results: Readonly<Record<K, Read<number>>>[] = [];
  const stack: Direction[][] = [[]];
  for (let prefix = stack.pop(); prefix !== undefined; prefix = stack.pop()) {
    const fixed = prefix;
    const choices: Direction[] = [];
    const offStep: boolean[] = [];
    const seen = new Set<string>();
    const ctx: Ctx = {
      read(id, value, step) {
        if (seen.has(id)) throw new Error(`chain defect: rounding point '${id}' read twice in one run`);
        seen.add(id);
        const dir = fixed[choices.length] ?? 'down';
        choices.push(dir);
        offStep.push(roundTo(value, step, 'down') !== roundTo(value, step, 'up'));
        return roundTo(value, step, dir);
      },
    };
    results.push(chain(ctx));
    for (let j = fixed.length; j < choices.length; j++) {
      if (offStep[j] === true) stack.push([...choices.slice(0, j), 'up']);
    }
  }

  const cells = {} as Record<K, Cell>;
  for (const k of keys) {
    const worse = WORSE[kinds[k]];
    const exactRead = exact.outputs[k];
    if (!exactRead.ok) {
      cells[k] = { exact: exactRead, conservative: exactRead };
      continue;
    }
    const reads = results.map((outputs) => outputs[k]);
    const error = reads.find((read) => !read.ok);
    let worst: number | undefined;
    for (const read of reads) {
      if (!read.ok) continue;
      if (worst === undefined || (worse === 'higher' ? read.value > worst : read.value < worst)) worst = read.value;
    }
    cells[k] = { exact: exactRead, conservative: error ?? ok(worst ?? exactRead.value) };
  }

  const roundingPoints = exact.trace.map((t) => t.id);
  return { cells, trace: exact.trace, roundingPoints, runs: results.length };
}
