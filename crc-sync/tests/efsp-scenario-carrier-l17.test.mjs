import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { slot } from './helpers/wire-slots.mjs';

// The carrier flow on the wire (docs/adr/0156): a launch from the deck to the Marshal, a recovery from the stack to the
// drop in each Case, Back to stack, Abort to the Case II/III stack, the Case as broadcast state, and the whole thing
// surviving a restart. Same prologue as every scenario file: its own paths.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-carrier-l17-'));
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
const { hold, freshEfsp, act, mustAct, carrierAct, mustCarrierAct, advance, recoveryCheckIn, launchOnDeck } = await import('./helpers/efsp-scenario.mjs');

const STAFFED = { CV_MARSHAL: 'CARRIER', CV_PRIFLY: 'CARRIER', CV_APP1: 'CARRIER', CV_APP2: 'CARRIER', CV_DEP: 'CARRIER' };
const strip = (efsp, id) => efsp.boardStoreFor('CARRIER').getStrip(id);
const live = (efsp) => efsp.boardStoreFor('CARRIER').getAll().filter(s => s.state !== 'DROPPED');
const stack = (efsp, id = 'MAIN') => efsp.carrierStore.getRecord().stacks[id].entries;
const view = (efsp) => efsp.carrierStore.view();
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const nlaSink = { fn: () => {} }; // createEfsp's onNlaDelta; a test points it at its own list
const fresh = () => freshEfsp(createEfsp, STAFFED, { onNlaDelta: (p) => nlaSink.fn(p) });
const setCase = (efsp, c, value) => mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCarrierState', field: 'case', value });
const press = (efsp, c, pos, s) => advance(efsp, c[pos], pos, strip(efsp, s.stripId));
const handoff = (efsp, c, pos, s, transfer, toPositionId) => act(efsp, c[pos], pos, strip(efsp, s.stripId), { kind: 'CarrierHandoff', transfer, ...(toPositionId ? { toPositionId } : {}) });
const code = (efsp, s) => efsp.flightDataStore.getFlightData(s.flightDataId).identity.beaconAssigned;

function refused(ack, reason, detail, label = '') {
  assert.equal(ack.ok, false, `${label} should be refused: ${JSON.stringify(ack)}`);
  if (reason) assert.equal(ack.reason, reason, `${label}: ${JSON.stringify(ack)}`);
  if (detail) assert.match(ack.detail, detail, label);
}

test('Case III launch: ON_DECK, LAUNCHED to departure, KILO, TO MARSHAL: the same Strip, flight and squawk become the recovery in the stack', async () => {
  const { efsp, c } = fresh();
  const launch = launchOnDeck(efsp, c, '301', { departureRadialDeg: 90 });
  assert.deepEqual([launch.stripType, launch.state, launch.ownerPositionId, launch.bayId], ['CV_LAUNCH', 'ON_DECK', 'CV_PRIFLY', 'cv-prifly-launch']);
  const fd = efsp.flightDataStore.getFlightData(launch.flightDataId);
  assert.deepEqual([fd.identity.callsign, fd.military.carrier.sideNumber, fd.military.carrier.departureRadialDeg], ['', '301', 90]);
  const squawk = code(efsp, launch);
  assert.ok(squawk, 'Case III: a squawk');
  const airborne = await press(efsp, c, 'CV_PRIFLY', launch);
  assert.deepEqual([airborne.state, airborne.ownerPositionId, airborne.bayId, airborne.carrierHandoff.kind], ['CV_AIRBORNE', 'CV_DEP', 'cv-dep-departures', 'LAUNCH_TO_DEPARTURE']);
  const kilo = await press(efsp, c, 'CV_DEP', launch);
  assert.equal(kilo.state, 'KILO');
  assert.equal(efsp.boardStoreFor('CARRIER').nlaStatusFor(strip(efsp, launch.stripId)).alsoHandoff, 'DEPARTURE_TO_MARSHAL', 'TO MARSHAL beside DROP');
  const ack = handoff(efsp, c, 'CV_DEP', launch, 'DEPARTURE_TO_MARSHAL');
  assert.equal(ack.ok, true, JSON.stringify(ack));
  const rec = strip(efsp, launch.stripId);
  assert.deepEqual([rec.stripType, rec.state, rec.ownerPositionId, rec.bayId, rec.flightDataId], ['CV_RECOVERY', 'STACK', 'CV_MARSHAL', 'cv-marshal-stack', launch.flightDataId]);
  assert.equal(rec.previousLeg.stripType, 'CV_LAUNCH');
  assert.equal(code(efsp, rec), squawk, 'the squawk it is flying');
  assert.deepEqual(stack(efsp).map(e => e.flightDataId), [launch.flightDataId]);
  assert.equal(efsp.carrierStore.caseOf(launch.flightDataId), 'III');
});

