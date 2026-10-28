import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { panel } from '../src/core/data/panel.ts';
import type { CurveFamily, FigureFile, GuidelinePanel, ScalePair, SingleCurve, Table } from '../src/core/data/types.ts';
import { curveFamily } from '../src/core/read/curve-family.ts';
import { guidelinePanel } from '../src/core/read/guideline-panel.ts';
import { drawnRange, EDGE_TOLERANCE, interp, interpWithin } from '../src/core/read/interp.ts';
import { scalePair } from '../src/core/read/scale-pair.ts';
import { singleCurve } from '../src/core/read/single-curve.ts';
import { tableCell } from '../src/core/read/table.ts';
import { outOfChart, type Read } from '../src/core/result.ts';

/** The value of an ok read; fails the test on an OutOfChart. */
function valueOf<T>(read: Read<T>): T {
  assert.ok(read.ok, read.ok ? '' : JSON.stringify(read.error));
  return read.value;
}

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${String(actual)} is not ${String(expected)}`);
}

const q = (name: string, unit = ''): { name: string; unit: string } => ({ name, unit });

describe('interp', () => {
  const points = [
    [0, 1],
    [5, 1.5],
    [10, 2.2],
  ] as const;

  test('returns the endpoint values at both endpoints', () => {
    assert.equal(interp(points, 0), 1);
    assert.equal(interp(points, 10), 2.2);
  });

  test('returns a drawn point exactly and interpolates linearly between points', () => {
    assert.equal(interp(points, 5), 1.5);
    near(interp(points, 2.5) ?? NaN, 1.25);
    near(interp(points, 7.5) ?? NaN, 1.85);
  });

  test('returns undefined just outside the drawn ends, and for NaN', () => {
    assert.equal(interp(points, -1e-9), undefined);
    assert.equal(interp(points, 10 + 1e-9), undefined);
    assert.equal(interp(points, NaN), undefined);
  });

  test('a vertical step reads its first point', () => {
    assert.equal(
      interp(
        [
          [0, 1],
          [5, 2],
          [5, 3],
          [10, 4],
        ],
        5,
      ),
      2,
    );
  });

  test('drawnRange gives the first and last input', () => {
    assert.deepEqual(drawnRange(points), [0, 10]);
  });

  test('drawnRange of no points is a data defect', () => {
    assert.throws(() => drawnRange([]), Error);
  });

  test('interpWithin clamps within the tolerance and refuses beyond it', () => {
    assert.equal(interpWithin(points, 10.01, 0.02), 2.2);
    assert.equal(interpWithin(points, -0.01, 0.02), 1);
    assert.equal(interpWithin(points, 10.03, 0.02), undefined);
    assert.equal(interpWithin(points, NaN, 0.02), undefined);
  });

  test('EDGE_TOLERANCE is 0.2 % of the drawn span (R1)', () => {
    assert.equal(EDGE_TOLERANCE, 0.002);
  });
});

describe('curveFamily', () => {
  // Union input span 0..10, so the edge tolerance is 0.02. The param 2 curve stops at 5.
  const family: CurveFamily = {
    id: 'tof',
    type: 'curve_family',
    input: q('temperature', 'C'),
    output: q('tof'),
    param: q('pressure_altitude', '1000 ft'),
    curves: [
      {
        param: -2,
        points: [
          [0, 10],
          [10, 20],
        ],
      },
      {
        param: 0,
        points: [
          [0, 20],
          [10, 30],
        ],
      },
      {
        param: 2,
        points: [
          [0, 30],
          [5, 35],
        ],
      },
      {
        param: 4,
        points: [
          [0, 40],
          [10, 50],
        ],
      },
    ],
    axes: {},
  };

  test('a param exactly equal to the last value reads the last curve', () => {
    near(valueOf(curveFamily(family, 'B2-1', 3, 4)), 43);
  });

  test('a param exactly equal to the first value reads the first curve', () => {
    near(valueOf(curveFamily(family, 'B2-1', 3, -2)), 13);
  });

  test('a negative param between -2 and 0 interpolates linearly in param', () => {
    near(valueOf(curveFamily(family, 'B2-1', 4, -1)), 19);
  });

  test('a param outside the curves gives OutOfChart on the param with the param range', () => {
    assert.deepEqual(curveFamily(family, 'B2-1', 3, 4.5), outOfChart('B2-1', 'pressure_altitude', 4.5, [-2, 4]));
    assert.deepEqual(curveFamily(family, 'B2-1', 3, -2.5), outOfChart('B2-1', 'pressure_altitude', -2.5, [-2, 4]));
  });

  test('an input outside a bracketing curve gives OutOfChart on the input with their common range', () => {
    assert.deepEqual(curveFamily(family, 'B2-1', 8, 3), outOfChart('B2-1', 'temperature', 8, [0, 5]));
    assert.deepEqual(curveFamily(family, 'B2-1', -1, -1), outOfChart('B2-1', 'temperature', -1, [0, 10]));
  });

  test('an input outside a non-bracketing curve but inside both bracketing ones reads', () => {
    near(valueOf(curveFamily(family, 'B2-1', 8, -1)), 23);
  });

  test('tolerance/2 beyond a drawn end reads the end value; 2 x tolerance gives OutOfChart (R1)', () => {
    const tolerance = EDGE_TOLERANCE * 10;
    near(valueOf(curveFamily(family, 'B2-1', -tolerance / 2, -2)), 10);
    near(valueOf(curveFamily(family, 'B2-1', 10 + tolerance / 2, 0)), 30);
    assert.deepEqual(
      curveFamily(family, 'B2-1', 10 + 2 * tolerance, 0),
      outOfChart('B2-1', 'temperature', 10 + 2 * tolerance, [0, 10]),
    );
  });

  test('the tolerance is taken from the union of all curves, not the bracketing pair', () => {
    // The param 2 curve spans 0..5 alone; tolerance/2 of the union span (0.01) beyond it reads.
    near(valueOf(curveFamily(family, 'B2-1', 5.01, 2)), 35);
  });

  test('a NaN param or input gives OutOfChart', () => {
    assert.equal(curveFamily(family, 'B2-1', 3, NaN).ok, false);
    assert.equal(curveFamily(family, 'B2-1', NaN, 1).ok, false);
  });

  test('a family of one curve reads at its own param only', () => {
    const one: CurveFamily = { ...family, curves: [family.curves[1] ?? { param: 0, points: [] }] };
    near(valueOf(curveFamily(one, 'B2-1', 5, 0)), 25);
    assert.deepEqual(curveFamily(one, 'B2-1', 5, 1), outOfChart('B2-1', 'pressure_altitude', 1, [0, 0]));
  });

  test('a family with no curves is a data defect', () => {
    assert.throws(() => curveFamily({ ...family, curves: [] }, 'B2-1', 5, 0), Error);
  });
});

describe('singleCurve', () => {
  const curve: SingleCurve = {
    id: 'v',
    type: 'single_curve',
    input: q('gross_weight', '1000 lb'),
    output: q('speed', 'kt'),
    points: [
      [0, 1],
      [10, 2.2],
    ],
    axes: {},
  };

  test('reads inside the curve', () => {
    near(valueOf(singleCurve(curve, 'B2-2', 5)), 1.6);
  });

  test('tolerance/2 beyond a drawn end reads the end value; 2 x tolerance gives OutOfChart (R1)', () => {
    const tolerance = EDGE_TOLERANCE * 10;
    assert.equal(valueOf(singleCurve(curve, 'B2-2', 10 + tolerance / 2)), 2.2);
    assert.equal(valueOf(singleCurve(curve, 'B2-2', -tolerance / 2)), 1);
    assert.deepEqual(
      singleCurve(curve, 'B2-2', 10 + 2 * tolerance),
      outOfChart('B2-2', 'gross_weight', 10 + 2 * tolerance, [0, 10]),
    );
  });
});

describe('guidelinePanel', () => {
  // Param span 30..40, so the edge tolerance is 0.02.
  const lines = (...outputs: [number, number, number][]): [number, number][][] =>
    outputs.map(([at30, at35, at40]) => [
      [30, at30],
      [35, at35],
      [40, at40],
    ]);
  const cg: GuidelinePanel = {
    id: 'cg',
    type: 'guideline_panel',
    input: q('cg', '% MAC'),
    output: q('distance', 'ft'),
    baseline: 35,
    families: { all: lines([900, 1000, 1100], [1800, 2000, 2200], [2700, 3000, 3300]) },
    axes: {},
  };

  test('an entry exactly on a guideline at the baseline follows that line', () => {
    near(valueOf(guidelinePanel(cg, 'B2-3', 'all', 2000, 40)), 2200);
    near(valueOf(guidelinePanel(cg, 'B2-3', 'all', 1000, 30)), 900);
    near(valueOf(guidelinePanel(cg, 'B2-3', 'all', 3000, 40)), 3300);
  });

  test('an entry between two lines keeps its fraction between them', () => {
    near(valueOf(guidelinePanel(cg, 'B2-3', 'all', 1500, 40)), 1650);
    near(valueOf(guidelinePanel(cg, 'B2-3', 'all', 2500, 32.5)), 2375);
  });

  test('a target equal to the baseline returns the entry before any line check', () => {
    assert.deepEqual(guidelinePanel(cg, 'B2-3', 'all', 1500, 35), { ok: true, value: 1500 });
    assert.deepEqual(guidelinePanel(cg, 'B2-3', 'all', 500, 35), { ok: true, value: 500 });
  });

  test('an entry outside the outermost lines gives OutOfChart on the output', () => {
    assert.deepEqual(guidelinePanel(cg, 'B2-3', 'all', 999, 40), outOfChart('B2-3', 'distance', 999, [1000, 3000]));
    assert.deepEqual(guidelinePanel(cg, 'B2-3', 'all', 3001, 40), outOfChart('B2-3', 'distance', 3001, [1000, 3000]));
  });

  test('a target beyond every line gives OutOfChart on the input', () => {
    assert.deepEqual(guidelinePanel(cg, 'B2-3', 'all', 2000, 41), outOfChart('B2-3', 'cg', 41, [30, 40]));
    assert.deepEqual(guidelinePanel(cg, 'B2-3', 'all', 2000, 29), outOfChart('B2-3', 'cg', 29, [30, 40]));
  });

  test('tolerance/2 beyond a drawn end reads the end value; 2 x tolerance gives OutOfChart (R1)', () => {
    const tolerance = EDGE_TOLERANCE * 10;
    near(valueOf(guidelinePanel(cg, 'B2-3', 'all', 2000, 40 + tolerance / 2)), 2200);
    assert.deepEqual(
      guidelinePanel(cg, 'B2-3', 'all', 2000, 40 + 2 * tolerance),
      outOfChart('B2-3', 'cg', 40 + 2 * tolerance, [30, 40]),
    );
  });

  test('a line drawn a hair short of the baseline is usable within the tolerance (R1)', () => {
    const short: GuidelinePanel = {
      ...cg,
      families: {
        all: [
          [
            [35.01, 1000],
            [40, 1100],
          ],
          ...lines([1800, 2000, 2200]),
        ],
      },
    };
    near(valueOf(guidelinePanel(short, 'B2-3', 'all', 1500, 40)), 1650);
  });

  test('only the lines that cover the target are used; their range is the drawn range', () => {
    // The lowest and highest lines stop at 38: at 39 only the middle line is left.
    const partial: GuidelinePanel = {
      ...cg,
      families: {
        all: [
          [
            [30, 900],
            [38, 1060],
          ],
          ...lines([1800, 2000, 2200]),
          [
            [30, 2700],
            [38, 3180],
          ],
        ],
      },
    };
    near(valueOf(guidelinePanel(partial, 'B2-3', 'all', 1500, 38)), 1590);
    assert.deepEqual(guidelinePanel(partial, 'B2-3', 'all', 1500, 39), outOfChart('B2-3', 'cg', 39, [30, 38]));
  });

  test('two usable lines but an entry outside them gives OutOfChart on the output', () => {
    const partial: GuidelinePanel = {
      ...cg,
      families: {
        all: [
          ...lines([900, 1000, 1100], [1800, 2000, 2200]),
          [
            [30, 2700],
            [38, 3180],
          ],
        ],
      },
    };
    assert.deepEqual(
      guidelinePanel(partial, 'B2-3', 'all', 2500, 39),
      outOfChart('B2-3', 'distance', 2500, [1000, 2000]),
    );
  });

  test('lines that fall with the param are sorted by their output at the baseline', () => {
    const falling: GuidelinePanel = {
      ...cg,
      families: { all: lines([3300, 3000, 2700], [1100, 1000, 900]) },
    };
    near(valueOf(guidelinePanel(falling, 'B2-3', 'all', 2000, 40)), 1800);
  });

  test('the tolerance is taken from all families together', () => {
    // Family "near" spans 0..10, "far" 0..100: the tolerance is 0.2, so 10.1 reads on "near".
    const wind: GuidelinePanel = {
      ...cg,
      baseline: 0,
      families: {
        near: [
          [
            [0, 1000],
            [10, 1100],
          ],
          [
            [0, 2000],
            [10, 2200],
          ],
        ],
        far: [
          [
            [0, 1000],
            [100, 500],
          ],
          [
            [0, 2000],
            [100, 1000],
          ],
        ],
      },
    };
    near(valueOf(guidelinePanel(wind, 'B2-3', 'near', 1500, 10.1)), 1650);
    assert.equal(guidelinePanel(wind, 'B2-3', 'near', 1500, 10.5).ok, false);
  });

  test('an unknown family is a data defect', () => {
    assert.throws(() => guidelinePanel(cg, 'B2-3', 'uphill', 2000, 40), /uphill/);
  });

  test('a NaN entry or target gives OutOfChart', () => {
    assert.equal(guidelinePanel(cg, 'B2-3', 'all', NaN, 40).ok, false);
    assert.equal(guidelinePanel(cg, 'B2-3', 'all', 2000, NaN).ok, false);
  });
});

describe('scalePair', () => {
  const pair: ScalePair = {
    id: 'ab',
    type: 'scale_pair',
    from: q('tof_mil'),
    to: q('tof_ab'),
    a: 0.5,
    b: 0.1,
    range: [1, 3],
    axes: {},
  };

  test('maps from to to = a * from + b', () => {
    near(valueOf(scalePair(pair, 'B2-1', 2)), 1.1);
  });

  test('tolerance/2 beyond the drawn scale reads its end; 2 x tolerance gives OutOfChart on to (R2)', () => {
    const tolerance = EDGE_TOLERANCE * 2;
    const fromFor = (to: number): number => (to - pair.b) / pair.a;
    near(valueOf(scalePair(pair, 'B2-1', fromFor(3 + tolerance / 2))), 3);
    near(valueOf(scalePair(pair, 'B2-1', fromFor(1 - tolerance / 2))), 1);
    const read = scalePair(pair, 'B2-1', fromFor(3 + 2 * tolerance));
    assert.ok(!read.ok);
    assert.equal(read.error.input, 'tof_ab');
    near(read.error.value, 3 + 2 * tolerance);
    assert.deepEqual(read.error.drawnRange, [1, 3]);
  });

  test('a NaN from gives OutOfChart', () => {
    assert.equal(scalePair(pair, 'B2-1', NaN).ok, false);
  });
});

describe('tableCell', () => {
  const stores: Table = {
    id: 'stores',
    type: 'table',
    columns: [q('group'), q('store'), q('station'), q('drag_index'), q('weight', 'lb')],
    rows: [
      [null, 'AIM-120B', '1 OR 9', 0, 335],
      [null, 'AIM-120B', '2,3,7, OR 8', 4, 335],
      ['370 GAL TANK:', 'NO STORES AT 3 OR 7', '4 OR 6', 27, null],
      ['600 GAL TANK:', 'NO STORES AT 3 OR 7', '4 OR 6', 20, '13/8'],
    ],
  };

  test('a hit on every key column returns the cell', () => {
    assert.deepEqual(tableCell(stores, 'B1-1.sh1', { store: 'AIM-120B', station: '2,3,7, OR 8' }, 'drag_index'), {
      ok: true,
      value: 4,
    });
    assert.deepEqual(
      tableCell(
        stores,
        'B1-1.sh1',
        { group: '600 GAL TANK:', store: 'NO STORES AT 3 OR 7', station: '4 OR 6' },
        'weight',
      ),
      { ok: true, value: '13/8' },
    );
  });

  test('a zero cell is a value', () => {
    assert.deepEqual(tableCell(stores, 'B1-1.sh1', { store: 'AIM-120B', station: '1 OR 9' }, 'drag_index'), {
      ok: true,
      value: 0,
    });
  });

  test('a null key matches a row outside any group', () => {
    assert.deepEqual(tableCell(stores, 'B1-1.sh1', { group: null, store: 'AIM-120B', station: '1 OR 9' }, 'weight'), {
      ok: true,
      value: 335,
    });
  });

  test('a miss gives OutOfChart on the column with no drawn range', () => {
    assert.deepEqual(
      tableCell(stores, 'B1-1.sh1', { store: 'AIM-9X', station: '1 OR 9' }, 'drag_index'),
      outOfChart('B1-1.sh1', 'drag_index', NaN, null),
    );
  });

  test('a null cell gives OutOfChart on the column with no drawn range', () => {
    assert.deepEqual(
      tableCell(
        stores,
        'B1-1.sh1',
        { group: '370 GAL TANK:', store: 'NO STORES AT 3 OR 7', station: '4 OR 6' },
        'weight',
      ),
      outOfChart('B1-1.sh1', 'weight', NaN, null),
    );
  });

  test('more than one matching row is a data defect (R7)', () => {
    assert.throws(
      () => tableCell(stores, 'B1-1.sh1', { store: 'NO STORES AT 3 OR 7', station: '4 OR 6' }, 'drag_index'),
      /2 rows/,
    );
  });

  test('an unknown key or value column is a data defect', () => {
    assert.throws(() => tableCell(stores, 'B1-1.sh1', { rack: 'LAU-129' }, 'drag_index'), /rack/);
    assert.throws(() => tableCell(stores, 'B1-1.sh1', { store: 'AIM-120B' }, 'cost'), /cost/);
  });
});

describe('panel', () => {
  const figure: FigureFile = {
    schemaVersion: 1,
    id: 'X1-1',
    figure: 'X1-1',
    sheet: null,
    title: 'Fixture',
    engine: 'F110-GE-129',
    pageIndex: 0,
    printedPage: 'X1-1',
    image: { file: 'pages/X1-1.png', clipPt: [0, 0, 100, 100], pxPerPt: 2 },
    corrections: [],
    panels: [
      { id: 'stores', type: 'table', columns: [q('store')], rows: [] },
      {
        id: 'v',
        type: 'single_curve',
        input: q('w'),
        output: q('v'),
        points: [
          [0, 1],
          [1, 2],
        ],
        axes: {},
      },
    ],
  };

  test('finds a panel by id and type', () => {
    const found = panel(figure, 'v', 'single_curve');
    assert.equal(found.id, 'v');
    assert.deepEqual(found.points[1], [1, 2]);
  });

  test('a missing id is a data defect', () => {
    assert.throws(() => panel(figure, 'gw', 'single_curve'), /gw/);
  });

  test('a panel of another type is a data defect', () => {
    assert.throws(() => panel(figure, 'stores', 'single_curve'), /table/);
  });

  test('two panels with the same id are a data defect', () => {
    const twice: FigureFile = {
      ...figure,
      panels: [...figure.panels, { id: 'stores', type: 'table', columns: [], rows: [] }],
    };
    assert.throws(() => panel(twice, 'stores', 'table'), /stores/);
  });
});
