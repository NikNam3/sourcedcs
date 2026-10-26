import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { makeRegistry, stateOp, MOA } from './helpers/airspace-registry.mjs';

// docs/adr/0128 (H151): a transit through an ACTIVE MOA, warning or restricted area is a request by a Position holding the
// flight and a decision by the side that separates the airspace's users. No block, no restriction data: those are the
// ordinary assignments on each side's Strips.

const require = createRequire(import.meta.url);
const { checkPersistedShape } = require('../src/efsp/stores.js');

const WINDOW = { fromUtc: Date.UTC(2026, 0, 1, 12, 0), toUtc: Date.UTC(2026, 0, 1, 14, 0) };
const MRU_MOA = { airspaceId: 'MOA-T', name: 'Tactical MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'TACTICAL' };
const OPS_WARNING = { airspaceId: 'W-1', name: 'Warning 1', type: 'WARNING', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK' };
const RESTRICTED = { airspaceId: 'R-1', name: 'Restricted 1', type: 'RESTRICTED', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP' };
const DANGER = { airspaceId: 'D-1', name: 'Danger 1', type: 'DANGER', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP' };
const PROHIBITED = { airspaceId: 'P-1', name: 'Prohibited 1', type: 'PROHIBITED', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP' };

const ifr = (holders, callsign = 'VIPER11') => ({ callsign, ifr: true, holders });
const AP_HOLDS = [{ facilityId: 'INCIRLIK', positionId: 'AP' }];
const CTR_HOLDS = [{ facilityId: 'CENTER', positionId: 'CTR' }];

function setup({ defs = [MOA, MRU_MOA, OPS_WARNING, RESTRICTED, DANGER, PROHIBITED], flights = { fd1: ifr(AP_HOLDS) }, mutationLog = null } = {}) {
  const clock = { t: WINDOW.fromUtc, now() { return this.t; } };
  const { store, state } = makeRegistry({ defs, flights, clock, mutationLog });
  const op = (airspaceId, o, positionId, by = 'c1') => stateOp(store, airspaceId, o, positionId, by);
  const activate = (id) => {
    const def = defs.find(d => d.airspaceId === id);
    if (def.usingFacilityId) {
      const user = def.usingFacilityId === 'TACTICAL' ? 'TAC_C2' : 'OPS';
      assert.equal(op(id, { kind: 'ScheduleAirspace', ...WINDOW }, user).ok, true);
      assert.equal(op(id, { kind: 'RequestActivation' }, user).ok, true);
    } else {
      assert.equal(op(id, { kind: 'ScheduleAirspace', ...WINDOW }, def.controllingPositionId).ok, true);
    }
    assert.equal(op(id, { kind: 'ApproveActivation' }, def.controllingPositionId).ok, true);
  };
  return { store, state, clock, op, activate };
}
const transitOf = (store, airspaceId, fd = 'fd1') => (store.getAirspace(airspaceId).transits || []).find(t => t.flightDataId === fd) || null;

test('a new and a restored-from-old record start with no transits', () => {
  const { store } = setup();
  assert.deepEqual(store.getAirspace('MOA-1').transits, []);
  const snap = store.snapshot();
  for (const records of Object.values(snap.byTheater)) for (const r of records) delete r.transits; // a snapshot from before ADR 0128
  checkPersistedShape({ airspaces: snap }, 'x.json');
  const { store: again } = setup();
  again.restore(snap);
  assert.deepEqual(again.getAirspace('MOA-1').transits, []);
});

test('request by the Position holding the flight, approved by the controlling Position of an ATC-worked MOA', () => {
  const { store, op, activate, clock } = setup();
  activate('MOA-1');
  clock.t += 60000;
  const r = op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd1', note: 'FL190' }, 'AP', 'c-ap');
  assert.equal(r.ok, true, r.detail);
  assert.deepEqual(transitOf(store, 'MOA-1'), {
    flightDataId: 'fd1', callsign: 'VIPER11', state: 'REQUESTED', requestedBy: 'c-ap', requestedPositionId: 'AP', requestedAt: clock.t,
    note: 'FL190', decidedBy: null, decidedPositionId: null, decidedAt: null, reason: null, selfCoordinated: false,
  });
  assert.equal(store.approvedTransit('MOA-1', 'fd1'), null, 'requested is not approved (ADR 0119 still alerts)');
  assert.equal(op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP', 'c-ap').reason, 'VALIDATION_ERROR', 'one open request per flight');
  clock.t += 30000;
  assert.equal(op('MOA-1', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'CTR', 'c-ctr').ok, true);
  const t = transitOf(store, 'MOA-1');
  assert.deepEqual([t.state, t.decidedPositionId, t.decidedBy, t.decidedAt, t.selfCoordinated, t.requestedPositionId, t.note], ['APPROVED', 'CTR', 'c-ctr', clock.t, false, 'AP', 'FL190']);
  assert.equal(store.approvedTransit('MOA-1', 'fd1').state, 'APPROVED');
  assert.equal(op('MOA-1', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'CTR', 'c-ctr').reason, 'VALIDATION_ERROR', 'already approved');
  assert.deepEqual(store.getAirspace('MOA-1').transitions.map(x => x.state), ['SCHEDULED', 'ACTIVE'], 'a transit is no state transition');
});

test('self-coordination: the requester decides (approved at once), or one controller holds both Positions', () => {
  let s = setup({ flights: { fd1: ifr(CTR_HOLDS) } });
  s.activate('MOA-1');
  assert.equal(s.op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'CTR').ok, true);
  let t = transitOf(s.store, 'MOA-1');
  assert.deepEqual([t.state, t.selfCoordinated, t.decidedPositionId], ['APPROVED', true, 'CTR']);

  s = setup();
  s.activate('MOA-1');
  s.op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP', 'same');
  s.op('MOA-1', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'CTR', 'same');
  t = transitOf(s.store, 'MOA-1');
  assert.deepEqual([t.state, t.selfCoordinated], ['APPROVED', true]);
});

test('the decider approves a listed flight without a request (H151)', () => {
  const { store, op, activate } = setup();
  activate('MOA-1');
  assert.equal(op('MOA-1', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'CTR').ok, true);
  const t = transitOf(store, 'MOA-1');
  assert.deepEqual([t.state, t.requestedPositionId, t.requestedAt, t.selfCoordinated], ['APPROVED', null, null, false]);
});

test('who decides (H151 MT-Q1 a): an MRU using agency (TAC_C2), else the controlling Position; OPS only reads', () => {
  const { store, op, activate } = setup();
  activate('MOA-T');
  activate('W-1');
  assert.deepEqual(store.transitDecidersFor('MOA-T'), ['TAC_C2']);
  assert.deepEqual(store.transitDecidersFor('W-1'), ['CTR']);
  assert.deepEqual(store.transitDecidersFor('MOA-1'), ['CTR'], 'no using agency: the controlling Position');
  assert.deepEqual(store.transitDecidersFor('R-1'), ['AP']);
  assert.deepEqual(store.transitDecidersFor('P-1'), [], 'a prohibited area has no transit');

  op('MOA-T', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP');
  const byCtr = op('MOA-T', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'CTR');
  assert.equal(byCtr.reason, 'PERMISSION_DENIED');
  assert.match(byCtr.detail, /only TAC_C2 may approve/);
  assert.equal(op('MOA-T', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'GCI').reason, 'PERMISSION_DENIED', 'an MRU Position without the airspace-use row');
  assert.equal(op('MOA-T', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'TAC_C2').ok, true);

  op('W-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP');
  assert.equal(op('W-1', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'OPS').reason, 'PERMISSION_DENIED', 'a scheduling using agency (BASOPS) does not decide');
  assert.equal(op('W-1', { kind: 'DeclineTransit', flightDataId: 'fd1' }, 'OPS').reason, 'PERMISSION_DENIED');
  assert.equal(op('W-1', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'CTR').ok, true);
});

test('restricted-like types follow RESTRICTED; a prohibited area, a route and a jurisdiction-free type are refused', () => {
  const { store, op, activate } = setup();
  for (const id of ['R-1', 'D-1', 'P-1']) activate(id);
  assert.equal(op('R-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP').ok, true, 'AP holds the Strip and controls R-1: self-coordinated');
  assert.equal(transitOf(store, 'R-1').state, 'APPROVED');
  assert.equal(op('D-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP').ok, true);
  const p = op('P-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP');
  assert.equal(p.reason, 'VALIDATION_ERROR');
  assert.match(p.detail, /MOA, warning or restricted/);
});

test('refusals: not ACTIVE, VFR, no live Strip, not the holder, unknown flight, no flightDataId', () => {
  const { store, state, op, activate } = setup({ flights: { fd1: ifr(AP_HOLDS), vfr: { callsign: 'C172', ifr: false, holders: AP_HOLDS }, gone: ifr([]) } });
  const notActive = op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP');
  assert.equal(notActive.reason, 'VALIDATION_ERROR');
  assert.match(notActive.detail, /only while it is ACTIVE/);
  activate('MOA-1');
  assert.match(op('MOA-1', { kind: 'RequestTransit', flightDataId: 'vfr' }, 'AP').detail, /is VFR/);
  assert.match(op('MOA-1', { kind: 'ApproveTransit', flightDataId: 'vfr' }, 'CTR').detail, /is VFR/);
  assert.match(op('MOA-1', { kind: 'RequestTransit', flightDataId: 'gone' }, 'AP').detail, /no live Strip/);
  const lc = op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'LC');
  assert.equal(lc.reason, 'PERMISSION_DENIED');
  assert.match(lc.detail, /LC holds no live Strip of VIPER11/);
  assert.equal(op('MOA-1', { kind: 'RequestTransit', flightDataId: 'nope' }, 'AP').reason, 'NOT_FOUND');
  assert.equal(op('MOA-1', { kind: 'RequestTransit' }, 'AP').reason, 'VALIDATION_ERROR');
  assert.deepEqual(store.getAirspace('MOA-1').transits, [], 'nothing was written');
  assert.ok(state);
});

test('decline (with a reason) answers a request or withdraws an approval; the holder may ask again', () => {
  const { store, op, activate } = setup();
  activate('MOA-1');
  assert.equal(op('MOA-1', { kind: 'DeclineTransit', flightDataId: 'fd1' }, 'CTR').reason, 'VALIDATION_ERROR', 'nothing to decline');
  op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP');
  assert.equal(op('MOA-1', { kind: 'DeclineTransit', flightDataId: 'fd1', reason: ' users at all altitudes ' }, 'CTR').ok, true);
  let t = transitOf(store, 'MOA-1');
  assert.deepEqual([t.state, t.reason, t.decidedPositionId], ['DECLINED', 'users at all altitudes', 'CTR']);
  assert.equal(store.approvedTransit('MOA-1', 'fd1'), null);
  assert.equal(op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP').ok, true, 'asks again');
  assert.equal(transitOf(store, 'MOA-1').state, 'REQUESTED');
  op('MOA-1', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'CTR');
  assert.equal(op('MOA-1', { kind: 'DeclineTransit', flightDataId: 'fd1' }, 'CTR').ok, true, 'an approval withdrawn');
  t = transitOf(store, 'MOA-1');
  assert.deepEqual([t.state, t.reason], ['DECLINED', null]);
});

test('cancel: the holder, while requested only', () => {
  const { store, op, activate } = setup();
  activate('MOA-1');
  op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP');
  assert.equal(op('MOA-1', { kind: 'CancelTransit', flightDataId: 'fd1' }, 'LC').reason, 'PERMISSION_DENIED');
  assert.equal(op('MOA-1', { kind: 'CancelTransit', flightDataId: 'fd1' }, 'AP').ok, true);
  assert.deepEqual(store.getAirspace('MOA-1').transits, []);
  op('MOA-1', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'CTR');
  assert.equal(op('MOA-1', { kind: 'CancelTransit', flightDataId: 'fd1' }, 'AP').reason, 'VALIDATION_ERROR', 'an approved transit is not cancelled');
});

test('ends: the airspace is released (para 9-3-1 c), the transits go and the transition counts them', () => {
  const { store, op, activate } = setup();
  activate('MOA-1');
  op('MOA-1', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'CTR');
  assert.equal(op('MOA-1', { kind: 'ReleaseAirspace' }, 'CTR').ok, true);
  const a = store.getAirspace('MOA-1');
  assert.deepEqual(a.transits, []);
  assert.equal(a.transitions.at(-1).transitsEnded, 1);
  assert.equal(store.approvedTransit('MOA-1', 'fd1'), null);
});

test('ends: the last live Strip goes (sweep, audited as the system); a decline is never forgotten on a timer (ADR 0136)', () => {
  const lines = [];
  const { store, state, clock, op, activate } = setup({ flights: { fd1: ifr(AP_HOLDS), fd2: ifr(AP_HOLDS, 'HAWG21') }, mutationLog: { record: (e) => lines.push(e) } });
  activate('MOA-1');
  op('MOA-1', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'CTR');
  op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd2' }, 'AP');
  op('MOA-1', { kind: 'DeclineTransit', flightDataId: 'fd2' }, 'CTR');
  const seen = [];
  assert.deepEqual(store.sweepTransits((v) => seen.push(v)), [], 'nothing to end yet');
  state.flights.fd1 = ifr([]);
  const seq0 = store.currentSeq;
  const changed = store.sweepTransits((v) => seen.push({ seq: store.currentSeq, v }));
  assert.equal(changed.length, 1);
  assert.equal(seen[0].seq, seq0 + 1, 'one change per delta');
  assert.deepEqual(store.getAirspace('MOA-1').transits.map(t => t.flightDataId), ['fd2']);
  const end = lines.find(l => l.op === 'EndTransit');
  assert.deepEqual([end.flightDataId, end.trigger, end.actorId, end.airspaceId], ['fd1', 'NO_LIVE_STRIP', 'system', 'MOA-1']);
  clock.t += 6 * 60 * 60 * 1000;
  assert.equal(store.sweepTransits().length, 0, 'the decline stays until acknowledged');
  assert.equal(transitOf(store, 'MOA-1', 'fd2').state, 'DECLINED');
  state.flights.fd2 = ifr([], 'HAWG21');
  assert.equal(store.sweepTransits().length, 1, 'a decline still ends with the last live Strip');
  assert.deepEqual(store.getAirspace('MOA-1').transits, []);
  assert.equal(lines.filter(l => l.op === 'EndTransit').at(-1).trigger, 'NO_LIVE_STRIP');
});

test('acknowledge (ADR 0136, H156 MTB-Q2 b): whoever holds the flight now reads the decline, which then goes', () => {
  const lines = [];
  const { store, state, op, activate } = setup({ mutationLog: { record: (e) => lines.push(e) } });
  activate('MOA-1');
  assert.equal(op('MOA-1', { kind: 'AcknowledgeTransit', flightDataId: 'fd1' }, 'AP').reason, 'VALIDATION_ERROR', 'nothing declined');
  op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP');
  assert.equal(op('MOA-1', { kind: 'AcknowledgeTransit', flightDataId: 'fd1' }, 'AP').reason, 'VALIDATION_ERROR', 'a request is cancelled, not acknowledged');
  op('MOA-1', { kind: 'DeclineTransit', flightDataId: 'fd1', reason: 'live fire' }, 'CTR');
  assert.equal(op('MOA-1', { kind: 'AcknowledgeTransit', flightDataId: 'fd1' }, 'CTR').reason, 'PERMISSION_DENIED', 'the decider does not acknowledge its own decline');
  // The flight was handed off since the request: the Position holding it now acknowledges, not the one that asked.
  state.flights.fd1 = ifr(CTR_HOLDS);
  assert.equal(op('MOA-1', { kind: 'AcknowledgeTransit', flightDataId: 'fd1' }, 'AP').reason, 'PERMISSION_DENIED');
  state.flights.fd1 = ifr(AP_HOLDS);
  const rev = store.getAirspace('MOA-1').rev;
  assert.equal(op('MOA-1', { kind: 'AcknowledgeTransit', flightDataId: 'fd1' }, 'AP').ok, true);
  assert.deepEqual(store.getAirspace('MOA-1').transits, []);
  assert.equal(store.getAirspace('MOA-1').rev, rev + 1);
  assert.ok(lines.some(l => JSON.stringify(l).includes('"AcknowledgeTransit"') && l.ok !== false), 'audited');
  assert.equal(op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP').ok, true, 'asks again after reading the decline');
});

test('ends: the mission reset (ADR 0108) ends every transit', () => {
  const { store, op, activate } = setup();
  activate('MOA-1');
  activate('R-1');
  op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP');
  op('R-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP');
  const views = [];
  assert.equal(store.resetForMission((v) => views.push(v)).length, 2);
  assert.deepEqual(views.map(v => v.transits), [[], []]);
  assert.deepEqual(store.getAirspace('MOA-1').transits, []);
});

test('a snapshot keeps the transits and its shape is the persisted shape', () => {
  const { store, op, activate } = setup();
  activate('MOA-1');
  op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP');
  const snap = store.snapshot();
  checkPersistedShape({ airspaces: snap }, 'x.json');
  const { store: again } = setup();
  again.restore(JSON.parse(JSON.stringify(snap)));
  assert.equal(again.getAirspace('MOA-1').transits[0].state, 'REQUESTED');
  const bad = JSON.parse(JSON.stringify(snap));
  bad.byTheater.Test.find(r => r.airspaceId === 'MOA-1').transits[0].block = { lowFt: 1 };
  assert.throws(() => checkPersistedShape({ airspaces: bad }, 'x.json'), /unknown key "airspaces.byTheater.Test.\d+.transits.0.block"|unknown key/);
});

// ── docs/adr/0144 (H171 SUA-Q1 b, Q2 b): "Transit complete" by hand, and the decider's acknowledgement ─────────────────

test('transit complete by the holder (ADR 0144): COMPLETED, no longer approved, one EndTransit line; refusals write nothing', () => {
  const lines = [];
  const { store, clock, op, activate } = setup({ mutationLog: { record: (e) => lines.push(e) } });
  activate('MOA-1');
  assert.equal(op('MOA-1', { kind: 'EndTransit', flightDataId: 'fd1' }, 'AP').reason, 'VALIDATION_ERROR', 'no transit');
  op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP');
  assert.match(op('MOA-1', { kind: 'EndTransit', flightDataId: 'fd1' }, 'AP').detail, /no approved transit/, 'a request is cancelled, not completed');
  op('MOA-1', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'CTR');
  const lc = op('MOA-1', { kind: 'EndTransit', flightDataId: 'fd1' }, 'LC');
  assert.equal(lc.reason, 'PERMISSION_DENIED');
  assert.match(lc.detail, /LC neither holds a live Strip of VIPER11 nor decides transits of Test MOA|LC neither holds a live Strip of VIPER11/);
  assert.equal(transitOf(store, 'MOA-1').state, 'APPROVED', 'a refusal wrote nothing');
  assert.equal(lines.filter(l => l.op === 'EndTransit' && l.ok !== false).length, 0);
  clock.t += 120000;
  const r = op('MOA-1', { kind: 'EndTransit', flightDataId: 'fd1' }, 'AP', 'c-ap');
  assert.equal(r.ok, true, r.detail);
  const t = transitOf(store, 'MOA-1');
  assert.deepEqual([t.state, t.completedPositionId, t.completedBy, t.completedAt, t.decidedPositionId], ['COMPLETED', 'AP', 'c-ap', clock.t, 'CTR']);
  assert.equal(store.approvedTransit('MOA-1', 'fd1'), null, 'a re-entry is unapproved again (ADR 0119 alerts)');
  const ends = lines.filter(l => l.op === 'EndTransit' && l.ok);
  assert.equal(ends.length, 1);
  assert.deepEqual([ends[0].trigger, ends[0].flightDataId, ends[0].actingPositionId, ends[0].airspaceId], ['COMPLETED', 'fd1', 'AP', 'MOA-1']);
  assert.equal(op('MOA-1', { kind: 'EndTransit', flightDataId: 'fd1' }, 'AP').reason, 'VALIDATION_ERROR', 'already complete');
  assert.equal(op('MOA-1', { kind: 'DeclineTransit', flightDataId: 'fd1' }, 'CTR').reason, 'VALIDATION_ERROR', 'nothing left to decline');
  assert.deepEqual(store.getAirspace('MOA-1').transitions.map(x => x.state), ['SCHEDULED', 'ACTIVE'], 'no state transition');
});

test('the decider acknowledges a completed transit (ADR 0144, SUA-Q2 b); the holder may not; a new request replaces it', () => {
  const { store, op, activate } = setup();
  activate('MOA-1');
  activate('MOA-T');
  for (const id of ['MOA-1', 'MOA-T']) {
    op(id, { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP');
    op(id, { kind: 'ApproveTransit', flightDataId: 'fd1' }, id === 'MOA-T' ? 'TAC_C2' : 'CTR');
    assert.equal(op(id, { kind: 'EndTransit', flightDataId: 'fd1' }, 'AP').ok, true);
  }
  assert.equal(op('MOA-1', { kind: 'AcknowledgeTransit', flightDataId: 'fd1' }, 'AP').reason, 'PERMISSION_DENIED', 'the holder already knows');
  assert.match(op('MOA-T', { kind: 'AcknowledgeTransit', flightDataId: 'fd1' }, 'CTR').detail, /only TAC_C2 may acknowledge/, 'the MRU decides, so the MRU acknowledges');
  const rev = store.getAirspace('MOA-1').rev;
  assert.equal(op('MOA-1', { kind: 'AcknowledgeTransit', flightDataId: 'fd1' }, 'CTR').ok, true);
  assert.deepEqual(store.getAirspace('MOA-1').transits, []);
  assert.equal(store.getAirspace('MOA-1').rev, rev + 1);
  assert.equal(op('MOA-T', { kind: 'RequestTransit', flightDataId: 'fd1' }, 'AP').ok, true, 'a re-entry is a new transit');
  assert.equal(transitOf(store, 'MOA-T').state, 'REQUESTED');
});

test('transit complete by the decider (ADR 0144): the transit goes at once, nothing to acknowledge', () => {
  const lines = [];
  const { store, op, activate } = setup({ flights: { fd1: ifr(AP_HOLDS), fd2: ifr(CTR_HOLDS, 'HAWG21') }, mutationLog: { record: (e) => lines.push(e) } });
  activate('MOA-1');
  op('MOA-1', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'CTR');
  op('MOA-1', { kind: 'RequestTransit', flightDataId: 'fd2' }, 'CTR'); // self-coordinated
  assert.equal(op('MOA-1', { kind: 'EndTransit', flightDataId: 'fd1' }, 'CTR').ok, true, 'the decider, holding no Strip of it');
  assert.equal(op('MOA-1', { kind: 'EndTransit', flightDataId: 'fd2' }, 'CTR').ok, true, 'holder and decider at once');
  assert.deepEqual(store.getAirspace('MOA-1').transits, []);
  assert.deepEqual(lines.filter(l => l.op === 'EndTransit' && l.ok).map(l => [l.flightDataId, l.trigger]), [['fd1', 'COMPLETED'], ['fd2', 'COMPLETED']]);
});

test('a completed transit is in the persisted shape, and still ends with the last live Strip, the release or the reset', () => {
  const { store, state, op, activate } = setup();
  activate('MOA-1');
  op('MOA-1', { kind: 'ApproveTransit', flightDataId: 'fd1' }, 'CTR');
  op('MOA-1', { kind: 'EndTransit', flightDataId: 'fd1' }, 'AP');
  const snap = store.snapshot();
  checkPersistedShape({ airspaces: snap }, 'x.json');
  const { store: again } = setup();
  again.restore(JSON.parse(JSON.stringify(snap)));
  assert.equal(again.getAirspace('MOA-1').transits[0].state, 'COMPLETED');
  state.flights.fd1 = ifr([]);
  assert.equal(store.sweepTransits().length, 1);
  assert.deepEqual(store.getAirspace('MOA-1').transits, []);
});
