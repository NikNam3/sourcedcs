/* "Show on map" (H129), contact -> Strip and the correlation badge (guide §6.6 rules 4 and 5).
 *
 * The cases worth pinning are the two judgement calls: clicking a contact
 * with no Strip must NOT clear the Strip selection, and selecting the same
 * Strip from the map twice must not toggle it off. Both would be easy to get
 * wrong by reusing the panel's own toggle, and both feel broken rather than
 * merely different.
 */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { latestFromServer } from '../app/public/js/picture.js';
import * as state from '../app/public/js/panels/efsp/efsp-state.js';
import {
  getCorrelatedHighlightTrackId, refreshCorrelatedHighlight, showStripOnMap, showOnMapTrackFor, clearShownOnMap,
  RING_SHOW_MS, selectStripForTrack, correlationBadgeFor,
} from '../app/public/js/panels/efsp/correlation-highlight.js';
import { _setSelectedStripIdForTest, _setSelectEfspStripByIdForTest } from '../app/public/js/panels/efsp/bay/selection.js';
import { setOpenEfspBays } from '../app/public/js/panels/efsp/bay/open-bays.js';
import { _setUpdateMapForTest } from '../app/public/js/geojson.js';
import { _setMap, _setMapReady } from '../app/public/js/map-handle.js';
import { markEfspChanged } from '../app/public/js/panels/efsp/efsp-change-bus.js';

// The old test stubbed these as plain globals; the modules now read their imports, so each goes through the
// module's explicit setter (docs/wip/ESM-1.md, "Setters").
let mapUpdates = 0;
_setUpdateMapForTest(() => { mapUpdates += 1; });

let selectedStripId = null;
let selectCalls = 0;
_setSelectEfspStripByIdForTest((stripId) => { selectedStripId = stripId; _setSelectedStripIdForTest(stripId); selectCalls += 1; });
const select = (id) => { selectedStripId = id; _setSelectedStripIdForTest(id); };
setOpenEfspBays([{ containerEl: null, bayId: 'ap-departures' }]);

const liveTracks = latestFromServer;

function strip(stripId, flightDataId, bayId = 'ap-departures') {
  return {
    stripId, flightDataId, rev: 1, stripType: 'DEPARTURE', state: 'AIRBORNE',
    bayId, rackId: 'main', orderKey: 'V', ownerPositionId: 'AP',
    annotations: {}, flags: {}, coordination: null, tofiCoordination: null,
    airspaceEntry: null, previousLeg: null,
  };
}

function flightData(flightDataId, callsign, beaconAssigned = '0041') {
  return { flightDataId, rev: 1, identity: { callsign, beaconAssigned, beaconObserved: null } };
}

function correlation(flightDataId, over = {}) {
  return {
    flightDataId, rev: 1, state: 'CORRELATED', trackId: '101', matchedBy: 'BEACON',
    confidence: null, binding: null, warning: null, observedBeacon: '0041',
    transitions: [], ...over,
  };
}

function load({ strips = [], flightDataList = [], correlations = [], tracks = [] } = {}) {
  state._resetEfspStateForTest();
  state.applyEfspSnapshot({ strips, flightDataList, positions: [], bays: [], correlations, boardSeq: 1 });
  liveTracks.clear();
  for (const t of tracks) liveTracks.set(String(t.id), t);
  clearShownOnMap();
  select(null);
  selectCalls = 0;
  mapUpdates = 0;
}

// ── state plumbing ─────────────────────────────────────────────────────────

test('the snapshot fills correlations, and the reset clears them', () => {
  load({ correlations: [correlation('f1')] });
  assert.equal(state.getEfspCorrelation('f1').trackId, '101');
  state._resetEfspStateForTest();
  assert.equal(state.getEfspCorrelation('f1'), null);
  assert.equal(state.getEfspCorrelationStats(), null);
});

test('a delta updates only the records it carries, and keeps the stats', () => {
  load({ correlations: [correlation('f1'), correlation('f2', { trackId: '202' })] });
  state.applyEfspCorrelationDelta({
    correlations: { updated: [correlation('f1', { trackId: '500' })] },
    stats: { rate: 0.9, eligible: 10, target: 0.95 },
  });
  assert.equal(state.getEfspCorrelation('f1').trackId, '500');
  assert.equal(state.getEfspCorrelation('f2').trackId, '202');
  assert.equal(state.getEfspCorrelationStats().rate, 0.9);
});

