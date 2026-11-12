import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildCatalogue, type Catalogue } from '../src/core/dragindex/catalogue.ts';
import { DEFAULT_LOADOUT, dragIndex, type DragIndex, type Loadout } from '../src/core/dragindex/loadout.ts';
import { notesText, rowModels, totalText, type RowModel } from '../src/web/told/dragindex-rows.ts';
import { filterOptions, heading, menuOptions, problemText, signed, unbreak } from '../src/web/told/dragindex-text.ts';
import { setCount, setStore, setSuspension, split } from '../src/web/told/loadout-edit.ts';
import { loadFigure } from './helpers/data.ts';

const cat: Catalogue = buildCatalogue(
  Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`B1-1.sh${String(n)}`, loadFigure(`B1-1.sh${String(n)}`)])),
);

const AIM9_TIP = '3||AIM-9L, M, S|1 OR 9';
const AIM9_WING = '3||AIM-9L, M, S|2,3,7, OR 8';
const MK84 = '6||MK 84 LDGP|3,4,6, OR 7';
const TANK370 = '7|370-GALLON TANK (EMPTY/FULL):||4 OR 6';

/** The manual's worked example (p. B1-2/B1-3): 146 in all. */
function workedExample(): Loadout {
  let l = setSuspension(setStore(DEFAULT_LOADOUT, 0, AIM9_TIP), 0, 'LAU-129/A LAUNCHER');
  l = setSuspension(setStore(l, 1, AIM9_WING), 1, 'LAU-129/A LAUNCHER + ADAPTER (16S301)');
  l = setSuspension(setStore(l, 2, MK84), 2, 'WEAPON PYLON* (16S1700)');
  return setStore(l, 3, TANK370);
}

const model = (models: readonly RowModel[], index: number): RowModel => {
  const m = models[index];
  assert.ok(m !== undefined);
  return m;
};

test('texts: true minus, the line-break hyphen dropped, headings without the colon', () => {
  assert.equal(signed(-4), '−4');
  assert.equal(signed(0), '0');
  assert.equal(unbreak('LAU-131/A ROCKET LAUNCHER- WITH:'), 'LAU-131/A ROCKET LAUNCHER WITH:');
  assert.equal(unbreak('LAU-88/A, A/A, -117/A'), 'LAU-88/A, A/A, -117/A');
  assert.equal(heading('LAU-131/A ROCKET LAUNCHER- WITH:'), 'LAU-131/A ROCKET LAUNCHER WITH');
  assert.equal(heading(null), '');
});

test('the menu: empty first, no tip missile only at 1/9, the allowed stores with rack and printed drag index', () => {
  const tip = menuOptions(cat, ['1', '9']);
  assert.deepEqual(tip[0], { key: null, text: '— empty', heading: '', rack: '', dragText: '' });
  assert.deepEqual(tip[1], { key: 'noTipMissile', text: 'NO TIP MISSILE', heading: '', rack: 'NONE', dragText: '−4' });
  assert.ok(tip.some((o) => o.key === AIM9_TIP && o.dragText === '4*' && o.rack === 'LAUNCHER'));
  const wing = menuOptions(cat, ['3', '7']);
  assert.ok(!wing.some((o) => o.key === 'noTipMissile'));
  assert.ok(!wing.some((o) => o.key === AIM9_TIP));
  assert.ok(wing.some((o) => o.text === '(7) M151' && o.heading === 'LAU-131/A ROCKET LAUNCHER WITH'));
  assert.equal(menuOptions(cat, ['4', '6']).find((o) => o.key === TANK370)?.text, '370-GALLON TANK');
  assert.equal(menuOptions(cat, ['4', '6']).find((o) => o.key === TANK370)?.dragText, 'by 3/7');
  assert.equal(menuOptions(cat, ['5']).find((o) => o.text === '300-GALLON TANK')?.dragText, 'by 4/6');
});

test('the menu filter matches heading and name, case ignored', () => {
  const wing = menuOptions(cat, ['3', '7']);
  assert.equal(filterOptions(wing, '').length, wing.length);
  const found = filterOptions(wing, 'lau-131/a rocket launcher with (7) m15');
  assert.deepEqual(
    found.map((o) => o.text),
    ['(7) M151', '(7) M156'],
  );
  assert.ok(filterOptions(wing, 'mk 84').every((o) => o.text.startsWith('MK 84')));
});

