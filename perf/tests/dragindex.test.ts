import assert from 'node:assert/strict';
import { test } from 'node:test';

import { figure, type FigureSet } from '../src/core/data/figure-set.ts';
import { panel } from '../src/core/data/panel.ts';
import {
  buildCatalogue,
  parseDrag,
  parseStations,
  storesFor,
  suspensionsFor,
  type Catalogue,
  type Station,
  type StoreRow,
} from '../src/core/dragindex/catalogue.ts';
import {
  checkLoadout,
  DEFAULT_LOADOUT,
  dragIndex,
  type DragIndex,
  type Loadout,
  type LoadoutProblem,
  type LoadoutRow,
} from '../src/core/dragindex/loadout.ts';
import { capacity, RACK_SUSPENSIONS } from '../src/core/dragindex/racks.ts';
import { loadFigure } from './helpers/data.ts';

const SHEETS = [1, 2, 3, 4, 5, 6, 7].map((n) => `B1-1.sh${String(n)}`);
const figures: FigureSet = Object.fromEntries(SHEETS.map((id) => [id, loadFigure(id)]));
const cat: Catalogue = buildCatalogue(figures);

/** The store printed with this name on these stations (the stations text as printed). */
function store(name: string, stationsText: string, group: string | null = null): StoreRow {
  const found = cat.stores.filter((s) => s.name === name && s.group === group && s.key.endsWith(`|${stationsText}`));
  assert.equal(found.length, 1, `one store "${name}" at "${stationsText}"`);
  return found[0] as StoreRow;
}
const tank = (gallons: number, stationsText: string): StoreRow =>
  store('', stationsText, `${String(gallons)}-GALLON TANK (EMPTY/FULL):`);

const row = (
  stations: Station[],
  storeKey: LoadoutRow['storeKey'],
  count = stations.length,
  suspension: string | null = null,
): LoadoutRow => ({ stations, storeKey, suspension, count });

/** The drag index of a loadout the catalogue allows. */
function computed(loadout: Loadout, additional: number): Extract<DragIndex, { ok: true }> {
  const result = dragIndex(cat, loadout, additional);
  if (!result.ok) throw new Error(`loadout problems: ${JSON.stringify(result.problems)}`);
  return result;
}

test('every B1-1 row parses: stations and drag of every store and suspension row', () => {
  let stores = 0;
  for (const id of SHEETS.slice(2)) {
    for (const r of panel(figure(figures, id), 'stores', 'table').rows) {
      assert.ok(parseStations(String(r[2])).length > 0);
      parseDrag(r[5] as string | number);
      stores += 1;
    }
  }
  const suspensionRows = panel(figure(figures, 'B1-1.sh2'), 'suspension', 'table').rows;
  for (const r of suspensionRows) {
    assert.ok(parseStations(String(r[1])).length > 0);
    parseDrag(r[4] as string | number);
  }
  assert.equal(cat.suspensions.length, suspensionRows.length);
  // The three tank groups (4 + 2 + 4 variant rows) are one store each.
  assert.equal(cat.stores.length, stores - 10 + 3);
  assert.deepEqual(cat.basic, { subsonic: 4, supersonic: 2, note: '', printed: '4/2' });
  assert.equal(new Set(cat.stores.map((s) => s.key)).size, cat.stores.length, 'store keys are unique');
});

test('parseStations reads the printed lists', () => {
  assert.deepEqual(parseStations('2,3,7, OR 8'), ['2', '3', '7', '8']);
  assert.deepEqual(parseStations('1 OR 9'), ['1', '9']);
  assert.deepEqual(parseStations('3,4,5,6, OR 7'), ['3', '4', '5', '6', '7']);
  assert.deepEqual(parseStations('5L'), ['5L']);
  assert.throws(() => parseStations('10'));
  assert.throws(() => parseStations(''));
});

