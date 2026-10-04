import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// CARRIER-ATO (docs/adr/0109, decisions H109): carrier flights have ATO lines. The ATO import records a
// carrier-based mission on its line; a carrier LAUNCH binds to that line by callsign; the hull is a home
// field for the traffic count. Walked as the requests a mission night makes, not only the lifecycle: a
// launch with no ATO line, an import after the launch exists, a callsign changed after the bind, a
// divert, a cancelled launch, a re-import.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-carrier-ato-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER: 'carrier.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
  CRCSYNC_EFSP_TRAFFIC_COUNT_PATH: 'traffic-count.jsonl',
  CRCSYNC_EFSP_METRICS_PATH: 'metrics.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = (await import('../src/efsp/facility-config.js')).createFacilityConfig();
const { TrafficCount, classifyLocality } = await import('../src/efsp/traffic-count.js');
const { atoFlightForLaunch } = await import('../src/efsp/carrier/ato-bind.js');
const { hullForLocation, hullCode } = await import('../src/efsp/carrier/hull-config.js');
const { crew, mustAct, act, advance } = await import('./helpers/efsp-scenario.mjs');

const IRON = fs.readFileSync(new URL('./fixtures/ato/iron-flag-26-3.txt', import.meta.url), 'utf8');
// VIPER 11 (1101A) flies from the ship: DEPLOC and ARRLOC name UNION. The rest stay at OMAM.
const CARRIER_ATO = IRON.replace('DEPLOC:OMAM/141200ZSEP/ARRLOC:OMAM/', 'DEPLOC:UNION/141200ZSEP/ARRLOC:UNION/');
// The same line, launched from the ship but recovering at Incirlik (a divert on paper).
const DIVERT_ATO = IRON.replace('DEPLOC:OMAM/141200ZSEP/ARRLOC:OMAM/', 'DEPLOC:CVN-72/141200ZSEP/ARRLOC:LTAG/');
assert.notEqual(CARRIER_ATO, IRON);
assert.notEqual(DIVERT_ATO, IRON);

const clock = { now: () => Date.UTC(2016, 5, 21, 10, 0), source: 'MISSION' };
const CREW = { TAC_C2: 'TACTICAL', CV_MARSHAL: 'CARRIER', CV_PRIFLY: 'CARRIER', OPS: 'INCIRLIK' };

function fresh() {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  fs.rmSync(process.env.CRCSYNC_EFSP_TRAFFIC_COUNT_PATH, { force: true });
  const efsp = createEfsp({ clock });
  return { efsp, c: crew(efsp, CREW) };
}

function preview(efsp, c, text) {
  const ack = efsp.handleMessage(c.TAC_C2.session, { version: 1, type: 'efsp-ato-preview', requestId: 'r', actingPositionId: 'TAC_C2', text }).ack;
  assert.equal(ack.ok, true, JSON.stringify(ack));
  return ack.preview;
}

function importAto(efsp, c, text, choices = []) {
  const p = preview(efsp, c, text);
  const res = efsp.handleMessage(c.TAC_C2.session, {
    version: 1, type: 'efsp-ato-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'TACTICAL', actingPositionId: 'TAC_C2',
    op: { kind: 'ImportAto', text, textSha1: p.textSha1, choices },
  });
  assert.equal(res.ack.ok, true, JSON.stringify(res.ack));
  return { preview: p, ack: res.ack };
}

const flightOf = (efsp, callsign) => efsp.flightDataStore.getAll().find((f) => f.identity.callsign === callsign);
const missionLines = (efsp) => efsp.boardStoreFor('TACTICAL').getAll().filter((s) => s.stripType === 'MISSION' && s.state !== 'DROPPED');
const launchOp = (flightData) => ({
  kind: 'CreateStrip', bayId: 'cv-marshal-departures', rackId: 'main', stripType: 'MARSHAL', initialState: 'LAUNCH', flightData,
});
const launch = (efsp, c, callsign) => mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', null, launchOp({ callsign, aircraftType: 'F-16C' }));
const live = (efsp, facilityId) => efsp.boardStoreFor(facilityId).getAll().filter((s) => s.state !== 'DROPPED');

// ── Recognising a carrier mission ────────────────────────────────────────────

test('hullForLocation: a hull is named by unit name, id, label or type, alone or in a phrase; an airfield never matches', () => {
  for (const t of ['UNION', 'union', 'CVN-72', 'CVN72', 'CVN_72', 'USS UNION', 'UNION (CVN-72)']) {
    assert.equal(hullForLocation(t).hullId, 'CVN-72', t);
  }
  for (const t of ['OMAM', 'LTAG', '', null, undefined, 'UNIONVILLE']) assert.equal(hullForLocation(t), null, String(t));
  assert.equal(hullCode(hullForLocation('UNION')), 'UNION');
});

