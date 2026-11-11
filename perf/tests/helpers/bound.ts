/**
 * The tests' bound on the gap between `evaluate`'s conservative value and the exhaustive oracle (spec 5.2): the sum
 * over the exact pass's rounding points of each point's own one-step effect on the output. It is the tests'
 * criterion, not a proven bound for branching chains.
 */
import assert from 'node:assert/strict';

import { roundTo } from '../../src/core/ctx.ts';
import type { Chain, Ctx } from '../../src/core/ctx.ts';

/**
 * A Ctx that rounds the ids in `plan` their way and reads every other id unrounded, as a conservative run does: an
 * input starts from its conservative value.
 */
export function planCtx(plan: ReadonlyMap<string, 'down' | 'up'>): Ctx {
  const round = (id: string, value: number, step: number): number => {
    const dir = plan.get(id);
    return dir === undefined ? value : roundTo(value, step, dir);
  };
  return {
    read: round,
    input: (id, value, step) => round(id, value.conservative, step),
  };
}

/**
 * The sum over `ids` (the exact pass's rounding points) of |o(p up) - o(p down)| for output `key`, every other point
 * unrounded. Fails the test when a single-point run of `key` is out of chart.
 */
export function singlePointBound<K extends string, S>(chain: Chain<K, S>, key: K, ids: readonly string[]): number {
  let bound = 0;
  for (const id of ids) {
    const down = chain(planCtx(new Map([[id, 'down']]))).outputs[key];
    const up = chain(planCtx(new Map([[id, 'up']]))).outputs[key];
    assert.ok(down.ok && up.ok, `single-point run of ${id} out of chart for ${key}`);
    bound += Math.abs(up.value - down.value);
  }
  return bound;
}
