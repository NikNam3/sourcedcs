/**
 * The path marks (TOLD 1.8, "Path geometry"): each figure function marks every panel it reads, after the read, with
 * the numbers it passed to and got back from its `read/` block; `tracePaths` records them on the exact pass.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { runExact } from '../src/core/ctx.ts';
import type { Chain } from '../src/core/ctx.ts';
import { panel } from '../src/core/data/panel.ts';
import { takeoffFactor } from '../src/core/figures/b2-1.ts';
import { takeoffDistance } from '../src/core/figures/b2-3.ts';
import { groundRollUncorrected } from '../src/core/figures/b7-2.ts';
import type { PathMark } from '../src/core/path/mark.ts';
import { tracePaths } from '../src/core/path/trace.ts';
import { curveFamily } from '../src/core/read/curve-family.ts';
import { guidelinePanel } from '../src/core/read/guideline-panel.ts';
import type { Read } from '../src/core/result.ts';
import { landingChain } from '../src/core/told/landing.ts';
import type { LandingValues } from '../src/core/told/landing.ts';
import { takeoffChain } from '../src/core/told/takeoff.ts';

import { plain } from './helpers/chain.ts';
import { loadFigure, loadFigureSet } from './helpers/data.ts';
import { at, SAMPLE, TAKEOFF_FIGURES } from './helpers/takeoff.ts';

const b21 = loadFigure('B2-1');
const b23 = loadFigure('B2-3');
const b72s1 = loadFigure('B7-2.sh1');
const LANDING_FIGURES = loadFigureSet(['B7-1', 'B7-2.sh1', 'B7-2.sh2']);
const LANDING: LandingValues = { paFt: 2000, tempC: 40, grossWeightLb: 28000, headwindKt: 10, slopePct: 1, rcr: 16 };

/** The manual's B2-3 MIL sample (p. 278). */
const B23_SAMPLE = {
  takeoffFactor: 3.16,
  grossWeightLb: 33000,
  cgPct: 37,
  dragIndex: 150,
  slopePct: 1,
  headwindKt: 10,
  pitch8: false,
};

function valueOf(read: Read<number>): number {
  assert.ok(read.ok, read.ok ? '' : JSON.stringify(read.error));
  return read.value;
}

const where = (marks: readonly PathMark[]): string[] => marks.map((m) => `${m.figure}/${m.panel}`);
const figures = (marks: readonly PathMark[]): string[] => [...new Set(marks.map((m) => m.figure))];

/** Where the path leaves a mark's panel, in that panel's chart units. */
function exitOf(m: PathMark): number {
  switch (m.kind) {
    case 'curve_family':
    case 'single_curve':
      return m.output;
    case 'scale_pair':
      return m.to;
    case 'guideline_panel':
      return m.exit;
  }
}

describe('figure marks', () => {
  test('B2-3 on the sample marks gw, cg, di, slope, wind with the numbers its read blocks took and gave', () => {
    const { run, marks } = tracePaths(plain((ctx) => takeoffDistance(ctx, b23, B23_SAMPLE)));
    assert.deepEqual(where(marks), ['B2-3/gw', 'B2-3/cg', 'B2-3/di', 'B2-3/slope', 'B2-3/wind']);

    const gw = valueOf(curveFamily(panel(b23, 'gw', 'curve_family'), 'B2-3', 3.16, 33));
    const expected: PathMark[] = [
      { kind: 'curve_family', figure: 'B2-3', panel: 'gw', input: 3.16, param: 33, output: gw },
    ];
    let entry = gw;
    for (const [id, family, target] of [
      ['cg', 'all', 37],
      ['di', 'all', 150],
      ['slope', 'uphill', 1],
      ['wind', 'headwind', 10],
    ] as const) {
      const p = panel(b23, id, 'guideline_panel');
      const exit = valueOf(guidelinePanel(p, 'B2-3', family, entry, target));
      expected.push({
        kind: 'guideline_panel',
        figure: 'B2-3',
        panel: id,
        family,
        baseline: p.baseline,
        entry,
        target,
        exit,
      });
      entry = exit;
    }
    assert.deepEqual(marks, expected);
    assert.equal(entry * 1000, valueOf(run.outputs.distanceFt));
  });

  test('a skipped guideline panel (zero slope, zero wind) is not marked', () => {
    const { marks } = tracePaths(
      plain((ctx) => takeoffDistance(ctx, b23, { ...B23_SAMPLE, slopePct: 0, headwindKt: 0 })),
    );
    assert.deepEqual(where(marks), ['B2-3/gw', 'B2-3/cg', 'B2-3/di']);
  });

  test('a panel out of chart is not marked, and nothing after it', () => {
    assert.deepEqual(
      tracePaths(plain((ctx) => takeoffDistance(ctx, b23, { ...B23_SAMPLE, grossWeightLb: 52000 }))).marks,
      [],
    );
    // A 15 kt tailwind past the 10,000 ft line: CG and DI at their baselines still read (and mark), slope is skipped.
    const long = { ...B23_SAMPLE, takeoffFactor: 4.6, grossWeightLb: 40000, cgPct: 35, dragIndex: 0, slopePct: 0 };
    const wind = tracePaths(plain((ctx) => takeoffDistance(ctx, b23, { ...long, headwindKt: -15 })));
    assert.equal(wind.run.outputs.distanceFt.ok, false);
    assert.deepEqual(where(wind.marks), ['B2-3/gw', 'B2-3/cg', 'B2-3/di']);
  });

  test('B2-1 marks the MIL curves, then the AB scale beside the MIL reading', () => {
    const { run, marks } = tracePaths(plain((ctx) => takeoffFactor(ctx, b21, { tempC: 40, paFt: 2000 })));
    const mil = valueOf(run.outputs.tofMil);
    assert.deepEqual(marks, [
      { kind: 'curve_family', figure: 'B2-1', panel: 'pa', input: 40, param: 2000, output: mil },
      { kind: 'scale_pair', figure: 'B2-1', panel: 'ab', from: mil, to: valueOf(run.outputs.tofAb) },
    ]);
  });

  test('B7-2 sheet 1 marks temp then gw; a carried position the GW curves miss keeps only temp', () => {
    const ok = tracePaths(plain((ctx) => ({ rollFt: groundRollUncorrected(ctx, b72s1, LANDING).rollFt })));
    assert.deepEqual(where(ok.marks), ['B7-2.sh1/temp', 'B7-2.sh1/gw']);
    const [temp, gw] = ok.marks;
    assert.ok(temp?.kind === 'curve_family' && gw?.kind === 'curve_family');
    assert.equal(gw.input, temp.output, 'the carried position enters the GW curves');
    assert.equal(gw.output * 1000, valueOf(ok.run.outputs.rollFt));

    const hot = { ...LANDING, paFt: 8000, tempC: 50 };
    const stopped = tracePaths(plain((ctx) => ({ rollFt: groundRollUncorrected(ctx, b72s1, hot).rollFt })));
    assert.equal(stopped.run.outputs.rollFt.ok, false);
    assert.deepEqual(where(stopped.marks), ['B7-2.sh1/temp']);
  });
});