test('Case I launch: no squawk, DROP or TO MARSHAL from the deck; a Case I recovery goes to the overhead stack', async () => {
  const { efsp, c } = fresh();
  setCase(efsp, c, 'I');
  const launch = launchOnDeck(efsp, c, '302');
  assert.equal(code(efsp, launch), null, 'Case I: no radar service, no squawk');
  const nla = efsp.boardStoreFor('CARRIER').nlaStatusFor(strip(efsp, launch.stripId));
  assert.deepEqual([nla.toState, nla.alsoHandoff], ['DROPPED', 'LAUNCH_TO_MARSHAL']);
  assert.equal(handoff(efsp, c, 'CV_PRIFLY', launch, 'LAUNCH_TO_MARSHAL').ok, true);
  assert.deepEqual(stack(efsp, 'CASE_I').map(e => e.flightDataId), [launch.flightDataId]);
  assert.equal(efsp.carrierStore.caseOf(launch.flightDataId), 'I');
  const other = launchOnDeck(efsp, c, '303');
  assert.equal((await press(efsp, c, 'CV_PRIFLY', other)).state, 'DROPPED');
  refused(handoff(efsp, c, 'CV_PRIFLY', launchOnDeck(efsp, c, '304'), 'LAUNCH_TO_DEPARTURE'), 'VALIDATION_ERROR', /Case I/);
});

test('Case III recovery: COMMENCE, TO APPR (lanes alternate), DIRTY UP, FLY BULLS, TO PATTERN, DROP', async () => {
  const { efsp, c } = fresh();
  const a = recoveryCheckIn(efsp, c, '301', { lowStateLb: 6200 });
  const b = recoveryCheckIn(efsp, c, '302');
  assert.equal(efsp.flightDataStore.getFlightData(a.flightDataId).military.carrier.lowStateLb, 6200);
  const comm = await press(efsp, c, 'CV_MARSHAL', a);
  assert.deepEqual([comm.state, comm.ownerPositionId, comm.carrierHandoff.kind], ['COMMENCED', 'CV_MARSHAL', 'COMMENCE']);
  assert.equal(stack(efsp)[0].status, 'PUSHED');
  const appr = await press(efsp, c, 'CV_MARSHAL', a);
  assert.deepEqual([appr.state, appr.ownerPositionId, appr.bayId], ['FINAL_APPROACH', 'CV_APP1', 'cv-app1-approach']);
  await press(efsp, c, 'CV_MARSHAL', b);
  assert.equal((await press(efsp, c, 'CV_MARSHAL', b)).ownerPositionId, 'CV_APP2', 'the next one to the other lane');
  assert.equal((await press(efsp, c, 'CV_APP1', a)).state, 'DIRTY');
  assert.equal((await press(efsp, c, 'CV_APP1', a)).state, 'BULLSEYE');
  const pattern = await press(efsp, c, 'CV_APP1', a);
  assert.deepEqual([pattern.state, pattern.bayId], ['CV_PATTERN', 'cv-app1-pattern']);
  assert.equal((await press(efsp, c, 'CV_APP1', a)).state, 'DROPPED');
  assert.deepEqual(stack(efsp).map(e => e.flightDataId), [b.flightDataId], 'it left the stack with a vacancy');
});

