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

test('S-L16 W2: TAXI is on GND\'s face and TAKEOFF on TWR\'s', () => {
  assert.ok(fields.compactBlocksFor('DEPARTURE', 'GND').includes('17'));
  assert.ok(fields.compactBlocksFor('DEPARTURE', 'TWR').includes('18'));
});

test('S-L16 W3/W5: a typed TAXI behind a later P-time is flagged; an estimate says how to accept it', () => {
  const strip = { role: 'DEPARTURE' };
  const t = (h, m) => Date.UTC(2026, 3, 14, h, m);
  const typed = { filed: { proposedDepartureTimeUtc: t(14, 50) }, assigned: { taxiTimeUtc: t(14, 25) } };
  const behind = tpl.blockValueHintFor('17', typed, strip);
  assert.equal(behind.behindPlan, true);
  assert.match(behind.title, /1425Z was typed before the proposed departure moved to 1450Z/);
  const fresh = { filed: { proposedDepartureTimeUtc: t(14, 20) }, assigned: { taxiTimeUtc: t(14, 25) } };
  assert.equal(tpl.blockValueHintFor('17', fresh, strip).behindPlan, false, 'typed after the P-time is in order');
  const est = tpl.blockValueHintFor('17', { filed: { proposedDepartureTimeUtc: t(14, 50) }, assigned: {} }, strip);
  assert.equal(est.estimated, true);
  assert.match(est.title, /Type it again to accept it as the actual/);
  assert.equal(est.behindPlan, false, 'an estimate follows the P-time by construction');
});

test('S-L23 finding: TAC_C2 lists the live lines AIC and JTAC hold, and no one else gets the list', () => {
  const st = require('../app/public/js/panels/efsp/efsp-state.js');
  st._resetEfspStateForTest();
  const mk = (stripId, over) => ({ stripId, fdrId: stripId, role: 'MISSION', state: 'ON_STATION', ownerPositionId: 'AIC', bayId: 'aic-on-station', rackId: 'main', orderKey: stripId, updatedAt: 1, flags: {}, ...over });
  st.applyEfspSnapshot({ strips: [mk('a'), mk('b', { ownerPositionId: 'JTAC' }), mk('c', { ownerPositionId: 'TAC_C2' }), mk('d', { state: 'DROPPED' }), mk('e', { role: 'ARRIVAL' })], fdrs: [], positions: [], bays: [] });
  assert.deepEqual(st.efspLinesWithOthers('TAC_C2').map(s => s.stripId).sort(), ['a', 'b']);
  assert.deepEqual(st.efspLinesWithOthers('CTR'), []);
  assert.equal(st.isWithOthersBayId(st.withOthersBayId('TAC_C2')), true);
  assert.equal(st.isWithOthersBayId('TAC_C2-search'), false);
});
