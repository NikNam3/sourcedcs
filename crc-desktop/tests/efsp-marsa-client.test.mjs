/* The MARSA badge and the participant highlight (guide §9.2 rules 2, 5 and 6).
 *
 * The DOM-free half — badge shape, action list and highlight resolution. The
 * rendered Strip, the popover and the dispatched op are in
 * efsp-ui-reachability.test.mjs, which runs the real bay-view.js.
 *
 * Three cases carry the deliverable, and each is a judgement that would be
 * easy to get wrong in the opposite direction:
 *
 *   - an ARMED relation says so, because a controller who cannot see that the
 *     interlock is live finds out by breaking a join-up;
 *   - a VOIDED relation still renders, because the void IS rule 2's alert and
 *     a badge that vanished at that moment would erase it;
 *   - an ENDED relation renders nothing, because a finished AR is not news and
 *     this codebase already has one unretractable badge too many.
 */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import * as state from '../app/public/js/panels/efsp/efsp-state.js';
import {
  marsaBadgeFor, marsaActionsFor,
  highlightMarsaParticipants, refreshMarsaHighlight,
  getMarsaHighlightStripIds, isMarsaHighlighted,
  MARSA_EXPANSION,
} from '../app/public/js/panels/efsp/marsa-badge.js';
import { _setSelectedStripIdForTest } from '../app/public/js/panels/efsp/bay-view.js';

const require = createRequire(import.meta.url);

// marsa-badge.js reads the selection through bay-view.js's getSelectedEfspStripId (the old test stubbed that
// global); this drives the real one.
const setSelected = (id) => _setSelectedStripIdForTest(id);

const TANKER = 'flight-data-shell71';
const RX1 = 'flight-data-viper11';
const RX2 = 'flight-data-viper12';

function strip(stripId, flightDataId) {
  return {
    stripId, flightDataId, rev: 1, stripType: 'DEPARTURE', state: 'HANDED_OFF',
    bayId: 'ap-departures', rackId: 'main', orderKey: 'V', ownerPositionId: 'AP',
    annotations: {}, flags: {}, coordination: null, tofiCoordination: null,
    airspaceEntry: null, previousLeg: null,
  };
}

function flightData(flightDataId, callsign) {
  return { flightDataId, rev: 1, identity: { callsign, beaconAssigned: '0041', beaconObserved: null } };
}

function relation(over = {}) {
  return {
    marsaId: 'm-1', rev: 1, state: 'ACTIVE',
    declaringCallsign: 'SHELL71',
    participants: [TANKER, RX1],
    startEvent: 'TANKER_ACCEPTED', endCondition: 'VERTICALLY_POSITIONED',
    startedAt: 1000, rendezvousAt: null, rendezvousBy: null,
    voidedBy: null, voidedDetail: null, endedAt: null, endedBy: null,
    note: null, transitions: [],
    ...over,
  };
}

const STRIPS = [strip('s-tanker', TANKER), strip('s-rx1', RX1), strip('s-rx2', RX2)];
const FLIGHT_DATA_LIST = [flightData(TANKER, 'SHELL71'), flightData(RX1, 'VIPER11'), flightData(RX2, 'VIPER12')];

function load(marsa = []) {
  state._resetEfspStateForTest();
  state.applyEfspSnapshot({ strips: STRIPS, flightDataList: FLIGHT_DATA_LIST, positions: [], bays: [], marsa, boardSeq: 1 });
  setSelected(null);
  highlightMarsaParticipants(null);
}

const stripOf = (id) => state.getEfspStrip(id);

// ── state plumbing ──────────────────────────────────────────────────────────

test('a snapshot carries relations, and a delta updates one in place', () => {
  load([relation()]);
  assert.equal(state.getAllEfspMarsa().length, 1);
  assert.equal(state.activeMarsaForFlightData(TANKER).marsaId, 'm-1');

  state.applyEfspMarsaDelta({ marsa: { updated: [relation({ rev: 2, rendezvousAt: 2000 })] } });
  assert.equal(state.getEfspMarsa('m-1').rendezvousAt, 2000);
  assert.equal(state.getAllEfspMarsa().length, 1, 'updated in place, not appended');
});

test('a void needs nothing cleared — the record arrives whole', () => {
  load([relation()]);
  state.applyEfspMarsaDelta({
    marsa: { updated: [relation({ rev: 2, state: 'VOIDED', voidedBy: 'CONTROLLER_COURSE_CHANGE', endedAt: 3000 })] },
  });
  assert.equal(state.activeMarsaForFlightData(TANKER), null, 'no longer active');
  assert.equal(state.getEfspMarsa('m-1').voidedBy, 'CONTROLLER_COURSE_CHANGE', 'but still there to render');
});

