/**
 * `computeTold` (`told/told.ts`, TOLD 1.7): inputs, drag index, the six chains and the rules in one object. The
 * mockup's field with the manual's worked example loadout; an input that does not parse marks its chains' cells;
 * the 3.18 RCR mark on the input; reasons kept once per distinct OutOfChart and cell.
 */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { describe, test } from 'node:test';

import { buildCatalogue } from '../src/core/dragindex/catalogue.ts';
import type { StoreRow } from '../src/core/dragindex/catalogue.ts';
import type { Loadout, LoadoutRow } from '../src/core/dragindex/loadout.ts';
import { DEFAULT_INPUTS } from '../src/core/inputs/inputs.ts';
import type { Inputs } from '../src/core/inputs/inputs.ts';
import { computeTold } from '../src/core/told/told.ts';
import type { Told, ToldColumn, ToldCell } from '../src/core/told/told.ts';

import { DATASET_DIR, loadFigureSet } from './helpers/data.ts';

const FIGURES = loadFigureSet(
  readdirSync(DATASET_DIR)
    .filter((name) => name.endsWith('.json') && name !== 'manifest.json')
    .map((name) => name.slice(0, -'.json'.length)),
);
const cat = buildCatalogue(FIGURES);

function storeKey(name: string, stationsText: string, group: string | null = null): string {
  const found = cat.stores.filter((s) => s.name === name && s.group === group && s.key.endsWith(`|${stationsText}`));
  assert.equal(found.length, 1, `one store "${name}" at "${stationsText}"`);
  return (found[0] as StoreRow).key;
}

const row = (stations: LoadoutRow['stations'], key: string, suspension: string | null): LoadoutRow => ({
  stations,
  storeKey: key,
  suspension,
  count: stations.length,
});

/** The manual's worked example (p. B1-2/B1-3, Q4): drag index 146. */
const WORKED_EXAMPLE: Loadout = [
  row(['1', '9'], storeKey('AIM-9L, M, S', '1 OR 9'), 'LAU-129/A LAUNCHER'),
  row(['2', '8'], storeKey('AIM-9L, M, S', '2,3,7, OR 8'), 'LAU-129/A LAUNCHER + ADAPTER (16S301)'),
  row(['3', '7'], storeKey('MK 84 LDGP', '3,4,6, OR 7'), 'WEAPON PYLON* (16S1700)'),
  row(['4', '6'], storeKey('', '4 OR 6', '370-GALLON TANK (EMPTY/FULL):'), null),
];

/** The mockup's field (docs/mockups/perf-told.html). */
const FIELD: Inputs = {
  ...DEFAULT_INPUTS,
  takeoffGwLb: '37,240',
  landingGwLb: '28,000',
  runway: '21',
  headingDeg: '210',
  lengthFt: '5,900',
  nearElevFt: '2,000',
  farElevFt: '2,047',
  altimeterInHg: '29.92',
  tempC: '38',
  wind: '230/08G15',
};

type AnyColumn = ToldColumn<string, unknown>;

function columns(told: Told): [string, AnyColumn][] {
  return [
    ['takeoff.mil', told.takeoff.mil],
    ['takeoff.ab', told.takeoff.ab],
    ['landing.normal.dry', told.landing.normal.dry],
    ['landing.normal.wet', told.landing.normal.wet],
    ['landing.heavy.dry', told.landing.heavy.dry],
    ['landing.heavy.wet', told.landing.heavy.wet],
  ];
}

const cellsOf = (column: AnyColumn): ToldCell<unknown>[] => Object.values(column.cells);

function assertComputed(name: string, column: AnyColumn): void {
  for (const cell of cellsOf(column)) {
    assert.equal(cell.kind, 'computed', `${name}: every cell computed`);
    for (const which of ['exact', 'conservative'] as const) {
      const read = cell.cell[which];
      if (read.ok) continue;
      assert.ok(
        column.reasons.some((r) => r.cell === which && r.error.figure === read.error.figure),
        `${name}: ${which} OutOfChart ${JSON.stringify(read.error)} has a reason`,
      );
    }
  }
}

function assertUnparsed(name: string, column: AnyColumn, fields: readonly string[]): void {
  for (const cell of cellsOf(column)) {
    assert.deepEqual(cell, { kind: 'unparsed', fields }, `${name}: unparsed on ${fields.join(', ')}`);
  }
  assert.deepEqual(column.trace, []);
  assert.deepEqual(column.reasons, []);
}

