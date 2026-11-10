// The intercom (H183): its own radio kind, never linked, its unit picked from the SRS clients. radio-set.js,
// link-groups.js, radio-prefs.js and intercom-unit-select.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRadioSet, intercomRadios, INTERCOM_RADIO_ID } from '../app/public/js/radio/radio-set.js';
import { AUTO_GROUP_ID, INTERCOM_CONFLICT, NO_SLOT_CONFLICT, moveRadio, resolvePttTarget, transmitRadioIds } from '../app/public/js/radio/link-groups.js';
import * as P from '../app/public/js/radio/radio-prefs.js';
import { intercomUnitOptions } from '../app/public/js/radio/intercom-unit-select.js';

const intercomOf = (set) => set.radios.find(r => r.id === INTERCOM_RADIO_ID);

test('no intercom until the controller adds one; then one radio, kind and modulation INTERCOM, no frequency', () => {
  assert.equal(intercomOf(buildRadioSet({})), undefined);
  assert.deepEqual(intercomRadios({ unitId: null }), [{
    id: 'INTERCOM', kind: 'INTERCOM', positionId: null, band: null, mhz: null, modulation: 'INTERCOM', label: 'INTERCOM', receiveOnly: false,
  }]);
  const set = buildRadioSet({ intercom: { unitId: null } });
  assert.equal(intercomOf(set).groupId, null);
  assert.equal(intercomOf(set).conflict, null);
});

test('the intercom is never linked: a stored membership is refused with a conflict, and no group holds it', () => {
  const groups = [{ id: 'G1', name: 'A' }];
  for (const membership of [{ INTERCOM: 'G1' }, { INTERCOM: AUTO_GROUP_ID }]) {
    const set = buildRadioSet({ intercom: { unitId: null }, groups, membership });
    assert.equal(intercomOf(set).groupId, null);
    assert.equal(intercomOf(set).conflict, INTERCOM_CONFLICT);
    assert.ok(set.groups.every(g => !g.radioIds.includes('INTERCOM')));
  }
  // moving it anywhere stores nothing
  const ic = { id: 'INTERCOM', kind: 'INTERCOM' };
  assert.deepEqual(moveRadio({}, ic, 'G1'), {});
  assert.deepEqual(moveRadio({ INTERCOM: 'G1', 'GUARD:UHF': 'G1' }, ic, AUTO_GROUP_ID), { 'GUARD:UHF': 'G1' });
});

test('PTT on the intercom keys the intercom alone; it may be the target', () => {
  const rows = [{ facilityId: 'F', kind: 'POSITION', positionId: 'P1', label: 'TWR', mhz: 275.8 }];
  const set = buildRadioSet({ staffed: [{ facilityId: 'F', positionId: 'P1' }], rows, intercom: { unitId: 7 } });
  assert.deepEqual(transmitRadioIds(set, 'INTERCOM'), ['INTERCOM']);
  assert.equal(resolvePttTarget(set, 'INTERCOM'), 'INTERCOM');
});

test('the intercom takes its own SRS slot, right after the guards', () => {
  const rows = Array.from({ length: 5 }, (_, i) => [
    { facilityId: 'F', kind: 'POSITION', positionId: `Q${i}`, label: 'U', mhz: 250 + i },
    { facilityId: 'F', kind: 'POSITION', positionId: `Q${i}`, label: 'V', mhz: 120 + i },
  ]).flat();
  const staffed = rows.filter((_, i) => i % 2 === 0).map(r => ({ facilityId: 'F', positionId: r.positionId }));
  const set = buildRadioSet({ staffed, rows, intercom: { unitId: null } });
  assert.equal(intercomOf(set).conflict, null);
  assert.equal(set.radios.find(r => r.id === 'POSITION:Q4:UHF').conflict, NO_SLOT_CONFLICT); // 2 guards + IC + 8
});

test('prefs: one intercom, its unit (a positive integer, else shared), removed with its audio and target', () => {
  let p = P.normalizeRadioPrefs(null);
  assert.equal(p.intercom, null);
  p = P.addIntercom(p);
  assert.deepEqual(p.intercom, { unitId: null });
  assert.equal(P.addIntercom(P.withIntercomUnit(p, 5)).intercom.unitId, 5); // a second add changes nothing
  p = P.withIntercomUnit(p, 12);
  assert.deepEqual(p.intercom, { unitId: 12 });
  assert.deepEqual(P.withIntercomUnit(p, 0).intercom, { unitId: null });
  assert.deepEqual(P.normalizeRadioPrefs({ intercom: { unitId: 'x' } }).intercom, { unitId: null });
  p = P.withPttTarget(P.withRadioAudio(p, 'INTERCOM', { volume: 2 }), 'INTERCOM');
  p = P.removeIntercom(p);
  assert.equal(p.intercom, null);
  assert.equal(p.audio.INTERCOM, undefined);
  assert.equal(p.pttTarget, null);
  assert.equal(P.withIntercomUnit(p, 3).intercom, null); // no intercom, no unit
});

test('the unit picker: shared first, then the SRS clients by name; a chosen unit off SRS stays listed', () => {
  const clients = [{ name: 'Viper 1-1', unitId: 42 }, { name: 'Alpha', unitId: 7 }, { name: 'bad', unitId: 0 }];
  assert.deepEqual(intercomUnitOptions(clients, null).map(o => [o.value, o.label, o.group]), [
    ['', 'shared (non-DCS)', null], ['7', 'Alpha (ID 7)', 'SRS clients'], ['42', 'Viper 1-1 (ID 42)', 'SRS clients'],
  ]);
  const off = intercomUnitOptions([], 99);
  assert.deepEqual(off.map(o => [o.value, o.missing]), [['', false], ['99', true]]);
});
