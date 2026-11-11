/**
 * Refusal speed by RCR (`told/rcr.ts`, TOLD 1.7 ruling 1): a printed RCR reads its own sheet only, an RCR between two
 * printed ones is linear in RCR over the bracketing pair, and an RCR outside the surface's family is OutOfChart on
 * `rcr`. Inputs of the B2-6 sheet 1 sample (p280).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { refusalNonAbDry, refusalNonAbSnowIcy, refusalNonAbWet } from '../src/core/figures/b2-5.ts';
import { refusalAbDry, refusalAbSnowIcy, refusalAbWet } from '../src/core/figures/b2-6.ts';
import type { RefusalInputs } from '../src/core/figures/refusal-speed.ts';
import type { Read } from '../src/core/result.ts';
import { refusalByRcr } from '../src/core/told/rcr.ts';

import { exactOf } from './helpers/chain.ts';
import { loadFigureSet } from './helpers/data.ts';

const SHEET_IDS = ['B2-5.sh1', 'B2-5.sh2', 'B2-5.sh3', 'B2-6.sh1', 'B2-6.sh2', 'B2-6.sh3'];
const figures = loadFigureSet(SHEET_IDS);

/**
 * B2-6 sheet 1's sample problem (153 KIAS dry with MAX AB, takeoff factor 1.85). MIL takes the same sample's MIL
 * takeoff factor, 3.16 (B2-1), since B2-5 draws none below 2.1.
 */
const SAMPLE_AB: RefusalInputs = {
  takeoffFactor: 1.85,
  grossWeightLb: 33000,
  runwayFt: 6000,
  headwindKt: 10,
  slopePct: 1,
};
const SAMPLE: Readonly<Record<'mil' | 'ab', RefusalInputs>> = {
  mil: { ...SAMPLE_AB, takeoffFactor: 3.16 },
  ab: SAMPLE_AB,
};

function valueOf(read: Read<number>): number {
  assert.ok(read.ok, read.ok ? '' : JSON.stringify(read.error));
  return read.value;
}

const byRcr = (mode: 'mil' | 'ab', surface: 'dry' | 'wet', rcr: number) =>
  exactOf((ctx) => ({ kias: refusalByRcr(ctx, figures, mode, surface, rcr, SAMPLE[mode]) }));
const kias = (mode: 'mil' | 'ab', surface: 'dry' | 'wet', rcr: number): number =>
  valueOf(byRcr(mode, surface, rcr).outputs.kias);

/** Each printed RCR's speed as the sheet functions give it. */
function printed(mode: 'mil' | 'ab'): Record<number, number> {
  const sheet = (id: string) => figures[id] ?? assert.fail(`no ${id}`);
  const prefix = mode === 'mil' ? 'B2-5' : 'B2-6';
  const dry = mode === 'mil' ? refusalNonAbDry : refusalAbDry;
  const wet = mode === 'mil' ? refusalNonAbWet : refusalAbWet;
  const snowIcy = mode === 'mil' ? refusalNonAbSnowIcy : refusalAbSnowIcy;
  const d = exactOf((ctx) => dry(ctx, sheet(`${prefix}.sh1`), SAMPLE[mode])).outputs;
  const w = exactOf((ctx) => wet(ctx, sheet(`${prefix}.sh2`), SAMPLE[mode])).outputs;
  const s = exactOf((ctx) => snowIcy(ctx, sheet(`${prefix}.sh3`), SAMPLE[mode])).outputs;
  return {
    23: valueOf(d.rcr23Kias),
    16: valueOf(d.rcr16Kias),
    18: valueOf(w.rcr18Kias),
    12: valueOf(w.rcr12Kias),
    8: valueOf(s.rcr8Kias),
    4: valueOf(s.rcr4Kias),
  };
}

