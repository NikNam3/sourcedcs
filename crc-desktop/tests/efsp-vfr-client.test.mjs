// crc-sync docs/adr/0146 (H174, H175): the minimal VFR strip, client side. A tag on a contact with no strip, offered at a
// Position with a VFR Bay (the snapshot's Bays, never an id); the STARS handoff (initiate to the Facility's VFR Positions,
// the receiver accepts, the holder recalls); a code; IFR cancelled; "Radar service terminated". Each offered only where
// it applies (dark cockpit) and only where the server lets it.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as serverConfig from './helpers/server-config.mjs';
import './helpers/client-env.mjs';
import { applyEfspSnapshot } from '../app/public/js/panels/efsp/efsp-state.js';
import { sendEfspSetPositions } from '../app/public/js/panels/efsp/efsp-ws.js';
import {
  canAssignCode, canCancelIfr, canRecallVfrHandoff, canTagTrack, canTerminateRadarService, contactForToken, tagProblem, tagTrack,
  vfrBayOf, vfrHandoffAcceptAs, vfrHandoffTargets, vfrTagPosition,
} from '../app/public/js/panels/efsp/flight-following.js';
import { atcRelation } from '../app/public/js/atc-scope.js';
import { latestFromServer } from '../app/public/js/picture.js';

const server = serverConfig.permission;
const ALL_BAYS = [...serverConfig.facilityConfig.getAllBays('INCIRLIK'), ...serverConfig.facilityConfig.getAllBays('CENTER')];

test('every Position with a VFR Bay in the shipped facility files holds the VFR strip\'s ops, and nobody else tags', () => {
  const withBay = ALL_BAYS.filter(b => b.vfr).map(b => b.positionId).sort();
  assert.deepEqual(withBay, ['AP', 'CD', 'CTR', 'GC', 'LC']);
  for (const id of withBay) {
    for (const op of ['StartFlightFollowing', 'VfrHandoff', 'AssignCode', 'ChangeFlightRules', 'TerminateRadarService']) {
      assert.ok(server.PERMISSIONS[id].has(op), `${id} ${op}`);
    }
  }
  const granted = Object.keys(server.PERMISSIONS).filter(id => server.PERMISSIONS[id].has('StartFlightFollowing')).sort();
  assert.deepEqual(granted, withBay, 'the grant and the Bay name the same Positions');
});

const fd = (id, extra = {}) => ({ flightDataId: id, identity: { callsign: id.toUpperCase(), beaconAssigned: null }, ...extra });
const strip = (id, flightDataId, extra = {}) => ({
  stripId: id, flightDataId, stripType: 'VFR', state: 'TRACKED', ownerPositionId: 'AP', facilityId: 'INCIRLIK', rev: 1, ...extra,
});

function board(strips = [strip('s1', 'f1'), strip('s2', 'f2', { state: 'DROPPED' })]) {
  applyEfspSnapshot({
    bays: ALL_BAYS,
    strips,
    flightDataList: [fd('f1'), fd('f2'), fd('f3', { identity: { callsign: 'F3', beaconAssigned: '4321' } })],
    correlations: [
      { flightDataId: 'f1', trackId: '11', state: 'CORRELATED' },
      { flightDataId: 'f2', trackId: '22', state: 'CORRELATED' },
    ],
  });
}

test('a tag applies to a contact with no live strip, at a Position with a VFR Bay', () => {
  board();
  sendEfspSetPositions('CENTER', []);
  sendEfspSetPositions('INCIRLIK', ['OPS']);
  assert.equal(vfrBayOf('OPS'), null);
  assert.equal(vfrTagPosition(), null);
  assert.equal(canTagTrack('99'), false, 'OPS works no traffic');
  assert.equal(tagTrack('99', 'N1', ''), 'sign on to a Position that works VFR traffic first');
  sendEfspSetPositions('INCIRLIK', ['GC']);
  assert.equal(vfrBayOf('GC').bayId, 'gc-taxi-out');
  assert.equal(vfrTagPosition(), 'GC', 'the ground tags too');
  assert.equal(canTagTrack('99'), true);
  assert.equal(canTagTrack('11'), false, 'already a strip\'s contact');
  assert.equal(canTagTrack('22'), true, 'its strip is dropped: untagged again');
  assert.equal(tagProblem(''), 'callsign: 1 to 7 letters or digits');
  assert.equal(tagProblem('N123AB'), null, 'the type is optional');
  sendEfspSetPositions('INCIRLIK', []);
});

test('the handoff: targets are the Facility\'s other VFR Positions; the named one accepts; the holder recalls', () => {
  board();
  const s1 = strip('s1', 'f1');
  assert.deepEqual(vfrHandoffTargets(s1, ALL_BAYS).sort(), ['CD', 'GC', 'LC'], 'its own Facility only, never itself');
  const pending = strip('s1', 'f1', { vfrHandoff: { toPositionId: 'LC' } });
  assert.deepEqual(vfrHandoffTargets(pending, ALL_BAYS), [], 'recall first');
  sendEfspSetPositions('INCIRLIK', ['LC']);
  assert.equal(vfrHandoffAcceptAs(pending), 'LC');
  assert.equal(canRecallVfrHandoff(pending), false, 'LC does not hold it');
  sendEfspSetPositions('INCIRLIK', ['AP']);
  assert.equal(vfrHandoffAcceptAs(pending), null);
  assert.equal(canRecallVfrHandoff(pending), true);
  // The scope: the receiver's contact blinks as an offered handoff (a target click accepts), the holder's shows the letter.
  const t = { id: '11', label: { source: 'FLIGHT_DATA' } };
  const letter = (p) => ({ LC: 'T', AP: 'A' })[p] || '';
  assert.equal(atcRelation(t, [pending], new Set(['LC']), letter).handoffIn.strip.stripId, 's1');
  assert.equal(atcRelation(t, [pending], new Set(['AP']), letter).handoffOut.recipientLetter, 'T');
  sendEfspSetPositions('INCIRLIK', []);
});

test('code, IFR cancelled and Radar service terminated are offered where they apply', () => {
  board();
  sendEfspSetPositions('INCIRLIK', ['AP']);
  const s1 = strip('s1', 'f1');
  assert.equal(canAssignCode(s1, fd('f1')), true);
  assert.equal(canAssignCode(s1, fd('f3', { identity: { beaconAssigned: '4321' } })), false, 'it has one');
  assert.equal(canTerminateRadarService(s1), true);
  assert.equal(canTerminateRadarService(strip('s2', 'f2', { state: 'DROPPED' })), false);
  assert.equal(canTerminateRadarService(strip('s1', 'f1', { stripType: 'OVERFLIGHT', state: 'IN_SECTOR' })), false, 'an IFR strip ends otherwise');
  assert.equal(canCancelIfr(strip('s9', 'f9', { stripType: 'OVERFLIGHT', state: 'IN_SECTOR' })), true);
  assert.equal(canCancelIfr(s1), false, 'already VFR');
  sendEfspSetPositions('INCIRLIK', ['LC']);
  assert.equal(canTerminateRadarService(s1), false, 'AP holds it');
  sendEfspSetPositions('INCIRLIK', []);
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