test('parseDrag: one value, two values, the tip notes; anything else throws', () => {
  assert.deepEqual(parseDrag(4), { subsonic: 4, supersonic: null, note: '', printed: '4' });
  assert.deepEqual(parseDrag('13/8'), { subsonic: 13, supersonic: 8, note: '', printed: '13/8' });
  assert.deepEqual(parseDrag('4*'), { subsonic: 4, supersonic: null, note: '*', printed: '4*' });
  assert.deepEqual(parseDrag('2**'), { subsonic: 2, supersonic: null, note: '**', printed: '2**' });
  assert.deepEqual(parseDrag('4/2'), { subsonic: 4, supersonic: 2, note: '', printed: '4/2' });
  for (const bad of ['x', '', '4***', '-1', '1.5', '4/', '/4']) assert.throws(() => parseDrag(bad), bad);
  assert.throws(() => parseDrag(1.5));
  assert.throws(() => parseDrag(-1));
});

test('racks table both ways: every rack string is a key, every name in it is a sheet 2 row', () => {
  const suspensionNames = new Set(cat.suspensions.map((s) => s.name));
  const racks = new Set(cat.stores.map((s) => s.rack));
  for (const rack of racks) assert.ok(Object.hasOwn(RACK_SUSPENSIONS, rack), rack);
  assert.equal(racks.size, 11);
  for (const [rack, names] of Object.entries(RACK_SUSPENSIONS)) {
    for (const name of names) assert.ok(suspensionNames.has(name), `${rack}: ${name}`);
    for (const name of names) assert.ok(capacity(name) >= 1);
  }
  assert.deepEqual(RACK_SUSPENSIONS['NONE'], []);
  assert.equal(capacity('TER (16S1750) + WEAPON PYLON*'), 3);
  assert.equal(capacity('LAU-88 A/A + WEAPON PYLON*'), 3);
  assert.equal(capacity('WEAPON PYLON* (16S1700)'), 1);
  assert.throws(() => capacity('ADAPTER (16S301)'));
});

test('storesFor and suspensionsFor filter by station', () => {
  const tips = storesFor(cat, ['1', '9']);
  assert.ok(tips.every((s) => s.stations.includes('1') && s.stations.includes('9')));
  assert.ok(tips.some((s) => s.name === 'AIM-9L, M, S'));
  assert.ok(!storesFor(cat, ['3', '7']).some((s) => s.key === store('AIM-9L, M, S', '1 OR 9').key));
  assert.deepEqual(
    suspensionsFor(cat, store('AIM-9L, M, S', '1 OR 9'), ['1', '9']).map((s) => s.name),
    ['AIM-9 LAUNCHER (16S210)', 'LAU-129/A LAUNCHER'],
  );
  const travelPod = store('MXU-648A/A, C/A (TRAVEL POD) (MAX CARGO WT IS 300 LB)', '3,4,5,6, OR 7');
  assert.deepEqual(
    suspensionsFor(cat, travelPod, ['5']).map((s) => s.name),
    ['CENTERLINE PYLON* (16S951)'],
  );
  assert.deepEqual(
    suspensionsFor(cat, store('TARGETING', '5R', 'LANTIRN POD:'), ['5R']).map((s) => s.name),
    ['LANTIRN TARGETING POD PYLON (16S1150)'],
  );
  assert.deepEqual(suspensionsFor(cat, store('NAVIGATION', '5L', 'LANTIRN POD:'), ['5L']), []);
});

test('the default loadout: pairs 1/9, 2/8, 3/7, 4/6, then 5, 5L, 5R, all empty, drag index the basic 4', () => {
  assert.deepEqual(
    DEFAULT_LOADOUT.map((r) => r.stations.join('/')),
    ['1/9', '2/8', '3/7', '4/6', '5', '5L', '5R'],
  );
  assert.ok(DEFAULT_LOADOUT.every((r) => r.storeKey === null));
  const result = computed(DEFAULT_LOADOUT, 0);
  assert.equal(result.exact, 4);
  assert.equal(result.conservative, 4);
  assert.deepEqual(result.lines, []);
  assert.equal(computed(DEFAULT_LOADOUT, 7).exact, 11);
});