test('the Marshal may send another lane: TO APPR names it', async () => {
  const { efsp, c } = fresh();
  const a = recoveryCheckIn(efsp, c, '301');
  await press(efsp, c, 'CV_MARSHAL', a);
  assert.equal(handoff(efsp, c, 'CV_MARSHAL', a, 'TO_APPROACH', 'CV_APP2').ok, true);
  assert.equal(strip(efsp, a.stripId).ownerPositionId, 'CV_APP2');
});

test('Case I recovery: TO PATTERN hands it to PriFly, who drops it; it stays in the overhead stack until then', async () => {
  const { efsp, c } = fresh();
  setCase(efsp, c, 'I');
  const a = recoveryCheckIn(efsp, c, '301');
  assert.equal(code(efsp, a), null);
  const p = await press(efsp, c, 'CV_MARSHAL', a);
  assert.deepEqual([p.state, p.ownerPositionId, p.bayId, p.carrierHandoff.kind], ['CV_PATTERN', 'CV_PRIFLY', 'cv-prifly-pattern', 'CASE_I_TO_PRIFLY']);
  assert.equal(stack(efsp, 'CASE_I').length, 1);
  assert.equal((await press(efsp, c, 'CV_PRIFLY', a)).state, 'DROPPED');
  assert.equal(stack(efsp, 'CASE_I').length, 0);
});

test('a flight keeps its Case: a ship Case change moves nobody; Abort sends a Case I flight to the Case II/III stack, only while the ship is in II or III', async () => {
  const { efsp, c } = fresh();
  setCase(efsp, c, 'I');
  const a = recoveryCheckIn(efsp, c, '301');
  const b = recoveryCheckIn(efsp, c, '302');
  refused(handoff(efsp, c, 'CV_MARSHAL', a, 'ABORT_TO_STACK'), 'VALIDATION_ERROR', /ship is in Case I/);
  setCase(efsp, c, 'III');
  const lateIII = recoveryCheckIn(efsp, c, '303');
  assert.deepEqual([efsp.carrierStore.caseOf(a.flightDataId), efsp.carrierStore.caseOf(lateIII.flightDataId)], ['I', 'III']);
  assert.equal(efsp.boardStoreFor('CARRIER').nlaStatusFor(strip(efsp, a.stripId)).carrierHandoff, 'CASE_I_TO_PRIFLY', 'still Case I');
  await press(efsp, c, 'CV_MARSHAL', b); // in PriFly's pattern
  for (const s of [a, b]) assert.equal(handoff(efsp, c, 'CV_MARSHAL', s, 'ABORT_TO_STACK').ok, true, s.stripId);
  assert.deepEqual(stack(efsp).map(e => e.flightDataId), [lateIII.flightDataId, a.flightDataId, b.flightDataId]);
  assert.equal(stack(efsp, 'CASE_I').length, 0);
  const back = strip(efsp, b.stripId);
  assert.deepEqual([back.state, back.ownerPositionId], ['STACK', 'CV_MARSHAL']);
  assert.ok(code(efsp, a) && code(efsp, b), 'a Case II/III flight gets the squawk Case I did not give it');
  assert.equal(efsp.carrierStore.caseOf(b.flightDataId), 'III');
  refused(handoff(efsp, c, 'CV_MARSHAL', lateIII, 'ABORT_TO_STACK'), 'VALIDATION_ERROR', /Case I flight/);
});

