import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The registry through createEfsp(): the wire family, the service path, persistence, start-up (ADR 0098 §4, §9, §10).

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airspace-wire-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
  CRCSYNC_EFSP_TRAFFIC_COUNT_PATH: 'traffic-count.jsonl',
  CRCSYNC_EFSP_METRICS_PATH: 'metrics.json',
  CRCSYNC_STATE_DIR: 'state',
})) process.env[k] = path.join(tmpDir, v);
const BOARD = process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH;
const STANDING = process.env.CRCSYNC_EFSP_AIRSPACES_PATH;
const LOGFILE = process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH;

const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = (await import('../src/efsp/facility-config.js')).createFacilityConfig();
const { createEfspInstrumentation } = await import('../src/efsp/metrics.js');
const { crew } = await import('./helpers/efsp-scenario.mjs');

const THEATER = 'Test';
const MOA = { airspaceId: 'MOA-1', name: 'Test MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 };
const RANGE = { airspaceId: 'RANGE-1', name: 'Test Range', type: 'RESTRICTED', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', usingPositionId: 'RANGE_ONE', controlFrequencyMhz: 283.5 };
const ADMIN = { service: 'SQUADRON_ADMIN', sub: 'sub-1', name: 'Web Admin' };

let theater = THEATER;
const start = () => createEfsp({ currentTheater: () => theater, facilityConfig });
const reset = ({ standing = {}, keepBoard = false } = {}) => {
  theater = THEATER;
  fs.writeFileSync(STANDING, JSON.stringify(standing));
  if (!keepBoard) fs.rmSync(BOARD, { force: true });
  if (!keepBoard) fs.rmSync(LOGFILE, { force: true });
};
const svc = (efsp, msg, principal = ADMIN) => efsp.applyAsService(principal, { clientMutationId: `m-${Math.random()}`, theater: THEATER, ...msg });
const panelMsg = (msg) => ({ version: 1, type: 'efsp-airspace-mutation', clientMutationId: `p-${Math.random()}`, ...msg });

// ── the ack contract: sourcedcs-web (2W) and the service router (2S-B) read these field names ──

test('ack contract: the field names and shapes of every registry op (pinned for the web and the service router)', () => {
  reset({ standing: { [THEATER]: [MOA] } });
  const efsp = start();
  const c = crew(efsp, { CTR: 'CENTER', AP: 'INCIRLIK' });
  const KEYS = ['version', 'type', 'clientMutationId', 'airspaceId', 'ok', 'airspaceSeq'];

  // CreateAirspace
  const created = efsp.handleMessage(c.CTR.session, panelMsg({ actingPositionId: 'CTR', airspaceId: 'MOA-2', op: { kind: 'CreateAirspace', definition: { ...MOA, airspaceId: 'MOA-2', name: 'Second' } } })).ack;
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.type, 'efsp-airspace-ack');
  for (const k of KEYS) assert.ok(k in created, k);
  assert.equal(created.airspace.airspaceId, 'MOA-2');
  assert.equal(created.airspace.defRev, 1);
  assert.equal(created.theater, THEATER);
  assert.equal('definitionHistory' in created.airspace, false);

  // EditAirspace conflict: reason STALE_REV, detail, conflicts [{field, base, theirs}]
  svc(efsp, { airspaceId: 'MOA-2', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { workingFrequencyMhz: 140 } } });
  const stale = efsp.handleMessage(c.CTR.session, panelMsg({ actingPositionId: 'CTR', airspaceId: 'MOA-2', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { workingFrequencyMhz: 141 } } })).ack;
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'STALE_REV');
  assert.equal(typeof stale.detail, 'string');
  assert.deepEqual(stale.conflicts, [{ field: 'workingFrequencyMhz', base: 134.25, theirs: 140 }]);
  assert.equal(stale.airspace.defRev, 2, 'the refusal still carries the current record');

  // an edit of an occupied AREA: warning, occupied, staleEntries (shape pinned with a stubbed occupant list)
  const store = efsp.airspaceStore;
  const real = store._occupantsFor;
  store._occupantsFor = () => [{ stripId: 's1', callsign: 'VIPER 1', frequencyMhz: 134.25 }];
  const warned = efsp.handleMessage(c.CTR.session, panelMsg({ actingPositionId: 'CTR', airspaceId: 'MOA-1', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { workingFrequencyMhz: 135 } } })).ack;
  assert.equal(warned.warning, 'AIRSPACE_EDITED_OCCUPIED');
  assert.deepEqual(warned.occupied, [{ stripId: 's1', callsign: 'VIPER 1' }]);
  assert.deepEqual(warned.staleEntries, [{ stripId: 's1', callsign: 'VIPER 1', frequencyMhz: 134.25 }]);
  // a delete refusal: reason VALIDATION_ERROR, detail, blockers[]
  const blocked = efsp.handleMessage(c.CTR.session, panelMsg({ actingPositionId: 'CTR', airspaceId: 'MOA-1', baseDefRev: 2, op: { kind: 'DeleteAirspace' } })).ack;
  assert.equal(blocked.reason, 'VALIDATION_ERROR');
  assert.deepEqual(blocked.blockers, ['1 flight is working it (VIPER 1)']);
  store._occupantsFor = real;

  // a usingPositionId edit: effectiveAtRestart
  const eff = svc(efsp, { airspaceId: 'MOA-1', baseDefRev: 2, op: { kind: 'EditAirspace', patch: { usingPositionId: 'RANGE_TWO' } } }).ack;
  assert.equal(eff.effectiveAtRestart, true);

  // DeleteAirspace success: removed, airspace null
  const removed = efsp.handleMessage(c.CTR.session, panelMsg({ actingPositionId: 'CTR', airspaceId: 'MOA-2', baseDefRev: 2, op: { kind: 'DeleteAirspace' } })).ack;
  assert.equal(removed.ok, true);
  assert.equal(removed.removed, 'MOA-2');
  assert.equal(removed.airspace, null);

  // ImportAirspaces (service only): created[], skipped[]
  const imp = svc(efsp, { op: { kind: 'ImportAirspaces', theater: THEATER, source: 'ACO', definitions: [MOA, { ...MOA, airspaceId: 'MOA-3', name: 'Third' }] } }).ack;
  assert.deepEqual(imp.created, ['MOA-3']);
  assert.deepEqual(imp.skipped, [{ airspaceId: 'MOA-1', reason: 'EXISTS' }]);

  // a state op keeps the old fields: warning / occupied (a number, for a release)
  assert.ok('airspaceSeq' in imp);
});

