/* Contact click -> the Strip panel jumps to the Strip (docs/wip/STRIP-JUMP.md).
 *
 * stripRevealTarget is the whole decision: switch to the Strip's Position and Bay only when this controller holds that
 * Position, the Strip is not already on screen and no Strip popover is open. A primary-only contact cannot be tracked
 * from the scope yet (v3 backlog, "Primary-only tracking"), so its case is pinned with a stubbed VFR binding.
 */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { latestFromServer } from '../app/public/js/picture.js';
import * as state from '../app/public/js/panels/efsp/efsp-state.js';
import { setSignedOnAt } from '../app/public/js/panels/efsp/signed-on-state.js';
import { _activeBayId, _activePositionTab, _setActiveBayId, _setActivePositionTab } from '../app/public/js/panels/efsp/panel/state.js';
import { revealEfspStrip, stripRevealTarget } from '../app/public/js/panels/efsp/strip-reveal.js';

const BAYS = [
  { bayId: 'ap-departures', positionId: 'AP', facilityId: 'INCIRLIK', rackIds: ['main'] },
  { bayId: 'ap-arrivals', positionId: 'AP', facilityId: 'INCIRLIK', rackIds: ['main'] },
  { bayId: 'twr-main', positionId: 'TWR', facilityId: 'INCIRLIK', rackIds: ['main'] },
];

function strip(stripId, bayId, over = {}) {
  return {
    stripId, flightDataId: `fd-${stripId}`, rev: 1, stripType: 'ARRIVAL', state: 'AIRBORNE',
    bayId, rackId: 'main', orderKey: 'V', ownerPositionId: BAYS.find(b => b.bayId === bayId)?.positionId || 'AP',
    facilityId: 'INCIRLIK', annotations: {}, flags: {}, coordination: null, tofiCoordination: null,
    airspaceEntry: null, previousLeg: null, ...over,
  };
}

const opts = (over = {}) => ({ bays: BAYS, actingPositionIds: ['AP', 'TWR'], onScreen: false, editing: false, ...over });

test('a held Strip off screen -> its Position and Bay', () => {
  assert.deepEqual(stripRevealTarget(strip('s1', 'ap-arrivals'), opts()), { positionId: 'AP', bayId: 'ap-arrivals' });
});

test('a Strip already on screen (its Bay, or a search showing it) -> no switch', () => {
  assert.equal(stripRevealTarget(strip('s1', 'ap-arrivals'), opts({ onScreen: true })), null);
});

test('a Strip popover open -> no switch', () => {
  assert.equal(stripRevealTarget(strip('s1', 'ap-arrivals'), opts({ editing: true })), null);
});

test('the Bay of a Position this controller does not hold -> no switch', () => {
  assert.equal(stripRevealTarget(strip('s1', 'ap-arrivals'), opts({ actingPositionIds: ['TWR'] })), null);
});

test('an unknown Bay, or no Strip -> no switch', () => {
  assert.equal(stripRevealTarget(strip('s1', 'gone'), opts()), null);
  assert.equal(stripRevealTarget(null, opts()), null);
});

test('a primary-only contact bound to a VFR Strip resolves to that Strip and its Bay (stubbed binding)', () => {
  const s = strip('v1', 'ap-arrivals', { stripType: 'VFR' });
  state._resetEfspStateForTest();
  state.applyEfspSnapshot({
    strips: [s],
    flightDataList: [{ flightDataId: s.flightDataId, rev: 1, identity: { callsign: 'N123AB', beaconAssigned: null, beaconObserved: null } }],
    positions: [], bays: BAYS, boardSeq: 1,
    correlations: [{
      flightDataId: s.flightDataId, rev: 1, state: 'CORRELATED', trackId: 'P1', matchedBy: 'BINDING',
      binding: { trackId: 'P1', boundPositionId: 'AP' }, warning: null, observedBeacon: null, transitions: [],
    }],
  });
  latestFromServer.clear();
  latestFromServer.set('P1', { id: 'P1', lat: 37, lon: 35.4 }); // no code: primary only
  assert.deepEqual(state.stripIdsForTrackId('P1'), ['v1']);
  assert.deepEqual(stripRevealTarget(state.getEfspStrip('v1'), opts()), { positionId: 'AP', bayId: 'ap-arrivals' });
});

test('revealEfspStrip switches the panel tabs to a held Strip and reports it', () => {
  state._resetEfspStateForTest();
  state.applyEfspSnapshot({ strips: [strip('s1', 'ap-arrivals')], flightDataList: [], positions: [], bays: BAYS, correlations: [], boardSeq: 1 });
  setSignedOnAt('INCIRLIK', ['AP', 'TWR']);
  _setActivePositionTab('TWR');
  _setActiveBayId('twr-main');
  assert.equal(revealEfspStrip('s1'), true);
  assert.equal(_activePositionTab, 'AP');
  assert.equal(_activeBayId, 'ap-arrivals');
});

test('revealEfspStrip leaves the tabs alone for a Strip it may not show', () => {
  state._resetEfspStateForTest();
  state.applyEfspSnapshot({ strips: [strip('s1', 'ap-arrivals')], flightDataList: [], positions: [], bays: BAYS, correlations: [], boardSeq: 1 });
  setSignedOnAt('INCIRLIK', ['TWR']);
  _setActivePositionTab('TWR');
  _setActiveBayId('twr-main');
  assert.equal(revealEfspStrip('s1'), false);
  assert.equal(revealEfspStrip('nope'), false);
  assert.equal(_activePositionTab, 'TWR');
  assert.equal(_activeBayId, 'twr-main');
});
