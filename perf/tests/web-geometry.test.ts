/**
 * The figure view's geometry (`src/web/figure/geometry.ts`, TOLD 1.8 "Path geometry"): a chart value through its
 * panel's transform lands on the right pixel, and the marks of a real chain become runs that start at the input
 * axis's edge, join panel to panel along the carried value, and end at the output axis's edge.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { PathMark } from '../src/core/path/mark.ts';
import { tracePaths } from '../src/core/path/trace.ts';
import { landingChain } from '../src/core/told/landing.ts';
import { takeoffChain } from '../src/core/told/takeoff.ts';
import { markPolyline, markRuns, toPx } from '../src/web/figure/geometry.ts';
import type { Px } from '../src/web/figure/geometry.ts';

import { loadFigureSet } from './helpers/data.ts';
import { at, SAMPLE, TAKEOFF_FIGURES } from './helpers/takeoff.ts';

const FIGS = { ...TAKEOFF_FIGURES, ...loadFigureSet(['B7-1', 'B7-2.sh1', 'B7-2.sh2']) };
const fig = (id: string) => {
  const f = FIGS[id];
  assert.ok(f !== undefined);
  return f;
};

const close = (actual: number, expected: number, what: string): void => {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${String(actual)} is not ${String(expected)}`);
};

function marksOf(values: typeof SAMPLE, mode: 'mil' | 'ab', figure: string): PathMark[] {
  return tracePaths(takeoffChain(TAKEOFF_FIGURES, values, mode)).marks.filter((m) => m.figure === figure);
}

/** Every step between two points moves along one page axis only, except inside a guideline panel. */
function axisAligned(a: Px, b: Px): boolean {
  return Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6;
}

describe('toPx', () => {
  test('B2-3 gw: distance 4,000 ft, takeoff factor 3.16, by hand from the transforms, clipPt and pxPerPt', () => {
    // distance: x = 36.02 * 4 + 103.958571 = 248.038571 pt; takeoff factor: y = -36.018214 * 3.16 + 388.404286
    // = 274.586730 pt; clipPt starts at (62, 120), 2 px per pt.
    const [x, y] = toPx(fig('B2-3'), 'gw', 4, 3.16);
    close(x, (248.038571 - 62) * 2, 'x');
    close(y, (274.58672976 - 120) * 2, 'y');
  });

  test('a panel with two quantities on one page axis throws', () => {
    assert.throws(() => toPx(fig('B2-1'), 'ab', 3, 2));
  });
});

describe('markRuns on the manual sample', () => {
  const b23 = fig('B2-3');
  const marks = marksOf(SAMPLE, 'mil', 'B2-3');

  test('B2-3 MIL: one run from the takeoff factor axis (left) to the distance axis (bottom), seven stations', () => {
    const runs = markRuns(b23, marks);
    assert.equal(runs.length, 1);
    const run = runs[0];
    assert.ok(run !== undefined);
    const first = run.points[0];
    const last = run.points[run.points.length - 1];
    assert.ok(first !== undefined && last !== undefined);
    const gw = marks[0];
    assert.ok(gw?.kind === 'curve_family');
    close(first[0], (104 - 62) * 2, 'starts on the gw frame left edge');
    close(first[1], toPx(b23, 'gw', gw.output, gw.input)[1], 'at the takeoff factor');
    close(last[1], (684.5 - 120) * 2, 'ends on the wind frame bottom edge');
    assert.deepEqual(
      run.stations.map((s) => `${s.role}:${s.quantity.name}`),
      [
        'entry:takeoff_factor',
        'param:gross_weight',
        'param:cg',
        'param:drag_index',
        'param:slope',
        'param:wind',
        'exit:distance',
      ],
    );
  });

  test('a guideline mark runs from (baseline, entry) to (target, exit)', () => {
    const line = markPolyline(b23, marks)[0] ?? [];
    const cg = marks.find((m) => m.panel === 'cg');
    assert.ok(cg?.kind === 'guideline_panel');
    for (const [value, param] of [
      [cg.entry, cg.baseline],
      [cg.exit, cg.target],
    ] as const) {
      const [x, y] = toPx(b23, 'cg', value, param);
      assert.ok(
        line.some((p) => Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - y) < 1e-6),
        `the path passes ${String(value)} at cg ${String(param)}`,
      );
    }
  });

  test('between panels the path moves along the carried axis only', () => {
    const run = markRuns(b23, marks)[0];
    assert.ok(run !== undefined);
    const p = run.points;
    // The entry segment, the gw curve point down to the cg baseline, and the exit segment.
    assert.ok(axisAligned(p[0] ?? [0, 0], p[1] ?? [1, 1]));
    assert.ok(axisAligned(p[1] ?? [0, 0], p[2] ?? [1, 1]));
    assert.ok(axisAligned(p[p.length - 2] ?? [0, 0], p[p.length - 1] ?? [1, 1]));
  });

  test('a stopped path draws no result at the axis', () => {
    const runs = markRuns(b23, marks, true);
    const run = runs[0];
    assert.ok(run !== undefined);
    assert.notEqual(run.stations[run.stations.length - 1]?.role, 'exit');
    const last = run.points[run.points.length - 1];
    assert.ok(last !== undefined && Math.abs(last[1] - (684.5 - 120) * 2) > 1);
  });

  test('a zero wind and slope skip their panels: the run still ends at the distance axis', () => {
    const calm = marksOf(at({ headwindKt: 0, slopePct: 0 }), 'mil', 'B2-3');
    const run = markRuns(b23, calm)[0];
    assert.ok(run !== undefined);
    close(run.points[run.points.length - 1]?.[1] ?? 0, (684.5 - 120) * 2, 'bottom edge');
  });
});

