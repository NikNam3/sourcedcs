import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// §11.4 traffic count (docs/adr/0065) — the pure rules first, then the live
// counter on a real createEfsp(). Every path is overridden BEFORE any src/efsp
// import, so nothing here can touch the real state/ directory.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-traffic-count-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
  CRCSYNC_EFSP_TRAFFIC_COUNT_PATH: 'traffic-count.jsonl',
  CRCSYNC_EFSP_METRICS_PATH: 'metrics.json',
  CRCSYNC_EFSP_INSTRUMENTATION_CONFIG_PATH: 'instrumentation.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify([
  { airspaceId: 'MOA-TC', name: 'Count MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 },
]));

const tc = await import('../src/efsp/traffic-count.js');
const nla = await import('../src/efsp/nla.js');
const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const { crew, act, mustAct, jumpTo, advance, DEPARTURE_FDR, airborneDeparture, handedToCenter, activate } = await import('./helpers/efsp-scenario.mjs');

const {
  TrafficCount, COUNTABLE_PRE_DROP_STATES, hourKey, isDropTransition, isUndoOfDrop,
  countability, classifyLocality, normalizeAircraftType,
} = tc;

const HOME = { INCIRLIK: ['LTAG'] };

// ── pure rules ──────────────────────────────────────────────────────────────

test('hourKey is the UTC hour, both sides of midnight', () => {
  assert.equal(hourKey(Date.UTC(2026, 8, 29, 23, 59, 59, 999)), '2026-09-29T23:00Z');
  assert.equal(hourKey(Date.UTC(2026, 8, 30, 0, 0, 0, 0)), '2026-09-30T00:00Z');
});

test('isDropTransition: into DROPPED only, never a refusal, never DROPPED -> DROPPED', () => {
  assert.equal(isDropTransition({ before: { state: 'HANDED_OFF' }, after: { state: 'DROPPED' } }), true);
  assert.equal(isDropTransition({ ok: false, before: { state: 'HANDED_OFF' }, after: { state: 'DROPPED' } }), false, 'T7');
  assert.equal(isDropTransition({ before: { state: 'DROPPED' }, after: { state: 'DROPPED' } }), false);
  assert.equal(isDropTransition({ before: null, after: { state: 'PROPOSED' } }), false);
  assert.equal(isDropTransition({ op: 'Undo', before: { state: 'DROPPED' }, after: { state: 'HANDED_OFF' } }), false);
});

test('isUndoOfDrop: an Undo out of DROPPED', () => {
  assert.equal(isUndoOfDrop({ op: 'Undo', before: { state: 'DROPPED' }, after: { state: 'HANDED_OFF' } }), true);
  assert.equal(isUndoOfDrop({ op: 'Undo', before: { state: 'TAXI' }, after: { state: 'PUSHBACK' } }), false);
  assert.equal(isUndoOfDrop({ op: 'SetState', before: { state: 'DROPPED' }, after: { state: 'HANDED_OFF' } }), false);
  assert.equal(isUndoOfDrop({ ok: false, op: 'Undo', before: { state: 'DROPPED' }, after: { state: 'HANDED_OFF' } }), false);
});

test('countability: one case per row of the table', () => {
  const drop = (role, pre, extra = {}) => countability({ role, state: pre }, { role, state: 'DROPPED', ...extra });
  assert.deepEqual(drop('MISSION', 'RTB'), { counted: false, excludedReason: 'MISSION_LINE' });
  assert.deepEqual(drop('DEPARTURE', 'HANDED_OFF', { coordination: { state: 'REJECTED', mintedForCoordination: true } }),
    { counted: false, excludedReason: 'REJECTED_REPLICA' });
  assert.deepEqual(drop('DEPARTURE', 'HANDED_OFF', { coordination: { state: 'REJECTED' } }),
    { counted: true, excludedReason: null }, 'the SENDER\'s rejected Strip is still a real flight');
  assert.deepEqual(drop('DEPARTURE', 'DEPARTED'), { counted: true, excludedReason: null });
  assert.deepEqual(drop('DEPARTURE', 'HANDED_OFF'), { counted: true, excludedReason: null });
  assert.deepEqual(drop('DEPARTURE', 'PROPOSED'), { counted: false, excludedReason: 'NEVER_DEPARTED' });
  assert.deepEqual(drop('DEPARTURE', 'TAXI'), { counted: false, excludedReason: 'NEVER_DEPARTED' });
  assert.deepEqual(drop('ARRIVAL', 'LANDED'), { counted: true, excludedReason: null });
  assert.deepEqual(drop('ARRIVAL', 'TAXI_IN'), { counted: true, excludedReason: null });
  assert.deepEqual(drop('ARRIVAL', 'INBOUND'), { counted: false, excludedReason: 'NEVER_LANDED' });
  assert.deepEqual(drop('OVERFLIGHT', 'TRANSITING'), { counted: true, excludedReason: null });
  assert.deepEqual(drop('CARRIER_ARRIVAL', 'WHATEVER'), { counted: false, excludedReason: 'UNCLASSIFIED_ROLE' });
});

