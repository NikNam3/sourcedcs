'use strict';

// UI-A follow-up: the pure halves of the U1-U8 / S-L15 / S-L16 client fixes.

const test = require('node:test');
const assert = require('node:assert/strict');

Object.assign(globalThis, require('../app/public/js/panels/efsp/time-chains.js'));
globalThis.cachedStereoRoutesClient = () => [];
const tpl = require('../app/public/js/panels/efsp/strip-template.js');
const fields = require('../app/public/js/panels/efsp/strip-fields.js');
Object.assign(globalThis, tpl, fields);

test('U4: TYPE (3) is redirected to the aircraft type (3A) and carries its current value', () => {
  const fdr = { identity: { aircraftType: 'F16C', flightSize: 2 } };
  assert.deepEqual(tpl.editRedirectFor('3', 'DEPARTURE', fdr), { blockId: '3A', value: 'F16C' });
  assert.deepEqual(tpl.editRedirectFor('3', 'ARRIVAL', null), { blockId: '3A', value: '' });
  assert.equal(tpl.editRedirectFor('3', 'MISSION', fdr), null, 'a mission line has no 3A');
  assert.equal(tpl.editRedirectFor('5', 'DEPARTURE', fdr), null);
  assert.equal(tpl.isBlockEditable('3'), false, 'the composite itself is still not a write target');
});

test('U5: RELEASE (14A) is on a departure at APP and CTR, labelled RELEASE', () => {
  for (const p of ['APP', 'CTR']) assert.ok(fields.compactBlocksFor('DEPARTURE', p).includes('14A'), p);
  assert.equal(tpl.blockLabelFor('14A', 'DEPARTURE'), 'RELEASE');
});

test('U3: the IFR field says what it is', () => {
  assert.equal(tpl.blockLabelFor('IFR', 'DEPARTURE'), 'KEEP IFR');
  assert.match(tpl.blockTitleFor('IFR', null), /TOFI/);
});

test('U8: TOFI Exit is due on the ATC Strip only while its TOFI is ACTIVE and the mission line is OFF_STATION or RTB', () => {
  const { tofiExitDueFor } = require('../app/public/js/panels/efsp/efsp-nla.js');
  const atc = (state) => ({ role: 'OVERFLIGHT', tofiCoordination: { state, direction: 'ENTRY', peerStripId: 'm1' } });
  const mission = (state) => ({ role: 'MISSION', state });
  for (const s of ['OFF_STATION', 'RTB']) assert.equal(tofiExitDueFor(atc('ACTIVE'), mission(s)), true, s);
  for (const s of ['TASKED', 'AIRBORNE', 'ON_STATION', 'DROPPED']) assert.equal(tofiExitDueFor(atc('ACTIVE'), mission(s)), false, s);
  assert.equal(tofiExitDueFor(atc('PROPOSED'), mission('RTB')), false, 'an exit already proposed is not offered again');
  assert.equal(tofiExitDueFor(atc('ACTIVE'), null), false);
  assert.equal(tofiExitDueFor({ ...atc('ACTIVE'), role: 'MISSION' }, mission('RTB')), false, 'never on the mission side');
  assert.equal(tofiExitDueFor({ role: 'ARRIVAL', tofiCoordination: null }, mission('RTB')), false);
});
