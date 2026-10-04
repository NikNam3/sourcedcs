import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);

// docs/adr/0110 (built by CONSOL-S): the next controller takes the hat. Nothing moves when a Position is left; the first
// staffed member of its offer list is offered it; the offer is standing state on the wire (`hatOffers`). One test per
// walk, named by its W number in the ADR's section 8, plus the findings F1 and F4 and the wire shape.
// The shipped lists (decisions.md H111) are asserted once, in efsp-facility-config.test.mjs.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-consol-hat-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER: 'carrier.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { createEfsp } = await import('../src/efsp/index.js');
const { crew, hold, act, mustAct, jumpTo, DEPARTURE_FLIGHT_DATA } = await import('./helpers/efsp-scenario.mjs');

const person = (id) => ({ controllerId: id, who: id });
const fresh = () => { fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true }); return createEfsp({ currentTheater: () => 'Test' }); };
const strip = (efsp, s, facilityId = 'INCIRLIK') => efsp.boardStoreFor(facilityId).getStrip(s.stripId);
const entries = (res) => res.broadcasts.flatMap(b => (b.positions && b.positions.updated) || []);
const offersAt = (res, positionId) => (entries(res).find(p => p.positionId === positionId) || {}).hatOffers;
const standing = (efsp, positionId, facilityId = 'INCIRLIK') => efsp.snapshotFor(null).positions.find(p => p.facilityId === facilityId && p.positionId === positionId).hatOffers;

/** A DEPARTURE made at OPS and walked to `state` at `toPosition`'s Bay (SetState jumps: this is about who holds it, not the lifecycle). */
function departureAt(efsp, c, callsign, toPosition, bayId, rackId, state) {
  let s = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign, departureRunway: '05' } });
  if (state && state !== 'PROPOSED') s = jumpTo(efsp, c.OPS, 'OPS', s, state);
  return mustAct(efsp, c.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: toPosition, bayId, rackId });
}
const atCd = (efsp, c, callsign, state = 'PENDING_CLEARANCE') => departureAt(efsp, c, callsign, 'CD', state === 'CLEARED' ? 'cd-pending-clearance' : 'cd-pending-clearance', 'main', 'PENDING_CLEARANCE');
const atLcLuaw = (efsp, c, callsign) => {
  const s = departureAt(efsp, c, callsign, 'LC', 'lc-runway-queue', 'rwy-05', 'RUNWAY_QUEUE');
  return jumpTo(efsp, c.LC, 'LC', s, 'LUAW');
};

// ── the wire: hatOffers in the snapshot, the staffing re-send and the mutation delta; self in the snapshot ──

test('hatOffers rides the snapshot, the staffing re-send and a mutation delta that changed offers, and not a delta that did not', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', GC: 'INCIRLIK' });
  const s = atCd(efsp, c, 'HAT1');
  assert.equal(standing(efsp, 'GC').length, 0, 'CD is staffed: no offer');

  const left = hold(efsp, c.CD.session, 'INCIRLIK', []);
  assert.deepEqual(offersAt(left, 'GC'), [{ positionId: 'CD', count: 1, onRunway: 0, observersFirst: false }], 'the staffing re-send');
  assert.deepEqual(standing(efsp, 'GC'), [{ positionId: 'CD', count: 1, onRunway: 0, observersFirst: false }], 'the snapshot');
  const sess = c.GC.session;
  const snap = efsp.snapshotFor(sess);
  assert.deepEqual(snap.self, { controllerId: 'c-GC' });
  assert.deepEqual(snap.positions.find(p => p.positionId === 'GC').hatOffers.map(o => o.positionId), ['CD']);
  assert.equal(efsp.snapshotFor(null).self, undefined, 'a snapshot with no session has no self');

  // A mutation that changes nothing about offers carries no Positions.
  const second = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'HAT2' } });
  const quiet = efsp.handleMessage(c.OPS.session, { version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'INCIRLIK', actingPositionId: 'OPS', stripId: second.stripId, baseRev: second.rev, op: { kind: 'SetFlag', flag: 'highlight', value: true } });
  assert.equal(quiet.ack.ok, true, JSON.stringify(quiet.ack));
  assert.deepEqual(quiet.broadcasts[0].positions.updated, [], 'nothing about offers changed: no Positions');
  // One that moves a Strip to the unstaffed CD changes them (W2 walks the same thing from OPS's NLA).
  const moved = efsp.handleMessage(c.OPS.session, { version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'INCIRLIK', actingPositionId: 'OPS', stripId: second.stripId, baseRev: strip(efsp, second).rev, op: { kind: 'InvokeNla' } });
  assert.equal(moved.ack.ok, true, JSON.stringify(moved.ack));
  assert.equal(offersAt(moved, 'GC')[0].count, 2, 'the delta carries the changed count');
  assert.ok(s);
});

