import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { describe, test } from 'node:test';

import { evaluate, MAX_FINAL_ROUNDS, roundTo, runExact, STEPS, WORSE } from '../src/core/ctx.ts';
import type { Chain, Ctx, Evaluation, OutputKind } from '../src/core/ctx.ts';
import { ok, outOfChart } from '../src/core/result.ts';
import type { Read } from '../src/core/result.ts';
import { evaluateExhaustive } from './helpers/exhaustive.ts';

function valueOf(read: Read<number> | undefined): number {
  assert.ok(read?.ok === true, `expected a value, got ${JSON.stringify(read)}`);
  return read.value;
}

function close(actual: number, expected: number, message?: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ''} ${String(actual)} is not ${String(expected)}`);
}

/** A ctx-wrapping chain that records every value the chain was handed back, per id. */
function spied<K extends string>(chain: Chain<K>): { chain: Chain<K>; seen: Map<string, number[]> } {
  const seen = new Map<string, number[]>();
  return {
    seen,
    chain: (ctx) =>
      chain({
        read(id, value, step) {
          const got = ctx.read(id, value, step);
          seen.set(id, [...(seen.get(id) ?? []), got]);
          return got;
        },
      }),
  };
}

describe('WORSE and STEPS', () => {
  test('worse is higher for distance, speed and acceleration check speed, lower for refusal speed', () => {
    assert.deepEqual(WORSE, { distance: 'higher', speed: 'higher', refusalSpeed: 'lower', accelCheckSpeed: 'higher' });
  });

  test('the steps are the spec table', () => {
    assert.deepEqual(STEPS, {
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
    });
  });
});

describe('roundTo', () => {
  test('a value on its step stays put in both directions despite float noise', () => {
    assert.equal(roundTo(3.16, 0.01, 'down'), 3.16);
    assert.equal(roundTo(3.16, 0.01, 'up'), 3.16);
  });

  test('a value off its step goes to the next step up', () => {
    assert.equal(roundTo(3.161, 0.01, 'up'), 3.17);
  });

  test('down on a negative value goes further from zero', () => {
    assert.equal(roundTo(-1050, 100, 'down'), -1100);
  });
});

describe('runExact', () => {
  test('returns the unrounded values and the trace in read order', () => {
    const chain: Chain<'d'> = (ctx) => {
      const a = ctx.read('a', 1.234, 0.1);
      const b = ctx.read('b', a * 10.07, 10);
      return { d: ok(a + b) };
    };
    const { outputs, trace } = runExact(chain);
    close(valueOf(outputs.d), 1.234 + 1.234 * 10.07);
    assert.deepEqual(trace, [
      { id: 'a', value: 1.234 },
      { id: 'b', value: 1.234 * 10.07 },
    ]);
  });
});

describe('evaluate', () => {
  const double: Chain<'d'> = (ctx) => ({ d: ok(2 * ctx.read('a', 1.23, 0.1)) });

  test('a distance is rounded up', () => {
    const e = evaluate(double, { d: 'distance' });
    close(valueOf(e.cells.d.exact), 2.46);
    close(valueOf(e.cells.d.conservative), 2.6);
    assert.deepEqual(e.roundingPoints, ['a']);
  });

  test('a refusal speed is rounded down', () => {
    const e = evaluate(double, { d: 'refusalSpeed' });
    close(valueOf(e.cells.d.conservative), 2.4);
  });

  test('a branch the exact pass never took is tested in the final run, and matches the exhaustive search', () => {
    const branch: Chain<'check'> = (ctx) => {
      const r = ctx.read('roll', 2495, 10);
      const check = r < 2500 ? ctx.read('check1000', 120.4 + (r - 2495) / 100, 1) : ctx.read('check2000', 130.6, 1);
      return { check: ok(check) };
    };
    const { chain, seen } = spied(branch);
    const e = evaluate(chain, { check: 'accelCheckSpeed' });
    assert.deepEqual(e.roundingPoints, ['roll', 'check1000']);
    assert.ok(!e.trace.some((t) => t.id === 'check2000'));
    // check2000 got its own test: read rounded down and up.
    const check2000 = seen.get('check2000') ?? [];
    assert.ok(check2000.includes(130) && check2000.includes(131), String(check2000));
    // 4 single-point runs, final run, 2 tests of check2000, final run again.
    assert.equal(e.runs, 8);
    close(valueOf(e.cells.check.conservative), 131);
    const oracle = evaluateExhaustive(branch, { check: 'accelCheckSpeed' });
    close(valueOf(e.cells.check.conservative), valueOf(oracle.cells.check.conservative));
  });

  test('two outputs sharing one read each take their own worst direction', () => {
    const shared: Chain<'distance' | 'refusal'> = (ctx) => {
      const tof = ctx.read('tof', 1.234, 0.01);
      return { distance: ok(1000 * tof), refusal: ok(100 * tof) };
    };
    const e = evaluate(shared, { distance: 'distance', refusal: 'refusalSpeed' });
    close(valueOf(e.cells.distance.conservative), 1240);
    close(valueOf(e.cells.refusal.conservative), 123);
  });

  test('out of chart only when one point is rounded up: exact ok, conservative the error', () => {
    const edge: Chain<'d'> = (ctx) => {
      const w = ctx.read('weight', 47950, 100);
      return { d: w > 47950 ? outOfChart('B2-3', 'gross_weight', w, [20000, 47950]) : ok(w * 0.1) };
    };
    const e = evaluate(edge, { d: 'distance' });
    close(valueOf(e.cells.d.exact), 4795);
    assert.deepEqual(e.cells.d.conservative, outOfChart('B2-3', 'gross_weight', 48000, [20000, 47950]));
  });

  test('only the up side errors: the direction is up, and the conservative value is that error', () => {
    const edge: Chain<'d'> = (ctx) => {
      const t = ctx.read('temp', 20.4, 1);
      const w = ctx.read('weight', 47950, 100);
      return { d: w > 47950 ? outOfChart('B2-3', 'gross_weight', w, [20000, 47950]) : ok(w * 0.1 + t) };
    };
    const { chain, seen } = spied(edge);
    const e = evaluate(chain, { d: 'distance' });
    // Runs: exact, temp down, temp up, weight down, weight up, final. The final run reads weight rounded up.
    assert.equal(e.runs, 5);
    assert.equal(seen.get('weight')?.at(-1), 48000);
    assert.equal(seen.get('temp')?.at(-1), 21);
    close(valueOf(e.cells.d.exact), 4815.4);
    assert.deepEqual(e.cells.d.conservative, outOfChart('B2-3', 'gross_weight', 48000, [20000, 47950]));
  });

  test('the first error is by run order: single-point runs in exact-pass read order, down before up', () => {
    const twoEdges: Chain<'d'> = (ctx) => {
      const a = ctx.read('a', 9.5, 1);
      const b = ctx.read('b', 4.5, 1);
      if (b > 4.5) return { d: outOfChart('F-B', 'b', b, [0, 4.5]) };
      if (a > 9.5) return { d: outOfChart('F-A', 'a', a, [0, 9.5]) };
      return { d: ok(a + b) };
    };
    const e = evaluate(twoEdges, { d: 'distance' });
    // a up errors before b up does (a is read first); the final run (both up) would give F-B.
    assert.deepEqual(e.cells.d.conservative, outOfChart('F-A', 'a', 10, [0, 9.5]));
  });

  test('a second read of the same id in one run is a chain defect and throws', () => {
    const twice: Chain<'d'> = (ctx) => ({ d: ok(ctx.read('a', 1.25, 0.1) + ctx.read('a', 2.5, 0.1)) });
    assert.throws(() => runExact(twice), { name: 'Error', message: /'a' read twice/ });
    assert.throws(() => evaluate(twice, { d: 'distance' }), { name: 'Error', message: /'a' read twice/ });
    assert.throws(() => evaluateExhaustive(twice, { d: 'distance' }), { name: 'Error', message: /'a' read twice/ });
  });

  test('an exact error rejects the whole cell', () => {
    const off: Chain<'d'> = (ctx) => {
      const w = ctx.read('weight', 52050, 100);
      return { d: outOfChart('B2-3', 'gross_weight', w, [20000, 48000]) };
    };
    const e = evaluate(off, { d: 'distance' });
    const error = outOfChart('B2-3', 'gross_weight', 52050, [20000, 48000]);
    assert.deepEqual(e.cells.d.exact, error);
    assert.deepEqual(e.cells.d.conservative, error);
  });

  function independent(count: number, offset: number): (ctx: Ctx) => number {
    return (ctx) => {
      let sum = 0;
      for (let i = 0; i < count; i++) sum += ctx.read(`p${String(i)}`, i + offset, 1);
      return sum;
    };
  }

  test('10 reads off their step, one output: 21 runs', () => {
    const sum = independent(10, 0.37);
    const e = evaluate((ctx) => ({ d: ok(sum(ctx)) }), { d: 'distance' });
    assert.equal(e.runs, 21);
    assert.equal(e.roundingPoints.length, 10);
    close(valueOf(e.cells.d.conservative), 55);
  });

  test('45 reads, three outputs: 93 runs, in under 20 ms', () => {
    const sum = independent(45, 0.37);
    const chain: Chain<'a' | 'b' | 'c'> = (ctx) => {
      const s = sum(ctx);
      return { a: ok(s), b: ok(2 * s), c: ok(s + 1) };
    };
    const kinds = { a: 'distance', b: 'refusalSpeed', c: 'speed' } as const;
    // The fastest of three, so one slow moment on a loaded machine does not fail it.
    const times: number[] = [];
    let e = evaluate(chain, kinds);
    for (let attempt = 0; attempt < 3; attempt++) {
      const start = performance.now();
      e = evaluate(chain, kinds);
      times.push(performance.now() - start);
    }
    assert.equal(e.runs, 93);
    assert.ok(Math.min(...times) < 20, `${times.map(String).join(', ')} ms`);
    close(valueOf(e.cells.a.conservative), 1035);
    close(valueOf(e.cells.b.conservative), 1980);
  });

  test('10 reads already on their step: 1 run', () => {
    const sum = independent(10, 0);
    const e = evaluate((ctx) => ({ d: ok(sum(ctx)) }), { d: 'distance' });
    assert.equal(e.runs, 1);
    close(valueOf(e.cells.d.conservative), 45);
  });
});

describe('direction tests', () => {
  test('a distance that falls as a headwind read rises rounds the headwind down', () => {
    const { chain, seen } = spied<'d'>((ctx) => ({ d: ok(3000 - 20 * ctx.read('headwind', 12.4, 1)) }));
    const e = evaluate(chain, { d: 'distance' });
    close(valueOf(e.cells.d.conservative), 2760);
    // The final run (the last run) rounds the headwind down; the cell's worst alone would hide a wrong direction.
    assert.equal(seen.get('headwind')?.at(-1), 12);
  });

  test('a refusal speed that rises with a weight read rounds the weight down', () => {
    const { chain, seen } = spied<'v'>((ctx) => ({ v: ok(100 + 0.002 * ctx.read('weight', 30050, 100)) }));
    const e = evaluate(chain, { v: 'refusalSpeed' });
    close(valueOf(e.cells.v.conservative), 160);
    assert.equal(seen.get('weight')?.at(-1), 30000);
  });

  test('a refusal speed that falls with a weight read rounds the weight up', () => {
    const { chain, seen } = spied<'v'>((ctx) => ({ v: ok(200 - 0.002 * ctx.read('weight', 30050, 100)) }));
    const e = evaluate(chain, { v: 'refusalSpeed' });
    close(valueOf(e.cells.v.conservative), 139.8);
    assert.equal(seen.get('weight')?.at(-1), 30100);
  });

  test('one output with one read raising it and another lowering it: each read in its own direction', () => {
    const mixed: Chain<'d'> = (ctx) => ({ d: ok(10 * ctx.read('a', 1.25, 0.1) - 5 * ctx.read('b', 2.25, 0.1)) });
    const { chain, seen } = spied(mixed);
    const e = evaluate(chain, { d: 'distance' });
    close(valueOf(e.cells.d.conservative), 2);
    // The final run is the last run: a up, b down.
    assert.equal(seen.get('a')?.at(-1), 1.3);
    assert.equal(seen.get('b')?.at(-1), 2.2);
  });
});

describe('guards and error order', () => {
  test("an output's re-tests come before its next final run in the error order", () => {
    // The exact pass and roll down take the short branch; roll up reads x and y, both fresh in the final run.
    // Re-tests: x up errors (F-X), then y up errors (F-Y). The repeated final run, both up, reports F-Y first.
    const branch: Chain<'d'> = (ctx) => {
      const r = ctx.read('roll', 2495, 10);
      if (r < 2500) return { d: ok(r) };
      const x = ctx.read('x', 5.5, 1);
      const y = ctx.read('y', 7.5, 1);
      if (y > 7.5) return { d: outOfChart('F-Y', 'y', y, [0, 7.5]) };
      if (x > 5.5) return { d: outOfChart('F-X', 'x', x, [0, 5.5]) };
      return { d: ok(r + x + y) };
    };
    const e = evaluate(branch, { d: 'distance' });
    // 2 single-point runs, final, 4 re-tests, final.
    assert.equal(e.runs, 8);
    assert.deepEqual(e.cells.d.conservative, outOfChart('F-X', 'x', 6, [0, 5.5]));
  });

  for (const [label, value, step] of [
    ['a zero step', 1.25, 0],
    ['a negative step', 1.25, -0.1],
    ['a non-finite step', 1.25, Number.POSITIVE_INFINITY],
    ['a NaN value', Number.NaN, 0.1],
    ['an infinite value', Number.NEGATIVE_INFINITY, 0.1],
  ] as const) {
    test(`ctx.read throws an Error for ${label}`, () => {
      const bad: Chain<'d'> = (ctx) => ({ d: ok(ctx.read('a', value, step)) });
      assert.throws(() => runExact(bad), { name: 'Error', message: /chain defect: rounding point 'a'/ });
      assert.throws(() => evaluate(bad, { d: 'distance' }), { name: 'Error', message: /chain defect/ });
    });
  }

  test('branches nested three deep, a sound chain: the loop ends and equals the exhaustive search', () => {
    // roll, then x only when roll is rounded up, y only when x is, z only when y is: three re-test rounds.
    const nested: Chain<'d'> = (ctx) => {
      const r = ctx.read('roll', 2495, 10);
      if (r < 2500) return { d: ok(r) };
      const x = ctx.read('x', 5.5, 1);
      if (x < 6) return { d: ok(r + x) };
      const y = ctx.read('y', 7.5, 1);
      if (y < 8) return { d: ok(r + x + y) };
      const z = ctx.read('z', 1.5, 1);
      return { d: ok(r + x + y + z) };
    };
    const e = evaluate(nested, { d: 'distance' });
    const oracle = evaluateExhaustive(nested, { d: 'distance' });
    close(valueOf(e.cells.d.conservative), 2516);
    close(valueOf(e.cells.d.conservative), valueOf(oracle.cells.d.conservative));
  });

  test(`the final-run loop throws an Error after ${String(MAX_FINAL_ROUNDS)} rounds when its ids keep changing`, () => {
    // A chain defect: every run reads a new id, so every final run has a fresh point and the loop would never end.
    let counter = 0;
    const drifting: Chain<'d'> = (ctx) => ({ d: ok(ctx.read(`n${String(counter++)}`, 1.25, 0.1)) });
    assert.throws(() => evaluate(drifting, { d: 'distance' }), {
      name: 'Error',
      message: new RegExp(`final-run loop for 'd' passed ${String(MAX_FINAL_ROUNDS)} rounds`),
    });
    // The exact pass, 2 single-point runs, then per round a final run and 2 re-tests, then the last final run.
    assert.equal(counter, 1 + 2 + 3 * MAX_FINAL_ROUNDS + 1);
  });
});

/** mulberry32: a small seeded PRNG, so the random chains are the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Term =
  | { readonly kind: 'lin'; readonly j: number; readonly c: number }
  | { readonly kind: 'sqrt'; readonly j: number; readonly c: number }
  | { readonly kind: 'prod'; readonly j: number; readonly l: number; readonly c: number };

interface RandomChain {
  readonly chain: Chain<string>;
  readonly kinds: Readonly<Record<string, OutputKind>>;
}

/**
 * 3 to 8 reads, each a positive, increasing function of the earlier reads (sums, products, square roots), so every
 * output rises with every read. One read is chosen by an `if` on an earlier read, with the threshold inside that
 * read's rounding interval; the branch the higher selector takes gives the higher value, so the chain stays monotone
 * across it, and its two reads have their own ids, as a procedure reading one chart or another does.
 */
function randomChain(rng: () => number): RandomChain {
  const pick = <T>(list: readonly T[]): T => {
    const item = list[Math.floor(rng() * list.length)];
    assert.ok(item !== undefined);
    return item;
  };
  const count = 3 + Math.floor(rng() * 6);
  const steps = [0.01, 0.1, 0.5, 1, 10, 100];
  const specs = Array.from({ length: count }, (_, i) => {
    const step = pick(steps);
    const base = step * (3 + rng() * 300);
    const terms: Term[] = [];
    for (let t = 0; t < Math.min(i, 3); t++) {
      const j = Math.floor(rng() * i);
      const c = 0.05 + rng();
      const roll = rng();
      terms.push(
        roll < 0.4
          ? { kind: 'lin', j, c }
          : roll < 0.7
            ? { kind: 'sqrt', j, c }
            : { kind: 'prod', j, l: Math.floor(rng() * i), c: c / 100 },
      );
    }
    return { step, base, terms };
  });
  const branchAt = 1 + Math.floor(rng() * (count - 1));
  const selector = Math.floor(rng() * branchAt);
  const jump = rng() * 20;
  let threshold = Number.POSITIVE_INFINITY;

  const reads = (ctx: Ctx): number[] => {
    const values: number[] = [];
    const at = (j: number): number => {
      const v = values[j];
      assert.ok(v !== undefined);
      return v;
    };
    specs.forEach((spec, i) => {
      let value = spec.base;
      for (const term of spec.terms) {
        const units = (j: number): number => at(j) / (specs[j]?.step ?? 1);
        switch (term.kind) {
          case 'lin':
            value += term.c * spec.step * units(term.j);
            break;
          case 'sqrt':
            value += term.c * spec.step * Math.sqrt(units(term.j));
            break;
          case 'prod':
            value += term.c * spec.step * units(term.j) * units(term.l);
            break;
        }
      }
      let id = `r${String(i)}`;
      if (i === branchAt) {
        const high = at(selector) >= threshold;
        id += high ? '.hi' : '.lo';
        if (high) value += jump * spec.step;
      }
      values.push(ctx.read(id, value, spec.step));
    });
    return values;
  };

  // Put the threshold inside the selector's rounding interval, so rounding it switches the branch.
  const plain: Ctx = { read: (_id, value) => value };
  const v = reads(plain)[selector] ?? 0;
  const step = specs[selector]?.step ?? 1;
  const lo = roundTo(v, step, 'down');
  const hi = roundTo(v, step, 'up');
  threshold = lo === hi ? v + step / 2 : lo + (0.05 + 0.9 * rng()) * (hi - lo);

  const kinds: Record<string, OutputKind> = {};
  const outputs: { name: string; uses: { j: number; w: number; root: boolean }[] }[] = [];
  const outputCount = 1 + Math.floor(rng() * 3);
  for (let o = 0; o < outputCount; o++) {
    const name = `o${String(o)}`;
    kinds[name] = pick(['distance', 'speed', 'refusalSpeed', 'accelCheckSpeed'] as const);
    const uses = [{ j: count - 1, w: 0.1 + rng(), root: false }];
    for (let u = 0; u < 2; u++) uses.push({ j: Math.floor(rng() * count), w: 0.1 + rng(), root: rng() < 0.5 });
    outputs.push({ name, uses });
  }

  const chain: Chain<string> = (ctx) => {
    const values = reads(ctx);
    const result: Record<string, Read<number>> = {};
    for (const { name, uses } of outputs) {
      let sum = 0;
      for (const { j, w, root } of uses) {
        const x = values[j] ?? 0;
        sum += w * (root ? Math.sqrt(x) : x);
      }
      result[name] = ok(sum);
    }
    return result;
  };
  return { chain, kinds };
}

const KINDS = ['distance', 'speed', 'refusalSpeed', 'accelCheckSpeed'] as const;

/** Two different output kinds, so one chain is judged in two directions. */
function twoKinds(rng: () => number): Record<string, OutputKind> {
  const first = Math.floor(rng() * KINDS.length);
  const second = (first + 1 + Math.floor(rng() * (KINDS.length - 1))) % KINDS.length;
  return { o0: KINDS[first] ?? 'distance', o1: KINDS[second] ?? 'distance' };
}

const sign = (rng: () => number): number => (rng() < 0.5 ? -1 : 1);

/** Reads that do not feed each other (each value an input constant); two outputs, signed sums of reads and roots. */
function independentSignedChain(rng: () => number): RandomChain {
  const count = 3 + Math.floor(rng() * 6);
  const steps = [0.01, 0.1, 0.5, 1, 10, 100];
  const specs = Array.from({ length: count }, () => {
    const step = steps[Math.floor(rng() * steps.length)] ?? 1;
    return { step, value: step * (3 + rng() * 300) };
  });
  const kinds = twoKinds(rng);
  const outputs = Object.keys(kinds).map((name) => ({
    name,
    uses: specs.map(() => ({ w: sign(rng) * (0.1 + rng()), root: rng() < 0.3 })),
  }));
  const chain: Chain<string> = (ctx) => {
    const values = specs.map((spec, i) => ctx.read(`r${String(i)}`, spec.value, spec.step));
    const result: Record<string, Read<number>> = {};
    for (const { name, uses } of outputs) {
      let sum = 0;
      uses.forEach(({ w, root }, i) => {
        const x = values[i] ?? 0;
        sum += w * (root ? Math.sqrt(x) : x);
      });
      result[name] = ok(sum);
    }
    return result;
  };
  return { chain, kinds };
}

interface BoundedChain extends RandomChain {
  /** The largest step times the largest absolute coefficient (output weights and feeding coefficients). */
  readonly bound: number;
}

/**
 * Signed chains whose reads feed each other, with a branch (the review's shape): read i adds `c * 0.01` of each
 * feeding read j, in step units (`c * 0.01 * step_i * r_j / step_j`), so one step of a feeding read moves read i by
 * at most about a hundredth of its step. Outputs are signed sums of every read. Spec 5.2: here the per-point
 * conservative value and the exhaustive maximum differ, within the bound.
 */
function signedFeedingChain(rng: () => number): BoundedChain {
  const count = 3 + Math.floor(rng() * 6);
  const steps = [0.01, 0.1, 1, 10];
  const specs = Array.from({ length: count }, (_, i) => ({
    step: steps[Math.floor(rng() * steps.length)] ?? 1,
    base: 1000 + rng() * 300,
    terms: Array.from({ length: Math.min(i, 2) }, () => ({ j: Math.floor(rng() * i), c: sign(rng) * (0.05 + rng()) })),
  }));
  const branchAt = 1 + Math.floor(rng() * (count - 1));
  const selector = Math.floor(rng() * branchAt);
  const jump = sign(rng) * rng() * 20;
  let threshold = Number.POSITIVE_INFINITY;
  const reads = (ctx: Ctx): number[] => {
    const values: number[] = [];
    specs.forEach((spec, i) => {
      let value = spec.base;
      for (const { j, c } of spec.terms) value += c * 0.01 * spec.step * ((values[j] ?? 0) / (specs[j]?.step ?? 1));
      let id = `r${String(i)}`;
      if (i === branchAt) {
        const high = (values[selector] ?? 0) >= threshold;
        id += high ? '.hi' : '.lo';
        if (high) value += jump * spec.step;
      }
      values.push(ctx.read(id, value, spec.step));
    });
    return values;
  };
  const v = reads({ read: (_id, value) => value })[selector] ?? 0;
  const step = specs[selector]?.step ?? 1;
  const lo = roundTo(v, step, 'down');
  const hi = roundTo(v, step, 'up');
  threshold = lo === hi ? v + step / 2 : lo + (0.05 + 0.9 * rng()) * (hi - lo);

  const kinds = twoKinds(rng);
  const outputs = Object.keys(kinds).map((name) => ({ name, w: specs.map(() => sign(rng) * (0.1 + rng())) }));
  const largestCoefficient = Math.max(
    ...outputs.flatMap(({ w }) => w.map(Math.abs)),
    ...specs.flatMap(({ terms }) => terms.map(({ c }) => Math.abs(c))),
  );
  const largestStep = Math.max(...specs.map((spec) => spec.step));
  const chain: Chain<string> = (ctx) => {
    const values = reads(ctx);
    const result: Record<string, Read<number>> = {};
    for (const { name, w } of outputs) result[name] = ok(values.reduce((sum, x, i) => sum + (w[i] ?? 0) * x, 0));
    return result;
  };
  return { chain, kinds, bound: largestStep * largestCoefficient };
}

function assertAgreement(make: (rng: () => number) => RandomChain, seed: number): number {
  const rng = mulberry32(seed);
  let branchesSwitched = 0;
  for (let n = 0; n < 200; n++) {
    const { chain, kinds } = make(rng);
    const fast: Evaluation<string> = evaluate(chain, kinds);
    const oracle: Evaluation<string> = evaluateExhaustive(chain, kinds);
    assert.deepEqual(fast.trace, oracle.trace);
    assert.deepEqual(fast.roundingPoints, oracle.roundingPoints);
    for (const k of Object.keys(kinds)) {
      close(
        valueOf(fast.cells[k]?.conservative),
        valueOf(oracle.cells[k]?.conservative),
        `chain ${String(n)} output ${k}:`,
      );
    }
    // The final run read a point the exact pass did not: 2 single-point runs per point do not explain the count.
    if (fast.runs !== 2 * fast.roundingPoints.length + Object.keys(kinds).length) branchesSwitched++;
  }
  return branchesSwitched;
}

describe('oracle agreement, where the definitions coincide', () => {
  test('200 seeded chains of independent reads, signed, two output kinds: evaluate equals the exhaustive search', () => {
    assertAgreement(independentSignedChain, 0x1d_e9_20_26);
  });

  test('200 seeded chains of reads feeding each other, with a branch, outputs rising with every read: equal', () => {
    const branchesSwitched = assertAgreement(randomChain, 0x70_1d_20_26);
    assert.ok(branchesSwitched > 10, `only ${String(branchesSwitched)} chains switched a branch`);
  });
});

describe('oracle bound, elsewhere', () => {
  test('200 seeded signed chains feeding each other, with a branch: never better than exact, within the bound', (t) => {
    const rng = mulberry32(0x5e_ed_20_26);
    let outputs = 0;
    let differ = 0;
    for (let n = 0; n < 200; n++) {
      const { chain, kinds, bound } = signedFeedingChain(rng);
      const fast = evaluate(chain, kinds);
      const oracle = evaluateExhaustive(chain, kinds);
      for (const [k, kind] of Object.entries(kinds)) {
        outputs++;
        const exact = valueOf(fast.cells[k]?.exact);
        const conservative = valueOf(fast.cells[k]?.conservative);
        const exhaustive = valueOf(oracle.cells[k]?.conservative);
        const label = `chain ${String(n)} output ${k} (${kind}):`;
        if (WORSE[kind] === 'higher')
          assert.ok(conservative >= exact - 1e-9, `${label} ${String(conservative)} < exact`);
        else assert.ok(conservative <= exact + 1e-9, `${label} ${String(conservative)} > exact`);
        const gap = Math.abs(conservative - exhaustive);
        assert.ok(gap <= bound + 1e-9, `${label} gap ${String(gap)} > bound ${String(bound)}`);
        if (gap > 1e-9) differ++;
      }
    }
    t.diagnostic(
      `${String(differ)} of ${String(outputs)} outputs (${((100 * differ) / outputs).toFixed(1)} %) differ from the exhaustive search`,
    );
  });
});