for (const mode of ['mil', 'ab'] as const) {
  const fig = mode === 'mil' ? 'b2-5' : 'b2-6';
  const FIG = mode === 'mil' ? 'B2-5' : 'B2-6';
  describe(`refusal speed by RCR, ${mode === 'mil' ? 'MIL (B2-5)' : 'MAX AB (B2-6)'}`, () => {
    const speeds = printed(mode);

    test('each printed RCR equals its sheet function', () => {
      for (const rcr of [23, 16, 8, 4]) assert.equal(kias(mode, 'dry', rcr), speeds[rcr], `dry ${String(rcr)}`);
      for (const rcr of [18, 12]) assert.equal(kias(mode, 'wet', rcr), speeds[rcr], `wet ${String(rcr)}`);
    });

    test('a printed RCR reads that sheet only, then the result id', () => {
      const ids = (surface: 'dry' | 'wet', rcr: number) => byRcr(mode, surface, rcr).trace.map((t) => t.id);
      assert.deepEqual(ids('dry', 16), [`${fig}.sh1.runway`, `${fig}.sh1.wind`, `${fig}.sh1.slope`, `${fig}.dry`]);
      assert.deepEqual(ids('dry', 8), [
        `${fig}.sh3.snow.runway`,
        `${fig}.sh3.snow.wind`,
        `${fig}.sh3.snow.slope`,
        `${fig}.dry`,
      ]);
      assert.deepEqual(ids('dry', 4), [
        `${fig}.sh3.icy.runway`,
        `${fig}.sh3.icy.wind`,
        `${fig}.sh3.icy.slope`,
        `${fig}.dry`,
      ]);
      assert.deepEqual(ids('wet', 12), [`${fig}.sh2.runway`, `${fig}.sh2.wind`, `${fig}.sh2.slope`, `${fig}.wet`]);
      assert.ok(!ids('dry', 16).some((id) => id.includes('.sh3.')));
      assert.ok(!ids('dry', 8).some((id) => id.includes('.sh1.')));
    });

    test('between two printed RCRs the speed is linear in RCR', () => {
      const s16 = speeds[16] ?? NaN;
      const s23 = speeds[23] ?? NaN;
      const s8 = speeds[8] ?? NaN;
      const s4 = speeds[4] ?? NaN;
      const s12 = speeds[12] ?? NaN;
      const s18 = speeds[18] ?? NaN;
      assert.ok(Math.abs(kias(mode, 'dry', 17.5) - (s16 + ((17.5 - 16) / 7) * (s23 - s16))) < 1e-9);
      assert.ok(Math.abs(kias(mode, 'dry', 12) - (s8 + s16) / 2) < 1e-9);
      assert.ok(Math.abs(kias(mode, 'dry', 5) - (s4 + (s8 - s4) / 4)) < 1e-9);
      assert.ok(Math.abs(kias(mode, 'wet', 15) - (s12 + s18) / 2) < 1e-9);
      const between = byRcr(mode, 'dry', 12).trace.map((t) => t.id);
      assert.deepEqual(between, [
        `${fig}.sh1.runway`,
        `${fig}.sh1.wind`,
        `${fig}.sh1.slope`,
        `${fig}.sh3.snow.runway`,
        `${fig}.sh3.snow.wind`,
        `${fig}.sh3.snow.slope`,
        `${fig}.dry`,
      ]);
    });

    test('an RCR outside its family is OutOfChart on rcr (ruling 1); a wet RCR never borrows sheet 3', () => {
      const cases = [
        { surface: 'wet', rcr: 11, figure: `${FIG}.sh2`, range: [12, 18] },
        { surface: 'wet', rcr: 19, figure: `${FIG}.sh2`, range: [12, 18] },
        { surface: 'dry', rcr: 24, figure: `${FIG}.sh1`, range: [4, 23] },
        { surface: 'dry', rcr: 3.5, figure: `${FIG}.sh3`, range: [4, 23] },
      ] as const;
      for (const c of cases) {
        const { outputs, trace } = byRcr(mode, c.surface, c.rcr);
        assert.deepEqual(outputs.kias, {
          ok: false,
          error: { kind: 'outOfChart', figure: c.figure, input: 'rcr', value: c.rcr, drawnRange: c.range },
        });
        assert.deepEqual(trace, []);
      }
    });
  });
}
