import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Archiving finished flights (docs/adr/0082; decisions.md H36, S-R2-13) —
// one test per rule, on a real createEfsp(). Every path is overridden BEFORE
// any src/efsp import, so nothing here can touch the real state/ directory.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-archiver-'));
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
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const { createEfsp } = await import('../src/efsp/index.js');
const { Archiver, ARCHIVE_AFTER_MS, sweepChanged } = await import('../src/efsp/archiver.js');
const { TrafficCount } = await import('../src/efsp/traffic-count.js');
const { MissionSession } = await import('../src/mission-session.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const {
  crew, act, mustAct, jumpTo, mustMarsaAct, airborneDeparture, handedToCenter, DEPARTURE_FDR,
} = await import('./helpers/efsp-scenario.mjs');

const HOUR = 60 * 60 * 1000;
const ALL = {
  OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER',
  TAC_C2: 'TACTICAL', GCI: 'TACTICAL',
};

function quiet(fn) {
  const orig = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = orig; }
}

// One Board, one counter for the whole file (the traffic-count test's T11):
// each test works its own flights and asserts on their ids only.
const efsp = createEfsp();
const c = crew(efsp, ALL);
const counter = quiet(() => new TrafficCount({
  mutationLog: efsp.mutationLog, fdrStore: efsp.fdrStore, boardStoreFor: efsp.boardStoreFor,
  facilityIds: facilityConfig.getFacilityIds(), config: { retentionDays: 400, homeAirports: { INCIRLIK: ['LTAG'] } },
}));

// The wall clock the archiver judges age by, moved by hand. Board stamps are
// the real Date.now(); the archiver sees them `offset` ms later.
let offset = 0;
function archiverFor(extra = {}) {
  return new Archiver({
    facilityIds: facilityConfig.getFacilityIds(),
    boardStoreFor: efsp.boardStoreFor,
    fdrStore: efsp.fdrStore,
    correlationStore: efsp.correlationStore,
    marsaStore: efsp.marsaStore,
    mutationLog: efsp.mutationLog,
    clock: efsp.clock,
    wallNow: () => Date.now() + offset,
    isCounted: (stripId) => counter.hasCountFor(stripId),
    ...extra,
  });
}

const incirlik = () => efsp.boardStoreFor('INCIRLIK');
const center = () => efsp.boardStoreFor('CENTER');
const tactical = () => efsp.boardStoreFor('TACTICAL');

/** A flight flown to APP's terminus and dropped there: counted traffic. */
function droppedFlight(callsign) {
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign });
  return mustAct(efsp, c.APP, 'APP', strip, { kind: 'DropStrip' });
}

function logLines(pred) {
  return efsp.mutationLog.readAll().filter(pred);
}

// ── §5.1 when a Strip dropped, in wall time ─────────────────────────────────

test('the drop time is stamped on drop, cleared by an Undo, and never on the wire', () => {
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'STAMP1' });
  const before = Date.now();
  const dropped = mustAct(efsp, c.APP, 'APP', strip, { kind: 'InvokeNla' });
  assert.equal(dropped.state, 'DROPPED');
  const at = incirlik().droppedWallAtOf(strip.stripId);
  assert.ok(at >= before && at <= Date.now());
  assert.equal('droppedWallAt' in dropped, false, 'not a Strip field');

  const undone = mustAct(efsp, c.APP, 'APP', dropped, { kind: 'Undo' });
  assert.notEqual(undone.state, 'DROPPED');
  assert.equal(incirlik()._droppedWallAt.has(strip.stripId), false);
  assert.equal(incirlik().droppedWallAtOf(strip.stripId), null);
});