// ── W1 .. W4 ──

test('W1 CD leaves with VIPER1 held, GC staffed: it stays CD\'s, GC is offered CD, takes it and can act as CD', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', GC: 'INCIRLIK' });
  const s = atCd(efsp, c, 'VIPER1');
  const cleared = jumpTo(efsp, c.CD, 'CD', s, 'CLEARED');
  const left = hold(efsp, c.CD.session, 'INCIRLIK', []);
  assert.deepEqual(left.ack.warnings, [{ positionId: 'CD', count: 1, offeredTo: 'GC' }]);
  assert.equal(strip(efsp, cleared).ownerPositionId, 'CD');
  assert.ok(!strip(efsp, cleared).consolidatedFrom);
  assert.deepEqual(offersAt(left, 'GC'), [{ positionId: 'CD', count: 1, onRunway: 0, observersFirst: false }]);
  // GC acting as CD is refused before the hat is taken, and works after.
  assert.equal(act(efsp, c.GC, 'CD', strip(efsp, cleared), { kind: 'SetState', toState: 'HELD' }).reason, 'NOT_HOLDING_POSITION');
  const taken = hold(efsp, c.GC.session, 'INCIRLIK', ['GC', 'CD']);
  assert.deepEqual(taken.ack.signedOn.sort(), ['CD', 'GC']);
  assert.equal(offersAt(taken, 'GC').length, 0, 'staffed again: the offer lapses');
  assert.equal(mustAct(efsp, c.GC, 'CD', strip(efsp, cleared), { kind: 'SetState', toState: 'HELD' }).state, 'HELD');
});

test('W2 OPS sends a flight to CD while CD is empty and GC staffed: delivered to CD with UNSTAFFED_RECEIVER, GC\'s offer appears in the same round trip', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', GC: 'INCIRLIK' });
  let s = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'W2' } });
  const res = efsp.handleMessage(c.OPS.session, { version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'INCIRLIK', actingPositionId: 'OPS', stripId: s.stripId, baseRev: s.rev, op: { kind: 'InvokeNla' } });
  assert.equal(res.ack.ok, true, JSON.stringify(res.ack));
  assert.equal(res.ack.strip.ownerPositionId, 'CD');
  assert.deepEqual(res.ack.warnings.map(w => w.code), ['UNSTAFFED_RECEIVER']);
  assert.match(res.ack.warnings[0].detail, /CD is unstaffed: offered to GC/);
  assert.deepEqual(offersAt(res, 'GC'), [{ positionId: 'CD', count: 1, onRunway: 0, observersFirst: false }], 'the delta carries the changed offers');
  s = strip(efsp, s);
  assert.equal(s.ownerPositionId, 'CD');
});