test('ROLE COVERAGE: every Role nla.js knows has a countability entry, and every state listed exists for it (T14)', () => {
  for (const [role, states] of Object.entries(nla.STATES_BY_ROLE)) {
    assert.ok(COUNTABLE_PRE_DROP_STATES[role], `Role ${role} has no traffic-count decision — add it to COUNTABLE_PRE_DROP_STATES`);
    for (const s of COUNTABLE_PRE_DROP_STATES[role]) assert.ok(states.includes(s), `${role}: ${s} is not a ${role} state`);
  }
  for (const role of Object.keys(COUNTABLE_PRE_DROP_STATES)) {
    assert.ok(nla.STATES_BY_ROLE[role], `COUNTABLE_PRE_DROP_STATES names a Role nla.js does not know: ${role}`);
  }
});

test('classifyLocality: every branch', () => {
  const dep = (d, a) => ({ filed: { departureAirport: d, destinationAirport: a } });
  assert.deepEqual(classifyLocality({ role: 'DEPARTURE' }, dep('LTAG', 'LTAG'), HOME.INCIRLIK), { locality: 'LOCAL', localityBasis: 'AIRPORTS' });
  assert.deepEqual(classifyLocality({ role: 'DEPARTURE' }, dep(' ltag', 'LTAG '), HOME.INCIRLIK), { locality: 'LOCAL', localityBasis: 'AIRPORTS' }, 'trimmed and uppercased');
  assert.deepEqual(classifyLocality({ role: 'DEPARTURE' }, dep('LTAG', 'LTAC'), HOME.INCIRLIK), { locality: 'TRANSIENT', localityBasis: 'AIRPORTS' });
  assert.deepEqual(classifyLocality({ role: 'DEPARTURE' }, dep('LTAG', ''), HOME.INCIRLIK), { locality: 'UNKNOWN', localityBasis: 'NO_AIRPORT_DATA' });
  assert.deepEqual(classifyLocality({ role: 'ARRIVAL' }, { filed: { originAirport: 'LTAG' } }, HOME.INCIRLIK), { locality: 'LOCAL', localityBasis: 'AIRPORTS' });
  assert.deepEqual(classifyLocality({ role: 'ARRIVAL' }, { filed: { originAirport: 'LTAC' } }, HOME.INCIRLIK), { locality: 'TRANSIENT', localityBasis: 'AIRPORTS' });
  assert.deepEqual(classifyLocality({ role: 'ARRIVAL' }, { filed: { originAirport: '' } }, HOME.INCIRLIK), { locality: 'UNKNOWN', localityBasis: 'NO_AIRPORT_DATA' });
  assert.deepEqual(classifyLocality({ role: 'ARRIVAL', previousLeg: { role: 'DEPARTURE' } }, { filed: { originAirport: '' } }, HOME.INCIRLIK),
    { locality: 'LOCAL', localityBasis: 'CONVERTED_ARRIVAL' });
  assert.deepEqual(classifyLocality({ role: 'OVERFLIGHT' }, dep('LTAG', 'LTAG'), HOME.INCIRLIK),
    { locality: 'TRANSIENT', localityBasis: 'OVERFLIGHT' }, 'an overflight never touches the field, whatever it filed');
  assert.deepEqual(classifyLocality({ role: 'DEPARTURE' }, dep('LTAG', 'LTAG'), undefined),
    { locality: 'UNKNOWN', localityBasis: 'NO_HOME_AIRPORT_CONFIGURED' }, 'a CENTER strip: "local" means nothing to a centre');
  assert.deepEqual(classifyLocality({ role: 'DEPARTURE' }, { identity: { homeStation: 'LTAG' }, filed: {} }, HOME.INCIRLIK).locality, 'UNKNOWN',
    'homeStation is the unit\'s home, never used');
});

test('normalizeAircraftType: trimmed, uppercased, blank is UNKNOWN', () => {
  assert.equal(normalizeAircraftType(' f-16c '), 'F-16C');
  assert.equal(normalizeAircraftType(''), 'UNKNOWN');
  assert.equal(normalizeAircraftType(undefined), 'UNKNOWN');
});

// ── the live counter on a real Board ────────────────────────────────────────

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' };