test('Back to stack: by the Marshal from COMMENCED or the approach, by the lane from its approach; new slot, assignments gone; never from BULLSEYE', async () => {
  const { efsp, c } = fresh();
  const a = recoveryCheckIn(efsp, c, '301');
  const b = recoveryCheckIn(efsp, c, '302');
  await press(efsp, c, 'CV_MARSHAL', a);
  await press(efsp, c, 'CV_MARSHAL', a); // FINAL_APPROACH at CV_APP1
  mustAct(efsp, c.CV_APP1, 'CV_APP1', strip(efsp, a.stripId), { kind: 'SetBlock', blockId: '9A-VECTOR', value: '270' });
  mustAct(efsp, c.CV_APP1, 'CV_APP1', strip(efsp, a.stripId), { kind: 'SetBlock', blockId: '9A-SPEED', value: '250' });
  assert.equal(handoff(efsp, c, 'CV_MARSHAL', a, 'RETURN_TO_STACK').ok, true, 'the Marshal, on the lane\'s Strip');
  const back = strip(efsp, a.stripId);
  assert.deepEqual([back.state, back.ownerPositionId, back.bayId], ['STACK', 'CV_MARSHAL', 'cv-marshal-stack']);
  assert.deepEqual(stack(efsp).map(e => [e.flightDataId, e.stackIndex, e.status]), [[b.flightDataId, 1, 'HOLDING'], [a.flightDataId, 2, 'HOLDING']]);
  const fd = efsp.flightDataStore.getFlightData(a.flightDataId);
  for (const f of ['heading', 'speed']) assert.equal(fd.clearance[f].entries.some(e => e.status === 'ACTIVE' && e.parsed != null), false, f);
  // the lane sends its own back from DIRTY
  await press(efsp, c, 'CV_MARSHAL', b); await press(efsp, c, 'CV_MARSHAL', b);
  const lane = strip(efsp, b.stripId).ownerPositionId;
  await press(efsp, c, lane, b);
  assert.equal(strip(efsp, b.stripId).state, 'DIRTY');
  assert.equal(handoff(efsp, c, lane, b, 'RETURN_TO_STACK').ok, true);
  // not once the flight is at BULLSEYE
  await press(efsp, c, 'CV_MARSHAL', a); await press(efsp, c, 'CV_MARSHAL', a);
  const la = strip(efsp, a.stripId).ownerPositionId;
  await press(efsp, c, la, a); await press(efsp, c, la, a);
  assert.equal(strip(efsp, a.stripId).state, 'BULLSEYE');
  refused(handoff(efsp, c, 'CV_MARSHAL', a, 'RETURN_TO_STACK'), null, null, 'BULLSEYE');
  refused(handoff(efsp, c, la, a, 'RETURN_TO_STACK'), 'VALIDATION_ERROR', /COMMENCED or FINAL_APPROACH or DIRTY/);
});

test('staffing: TO APPR with neither lane staffed is inhibited; LAUNCHED goes to departure control\'s hat when it is offered', async () => {
  const { efsp, c } = fresh();
  const a = recoveryCheckIn(efsp, c, '301');
  await press(efsp, c, 'CV_MARSHAL', a);
  hold(efsp, c.CV_APP1.session, 'CARRIER', []);
  hold(efsp, c.CV_APP2.session, 'CARRIER', []);
  assert.equal(efsp.boardStoreFor('CARRIER').nlaStatusFor(strip(efsp, a.stripId)).inhibited, 'no receiving Position present');
  hold(efsp, c.CV_DEP.session, 'CARRIER', []);
  const launch = launchOnDeck(efsp, c, '302');
  const nla = efsp.boardStoreFor('CARRIER').nlaStatusFor(strip(efsp, launch.stripId));
  if (nla.inhibited) assert.equal(nla.inhibited, 'no receiving Position present');
  else assert.equal(nla.transferTo, 'CV_DEP', 'the hat is offered: the handoff goes there');
});