const WORKED_EXAMPLE: LoadoutRow[] = [
  row(['1', '9'], store('AIM-9L, M, S', '1 OR 9').key, 2, 'LAU-129/A LAUNCHER'),
  row(['2', '8'], store('AIM-9L, M, S', '2,3,7, OR 8').key, 2, 'LAU-129/A LAUNCHER + ADAPTER (16S301)'),
  row(['3', '7'], store('MK 84 LDGP', '3,4,6, OR 7').key, 2, 'WEAPON PYLON* (16S1700)'),
  row(['4', '6'], tank(370, '4 OR 6').key, 2),
];

test('worked example (p. B1-2/B1-3): each line as Q4, 142 for the stores, 146 in all', () => {
  const result = computed(WORKED_EXAMPLE, 0);
  const summary = result.lines.map((l) => [
    l.row.stations.join('/'),
    l.count,
    l.eachExact,
    l.eachConservative,
    l.suspension?.name ?? null,
    l.suspensionCount,
    l.exact,
  ]);
  assert.deepEqual(summary, [
    ['1/9', 2, 0, 0, 'LAU-129/A LAUNCHER', 2, 2],
    ['2/8', 2, 5, 5, 'LAU-129/A LAUNCHER + ADAPTER (16S301)', 2, 22],
    ['3/7', 2, 9, 9, 'WEAPON PYLON* (16S1700)', 2, 48],
    ['4/6', 2, 35, 35, null, 0, 70],
  ]);
  assert.equal(result.lines[3]?.variant, 'SINGLE RACKS OR STORES AT 3 OR 7');
  assert.equal(
    result.lines.reduce((sum, l) => sum + l.exact, 0),
    142,
  );
  assert.equal(
    result.lines.reduce((sum, l) => sum + l.conservative, 0),
    142,
  );
  assert.equal(result.exact, 146);
  assert.equal(result.conservative, 146);
});

test('the default suspension on a capacity tie takes the highest drag index: the tips get LAU-129/A, DI 1', () => {
  const [line] = computed([row(['1', '9'], store('AIM-9L, M, S', '1 OR 9').key)], 0).lines;
  assert.equal(line?.suspension?.name, 'LAU-129/A LAUNCHER');
  assert.equal(line.suspension.drag.subsonic, 1);
  assert.equal(line.exact, 2);
  // The worked example names its suspensions: still 146.
  assert.equal(computed(WORKED_EXAMPLE, 0).exact, 146);
});

test('no tip missile: exact −4 each (4 − 8), conservative 0 (4)', () => {
  const result = computed([row(['1', '9'], 'noTipMissile')], 0);
  assert.equal(result.exact, -4);
  assert.equal(result.conservative, 4);
  assert.equal(result.lines[0]?.eachExact, -4);
  assert.equal(result.lines[0].eachConservative, 0);
  assert.equal(result.lines[0].suspension, null);
  assert.throws(() => computed([row(['3', '7'], 'noTipMissile')], 0));
});

test('a tip pod (**) is its value less the tip AIM-9 (4): 2 − 4 = −2 each', () => {
  const pod = store('-T-17 (P4A)', '1 OR 9', 'AN/ASQ:');
  const result = computed([row(['1', '9'], pod.key)], 0);
  assert.equal(result.lines[0]?.eachExact, -2);
  assert.equal(result.lines[0].eachConservative, -2);
  // Two pods on the default LAU-129/A launchers (DI 1 each, the capacity tie's highest): 4 − 2 − 2 + 2 = 2.
  assert.equal(result.lines[0].suspension?.name, 'LAU-129/A LAUNCHER');
  assert.equal(result.conservative, 2);
  // On the AIM-9 launchers (DI 0): the lowest conservative drag index, 4 − 2 − 2 = 0.
  assert.equal(computed([row(['1', '9'], pod.key, 2, 'AIM-9 LAUNCHER (16S210)')], 0).conservative, 0);
});

test('the * marker is not one rule: LANTIRN NAVIGATION (32*, with pylon) at 5L adds 32, no suspension line', () => {
  const result = computed([row(['5L'], store('NAVIGATION', '5L', 'LANTIRN POD:').key)], 0);
  assert.equal(result.lines[0]?.eachExact, 32);
  assert.equal(result.lines[0].suspension, null);
  assert.equal(result.exact, 36);
});