test('the drop time survives snapshot/restore, and a pre-L24 DROPPED Strip gets the restore time', async () => {
  const { BoardStore } = await import('../src/efsp/board-store.js');
  const dropped = droppedFlight('STAMP2');
  const snap = JSON.parse(JSON.stringify(incirlik().snapshot()));
  const at = incirlik().droppedWallAtOf(dropped.stripId);
  assert.ok(snap.droppedWallAt.some(([id, ms]) => id === dropped.stripId && ms === at));

  const fresh = new BoardStore(efsp.fdrStore, {}, { clock: efsp.clock });
  fresh.restore(snap);
  assert.equal(fresh.droppedWallAtOf(dropped.stripId), at);

  // A snapshot written before this change has no droppedWallAt at all.
  const old = { ...snap };
  delete old.droppedWallAt;
  const t0 = Date.now();
  const restored = new BoardStore(efsp.fdrStore, {}, { clock: efsp.clock });
  restored.restore(old);
  assert.ok(restored.droppedWallAtOf(dropped.stripId) >= t0, 'its 2 h start at the restore');
  const live = snap.strips.find(s => s.state !== 'DROPPED');
  if (live) assert.equal(restored.droppedWallAtOf(live.stripId), null, 'a live Strip has none');
});

// ── the ten rules (§6 step 2) ───────────────────────────────────────────────

test('1. a DROPPED Strip is archived 2 h after its drop and not before', () => {
  assert.equal(ARCHIVE_AFTER_MS, 2 * HOUR, 'H36');
  const dropped = droppedFlight('AGE1');
  const archiver = archiverFor();

  offset = 2 * HOUR - 60 * 1000;
  const early = archiver.sweep();
  assert.equal((early.stripsByFacility.INCIRLIK || []).includes(dropped.stripId), false);
  assert.ok(incirlik().getStrip(dropped.stripId), 'still there at 1:59');

  offset = 2 * HOUR;
  const due = archiver.sweep();
  offset = 0;
  assert.ok(due.stripsByFacility.INCIRLIK.includes(dropped.stripId));
  assert.equal(incirlik().getStrip(dropped.stripId), null);
  assert.ok(due.fdrIds.includes(dropped.fdrId), 'its FDR had no other Strip');
  assert.equal(efsp.fdrStore.getFdr(dropped.fdrId), null);
  assert.equal(sweepChanged(due), true);

  const [line] = logLines(e => e.op === 'Archive' && e.stripId === dropped.stripId);
  assert.deepEqual(
    { op: line.op, stripId: line.stripId, fdrId: line.fdrId, facilityId: line.facilityId, actorId: line.actorId, clientMutationId: line.clientMutationId, actingPositionId: line.actingPositionId, reason: line.reason },
    { op: 'Archive', stripId: dropped.stripId, fdrId: dropped.fdrId, facilityId: 'INCIRLIK', actorId: 'system', clientMutationId: null, actingPositionId: null, reason: 'AGE' });
  assert.ok(Number.isFinite(line.at));
  assert.equal(logLines(e => e.op === 'ArchiveFdr' && e.fdrId === dropped.fdrId).length, 1);
  assert.equal(archiver.sweep().stripsByFacility.INCIRLIK, undefined, 'a second sweep has nothing left of it');
});

