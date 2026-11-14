/**
 * The read context (spec 5.2). Every chart read in a chain goes through `ctx.read(id, value, step)`, where `id` names
 * the rounding point. The exact pass hands every value back unchanged; the conservative value rounds every input and
 * every chart reading to its step in the direction that makes each output worse.
 *
 * The conservative search is the single-point test (decided 28 Oct 2026): each rounding point is run once rounded down
 * and once rounded up, every other point exact, and the worse of the two is that point's direction for each output.
 * Then one final run per output rounds every point its own way; a point that final run reads and no earlier run saw
 * (a branch switched) is tested the same way and the final run repeated. That is about two runs per point plus one
 * per output, never the 2^n of trying every combination (the exhaustive search is a test oracle only).
 *
 * Every conservative run starts from the conservative values: `ctx.input` gives an input with an exact and a
 * conservative value of its own (the drag index without tip missiles). The search starts from a baseline run on those
 * values with nothing rounded; its reads name the points the single-point tests try. A chain also returns side data
 * (any per-run record, such as a check distance or a limit verdict); each cell keeps the side of the run that decided
 * it (TOLD 1.7, ruling 2).
 */

import type { PathMark } from './path/mark.ts';
import type { Read } from './result.ts';

export interface Ctx {
  read(id: string, value: number, step: number): number;
  /** Exact pass: `value.exact`; every conservative run starts from `value.conservative`. */
  input(id: string, value: { readonly exact: number; readonly conservative: number }, step: number): number;
  /** A panel the path crossed (TOLD 1.8); `evaluate` and `runExact` ignore it, `tracePaths` records it. */
  mark(m: PathMark): void;
}

export type OutputKind = 'distance' | 'speed' | 'refusalSpeed' | 'accelCheckSpeed';

/** Which way is worse per output kind: a distance computed too short or a refusal speed computed too high is unsafe. */
export const WORSE: Readonly<Record<OutputKind, 'higher' | 'lower'>> = Object.freeze({
  distance: 'higher',
  speed: 'higher',
  refusalSpeed: 'lower',
  accelCheckSpeed: 'higher',
});

/** The rounding step of each quantity (spec 5.2, steps table). */
export const STEPS = Object.freeze({
  pressureAltitudeFt: 100,
  temperatureC: 1,
  grossWeightLb: 100,
  dragIndex: 1,
  cgPct: 0.5,
  windKt: 1,
  slopePct: 0.1,
  rcr: 1,
  takeoffFactor: 0.01,
  speedKt: 1,
  distanceFt: 10,
} as const);

export interface ChainRun<K extends string, S> {
  readonly outputs: Readonly<Record<K, Read<number>>>;
  readonly side: S;
}

export type Chain<K extends string, S = null> = (ctx: Ctx) => ChainRun<K, S>;

export interface Cell<S = null> {
  readonly exact: Read<number>;
  readonly conservative: Read<number>;
  readonly exactSide: S;
  /** The side of the run that decided `conservative` (the worst run, or the first that errored). */
  readonly conservativeSide: S;
}

export interface Evaluation<K extends string, S = null> {
  readonly cells: Readonly<Record<K, Cell<S>>>;
  /** The exact pass, in read order. */
  readonly trace: readonly { readonly id: string; readonly value: number }[];
  /** The ids the exact pass read, in order (each id is read at most once per run). */
  readonly roundingPoints: readonly string[];
  /** Conservative runs made, the baseline included; the exact pass is not counted. */
  readonly runs: number;
}

type Direction = 'down' | 'up';

/** Rounds `value` to a multiple of `step`; a value within float noise of a multiple counts as on it. */
export function roundTo(value: number, step: number, dir: Direction): number {
  let q = value / step;
  const nearest = Math.round(q);
  if (Math.abs(q - nearest) < 1e-9) q = nearest;
  const snapped = (dir === 'down' ? Math.floor(q) : Math.ceil(q)) * step;
  return Number(snapped.toFixed(10));
}

interface ReadRecord {
  readonly id: string;
  readonly value: number;
  readonly step: number;
}

interface Run<K extends string, S> extends ChainRun<K, S> {
  readonly reads: readonly ReadRecord[];
}

function onStep(read: ReadRecord): boolean {
  return roundTo(read.value, read.step, 'down') === roundTo(read.value, read.step, 'up');
}