test('create: by side number; without one refused; PriFly only launches, the Marshal only recovers; departure and the lanes create nothing', () => {
  const { efsp, c } = fresh();
  const create = (pos, bayId, stripType, flightData) => act(efsp, c[pos], pos, null, { kind: 'CreateStrip', bayId, rackId: 'main', stripType, flightData });
  refused(create('CV_MARSHAL', 'cv-marshal-stack', 'CV_RECOVERY', { aircraftType: 'FA18C' }), 'VALIDATION_ERROR', /side number/);
  refused(create('CV_MARSHAL', 'cv-marshal-stack', 'CV_RECOVERY', { sideNumber: 'TOO-LONG-1', aircraftType: 'FA18C' }), 'VALIDATION_ERROR');
  refused(create('CV_PRIFLY', 'cv-prifly-launch', 'CV_LAUNCH', { sideNumber: '301', departureRadialDeg: 400 }), 'VALIDATION_ERROR', /radial/);
  refused(create('CV_MARSHAL', 'cv-marshal-coordination', 'CV_LAUNCH', { sideNumber: '301' }), 'PERMISSION_DENIED');
  refused(create('CV_PRIFLY', 'cv-prifly-deck', 'CV_RECOVERY', { sideNumber: '301' }), 'PERMISSION_DENIED');
  for (const pos of ['CV_DEP', 'CV_APP1']) refused(create(pos, pos === 'CV_DEP' ? 'cv-dep-departures' : 'cv-app1-approach', 'CV_RECOVERY', { sideNumber: '301' }), 'PERMISSION_DENIED', null, pos);
});

test('Case I has no radar service: the squawk and the heading, speed and altitude are refused on a Case I flight', () => {
  const { efsp, c } = fresh();
  setCase(efsp, c, 'I');
  const a = recoveryCheckIn(efsp, c, '301');
  for (const blockId of ['5', '9A-VECTOR', '9A-SPEED', '7A']) {
    refused(act(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, a.stripId), { kind: 'SetBlock', blockId, value: '270' }), 'VALIDATION_ERROR', /Case I/, blockId);
  }
  setCase(efsp, c, 'III');
  const b = recoveryCheckIn(efsp, c, '302');
  mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', b, { kind: 'SetBlock', blockId: '7A', value: '080' });
  mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, b.stripId), { kind: 'SetBlock', blockId: '9A-VECTOR', value: '270' });
  // Task 8: the assignments are the flight's clearance cells, which the conformance monitor checks for every correlated flight
  const fd = efsp.flightDataStore.getFlightData(b.flightDataId);
  const active = (f) => fd.clearance[f].entries.find(e => e.status === 'ACTIVE');
  assert.deepEqual([active('altitude').parsed, active('heading').parsed], [8000, 270]);
});

test('the derived Blocks cannot be typed; the Marshal assigns angels, DME and EAT through the stack', () => {
  const { efsp, c } = fresh();
  const s = recoveryCheckIn(efsp, c, '301');
  for (const id of ['C7', 'C8']) refused(act(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, s.stripId), { kind: 'SetBlock', blockId: id, value: '12' }), 'VALIDATION_ERROR', null, id);
  mustCarrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetAngels', flightDataId: s.flightDataId, angels: 12 });
  mustCarrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetDme', flightDataId: s.flightDataId, dme: 30 });
  const d = view(efsp).derived.MAIN[0];
  assert.deepEqual([d.angels, d.angelsSet, d.marshalDme, d.dmeSet], [12, true, 30, true]);
  refused(carrierAct(efsp, c.CV_APP1, 'CV_APP1', { kind: 'SetAngels', flightDataId: s.flightDataId, angels: 9 }).ack, 'PERMISSION_DENIED');
});

