import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { describe, test } from 'node:test';

import { evaluate, roundTo, runExact, STEPS, WORSE } from '../src/core/ctx.ts';
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
    const start = performance.now();
    const e = evaluate(chain, { a: 'distance', b: 'refusalSpeed', c: 'speed' });
    const elapsedMs = performance.now() - start;
    assert.equal(e.runs, 93);
    assert.ok(elapsedMs < 20, `${String(elapsedMs)} ms`);
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

describe('oracle agreement', () => {
  test('200 seeded random chains: evaluate equals the exhaustive search for every output', () => {
    const rng = mulberry32(0x70_1d_20_26);
    let branchesSwitched = 0;
    for (let n = 0; n < 200; n++) {
      const { chain, kinds } = randomChain(rng);
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
      // The final run read a branch point the exact pass did not: 2 single-point runs per point do not explain the count.
      if (fast.runs !== 2 * fast.roundingPoints.length + Object.keys(kinds).length) branchesSwitched++;
    }
    assert.ok(branchesSwitched > 10, `only ${String(branchesSwitched)} chains switched a branch`);
  });
});
