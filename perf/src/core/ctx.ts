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
 */

import type { Read } from './result.ts';

export interface Ctx {
  read(id: string, value: number, step: number): number;
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

export type Chain<K extends string> = (ctx: Ctx) => Readonly<Record<K, Read<number>>>;

export interface Cell {
  readonly exact: Read<number>;
  readonly conservative: Read<number>;
}

export interface Evaluation<K extends string> {
  readonly cells: Readonly<Record<K, Cell>>;
  /** The exact pass, in read order. */
  readonly trace: readonly { readonly id: string; readonly value: number }[];
  /** The ids the exact pass read, in order (each id is read at most once per run). */
  readonly roundingPoints: readonly string[];
  /** Conservative runs made; the exact pass is not counted. */
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

interface Run<K extends string> {
  readonly outputs: Readonly<Record<K, Read<number>>>;
  readonly reads: readonly ReadRecord[];
}

function onStep(read: ReadRecord): boolean {
  return roundTo(read.value, read.step, 'down') === roundTo(read.value, read.step, 'up');
}

/**
 * Runs the chain once; an id the plan names is rounded that way, every other id is read exact. These are chain
 * defects and throw an Error (they are not an OutOfChart): a second read of the same id in one run, a step that is
 * not a positive finite number, a value that is not finite.
 */
function execute<K extends string>(chain: Chain<K>, plan: ReadonlyMap<string, Direction>): Run<K> {
  const reads: ReadRecord[] = [];
  const seen = new Set<string>();
  const ctx: Ctx = {
    read(id, value, step) {
      if (seen.has(id)) throw new Error(`chain defect: rounding point '${id}' read twice in one run`);
      if (!Number.isFinite(step) || step <= 0)
        throw new Error(`chain defect: rounding point '${id}' has step ${String(step)}`);
      if (!Number.isFinite(value)) throw new Error(`chain defect: rounding point '${id}' read ${String(value)}`);
      seen.add(id);
      reads.push({ id, value, step });
      const dir = plan.get(id);
      return dir === undefined ? value : roundTo(value, step, dir);
    },
  };
  return { outputs: chain(ctx), reads };
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
 * The cell for one output. An exact error rejects the whole cell; otherwise the first run that errored, in run order,
 * is the conservative value (a rounding step left the drawn data); otherwise the worst value of the runs. Run order:
 * the shared single-point runs in exact-pass read order, down before up; then the output's own loop, each final run
 * followed by its re-tests (down before up, in read order), which come before the next final run.
 */
function cellOf(exact: Read<number>, runs: readonly Read<number>[], worse: 'higher' | 'lower'): Cell {
  if (!exact.ok) return { exact, conservative: exact };
  let conservative: Read<number> | undefined;
  for (const read of runs) {
    if (!read.ok) return { exact, conservative: read };
    if (conservative?.ok !== true) {
      conservative = read;
    } else if (worse === 'higher' ? read.value > conservative.value : read.value < conservative.value) {
      conservative = read;
    }
  }
  return { exact, conservative: conservative ?? exact };
}

function traceOf(reads: readonly ReadRecord[]): Evaluation<string>['trace'] {
  return reads.map(({ id, value }) => ({ id, value }));
}

export function runExact<K extends string>(
  chain: Chain<K>,
): { outputs: Readonly<Record<K, Read<number>>>; trace: Evaluation<K>['trace'] } {
  const { outputs, reads } = execute(chain, new Map());
  return { outputs, trace: traceOf(reads) };
}

export function evaluate<K extends string>(chain: Chain<K>, kinds: Readonly<Record<K, OutputKind>>): Evaluation<K> {
  const keys = Object.keys(kinds) as K[];
  const exact = execute(chain, new Map());
  let runs = 0;
  // Every id any run has read, for the final-run loop's guard.
  const seen = new Set<string>();
  const run = (plan: ReadonlyMap<string, Direction>): Run<K> => {
    const result = execute(chain, plan);
    runs++;
    for (const read of result.reads) seen.add(read.id);
    return result;
  };

  // Single-point tests of every point the exact pass read off its step, shared by all outputs.
  const shared: Run<K>[] = [];
  const firstDirs = new Map<K, Map<string, Direction>>(keys.map((k) => [k, new Map()]));
  for (const id of offStepIds(exact.reads, new Map())) {
    const down = run(new Map([[id, 'down']]));
    const up = run(new Map([[id, 'up']]));
    shared.push(down, up);
    for (const k of keys) firstDirs.get(k)?.set(id, worseDirection(WORSE[kinds[k]], down.outputs[k], up.outputs[k]));
  }

  const cells = {} as Record<K, Cell>;
  for (const k of keys) {
    const worse = WORSE[kinds[k]];
    const dirs = new Map(firstDirs.get(k));
    const own: Run<K>[] = [];
    // Each re-test round gives at least one more id a direction, so a chain with a finite set of ids ends. A chain
    // whose ids keep changing from run to run (a defect) would not: stop it once the rounds outnumber the ids seen
    // before this loop.
    const limit = seen.size;
    for (let rounds = 0; ; rounds++) {
      const final = run(dirs);
      own.push(final);
      const fresh = offStepIds(final.reads, dirs);
      if (fresh.length === 0) break;
      if (rounds >= limit) {
        throw new Error(
          `chain defect: the final-run loop for '${k}' passed ${String(limit)} rounds, its ids keep changing`,
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
    cells[k] = cellOf(
      exact.outputs[k],
      [...shared, ...own].map((run) => run.outputs[k]),
      worse,
    );
  }

  const roundingPoints = exact.reads.map((read) => read.id);
  return { cells, trace: traceOf(exact.reads), roundingPoints, runs };
}