test('the delta carries `airspaces.updated` and, for a delete, `airspaces.removed`; the snapshot is the current theater only', () => {
  reset({ standing: { [THEATER]: [MOA] } });
  const efsp = start();
  const c = crew(efsp, { CTR: 'CENTER' });
  const upd = efsp.handleMessage(c.CTR.session, panelMsg({ actingPositionId: 'CTR', airspaceId: 'MOA-1', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { name: 'Renamed' } } }));
  assert.equal(upd.broadcasts.length, 1);
  assert.equal(upd.broadcasts[0].type, 'efsp-airspace-delta');
  assert.equal(upd.broadcasts[0].airspaces.updated[0].definition.name, 'Renamed');
  assert.equal(upd.broadcasts[0].airspaces.removed, undefined);
  const del = efsp.handleMessage(c.CTR.session, panelMsg({ actingPositionId: 'CTR', airspaceId: 'MOA-1', baseDefRev: 2, op: { kind: 'DeleteAirspace' } }));
  assert.deepEqual(del.broadcasts[0].airspaces, { updated: [], removed: ['MOA-1'] });
  const refused = efsp.handleMessage(c.CTR.session, panelMsg({ actingPositionId: 'CTR', airspaceId: 'GHOST', baseRev: 0, op: { kind: 'ScheduleAirspace' } }));
  assert.equal(refused.broadcasts.length, 0);
  const snap = efsp.snapshotFor(c.CTR.session);
  assert.deepEqual(snap.airspaces, []);
});

