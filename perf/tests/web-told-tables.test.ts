/**
 * The TOLD tables' rows and lines (TOLD 1.8 "Cells", "Rule lines", "Reason lines"), on the mockup's field with the
 * manual's worked example loadout (drag index 146).
 */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';

import { buildCatalogue } from '../src/core/dragindex/catalogue.ts';
import type { StoreRow } from '../src/core/dragindex/catalogue.ts';
import type { Loadout, LoadoutRow } from '../src/core/dragindex/loadout.ts';
import { deriveInputs } from '../src/core/inputs/derive.ts';
import { DEFAULT_INPUTS } from '../src/core/inputs/inputs.ts';
import type { Inputs } from '../src/core/inputs/inputs.ts';
import { computeTold } from '../src/core/told/told.ts';
import { computeInputs } from '../src/web/told/field-text.ts';
import { figureHref, figureOf } from '../src/web/told/links.ts';
import { landingRows, takeoffRows } from '../src/web/told/table-cells.ts';
import type { RowModel } from '../src/web/told/table-cells.ts';
import { accelLabel, landingLines, takeoffLines } from '../src/web/told/table-lines.ts';

import { DATASET_DIR, loadFigureSet } from './helpers/data.ts';

const FIGURES = loadFigureSet(
  readdirSync(DATASET_DIR)
    .filter((name) => name.endsWith('.json') && name !== 'manifest.json')
    .map((name) => name.slice(0, -'.json'.length)),
);
const cat = buildCatalogue(FIGURES);

function storeKey(name: string, stationsText: string, group: string | null = null): string {
  const found = cat.stores.filter((s) => s.name === name && s.group === group && s.key.endsWith(`|${stationsText}`));
  assert.equal(found.length, 1);
  return (found[0] as StoreRow).key;
}

const row = (stations: LoadoutRow['stations'], key: string, suspension: string | null): LoadoutRow => ({
  stations,
  storeKey: key,
  suspension,
  count: stations.length,
});

const WORKED_EXAMPLE: Loadout = [
  row(['1', '9'], storeKey('AIM-9L, M, S', '1 OR 9'), 'LAU-129/A LAUNCHER'),
  row(['2', '8'], storeKey('AIM-9L, M, S', '2,3,7, OR 8'), 'LAU-129/A LAUNCHER + ADAPTER (16S301)'),
  row(['3', '7'], storeKey('MK 84 LDGP', '3,4,6, OR 7'), 'WEAPON PYLON* (16S1700)'),
  row(['4', '6'], storeKey('', '4 OR 6', '370-GALLON TANK (EMPTY/FULL):'), null),
];

const MOCKUP: Inputs = {
  ...DEFAULT_INPUTS,
  takeoffGwLb: '37,240',
  landingGwLb: '28,000',
  cgPct: '',
  additionalDragIndex: '',
  runway: '21',
  headingDeg: '210',
  lengthFt: '5,900',
  nearElevFt: '1,980',
  farElevFt: '2,027',
  altimeterInHg: '29.86',
  tempC: '38.4',
  wind: '230 / 08 G15',
  rcrDry: '',
  rcrWet: '',
};

function run(typed: Inputs, loadout: Loadout = WORKED_EXAMPLE) {
  const inputs = computeInputs(typed);
  return { told: computeTold(FIGURES, inputs, loadout), derived: deriveInputs(inputs) };
}

const values = (rows: RowModel[], label: string) => {
  const r = rows.find((x) => x.kind === 'values' && x.label === label);
  assert.ok(r?.kind === 'values', label);
  return r.cells;
};

test('takeoff rows: speeds, distances, runway used, the distance marked red with its rule line', () => {
  const { told, derived } = run(MOCKUP);
  const rows = takeoffRows(told, derived);
  assert.deepEqual(
    rows.map((r) => (r.kind === 'values' ? r.label : r.title)),
    [
      'Rotation, KIAS',
      'Takeoff speed, KIAS',
      'Takeoff distance, ft',
      'Runway used, %',
      'Accel. check at 2,000 ft, KIAS',
      'Refusal speed, dry, KIAS',
      'Refusal speed, wet, KIAS',
    ],
  );
  const distance = values(rows, 'Takeoff distance, ft');
  assert.match(distance[0]?.text ?? '', /^\d{1,2},\d{3}$/);
  assert.equal(distance[0]?.className, 'num exact alert');
  assert.equal(distance[1]?.className, 'num cons alert');
  assert.match(values(rows, 'Runway used, %')[0]?.text ?? '', /^\d+\.\d$/);
  assert.equal(values(rows, 'Runway used, %')[0]?.className, 'num exact alert');
  // Each rule once per column, the exact mark's percentage.
  assert.deepEqual(
    takeoffLines(told, derived, FIGURES).map((l) => l.text),
    [
      'MIL roll 97.3 % of runway: over 50 %, afterburner takeoff required (para. 3.6.6)',
      'MIL roll 97.3 % of runway: over 80 % (para. 3.6.3)',
    ],
  );
  assert.deepEqual(
    landingLines(told, derived, FIGURES).map((l) => l.text),
    [
      'Landing roll, normal wet, 98.4 % of runway: over 80 % (para. 3.18)',
      'Landing roll, heavyweight wet, 131.9 % of runway: over 80 % (para. 3.18)',
    ],
  );
});