describe('tracePaths on the chains', () => {
  test('the MIL takeoff chain crosses B2-1, B2-2, B2-3, B2-4, then the B2-5 sheets of its RCRs', () => {
    const { marks } = tracePaths(takeoffChain(TAKEOFF_FIGURES, SAMPLE, 'mil'));
    assert.deepEqual(figures(marks), ['B2-1', 'B2-2', 'B2-3', 'B2-4', 'B2-5.sh1', 'B2-5.sh2']);
    assert.deepEqual(
      where(marks.filter((m) => m.figure === 'B2-5.sh1')),
      ['gw', 'runway', 'wind', 'slope'].map((p) => `B2-5.sh1/${p}`),
    );
  });

  test('MAX AB reads B2-6; a dry RCR between 8 and 16 reads sheet 1 and the snow chart of sheet 3', () => {
    const { marks } = tracePaths(takeoffChain(TAKEOFF_FIGURES, at({ rcrDry: 12 }), 'ab'));
    assert.deepEqual(figures(marks), ['B2-1', 'B2-2', 'B2-3', 'B2-4', 'B2-6.sh1', 'B2-6.sh3', 'B2-6.sh2']);
    assert.deepEqual(where(marks.filter((m) => m.figure === 'B2-6.sh3' && m.kind === 'curve_family')), [
      'B2-6.sh3/gw_snow',
      'B2-6.sh3/runway_snow',
    ]);
  });

  test('each refusal mark chain is continuous: a panel enters where the previous one left', () => {
    const { marks } = tracePaths(takeoffChain(TAKEOFF_FIGURES, SAMPLE, 'mil'));
    const sheet = marks.filter((m) => m.figure === 'B2-5.sh1');
    for (let i = 1; i < sheet.length; i++) {
      const m = sheet[i];
      const prev = sheet[i - 1];
      assert.ok(m !== undefined && prev !== undefined);
      const entry = m.kind === 'guideline_panel' ? m.entry : m.kind === 'curve_family' ? m.input : NaN;
      assert.equal(entry, exitOf(prev), `${m.panel} enters at ${prev.panel}'s exit`);
    }
  });

  test('a landing chain crosses B7-1, B7-2 sheet 1, B7-2 sheet 2', () => {
    for (const surface of ['dry', 'wet'] as const) {
      const { marks } = tracePaths(landingChain(LANDING_FIGURES, LANDING, surface));
      assert.deepEqual(figures(marks), ['B7-1', 'B7-2.sh1', 'B7-2.sh2']);
      assert.deepEqual(where(marks.filter((m) => m.figure === 'B7-1')), ['B7-1/final_approach', 'B7-1/touchdown']);
      assert.equal(marks.find((m) => m.figure === 'B7-2.sh2')?.panel, surface === 'wet' ? 'rcr_wet' : 'rcr_dry');
    }
  });

  test('a landing chain stopped on sheet 1 has no mark after the stop', () => {
    const { run, marks } = tracePaths(landingChain(LANDING_FIGURES, { ...LANDING, paFt: 8000, tempC: 50 }, 'dry'));
    assert.equal(run.outputs.distance.ok, false);
    assert.deepEqual(where(marks).slice(-1), ['B7-2.sh1/temp']);
    assert.ok(!marks.some((m) => m.figure === 'B7-2.sh2'));
  });

  test('a takeoff chain whose takeoff factor is out of chart marks nothing after B2-2', () => {
    const { marks } = tracePaths(takeoffChain(TAKEOFF_FIGURES, at({ tempC: 70 }), 'mil'));
    assert.deepEqual(figures(marks), ['B2-2']);
  });

  test('tracePaths gives the outputs and side of runExact', () => {
    const chains: Chain<string, unknown>[] = [
      takeoffChain(TAKEOFF_FIGURES, SAMPLE, 'mil'),
      takeoffChain(TAKEOFF_FIGURES, at({ grossWeightLb: 33700, rcrDry: 12 }), 'ab'),
      takeoffChain(TAKEOFF_FIGURES, at({ tempC: 70 }), 'mil'),
      landingChain(LANDING_FIGURES, LANDING, 'wet'),
      landingChain(LANDING_FIGURES, { ...LANDING, paFt: 8000, tempC: 50 }, 'dry'),
    ];
    for (const chain of chains) assert.deepEqual(tracePaths(chain).run, runExact(chain).run);
  });
});