test('a change to ANOTHER theater (the web may edit any) is acked and persisted but reaches no connected panel', () => {
  reset();
  const efsp = start();
  const c = crew(efsp, { CTR: 'CENTER' });
  const r = efsp.applyAsService(ADMIN, { clientMutationId: 'x1', theater: 'Other', op: { kind: 'CreateAirspace', definition: MOA } });
  assert.equal(r.ack.ok, true, JSON.stringify(r.ack));
  assert.equal(r.broadcasts.length, 0, 'nothing for a mission in a different theater');
  assert.equal(efsp.airspaceStore.getAll().length, 0);
  assert.equal(efsp.snapshotFor(c.CTR.session).airspaces.length, 0);
  const same = svc(efsp, { op: { kind: 'CreateAirspace', definition: MOA } });
  assert.equal(same.broadcasts.length, 1, 'the loaded theater\'s change is a delta');
  // and a panel session cannot see Other's record by naming the theater in its own message
  const sneaky = efsp.handleMessage(c.CTR.session, panelMsg({ actingPositionId: 'CTR', airspaceId: 'MOA-1', baseRev: 0, theater: 'Other', op: { kind: 'ScheduleAirspace', fromUtc: 1, toUtc: 2 } }));
  assert.equal(sneaky.ack.airspace.theater, THEATER, 'a panel op always runs in the current theater');
});

test('the service path: gated by a known principal, not usable for another family, replays an idempotent retry once', () => {
  reset({ standing: { [THEATER]: [MOA] } });
  const efsp = start();
  const bad = efsp.applyAsService({ service: 'NOBODY', sub: 'x', name: 'x' }, { clientMutationId: 'a', theater: THEATER, airspaceId: 'MOA-1', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { name: 'No' } } });
  assert.equal(bad.ack.ok, false);
  assert.equal(bad.ack.reason, 'PERMISSION_DENIED');
  const noSub = efsp.applyAsService({ service: 'SQUADRON_ADMIN', name: 'x' }, { clientMutationId: 'b', theater: THEATER, airspaceId: 'MOA-1', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { name: 'No' } } });
  assert.equal(noSub.ack.ok, false);
  assert.equal(efsp.airspaceStore.getAirspace('MOA-1').definition.name, 'Test MOA');

  const msg = { clientMutationId: 'same-id', theater: THEATER, airspaceId: 'MOA-1', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { name: 'Once' } } };
  const first = efsp.applyAsService(ADMIN, msg);
  const entriesBefore = efsp.mutationLog.readAll().length;
  const again = efsp.applyAsService(ADMIN, msg);
  assert.equal(first.ack.ok, true);
  assert.equal(again.ack.ok, true);
  assert.equal(again.broadcasts.length, 0, 'a replay broadcasts nothing');
  assert.equal(efsp.mutationLog.readAll().length, entriesBefore, 'and writes nothing to the log');
  assert.equal(efsp.airspaceStore.getAirspace('MOA-1').defRev, 2);
  assert.equal(again.ack.airspace.defRev, 2);
});

test('a session signed on to nothing: reads everything, acts on nothing (NOT_HOLDING_POSITION), and an unheld Position is refused', () => {
  reset({ standing: { [THEATER]: [MOA] } });
  const efsp = start();
  const lurker = { controllerId: 'lurker' };
  assert.equal(efsp.snapshotFor(lurker).airspaces.length, 1, 'airspaces are not flights: read by everyone');
  const r = efsp.handleMessage(lurker, panelMsg({ actingPositionId: 'CTR', airspaceId: 'MOA-1', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { name: 'No' } } })).ack;
  assert.equal(r.reason, 'NOT_HOLDING_POSITION');
  assert.equal(efsp.airspaceStore.getAirspace('MOA-1').definition.name, 'Test MOA');
  // the same family message with a forged servicePrincipal on the WIRE message is just a field: it grants nothing
  const forged = efsp.handleMessage(lurker, panelMsg({ actingPositionId: 'CTR', servicePrincipal: ADMIN, airspaceId: 'MOA-1', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { name: 'No' } } })).ack;
  assert.equal(forged.reason, 'NOT_HOLDING_POSITION');
});

