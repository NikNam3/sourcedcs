import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  combinationLine, combinationOf, formatFrequencies, luawInUse, offerStands, offerText,
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

test('the line is stronger while LUAW is in use, and names both frequencies', () => {
  const combo = combinationOf([GC, LC], ['GC', 'LC']);
  const calm = combinationLine(combo, false);
  const luaw = combinationLine(combo, true);
  assert.equal(calm.severe, false);
  assert.match(calm.text, /¶2-6-5b/);
  assert.match(calm.text, /LC TWR 251\.0 and GC GND 275\.8/);
  assert.equal(luaw.severe, true);
  assert.match(luaw.text, /LUAW in use/);
  assert.equal(combinationLine(null, true), null);
});

test('LUAW is in use while a DEPARTURE is in RUNWAY_QUEUE or LUAW at the Facility', () => {
  assert.equal(luawInUse([{ stripType: 'DEPARTURE', state: 'TAXI' }]), false);
  assert.equal(luawInUse([{ stripType: 'DEPARTURE', state: 'RUNWAY_QUEUE' }]), true);
  assert.equal(luawInUse([{ stripType: 'ARRIVAL', state: 'LUAW' }]), false);
  assert.equal(luawInUse([{ stripType: 'DEPARTURE', state: 'LUAW', facilityId: 'CENTER' }], 'INCIRLIK'), false);
});

test('the offer reads "Take GC as well?" and lapses once GC has a Primary or is taken', () => {
  const offer = { facilityId: 'INCIRLIK', offer: 'GC', count: 3 };
  assert.equal(offerText(offer), 'GC is unstaffed with 3 Strips. Take GC as well?');
  assert.equal(offerText({ ...offer, count: 1 }), 'GC is unstaffed with 1 Strip. Take GC as well?');
  assert.equal(offerStands(offer, [{ positionId: 'GC', primary: null }], ['LC']), true);
  assert.equal(offerStands(offer, [{ positionId: 'GC', primary: { controllerId: 'x' } }], ['LC']), false);
  assert.equal(offerStands(offer, [{ positionId: 'GC', primary: null }], ['LC', 'GC']), false);
  assert.equal(offerStands(null, [], []), false);
});