test('Case I: angels by hand, no DME and no EAT', () => {
  const { efsp, c } = fresh();
  setCase(efsp, c, 'I');
  const s = recoveryCheckIn(efsp, c, '301');
  mustCarrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetAngels', flightDataId: s.flightDataId, angels: 3 });
  assert.equal(view(efsp).derived.CASE_I[0].angels, 3);
  refused(carrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetDme', flightDataId: s.flightDataId, dme: 5 }).ack, 'VALIDATION_ERROR', /Case I/);
  refused(carrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetEat', flightDataId: s.flightDataId, eat: '1500' }).ack, 'VALIDATION_ERROR', /Case I/);
});

test('Case is PriFly\'s and the Marshal\'s: the lanes are refused; a change is ONE delta every client re-renders from', () => {
  const { efsp, c } = fresh();
  recoveryCheckIn(efsp, c, '301');
  for (const pos of ['CV_APP1', 'CV_APP2']) {
    refused(carrierAct(efsp, c[pos], pos, { kind: 'SetCarrierState', field: 'case', value: 'I' }).ack, 'PERMISSION_DENIED', null, pos);
  }
  assert.equal(efsp.carrierStore.caseValue(), 'III', 'the default is the most restrictive');
  const r = setCase(efsp, c, 'I');
  assert.equal(slot(r, 'carrier').carriers.updated[0].recoveryCase.value, 'I');
  assert.equal(slot(r, 'carrier').carriers.updated[0].derived.MAIN[0].caseValue, 'III', 'the flight in the stack keeps its Case');
  refused(carrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCarrierState', field: 'case', value: 'I' }).ack, 'VALIDATION_ERROR');
  mustCarrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetCarrierState', field: 'case', value: 'II' });
  assert.equal(efsp.carrierStore.state().case.source, 'override');
  refused(carrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'Move', flightDataId: live(efsp)[0].flightDataId, toIndex: 1 }).ack, 'PERMISSION_DENIED');
});

test('the session must be Primary at the acting Position', () => {
  const { efsp, c } = fresh();
  refused(carrierAct(efsp, c.CV_APP1, 'CV_PRIFLY', { kind: 'SetCarrierState', field: 'case', value: 'II' }).ack, 'NOT_HOLDING_POSITION');
});

test('the Case, both stacks and the overrides survive a restart; the banner is re-derived', () => {
  const { efsp, c } = fresh();
  setCase(efsp, c, 'I');
  const one = recoveryCheckIn(efsp, c, '300');
  setCase(efsp, c, 'II');
  mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCarrierState', field: 'altimeter', value: 30.01 });
  const a = recoveryCheckIn(efsp, c, '301');
  const b = recoveryCheckIn(efsp, c, '302');
  mustCarrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetAngels', flightDataId: b.flightDataId, angels: 14 });
  assert.equal(act(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, a.stripId), { kind: 'SetBlock', blockId: 'C12', value: '5000' }).ok, true); // forces a persist
  const again = createEfsp();
  assert.equal(again.carrierStore.caseValue(), 'II');
  const rec = again.carrierStore.getRecord();
  assert.equal(rec.overrides.altimeterInHg, 30.01);
  assert.deepEqual(rec.stacks.MAIN.entries.map(e => e.flightDataId), [a.flightDataId, b.flightDataId]);
  assert.equal(rec.stacks.MAIN.entries[1].angelsOverride, 14);
  assert.deepEqual(rec.stacks.CASE_I.entries.map(e => e.flightDataId), [one.flightDataId]);
  assert.equal(again.carrierStore.getShipState(), null);
});

test('the audit log carries the carrier ops and each handoff', async () => {
  const { efsp, c } = fresh();
  const a = recoveryCheckIn(efsp, c, '301');
  await press(efsp, c, 'CV_MARSHAL', a);
  const lines = fs.readFileSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.ok(lines.some(l => l.op === 'InvokeNla' && l.carrierHandoff === 'COMMENCE' && l.carrierTrigger === 'CONTROLLER_INITIATED'));
  assert.ok(lines.some(l => l.op === 'Stack:MarkPushed'));
});

