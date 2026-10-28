import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prologue, fakeClock, makeWorld, exchange, holders } from './helpers/control-release-fixture.mjs';

// The control tick and the attention it raises (docs/adr/0122, H142/H143): a not-released HANDOFF the receiver has
// checked in moves control once the aircraft is inside the receiving Position's airspace (ADR 0125's
// `isInsideJurisdictionOf`, on the shipped Syria areas); never before check-in, never on a null answer. And the handoff
// guards' seam (ADR 0120) at the offer and at the control move.

prologue('control-release-boundary-', { jurisdiction: true });
const { createEfsp } = await import('../src/efsp/index.js');
const helpers = await import('./helpers/efsp-scenario.mjs');
const { act, mustAct } = helpers;
const { ForwardingObligationMonitor } = await import('../src/efsp/forwarding-obligations.js');
const { HANDOFF_GUARDS } = await import('../src/efsp/handoff-guards.js');

// Points (feet MSL), on the shipped areas: LTAG-CZ (LC, GC) 5 nm SFC-3000 round the field; LTAG-RAPCON (AP, PAR) 50 nm
// SFC-FL280 minus the CZ; CENTER everything else.
const OUTSIDE = { lat: 38.4, lon: 35.43, altFt: 15000 };     // ~84 nm north: CENTER's
const IN_RAPCON = { lat: 37.4, lon: 35.43, altFt: 10000 };   // ~24 nm north: RAPCON's
const IN_TOWER = { lat: 36.995, lon: 35.435, altFt: 1500 };  // on the field's side of the cut: the tower's
const ABOVE_TOWER = { ...IN_TOWER, altFt: 6000 };            // above the CZ's ceiling: RAPCON's again

function world({ clock = fakeClock() } = {}) {
  const positions = new Map();
  const w = makeWorld(createEfsp, helpers, {
    clock, currentTheater: () => 'Syria',
    locateTrack: (trackId) => positions.get(trackId) || null,
  });
  w.place = (trackId, where) => positions.set(trackId, where);
  return w;
}

function correlate(w, ex, trackId) {
  const r = w.efsp.correlationStore.apply({ clientMutationId: crypto.randomUUID(), flightDataId: ex.flightDataId, baseRev: 0, op: { kind: 'BindTrack', trackId } }, 'CTR', 'c-CTR');
  assert.equal(r.ok, true, JSON.stringify(r));
}

const ex0 = (w, callsign, opts) => exchange(w, helpers, callsign, opts);
const asR = (w, ex, op, to = 'AP') => act(w.efsp, w.c[to], to, ex.R(), op);
const mustR = (w, ex, op, to = 'AP') => mustAct(w.efsp, w.c[to], to, ex.R(), op);
const mustT = (w, ex, op) => mustAct(w.efsp, w.c.CTR, 'CTR', ex.T(), op);
const CHECK_IN = { kind: 'HANDOFF', action: 'CHECKED_IN' };
const log = (w) => w.efsp.mutationLog.readAll();

test('not released + checked in + outside: control stays; once the aircraft is inside the receiver\'s airspace, the tick moves it', () => {
  const w = world();
  const ex = ex0(w, 'BND1', { released: false });
  correlate(w, ex, '101');
  w.place('101', OUTSIDE);
  mustR(w, ex, CHECK_IN);
  assert.deepEqual(w.efsp.settleHandoffControl(), { moved: 0, messages: [] }, 'outside RAPCON: nothing moves');
  assert.equal(holders(ex).control, 'TRANSFERRING');
  w.place('101', IN_RAPCON);
  const { moved, messages } = w.efsp.settleHandoffControl();
  assert.equal(moved, 1);
  assert.deepEqual(holders(ex), { comms: 'RECEIVING', control: 'RECEIVING', ref: { facilityId: 'INCIRLIK', positionId: 'AP' } });
  assert.equal(ex.T().coordination.control.trigger, 'IN_AIRSPACE');
  assert.equal(ex.T().coordination.control.airspaceId, 'LTAG-RAPCON');
  assert.equal(ex.T().coordination.control.by, 'system');
  assert.deepEqual(messages.map(m => m.facilityId).sort(), ['CENTER', 'INCIRLIK'], 'one board-delta per Facility');
  const entry = log(w).filter(e => e.op === 'HandoffControlInAirspace').pop();
  assert.ok(entry, 'audited as a system Mutation');
  assert.deepEqual(entry.control, { trigger: 'IN_AIRSPACE', airspaceId: 'LTAG-RAPCON', to: 'AP' });
  assert.equal(w.efsp.settleHandoffControl().moved, 0, 'once only');
});