function counterFor(efsp, extra = {}) {
  return new TrafficCount({
    mutationLog: efsp.mutationLog,
    fdrStore: efsp.fdrStore,
    boardStoreFor: efsp.boardStoreFor,
    facilityIds: facilityConfig.getFacilityIds(),
    config: { retentionDays: 400, homeAirports: HOME },
    ...extra,
  });
}

function recordsFor(counter, stripId) {
  return counter.records().filter(r => r.stripId === stripId);
}

function quiet(fn) {
  const orig = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = orig; }
}

// One Board, one counter for the whole file (T11): each test asserts on its
// own Strips, never on file-wide absolute totals.
const efsp = createEfsp();
const c = crew(efsp, ATC);
let counter = quiet(() => counterFor(efsp));

test('a DEPARTURE pressed through to DROPPED is one counted, local record', async () => {
  let strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'CNT1', aircraftType: 'f-16c' });
  strip = await advance(efsp, c.APP, 'APP', strip);
  assert.equal(strip.state, 'DROPPED');
  const [r] = recordsFor(counter, strip.stripId);
  assert.equal(recordsFor(counter, strip.stripId).length, 1);
  assert.equal(r.counted, true);
  assert.equal(r.facilityId, 'INCIRLIK');
  assert.equal(r.role, 'DEPARTURE');
  assert.equal(r.callsign, 'CNT1');
  assert.equal(r.aircraftType, 'F-16C');
  assert.equal(r.locality, 'LOCAL');
  assert.equal(r.dropOp, 'InvokeNla');
  assert.equal(r.formation, false);
  assert.equal(r.flightSize, 1);
  assert.equal(r.legs, 1);
  assert.equal(r.hourUtc, hourKey(r.droppedAt));
  assert.equal(r.backfilled, false);
});

test('a proposal dropped at PROPOSED is recorded but excluded as NEVER_DEPARTED', () => {
  const strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: 'CNT2' },
  });
  mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'DropStrip' });
  const [r] = recordsFor(counter, strip.stripId);
  assert.equal(r.counted, false);
  assert.equal(r.excludedReason, 'NEVER_DEPARTED');
  const body = counter.report({ facilityId: 'INCIRLIK' });
  assert.ok(body.facilities.INCIRLIK.totals.excludedByReason.NEVER_DEPARTED >= 1);
});

test('Undo of a terminal Drop appends a VOID and the flight leaves the count; a re-drop is a new record', async () => {
  let strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'CNT3' });
  strip = await advance(efsp, c.APP, 'APP', strip);
  const first = recordsFor(counter, strip.stripId);
  assert.equal(first.length, 1);

  strip = mustAct(efsp, c.APP, 'APP', strip, { kind: 'Undo' });
  assert.equal(strip.state, 'HANDED_OFF');
  assert.equal(recordsFor(counter, strip.stripId).length, 0, 'voided');
  assert.ok(counter.entries().some(e => e.type === 'VOID' && e.countId === first[0].countId), 'a VOID line, not an edit');

  strip = await advance(efsp, c.APP, 'APP', strip);
  const again = recordsFor(counter, strip.stripId);
  assert.equal(again.length, 1);
  assert.notEqual(again[0].countId, first[0].countId);
});

test('a 4-ship counts as one flight and four aircraft (H34)', async () => {
  let strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'CNT4', flightSize: 4 });
  strip = await advance(efsp, c.APP, 'APP', strip);
  const [r] = recordsFor(counter, strip.stripId);
  assert.equal(r.formation, true);
  assert.equal(r.flightSize, 4);
  const body = counter.report({ facilityId: 'INCIRLIK', detail: true });
  const rec = body.records.find(x => x.stripId === strip.stripId);
  assert.equal(rec.flightSize, 4);
  assert.equal(rec.actorId, undefined, 'per-person detail is hidden on the wire (H35)');
  assert.ok(body.facilities.INCIRLIK.totals.formationAircraft >= 4);
});

test('SUA traversal survives ClearAirspaceEntry: approved, cleared, then dropped (T8)', () => {
  activate(efsp, c, 'MOA-TC');
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'CNT5', destinationAirport: 'LTAC' });
  let ctr = handedToCenter(efsp, c, strip);
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-TC' });
  ctr = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'ClearAirspaceEntry' });
  assert.equal(ctr.airspaceEntry, null);
  mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'DropStrip' });
  const [r] = recordsFor(counter, ctr.stripId);
  assert.equal(r.facilityId, 'CENTER', 'found on the Board that holds it (T6)');
  assert.deepEqual(r.suaTraversal, ['MOA-TC']);
  assert.equal(r.locality, 'UNKNOWN', 'CENTER has no home airport configured');
  assert.equal(r.counted, true);
});

