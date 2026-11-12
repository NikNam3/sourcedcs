/**
 * Which paths a figure view draws (`src/web/figure/views.ts`, TOLD 1.8 "The figure page"): the refusal sheets a dry
 * RCR reads, landing's two paths over both B7-2 sheets, merged paths, the reasons of a stopped path, and unknown views.
 */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { describe, test } from 'node:test';

import { DEFAULT_LOADOUT } from '../src/core/dragindex/loadout-row.ts';
import { DEFAULT_INPUTS } from '../src/core/inputs/inputs.ts';
import type { Inputs } from '../src/core/inputs/inputs.ts';
import { parseView, viewPaths } from '../src/web/figure/views.ts';
import type { FigureView } from '../src/web/figure/views.ts';
import type { AppState } from '../src/web/state/hash.ts';

import { DATASET_DIR, loadFigureSet } from './helpers/data.ts';

const FIGURES = loadFigureSet(
  readdirSync(DATASET_DIR)
    .filter((name) => name.endsWith('.json') && name !== 'manifest.json')
    .map((name) => name.slice(0, -'.json'.length)),
);

/** The manual's takeoff sample as typed: 2,000 ft at 29.92, 40 °C, 33,000 lb, CG 37, DI 150, 10 kt head, 1 % up. */
const SAMPLE: Inputs = {
  ...DEFAULT_INPUTS,
  takeoffGwLb: '33000',
  landingGwLb: '28000',
  cgPct: '37',
  additionalDragIndex: '150',
  runway: '21',
  headingDeg: '210',
  lengthFt: '6000',
  nearElevFt: '2000',
  farElevFt: '2060',
  altimeterInHg: '29.92',
  tempC: '40',
  wind: '210/10',
};

const state = (change: Partial<Inputs> = {}): AppState => ({
  inputs: { ...SAMPLE, ...change },
  loadout: DEFAULT_LOADOUT,
});

function view(fig: string, v: 'takeoff' | 'normal' | 'heavy', change: Partial<Inputs> = {}): FigureView {
  const result = viewPaths(FIGURES, state(change), fig, v);
  assert.ok(result !== null);
  return result;
}

describe('parseView', () => {
  test('takeoff figures take the takeoff view, landing figures normal and heavy', () => {
    assert.deepEqual(parseView('B2-3', 'takeoff'), { fig: 'B2-3', view: 'takeoff' });
    assert.deepEqual(parseView('B7-2', 'heavy'), { fig: 'B7-2', view: 'heavy' });
  });

  test('anything else is no view', () => {
    for (const [fig, v] of [
      ['B2-3', 'normal'],
      ['B7-1', 'takeoff'],
      ['B2-9', 'takeoff'],
      ['B2-3', null],
      [null, 'takeoff'],
      ['B2-5.sh1', 'takeoff'],
    ] as const) {
      assert.equal(parseView(fig, v), null, `${String(fig)} ${String(v)}`);
    }
    assert.equal(viewPaths(FIGURES, state(), 'B2-3', 'normal'), null);
  });
});