test('2. an FDR goes with its last Strip, not before: TOFI\'s shared FDR stays while the other Facility\'s Strip is live', () => {
  let ctrStrip = handedToCenter(efsp, c, airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'SHARE1' }));
  const appStrip = incirlik().getAll().find(s => s.fdrId === ctrStrip.fdrId && s.stripId !== ctrStrip.stripId);
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', ctrStrip, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });
  let mission = mustAct(efsp, c.TAC_C2, 'TAC_C2', tactical().getStrip(ctrStrip.tofiCoordination.peerStripId), {
    kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA',
  });
  // Exit, then the MISSION side retires while the ATC side is still working it.
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', center().getStrip(ctrStrip.stripId), { kind: 'SetBlock', blockId: 'SREG', value: 'ATC' });
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' });
  mission = mustAct(efsp, c.TAC_C2, 'TAC_C2', tactical().getStrip(mission.stripId), { kind: 'TOFI', action: 'ACCEPT' });
  for (const state of ['AIRBORNE', 'ON_STATION', 'OFF_STATION', 'RTB']) mission = jumpTo(efsp, c.TAC_C2, 'TAC_C2', mission, state);
  mission = mustAct(efsp, c.TAC_C2, 'TAC_C2', mission, { kind: 'InvokeNla' });
  assert.equal(mission.state, 'DROPPED');
  assert.equal(mission.fdrId, ctrStrip.fdrId);

  // A MISSION line is recorded (excluded from the totals), so it is counted.
  const archiver = archiverFor();
  offset = 3 * HOUR;
  const r = archiver.sweep();
  offset = 0;
  assert.ok(r.stripsByFacility.TACTICAL.includes(mission.stripId));
  assert.equal(r.fdrIds.includes(ctrStrip.fdrId), false, 'CENTER\'s Strip is live');
  assert.ok(efsp.fdrStore.getFdr(ctrStrip.fdrId));
  assert.ok(efsp.fdrStore.codeAllocator.isAllocated(efsp.fdrStore.getFdr(ctrStrip.fdrId).identity.beaconAssigned), 'its code stays held');

  // T6: and across a restart, the live Strip keeps its flight data.
  efsp.persist();
  const again = quiet(() => createEfsp());
  assert.ok(again.fdrStore.getFdr(ctrStrip.fdrId));
  assert.ok(again.boardStoreFor('CENTER').getStrip(ctrStrip.stripId));

  // The FDR goes only in the sweep that archives its LAST Strip.
  const dropped = mustAct(efsp, c.CTR, 'CTR', center().getStrip(ctrStrip.stripId), { kind: 'DropStrip' });
  offset = 3 * HOUR;
  const r2 = archiver.sweep();
  assert.ok(r2.stripsByFacility.CENTER.includes(dropped.stripId));
  // The APP-side Strip of the same flight (the HANDOFF's sender) is DROPPED
  // too only if APP dropped it; until every Strip is gone, the FDR stays.
  const appNow = appStrip ? incirlik().getStrip(appStrip.stripId) : null;
  if (appNow) {
    assert.equal(r2.fdrIds.includes(dropped.fdrId), false, 'the APP Strip still references it');
    mustAct(efsp, c.APP, 'APP', appNow, { kind: 'DropStrip' });
    const r3 = archiver.sweep();
    assert.ok(r3.fdrIds.includes(dropped.fdrId));
  } else {
    assert.ok(r2.fdrIds.includes(dropped.fdrId));
  }
  offset = 0;
  assert.equal(efsp.fdrStore.getFdr(dropped.fdrId), null);
});

test('3. an FDR that never had a Strip is never archived', () => {
  const { fdr } = efsp.fdrStore.createFdr({ ...DEPARTURE_FDR, callsign: 'SEED1' }, { by: 'ato' });
  droppedFlight('SEED2');
  const archiver = archiverFor();
  offset = 10 * HOUR;
  archiver.sweep();
  archiver.onMissionSessionChange({ seq: 99, reason: 'MISSION_CHANGED' });
  offset = 0;
  assert.ok(efsp.fdrStore.getFdr(fdr.fdrId), 'an ATO-seeded FDR with no Strip is L14\'s, not ours');
});

test('4. an uncounted Strip is skipped and retried', () => {
  const dropped = droppedFlight('UNCNT1');
  let counted = false;
  const archiver = archiverFor({ isCounted: (id) => (id === dropped.stripId ? counted : counter.hasCountFor(id)) });
  const warnings = [];
  const orig = console.warn;
  console.warn = (m) => warnings.push(String(m));
  offset = 3 * HOUR;
  let r;
  try { r = archiver.sweep(); } finally { console.warn = orig; }
  assert.ok(r.skipped.includes(dropped.stripId));
  assert.ok(incirlik().getStrip(dropped.stripId), 'kept');
  assert.ok(efsp.fdrStore.getFdr(dropped.fdrId));
  assert.ok(warnings.some(w => w.includes(dropped.stripId)), 'and said so, by id');

  counted = true;
  r = archiver.sweep();
  offset = 0;
  assert.ok(r.stripsByFacility.INCIRLIK.includes(dropped.stripId), 'the next sweep takes it');
});

test('4b. with no traffic count wired, a sweep archives anyway and warns once', () => {
  const dropped = droppedFlight('NOCNT1');
  const archiver = archiverFor({ isCounted: null });
  const warnings = [];
  const orig = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    offset = 3 * HOUR;
    archiver.sweep();
    archiver.sweep();
  } finally { console.warn = orig; offset = 0; }
  assert.equal(incirlik().getStrip(dropped.stripId), null);
  assert.equal(warnings.filter(w => w.includes('no traffic count wired')).length, 1);
});

