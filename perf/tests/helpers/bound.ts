/**
 * The tests' bound on the gap between `evaluate`'s conservative value and the exhaustive oracle (spec 5.2): the sum
 * over the exact pass's rounding points of each point's own one-step effect on the output. It is the tests'
 * criterion, not a proven bound for branching chains.
 */
import assert from 'node:assert/strict';

import { roundTo } from '../../src/core/ctx.ts';
import type { Chain, Ctx } from '../../src/core/ctx.ts';

/** A Ctx that rounds the ids in `plan` their way and reads every other id exact. */
export function planCtx(plan: ReadonlyMap<string, 'down' | 'up'>): Ctx {
  return {
    read(id, value, step) {
      const dir = plan.get(id);
      return dir === undefined ? value : roundTo(value, step, dir);
    },
  };
}

/**
 * The sum over `ids` (the exact pass's rounding points) of |o(p up) - o(p down)| for output `key`, every other point
 * exact. Fails the test when a single-point run of `key` is out of chart.
 */
export function singlePointBound<K extends string>(chain: Chain<K>, key: K, ids: readonly string[]): number {
  let bound = 0;
  for (const id of ids) {
    const down = chain(planCtx(new Map([[id, 'down']])))[key];
    const up = chain(planCtx(new Map([[id, 'up']])))[key];
    assert.ok(down.ok && up.ok, `single-point run of ${id} out of chart for ${key}`);
    bound += Math.abs(up.value - down.value);
  }
  return bound;
}