test('the worked example: 146, rows from the lines, the tank variant, the suspensions', () => {
  const l = workedExample();
  const drag = dragIndex(cat, l, 0);
  assert.ok(drag.ok);
  assert.deepEqual(totalText(drag, true), { exact: '146', conservative: null });
  const rows = rowModels(cat, l, drag);
  const tip = model(rows, 0);
  assert.equal(tip.label, '1, 9');
  assert.equal(tip.storeText, 'AIM-9L, M, S');
  assert.equal(tip.action, 'split');
  assert.deepEqual(tip.count, { value: 2, max: 2 });
  assert.equal(tip.eachText, '0');
  const susp = tip.suspension;
  assert.ok(susp !== null);
  assert.equal(susp.chosen, 'LAU-129/A LAUNCHER');
  assert.equal(susp.options.length, 2);
  assert.equal(susp.countText, '2');
  assert.equal(susp.dragText, '2');
  const mk84 = model(rows, 2);
  assert.deepEqual(mk84.count, { value: 2, max: 2 }); // PYLON: one per station
  assert.equal(mk84.dragText, '18');
  const tank = model(rows, 3);
  assert.equal(tank.storeText, '370-GALLON TANK');
  assert.equal(tank.variant, 'single racks or stores at 3 or 7');
  assert.equal(tank.suspension, null);
  const empty = model(rows, 4);
  assert.equal(empty.empty, true);
  assert.equal(empty.count, null);
  assert.equal(empty.action, null);
  assert.match(notesText(l, drag), /tip AIM-9 is in the basic aircraft/);
});

test('no tip missile: the total shows both values; a pair at count 1 names its station', () => {
  const l = setCount(setStore(DEFAULT_LOADOUT, 0, 'noTipMissile'), 0, 1);
  const drag = dragIndex(cat, l, 0);
  assert.ok(drag.ok);
  const total = totalText(drag, true);
  assert.notEqual(total?.conservative, null);
  assert.notEqual(total?.exact, total?.conservative);
  const row = model(rowModels(cat, l, drag), 0);
  assert.equal(row.eachText, '−4');
  assert.equal(row.variant, 'at 1 only');
});

test('the total is a dash while the additional drag index or the loadout does not compute', () => {
  const drag = dragIndex(cat, workedExample(), 0);
  assert.equal(totalText(drag, false), null);
  const bad: DragIndex = { ok: false, problems: [{ row: 2, code: 'unknownStore' }] };
  assert.equal(totalText(bad, true), null);
});

test('a problem row: underlined, named in the notes, an unknown key shown by its printed name', () => {
  const l = setStore(DEFAULT_LOADOUT, 2, '6||MK 99 GONE|3,4,6, OR 7');
  const drag = dragIndex(cat, l, 0);
  assert.equal(drag.ok, false);
  const rows = rowModels(cat, l, drag);
  assert.equal(model(rows, 2).problem, true);
  assert.equal(model(rows, 2).storeText, 'MK 99 GONE');
  assert.equal(model(rows, 2).eachText, '');
  assert.equal(model(rows, 1).problem, false);
  assert.equal(notesText(l, drag), 'Station 3, 7: the store is not in Fig. B1-1 of this data version.');
  assert.equal(
    problemText({ row: 0, code: 'noStations' }, [{ stations: [], storeKey: null, suspension: null, count: 0 }]),
    'A loadout row names no station.',
  );
});

test('split rows: the first offers join, the second nothing', () => {
  const l = split(workedExample(), 2);
  const rows = rowModels(cat, l, dragIndex(cat, l, 0));
  assert.equal(model(rows, 2).action, 'join');
  assert.equal(model(rows, 3).action, null);
  assert.equal(model(rows, 2).label, '3');
});

test('tank variants that differ between the stations are named per station', () => {
  let l = split(workedExample(), 2);
  l = setStore(l, 3, null); // 3 loaded, 7 empty
  const drag = dragIndex(cat, l, 0);
  assert.ok(drag.ok);
  const tank = rowModels(cat, l, drag).find((m) => m.storeText === '370-GALLON TANK');
  assert.equal(tank?.variant, '4: single racks or stores at 3 or 7; 6: no stores at 3 or 7');
});