test('5. a mission change archives every counted DROPPED Strip at once, and no live one', () => {
  const young = droppedFlight('MSN1');
  const live = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'MSN2' });
  const archiver = archiverFor();

  // Wired as server.js wires it: F3's session roll-over (S-F3).
  const session = new MissionSession({ path: null, clock: { now: () => Date.now(), source: 'DCS' } });
  session.onNewSession((s) => archiver.onMissionSessionChange(s));
  session.noteMissionLoad({ theatre: 'Syria', waypoints: [{ name: 'A' }] });
  assert.ok(incirlik().getStrip(young.stripId), 'the first load is not a roll-over');
  session.noteMissionStart();
  session.noteMissionLoad({ theatre: 'Syria', waypoints: [{ name: 'A' }] });

  assert.equal(incirlik().getStrip(young.stripId), null, 'seconds old, and gone');
  assert.equal(efsp.fdrStore.getFdr(young.fdrId), null);
  assert.ok(incirlik().getStrip(live.stripId), 'ADR 0002 still holds for live Strips');
  assert.ok(efsp.fdrStore.getFdr(live.fdrId));
  const [line] = logLines(e => e.op === 'Archive' && e.stripId === young.stripId);
  assert.equal(line.reason, 'MISSION_CHANGE');
  assert.equal(line.sessionReason, 'MISSION_START');
  assert.equal(line.missionSession, session.currentSeq());
  for (const s of incirlik().getAll()) assert.notEqual(s.state, 'DROPPED', 'nothing DROPPED is left');
});

test('6. Undo of an archived drop is NOT_FOUND — the mission change archives inside the 30 s window', () => {
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'UNDO1' });
  const dropped = mustAct(efsp, c.APP, 'APP', strip, { kind: 'InvokeNla' });
  assert.equal(dropped.state, 'DROPPED');
  archiverFor().onMissionSessionChange({ seq: 7, reason: 'CLOCK_STEP_BACK' });
  const undo = act(efsp, c.APP, 'APP', dropped, { kind: 'Undo' });
  assert.equal(undo.ok, false);
  assert.equal(undo.reason, 'NOT_FOUND');
  assert.equal(incirlik()._nlaHistory.has(strip.stripId), false, 'its Undo latch went with it (F7)');
});

test('6b. an age sweep never archives inside the Undo window', () => {
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'UNDO2' });
  const dropped = mustAct(efsp, c.APP, 'APP', strip, { kind: 'InvokeNla' });
  archiverFor().sweep();
  const undone = mustAct(efsp, c.APP, 'APP', dropped, { kind: 'Undo' });
  assert.notEqual(undone.state, 'DROPPED');
});

test('7. a resync from before the archive reports the Strip in gone', () => {
  const dropped = droppedFlight('RESYNC1');
  const seqBefore = incirlik().currentSeq;
  offset = 3 * HOUR;
  archiverFor().sweep();
  offset = 0;
  assert.ok(incirlik().currentSeq > seqBefore, 'the archive advances the ring (T5)');
  const delta = incirlik().getDeltaSince(seqBefore - 1);
  assert.ok(delta.gone.includes(dropped.stripId));
  assert.equal(delta.updated.some(s => s.stripId === dropped.stripId), false);
});

test('7b. on the wire: efsp-resync puts the archived Strip in strips.gone', { todo: 'needs L27\'s `gone` seam in efsp-ws.js _handleResync (L27 §5.2); L24 does not edit it' }, () => {
  const dropped = droppedFlight('RESYNC2');
  // The ack of the drop names the seq just after it; resync from before the drop.
  const seqBefore = incirlik().currentSeq - 1;
  offset = 3 * HOUR;
  archiverFor().sweep();
  offset = 0;
  const { ack } = efsp.handleMessage(c.APP.session, { type: 'efsp-resync', facilityId: 'INCIRLIK', lastBoardSeq: seqBefore });
  assert.equal(ack.type, 'efsp-board-delta');
  assert.ok(ack.strips.gone.includes(dropped.stripId));
});