test('not released + inside + NOT checked in: control stays (check-in takes precedence), and both sides are asked for attention', () => {
  const clock = fakeClock();
  const w = world({ clock });
  const ex = ex0(w, 'BND2', { released: false });
  correlate(w, ex, '102');
  w.place('102', IN_RAPCON);
  assert.equal(w.efsp.settleHandoffControl().moved, 0);
  assert.equal(holders(ex).control, 'TRANSFERRING');
  const monitor = new ForwardingObligationMonitor({
    boardStoreFor: w.efsp.boardStoreFor, flightDataStore: w.efsp.flightDataStore, facilityConfig: w.efsp.facilityConfig,
    airspaceStore: w.efsp.airspaceStore, clock, handoffConfig: { notCheckedInSec: 60 }, insideReceiverAirspace: w.efsp.insideReceiverAirspace,
  });
  monitor.tick();
  const inAirspace = monitor.getAll().filter(o => o.obligationType === 'IN_AIRSPACE_NOT_CHECKED_IN');
  assert.deepEqual(inAirspace.map(o => o.facilityId).sort(), ['CENTER', 'INCIRLIK'], 'both Strips of the exchange');
  assert.equal(monitor.getAll().filter(o => o.obligationType === 'NOT_CHECKED_IN').length, 0, 'not yet 60 s');
  clock.advance(61_000);
  monitor.tick();
  const late = monitor.getAll().filter(o => o.obligationType === 'NOT_CHECKED_IN');
  assert.deepEqual(late.map(o => o.facilityId), ['INCIRLIK'], 'the receiver only');
  // The pilot calls: control moves on the next tick, and every attention item goes (dark cockpit).
  mustR(w, ex, CHECK_IN);
  assert.equal(w.efsp.settleHandoffControl().moved, 1);
  monitor.tick();
  assert.equal(monitor.getAll().filter(o => ['NOT_CHECKED_IN', 'IN_AIRSPACE_NOT_CHECKED_IN'].includes(o.obligationType)).length, 0);
});

test('NOT_CHECKED_IN: a released handoff accepted and not checked in after the threshold; nothing once checked in', () => {
  const clock = fakeClock();
  const w = world({ clock });
  const ex = ex0(w, 'BND3');
  const monitor = new ForwardingObligationMonitor({
    boardStoreFor: w.efsp.boardStoreFor, flightDataStore: w.efsp.flightDataStore, facilityConfig: w.efsp.facilityConfig,
    airspaceStore: w.efsp.airspaceStore, clock, handoffConfig: { notCheckedInSec: 60 }, insideReceiverAirspace: w.efsp.insideReceiverAirspace,
  });
  clock.advance(60_000);
  monitor.tick();
  assert.deepEqual(monitor.getAll().filter(o => o.obligationType === 'NOT_CHECKED_IN').map(o => o.facilityId), ['INCIRLIK']);
  mustR(w, ex, CHECK_IN);
  monitor.tick();
  assert.equal(monitor.getAll().filter(o => o.obligationType === 'NOT_CHECKED_IN').length, 0);
  // Without the tuning value the monitor raises none (a fixture with no alerting config).
  const bare = new ForwardingObligationMonitor({ boardStoreFor: w.efsp.boardStoreFor, flightDataStore: w.efsp.flightDataStore, facilityConfig: w.efsp.facilityConfig, clock });
  const ex2 = ex0(w, 'BND3B');
  clock.advance(120_000);
  bare.tick();
  assert.equal(bare.getAll().filter(o => o.obligationType === 'NOT_CHECKED_IN').length, 0);
  assert.ok(ex2.R());
});

