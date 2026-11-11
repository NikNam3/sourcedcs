/**
 * Chains without side data, for the tests: a figure function or a synthetic chain that returns only its outputs is
 * wrapped into the `{ outputs, side: null }` shape `evaluate` and `runExact` take.
 */
import { runExact } from '../../src/core/ctx.ts';
import type { Chain, Ctx, Evaluation } from '../../src/core/ctx.ts';
import type { Read } from '../../src/core/result.ts';

type Outputs<K extends string> = (ctx: Ctx) => Readonly<Record<K, Read<number>>>;

/** The chain whose outputs `outputs` computes, with no side data. */
export function plain<K extends string>(outputs: Outputs<K>): Chain<K> {
  return (ctx) => ({ outputs: outputs(ctx), side: null });
}

/** The exact pass of a chain without side data: its outputs and trace. */
export function exactOf<K extends string>(
  outputs: Outputs<K>,
): { outputs: Readonly<Record<K, Read<number>>>; trace: Evaluation<K>['trace'] } {
  const { run, trace } = runExact(plain(outputs));
  return { outputs: run.outputs, trace };
}