test('the import gives a carrier mission its MISSION line exactly as a land one, and records the hull on the line', () => {
  const { efsp, c } = fresh();
  const { preview: p } = importAto(efsp, c, CARRIER_ATO);
  const byCs = Object.fromEntries(p.lines.map((l) => [l.callsign, l]));
  assert.deepEqual(byCs.VIPER11.carrier, { hullId: 'CVN-72', hullCode: 'UNION', departs: true, recovers: true });
  assert.equal(byCs.DUDE21.carrier, undefined, 'a land line carries no carrier key');
  assert.equal(missionLines(efsp).length, 5, 'every line, the carrier one included, is a MISSION Strip on TACTICAL');
  const viper = flightOf(efsp, 'VIPER11');
  const strip = missionLines(efsp).find((s) => s.flightDataId === viper.flightDataId);
  assert.equal(strip.bayId, 'tac-c2-tasked');
  assert.equal(strip.state, 'TASKED');
  assert.deepEqual(viper.ato.carrier, { hullId: 'CVN-72', hullCode: 'UNION', departs: true, recovers: true });
  assert.equal(flightOf(efsp, 'DUDE21').ato.carrier, undefined);
});

test('a ship departure recovering at an airfield records departs only', () => {
  const { efsp, c } = fresh();
  importAto(efsp, c, DIVERT_ATO);
  assert.deepEqual(flightOf(efsp, 'VIPER11').ato.carrier, { hullId: 'CVN-72', hullCode: 'UNION', departs: true, recovers: false });
});

// ── The launch meets its line ────────────────────────────────────────────────

test('a launch typed by callsign binds to its ATO line: same flight, same Mode 3, the line\'s data', () => {
  const { efsp, c } = fresh();
  importAto(efsp, c, CARRIER_ATO);
  const viper = flightOf(efsp, 'VIPER11');
  const before = efsp.flightDataStore.getAll().length;
  const ack = efsp.handleMessage(c.CV_MARSHAL.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'CARRIER', actingPositionId: 'CV_MARSHAL',
    op: launchOp({ callsign: 'VIPER11', aircraftType: 'F-16C' }),
  }).ack;
  assert.equal(ack.ok, true, JSON.stringify(ack));
  const strip = efsp.boardStoreFor('CARRIER').getStrip(ack.strip.stripId);
  assert.equal(strip.flightDataId, viper.flightDataId);
  assert.equal(efsp.flightDataStore.getAll().length, before, 'no second flight, no second code');
  assert.ok((ack.warnings || []).some((w) => w.code === 'BOUND_TO_ATO'), JSON.stringify(ack.warnings));
  const f = efsp.flightDataStore.getFlightData(viper.flightDataId);
  assert.equal(f.identity.beaconAssigned, '4521');
  assert.equal(f.mission.missionNumber, '1101A');
  assert.equal(missionLines(efsp).filter((s) => s.flightDataId === viper.flightDataId).length, 1, 'the MISSION line stays');
});

test('a launch with no ATO line works, unbound, as before', () => {
  const { efsp, c } = fresh();
  importAto(efsp, c, CARRIER_ATO);
  const strip = launch(efsp, c, 'HAWG99');
  assert.equal(strip.state, 'LAUNCH');
  assert.equal(flightOf(efsp, 'HAWG99').ato, undefined);
  assert.notEqual(strip.flightDataId, flightOf(efsp, 'VIPER11').flightDataId);
});

test('a launch with an explicit flightDataId keeps it; a flight already filed or launched is not hijacked by callsign', () => {
  const { efsp, c } = fresh();
  importAto(efsp, c, CARRIER_ATO);
  const first = launch(efsp, c, 'VIPER11');             // binds
  const second = launch(efsp, c, 'VIPER11');            // the line already has a launch Strip: a new flight
  assert.notEqual(second.flightDataId, first.flightDataId);
  assert.equal(second.state, 'LAUNCH');
});

test('two ATO lines with one callsign are ambiguous: no bind (ambiguity is an answer, ADR 0046)', () => {
  const f = (id) => ({ flightDataId: id, ato: { lineId: id }, identity: { callsign: 'VIPER11' } });
  const flights = new Map([['a', f('a')], ['b', f('b')]]);
  const strips = [
    { stripType: 'MISSION', state: 'TASKED', flightDataId: 'a' },
    { stripType: 'MISSION', state: 'TASKED', flightDataId: 'b' },
  ];
  const ctx = {
    flightDataStore: { getFlightData: (id) => flights.get(id) },
    rules: { peerBoard: () => ({ getAll: () => strips }), liveStripsForFlightData: () => 1 },
  };
  assert.equal(atoFlightForLaunch(ctx, { callsign: 'VIPER11' }), null);
  strips.pop();
  assert.equal(atoFlightForLaunch(ctx, { callsign: 'viper11' }).flightDataId, 'a', 'one line: bound, case-insensitive');
  assert.equal(atoFlightForLaunch(ctx, {}), null);
  assert.equal(atoFlightForLaunch({ ...ctx, rules: {} }, { callsign: 'VIPER11' }), null, 'a Board without the rules binds nothing');
});