test('the definition ops are audited (every outcome once) and none counts as traffic', () => {
  reset({ standing: { [THEATER]: [MOA] } });
  const efsp = start();
  const instr = createEfspInstrumentation({ efsp, facilityConfig, correlationStats: () => ({ rate: null, eligible: 0 }), obligationStats: () => ({}) });
  const c = crew(efsp, { CTR: 'CENTER', AP: 'INCIRLIK' });
  const before = efsp.mutationLog.readAll().length;
  efsp.handleMessage(c.CTR.session, panelMsg({ actingPositionId: 'CTR', airspaceId: 'MOA-5', op: { kind: 'CreateAirspace', definition: { ...MOA, airspaceId: 'MOA-5', name: 'Five' } } }));
  efsp.handleMessage(c.AP.session, panelMsg({ actingPositionId: 'AP', airspaceId: 'MOA-5', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { name: 'Nope' } } }));
  efsp.handleMessage(c.CTR.session, panelMsg({ actingPositionId: 'CTR', airspaceId: 'MOA-5', baseDefRev: 1, op: { kind: 'DeleteAirspace' } }));
  const lines = efsp.mutationLog.readAll().slice(before);
  assert.deepEqual(lines.map(l => [l.op, l.ok]), [['CreateAirspace', true], ['EditAirspace', false], ['DeleteAirspace', true]]);
  assert.ok(lines.every(l => l.facilityId === 'CENTER' && l.via === 'PANEL' && l.theater === THEATER));
  assert.equal(instr.trafficCount.entries().length, 0);
});

// ── persistence and start-up ─────────────────────────────────────────────

test('create then restart, edit then restart, delete then restart, through the real snapshot file', () => {
  reset();
  let efsp = start();
  svc(efsp, { op: { kind: 'CreateAirspace', definition: MOA } });
  efsp = start();
  assert.equal(efsp.airspaceStore.getAirspace('MOA-1').defRev, 1);
  svc(efsp, { airspaceId: 'MOA-1', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { workingFrequencyMhz: 140 } } });
  efsp = start();
  assert.equal(efsp.airspaceStore.getAirspace('MOA-1').definition.workingFrequencyMhz, 140);
  svc(efsp, { airspaceId: 'MOA-1', baseDefRev: 2, op: { kind: 'DeleteAirspace' } });
  efsp = start();
  assert.equal(efsp.airspaceStore.getAirspace('MOA-1'), null);
  const body = JSON.parse(fs.readFileSync(BOARD, 'utf8'));
  assert.deepEqual(Object.keys(body.airspaces), ['byTheater', 'seeded']);
});

test('the standing list seeds once per id: a seeded id deleted stays gone across restarts, a new id lands', () => {
  reset({ standing: { [THEATER]: [MOA] } });
  let efsp = start();
  assert.equal(efsp.airspaceStore.getAirspace('MOA-1').definition.source, 'STANDING');
  svc(efsp, { airspaceId: 'MOA-1', baseDefRev: 1, op: { kind: 'DeleteAirspace' } });
  efsp = start();
  assert.equal(efsp.airspaceStore.getAirspace('MOA-1'), null, 'not resurrected');
  fs.writeFileSync(STANDING, JSON.stringify({ [THEATER]: [MOA, { ...MOA, airspaceId: 'MOA-2', name: 'Second' }] }));
  efsp = start();
  assert.deepEqual(efsp.airspaceStore.getAll().map(a => a.airspaceId), ['MOA-2'], 'a later addition lands');
});

test('a standing-list definition that does not validate stops start-up, naming the theater and the id', () => {
  reset({ standing: { Syria: [{ ...MOA, controllingPositionId: 'NOBODY' }] } });
  assert.throws(start, /theater Syria.*MOA-1: NOBODY is not a Position of CENTER/);
  reset({ standing: [] });
  assert.throws(start, /object keyed by theater/);
});

