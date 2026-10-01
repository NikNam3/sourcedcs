'use strict';

// The SFA client (crc-sync docs/adr/0075, 0093): its mirrors of permission.js and sfa.js, held to the
// real server tables, and the pure rules about what it OFFERS. The server is the authority.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const CLIENT = path.join(__dirname, '../app/public/js/panels/efsp');
const S = require(path.join(CLIENT, 'sfa-state.js'));
const permission = require('../../crc-sync/src/efsp/permission.js');
const { SFA_TRANSFERS } = require('../../crc-sync/src/efsp/sfa.js');
const { SfaStore } = require('../../crc-sync/src/efsp/sfa-store.js');
const facilityConfig = require('../../crc-sync/src/efsp/facility-config.js');

const clock = { now: () => Date.UTC(2026, 5, 1, 9, 0), source: 'TEST' };
/** A real record view from the real store, so the client is tested against exactly what the server sends. */
function realView() {
  const store = new SfaStore({ config: facilityConfig.getSingleFrequencyApproach(), positions: facilityConfig.getPositionSet(), clock });
  return store.view();
}

test('drift: who may send the rotation, its label and the rotation ceiling are the server\'s', () => {
  assert.deepEqual([...S.SFA_ROTATION_SENDERS].sort(), permission.incirlikPositionsWith('sendsSfaRotation').sort());
  for (const id of S.SFA_ROTATION_SENDERS) assert.equal(permission.canSendSfaRotationTransfer(id), true, id);
  assert.equal(S.SFA_ROTATION_LABEL, SFA_TRANSFERS.SFA_ROTATION.label);
  assert.deepEqual([...S.SFA_ROTATION_CEILING].sort(), permission.incirlikPositionsWith('rotatesSfa').sort());
  for (const id of ['APP', 'SFA', 'PAR', 'RSU', 'TWR']) {
    assert.equal(S.SFA_ROTATION_CEILING.includes(id), permission.canRotateSfa(id), id);
  }
});

test('the server\'s view carries what the client draws: the pool, the jurisdiction, the controllers who may be on a frequency', () => {
  const v = realView();
  assert.equal(v.jurisdiction, 'APP');
  assert.equal(v.pool.length, 5);
  assert.deepEqual(v.controllers, ['APP', 'SFA', 'PAR']);
  S._resetEfspSfaStateForTest();
  S.applyEfspSfaSnapshot({ sfaRotation: v });
  assert.equal(S.getEfspSfa(), v);
  const rows = S.sfaRotationRows();
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { rackId: 'freq-1', mhz: 232.1, text: '232.100', positionId: 'APP' });
  assert.equal(rows[4].positionId, null, 'a spare frequency');
  const next = { ...v, rev: 5, rotation: { 'freq-4': 'PAR' } };
  S.applyEfspSfaDelta({ sfaRotation: next });
  assert.equal(S.sfaRotationRows()[3].positionId, 'PAR');
  S.applyEfspSfaDelta({});
  assert.equal(S.getEfspSfa(), next, 'a message with no record changes nothing');
});

test('only the held jurisdiction Position is offered the rotation controls', () => {
  const v = realView();
  assert.equal(S.sfaRotatingPosition(['SFA', 'PAR'], v), null);
  assert.equal(S.sfaRotatingPosition(['SFA', 'APP'], v), 'APP');
  assert.equal(S.sfaRotatingPosition(['APP'], null), null);
  assert.equal(S.sfaRotatingPosition(undefined, v), null);
});

test('the Rotate to PAR button is offered on an inbound aircraft on an SFA frequency, to a held sender, and nowhere else', () => {
  const v = realView();
  const onFreq = { comms: { workingFrequencyMhz: 233.1 } };
  const strip = (over) => ({ role: 'ARRIVAL', state: 'INBOUND', ownerPositionId: 'SFA', ...over });
  assert.equal(S.sfaRotationOffered(strip(), onFreq, ['SFA'], v), true);
  assert.equal(S.sfaRotationOffered(strip({ ownerPositionId: 'APP' }), onFreq, ['APP'], v), true, 'APP sends it too');
  assert.equal(S.sfaRotationOffered(strip(), onFreq, ['TWR'], v), false, 'not held');
  assert.equal(S.sfaRotationOffered(strip({ ownerPositionId: 'PAR' }), onFreq, ['PAR'], v), false, 'PAR does not send it');
  assert.equal(S.sfaRotationOffered(strip({ state: 'HANDED_TO_TOWER' }), onFreq, ['SFA'], v), false);
  assert.equal(S.sfaRotationOffered(strip({ role: 'FINAL', state: 'ON_FINAL' }), onFreq, ['SFA'], v), false);
  assert.equal(S.sfaRotationOffered(strip(), { comms: { workingFrequencyMhz: 121.5 } }, ['SFA'], v), false, 'not an SFA frequency');
  assert.equal(S.sfaRotationOffered(strip(), { comms: {} }, ['SFA'], v), false);
  assert.equal(S.sfaRotationOffered(strip(), onFreq, ['SFA'], null), false, 'no SFA on this server');
});
