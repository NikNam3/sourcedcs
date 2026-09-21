'use strict';

/* Coupled selection and the correlation badge (guide §6.6 rules 4 and 5).
 *
 * The cases worth pinning are the two judgement calls: clicking a contact
 * with no Strip must NOT clear the Strip selection, and selecting the same
 * Strip from the map twice must not toggle it off. Both would be easy to get
 * wrong by reusing the panel's own toggle, and both feel broken rather than
 * merely different.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const CLIENT = path.join(__dirname, '../app/public/js/panels/efsp');
const state = require(path.join(CLIENT, 'efsp-state.js'));
const {
  highlightCorrelatedTrack, getCorrelatedHighlightTrackId, refreshCorrelatedHighlight,
  selectStripForTrack, correlationBadgeFor,
} = require(path.join(CLIENT, 'correlation-highlight.js'));

// correlation-highlight.js reaches for these as plain globals, exactly as it
// does in the browser where every panel file is a <script>.
global.getEfspStrip = state.getEfspStrip;
global.getEfspFdr = state.getEfspFdr;
global.getEfspCorrelationForStrip = state.getEfspCorrelationForStrip;
global.correlatedTrackIdForStrip = state.correlatedTrackIdForStrip;
global.stripIdsForTrackId = state.stripIdsForTrackId;

let mapUpdates = 0;
global.updateMap = () => { mapUpdates += 1; };

let selectedStripId = null;
let selectCalls = 0;
global.selectEfspStripById = (stripId) => { selectedStripId = stripId; selectCalls += 1; };
global.getSelectedEfspStripId = () => selectedStripId;
global.getOpenEfspBayIds = () => ['app-departures'];

global.window = global;
const liveTracks = new Map();
global.window.getLatestTrack = (id) => liveTracks.get(String(id)) || null;

function strip(stripId, fdrId, bayId = 'app-departures') {
  return {
    stripId, fdrId, rev: 1, role: 'DEPARTURE', state: 'AIRBORNE',
    bayId, rackId: 'main', orderKey: 'V', ownerPositionId: 'APP',
    annotations: {}, flags: {}, coordination: null, tofiCoordination: null,
    airspaceEntry: null, previousLeg: null,
  };
}

function fdr(fdrId, callsign, beaconAssigned = '0041') {
  return { fdrId, rev: 1, identity: { callsign, beaconAssigned, beaconObserved: null } };
}

function correlation(fdrId, over = {}) {
  return {
    fdrId, rev: 1, state: 'CORRELATED', trackId: '101', matchedBy: 'BEACON',
    confidence: null, binding: null, warning: null, observedBeacon: '0041',
    transitions: [], ...over,
  };
}

function load({ strips = [], fdrs = [], correlations = [], tracks = [] } = {}) {
  state._resetEfspStateForTest();
  state.applyEfspSnapshot({ strips, fdrs, positions: [], bays: [], correlations, boardSeq: 1 });
  liveTracks.clear();
  for (const t of tracks) liveTracks.set(String(t.id), t);
  selectedStripId = null;
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
  // One FDR, two Strips — the ordinary case after a cross-Facility handoff,
  // and the case a per-Strip correlation would have got wrong.
  load({
    strips: [strip('s1', 'f1', 'app-departures'), strip('s2', 'f1', 'ctr-departures')],
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

// ── Strip -> contact ───────────────────────────────────────────────────────

test('selecting a Strip rings its contact, and redraws the map once', () => {
  load({ strips: [strip('s1', 'f1')], correlations: [correlation('f1')] });
  assert.equal(highlightCorrelatedTrack('s1'), '101');
  assert.equal(getCorrelatedHighlightTrackId(), '101');
  assert.equal(mapUpdates, 1);
});

test('selecting the same Strip again does not redraw', () => {
  load({ strips: [strip('s1', 'f1')], correlations: [correlation('f1')] });
  highlightCorrelatedTrack('s1');
  const after = mapUpdates;
  highlightCorrelatedTrack('s1');
  assert.equal(mapUpdates, after);
});

test('deselecting clears the ring — with no Strip selected it has nothing to say', () => {
  load({ strips: [strip('s1', 'f1')], correlations: [correlation('f1')] });
  highlightCorrelatedTrack('s1');
  highlightCorrelatedTrack(null);
  assert.equal(getCorrelatedHighlightTrackId(), null);
});

test('selecting an uncorrelated Strip draws no ring', () => {
  load({
    strips: [strip('s1', 'f1')],
    correlations: [correlation('f1', { state: 'UNCORRELATED', trackId: null })],
  });
  assert.equal(highlightCorrelatedTrack('s1'), null);
});

test('a re-bind moves the ring without the selection changing', () => {
  load({ strips: [strip('s1', 'f1')], correlations: [correlation('f1')] });
  selectedStripId = 's1';
  highlightCorrelatedTrack('s1');
  assert.equal(getCorrelatedHighlightTrackId(), '101');

  state.applyEfspCorrelationDelta({ correlations: { updated: [correlation('f1', { trackId: '500' })] } });
  refreshCorrelatedHighlight();
  assert.equal(getCorrelatedHighlightTrackId(), '500');
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
    strips: [strip('s1', 'f1', 'ctr-departures'), strip('s2', 'f1', 'app-departures')],
    correlations: [correlation('f1')],
  });
  assert.equal(selectStripForTrack('101'), 's2', 'app-departures is the open Bay');
});

// ── the badge ──────────────────────────────────────────────────────────────

test('a correlated Strip shows the contact’s resolved callsign and how it matched', () => {
  load({
    strips: [strip('s1', 'f1')], fdrs: [fdr('f1', 'VIPER1')],
    correlations: [correlation('f1')],
    tracks: [{ id: '101', callsign: 'VIPER 11' }],
  });
  const badge = correlationBadgeFor(state.getEfspStrip('s1'));
  assert.equal(badge.text, 'TRK VIPER 11', 'the name the controller sees on the scope');
  assert.match(badge.title, /beacon 0041/);
  assert.match(badge.className, /efsp-correlation-correlated/);
});

test('a controller binding says who bound it', () => {
  load({
    strips: [strip('s1', 'f1')], fdrs: [fdr('f1', 'VIPER1')],
    correlations: [correlation('f1', { matchedBy: 'BINDING', binding: { trackId: '101', boundPositionId: 'APP' } })],
    tracks: [{ id: '101', callsign: 'VIPER1' }],
  });
  assert.match(correlationBadgeFor(state.getEfspStrip('s1')).title, /bound by APP/);
});

test('a provisional match shows the observed-versus-assigned mismatch in words', () => {
  // §3.10.2 rule 1's three-case render, with real data behind it.
  load({
    strips: [strip('s1', 'f1')], fdrs: [fdr('f1', 'VIPER1', '0041')],
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
    strips: [strip('s1', 'f1')], fdrs: [fdr('f1', 'VIPER1')],
    correlations: [correlation('f1', { state: 'PROVISIONAL', matchedBy: 'CALLSIGN_FUZZY', confidence: 0.9, observedBeacon: null })],
  });
  assert.match(correlationBadgeFor(state.getEfspStrip('s1')).title, /provisional, 0\.9/);
});

test('an uncorrelated Strip reads NO TRK, and a broken binding reads louder', () => {
  load({
    strips: [strip('s1', 'f1')], fdrs: [fdr('f1', 'VIPER1')],
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
    strips: [strip('s1', 'f1')], fdrs: [fdr('f1', 'VIPER1')],
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
  load({ strips: [strip('s1', 'f1')], fdrs: [fdr('f1', 'VIPER1')] });
  assert.equal(correlationBadgeFor(state.getEfspStrip('s1')), null);
});