/** The default `mark`: the exact pass of `runExact` and every run of `evaluate` draw no path. */
const ignoreMark = (): void => undefined;

/** The exact pass reads every value exact; a conservative run starts every input from its conservative value. */
type Pass = 'exact' | 'conservative';

/**
 * Runs the chain once; an id the plan names is rounded that way, every other id is read as the pass gives it. These
 * are chain defects and throw an Error (they are not an OutOfChart): a second read of the same id in one run (by
 * `read` or `input`), a step that is not a positive finite number, a value that is not finite (either value of an
 * input, in every pass).
 */
function execute<K extends string, S>(
  chain: Chain<K, S>,
  pass: Pass,
  plan: ReadonlyMap<string, Direction>,
  mark: (m: PathMark) => void = ignoreMark,
): Run<K, S> {
  const reads: ReadRecord[] = [];
  const seen = new Set<string>();
  const point = (id: string, value: number, step: number, checked: readonly number[]): number => {
    if (seen.has(id)) throw new Error(`chain defect: rounding point '${id}' read twice in one run`);
    if (!Number.isFinite(step) || step <= 0)
      throw new Error(`chain defect: rounding point '${id}' has step ${String(step)}`);
    const bad = checked.find((v) => !Number.isFinite(v));
    if (bad !== undefined) throw new Error(`chain defect: rounding point '${id}' read ${String(bad)}`);
    seen.add(id);
    reads.push({ id, value, step });
    const dir = plan.get(id);
    return dir === undefined ? value : roundTo(value, step, dir);
  };
  const ctx: Ctx = {
    read: (id, value, step) => point(id, value, step, [value]),
    input: (id, value, step) =>
      point(id, pass === 'exact' ? value.exact : value.conservative, step, [value.exact, value.conservative]),
    mark,
  };
  const { outputs, side } = chain(ctx);
  return { outputs, side, reads };
}

/** The ids of `reads` not on their step and not in `skip`, in read order. */
function offStepIds(reads: readonly ReadRecord[], skip: ReadonlyMap<string, Direction>): string[] {
  const ids: string[] = [];
  for (const read of reads) {
    if (!skip.has(read.id) && !onStep(read)) ids.push(read.id);
  }
  return ids;
}

/**
 * The direction whose run is worse for this output. An errored side is the worse one (both errored: 'down'), so the
 * final run reproduces the error; 'down' on a tie of values.
 */
function worseDirection(worse: 'higher' | 'lower', down: Read<number>, up: Read<number>): Direction {
  if (!down.ok) return 'down';
  if (!up.ok) return 'up';
  const upIsWorse = worse === 'higher' ? up.value > down.value : up.value < down.value;
  return upIsWorse ? 'up' : 'down';
}

/**
 * The index of the run that decides one output's conservative value: the first run that errored, in run order (a
 * rounding step left the drawn data); otherwise the worst value, the first of equal ones. Run order: the baseline; the
 * shared single-point runs in baseline read order, down before up; then the output's own loop, each final run followed
 * by its re-tests (down before up, in read order), which come before the next final run. `reads` is never empty.
 */
function decidingRun(reads: readonly Read<number>[], worse: 'higher' | 'lower'): number {
  let best = -1;
  let bestValue = 0;
  for (const [i, read] of reads.entries()) {
    if (!read.ok) return i;
    if (best < 0 || (worse === 'higher' ? read.value > bestValue : read.value < bestValue)) {
      best = i;
      bestValue = read.value;
    }
  }
  return best;
}

/**
 * The cell for one output; `runs[0]` is the baseline. An exact error rejects the whole cell (the conservative value is
 * the exact error, both sides the exact pass's) only when the baseline errors too. With single-valued inputs the
 * baseline is the exact pass, so an exact error always rejects the cell. When the exact pass errors and the baseline
 * does not (a two-valued input: the exact value leaves the chart, the conservative one does not), `exact` keeps the
 * error and the conservative value is decided from the conservative runs as usual.
 */
