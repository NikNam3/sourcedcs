
// The SFA client (crc-sync docs/adr/0075, 0093): its mirrors of permission.js and sfa.js, held to the
// real server tables, and the pure rules about what it OFFERS. The server is the authority.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../app/public/js/panels/efsp/sfa-state.js';
import * as serverConfig from "./helpers/server-config.mjs";
const permission = serverConfig.permission;
import { SFA_TRANSFERS } from '../../crc-sync/src/efsp/sfa.js';
import { SfaStore } from '../../crc-sync/src/efsp/sfa-store.js';
const facilityConfig = serverConfig.facilityConfig;

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
  for (const id of ['AP', 'SFA', 'PAR', 'RSU', 'LC']) {
    assert.equal(S.SFA_ROTATION_CEILING.includes(id), permission.canRotateSfa(id), id);
  }
});

test('the server\'s view carries what the client draws: the pool, the jurisdiction, the controllers who may be on a frequency', () => {
  const v = realView();
  assert.equal(v.jurisdiction, 'AP');
  assert.equal(v.pool.length, 5);
  assert.deepEqual(v.controllers, ['AP', 'SFA', 'PAR']);
  S._resetEfspSfaStateForTest();
  S.applyEfspSfaSnapshot({ sfaRotation: v });
  assert.equal(S.getEfspSfa(), v);
  const rows = S.sfaRotationRows();
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { rackId: 'freq-1', mhz: 232.1, text: '232.100', positionId: 'AP' });
  assert.equal(rows[4].positionId, null, 'a spare frequency');
  const next = { ...v, rev: 5, rotation: { 'freq-4': 'PAR' } };
  S.applyEfspSfaDelta({ sfaRotation: next });
  assert.equal(S.sfaRotationRows()[3].positionId, 'PAR');
  S.applyEfspSfaDelta({});
  assert.equal(S.getEfspSfa(), next, 'a message with no record changes nothing');
});

test('only the signed-on jurisdiction Position is offered the rotation controls', () => {
  const v = realView();
  assert.equal(S.sfaRotatingPosition(['SFA', 'PAR'], v), null);
  assert.equal(S.sfaRotatingPosition(['SFA', 'AP'], v), 'AP');
  assert.equal(S.sfaRotatingPosition(['AP'], null), null);
  assert.equal(S.sfaRotatingPosition(undefined, v), null);
});

test('the Rotate to PAR button is offered on an inbound aircraft on an SFA frequency, to a signed-on sender, and nowhere else', () => {
  const v = realView();
  const onFreq = { comms: { workingFrequencyMhz: 233.1 } };
  const strip = (over) => ({ stripType: 'ARRIVAL', state: 'INBOUND', ownerPositionId: 'SFA', ...over });
  assert.equal(S.sfaRotationOffered(strip(), onFreq, ['SFA'], v), true);
  assert.equal(S.sfaRotationOffered(strip({ ownerPositionId: 'AP' }), onFreq, ['AP'], v), true, 'APP sends it too');
  assert.equal(S.sfaRotationOffered(strip(), onFreq, ['LC'], v), false, 'not held');
  assert.equal(S.sfaRotationOffered(strip({ ownerPositionId: 'PAR' }), onFreq, ['PAR'], v), false, 'PAR does not send it');
  assert.equal(S.sfaRotationOffered(strip({ state: 'HANDED_TO_TOWER' }), onFreq, ['SFA'], v), false);
  assert.equal(S.sfaRotationOffered(strip({ stripType: 'FINAL', state: 'ON_FINAL' }), onFreq, ['SFA'], v), false);
  assert.equal(S.sfaRotationOffered(strip(), { comms: { workingFrequencyMhz: 121.5 } }, ['SFA'], v), false, 'not an SFA frequency');
  assert.equal(S.sfaRotationOffered(strip(), { comms: {} }, ['SFA'], v), false);
  assert.equal(S.sfaRotationOffered(strip(), onFreq, ['SFA'], null), false, 'no SFA on this server');
});