test('W3 LC leaves with VIPER1 in LUAW, AP staffed: both stay LC\'s, the ack names them, AP\'s offer is on the runway, AP takes LC and clears VIPER1', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK' });
  const dep = atLcLuaw(efsp, c, 'VIPER1');
  const left = hold(efsp, c.LC.session, 'INCIRLIK', []);
  assert.deepEqual(left.ack.warnings, [{ positionId: 'LC', count: 1, offeredTo: 'AP', onRunway: 1 }]);
  assert.equal(strip(efsp, dep).ownerPositionId, 'LC');
  assert.equal(strip(efsp, dep).state, 'LUAW');
  assert.deepEqual(offersAt(left, 'AP'), [{ positionId: 'LC', count: 1, onRunway: 1, observersFirst: false }]);
  const taken = hold(efsp, c.AP.session, 'INCIRLIK', ['AP', 'LC']);
  assert.deepEqual(taken.ack.combination.with, ['AP']);
  assert.equal(taken.ack.combination.luaw, true, 'the combination is warned, severe while LUAW is in use');
  const out = mustAct(efsp, c.AP, 'LC', strip(efsp, dep), { kind: 'SetState', toState: 'DEPARTED' });
  assert.equal(out.state, 'DEPARTED');
});

test('W4 sign-off mid-hand-off: GC hands a departure to LC and LC signs off, in either order, ends in the same state (at LC, offered to AP)', () => {
  const run = (order) => {
    const efsp = fresh();
    const c = crew(efsp, { OPS: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK' });
    const s = departureAt(efsp, c, 'W4', 'GC', 'gc-taxi-out', 'main', 'TAXI');
    const handOff = () => mustAct(efsp, c.GC, 'GC', strip(efsp, s), { kind: 'TransferStrip', toPositionId: 'LC', bayId: 'lc-runway-queue', rackId: 'rwy-05' });
    const leave = () => hold(efsp, c.LC.session, 'INCIRLIK', []);
    if (order === 'handoff-first') { handOff(); leave(); } else { leave(); handOff(); }
    const at = strip(efsp, s);
    return { owner: at.ownerPositionId, state: at.state, bay: at.bayId, offers: standing(efsp, 'AP') };
  };
  const a = run('handoff-first');
  const b = run('leave-first');
  assert.equal(a.owner, 'LC');
  assert.deepEqual(a, b, 'order-insensitive');
  assert.deepEqual(a.offers.map(o => o.positionId), ['LC']);
});

// ── W5, W6, W13, W14: cross-Facility and the carrier ──

test('W5 sign-off mid-hand-off, cross-Facility: AP has no list, the replica stays at AP and the ack says offeredTo null (invariant I holds through the transferring side)', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER' });
  const ctrStrip = mustAct(efsp, c.CTR, 'CTR', null, { kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', stripType: 'ARRIVAL', flightData: { callsign: 'W5', aircraftType: 'F16', wakeCategory: 'D', originAirport: 'LTAC' } });
  const proposed = mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' });
  const replicaId = proposed.coordination.peerStripId;
  const left = hold(efsp, c.AP.session, 'INCIRLIK', []);
  assert.deepEqual(left.ack.warnings, [{ positionId: 'AP', count: 1, offeredTo: null }]);
  assert.equal(strip(efsp, { stripId: replicaId }).ownerPositionId, 'AP');
  assert.equal(standing(efsp, 'LC').length, 0);
});

test('W6 sign-off mid-hand-off, carrier: APP1 leaves with a COMMENCED Strip, APP2 staffed, no Marshal: it stays APP1\'s and APP2 is offered APP1', () => {
  const efsp = fresh();
  const c = crew(efsp, { CV_MARSHAL: 'CARRIER', CV_APP1: 'CARRIER', CV_APP2: 'CARRIER' });
  const made = mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', null, { kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'MARSHAL', flightData: { callsign: 'W6', aircraftType: 'F18', wakeCategory: 'M' } });
  // Commenced to APP1 (the Commence button's result, set directly: this walk is about the sign-off, not the stack)
  const live = strip(efsp, made, 'CARRIER');
  Object.assign(live, { ownerPositionId: 'CV_APP1', state: 'COMMENCED', bayId: 'cv-app1-lane', rackId: 'main' });
  hold(efsp, c.CV_MARSHAL.session, 'CARRIER', []);
  const left = hold(efsp, c.CV_APP1.session, 'CARRIER', []);
  assert.deepEqual(left.ack.warnings, [{ positionId: 'CV_APP1', count: 1, offeredTo: 'CV_APP2' }]);
  assert.equal(strip(efsp, made, 'CARRIER').ownerPositionId, 'CV_APP1');
  assert.deepEqual(offersAt(left, 'CV_APP2').map(o => o.positionId), ['CV_APP1']);
});

test('W13 the carrier with no Marshal staffed: a HANDOFF from CTR into the Marshal is minted and offered to APP1 at once; with nobody on the carrier it is refused (F4)', () => {
  const efsp = fresh();
  const c = crew(efsp, { CTR: 'CENTER' });
  const make = (callsign) => mustAct(efsp, c.CTR, 'CTR', null, { kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', stripType: 'ARRIVAL', flightData: { callsign, aircraftType: 'F18', wakeCategory: 'M', originAirport: 'LTAC' } });
  const first = make('W13A');
  const refusedAck = act(efsp, c.CTR, 'CTR', first, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CARRIER', toPositionId: 'CV_MARSHAL' });
  assert.equal(refusedAck.ok, false, JSON.stringify(refusedAck));
  assert.equal(refusedAck.reason, 'NO_RECEIVING_POSITION');
  assert.equal(efsp.boardStoreFor('CARRIER').getAll().length, 0, 'no replica was minted');

  const app1 = crew(efsp, { CV_APP1: 'CARRIER' });
  const res = efsp.handleMessage(c.CTR.session, { version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'CENTER', actingPositionId: 'CTR', stripId: first.stripId, baseRev: strip(efsp, first, 'CENTER').rev, op: { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CARRIER', toPositionId: 'CV_MARSHAL' } });
  assert.equal(res.ack.ok, true, JSON.stringify(res.ack));
  assert.deepEqual((res.ack.warnings || []).map(w => w.code), ['UNSTAFFED_RECEIVER']);
  const carrierPositions = res.broadcasts.filter(b => b.facilityId === 'CARRIER').flatMap(b => b.positions.updated);
  assert.deepEqual(carrierPositions.find(p => p.positionId === 'CV_APP1').hatOffers.map(o => o.positionId), ['CV_MARSHAL'], 'the peer Facility\'s Positions ride the peer slot');
  assert.ok(app1.CV_APP1);
});

test('W14 PriFly leaves with PATTERN Strips, Marshal staffed: they stay PriFly\'s and the Marshal is offered CV_PRIFLY (H111 Q-C2)', () => {
  const efsp = fresh();
  const c = crew(efsp, { CV_PRIFLY: 'CARRIER', CV_MARSHAL: 'CARRIER' });
  const made = mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', null, { kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'MARSHAL', flightData: { callsign: 'W14', aircraftType: 'F18', wakeCategory: 'M' } });
  Object.assign(strip(efsp, made, 'CARRIER'), { ownerPositionId: 'CV_PRIFLY', stripType: 'PATTERN', state: 'IN_PATTERN', bayId: 'cv-prifly-pattern', rackId: 'initial' });
  const left = hold(efsp, c.CV_PRIFLY.session, 'CARRIER', []);
  assert.deepEqual(left.ack.warnings, [{ positionId: 'CV_PRIFLY', count: 1, offeredTo: 'CV_MARSHAL' }]);
  assert.equal(strip(efsp, made, 'CARRIER').ownerPositionId, 'CV_PRIFLY');
  assert.deepEqual(offersAt(left, 'CV_MARSHAL').map(o => o.positionId), ['CV_PRIFLY']);
});

// ── W7 .. W12 ──

test('W7 sign-on later: GC leaves with Strips while nobody holds LC or AP; a controller signing on to LC later makes the offer appear at once', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', GC: 'INCIRLIK' });
  departureAt(efsp, c, 'W7', 'GC', 'gc-coordination', 'main', 'PROPOSED');
  const left = hold(efsp, c.GC.session, 'INCIRLIK', []);
  assert.deepEqual(left.ack.warnings, [{ positionId: 'GC', count: 1, offeredTo: null }]);
  assert.deepEqual(standing(efsp, 'LC'), []);
  const later = hold(efsp, person('late-lc'), 'INCIRLIK', ['LC']);
  assert.deepEqual(offersAt(later, 'LC'), [{ positionId: 'GC', count: 1, onRunway: 0, observersFirst: false }]);
});

test('W8 a combined controller signs off one of two: A holds LC+GC, signs off GC with a Strip; the offer is derived to A (self), B at AP is not offered it', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', AP: 'INCIRLIK' });
  const a = person('A');
  hold(efsp, a, 'INCIRLIK', ['LC', 'GC']);
  departureAt(efsp, c, 'W8', 'GC', 'gc-coordination', 'main', 'PROPOSED');
  const left = hold(efsp, a, 'INCIRLIK', ['LC']);
  assert.deepEqual(left.ack.warnings, [{ positionId: 'GC', count: 1, offeredTo: 'LC' }]);
  assert.equal(offersAt(left, 'LC').length, 1, 'derived to A (the client hides a self-vacated one)');
  assert.equal(offersAt(left, 'AP').length, 0, 'B is not prompted');
  // A signs off LC too: GC's first staffed member is now AP (LC unstaffed with Strips? it owns none)
  const both = hold(efsp, a, 'INCIRLIK', []);
  assert.deepEqual(offersAt(both, 'AP'), [{ positionId: 'GC', count: 1, onRunway: 0, observersFirst: false }]);
});

test('W9 A holds LC+GC and signs off LC with a LUAW departure, keeps GC; B holds AP: stays LC\'s, B offered LC with the runway count', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', AP: 'INCIRLIK' });
  const a = person('A');
  hold(efsp, a, 'INCIRLIK', ['LC', 'GC']);
  const s = departureAt(efsp, c, 'W9', 'LC', 'lc-runway-queue', 'rwy-05', 'RUNWAY_QUEUE');
  jumpTo(efsp, { session: a, facilityId: 'INCIRLIK' }, 'LC', s, 'LUAW');
  const left = hold(efsp, a, 'INCIRLIK', ['GC']);
  assert.deepEqual(left.ack.warnings, [{ positionId: 'LC', count: 1, offeredTo: 'AP', onRunway: 1 }]);
  assert.deepEqual(offersAt(left, 'AP'), [{ positionId: 'LC', count: 1, onRunway: 1, observersFirst: false }]);
});

test('W10 reconnect: the snapshot a reconnecting session gets carries the standing offer and its own controllerId', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', GC: 'INCIRLIK' });
  atCd(efsp, c, 'W10');
  hold(efsp, c.CD.session, 'INCIRLIK', []);
  const snap = efsp.snapshotFor(c.GC.session);
  assert.deepEqual(snap.positions.find(p => p.positionId === 'GC').hatOffers.map(o => o.positionId), ['CD']);
  assert.equal(snap.self.controllerId, 'c-GC');
  const resync = efsp.handleMessage(c.GC.session, { type: 'efsp-resync', facilityId: 'INCIRLIK', lastBoardSeq: -1 });
  assert.equal(resync.ack.answer, 'snapshot');
  assert.deepEqual(resync.ack.positions.find(p => p.positionId === 'GC').hatOffers.map(o => o.positionId), ['CD']);
  assert.equal(resync.ack.self.controllerId, 'c-GC');
});

test('W11 grace expiry: the controller held CD and GC; B holds LC; both CD and GC are offered to B', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', LC: 'INCIRLIK' });
  const a = person('A');
  hold(efsp, a, 'INCIRLIK', ['CD', 'GC']);
  atCd(efsp, c, 'W11A');
  departureAt(efsp, c, 'W11B', 'GC', 'gc-coordination', 'main', 'PROPOSED');
  const out = efsp.onDisconnect(a); // the grace ran out
  assert.ok(out.broadcasts.length > 0);
  const offers = standing(efsp, 'LC');
  assert.deepEqual(offers.map(o => o.positionId).sort(), ['CD', 'GC']);
});

test('W12 takeover during the grace: B signs on to GC held by absent A (who held CD and GC); at expiry CD is offered to B at GC', () => {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  const absent = new Set(['A']);
  const efsp = createEfsp({ currentTheater: () => 'Test', isAbsent: (id) => absent.has(id) });
  const c = crew(efsp, { OPS: 'INCIRLIK' });
  hold(efsp, person('A'), 'INCIRLIK', ['CD', 'GC']);
  atCd(efsp, c, 'W12');
  const taken = hold(efsp, person('B'), 'INCIRLIK', ['GC']);
  assert.equal(efsp.positionStoreFor('INCIRLIK').primaryOf('GC'), 'B', 'B is GC\'s Primary at once');
  assert.equal(efsp.positionStoreFor('INCIRLIK').primaryOf('CD'), 'A', 'CD is still A\'s (absent, within the grace)');
  assert.equal(offersAt(taken, 'GC').length, 0);
  // grace expiry: A is signed off every Position
  efsp.onDisconnect(person('A'));
  assert.deepEqual(standing(efsp, 'GC').map(o => o.positionId), ['CD']);
});

// ── W15 .. W19 ──

test('W15 an Observer sits at GC; GC\'s Primary signs off with Strips; LC staffed: the Observer is offered Primary (F1) and LC is offered GC', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK' });
  const obs = person('obs');
  hold(efsp, obs, 'INCIRLIK', ['GC']);
  departureAt(efsp, c, 'W15', 'GC', 'gc-coordination', 'main', 'PROPOSED');
  const left = hold(efsp, c.GC.session, 'INCIRLIK', []);
  const gc = entries(left).find(p => p.positionId === 'GC');
  assert.equal(gc.primary, null);
  assert.deepEqual(gc.observers.map(o => o.controllerId), ['obs']);
  assert.deepEqual(offersAt(left, 'LC'), [{ positionId: 'GC', count: 1, onRunway: 0, observersFirst: true }], 'observersFirst: the Observer is offered it before LC');
  const taken = hold(efsp, obs, 'INCIRLIK', ['GC']);
  assert.equal(efsp.positionStoreFor('INCIRLIK').primaryOf('GC'), 'obs');
  assert.equal(offersAt(taken, 'LC').length, 0);
});

test('W16 a pilot calls for taxi while GC is empty and LC is offered GC but has not taken it: the Strip is at GC, LC cannot advance it, and the offer counts it', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', LC: 'INCIRLIK' });
  const s = departureAt(efsp, c, 'W16', 'GC', 'gc-coordination', 'main', 'PROPOSED');
  assert.equal(strip(efsp, s).ownerPositionId, 'GC');
  assert.equal(act(efsp, c.LC, 'GC', strip(efsp, s), { kind: 'SetState', toState: 'PUSHBACK' }).reason, 'NOT_HOLDING_POSITION');
  assert.deepEqual(standing(efsp, 'LC').map(o => [o.positionId, o.count]), [['GC', 1]]);
});

test('W17 the hat-taker is an Observer elsewhere: B observes LC (A is Primary), A leaves LC with a Strip; B is listed first (observersFirst) and AP is offered second', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK' });
  const b = person('B');
  hold(efsp, b, 'INCIRLIK', ['LC']);
  departureAt(efsp, c, 'W17', 'LC', 'lc-runway-queue', 'rwy-05', 'RUNWAY_QUEUE');
  const left = hold(efsp, c.LC.session, 'INCIRLIK', []);
  assert.deepEqual(offersAt(left, 'AP'), [{ positionId: 'LC', count: 1, onRunway: 0, observersFirst: true }]);
  assert.deepEqual(entries(left).find(p => p.positionId === 'LC').observers.map(o => o.controllerId), ['B']);
});

test('W18 undo of a hand-off delivered to an unstaffed Position re-sends Positions and the offer lapses', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', GC: 'INCIRLIK' });
  const s = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'W18' } });
  const res = efsp.handleMessage(c.OPS.session, { version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'INCIRLIK', actingPositionId: 'OPS', stripId: s.stripId, baseRev: s.rev, op: { kind: 'InvokeNla' } });
  assert.equal(res.ack.ok, true);
  assert.equal(standing(efsp, 'GC').length, 1);
  const undone = efsp.handleMessage(c.OPS.session, { version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'INCIRLIK', actingPositionId: 'OPS', stripId: s.stripId, op: { kind: 'Undo', actionId: res.ack.undoable.actionId } });
  assert.equal(undone.ack.ok, true, JSON.stringify(undone.ack));
  assert.equal(strip(efsp, s).ownerPositionId, 'OPS');
  assert.deepEqual(offersAt(undone, 'GC'), [], 'the undo\'s delta carries Positions: the offer lapsed');
  assert.equal(standing(efsp, 'GC').length, 0);
});