test('a retracted warning simply arrives as null — no separate clear step exists', () => {
  load({ correlations: [correlation('f1', { state: 'UNCORRELATED', trackId: null, warning: { kind: 'TRACK_LOST' } })] });
  assert.ok(state.getEfspCorrelation('f1').warning);
  state.applyEfspCorrelationDelta({ correlations: { updated: [correlation('f1')] } });
  assert.equal(state.getEfspCorrelation('f1').warning, null);
});

test('the reverse lookup finds every live Strip for a contact, across Facilities', () => {
  // One flight-data record, two Strips — the ordinary case after a cross-Facility handoff,
  // and the case a per-Strip correlation would have got wrong.
  load({
    strips: [strip('s1', 'f1', 'ap-departures'), strip('s2', 'f1', 'ctr-departures')],
    correlations: [correlation('f1')],
  });
  assert.deepEqual(state.stripIdsForTrackId('101').sort(), ['s1', 's2']);
  assert.deepEqual(state.stripIdsForTrackId('999'), []);
});

test('a dropped Strip is not offered by the reverse lookup', () => {
  const dropped = { ...strip('s1', 'f1'), state: 'DROPPED' };
  load({ strips: [dropped], correlations: [correlation('f1')] });
  assert.deepEqual(state.stripIdsForTrackId('101'), []);
});

// ── Strip -> contact: "Show on map" (H129, live test T10) ──────────────────

const T101 = { id: '101', lat: 37.0, lon: 35.4, label: { callsign: 'VIPER1', trackNumber: 'TN00012' } };

test('selecting a Strip no longer rings its contact (H129)', () => {
  load({ strips: [strip('s1', 'f1')], correlations: [correlation('f1')], tracks: [T101] });
  select('s1');
  markEfspChanged('selection');
  assert.equal(getCorrelatedHighlightTrackId(), null);
  assert.equal(mapUpdates, 0);
});

test('Show on map rings the contact, redraws the map once, and the ring goes after RING_SHOW_MS', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  load({ strips: [strip('s1', 'f1')], correlations: [correlation('f1')], tracks: [T101] });
  assert.equal(showStripOnMap('s1'), '101');
  assert.equal(getCorrelatedHighlightTrackId(), '101');
  assert.equal(mapUpdates, 1);
  t.mock.timers.tick(RING_SHOW_MS - 1);
  assert.equal(getCorrelatedHighlightTrackId(), '101', 'still showing just before the time is up');
  t.mock.timers.tick(1);
  assert.equal(getCorrelatedHighlightTrackId(), null);
  assert.equal(mapUpdates, 2);
});

test('Show on map again restarts the time; a second Strip moves the ring', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  load({
    strips: [strip('s1', 'f1'), strip('s2', 'f2')],
    correlations: [correlation('f1'), correlation('f2', { trackId: '202' })],
    tracks: [T101, { ...T101, id: '202' }],
  });
  showStripOnMap('s1');
  t.mock.timers.tick(RING_SHOW_MS - 1000);
  showStripOnMap('s2');
  assert.equal(getCorrelatedHighlightTrackId(), '202');
  t.mock.timers.tick(RING_SHOW_MS - 1);
  assert.equal(getCorrelatedHighlightTrackId(), '202');
  t.mock.timers.tick(1);
  assert.equal(getCorrelatedHighlightTrackId(), null);
  clearShownOnMap();
});

test('Show on map has nothing to ring for an uncorrelated Strip or a contact outside the picture', () => {
  load({
    strips: [strip('s1', 'f1'), strip('s2', 'f2')],
    correlations: [correlation('f1', { state: 'UNCORRELATED', trackId: null }), correlation('f2', { trackId: '999' })],
    tracks: [T101],
  });
  assert.equal(showStripOnMap('s1'), null);
  assert.equal(showStripOnMap('s2'), null, '999 is not in this controller\'s picture');
  assert.equal(showOnMapTrackFor(state.getEfspStrip('s2')), null);
  assert.equal(getCorrelatedHighlightTrackId(), null);
});

test('a re-bind moves a showing ring; a lost contact ends it', () => {
  load({ strips: [strip('s1', 'f1')], correlations: [correlation('f1')], tracks: [T101, { ...T101, id: '500' }] });
  showStripOnMap('s1');
  state.applyEfspCorrelationDelta({ correlations: { updated: [correlation('f1', { trackId: '500' })] } });
  refreshCorrelatedHighlight();
  assert.equal(getCorrelatedHighlightTrackId(), '500');
  state.applyEfspCorrelationDelta({ correlations: { updated: [correlation('f1', { state: 'UNCORRELATED', trackId: null })] } });
  refreshCorrelatedHighlight();
  assert.equal(getCorrelatedHighlightTrackId(), null);
});