test('the ATO arrives after the launch exists: the line binds to the launched flight by callsign (L14\'s BIND)', () => {
  const { efsp, c } = fresh();
  const strip = launch(efsp, c, 'VIPER11');
  const p = preview(efsp, c, CARRIER_ATO);
  const line = p.lines.find((l) => l.callsign === 'VIPER11');
  assert.equal(line.action, 'BIND');
  assert.deepEqual(line.bindCandidates.map((b) => b.flightDataId), [strip.flightDataId]);
  importAto(efsp, c, CARRIER_ATO);
  const f = efsp.flightDataStore.getFlightData(strip.flightDataId);
  assert.equal(f.mission.missionNumber, '1101A');
  assert.deepEqual(f.ato.carrier, { hullId: 'CVN-72', hullCode: 'UNION', departs: true, recovers: true });
  assert.equal(live(efsp, 'CARRIER').filter((s) => s.flightDataId === strip.flightDataId).length, 1, 'the launch Strip is still there');
});

test('a callsign changed after the bind keeps the bind; a re-import updates the line, it does not duplicate it', () => {
  const { efsp, c } = fresh();
  importAto(efsp, c, CARRIER_ATO);
  const strip = launch(efsp, c, 'VIPER11');
  const r = efsp.flightDataStore.setField(strip.flightDataId, 'identity.callsign', 'COBRA11', { by: 'x' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const p = preview(efsp, c, CARRIER_ATO);
  const line = p.lines.find((l) => l.missionNumber === '1101A');
  assert.equal(line.action, 'UPDATE', 'the line is found by its id, not by the callsign');
  assert.equal(line.existingFlightDataId, strip.flightDataId);
  importAto(efsp, c, CARRIER_ATO);
  assert.equal(efsp.flightDataStore.getFlightData(strip.flightDataId).identity.callsign, 'COBRA11', 'a controller\'s callsign is kept');
  assert.equal(missionLines(efsp).length, 5);
  assert.equal(efsp.flightDataStore.getAll().length, 5, 'one flight per line, no sixth');
});

test('a re-import with a changed DEPLOC rewrites the carrier record on the flight', () => {
  const { efsp, c } = fresh();
  importAto(efsp, c, CARRIER_ATO);
  launch(efsp, c, 'VIPER11');
  importAto(efsp, c, IRON); // the planner moved the mission ashore
  assert.equal(flightOf(efsp, 'VIPER11').ato.carrier, undefined);
  importAto(efsp, c, CARRIER_ATO);
  assert.equal(flightOf(efsp, 'VIPER11').ato.carrier.hullCode, 'UNION');
});

test('a cancelled launch leaves the line standing; the next launch binds to it again', () => {
  const { efsp, c } = fresh();
  importAto(efsp, c, CARRIER_ATO);
  const viper = flightOf(efsp, 'VIPER11');
  const first = launch(efsp, c, 'VIPER11');
  assert.equal(first.flightDataId, viper.flightDataId);
  mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', first, { kind: 'DropStrip' });
  assert.equal(missionLines(efsp).some((s) => s.flightDataId === viper.flightDataId), true, 'the MISSION line stays');
  assert.equal(efsp.flightDataStore.getFlightData(viper.flightDataId).identity.beaconAssigned, '4521', 'the ATO code is not released');
  const second = launch(efsp, c, 'VIPER11');
  assert.equal(second.flightDataId, viper.flightDataId);
});

// ── The hull is a home field ─────────────────────────────────────────────────

const HOME = { INCIRLIK: ['LTAG'], CARRIER: ['UNION'] };
const flight = (extra = {}) => ({ filed: {}, ...extra });
const CARRIER_BOTH = { carrier: { hullId: 'CVN-72', hullCode: 'UNION', departs: true, recovers: true } };

test('classifyLocality: the ship is the field', () => {
  const launchOf = { stripType: 'MARSHAL' };
  const opts = { preDropState: 'LAUNCH' };
  // launch + ATO line that recovers on the hull: LOCAL
  assert.deepEqual(classifyLocality(launchOf, flight({ ato: CARRIER_BOTH }), HOME.CARRIER, opts), { locality: 'LOCAL', localityBasis: 'AIRPORTS' });
  // launch, filed plan recovering at Incirlik: TRANSIENT (the divert)
  assert.deepEqual(classifyLocality(launchOf, flight({ filed: { destinationAirport: 'LTAG' } }), HOME.CARRIER, opts), { locality: 'TRANSIENT', localityBasis: 'AIRPORTS' });
  // launch, ATO recovers at LTAG: TRANSIENT
  const ato = { carrier: { hullId: 'CVN-72', hullCode: 'UNION', departs: true, recovers: false }, recovery: { location: 'LTAG' } };
  assert.deepEqual(classifyLocality(launchOf, flight({ ato }), HOME.CARRIER, opts), { locality: 'TRANSIENT', localityBasis: 'AIRPORTS' });
  // launch with nothing known about where it lands: UNKNOWN, not guessed
  assert.deepEqual(classifyLocality(launchOf, flight(), HOME.CARRIER, opts), { locality: 'UNKNOWN', localityBasis: 'NO_AIRPORT_DATA' });
  // recovery (not a launch) of a flight whose ATO line departed the hull: LOCAL; from an airfield: TRANSIENT
  assert.deepEqual(classifyLocality({ stripType: 'FINAL' }, flight({ ato: CARRIER_BOTH }), HOME.CARRIER, { preDropState: 'BALL' }), { locality: 'LOCAL', localityBasis: 'AIRPORTS' });
  assert.deepEqual(classifyLocality({ stripType: 'PATTERN' }, flight({ filed: { departureAirport: 'LTAG' } }), HOME.CARRIER, { preDropState: 'IN_PATTERN' }), { locality: 'TRANSIENT', localityBasis: 'AIRPORTS' });
  // no hull configured for the Facility
  assert.deepEqual(classifyLocality(launchOf, flight({ ato: CARRIER_BOTH }), [], opts), { locality: 'UNKNOWN', localityBasis: 'NO_HOME_AIRPORT_CONFIGURED' });
  // a land Strip is untouched by all of this
  assert.deepEqual(classifyLocality({ stripType: 'DEPARTURE' }, flight({ filed: { departureAirport: 'LTAG', destinationAirport: 'LTAG' } }), HOME.INCIRLIK), { locality: 'LOCAL', localityBasis: 'AIRPORTS' });
});

test('the shipped config lists the hull for the CARRIER Facility', async () => {
  const { defaultInstrumentationConfig } = await import('../src/efsp/instrumentation-config.js');
  assert.deepEqual([...defaultInstrumentationConfig().trafficCount.homeAirports.CARRIER], ['UNION']);
});

async function countOf(efsp, c, atoText, mutateFlight) {
  const counter = new TrafficCount({
    mutationLog: efsp.mutationLog, flightDataStore: efsp.flightDataStore, boardStoreFor: efsp.boardStoreFor,
    facilityIds: facilityConfig.getFacilityIds(), config: { retentionDays: 400, homeAirports: HOME },
  });
  if (atoText) importAto(efsp, c, atoText);
  const strip = launch(efsp, c, 'VIPER11');
  if (mutateFlight) mutateFlight(strip.flightDataId);
  const dropped = await advance(efsp, c.CV_MARSHAL, 'CV_MARSHAL', efsp.boardStoreFor('CARRIER').getStrip(strip.stripId));
  assert.equal(dropped.state, 'DROPPED');
  const rec = fs.readFileSync(process.env.CRCSYNC_EFSP_TRAFFIC_COUNT_PATH, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.type === 'COUNT' && r.stripId === strip.stripId);
  assert.equal(rec.length, 1, 'the launch counts once');
  void counter;
  return rec[0];
}

test('walk: a UNION launch on a UNION-to-UNION ATO line is a LOCAL movement of the CARRIER Facility', async () => {
  const { efsp, c } = fresh();
  const rec = await countOf(efsp, c, CARRIER_ATO);
  assert.equal(rec.facilityId, 'CARRIER');
  assert.equal(rec.counted, true);
  assert.equal(rec.locality, 'LOCAL');
});

test('walk: a UNION launch whose ATO line recovers at Incirlik (a divert) is TRANSIENT', async () => {
  const { efsp, c } = fresh();
  const rec = await countOf(efsp, c, DIVERT_ATO);
  assert.equal(rec.locality, 'TRANSIENT');
});

test('walk: a UNION launch with no ATO line and no plan stays UNKNOWN', async () => {
  const { efsp, c } = fresh();
  const rec = await countOf(efsp, c, null);
  assert.equal(rec.locality, 'UNKNOWN');
});

test('a Marshal who is not CV_MARSHAL cannot launch; the bind adds no permission', () => {
  const { efsp, c } = fresh();
  importAto(efsp, c, CARRIER_ATO);
  const r = act(efsp, c.OPS, 'OPS', null, launchOp({ callsign: 'VIPER11' }));
  assert.equal(r.ok, false);
});