test('a flight in no relation resolves to null everywhere', () => {
  load([relation()]);
  assert.equal(state.activeMarsaForFlightData(RX2), null);
  assert.equal(state.marsaForStrip(stripOf('s-rx2')), null);
  assert.equal(marsaBadgeFor(stripOf('s-rx2')), null);
});

test('marsaForStrip prefers the ACTIVE relation over a finished one', () => {
  load([
    relation({ marsaId: 'm-old', state: 'ENDED', endedAt: 5000, endedBy: 'END_CONDITION' }),
    relation({ marsaId: 'm-new' }),
  ]);
  assert.equal(state.marsaForStrip(stripOf('s-tanker')).marsaId, 'm-new');
});

test('with no ACTIVE relation it shows the most recently finished one', () => {
  load([
    relation({ marsaId: 'm-old', state: 'ENDED', endedAt: 1000, endedBy: 'END_CONDITION' }),
    relation({ marsaId: 'm-recent', state: 'VOIDED', endedAt: 9000, voidedBy: 'MANUAL' }),
  ]);
  assert.equal(state.marsaForStrip(stripOf('s-tanker')).marsaId, 'm-recent');
});

// ── the badge (§9.2 rules 2 and 6) ──────────────────────────────────────────

test('an ARMED relation says the interlock is live, and what will trip it', () => {
  load([relation()]);
  const badge = marsaBadgeFor(stripOf('s-tanker'));
  assert.equal(badge.text, 'MARSA ⚠');
  assert.equal(badge.armed, true);
  assert.match(badge.className, /efsp-marsa-armed/);
  // The whole reason the armed state is distinguishable at all: a controller
  // who cannot see it finds out by breaking a join-up.
  assert.match(badge.title, /assigning a heading or altitude VOIDS this/i);
  // §9.2 rule 6 — the Pilot/Controller Glossary expansion in UI text.
  assert.match(badge.title, new RegExp(MARSA_EXPANSION));
  assert.match(badge.title, /declared by SHELL71/);
});

test('after rendezvous the badge drops the warning but keeps the relation', () => {
  load([relation({ rendezvousAt: 2000 })]);
  const badge = marsaBadgeFor(stripOf('s-tanker'));
  assert.equal(badge.text, 'MARSA');
  assert.equal(badge.armed, false);
  assert.match(badge.title, /Rendezvous marked/);
  assert.match(badge.title, new RegExp(MARSA_EXPANSION));
});

test('a VOIDED relation is rule 2\'s alert, and names the cause', () => {
  load([relation({ state: 'VOIDED', voidedBy: 'CONTROLLER_COURSE_CHANGE', endedAt: 3000 })]);
  const badge = marsaBadgeFor(stripOf('s-rx1'));
  assert.equal(badge.text, 'MARSA ✕');
  assert.equal(badge.voided, true);
  assert.match(badge.title, /VOIDED/);
  assert.match(badge.title, /course was assigned before rendezvous/);
  assert.match(badge.title, /ATC is separating these aircraft again/);
  // "alerts every participant Strip" — one record, every participant.
  assert.deepEqual(badge.participantFlightDataIds, [TANKER, RX1]);
  assert.ok(marsaBadgeFor(stripOf('s-tanker')).voided, 'the tanker sees it too');
});

test('an altitude void reads differently from a course void', () => {
  load([relation({ state: 'VOIDED', voidedBy: 'CONTROLLER_ALTITUDE_CHANGE', endedAt: 3000 })]);
  assert.match(marsaBadgeFor(stripOf('s-rx1')).title, /altitude was assigned before rendezvous/);
});

test('a manual void shows the note the controller gave', () => {
  load([relation({ state: 'VOIDED', voidedBy: 'MANUAL', voidedDetail: 'ATC resuming separation', endedAt: 3000 })]);
  assert.match(marsaBadgeFor(stripOf('s-rx1')).title, /ATC resuming separation/);
});

test('an ENDED relation renders NOTHING — a finished AR is not an alert', () => {
  // A badge that outlives the condition behind it is a defect (the obligation
  // badge had exactly that one until docs/adr/0067); an ENDED relation is over.
  load([relation({ state: 'ENDED', endedBy: 'END_CONDITION', endedAt: 4000 })]);
  assert.equal(marsaBadgeFor(stripOf('s-tanker')), null);
  assert.equal(marsaBadgeFor(stripOf('s-rx1')), null);
});

test('a flight that landed mid-AR leaves no badge either', () => {
  load([relation({ state: 'ENDED', endedBy: 'PARTICIPANT_RETIRED', endedAt: 4000 })]);
  assert.equal(marsaBadgeFor(stripOf('s-rx1')), null);
});

test('the badge counts the OTHER participants, not itself', () => {
  load([relation({ participants: [TANKER, RX1, RX2] })]);
  assert.match(marsaBadgeFor(stripOf('s-tanker')).title, /with 2 other flights/);
  load([relation()]);
  assert.match(marsaBadgeFor(stripOf('s-tanker')).title, /with 1 other flight/);
});