test('a conservative-only mark names "conservative" after its column', () => {
  const { told, derived } = run({ ...MOCKUP, lengthFt: '5,750', farElevFt: '1,980' }, []);
  assert.ok(
    landingLines(told, derived, FIGURES).some(
      (l) => l.text === 'Landing roll, heavyweight dry conservative, 80.3 % of runway: over 80 % (para. 3.18)',
    ),
  );
});

const SEA_LEVEL = { ...MOCKUP, tempC: '0', nearElevFt: '0', farElevFt: '0', altimeterInHg: '29.92', wind: '210/00' };

test('the acceleration check label names both distances when MIL and MAX AB differ', () => {
  const { told, derived } = run({ ...SEA_LEVEL, takeoffGwLb: '30,000' }, []);
  const accel = takeoffRows(told, derived)[4];
  assert.equal(accel?.kind === 'values' ? accel.label : null, 'Accel. check at 2,000 / 1,000 ft, KIAS');
});

test('a conservative cell checked at the other distance gives its grey line', () => {
  const { told, derived } = run({ ...SEA_LEVEL, takeoffGwLb: '29,300' }, []);
  assert.equal(accelLabel(told), 'Accel. check at 1,000 ft, KIAS');
  assert.deepEqual(
    takeoffLines(told, derived, FIGURES)
      .filter((l) => l.text.includes('checked'))
      .map((l) => l.text),
    ['MIL conservative: checked at 2,000 ft'],
  );
});

test('landing rows: subheadings with the weights; an unparsed landing GW gives "—" and no reason', () => {
  const { told, derived } = run({ ...MOCKUP, landingGwLb: '28,0O0' });
  const normal = landingRows(told, derived, 'normal');
  assert.deepEqual(normal[0], { kind: 'subheading', title: 'Normal', weight: null, groupStart: false });
  for (const cell of values(normal, 'Final approach, KIAS')) assert.equal(cell.text, '—');
  const heavy = landingRows(told, derived, 'heavy');
  assert.deepEqual(heavy[0], { kind: 'subheading', title: 'Heavyweight', weight: '37,240 lb', groupStart: true });
  assert.match(values(heavy, 'Final approach, KIAS')[0]?.text ?? '', /^\d{3}\.\d$/);
  assert.match(values(heavy, 'Final approach, KIAS')[1]?.text ?? '', /^\d{3}$/);
});

const rcrLinesOf = (typed: Inputs): string[] => {
  const { told, derived } = run(typed);
  return landingLines(told, derived, FIGURES)
    .filter((l) => l.figure === null && l.text.startsWith('RCR'))
    .map((l) => l.text);
};

test('RCR below 10: one rule line under the landing table, both values when dry and wet differ', () => {
  assert.deepEqual(rcrLinesOf({ ...MOCKUP, rcrWet: '8' }), ['RCR 8 at the landing field: below 10 (para. 3.18)']);
  assert.deepEqual(rcrLinesOf({ ...MOCKUP, rcrDry: '6', rcrWet: '4' }), [
    'RCR 6 / 4 at the landing field: below 10 (para. 3.18)',
  ]);
  assert.deepEqual(rcrLinesOf({ ...MOCKUP, rcrDry: '6', rcrWet: '6' }), [
    'RCR 6 at the landing field: below 10 (para. 3.18)',
  ]);
  assert.deepEqual(rcrLinesOf(MOCKUP), []);
});

test('a reason line names its figure and the view its link opens', () => {
  const { told, derived } = run({ ...MOCKUP, takeoffGwLb: '52,000' });
  const lines = takeoffLines(told, derived, FIGURES);
  const b23 = lines.find((l) => l.figure?.label === 'B2-3');
  assert.deepEqual(b23, {
    figure: { label: 'B2-3', id: 'B2-3', view: 'takeoff' },
    text: 'gross weight 52,000 lb outside the drawn range 20,000–48,000 lb',
  });
});

test('figure links carry the state, the figure without its sheet and the view', () => {
  assert.equal(figureOf('B2-6.sh2'), 'B2-6');
  const href = figureHref({ inputs: DEFAULT_INPUTS, loadout: [] }, 'B2-6.sh2', 'takeoff');
  assert.match(href, /^figure\.html#v=1&.*&lo=&fig=B2-6&view=takeoff$/);
});

test('half-finished values never throw', () => {
  for (const text of ['', '3', '37,', '-', '.', '1e9', '999999999', '0', '-0', ',', '230 / 0', '230 /', '/', '23 / ']) {
    for (const field of Object.keys(MOCKUP) as (keyof Inputs)[]) {
      const { told, derived } = run({ ...MOCKUP, [field]: text });
      takeoffRows(told, derived);
      landingRows(told, derived, 'normal');
      landingRows(told, derived, 'heavy');
      takeoffLines(told, derived, FIGURES);
      landingLines(told, derived, FIGURES);
    }
  }
});