describe('takeoff views', () => {
  test('B2-3: MIL solid and MAX AB dashed, one sheet, both reaching the distance', () => {
    const v = view('B2-3', 'takeoff');
    assert.deepEqual(v.sheets, ['B2-3']);
    assert.deepEqual(
      v.paths.map((p) => [p.label, p.style]),
      [
        ['MIL', 'solid'],
        ['MAX AB', 'dashed'],
      ],
    );
    for (const p of v.paths) {
      assert.deepEqual(
        p.marks.map((m) => m.panel),
        ['gw', 'cg', 'di', 'slope', 'wind'],
      );
      assert.deepEqual(p.stoppedOn, []);
    }
    assert.deepEqual(v.reasons, []);
  });

  test('B2-5 at dry RCR 23: sheet 1 (dry) and sheet 2 (wet), MIL only', () => {
    const v = view('B2-5', 'takeoff');
    assert.deepEqual(v.sheets, ['B2-5.sh1', 'B2-5.sh2']);
    assert.deepEqual(v.notes, []);
    assert.deepEqual(
      v.paths.map((p) => p.label),
      ['MIL'],
    );
  });

  test('B2-5 at dry RCR 12: sheet 1 above sheet 3, then the wet sheet 2', () => {
    const v = view('B2-5', 'takeoff', { rcrDry: '12' });
    assert.deepEqual(v.sheets, ['B2-5.sh1', 'B2-5.sh3', 'B2-5.sh2']);
    assert.deepEqual(v.notes, [
      {
        sheet: 'B2-5.sh3',
        text: "The TOLD value for RCR 12 lies between these two sheets' values (interpolated, Part 2).",
      },
    ]);
  });

  test('B2-6 draws MAX AB only, dashed', () => {
    const v = view('B2-6', 'takeoff');
    assert.deepEqual(
      v.paths.map((p) => [p.label, p.style]),
      [['MAX AB', 'dashed']],
    );
    assert.ok(v.sheets.every((id) => id.startsWith('B2-6.')));
  });

  test('B2-1 reads the same for both modes: one path under both labels', () => {
    const v = view('B2-1', 'takeoff');
    assert.deepEqual(
      v.paths.map((p) => [p.label, p.style]),
      [['MIL and MAX AB', 'solid']],
    );
  });

  test('a gross weight off the chart: B2-3 has no path and says why', () => {
    const v = view('B2-3', 'takeoff', { takeoffGwLb: '52000' });
    assert.deepEqual(v.sheets, ['B2-3']);
    assert.ok(v.paths.every((p) => p.marks.length === 0));
    assert.equal(v.reasons.length, 1);
    const reason = v.reasons[0];
    assert.equal(reason?.error.figure, 'B2-3');
    assert.equal(reason.error.input, 'gross_weight');
  });

  test('a path that stops inside the figure is marked stopped on that sheet', () => {
    // 40 kt of tailwind is beyond the 20 kt B2-3 draws: the path stops after the slope panel.
    const v = view('B2-3', 'takeoff', { wind: '030/40' });
    const mil = v.paths[0];
    assert.ok(mil !== undefined);
    assert.deepEqual(mil.stoppedOn, ['B2-3']);
    assert.deepEqual(
      mil.marks.map((m) => m.panel),
      ['gw', 'cg', 'di', 'slope'],
    );
    assert.ok(v.reasons.some((r) => r.error.input === 'wind'));
  });

  test('a reason from an earlier figure explains a figure with no path', () => {
    // Off B2-1's temperature range: nothing reaches B2-3, the reason names B2-1.
    const v = view('B2-3', 'takeoff', { tempC: '70' });
    assert.ok(v.paths.every((p) => p.marks.length === 0));
    assert.ok(v.reasons.length > 0 && v.reasons.every((r) => r.error.figure === 'B2-1'));
  });

  test('inputs that do not parse: no path, no reason, the first sheet', () => {
    const v = view('B2-5', 'takeoff', { takeoffGwLb: '' });
    assert.deepEqual(v.paths, []);
    assert.deepEqual(v.reasons, []);
    assert.deepEqual(v.sheets, ['B2-5.sh1']);
  });
});

describe('landing views', () => {
  test('B7-2 normal: sheet 1 above sheet 2, dry solid and wet dashed, each on both sheets', () => {
    const v = view('B7-2', 'normal');
    assert.deepEqual(v.sheets, ['B7-2.sh1', 'B7-2.sh2']);
    assert.deepEqual(
      v.paths.map((p) => [p.label, p.style]),
      [
        ['Dry', 'solid'],
        ['Wet', 'dashed'],
      ],
    );
    for (const p of v.paths) {
      assert.deepEqual([...new Set(p.marks.map((m) => m.figure))], ['B7-2.sh1', 'B7-2.sh2']);
    }
  });

  test('heavyweight reads the takeoff gross weight', () => {
    const normal = view('B7-2', 'normal');
    const heavy = view('B7-2', 'heavy');
    const gw = (v: FigureView): number | undefined => {
      const m = v.paths[0]?.marks.find((x) => x.panel === 'gw');
      return m?.kind === 'curve_family' ? m.param : undefined;
    };
    assert.equal(gw(normal), 28);
    assert.equal(gw(heavy), 33);
  });

  test('B7-1: the speeds do not depend on the surface, one path for both', () => {
    const v = view('B7-1', 'normal');
    assert.deepEqual(
      v.paths.map((p) => p.label),
      ['Dry and wet'],
    );
  });
});