test('typed values are what a controller reads: the ramp time as Zulu HHMM, the marshal radial magnetic', () => {
  const { efsp, c } = fresh();
  recoveryCheckIn(efsp, c, '301');
  mustCarrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetCarrierState', field: 'rampTime', value: '1500' });
  assert.ok(Number.isFinite(efsp.carrierStore.getRecord().overrides.rampTimeUtc));
  refused(carrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetCarrierState', field: 'rampTime', value: '2561' }).ack, 'VALIDATION_ERROR', /Zulu/);
  refused(carrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetCarrierState', field: 'radial', value: 180 }).ack, 'VALIDATION_ERROR', /variation/);
  efsp.carrierStore.setShipState('CVN-72', { hullId: 'CVN-72', found: true, stale: false, headingRef: 'TRUE', brcDeg: 10, finalBearingDeg: 1, magneticVariationDeg: 5, altimeterInHg: null, altimeterSource: null });
  mustCarrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'SetCarrierState', field: 'radial', value: 180 });
  assert.equal(efsp.carrierStore.getRecord().overrides.marshalRadialDeg, 185, 'true = magnetic + easterly variation');
  assert.deepEqual(view(efsp).derived.MAIN[0].marshalRadialDisplay, { value: 180, ref: 'M' });
});

test('a Strip dropped out of the recovery leaves the stack with a vacancy, never a close-up (H28)', () => {
  const { efsp, c } = fresh();
  recoveryCheckIn(efsp, c, '301');
  const b = recoveryCheckIn(efsp, c, '302');
  recoveryCheckIn(efsp, c, '303');
  mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, b.stripId), { kind: 'DropStrip' });
  assert.deepEqual(stack(efsp).map(x => x.stackIndex), [0, 2]);
  assert.equal(mustCarrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'CloseUp', fromIndex: 1 }).ack.ok, true);
});

void wait;

test('the MARSHAL panel\'s create: a squawk typed with the side number is the flight\'s (II/III); Case I is given the next altitude from 2', () => {
  const { efsp, c } = fresh();
  const a = recoveryCheckIn(efsp, c, '301', { beaconCode: '4521' });
  assert.equal(code(efsp, a), '4521');
  refused(act(efsp, c.CV_MARSHAL, 'CV_MARSHAL', null, { kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'CV_RECOVERY',
    flightData: { sideNumber: '302', beaconCode: '4589' } }), 'VALIDATION_ERROR', /four digits 0-7/);
  setCase(efsp, c, 'I');
  refused(act(efsp, c.CV_MARSHAL, 'CV_MARSHAL', null, { kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'CV_RECOVERY',
    flightData: { sideNumber: '303', beaconCode: '4522' } }), 'VALIDATION_ERROR', /Case I/);
  const one = recoveryCheckIn(efsp, c, '304');
  const two = recoveryCheckIn(efsp, c, '305');
  const angels = (s) => view(efsp).derived.CASE_I.find(e => e.flightDataId === s.flightDataId).angels;
  assert.deepEqual([angels(one), angels(two)], [2, 3]);
});

test('the lane a flight is told at check-in is its lane: a flight leaving below it does not change it; Back to stack tells it a new one', async () => {
  const { efsp, c } = fresh();
  const a = recoveryCheckIn(efsp, c, '301');
  const b = recoveryCheckIn(efsp, c, '302');
  const lane = (s) => efsp.carrierStore.getRecord().stacks.MAIN.entries.find(e => e.flightDataId === s.flightDataId).lane;
  assert.deepEqual([lane(a), lane(b)], ['CV_APP1', 'CV_APP2']);
  mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip(efsp, a.stripId), { kind: 'DropStrip' });
  await press(efsp, c, 'CV_MARSHAL', b);
  assert.equal((await press(efsp, c, 'CV_MARSHAL', b)).ownerPositionId, 'CV_APP2', 'still the lane it was told');
  const d = recoveryCheckIn(efsp, c, '303');
  assert.equal(lane(d), 'CV_APP2', 'one flight in the stack: the next is told APP 2');
});