test('8. MARSA relations and correlation records of archived FDRs are evicted', () => {
  const tanker = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'SHELL1' });
  const rx = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'VIPER9' });
  const relation = mustMarsaAct(efsp, c.APP, 'APP', null, {
    kind: 'DeclareMarsa', participants: [tanker.fdrId, rx.fdrId],
    startEvent: 'TANKER_ACCEPTED', endCondition: 'VERTICALLY_POSITIONED', declaringCallsign: 'SHELL1',
  });
  // A correlation record, as the reconciler mints one (white-box: no track
  // store here). The reconciler's own retireFinished would take it at its
  // next tick; the sweep must not depend on that.
  efsp.correlationStore._recordFor(tanker.fdrId);
  efsp.correlationStore._recordFor(rx.fdrId);
  mustAct(efsp, c.APP, 'APP', incirlik().getStrip(tanker.stripId), { kind: 'DropStrip' });
  mustAct(efsp, c.APP, 'APP', incirlik().getStrip(rx.stripId), { kind: 'DropStrip' });
  assert.ok(efsp.marsaStore.getRelation(relation.marsaId), 'ENDED, still held');

  offset = 3 * HOUR;
  const r = archiverFor().sweep();
  offset = 0;
  assert.ok(r.relations >= 1);
  assert.equal(efsp.marsaStore.getRelation(relation.marsaId), null);
  assert.equal(efsp.correlationStore.getCorrelation(tanker.fdrId), null);
  assert.equal(efsp.correlationStore.getCorrelation(rx.fdrId), null);
});

test('9. the traffic count is unchanged by a sweep, and a backfill of an archived FDR is UNKNOWN/ARCHIVED (rule 5)', () => {
  const dropped = droppedFlight('COUNT1');
  const before = counter.records().map(r => r.countId).sort();
  const rec = counter.records().find(r => r.stripId === dropped.stripId);
  assert.equal(rec.counted, true);
  assert.equal(rec.facilityId, 'INCIRLIK');

  offset = 3 * HOUR;
  archiverFor().sweep();
  offset = 0;
  assert.equal(efsp.fdrStore.getFdr(dropped.fdrId), null);
  assert.deepEqual(counter.records().map(r => r.countId).sort(), before, 'Archive/ArchiveFdr lines are not drops or undos');
  assert.equal(counter.reconcile().ok, true, 'and the log still reconciles');

  // A count file lost after the archive: the boot backfill finds no FDR.
  const fresh = quiet(() => new TrafficCount({
    mutationLog: efsp.mutationLog, fdrStore: efsp.fdrStore, boardStoreFor: efsp.boardStoreFor,
    facilityIds: facilityConfig.getFacilityIds(), config: { retentionDays: 400, homeAirports: { INCIRLIK: ['LTAG'] } },
    path: path.join(tmpDir, 'backfill-after-archive.jsonl'),
  }));
  fresh.close();
  const back = fresh.records().find(r => r.stripId === dropped.stripId);
  assert.equal(back.backfilled, true);
  assert.equal(back.locality, 'UNKNOWN');
  assert.equal(back.localityBasis, 'ARCHIVED');
  assert.equal(back.callsign, null, 'nothing left to name it by');
  // Until L26 puts facilityId on log entries (S-L5), an archived Strip's
  // backfill cannot find its Facility. Pinned so L26's merge flips it.
  assert.equal(back.facilityId, 'UNKNOWN');
});

test('10. a snapshot after a sweep holds neither the Strip nor its FDR', () => {
  const dropped = droppedFlight('SNAP1');
  offset = 3 * HOUR;
  archiverFor().sweep();
  offset = 0;
  efsp.persist();
  const disk = JSON.parse(fs.readFileSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, 'utf8'));
  const board = disk.boards.INCIRLIK;
  assert.equal(board.strips.some(s => s.stripId === dropped.stripId), false);
  assert.equal(board.droppedWallAt.some(([id]) => id === dropped.stripId), false);
  assert.equal(disk.fdr.fdrs.some(f => f.fdrId === dropped.fdrId), false);
  const code = dropped.fdrId && disk.fdr.codes.find(([, fdrId]) => fdrId === dropped.fdrId);
  assert.equal(code, undefined, 'and no code is held for it');
});