test('W19 a new mission (ADR 0108) ends every live Strip: every offer lapses', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', GC: 'INCIRLIK' });
  atCd(efsp, c, 'W19');
  hold(efsp, c.CD.session, 'INCIRLIK', []);
  assert.equal(standing(efsp, 'GC').length, 1);
  efsp.resetForMission();
  assert.equal(standing(efsp, 'GC').length, 0);
});

// ── findings ──

test('F1 the Observer left behind by a normal sign-off takes the Position by re-sending its declared set (the wire path)', () => {
  const efsp = fresh();
  const c = crew(efsp, { GC: 'INCIRLIK' });
  const obs = person('obs');
  hold(efsp, obs, 'INCIRLIK', ['GC']);
  hold(efsp, c.GC.session, 'INCIRLIK', []);
  assert.equal(efsp.positionStoreFor('INCIRLIK').primaryOf('GC'), null);
  hold(efsp, obs, 'INCIRLIK', ['GC']);
  assert.equal(efsp.positionStoreFor('INCIRLIK').primaryOf('GC'), 'obs');
});

test('F4 a HANDOFF into an unstaffed Position nobody is offered is refused; into one a staffed Position is offered, it is minted and the sender is warned', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER' });
  hold(efsp, c.AP.session, 'INCIRLIK', []);
  const s = mustAct(efsp, c.CTR, 'CTR', null, { kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', stripType: 'ARRIVAL', flightData: { callsign: 'F4', aircraftType: 'F16', wakeCategory: 'D', originAirport: 'LTAC' } });
  const nobody = act(efsp, c.CTR, 'CTR', s, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' });
  assert.equal(nobody.ok, false);
  assert.equal(nobody.reason, 'NO_RECEIVING_POSITION');
  assert.equal(efsp.boardStoreFor('INCIRLIK').getAll().length, 0);
});

test('LC leaving with an aircraft in LUAW leaves nothing at AP; AP\'s own INBOUND hand-off to an empty LC is delivered to LC and offered to AP, not routed back to AP', () => {
  const efsp = fresh();
  const c = crew(efsp, { OPS: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK' });
  const dep = atLcLuaw(efsp, c, 'LUAWX');
  hold(efsp, c.LC.session, 'INCIRLIK', []);
  assert.equal(strip(efsp, dep).ownerPositionId, 'LC');
  assert.equal(efsp.boardStoreFor('INCIRLIK').getAll().filter(s => s.ownerPositionId === 'AP').length, 0, 'nothing parked at AP');

  const inbound = mustAct(efsp, c.AP, 'AP', null, { kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL', flightData: { callsign: 'INB1', aircraftType: 'F16', wakeCategory: 'D', originAirport: 'LTAC', destinationAirport: 'LTAG' } });
  const res = efsp.handleMessage(c.AP.session, { version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'INCIRLIK', actingPositionId: 'AP', stripId: inbound.stripId, baseRev: inbound.rev, op: { kind: 'InvokeNla' } });
  assert.equal(res.ack.ok, true, JSON.stringify(res.ack));
  assert.equal(res.ack.strip.ownerPositionId, 'LC', 'delivered to LC, not routed back to AP');
  assert.equal(res.ack.strip.state, 'HANDED_TO_TOWER');
  assert.deepEqual(res.ack.warnings.map(w => w.code), ['UNSTAFFED_RECEIVER']);
});

test('combination warnings: LC+AP, LC+OPS, LC+SFA/PAR combine; LC+RSU and CD+GC do not; LUAW_WHILE_COMBINED applies with AP', () => {
  const efsp = fresh();
  const a = person('A');
  const ack = (set) => hold(efsp, a, 'INCIRLIK', set).ack;
  assert.deepEqual(ack(['LC', 'AP']).combination.with, ['AP']);
  assert.deepEqual(ack(['LC', 'OPS']).combination.with, ['OPS']);
  assert.deepEqual(ack(['LC', 'SFA', 'PAR']).combination.with, ['SFA', 'PAR']);
  assert.equal(ack(['LC', 'RSU']).combination, null);
  assert.equal(ack(['CD', 'GC']).combination, null);
  hold(efsp, a, 'INCIRLIK', []);
  const c = crew(efsp, { OPS: 'INCIRLIK' });
  hold(efsp, a, 'INCIRLIK', ['LC', 'AP']);
  const s = departureAt(efsp, c, 'CMB', 'LC', 'lc-runway-queue', 'rwy-05', 'RUNWAY_QUEUE');
  const r = act(efsp, { session: a, facilityId: 'INCIRLIK' }, 'LC', s, { kind: 'SetState', toState: 'LUAW' });
  assert.equal(r.ok, true, 'never blocks');
  assert.ok((r.warnings || []).some(w => w.code === 'LUAW_WHILE_COMBINED'));
  assert.equal(hold(efsp, a, 'INCIRLIK', ['LC', 'AP']).ack.combination.luaw, true);
});

test('onRunway counts a DEPARTURE in LUAW and an ARRIVAL in FINAL, not DEPARTED (airborne) nor RUNWAY_QUEUE; hatOffersFor skips a handBack source and a staffed Position', () => {
  const combination = require_('../src/efsp/combination.js');
  const { PositionStore } = require_('../src/efsp/position-store.js');
  const strips = [
    { stripType: 'DEPARTURE', state: 'LUAW', ownerPositionId: 'LC' }, { stripType: 'ARRIVAL', state: 'FINAL', ownerPositionId: 'LC' },
    { stripType: 'DEPARTURE', state: 'DEPARTED', ownerPositionId: 'LC' }, { stripType: 'DEPARTURE', state: 'RUNWAY_QUEUE', ownerPositionId: 'LC' },
    { stripType: 'DEPARTURE', state: 'DROPPED', ownerPositionId: 'LC' }, { stripType: 'MISSION', state: 'TASKED', ownerPositionId: 'AIC' },
  ];
  assert.equal(combination.onRunwayCount(strips), 2);
  const store = new PositionStore(['LC', 'AP', 'AIC', 'TAC_C2'], { consolidation: { LC: ['AP'] }, handBack: { AIC: 'TAC_C2' } });
  store.setSignedOnPositions('a', 'A', ['AP']);
  store.setSignedOnPositions('t', 'T', ['TAC_C2']);
  assert.deepEqual(combination.hatOffersFor(store, 'AP', strips), [{ positionId: 'LC', count: 4, onRunway: 2, observersFirst: false }]);
  assert.deepEqual(combination.hatOffersFor(store, 'TAC_C2', strips), [], 'a handBack source is never offered');
  store.setSignedOnPositions('l', 'L', ['LC']);
  assert.deepEqual(combination.hatOffersFor(store, 'AP', strips), [], 'LC is staffed: no offer');
});