// ── rule 5: selecting one participant highlights the others ────────────────

test('selecting a participant highlights the others, and not itself', () => {
  load([relation({ participants: [TANKER, RX1, RX2] })]);
  assert.equal(highlightMarsaParticipants('s-tanker'), true, 'the set changed');
  assert.deepEqual(getMarsaHighlightStripIds().sort(), ['s-rx1', 's-rx2']);
  assert.equal(isMarsaHighlighted('s-rx1'), true);
  assert.equal(isMarsaHighlighted('s-tanker'), false, 'the selected Strip is not its own peer');
});

test('selecting the same participant twice reports no change, so nothing re-renders', () => {
  load([relation()]);
  assert.equal(highlightMarsaParticipants('s-tanker'), true);
  assert.equal(highlightMarsaParticipants('s-tanker'), false);
});

test('selecting nothing, or a flight in no relation, clears the highlight', () => {
  load([relation()]);
  highlightMarsaParticipants('s-tanker');
  assert.equal(highlightMarsaParticipants(null), true);
  assert.deepEqual(getMarsaHighlightStripIds(), []);
  highlightMarsaParticipants('s-tanker');
  assert.equal(highlightMarsaParticipants('s-rx2'), true);
  assert.deepEqual(getMarsaHighlightStripIds(), []);
});

test('a FINISHED relation highlights nobody — the flights are not flying together any more', () => {
  load([relation({ state: 'VOIDED', voidedBy: 'MANUAL', endedAt: 3000 })]);
  highlightMarsaParticipants('s-tanker');
  assert.deepEqual(getMarsaHighlightStripIds(), []);
});

test('refreshMarsaHighlight re-resolves against the current selection when a delta lands', () => {
  load([relation()]);
  setSelected('s-tanker');
  refreshMarsaHighlight();
  assert.deepEqual(getMarsaHighlightStripIds(), ['s-rx1']);
  // A receiver joins — the delta arrives, and the highlight follows it.
  state.applyEfspMarsaDelta({ marsa: { updated: [relation({ rev: 2, participants: [TANKER, RX1, RX2] })] } });
  assert.equal(refreshMarsaHighlight(), true);
  assert.deepEqual(getMarsaHighlightStripIds().sort(), ['s-rx1', 's-rx2']);
});

test('a DROPPED Strip is not highlighted', () => {
  state._resetEfspStateForTest();
  state.applyEfspSnapshot({
    strips: [strip('s-tanker', TANKER), { ...strip('s-rx1', RX1), state: 'DROPPED' }],
    flightDataList: FLIGHT_DATA_LIST, positions: [], bays: [], marsa: [relation()], boardSeq: 1,
  });
  highlightMarsaParticipants('s-tanker');
  assert.deepEqual(getMarsaHighlightStripIds(), []);
});

// ── the action list ─────────────────────────────────────────────────────────

test('a flight in no relation is offered only the declaration', () => {
  load([]);
  assert.deepEqual(marsaActionsFor(stripOf('s-tanker')).map(a => a.kind), ['DeclareMarsa']);
});

test('an ARMED relation offers the rendezvous; an established one does not', () => {
  load([relation()]);
  const armed = marsaActionsFor(stripOf('s-tanker')).map(a => a.kind);
  assert.ok(armed.includes('MarkRendezvous'));
  assert.ok(!armed.includes('DeclareMarsa'), 'a flight is in at most one relation');

  load([relation({ rendezvousAt: 2000 })]);
  const joined = marsaActionsFor(stripOf('s-tanker')).map(a => a.kind);
  assert.ok(!joined.includes('MarkRendezvous'), 'rendezvous is already marked');
  assert.deepEqual(joined, ['AddParticipant', 'RemoveParticipant', 'EndMarsa', 'VoidMarsa']);
});

test('every action on a live relation carries its marsaId', () => {
  load([relation()]);
  for (const action of marsaActionsFor(stripOf('s-tanker'))) {
    assert.equal(action.marsaId, 'm-1', action.kind);
  }
});

test('a VOIDED relation offers a fresh declaration, not more ops on the dead one', () => {
  load([relation({ state: 'VOIDED', voidedBy: 'CONTROLLER_COURSE_CHANGE', endedAt: 3000 })]);
  assert.deepEqual(marsaActionsFor(stripOf('s-tanker')).map(a => a.kind), ['DeclareMarsa']);
});

// ── the string §9.2 rule 6 names ────────────────────────────────────────────

test('the glossary expansion matches crc-sync\'s copy exactly', () => {
  // Two separately deployed packages, so this is checked rather than imported
  // — the same split the Block Map parity test exists for.
  const server = require('../../crc-sync/src/efsp/marsa-store.js');
  assert.equal(MARSA_EXPANSION, server.MARSA_EXPANSION);
});