test('Show on map pans to a contact off the map, and leaves the map alone when it is on it', () => {
  const eased = [];
  let inView = false;
  _setMap({ getBounds: () => ({ contains: () => inView }), easeTo: (o) => eased.push(o.center) });
  _setMapReady(true);
  try {
    load({ strips: [strip('s1', 'f1')], correlations: [correlation('f1')], tracks: [T101] });
    showStripOnMap('s1');
    assert.deepEqual(eased, [[35.4, 37.0]]);
    inView = true;
    showStripOnMap('s1');
    assert.equal(eased.length, 1);
  } finally {
    clearShownOnMap();
    _setMapReady(false);
    _setMap(undefined);
  }
});

// ── contact -> Strip ───────────────────────────────────────────────────────

test('clicking a contact selects its Strip', () => {
  load({ strips: [strip('s1', 'f1')], correlations: [correlation('f1')] });
  assert.equal(selectStripForTrack('101'), 's1');
  assert.equal(selectedStripId, 's1');
});

test('clicking a contact with no Strip leaves the current selection alone', () => {
  // Silently clearing a Strip selection because of a click somewhere else
  // makes the panel feel haunted, and the absence of a ring is already the
  // signal that this contact is not on the board.
  load({ strips: [strip('s1', 'f1')], correlations: [correlation('f1')] });
  selectStripForTrack('101');
  assert.equal(selectStripForTrack('999'), null);
  assert.equal(selectedStripId, 's1', 'still selected');
});

test('clicking the same contact twice keeps its Strip selected — not a toggle', () => {
  load({ strips: [strip('s1', 'f1')], correlations: [correlation('f1')] });
  selectStripForTrack('101');
  selectStripForTrack('101');
  assert.equal(selectedStripId, 's1');
  assert.equal(selectCalls, 2, 'selected both times, never deselected');
});

test('a contact with several Strips prefers the one in a Bay that is open', () => {
  load({
    strips: [strip('s1', 'f1', 'ctr-departures'), strip('s2', 'f1', 'ap-departures')],
    correlations: [correlation('f1')],
  });
  assert.equal(selectStripForTrack('101'), 's2', 'ap-departures is the open Bay');
});

// ── the badge ──────────────────────────────────────────────────────────────

test('a correlated Strip names the contact by its code, not by the callsign it already shows', () => {
  // crc-sync's docs/adr/0059: once correlated, the contact's label IS this
  // Strip's callsign, so the badge gives the contact's own reference.
  load({
    strips: [strip('s1', 'f1')], flightDataList: [flightData('f1', 'VIPER1')],
    correlations: [correlation('f1')],
    tracks: [{ id: '101', label: { callsign: 'VIPER1', source: 'FLIGHT_DATA', trackNumber: 'TN00012' }, ssr: { code: '0041' } }],
  });
  const badge = correlationBadgeFor(state.getEfspStrip('s1'));
  assert.equal(badge.text, 'TRK 0041', 'the code its transponder is sending');
  assert.match(badge.title, /beacon 0041/);
  assert.match(badge.className, /efsp-correlation-correlated/);
});

test('a controller binding says who bound it', () => {
  load({
    strips: [strip('s1', 'f1')], flightDataList: [flightData('f1', 'VIPER1')],
    correlations: [correlation('f1', { matchedBy: 'BINDING', binding: { trackId: '101', boundPositionId: 'AP' } })],
    tracks: [{ id: '101', callsign: 'VIPER1' }],
  });
  assert.match(correlationBadgeFor(state.getEfspStrip('s1')).title, /bound by AP/);
});

test('a provisional match shows the observed-versus-assigned mismatch in words', () => {
  // §3.10.2 rule 1's three-case render, with real data behind it.
  load({
    strips: [strip('s1', 'f1')], flightDataList: [flightData('f1', 'VIPER1', '0041')],
    correlations: [correlation('f1', { state: 'PROVISIONAL', matchedBy: 'CALLSIGN_EXACT', observedBeacon: '0056' })],
    tracks: [{ id: '101', callsign: 'VIPER1' }],
  });
  const badge = correlationBadgeFor(state.getEfspStrip('s1'));
  assert.equal(badge.text, 'TRK?');
  assert.match(badge.title, /observed 0056/);
  assert.match(badge.title, /assigned 0041/);
});

test('a fuzzy match reports its confidence rather than a mismatch', () => {
  load({
    strips: [strip('s1', 'f1')], flightDataList: [flightData('f1', 'VIPER1')],
    correlations: [correlation('f1', { state: 'PROVISIONAL', matchedBy: 'CALLSIGN_FUZZY', confidence: 0.9, observedBeacon: null })],
    tracks: [{ id: '101', callsign: 'VIPER11' }],
  });
  assert.match(correlationBadgeFor(state.getEfspStrip('s1')).title, /provisional, 0\.9/);
});