test('RANGES Positions are derived at load from every theater\'s saved definitions and the unseeded standing list', () => {
  reset({ standing: { Syria: [RANGE] } });
  let efsp = start();
  assert.deepEqual(facilityConfig.getPositionSet('RANGES'), ['RANGE_ONE'], 'from the standing list');
  assert.ok(efsp.positionStoreFor('RANGES'));
  // the saved definitions of a theater that is NOT the current one still count
  reset({ standing: {} });
  efsp = start();
  svc(efsp, { theater: 'Other', op: { kind: 'CreateAirspace', definition: { ...RANGE, usingPositionId: 'RANGE_OTHER' } } });
  efsp = start();
  assert.deepEqual(facilityConfig.getPositionSet('RANGES'), ['RANGE_OTHER']);
  // an edit of usingPositionId takes effect at the restart, not before
  svc(efsp, { theater: 'Other', airspaceId: 'RANGE-1', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { usingPositionId: 'RANGE_NEXT' } } });
  assert.deepEqual(facilityConfig.getPositionSet('RANGES'), ['RANGE_OTHER']);
  start();
  assert.deepEqual(facilityConfig.getPositionSet('RANGES'), ['RANGE_NEXT']);
});

test('the pre-0098 array snapshot, and an unknown key under airspaces, are loud start-up errors that leave the file untouched', () => {
  reset();
  start(); // writes nothing yet; make a real file
  const efsp = start();
  svc(efsp, { op: { kind: 'CreateAirspace', definition: MOA } });
  const good = JSON.parse(fs.readFileSync(BOARD, 'utf8'));
  const refuse = (mutate, re) => {
    const body = JSON.parse(JSON.stringify(good));
    mutate(body);
    fs.writeFileSync(BOARD, JSON.stringify(body));
    const bytes = fs.readFileSync(BOARD);
    assert.throws(start, re);
    assert.ok(bytes.equals(fs.readFileSync(BOARD)), 'the file is byte-identical after the refused start');
  };
  refuse((b) => { b.airspaces = [{ airspaceId: 'MOA-1', rev: 4, state: 'ACTIVE', transitions: [] }]; }, /snapshot .*board\.json.* holds an array at "airspaces".*delete state\/efsp-board\.json/);
  refuse((b) => { b.airspaces.fresh = true; }, /unknown key "airspaces\.fresh"/);
  refuse((b) => { b.airspaces.byTheater.Test[0].definitionRev = 3; }, /unknown key "airspaces\.byTheater\.Test\[\]\.definitionRev"/);
  refuse((b) => { b.airspaces.byTheater.Test[0].definition.type = 'GONE'; }, /airspace MOA-1 \(theater Test\).*type/);
  fs.writeFileSync(BOARD, JSON.stringify(good));
  assert.ok(start());
});

test('the snapshot is read ONCE at start-up, and the early read applies the same shape check the restore does', () => {
  reset();
  const efsp = start();
  svc(efsp, { op: { kind: 'CreateAirspace', definition: MOA } });
  const reads = [];
  const real = fs.readFileSync;
  fs.readFileSync = function (p, ...rest) { if (String(p) === BOARD) reads.push(p); return real.call(this, p, ...rest); };
  try { start(); } finally { fs.readFileSync = real; }
  assert.equal(reads.length, 1);
  // an unknown top-level key stops the start at the early read, before any Facility is built
  const body = JSON.parse(fs.readFileSync(BOARD, 'utf8'));
  body.fdrs = [];
  fs.writeFileSync(BOARD, JSON.stringify(body));
  assert.throws(start, /unknown key "fdrs"/);
});

test('the log-tail reconcile voids an airspace line that never reached the snapshot (a crash between the audit line and the persist)', () => {
  reset();
  let efsp = start();
  svc(efsp, { op: { kind: 'CreateAirspace', definition: MOA } });
  const persisted = fs.readFileSync(BOARD, 'utf8');
  svc(efsp, { airspaceId: 'MOA-1', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { name: 'Lost edit' } } });
  fs.writeFileSync(BOARD, persisted); // the crash: the edit's persist never happened
  efsp = start();
  assert.equal(efsp.airspaceStore.getAirspace('MOA-1').definition.name, 'Test MOA');
  const markers = efsp.mutationLog.readAll().filter(e => e.op === 'NotPersisted' && e.airspaceId === 'MOA-1');
  assert.equal(markers.length, 1);
  assert.equal(markers[0].voids, 'EditAirspace');
  efsp = start();
  assert.equal(efsp.mutationLog.readAll().filter(e => e.op === 'NotPersisted' && e.airspaceId === 'MOA-1').length, 1, 'marked once, not again on the next boot');
});

