import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  combinationLine, combinationOf, formatFrequencies, hatRows, luawInUse, vacatedBetween,
} from '../app/public/js/panels/efsp/combination-rules.js';

// crc-sync docs/adr/0105 (H104): the words and the rules behind the COMBINED line, the offer and the frequencies.

const GC = { positionId: 'GC', primary: { controllerId: 'a' }, combinedWith: ['LC'], frequencies: [{ label: 'GND', mhz: 275.8 }] };
const LC = { positionId: 'LC', primary: { controllerId: 'a' }, combinedWith: ['GC'], frequencies: [{ label: 'TWR', mhz: 251 }] };

test('frequencies read as label and MHz, one decimal at least', () => {
  assert.equal(formatFrequencies([{ label: 'GND', mhz: 275.8 }, { label: 'TWR', mhz: 251 }]), 'GND 275.8 · TWR 251.0');
  assert.equal(formatFrequencies([]), '');
  assert.equal(formatFrequencies(undefined), '');
});

test('LC with GC or CD, held by one controller, is a combination; GC alone, or GC with CD, is not', () => {
  const combo = combinationOf([GC, LC], ['GC', 'LC']);
  assert.deepEqual(combo.positions, ['LC', 'GC']);
  assert.deepEqual(combo.frequencies.map(f => f.positionId), ['LC', 'GC'], 'a controller holding LC+GC has both frequencies');
  assert.equal(combinationOf([GC, LC], ['GC']), null);
  assert.equal(combinationOf([{ ...GC, combinedWith: ['CD'] }, { positionId: 'CD', combinedWith: ['GC'] }, { ...LC, combinedWith: [] }], ['GC', 'CD', 'LC']), null);
  assert.equal(combinationOf([GC, { ...LC, combinedWith: [] }], ['GC', 'LC']), null, 'two controllers, no combination');
});

test('the line is only the frequencies to monitor; stronger, and saying why, while LUAW is in use (T26)', () => {
  const combo = combinationOf([GC, LC], ['GC', 'LC']);
  const calm = combinationLine(combo, false);
  const luaw = combinationLine(combo, true);
  assert.equal(calm.severe, false);
  assert.equal(calm.text, 'Monitor TWR 251.0, GND 275.8');
  assert.doesNotMatch(calm.text, /¶|JO 7210|COMBINED/);
  assert.equal(luaw.severe, true);
  assert.equal(luaw.text, 'LUAW in use while LC is combined. Monitor TWR 251.0, GND 275.8');
  assert.notEqual(calm.key, luaw.key, 'LUAW starting is a change: an acknowledged line comes back');
  assert.equal(combinationLine(null, true), null);
  const bare = combinationOf([{ ...GC, frequencies: [] }, { ...LC, frequencies: [] }], ['GC', 'LC']);
  assert.equal(combinationLine(bare, false), null, 'nothing to monitor and no problem: no line');
});

test('LUAW is in use while a DEPARTURE is in RUNWAY_QUEUE or LUAW at the Facility', () => {
  assert.equal(luawInUse([{ stripType: 'DEPARTURE', state: 'TAXI' }]), false);
  assert.equal(luawInUse([{ stripType: 'DEPARTURE', state: 'RUNWAY_QUEUE' }]), true);
  assert.equal(luawInUse([{ stripType: 'ARRIVAL', state: 'LUAW' }]), false);
  assert.equal(luawInUse([{ stripType: 'DEPARTURE', state: 'LUAW', facilityId: 'CENTER' }], 'INCIRLIK'), false);
});

test('the combination key names its Positions, so taking AP as well is a new combination', () => {
  const ap = { positionId: 'AP', primary: { controllerId: 'a' }, combinedWith: ['LC'], frequencies: [{ label: 'APP', mhz: 360.1 }] };
  const lcGc = combinationLine(combinationOf([GC, LC], ['GC', 'LC']), false);
  const lcGcAp = combinationLine(combinationOf([GC, ap, { ...LC, combinedWith: ['GC', 'AP'] }], ['GC', 'LC', 'AP']), false);
  assert.notEqual(lcGc.key, lcGcAp.key);
  assert.equal(lcGcAp.text, 'Monitor TWR 251.0, GND 275.8, APP 360.1');
});

// ADR 0110: the hat rows. `self` decides who is Primary; the offers are the server's, standing on each Position entry.
const strip = (owner, extra = {}) => ({ stripId: `s-${owner}-${Math.random()}`, ownerPositionId: owner, state: 'CLEARED', stripType: 'DEPARTURE', ...extra });
const ap = (offers) => ({ positionId: 'AP', facilityId: 'INCIRLIK', primary: { controllerId: 'me' }, observers: [], hatOffers: offers });
const lcGone = { positionId: 'LC', facilityId: 'INCIRLIK', primary: null, observers: [], hatOffers: [] };

