// The single frequency approach on the client (crc-sync docs/adr/0117): its mirrors of the capability table and
// par-final.js, held to the real server tables, the pool as the server's Bay descriptor carries it, who has a rotating
// frequency (derived from the Strips), and the pure rules about what it OFFERS. The server is the authority.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../app/public/js/panels/efsp/sfa-state.js';
import * as serverConfig from './helpers/server-config.mjs';
import { CONVERSIONS } from '../../crc-sync/src/efsp/par-final.js';
import { SFA_USE } from '../../crc-sync/src/efsp/sfa.js';
const permission = serverConfig.permission;
const facilityConfig = serverConfig.facilityConfig;

const bays = () => facilityConfig.getAllBays('INCIRLIK');
const sfaBay = () => S.sfaBayOf(bays(), 'INCIRLIK');

test('drift: who hands off to the final, who receives it, the label and the pool uses are the server\'s', () => {
  assert.deepEqual([...S.FINAL_HANDOFF_SENDERS].sort(), permission.incirlikPositionsWith('handsOffToFinal').sort());
  for (const id of S.FINAL_HANDOFF_SENDERS) assert.equal(permission.canHandOffToFinal(id), true, id);
  assert.equal(S.FINAL_RECEIVER, permission.finalReceiver());
  assert.equal(S.FINAL_HANDOFF_LABEL, CONVERSIONS.PAR_HANDOFF.label);
  assert.deepEqual(S.SFA_USE, SFA_USE);
});

test('the server\'s SFA Bay is AP\'s and carries the pool: five frequencies, three rotating, one initial contact, one spare', () => {
  const bay = sfaBay();
  assert.equal(bay.positionId, 'AP');
  assert.equal(bay.sfaPool.length, 5);
  assert.deepEqual(bay.sfaPool.map(p => p.use), ['INITIAL_CONTACT', 'ROTATION', 'ROTATION', 'ROTATION', 'SPARE']);
  assert.equal(S.sfaBayOf(bays(), 'CARRIER'), null);
  assert.equal(S.sfaBayOf([], 'INCIRLIK'), null);
});

test('who has a rotating frequency follows the flight: PAR while it holds the Strip of a flight on it, else AP; the others do not rotate', () => {
  const bay = sfaBay();
  const fds = { a: { comms: { workingFrequencyMhz: 234.1 } }, b: { comms: { workingFrequencyMhz: 233.1 } } };
  const flightDataOf = (id) => fds[id] || null;
  let rows = S.sfaRows(bay, [], flightDataOf);
  assert.deepEqual(rows.map(r => [r.text, r.use, r.positionId]), [
    ['232.100', 'INITIAL_CONTACT', null], ['233.100', 'ROTATION', 'AP'], ['234.100', 'ROTATION', 'AP'], ['235.100', 'ROTATION', 'AP'], ['236.100', 'SPARE', null],
  ]);
  const strips = [
    { flightDataId: 'a', ownerPositionId: 'PAR', state: 'ON_FINAL' },
    { flightDataId: 'b', ownerPositionId: 'PAR', state: 'DROPPED' },
  ];
  rows = S.sfaRows(bay, strips, flightDataOf);
  assert.deepEqual(rows.map(r => r.positionId), [null, 'AP', 'PAR', 'AP', null], 'a dropped Strip holds nothing');
  assert.deepEqual(S.sfaRows(null, strips, flightDataOf), []);
});

test('Hand off to PAR is offered on AP\'s inbound arrival on a rotating frequency, to a signed-on AP, and nowhere else', () => {
  const bay = sfaBay();
  const on = (mhz) => ({ comms: { workingFrequencyMhz: mhz } });
  const strip = (over) => ({ stripType: 'ARRIVAL', state: 'INBOUND', ownerPositionId: 'AP', ...over });
  assert.equal(S.finalHandoffOffered(strip(), on(233.1), ['AP'], bay), true);
  assert.equal(S.finalHandoffOffered(strip(), on(232.1), ['AP'], bay), false, 'the initial-contact frequency does not rotate');
  assert.equal(S.finalHandoffOffered(strip(), on(236.1), ['AP'], bay), false, 'nor the spare');
  assert.equal(S.finalHandoffOffered(strip(), on(121.5), ['AP'], bay), false, 'not an SFA frequency');
  assert.equal(S.finalHandoffOffered(strip(), { comms: {} }, ['AP'], bay), false);
  assert.equal(S.finalHandoffOffered(strip(), on(233.1), ['LC'], bay), false, 'not held');
  assert.equal(S.finalHandoffOffered(strip({ ownerPositionId: 'LC', state: 'HANDED_TO_TOWER' }), on(233.1), ['LC'], bay), false);
  assert.equal(S.finalHandoffOffered(strip({ stripType: 'FINAL', state: 'ON_FINAL', ownerPositionId: 'PAR' }), on(233.1), ['PAR'], bay), false);
  assert.equal(S.finalHandoffOffered(strip(), on(233.1), ['AP'], null), false, 'no SFA on this server');
});

test('the button sends the ordinary transfer into PAR\'s final Bay', () => {
  assert.deepEqual(S.finalHandoffOp(bays(), 'INCIRLIK'), { kind: 'TransferStrip', toPositionId: 'PAR', bayId: 'par-final', rackId: 'main' });
  assert.equal(S.finalHandoffOp([], 'INCIRLIK'), null);
  assert.equal(S.sfaFrequencyText(233.1), '233.100');
  assert.equal(S.sfaFrequencyText(null), '--');
});