describe('markRuns on the other figures', () => {
  test('B2-1: the takeoff factor goes on from the MIL axis to the MAX AB scale', () => {
    const b21 = fig('B2-1');
    const run = markRuns(b21, marksOf(SAMPLE, 'mil', 'B2-1'))[0];
    assert.ok(run !== undefined);
    close(run.points[0]?.[0] ?? 0, (167.9 - 60) * 2, 'starts on the temperature axis');
    const last = run.points[run.points.length - 1];
    close(last?.[1] ?? 0, (666.9 - 108) * 2, 'ends on the MAX AB scale line');
    assert.deepEqual(
      run.stations.map((s) => s.quantity.name),
      ['temperature', 'pressure_altitude', 'tof_mil', 'tof_ab'],
    );
  });

  test('B2-5 sh. 1: enters from the right (takeoff factor), leaves on the right (refusal speed)', () => {
    const sh1 = fig('B2-5.sh1');
    const run = markRuns(sh1, marksOf(SAMPLE, 'mil', 'B2-5.sh1'))[0];
    assert.ok(run !== undefined);
    close(run.points[0]?.[0] ?? 0, (287.1 - 40) * 2, 'gw frame right edge');
    close(run.points[run.points.length - 1]?.[0] ?? 0, (510.6 - 40) * 2, 'slope frame right edge');
  });

  test('B2-5 sh. 1: the unscaled carry axis is page points: the GW curve point lands on x = carry, and the path goes straight up to the runway lines', () => {
    const sh1 = fig('B2-5.sh1');
    const marks = marksOf(SAMPLE, 'mil', 'B2-5.sh1');
    const gw = marks[0];
    assert.ok(gw?.kind === 'curve_family' && gw.panel === 'gw');
    const run = markRuns(sh1, marks)[0];
    assert.ok(run !== undefined);
    // carry: a 1, b 0, so the page x is the carried value itself; clipPt starts at x 40, 2 px per pt.
    close(run.points[1]?.[0] ?? 0, (gw.output - 40) * 2, 'gw point x');
    close(run.points[1]?.[1] ?? 0, toPx(sh1, 'gw', gw.output, gw.input)[1], 'gw point y');
    close(run.points[2]?.[0] ?? 0, (gw.output - 40) * 2, 'runway point on the same carry line');
    assert.ok(
      run.stations.every((s) => s.quantity.name !== 'carry'),
      'no letter on the carried axis',
    );
  });

  test('B7-1: final approach and touchdown are two runs from the gross weight axis', () => {
    const b71 = fig('B7-1');
    const values = { paFt: 2000, tempC: 40, grossWeightLb: 28000, headwindKt: 10, slopePct: 1, rcr: 23 };
    const marks = tracePaths(landingChain(FIGS, values, 'dry')).marks.filter((m) => m.figure === 'B7-1');
    const runs = markRuns(b71, marks);
    assert.equal(runs.length, 2);
    for (const run of runs) {
      close(run.points[0]?.[1] ?? 0, (566.4 - 245) * 2, 'gross weight axis at the bottom');
      close(run.points[run.points.length - 1]?.[0] ?? 0, (103.1 - 55) * 2, 'airspeed axis at the left');
    }
  });

  test('a mark of another figure throws', () => {
    assert.throws(() => markRuns(fig('B2-3'), marksOf(SAMPLE, 'mil', 'B2-1')));
  });
});