function cellOf<K extends string, S>(
  k: K,
  exact: ChainRun<K, S>,
  runs: readonly ChainRun<K, S>[],
  worse: 'higher' | 'lower',
): Cell<S> {
  const exactRead = exact.outputs[k];
  if (!exactRead.ok && runs[0]?.outputs[k].ok !== true)
    return { exact: exactRead, conservative: exactRead, exactSide: exact.side, conservativeSide: exact.side };
  const decided =
    runs[
      decidingRun(
        runs.map((run) => run.outputs[k]),
        worse,
      )
    ];
  if (decided === undefined) throw new Error('unreachable: the baseline run is always made');
  return { exact: exactRead, conservative: decided.outputs[k], exactSide: exact.side, conservativeSide: decided.side };
}

function traceOf(reads: readonly ReadRecord[]): Evaluation<string>['trace'] {
  return reads.map(({ id, value }) => ({ id, value }));
}

export function runExact<K extends string, S>(
  chain: Chain<K, S>,
  mark?: (m: PathMark) => void,
): { run: ChainRun<K, S>; trace: Evaluation<K, S>['trace'] } {
  const { outputs, side, reads } = execute(chain, 'exact', new Map(), mark);
  return { run: { outputs, side }, trace: traceOf(reads) };
}

/** The most re-test rounds one output's final-run loop may take before the chain is called defective. */
export const MAX_FINAL_ROUNDS = 64;

/**
 * The exact and conservative value of every output of `chain`, with the side data of the run that decided each.
 * An exact error rejects a cell only when the baseline run errors too (see `cellOf`).
 */
export function evaluate<K extends string, S>(
  chain: Chain<K, S>,
  kinds: Readonly<Record<K, OutputKind>>,
): Evaluation<K, S> {
  const keys = Object.keys(kinds) as K[];
  const exact = execute(chain, 'exact', new Map());
  let runs = 0;
  const run = (plan: ReadonlyMap<string, Direction>): Run<K, S> => {
    runs++;
    return execute(chain, 'conservative', plan);
  };

  // The baseline: every input at its conservative value, nothing rounded. With single-valued inputs it is the exact
  // pass again; its off-step points are the ones the single-point tests try, shared by all outputs.
  const baseline = run(new Map());
  const shared: Run<K, S>[] = [baseline];
  const firstDirs = new Map<K, Map<string, Direction>>(keys.map((k) => [k, new Map()]));
  for (const id of offStepIds(baseline.reads, new Map())) {
    const down = run(new Map([[id, 'down']]));
    const up = run(new Map([[id, 'up']]));
    shared.push(down, up);
    for (const k of keys) firstDirs.get(k)?.set(id, worseDirection(WORSE[kinds[k]], down.outputs[k], up.outputs[k]));
  }

  const cells = {} as Record<K, Cell<S>>;
  for (const k of keys) {
    const worse = WORSE[kinds[k]];
    const dirs = new Map(firstDirs.get(k));
    const own: Run<K, S>[] = [];
    // Each re-test round gives at least one more id a direction, so a chain with a finite set of ids ends; chains use
    // static ids, so real branch nesting stays far below the cap. A chain whose ids keep changing from run to run (a
    // defect) would never end: it throws once the output has had MAX_FINAL_ROUNDS re-test rounds.
    for (let rounds = 0; ; rounds++) {
      // A final run that rounds nothing is the baseline (no point was off its step): it is not run again.
      const final = dirs.size === 0 ? baseline : run(dirs);
      if (final !== baseline) own.push(final);
      const fresh = offStepIds(final.reads, dirs);
      if (fresh.length === 0) break;
      if (rounds >= MAX_FINAL_ROUNDS) {
        throw new Error(
          `chain defect: the final-run loop for '${k}' passed ${String(MAX_FINAL_ROUNDS)} rounds, its ids keep changing`,
        );
      }
      // A point the final run read that no direction covers (a branch switched): test it with the others as in the
      // final run, then repeat the final run.
      const plan = new Map(dirs);
      for (const id of fresh) {
        const down = run(new Map([...plan, [id, 'down']]));
        const up = run(new Map([...plan, [id, 'up']]));
        own.push(down, up);
        dirs.set(id, worseDirection(worse, down.outputs[k], up.outputs[k]));
      }
    }
    cells[k] = cellOf(k, exact, [...shared, ...own], worse);
  }

  const roundingPoints = exact.reads.map((read) => read.id);
  return { cells, trace: traceOf(exact.reads), roundingPoints, runs };
}