test('two printed values: the subsonic one, with a note', () => {
  const mk82 = store('MK 82 LDGP', '3,4,6, OR 7');
  const [line] = computed([row(['3', '7'], mk82.key)], 0).lines;
  assert.equal(line?.eachExact, 5);
  assert.ok(line.notes.some((n) => /subsonic/.test(n)));
});

test('tank variants follow the store at 3 or 7 (4 from 3, 6 from 7; 5 from 4 and 6)', () => {
  const at46 = (neighbour: LoadoutRow | null): number[] => {
    const rows = [row(['4', '6'], tank(370, '4 OR 6').key), ...(neighbour === null ? [] : [neighbour])];
    return computed(rows, 0)
      .lines.filter((l) => l.row.stations.includes('4'))
      .map((l) => l.eachExact);
  };
  assert.deepEqual(at46(null), [27]);
  assert.deepEqual(at46(row(['3', '7'], store('AIM-9L, M, S', '2,3,7, OR 8').key)), [27]);
  assert.deepEqual(at46(row(['3', '7'], store('MK 84 LDGP', '3,4,6, OR 7').key)), [35]);
  assert.deepEqual(at46(row(['3', '7'], store('MK 82 LDGP', '3,4,6, OR 7').key, 6)), [39]);
  // A multiple-carriage rack at 3/7 is MULTIPLE even with one store per station; one MK 84 on a weapon pylon stays
  // SINGLE.
  const ter = 'TER (16S1750) + WEAPON PYLON*';
  assert.deepEqual(at46(row(['3', '7'], store('MK 82 LDGP', '3,4,6, OR 7').key, 2, ter)), [39]);
  assert.deepEqual(at46(row(['3', '7'], store('MK 84 LDGP', '3,4,6, OR 7').key, 2, 'WEAPON PYLON* (16S1700)')), [35]);
  // An odd count on the pair: which side carries the extra store is not said, so both tanks take MULTIPLE.
  const oddNeighbour = row(['3', '7'], store('MK 82 LDGP', '3,4,6, OR 7').key, 3);
  assert.deepEqual(at46(oddNeighbour), [39]);
  assert.deepEqual(
    computed([row(['4', '6'], tank(370, '4 OR 6').key), oddNeighbour], 0)
      .lines.filter((l) => l.variant !== null)
      .map((l) => [l.count, l.eachExact]),
    [[2, 39]],
  );

  // Only 3 loaded (count 1 on the pair): 4 is single, 6 has nothing at 7: two lines.
  const split = computed(
    [row(['4', '6'], tank(370, '4 OR 6').key), row(['3', '7'], store('MK 84 LDGP', '3,4,6, OR 7').key, 1)],
    0,
  ).lines.filter((l) => l.row.stations.includes('4'));
  assert.deepEqual(
    split.map((l) => [l.count, l.eachExact]),
    [
      [1, 35],
      [1, 27],
    ],
  );

  const at5 = (rows: LoadoutRow[]): number | undefined =>
    computed([row(['5'], tank(300, '5').key), ...rows], 0).lines.find((l) => l.row.stations[0] === '5')?.eachExact;
  const mk84 = store('MK 84 LDGP', '3,4,6, OR 7').key;
  assert.equal(at5([]), 15);
  assert.equal(at5([row(['4', '6'], mk84)]), 18);
  assert.equal(at5([row(['4'], mk84), row(['6'], mk84)]), 18);
  // One side only is printed nowhere: 18, the safer value, with a note (Extra 2).
  assert.equal(at5([row(['4'], mk84)]), 18);
  assert.equal(at5([row(['4', '6'], mk84, 1)]), 18);
  const oneSide = computed([row(['5'], tank(300, '5').key), row(['4'], mk84)], 0).lines[0];
  assert.ok(oneSide?.notes.some((n) => /one of 4 and 6/.test(n)) === true);
  assert.equal(oneSide.suspension?.name, 'CENTERLINE PYLON* (16S951)');
});