test('a theater change between missions through the wire: the old theater\'s records keep their state', () => {
  reset({ standing: { [THEATER]: [MOA] } });
  const efsp = start();
  const c = crew(efsp, { CTR: 'CENTER' });
  efsp.handleMessage(c.CTR.session, panelMsg({ actingPositionId: 'CTR', airspaceId: 'MOA-1', baseRev: 0, op: { kind: 'ScheduleAirspace', fromUtc: 1, toUtc: 2 } }));
  theater = 'Other';
  assert.equal(efsp.snapshotFor(c.CTR.session).airspaces.length, 0);
  const miss = efsp.handleMessage(c.CTR.session, panelMsg({ actingPositionId: 'CTR', airspaceId: 'MOA-1', baseRev: 1, op: { kind: 'ApproveActivation' } })).ack;
  assert.equal(miss.reason, 'NOT_FOUND');
  assert.equal(miss.detail, undefined);
  theater = THEATER;
  assert.equal(efsp.airspaceStore.getAirspace('MOA-1').state, 'SCHEDULED');
  theater = null;
  const none = efsp.handleMessage(c.CTR.session, panelMsg({ actingPositionId: 'CTR', airspaceId: 'MOA-1', baseRev: 1, op: { kind: 'ApproveActivation' } })).ack;
  assert.equal(none.detail, 'no mission loaded');
});

test('a replayed refusal or success answers with the same extra fields: conflicts, occupied/staleEntries, created/skipped, removed, effectiveAtRestart', () => {
  reset({ standing: { [THEATER]: [MOA] } });
  const efsp = start();
  svc(efsp, { airspaceId: 'MOA-1', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { workingFrequencyMhz: 140 } } });
  const stale = { clientMutationId: 'rp-1', theater: THEATER, airspaceId: 'MOA-1', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { workingFrequencyMhz: 141 } } };
  const first = efsp.applyAsService(ADMIN, stale).ack;
  const replay = efsp.applyAsService(ADMIN, stale).ack;
  assert.equal(first.reason, 'STALE_REV');
  assert.deepEqual(replay.conflicts, first.conflicts);
  assert.deepEqual(replay.conflicts, [{ field: 'workingFrequencyMhz', base: 134.25, theirs: 140 }]);
  assert.equal(replay.reason, 'STALE_REV');

  const store = efsp.airspaceStore; const real = store._occupantsFor;
  store._occupantsFor = () => [{ stripId: 's1', callsign: 'VIPER 1', frequencyMhz: 140 }];
  const occ = { clientMutationId: 'rp-2', theater: THEATER, airspaceId: 'MOA-1', baseDefRev: 2, op: { kind: 'EditAirspace', patch: { usingPositionId: 'RANGE_THREE', workingFrequencyMhz: 141 } } };
  const a1 = efsp.applyAsService(ADMIN, occ).ack;
  const a2 = efsp.applyAsService(ADMIN, occ).ack;
  for (const k of ['warning', 'occupied', 'staleEntries', 'effectiveAtRestart']) assert.deepEqual(a2[k], a1[k], k);
  assert.equal(a2.occupied.length, 1);
  store._occupantsFor = real;

  const imp = { clientMutationId: 'rp-3', theater: THEATER, op: { kind: 'ImportAirspaces', theater: THEATER, source: 'ACO', definitions: [MOA, { ...MOA, airspaceId: 'MOA-3', name: 'Third' }] } };
  const i1 = efsp.applyAsService(ADMIN, imp).ack; const i2 = efsp.applyAsService(ADMIN, imp).ack;
  assert.deepEqual(i2.created, i1.created); assert.deepEqual(i2.skipped, i1.skipped);

  const del = { clientMutationId: 'rp-4', theater: THEATER, airspaceId: 'MOA-3', baseDefRev: 1, op: { kind: 'DeleteAirspace' } };
  const d1 = efsp.applyAsService(ADMIN, del).ack; const d2 = efsp.applyAsService(ADMIN, del).ack;
  assert.equal(d1.removed, 'MOA-3'); assert.equal(d2.removed, 'MOA-3'); assert.equal(d2.airspace, null);
});