test('alert scramble latches: SCRAMBLE seen at any logged Mutation still counts after it is reset', async () => {
  let strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'CNT6' });
  assert.equal(efsp.fdrStore.setMilitary(strip.fdrId, { alertStatus: 'SCRAMBLE' }).ok, true);
  strip = mustAct(efsp, c.APP, 'APP', strip, { kind: 'SetFlag', flag: 'highlight', value: true });
  efsp.fdrStore.setMilitary(strip.fdrId, { alertStatus: 'NONE' });
  strip = await advance(efsp, c.APP, 'APP', strip);
  assert.equal(recordsFor(counter, strip.stripId)[0].alertScramble, true);
});

test('noteFdr latches a SCRAMBLE written with no Strip Mutation around it (L13\'s hatch)', async () => {
  let strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'CNT7' });
  efsp.fdrStore.setMilitary(strip.fdrId, { alertStatus: 'SCRAMBLE' });
  counter.noteFdr(strip.fdrId);
  efsp.fdrStore.setMilitary(strip.fdrId, { alertStatus: 'NONE' });
  strip = await advance(efsp, c.APP, 'APP', strip);
  assert.equal(recordsFor(counter, strip.stripId)[0].alertScramble, true);
});

test('a refused drop in the log is not a drop (T7)', () => {
  const before = counter.records().length;
  efsp.mutationLog.record({
    clientMutationId: 'x', op: 'DropStrip', stripId: 'ghost', ok: false, reason: 'NOT_OWNER',
    before: { state: 'HANDED_OFF', role: 'DEPARTURE' }, after: { state: 'DROPPED', role: 'DEPARTURE' },
  });
  assert.equal(counter.records().length, before);
});

test('a restart (a new instance on the same files) gives the same report', () => {
  const now = Date.now();
  const q = { from: now - 3600000, to: now + 3600000, detail: true };
  const before = counter.report(q);
  counter.close();
  counter = quiet(() => counterFor(efsp));
  const after = counter.report(q);
  assert.deepEqual(after.facilities, before.facilities);
  assert.deepEqual(after.records, before.records);
  assert.equal(counter.lastReconciliation().ok, true);
  assert.equal(counter.lastReconciliation().backfilled, 0);
});

test('delete the count file and restart: every drop is backfilled from the log, marked so, and it reconciles', () => {
  const now = Date.now();
  const q = { from: now - 3600000, to: now + 3600000, detail: true };
  const before = counter.report(q);
  counter.close();
  fs.unlinkSync(process.env.CRCSYNC_EFSP_TRAFFIC_COUNT_PATH);
  counter = quiet(() => counterFor(efsp));
  const rec = counter.lastReconciliation();
  assert.equal(rec.ok, true);
  assert.equal(rec.backfilled, before.records.length);
  const after = counter.report(q);
  assert.ok(after.records.every(r => r.backfilled === true));
  assert.deepEqual(after.records.map(r => r.countId).sort(), before.records.map(r => r.countId).sort());
  assert.equal(after.facilities.INCIRLIK.totals.flights, before.facilities.INCIRLIK.totals.flights);
  assert.equal(after.reconciliation.ok, true);
});

test('retention compaction at boot drops records older than retentionDays, atomically, and nothing younger', () => {
  const p = path.join(tmpDir, 'retention.jsonl');
  const DAY = 86400000;
  const wall = Date.UTC(2026, 8, 30);
  const line = (id, dropWallAt) => JSON.stringify({ type: 'COUNT', countId: id, stripId: id, droppedAt: dropWallAt, dropWallAt, facilityId: 'INCIRLIK', counted: true, locality: 'LOCAL', hourUtc: hourKey(dropWallAt) });
  fs.writeFileSync(p, [line('old', wall - 401 * DAY), line('edge', wall - 400 * DAY), line('new', wall - DAY),
    JSON.stringify({ type: 'VOID', countId: 'old' })].join('\n') + '\n');
  const counter2 = quiet(() => new TrafficCount({
    mutationLog: null, fdrStore: efsp.fdrStore, boardStoreFor: efsp.boardStoreFor,
    facilityIds: facilityConfig.getFacilityIds(), config: { retentionDays: 400, homeAirports: HOME },
    path: p, wallNow: () => wall,
  }));
  assert.deepEqual(counter2.records().map(r => r.countId).sort(), ['edge', 'new']);
  const onDisk = fs.readFileSync(p, 'utf8').trim().split('\n').map(l => JSON.parse(l).countId);
  assert.deepEqual(onDisk, ['edge', 'new'], 'the void of an expired record goes with it');
  assert.equal(fs.existsSync(`${p}.tmp`), false);
});