test('count capped by capacity; the default suspension is the smallest that carries the count', () => {
  const mk82 = store('MK 82 LDGP', '3,4,6, OR 7').key;
  const [onPylon] = computed([row(['3', '7'], mk82, 4, 'WEAPON PYLON* (16S1700)')], 0).lines;
  assert.equal(onPylon?.count, 2);
  assert.equal(onPylon.exact, 2 * 5 + 2 * 15);
  const [onTer] = computed([row(['3', '7'], mk82, 6)], 0).lines;
  assert.equal(onTer?.suspension?.name, 'TER (16S1750) + WEAPON PYLON*');
  assert.equal(onTer.count, 6);
  assert.equal(onTer.exact, 6 * 5 + 2 * 24);
  const [capped] = computed([row(['3', '7'], mk82, 9)], 0).lines;
  assert.equal(capped?.count, 6);
  const [two] = computed([row(['3', '7'], mk82, 2)], 0).lines;
  assert.equal(two?.suspension?.name, 'WEAPON PYLON* (16S1700)');
});

test('a loadout the catalogue does not allow gives its problems, never a throw', () => {
  const mk84 = store('MK 84 LDGP', '3,4,6, OR 7').key;
  const problems = (loadout: Loadout): readonly LoadoutProblem[] => {
    const result = dragIndex(cat, loadout, 0);
    if (result.ok) assert.fail('the loadout computed');
    assert.deepEqual(checkLoadout(cat, loadout), result.problems);
    return result.problems;
  };
  assert.deepEqual(problems([row(['3', '7'], 'no such key')]), [{ row: 0, code: 'unknownStore' }]);
  assert.deepEqual(problems([row(['1', '9'], mk84)]), [{ row: 0, code: 'storeOffStations' }]);
  assert.deepEqual(problems([row(['3', '7'], mk84, 2, 'LAU-129/A LAUNCHER')]), [
    { row: 0, code: 'suspensionOffStore' },
  ]);
  assert.deepEqual(problems([row(['1', '9'], 'noTipMissile', 2, 'LAU-129/A LAUNCHER')]), [
    { row: 0, code: 'suspensionOffStore' },
  ]);
  assert.deepEqual(problems([row(['3', '7'], 'noTipMissile')]), [{ row: 0, code: 'tipOnly' }]);
  assert.deepEqual(problems([row(['3', '7'], mk84, 0)]), [{ row: 0, code: 'badCount' }]);
  assert.deepEqual(problems([row(['3', '7'], mk84, 1.5)]), [{ row: 0, code: 'badCount' }]);
  assert.deepEqual(problems([row(['3', '7'], mk84), row(['3'], null)]), [{ row: 1, code: 'stationTwice' }]);
  assert.deepEqual(problems([row(['3', '3'], mk84)]), [{ row: 0, code: 'stationTwice' }]);
  assert.deepEqual(problems([row(['3', '3'], null)]), [{ row: 0, code: 'stationTwice' }]);
  assert.deepEqual(problems([row([], mk84, 1)]), [{ row: 0, code: 'noStations' }]);
  assert.deepEqual(problems([row([], null, 0)]), [{ row: 0, code: 'noStations' }]);
  assert.deepEqual(checkLoadout(cat, WORKED_EXAMPLE), []);
  assert.deepEqual(checkLoadout(cat, DEFAULT_LOADOUT), []);
  const worked = dragIndex(cat, WORKED_EXAMPLE, 0);
  assert.ok(worked.ok && worked.exact === 146 && worked.conservative === 146);
});

test('a tank group whose variants differ in stations is a data defect and throws', () => {
  const sh7 = structuredClone(figure(figures, 'B1-1.sh7'));
  const stores = sh7.panels.find((p) => p.type === 'table' && p.columns.some((c) => c.name === 'station'));
  assert.ok(stores?.type === 'table');
  const stationAt = stores.columns.findIndex((c) => c.name === 'station');
  const tankRows = stores.rows.filter((r) => String(r[0]).includes('370-GALLON TANK'));
  const second = tankRows[1];
  assert.ok(second !== undefined);
  second[stationAt] = '5';
  assert.throws(() => buildCatalogue({ ...figures, 'B1-1.sh7': sh7 }), /variants differ in stations or rack/);
});
