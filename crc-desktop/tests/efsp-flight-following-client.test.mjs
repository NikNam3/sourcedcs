// crc-sync H136 (docs/wip/LT-VFR.md): "Start flight following" on a contact with no Strip, and "Radar service
// terminated" on its Strip. The client offers each only where it applies (dark cockpit) and only to the Positions the
// server lets do it.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as serverConfig from './helpers/server-config.mjs';
import './helpers/client-env.mjs';
import { applyEfspSnapshot } from '../app/public/js/panels/efsp/efsp-state.js';
import { sendEfspSetPositions } from '../app/public/js/panels/efsp/efsp-ws.js';
import { FLIGHT_FOLLOWING_POSITIONS } from '../app/public/js/panels/efsp/bay/authority-mirror.js';
import {
  canStartFlightFollowing, canTerminateRadarService, contactForToken, flightFollowingPosition, startFlightFollowing,
} from '../app/public/js/panels/efsp/flight-following.js';
import { latestFromServer } from '../app/public/js/picture.js';

const server = serverConfig.permission;

test('the client offers flight following to exactly the Positions the server lets start and terminate it', () => {
  const granted = Object.keys(server.PERMISSIONS).filter(id => server.PERMISSIONS[id].has('StartFlightFollowing')
    && server.PERMISSIONS[id].has('TerminateRadarService') && server.canCreateStripType(id, 'OVERFLIGHT'));
  assert.deepEqual([...FLIGHT_FOLLOWING_POSITIONS].sort(), granted.sort());
});

const fd = (id, { alt = false } = {}) => ({
  flightDataId: id, identity: { callsign: id.toUpperCase() },
  clearance: { altitude: { entries: alt ? [{ status: 'ACTIVE', parsed: 50 }] : [] }, heading: { entries: [] } },
});
const strip = (id, flightDataId, extra = {}) => ({
  stripId: id, flightDataId, stripType: 'OVERFLIGHT', state: 'IN_SECTOR', ownerPositionId: 'CTR', facilityId: 'CENTER', rev: 1, ...extra,
});

function board() {
  applyEfspSnapshot({
    strips: [strip('s1', 'f1'), strip('s2', 'f2'), strip('s3', 'f3', { stripType: 'ARRIVAL', state: 'INBOUND' }), strip('s4', 'f4', { state: 'DROPPED' })],
    flightDataList: [fd('f1'), fd('f2', { alt: true }), fd('f3'), fd('f4')],
    correlations: [
      { flightDataId: 'f1', trackId: '11', state: 'CORRELATED' },
      { flightDataId: 'f4', trackId: '44', state: 'CORRELATED' },
      // bound, but the picture does not show the contact this second: still claimed (crc-sync refuses the same)
      { flightDataId: 'f2', trackId: null, state: 'UNCORRELATED', binding: { trackId: '22' } },
    ],
  });
}

test('Start flight following applies to a contact with no live Strip, and only at a radar Position', () => {
  board();
  sendEfspSetPositions('CENTER', []);
  sendEfspSetPositions('INCIRLIK', ['LC']);
  assert.equal(flightFollowingPosition(), null);
  assert.equal(canStartFlightFollowing('99'), false, 'LC works no overflights');
  assert.equal(startFlightFollowing('99', 'N1', 'C172'), 'sign on to AP or CTR first');

  sendEfspSetPositions('CENTER', ['CTR']);
  assert.equal(flightFollowingPosition(), 'CTR');
  assert.equal(canStartFlightFollowing('99'), true, 'an untracked contact');
  assert.equal(canStartFlightFollowing('11'), false, 'already a Strip\'s contact');
  assert.equal(canStartFlightFollowing('44'), true, 'its Strip is dropped: untracked again');
  assert.equal(canStartFlightFollowing('22'), false, 'explicitly bound to a live Strip, though unseen');
  assert.equal(startFlightFollowing('99', '', 'C172'), 'callsign: 1 to 7 letters or digits');
  assert.equal(startFlightFollowing('99', 'N1', ''), 'aircraft type, e.g. C172');
  sendEfspSetPositions('CENTER', []);
  sendEfspSetPositions('INCIRLIK', []);
});

test('Radar service terminated is offered on a flight-following Strip (OVERFLIGHT, no clearance) its radar Position holds', () => {
  board();
  sendEfspSetPositions('CENTER', ['CTR']);
  const get = (id) => ({ s1: strip('s1', 'f1'), s2: strip('s2', 'f2'), s3: strip('s3', 'f3', { stripType: 'ARRIVAL', state: 'INBOUND' }), s4: strip('s4', 'f4', { state: 'DROPPED' }) })[id];
  assert.equal(canTerminateRadarService(get('s1')), true);
  assert.equal(canTerminateRadarService(get('s2')), false, 'an assigned altitude: not VFR');
  assert.equal(canTerminateRadarService(get('s3')), false, 'an ARRIVAL ends by landing (para 5-1-9 b.4)');
  assert.equal(canTerminateRadarService(get('s4')), false, 'already dropped');
  sendEfspSetPositions('CENTER', []);
  assert.equal(canTerminateRadarService(get('s1')), false, 'not held');
});

test('.ff names a contact by the track number its data block shows, or by its id', () => {
  latestFromServer.clear();
  latestFromServer.set('7', { id: '7', label: { trackNumber: '0421' } });
  assert.equal(contactForToken('0421'), '7');
  assert.equal(contactForToken('7'), '7');
  assert.equal(contactForToken('9999'), null);
  assert.equal(contactForToken(''), null);
  latestFromServer.clear();
});