// ── T4 / V6 / V8: every reader of a finished flight lets go, never throws ──

test('the monitors prune against the live set after archiving (V8)', async () => {
  const { NlaStatusMonitor } = await import('../src/efsp/nla-status-monitor.js');
  const { ConformanceMonitor } = await import('../src/efsp/conformance.js');
  const { ForwardingObligationMonitor } = await import('../src/efsp/forwarding-obligations.js');
  const { CorrelationReconciler } = await import('../src/efsp/correlation-reconciler.js');
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'MON1' });

  const nlaMon = new NlaStatusMonitor({ clock: efsp.clock, boardStoreFor: efsp.boardStoreFor, facilityConfig });
  nlaMon.setOnDelta(() => {});
  nlaMon.tick();
  assert.ok(nlaMon._last.has(strip.stripId));

  const tracks = { getAll: () => [{ id: 't1', lat: 37, lon: 35, alt: 3000, course: 90, groundSpeed: 150, verticalSpeed: 0 }], getTrack: () => null };
  const conf = new ConformanceMonitor({
    clock: efsp.clock, trackStore: { ...tracks, get: (id) => tracks.getAll().find(t => t.id === id) || null },
    fdrStore: efsp.fdrStore, correlationStore: efsp.correlationStore, weather: () => ({}), transitionAltFt: () => 18000,
    indicatedAltFt: (a) => a, config: {},
  });
  conf._mem.set(strip.fdrId, {});
  conf._alerts.set(strip.fdrId, [{ kind: 'X' }]);

  const dropped = mustAct(efsp, c.APP, 'APP', strip, { kind: 'DropStrip' });
  offset = 3 * HOUR;
  archiverFor().sweep();
  offset = 0;
  assert.equal(efsp.fdrStore.getFdr(dropped.fdrId), null);

  nlaMon.tick();
  assert.equal(nlaMon._last.has(strip.stripId), false, 'NLA-status monitor let go');
  quiet(() => conf.tick());
  assert.equal(conf._mem.has(strip.fdrId), false, 'conformance _mem let go');
  assert.equal(conf._alerts.has(strip.fdrId), false, 'conformance _alerts let go');

  // The rest only have to not throw on a stripId/fdrId from a previous tick.
  const obligations = new ForwardingObligationMonitor({ clock: efsp.clock, boardStoreFor: efsp.boardStoreFor, fdrStore: efsp.fdrStore, facilityConfig, airspaceStore: efsp.airspaceStore });
  assert.doesNotThrow(() => obligations.tick());
  const reconciler = new CorrelationReconciler({
    clock: efsp.clock, trackStore: { getAll: () => [] }, beaconOf: () => null, fdrStore: efsp.fdrStore,
    correlationStore: efsp.correlationStore, boardStoreFor: efsp.boardStoreFor, facilityConfig, onDelta: () => {},
  });
  assert.doesNotThrow(() => reconciler.tick());
  assert.doesNotThrow(() => counter.noteFdr(dropped.fdrId));
  assert.doesNotThrow(() => efsp.snapshotFor());
});

// ── §5.4 F4: nothing else pins an archived Strip ────────────────────────────

/** Every Strip-shaped object reachable from `root`, by identity. */
function reachesStrip(root, target, seen = new Set()) {
  if (root === target) return true;
  if (!root || typeof root !== 'object' || seen.has(root)) return false;
  seen.add(root);
  if (root instanceof Map) {
    for (const [k, v] of root) if (reachesStrip(k, target, seen) || reachesStrip(v, target, seen)) return true;
    return false;
  }
  if (root instanceof Set) {
    for (const v of root) if (reachesStrip(v, target, seen)) return true;
    return false;
  }
  for (const v of Object.values(root)) if (reachesStrip(v, target, seen)) return true;
  return false;
}