test('AP -> CTR not released: control waits while the departure is in RAPCON, moves on crossing into CENTER\'s airspace', () => {
  const w = world();
  const dep = helpers.airborneDeparture(w.efsp, w.c, { ...helpers.DEPARTURE_FLIGHT_DATA, callsign: 'BND4' });
  const appStrip = mustAct(w.efsp, w.c.AP, 'AP', dep, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR', released: false });
  const ex = {
    T: () => w.efsp.boardStoreFor('INCIRLIK').getStrip(dep.stripId),
    R: () => w.efsp.boardStoreFor('CENTER').getStrip(appStrip.coordination.peerStripId),
    flightDataId: dep.flightDataId,
  };
  mustAct(w.efsp, w.c.CTR, 'CTR', ex.R(), { kind: 'HANDOFF', action: 'ACCEPT' });
  correlate(w, ex, '104');
  w.place('104', IN_RAPCON);
  mustAct(w.efsp, w.c.CTR, 'CTR', ex.R(), CHECK_IN);
  assert.equal(w.efsp.settleHandoffControl().moved, 0, 'still in RAPCON');
  w.place('104', { ...IN_RAPCON, altFt: 29000 });
  assert.equal(w.efsp.settleHandoffControl().moved, 1, 'above RAPCON\'s ceiling is CENTER\'s');
  assert.equal(ex.T().coordination.control.airspaceId, null, 'CENTER is the fallback: no area id');
  assert.deepEqual(holders(ex).ref, { facilityId: 'CENTER', positionId: 'CTR' });
});

test('a receiver whose airspace is the tower\'s (LC, GC) is judged on the LTAG CTR control zone, not RAPCON (H143, H145)', () => {
  const w = world();
  for (const p of ['LC', 'GC']) {
    assert.equal(w.efsp.airspaceStore.isInsideJurisdictionOf(p, IN_TOWER), true, p);
    assert.equal(w.efsp.airspaceStore.isInsideJurisdictionOf(p, ABOVE_TOWER), false, p);
    assert.equal(w.efsp.airspaceStore.isInsideJurisdictionOf(p, IN_RAPCON), false, p);
  }
  assert.equal(w.efsp.airspaceStore.jurisdictionAt(IN_TOWER).airspaceId, 'LTAG-CZ');
});

test('PAR\'s airspace is RAPCON\'s (H143): the receiving-airspace question for AP and PAR has the same answer', () => {
  const w = world();
  for (const where of [IN_RAPCON, ABOVE_TOWER]) {
    assert.equal(w.efsp.airspaceStore.isInsideJurisdictionOf('AP', where), true);
    assert.equal(w.efsp.airspaceStore.isInsideJurisdictionOf('PAR', where), true);
    assert.equal(w.efsp.airspaceStore.isInsideJurisdictionOf('LC', where), false);
  }
  assert.equal(w.efsp.airspaceStore.isInsideJurisdictionOf('CTR', OUTSIDE), true, 'CENTER is the fallback');
});

test('released + checked in moves control at check-in; the tick has nothing to do', () => {
  const w = world();
  const ex = ex0(w, 'BND5');
  correlate(w, ex, '105');
  w.place('105', OUTSIDE);
  mustR(w, ex, CHECK_IN);
  assert.equal(holders(ex).control, 'RECEIVING', 'released: no airspace question');
  assert.equal(w.efsp.settleHandoffControl().moved, 0);
});

test('no geometry to judge: no correlated track, no position, or a point nobody owns: a not-released handoff waits', () => {
  const w = world();
  const ex = ex0(w, 'BND6', { released: false });
  mustR(w, ex, CHECK_IN);
  assert.equal(w.efsp.settleHandoffControl().moved, 0, 'uncorrelated');
  correlate(w, ex, '106');
  assert.equal(w.efsp.settleHandoffControl().moved, 0, 'correlated, no position');
  w.place('106', { lat: 37.4, lon: 35.43, altFt: NaN });
  assert.equal(w.efsp.settleHandoffControl().moved, 0, 'an altitude that cannot be judged');
  assert.equal(w.efsp.insideReceiverAirspace(ex.R()), false);
  assert.equal(holders(ex).control, 'TRANSFERRING');
});

test('the tick moves control only to a live, covered receiver (the control invariant)', () => {
  const w = world();
  const ex = ex0(w, 'BND7', { released: false });
  correlate(w, ex, '107');
  mustR(w, ex, CHECK_IN);
  w.place('107', IN_RAPCON);
  const strip = ex.T();
  const store = w.efsp.boardStoreFor('CENTER');
  // The receiver's coverage is read at the write: an uncovered receiver is refused, nothing written.
  const control = store._control;
  const sides = control._sides.bind(control);
  control._sides = (s) => { const r = sides(s); return { ...r, receiving: { ...r.receiving, covered: false } }; };
  try {
    assert.deepEqual(store.settleAtBoundary(strip.stripId, { airspaceId: 'LTAG-RAPCON' }), { ok: false, reason: 'NOT_STAFFED' });
    assert.equal(holders(ex).control, 'TRANSFERRING');
  } finally { control._sides = sides; }
  assert.equal(w.efsp.settleHandoffControl().moved, 1);
});

test('a granted release on a not-released, checked-in handoff moves control at once, wherever the aircraft is', () => {
  const w = world();
  const ex = ex0(w, 'BND8', { released: false });
  correlate(w, ex, '108');
  w.place('108', OUTSIDE);
  mustR(w, ex, CHECK_IN);
  mustR(w, ex, { kind: 'ControlRelease', action: 'REQUEST' });
  mustT(w, ex, { kind: 'ControlRelease', action: 'GRANT' });
  assert.equal(holders(ex).control, 'RECEIVING');
  assert.equal(ex.T().coordination.control.trigger, 'RELEASED');
});

test('the handoff guards (ADR 0120\'s seam): keyed on the receiving Position, at the offer and again at the control move', () => {
  const calls = [];
  let refuseAt = null;
  const guard = (ctx) => {
    calls.push(`${ctx.phase}:${ctx.receivingFacilityId}/${ctx.receivingPositionId}`);
    return ctx.phase === refuseAt ? { reason: 'VALIDATION_ERROR', detail: `guard says no at ${ctx.phase}` } : null;
  };
  HANDOFF_GUARDS.push(guard);
  try {
    // At the offer.
    refuseAt = 'OFFER';
    const w = world();
    const enroute = mustAct(w.efsp, w.c.CTR, 'CTR', null, {
      kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', stripType: 'ARRIVAL',
      flightData: { callsign: 'GRD1', aircraftType: 'C130', wakeCategory: 'M', originAirport: 'LTAC' },
    });
    const offered = act(w.efsp, w.c.CTR, 'CTR', enroute, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' });
    assert.equal(offered.ok, false);
    assert.match(offered.detail, /guard says no at OFFER/);
    assert.deepEqual(calls, ['OFFER:INCIRLIK/AP']);
    // At the control move: CHECKED_IN on a released handoff is refused whole; the tick moves nothing.
    refuseAt = 'CONTROL';
    calls.length = 0;
    const ex = ex0(w, 'GRD2');
    const ack = asR(w, ex, CHECK_IN);
    assert.equal(ack.ok, false);
    assert.match(ack.detail, /guard says no at CONTROL/);
    assert.equal(holders(ex).comms, 'TRANSFERRING', 'nothing written');
    const ex2 = ex0(w, 'GRD3', { released: false });
    correlate(w, ex2, '109');
    w.place('109', IN_RAPCON);
    mustR(w, ex2, CHECK_IN);
    assert.equal(w.efsp.settleHandoffControl().moved, 0, 'the tick asks again next time');
    refuseAt = null;
    assert.equal(w.efsp.settleHandoffControl().moved, 1);
    assert.ok(calls.includes('CONTROL:INCIRLIK/AP'));
  } finally {
    HANDOFF_GUARDS.splice(HANDOFF_GUARDS.indexOf(guard), 1);
  }
});

test('a POINT_OUT, AIT or TOFI never reaches the tick (only a HANDOFF moves control in steps)', () => {
  const w = world();
  const enroute = mustAct(w.efsp, w.c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: 'PO9', aircraftType: 'C130', wakeCategory: 'M', originAirport: 'LTAC' },
  });
  mustAct(w.efsp, w.c.CTR, 'CTR', enroute, { kind: 'POINT_OUT', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' });
  assert.deepEqual(w.efsp.boardStoreFor('CENTER').boundaryCandidates(), []);
});