test('a hat row is made for the Primary of the Position the offer is on, with the count and callsigns', () => {
  const strips = [strip('LC'), strip('LC'), strip('LC', { state: 'DROPPED' })];
  const rows = hatRows([ap([{ positionId: 'LC', count: 2, onRunway: 0, observersFirst: false }]), lcGone], 'me', strips, ['AP'],
    { callsignOf: (s) => 'VIPER1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'take');
  assert.equal(rows[0].positionId, 'LC');
  assert.match(rows[0].text, /^LC is unstaffed with 2 Strips \(VIPER1, VIPER1\)\. Take LC as well\?/);
  assert.doesNotMatch(rows[0].text, /¶/, 'T26: no rule text');
  assert.equal(rows[0].severe, false);
  assert.equal(rows[0].label, 'Take LC');
});

test('an Observer of the offered-to Position, or another controller, is never offered the hat', () => {
  const offer = [{ positionId: 'LC', count: 1, onRunway: 0, observersFirst: false }];
  const asObserver = { ...ap(offer), primary: { controllerId: 'x' }, observers: [{ controllerId: 'me' }] };
  assert.deepEqual(hatRows([asObserver, lcGone], 'me', [strip('LC')], []), []);
  assert.deepEqual(hatRows([ap(offer), lcGone], 'someone-else', [strip('LC')], ['AP']), []);
  assert.deepEqual(hatRows([ap(offer), lcGone], null, [strip('LC')], ['AP']), [], 'no self yet: no row');
});

test('an offer is severe when a Strip is on the runway, and says so', () => {
  const rows = hatRows([ap([{ positionId: 'LC', count: 2, onRunway: 1, observersFirst: false }]), lcGone], 'me', [strip('LC'), strip('LC')], ['AP']);
  assert.equal(rows[0].severe, true);
  assert.match(rows[0].text, /1 on the runway/);
  assert.doesNotMatch(rows[0].text, /¶/);
});

test('GC offered to LC\'s Primary, and CD to GC\'s Primary, carry no rule text (T26)', () => {
  const lc = { positionId: 'LC', facilityId: 'INCIRLIK', primary: { controllerId: 'me' }, observers: [], hatOffers: [{ positionId: 'GC', count: 3, onRunway: 0, observersFirst: false }] };
  const [gc] = hatRows([lc], 'me', [strip('GC'), strip('GC'), strip('GC')], ['LC'], { callsignOf: () => 'X' });
  assert.equal(gc.text, 'GC is unstaffed with 3 Strips (X, X, X). Take GC as well?');
  const gcP = { positionId: 'GC', facilityId: 'INCIRLIK', primary: { controllerId: 'me' }, observers: [], hatOffers: [{ positionId: 'CD', count: 1, onRunway: 0, observersFirst: false }] };
  const [cd] = hatRows([gcP], 'me', [strip('CD')], ['GC'], { callsignOf: () => 'X' });
  assert.equal(cd.text, 'CD is unstaffed with 1 Strip (X). Take CD as well?');
  assert.doesNotMatch(cd.text, /¶/);
});

test('an Observer of a Position with no Primary and Strips is asked "Take it?"; with no Strips, or once it has a Primary, not', () => {
  const obs = { positionId: 'LC', facilityId: 'INCIRLIK', primary: null, observers: [{ controllerId: 'me' }], hatOffers: [] };
  const rows = hatRows([obs], 'me', [strip('LC')], ['GC']);
  assert.equal(rows[0].kind, 'observer');
  assert.match(rows[0].text, /^LC has no Primary and 1 Strip/);
  assert.deepEqual(hatRows([obs], 'me', [], ['GC']), []);
  assert.deepEqual(hatRows([{ ...obs, primary: { controllerId: 'x' } }], 'me', [strip('LC')], ['GC']), []);
});

test('"Not now" and a self-vacated Position hide a row until its count or runway count grows', () => {
  const offer = (count, onRunway = 0) => [ap([{ positionId: 'LC', count, onRunway, observersFirst: false }]), lcGone];
  const strips = (n) => Array.from({ length: n }, () => strip('LC'));
  const hidden = new Map([['LC', { count: 2, onRunway: 0 }]]);
  assert.equal(hatRows(offer(2), 'me', strips(2), ['AP'], { hidden }).length, 0);
  assert.equal(hatRows(offer(1), 'me', strips(1), ['AP'], { hidden }).length, 0, 'shrinking does not bring it back');
  assert.equal(hatRows(offer(3), 'me', strips(3), ['AP'], { hidden }).length, 1, 'a new Strip does');
  assert.equal(hatRows(offer(2, 1), 'me', strips(2), ['AP'], { hidden }).length, 1, 'a Strip onto the runway does');
});

test('an offer for a Position this controller already holds is not shown', () => {
  assert.deepEqual(hatRows([ap([{ positionId: 'LC', count: 1, onRunway: 0, observersFirst: false }])], 'me', [strip('LC')], ['AP', 'LC']), []);
});

test('vacatedBetween names what the controller left', () => {
  assert.deepEqual(vacatedBetween({ INCIRLIK: ['LC', 'GC'] }, { INCIRLIK: ['LC'] }), ['GC']);
  assert.deepEqual(vacatedBetween({}, { INCIRLIK: ['LC'] }), []);
});