test('F4: after archiving, no Board, store or monitor structure references the Strip (except the idempotency cache)', () => {
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'PIN1' });
  mustAct(efsp, c.APP, 'APP', strip, { kind: 'DropStrip' });
  const live = incirlik().getStrip(strip.stripId);
  offset = 3 * HOUR;
  archiverFor().sweep();
  offset = 0;
  for (const fid of facilityConfig.getFacilityIds()) {
    const b = efsp.boardStoreFor(fid);
    for (const k of ['_strips', '_log', '_nlaHistory', '_droppedWallAt']) {
      assert.equal(reachesStrip(b[k], live), false, `${fid}.${k}`);
    }
    assert.equal(b._log.some(e => e.id === strip.stripId && e.type === 'gone') || fid !== 'INCIRLIK', true, 'the ring keeps the id only');
  }
  for (const [name, store] of Object.entries({ fdr: efsp.fdrStore._fdrs, correlation: efsp.correlationStore._records, marsa: efsp.marsaStore._relations, nla: efsp.nlaStatusMonitor._last })) {
    assert.equal(reachesStrip(store, live), false, name);
  }
});

test('F4: the idempotency cache holds no Strip object after archiving', { todo: 'L27 rewrites _appliedMutations as compact records (decisions.md S-W3d); verify after L27 merges' }, () => {
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'PIN2' });
  mustAct(efsp, c.APP, 'APP', strip, { kind: 'DropStrip' });
  const live = incirlik().getStrip(strip.stripId);
  offset = 3 * HOUR;
  archiverFor().sweep();
  offset = 0;
  assert.equal(reachesStrip(incirlik()._appliedMutations, live), false);
});

// ── registration and the wire (§5.2, §5.5) ─────────────────────────────────

test('createEfsp exposes the archiver, and hasCountFor answers from the traffic count', () => {
  assert.ok(efsp.archiver instanceof Archiver);
  const dropped = droppedFlight('REG1');
  assert.equal(counter.hasCountFor(dropped.stripId), true);
  const live = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'REG2' });
  assert.equal(counter.hasCountFor(live.stripId), false);
  // Its default retention is real wall time: nothing that just dropped goes.
  efsp.archiver.setIsCounted((id) => counter.hasCountFor(id));
  const r = efsp.archiver.sweep();
  assert.equal((r.stripsByFacility.INCIRLIK || []).includes(dropped.stripId), false);
});

test('archiveDeltas + broadcastEfspBoardDelta: one delta per Facility, gone Strips and fdrs.gone, seq continuous', async () => {
  const { archiveDeltas } = await import('../src/efsp/archiver.js');
  const WsHub = (await import('../src/ws-hub.js')).default;
  const TrackStore = (await import('../src/tracks.js')).default;
  const CollaborativeStore = (await import('../src/collab-store.js')).default;
  const hub = new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore() });
  const sent = [];
  hub._broadcast = (m) => sent.push(m);

  const a = droppedFlight('WIRE1');
  const ctr = handedToCenter(efsp, c, airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'WIRE2' }));
  const b = mustAct(efsp, c.CTR, 'CTR', ctr, { kind: 'DropStrip' });
  offset = 3 * HOUR;
  const r = archiverFor().sweep();
  offset = 0;
  assert.deepEqual(archiveDeltas({ stripsByFacility: {}, fdrIds: [] }, efsp.boardStoreFor), [], 'an empty sweep sends nothing');
  for (const p of archiveDeltas(r, efsp.boardStoreFor)) hub.broadcastEfspBoardDelta(p);

  const inc = sent.find(m => m.facilityId === 'INCIRLIK');
  const cen = sent.find(m => m.facilityId === 'CENTER');
  assert.ok(inc.strips.gone.includes(a.stripId));
  assert.ok(cen.strips.gone.includes(b.stripId));
  assert.equal(inc.boardSeq, incirlik().currentSeq, 'the ring advanced, and the delta says so');
  assert.equal(cen.boardSeq, center().currentSeq);
  assert.deepEqual(inc.strips.updated, []);
  assert.ok(inc.fdrs.gone.includes(a.fdrId));
  assert.deepEqual(inc.fdrs.updated, []);

  // The NLA-status sweep's delta is unchanged: no gone, and no fdrs.gone key.
  sent.length = 0;
  hub.broadcastEfspBoardDelta({ facilityId: 'INCIRLIK', boardSeq: 1, strips: [] });
  assert.deepEqual(sent[0].strips.gone, []);
  assert.deepEqual(Object.keys(sent[0].fdrs), ['updated']);
});