describe('computeTold', () => {
  test("the mockup's field: every cell computed or OutOfChart with a reason; MIL over 50 % marks 3.6.6", () => {
    const told = computeTold(FIGURES, FIELD, WORKED_EXAMPLE);
    assert.ok(told.dragIndex.ok);
    assert.equal(told.dragIndex.exact, 146);
    for (const [name, column] of columns(told)) {
      assertComputed(name, column);
      assert.ok(column.trace.length > 0, `${name}: a trace`);
    }
    const mil = told.takeoff.mil.cells.distance;
    assert.equal(mil.kind, 'computed');
    assert.ok(mil.cell.exact.ok && mil.cell.exact.value > 2950, 'MIL distance over half of 5,900 ft');
    const rule = mil.marks.find((m) => m.rule === 'mil-roll-50' && m.cell === 'exact');
    assert.ok(rule !== undefined, 'mil-roll-50 on the exact cell');
    assert.equal(rule.paragraph, '3.6.6');
    assert.ok(mil.cell.exact.ok);
    assert.equal(rule.percent, (mil.cell.exact.value * 100) / 5900);
    // Only the distance cell carries runway marks.
    assert.deepEqual(told.takeoff.mil.cells.rotation.kind === 'computed' && told.takeoff.mil.cells.rotation.marks, []);
    assert.deepEqual(told.rcrMarks, []);
  });

  test('Review Focus 4: no landing GW → both normal columns unparsed on landingGwLb; the rest computed', () => {
    const told = computeTold(FIGURES, { ...FIELD, landingGwLb: '' }, WORKED_EXAMPLE);
    for (const [name, column] of columns(told)) {
      if (name.startsWith('landing.normal')) assertUnparsed(name, column, ['landingGwLb']);
      else assertComputed(name, column);
    }
  });

  test('Review Focus 4: a derived input names every field it lacks, once (near elevation: pa and slope)', () => {
    const told = computeTold(FIGURES, { ...FIELD, nearElevFt: 'x' }, WORKED_EXAMPLE);
    for (const [name, column] of columns(told)) assertUnparsed(name, column, ['nearElevFt']);
  });

  test('Extra 3: an additional drag index that does not parse → both takeoff columns unparsed; landing computed', () => {
    const told = computeTold(FIGURES, { ...FIELD, additionalDragIndex: 'abc' }, WORKED_EXAMPLE);
    assertUnparsed('takeoff.mil', told.takeoff.mil, ['additionalDragIndex']);
    assertUnparsed('takeoff.ab', told.takeoff.ab, ['additionalDragIndex']);
    for (const [name, column] of columns(told).slice(2)) assertComputed(name, column);
  });

  test('Extra 3: a negative additional drag index parses and is added', () => {
    const told = computeTold(FIGURES, { ...FIELD, additionalDragIndex: '-6' }, WORKED_EXAMPLE);
    assert.ok(told.dragIndex.ok);
    assert.equal(told.dragIndex.exact, 140);
    assertComputed('takeoff.mil', told.takeoff.mil);
  });

  test('an invalid loadout → both takeoff columns unparsed on loadout, the problems in dragIndex', () => {
    const bad: Loadout = [{ stations: ['3', '7'], storeKey: 'no such store', suspension: null, count: 2 }];
    const told = computeTold(FIGURES, FIELD, bad);
    assert.equal(told.dragIndex.ok, false);
    assert.ok(told.dragIndex.problems.length > 0);
    assertUnparsed('takeoff.mil', told.takeoff.mil, ['loadout']);
    assertUnparsed('takeoff.ab', told.takeoff.ab, ['loadout']);
    for (const [name, column] of columns(told).slice(2)) assertComputed(name, column);
  });

  test('Review Focus 5: RCR dry 9.5 → rcrMarks holds landing-rcr-10 once; the dry landing distances marked', () => {
    const told = computeTold(FIGURES, { ...FIELD, rcrDry: '9.5' }, WORKED_EXAMPLE);
    assert.deepEqual(told.rcrMarks, [{ rule: 'landing-rcr-10', paragraph: '3.18', cell: 'exact', field: 'rcrDry' }]);
    for (const [name, column] of columns(told).slice(2)) {
      const distance = column.cells['distance'];
      assert.ok(distance?.kind === 'computed');
      const rcr = distance.marks.filter((m) => m.rule === 'landing-rcr-10');
      assert.equal(rcr.length, name.endsWith('dry') ? 2 : 0, `${name}: the column's own RCR`);
    }
  });

  test('rcrMarks: one per RCR field below 10', () => {
    const told = computeTold(FIGURES, { ...FIELD, rcrDry: '8', rcrWet: '9' }, WORKED_EXAMPLE);
    assert.deepEqual(
      told.rcrMarks.map((m) => m.field),
      ['rcrDry', 'rcrWet'],
    );
  });

  test('no tip missiles: exact distance OutOfChart on drag_index tagged exact, conservative computed (Q1)', () => {
    const clean: Loadout = [{ stations: ['1', '9'], storeKey: 'noTipMissile', suspension: null, count: 2 }];
    const told = computeTold(FIGURES, { ...FIELD, takeoffGwLb: '25,000' }, clean);
    assert.ok(told.dragIndex.ok && told.dragIndex.exact === -4 && told.dragIndex.conservative === 4);
    const distance = told.takeoff.mil.cells.distance;
    assert.ok(distance.kind === 'computed');
    assert.ok(!distance.cell.exact.ok && distance.cell.exact.error.input === 'drag_index');
    assert.ok(distance.cell.conservative.ok);
    const reason = told.takeoff.mil.reasons.find((r) => r.error.input === 'drag_index');
    assert.ok(reason !== undefined);
    assert.equal(reason.cell, 'exact');
    assert.equal(reason.error.value, -4);
  });

  test('reasons: one per distinct OutOfChart and cell, though four cells of a column fail the same way', () => {
    const told = computeTold(FIGURES, { ...FIELD, tempC: '70' }, WORKED_EXAMPLE);
    const mil = told.takeoff.mil;
    const failed = cellsOf(mil).filter((c) => c.kind === 'computed' && !c.cell.exact.ok);
    assert.ok(failed.length >= 2, 'several cells fail on the takeoff factor');
    const keys = mil.reasons.map((r) => JSON.stringify(r));
    assert.equal(new Set(keys).size, keys.length, 'no duplicate reason');
    assert.deepEqual(
      mil.reasons.map((r) => [r.cell, r.error.figure, r.error.input]),
      [
        ['exact', 'B2-1', 'temperature'],
        ['conservative', 'B2-1', 'temperature'],
      ],
    );
  });
});