test('correlated to a contact outside your coverage says so, rather than showing a bare id', () => {
  // Correlation is worked out against every contact the server has; coverage
  // is per-Position (crc-sync's docs/adr/0042). So a Strip can legitimately be
  // bound to a contact this controller cannot see — an en-route flight on
  // somebody else's radar. The badge used to read `TRK 101`, which looks like
  // a callsign, and clicking the Strip drew no ring at all.
  load({
    strips: [strip('s1', 'f1')], flightDataList: [flightData('f1', 'VIPER1')],
    correlations: [correlation('f1')],
    tracks: [], // nothing in this controller's picture
  });
  const badge = correlationBadgeFor(state.getEfspStrip('s1'));
  assert.equal(badge.outsideCoverage, true);
  assert.match(badge.title, /outside your radar coverage/);
  assert.match(badge.className, /efsp-correlation-outside/);
  assert.ok(!/101/.test(badge.text), 'a raw track id must never read as a callsign');
});

test('the same record reads as a normal correlation once the contact enters coverage', () => {
  load({
    strips: [strip('s1', 'f1')], flightDataList: [flightData('f1', 'VIPER1')],
    correlations: [correlation('f1')],
    tracks: [],
  });
  assert.equal(correlationBadgeFor(state.getEfspStrip('s1')).outsideCoverage, true);

  liveTracks.set('101', { id: '101', label: { callsign: 'VIPER1', source: 'FLIGHT_DATA', trackNumber: 'TN00012' }, ssr: null });
  const badge = correlationBadgeFor(state.getEfspStrip('s1'));
  assert.equal(badge.outsideCoverage, undefined);
  assert.equal(badge.text, 'TRK TN00012', 'no transponder: its track number');
});

test('a provisional match outside coverage also reads as outside, not as a mismatch', () => {
  // Otherwise the tooltip would explain a squawk disagreement for a contact
  // the controller cannot look at.
  load({
    strips: [strip('s1', 'f1')], flightDataList: [flightData('f1', 'VIPER1', '0041')],
    correlations: [correlation('f1', { state: 'PROVISIONAL', matchedBy: 'CALLSIGN_EXACT', observedBeacon: '0056' })],
    tracks: [],
  });
  assert.equal(correlationBadgeFor(state.getEfspStrip('s1')).outsideCoverage, true);
});

test('an uncorrelated Strip reads NO TRK, and a broken binding reads louder', () => {
  load({
    strips: [strip('s1', 'f1')], flightDataList: [flightData('f1', 'VIPER1')],
    correlations: [correlation('f1', { state: 'UNCORRELATED', trackId: null, matchedBy: null })],
  });
  const plain = correlationBadgeFor(state.getEfspStrip('s1'));
  assert.equal(plain.text, 'NO TRK');
  assert.equal(plain.warned, false, 'never matched is not the same as lost');

  state.applyEfspCorrelationDelta({
    correlations: {
      updated: [correlation('f1', {
        state: 'UNCORRELATED', trackId: null, matchedBy: null,
        warning: { kind: 'TRACK_IDENTITY_LOST', lostTrackId: '101' },
      })],
    },
  });
  const warned = correlationBadgeFor(state.getEfspStrip('s1'));
  assert.equal(warned.warned, true);
  assert.match(warned.className, /efsp-correlation-warned/);
  assert.match(warned.title, /no longer exists/);
});

test('an ambiguous correlation is a button carrying its candidates', () => {
  load({
    strips: [strip('s1', 'f1')], flightDataList: [flightData('f1', 'VIPER1')],
    correlations: [correlation('f1', {
      state: 'UNCORRELATED', trackId: null, matchedBy: null,
      warning: { kind: 'AMBIGUOUS_CALLSIGN', candidateTrackIds: ['101', '102'], detail: '2 contacts answer to VIPER1 equally well — bind one' },
    })],
  });
  const badge = correlationBadgeFor(state.getEfspStrip('s1'));
  assert.equal(badge.text, 'TRK ×2');
  assert.equal(badge.ambiguous, true);
  assert.deepEqual(badge.candidateTrackIds, ['101', '102']);
  assert.match(badge.title, /bind one/);
});

test('a Strip with no correlation record yet shows no badge at all', () => {
  load({ strips: [strip('s1', 'f1')], flightDataList: [flightData('f1', 'VIPER1')] });
  assert.equal(correlationBadgeFor(state.getEfspStrip('s1')), null);
});
