import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'node:module';

// docs/adr/0099: formation split and join, through the real wire path (createEfsp), one audited op each.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-formation-'));
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
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify({}));

const require = createRequire(import.meta.url);
const { createEfsp } = await import('../src/efsp/index.js');
const { crew, act, mustAct, airborneDeparture, DEPARTURE_FLIGHT_DATA } = await import('./helpers/efsp-scenario.mjs');
const traffic = require('../src/efsp/traffic-count.js');
const authority = require('../src/efsp/authority');
const permission = require('../src/efsp/permission.js');
const classPermission = (await import('./helpers/permission.mjs')).classPermission();
const OPS_MODULES = require('../src/efsp/board/ops');

const efsp = createEfsp();
const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER', TAC_C2: 'TACTICAL' });
const board = efsp.boardStoreFor('INCIRLIK');
const fd = (id) => efsp.flightDataStore.getFlightData(id);
const cur = (s) => board.getStrip(s.stripId);
const active = (flightData, field) => flightData.clearance[field].entries.find(e => e.status === 'ACTIVE');

let n = 0;
/** A formation of `size` airborne at AP (DEPARTURE, HANDED_OFF). */
function formation(size, extra = {}) {
  n += 1;
  return airborneDeparture(efsp, c, { ...DEPARTURE_FLIGHT_DATA, callsign: `FRM${n}`, aircraftType: 'F-16C', flightSize: size, ...extra });
}
/** A DEPARTURE on the ground at OPS (PROPOSED). */
function groundFormation(size) {
  n += 1;
  return mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE',
    flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: `GND${n}`, flightSize: size },
  });
}
const split = (strip, positionId, op) => act(efsp, c[positionId], positionId, strip, { kind: 'SplitFormation', ...op });
const join = (joiner, lead, positionId) => act(efsp, c[positionId], positionId, joiner, { kind: 'JoinFormation', leadStripId: lead.stripId, leadBaseRev: lead.rev });
const hdg = (v = '270') => ({ kind: 'HEADING', value: v });
const lastAudit = (op) => efsp.mutationLog.readAll().filter(e => e.op === op).pop();

test('S1 a 4-ship splits 2 by heading 270: a new Strip after the lead, new flight data, one audit entry', () => {
  const lead = formation(4);
  const ack = split(lead, 'AP', { size: 2, callsign: 'VIPER3', assignment: hdg() });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  const part = board.getStrip(ack.splitStripId);
  const lead2 = cur(lead);
  assert.equal(part.stripType, lead2.stripType); assert.equal(part.state, lead2.state);
  assert.equal(part.ownerPositionId, 'AP'); assert.equal(part.bayId, lead2.bayId);
  const rack = board.getRack(lead2.bayId, lead2.rackId).map(s => s.stripId);
  assert.equal(rack[rack.indexOf(lead2.stripId) + 1], part.stripId, 'directly after the lead');
  const pf = fd(part.flightDataId); const lf = fd(lead2.flightDataId);
  assert.equal(pf.identity.callsign, 'VIPER3'); assert.equal(pf.identity.flightSize, 2); assert.equal(lf.identity.flightSize, 2);
  assert.notEqual(pf.identity.beaconAssigned, lf.identity.beaconAssigned);
  assert.equal(pf.identity.splitFrom, lf.flightDataId);
  assert.equal(pf.filed.route, lf.filed.route); assert.equal(pf.identity.aircraftType, 'F-16C');
  assert.equal(active(pf, 'heading').parsed, 270);
  assert.equal(part.splitFrom.stripId, lead2.stripId);
  const entries = efsp.mutationLog.readAll().filter(e => e.op === 'SplitFormation' && e.stripId === lead.stripId);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].records.length, 1); assert.equal(entries[0].records[0].before, null);
  assert.equal(entries[0].split.remaining, 2);
  assert.equal(ack.split.size, 2);
});

test('S2 refusals each give their reason and change nothing', () => {
  const lead = formation(4);
  const lf = fd(lead.flightDataId);
  const snapshot = () => JSON.stringify([efsp.flightDataStore.snapshot().codes, board.getAll().length]);
  const single = formation(1);
  const before = snapshot();
  const cases = [
    [{ size: 0, callsign: 'X1', assignment: hdg() }, /1 to 3/],
    [{ size: 4, callsign: 'X1', assignment: hdg() }, /1 to 3/],
    [{ size: 1, callsign: '', assignment: hdg() }, /callsign/],
    [{ size: 1, callsign: lf.identity.callsign, assignment: hdg() }, /own callsign/],
    [{ size: 1, callsign: 'X1', assignment: null }, /assignment/],
    [{ size: 1, callsign: 'X1', assignment: hdg('abc') }, /heading/],
  ];
  for (const [op, re] of cases) {
    const ack = split(lead, 'AP', op);
    assert.equal(ack.ok, false); assert.match(`${ack.reason} ${ack.detail}`, re);
  }
  assert.equal(split(lead, 'AP', { size: 1, callsign: 'X1', assignment: null }).reason, 'ASSIGNMENT_REQUIRED');
  assert.match(split(single, 'AP', { size: 1, callsign: 'X1', assignment: hdg() }).detail, /single aircraft/);
  assert.equal(split(lead, 'CD', { size: 1, callsign: 'X1', assignment: hdg() }).reason, 'NOT_OWNER');
  assert.equal(split(lead, 'TAC_C2', { size: 1, callsign: 'X1', assignment: hdg() }).reason, 'PERMISSION_DENIED');
  assert.equal(snapshot(), before, 'allocator and Board unchanged');
});

test('S2b an open coordination proposal blocks a split', () => {
  const lead = formation(2);
  const proposed = mustAct(efsp, c.AP, 'AP', lead, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
  const ack = split(proposed, 'AP', { size: 1, callsign: 'Y1', assignment: hdg() });
  assert.equal(ack.ok, false); assert.match(ack.detail, /coordination/);
});

test('S3 a return from MARSA still needs the assignment (H100 Q-SJ1 b); with one it is applied and audited', () => {
  const lead = formation(3);
  const codesBefore = JSON.stringify(efsp.flightDataStore.snapshot().codes);
  const a = split(lead, 'AP', { size: 1, callsign: 'M1', assignment: null, marsaReturn: true });
  assert.equal(a.reason, 'ASSIGNMENT_REQUIRED');
  assert.equal(JSON.stringify(efsp.flightDataStore.snapshot().codes), codesBefore, 'nothing allocated');
  const b = split(lead, 'AP', { size: 1, callsign: 'M1', assignment: hdg('090'), marsaReturn: true });
  assert.equal(b.ok, true);
  assert.equal(b.split.marsaReturn, true);
  assert.equal(lastAudit('SplitFormation').split.marsaReturn, true);
  assert.ok(fd(board.getStrip(b.splitStripId).flightDataId).identity.beaconAssigned);
});

test('S4 split by speed 250 and M.85, and by altitude FL240', () => {
  const lead = formation(4);
  const a = split(lead, 'AP', { size: 1, callsign: 'S1', assignment: { kind: 'SPEED', value: '250' } });
  const b = split(cur(lead), 'AP', { size: 1, callsign: 'S2', assignment: { kind: 'SPEED', value: 'M.85' } });
  const d = split(cur(lead), 'AP', { size: 1, callsign: 'S3', assignment: { kind: 'ALTITUDE', value: 'FL240' } });
  for (const x of [a, b, d]) assert.equal(x.ok, true, JSON.stringify(x));
  const pa = fd(board.getStrip(a.splitStripId).flightDataId); const pb = fd(board.getStrip(b.splitStripId).flightDataId);
  assert.equal(active(pa, 'speed').parsed, 250); assert.equal(active(pa, 'speed').unit, 'KT');
  assert.equal(active(pb, 'speed').parsed, 0.85); assert.equal(active(pb, 'speed').value, 'M.85');
  assert.equal(active(fd(board.getStrip(d.splitStripId).flightDataId), 'altitude').parsed, 24000);
  assert.equal(split(cur(lead), 'AP', { size: 1, callsign: 'S4', assignment: { kind: 'SPEED', value: 'fast' } }).ok, false);
});

test('S5 splitting twice (4 -> 2+2 -> 1+1) leaves three Strips of sizes 2, 1, 1 with three codes', () => {
  const lead = formation(4);
  const a = split(lead, 'AP', { size: 2, callsign: 'T2', assignment: hdg() });
  const part = board.getStrip(a.splitStripId);
  const b = split(part, 'AP', { size: 1, callsign: 'T3', assignment: hdg('180') });
  assert.equal(b.ok, true);
  const strips = [cur(lead), cur(part), board.getStrip(b.splitStripId)];
  assert.deepEqual(strips.map(s => fd(s.flightDataId).identity.flightSize), [2, 1, 1]);
  assert.equal(new Set(strips.map(s => fd(s.flightDataId).identity.beaconAssigned)).size, 3);
});

test('S6 a lead with an ACTIVE replica at CENTER reads the new size; the part has no replica', () => {
  const lead = formation(4);
  const proposed = mustAct(efsp, c.AP, 'AP', lead, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
  const replica = efsp.boardStoreFor('CENTER').getStrip(proposed.coordination.peerStripId);
  mustAct(efsp, c.CTR, 'CTR', replica, { kind: 'HANDOFF', action: 'ACCEPT' });
  const ack = split(cur(lead), 'AP', { size: 2, callsign: 'R2', assignment: hdg() });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(fd(efsp.boardStoreFor('CENTER').getStrip(replica.stripId).flightDataId).identity.flightSize, 2);
  assert.equal(board.getStrip(ack.splitStripId).coordination, null);
});

test('S7 join 2 into 2: the joiner ends JOINED, its flight data is void, its code is released, the lead grows', () => {
  const lead = formation(4);
  const a = split(lead, 'AP', { size: 2, callsign: 'J2', assignment: hdg() });
  const part = board.getStrip(a.splitStripId);
  const code = fd(part.flightDataId).identity.beaconAssigned;
  const ack = join(part, cur(lead), 'AP');
  assert.equal(ack.ok, true, JSON.stringify(ack));
  const joiner = cur(part);
  assert.equal(joiner.state, 'DROPPED'); assert.equal(joiner.endReason, 'JOINED'); assert.equal(joiner.joinedInto.stripId, lead.stripId);
  assert.equal(fd(part.flightDataId).voided.reason, 'JOINED'); assert.equal(fd(part.flightDataId).voided.into, lead.flightDataId);
  assert.equal(efsp.flightDataStore.codeAllocator.isAllocated(code), false);
  assert.equal(fd(lead.flightDataId).identity.flightSize, 4);
  const entries = efsp.mutationLog.readAll().filter(e => e.op === 'JoinFormation' && e.stripId === part.stripId);
  assert.equal(entries.length, 1); assert.equal(entries[0].records[0].stripId, lead.stripId);
  assert.equal(entries[0].join.newSize, 4);
});

test('S8 join refusals: not owner, same Strip, stale lead rev, replica at another Facility, open exchange', () => {
  const lead = formation(2); const other = formation(1);
  const first = join(other, lead, 'AP');
  assert.equal(first.ok, true, JSON.stringify(first));
  const l2 = groundFormation(2); const o2 = formation(1);
  const nonOwner = join(o2, l2, 'AP');
  assert.equal(nonOwner.ok, false); assert.equal(nonOwner.reason, 'NOT_OWNER');
  assert.equal(join(l2, o2, 'AP').reason, 'NOT_OWNER', 'the joiner not owned either');
  const a = formation(2); const same = join(a, a, 'AP');
  assert.equal(same.ok, false);
  const b = formation(2); const bj = formation(1);
  const stale = act(efsp, c.AP, 'AP', bj, { kind: 'JoinFormation', leadStripId: b.stripId, leadBaseRev: b.rev + 7 });
  assert.equal(stale.reason, 'STALE_REV');
  const e = formation(2); const ej = formation(1);
  const proposed = mustAct(efsp, c.AP, 'AP', ej, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
  const open = join(proposed, e, 'AP');
  assert.equal(open.ok, false); assert.match(open.detail, /coordination/);
  const f = formation(2); const fj = formation(1);
  const p2 = mustAct(efsp, c.AP, 'AP', fj, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
  mustAct(efsp, c.CTR, 'CTR', efsp.boardStoreFor('CENTER').getStrip(p2.coordination.peerStripId), { kind: 'HANDOFF', action: 'ACCEPT' });
  const live = join(cur(fj), f, 'AP');
  assert.equal(live.ok, false); assert.match(live.detail, /another live Strip/);
});

test('S9 count: 4 split 2+2 both drop = 2 flights, 4 aircraft with lineage; split then rejoin = 1 flight, joiner JOINED', () => {
  const counter = new traffic.TrafficCount({
    mutationLog: efsp.mutationLog, flightDataStore: efsp.flightDataStore, boardStoreFor: efsp.boardStoreFor,
    facilityIds: ['INCIRLIK', 'CENTER', 'TACTICAL'], config: { retentionDays: 400, homeAirports: { INCIRLIK: ['LTAG'] } },
  });
  const lead = formation(4);
  const a = split(lead, 'AP', { size: 2, callsign: 'C2', assignment: hdg() });
  const part = board.getStrip(a.splitStripId);
  mustAct(efsp, c.AP, 'AP', cur(lead), { kind: 'DropStrip' });
  mustAct(efsp, c.AP, 'AP', cur(part), { kind: 'DropStrip' });
  const recs = counter.records().filter(r => r.stripId === lead.stripId || r.stripId === part.stripId);
  assert.equal(recs.length, 2);
  assert.equal(recs.reduce((t, r) => t + (r.counted ? r.flightSize : 0), 0), 4);
  assert.equal(recs.find(r => r.stripId === part.stripId).splitFromFlightDataId, lead.flightDataId);

  const l2 = formation(4);
  const b = split(l2, 'AP', { size: 2, callsign: 'C4', assignment: hdg() });
  const p2 = board.getStrip(b.splitStripId);
  assert.equal(join(p2, cur(l2), 'AP').ok, true);
  mustAct(efsp, c.AP, 'AP', cur(l2), { kind: 'DropStrip' });
  const r2 = counter.records().filter(r => r.stripId === l2.stripId || r.stripId === p2.stripId);
  const joined = r2.find(r => r.stripId === p2.stripId);
  assert.equal(joined.counted, false); assert.equal(joined.excludedReason, 'JOINED');
  assert.equal(r2.find(r => r.stripId === l2.stripId).flightSize, 4);
  assert.equal(counter.reconcile().missing.length, 0);
});

test('S9b an Undo entry that removes a dropped split part VOIDs its COUNT (stripChangesOf / undoneDrops)', () => {
  const dropped = { stripId: 'B', state: 'DROPPED' };
  const entry = { op: 'Undo', stripId: 'A', before: { state: 'DEPARTED' }, after: { state: 'DEPARTED' }, records: [{ stripId: 'B', before: dropped, after: null }] };
  assert.deepEqual(traffic.undoneDrops(entry), ['B']);
  assert.equal(traffic.isUndoOfDrop(entry), true);
  assert.deepEqual(traffic.stripChangesOf(entry).map(x => x.stripId), ['A', 'B']);
  assert.equal(traffic.isUndoOfDrop({ op: 'SplitFormation', stripId: 'A', before: dropped, after: { state: 'X' } }), false);
});

test('S10/S11 undo declarations: scopes follow the ADR 0100 contract', () => {
  const sp = OPS_MODULES.find(m => m.kind === 'SplitFormation'); const jn = OPS_MODULES.find(m => m.kind === 'JoinFormation');
  const lead = formation(3); const part = board.getStrip(split(lead, 'AP', { size: 1, callsign: 'U1', assignment: hdg() }).splitStripId);
  const ctx = { rules: { facilityId: 'INCIRLIK', activeMarsaFor: () => null }, state: { get: (id) => board.getStrip(id) }, flightDataStore: efsp.flightDataStore };
  const s = sp.undo.scope(ctx, cur(lead), { callsign: 'U1' });
  assert.deepEqual(s.strips, [{ facilityId: 'INCIRLIK', stripId: lead.stripId }]); assert.deepEqual(s.flightData, [lead.flightDataId]);
  const made = sp.undo.created({ splitStrip: part, split: { newFlightDataId: part.flightDataId } }, ctx);
  assert.deepEqual(made.strips, [{ facilityId: 'INCIRLIK', stripId: part.stripId }]); assert.deepEqual(made.flightData, [part.flightDataId]);
  const j = jn.undo.scope(ctx, part, { leadStripId: lead.stripId });
  assert.equal(j.strips.length, 2); assert.equal(j.flightData.length, 2);
  assert.deepEqual(j.codes, [fd(part.flightDataId).identity.beaconAssigned]);
  assert.deepEqual(j.marsa, [{ flightDataId: part.flightDataId }]);
});

test('S10 undoing a split removes the part, archives its flight data (code released) and restores the lead\'s size', () => {
  const lead = formation(4);
  const ack = split(lead, 'AP', { size: 2, callsign: 'UNS1', assignment: hdg() });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(ack.undoable.label, `Split UNS1 off ${fd(lead.flightDataId).identity.callsign}`);
  const part = board.getStrip(ack.splitStripId);
  const code = fd(part.flightDataId).identity.beaconAssigned;
  const undo = act(efsp, c.AP, 'AP', cur(lead), { kind: 'Undo', actionId: ack.undoable.actionId });
  assert.equal(undo.ok, true, JSON.stringify(undo));
  assert.equal(board.getStrip(part.stripId), null, 'the part is gone');
  assert.equal(fd(part.flightDataId), null, 'its flight data archived');
  assert.equal(efsp.flightDataStore.codeAllocator.holderOf(code), null, 'its code released');
  assert.equal(fd(lead.flightDataId).identity.flightSize, 4);
  const entry = lastAudit('Undo');
  assert.equal(entry.undoneOp, 'SplitFormation');
  const rec = entry.records.find(r => r.stripId === part.stripId);
  assert.ok(rec && rec.after === null && rec.before, 'the removed part rides in records with after: null');
});

test('S10b undoing a split after the part dropped: the part\'s drop is voided and its COUNT VOIDed (undoneDrops)', () => {
  const counter = new traffic.TrafficCount({
    mutationLog: efsp.mutationLog, flightDataStore: efsp.flightDataStore, boardStoreFor: efsp.boardStoreFor,
    facilityIds: ['INCIRLIK', 'CENTER', 'TACTICAL'], config: { retentionDays: 400, homeAirports: { INCIRLIK: ['LTAG'] } },
  });
  const lead = formation(4);
  const ack = split(lead, 'AP', { size: 2, callsign: 'UNS2', assignment: hdg() });
  const part = board.getStrip(ack.splitStripId);
  mustAct(efsp, c.AP, 'AP', cur(part), { kind: 'DropStrip' });
  const counted = counter.records().find(r => r.stripId === part.stripId);
  assert.ok(counted && counted.counted, JSON.stringify(counted));
  const undo = act(efsp, c.AP, 'AP', cur(lead), { kind: 'Undo', actionId: ack.undoable.actionId });
  assert.equal(undo.ok, true, JSON.stringify(undo));
  assert.equal(board.getStrip(part.stripId), null);
  const entry = lastAudit('Undo');
  assert.deepEqual(traffic.undoneDrops(entry), [part.stripId]);
  const after = counter.records().find(r => r.stripId === part.stripId);
  assert.ok(!after || after.counted === false, `the dropped part no longer counts: ${JSON.stringify(after)}`);
  assert.equal(fd(lead.flightDataId).identity.flightSize, 4);
});

test('S11 undoing a join restores the joiner live, un-voids its flight data, re-acquires its code and shrinks the lead', () => {
  const lead = formation(3);
  const a = split(lead, 'AP', { size: 1, callsign: 'UNJ1', assignment: hdg() });
  const part = board.getStrip(a.splitStripId);
  const partBefore = cur(part);
  const code = fd(part.flightDataId).identity.beaconAssigned;
  const ack = join(part, cur(lead), 'AP');
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(ack.undoable.label, `Join UNJ1 into ${fd(lead.flightDataId).identity.callsign}`);
  assert.equal(fd(part.flightDataId).voided.reason, 'JOINED');
  assert.equal(fd(lead.flightDataId).identity.flightSize, 3);
  const undo = act(efsp, c.AP, 'AP', cur(part), { kind: 'Undo', actionId: ack.undoable.actionId });
  assert.equal(undo.ok, true, JSON.stringify(undo));
  const back = cur(part);
  assert.equal(back.state, partBefore.state);
  assert.equal(back.endReason, undefined); assert.equal(back.joinedInto, undefined);
  assert.equal(board.droppedWallAtOf(part.stripId) || null, null, 'off the archive clock');
  assert.equal(fd(part.flightDataId).voided, undefined, 'the before-image has no voided');
  assert.equal(fd(part.flightDataId).identity.flightSize, 1);
  assert.equal(efsp.flightDataStore.codeAllocator.holderOf(code), part.flightDataId, 'the code is the joiner\'s again');
  assert.equal(fd(lead.flightDataId).identity.flightSize, 2);
  assert.equal(lastAudit('Undo').undoneOp, 'JoinFormation');
});

test('S11b JoinFormation with no lead on this Board is not undoable (scope null) and refuses', () => {
  const lone = formation(2);
  const ack = act(efsp, c.AP, 'AP', lone, { kind: 'JoinFormation', leadStripId: 'nope', leadBaseRev: 1 });
  assert.equal(ack.ok, false); assert.equal(ack.undoable, undefined);
  const jn = OPS_MODULES.find(m => m.kind === 'JoinFormation');
  assert.equal(jn.undo.scope({ rules: { facilityId: 'INCIRLIK' }, state: { get: () => null } }, lone, { leadStripId: 'nope' }), null);
});

test('S12 a joined Strip is archived after 2 h with its voided flight data', () => {
  const lead = formation(2);
  const a = split(lead, 'AP', { size: 1, callsign: 'A1', assignment: hdg() });
  const part = board.getStrip(a.splitStripId);
  assert.equal(join(part, cur(lead), 'AP').ok, true);
  assert.equal(board.getStrip(part.stripId).state, 'DROPPED');
  assert.ok(board.droppedWallAtOf(part.stripId) > 0, 'on the archive clock like any drop');
  assert.equal(board.archiveStrip(part.stripId, 'test').ok !== false, true);
  efsp.flightDataStore.archiveFlightData(part.flightDataId);
  assert.equal(fd(part.flightDataId), null);
});

test('S14 every strip type declares both eligibility keys and groundStates; every state is ground, airborne or DROPPED', () => {
  for (const stripType of authority.stripTypeNames()) {
    const f = authority.stripTypeFamily(stripType);
    for (const k of ['splitEligibleStates', 'joinEligibleStates', 'groundStates']) assert.ok(Array.isArray(f[k]), `${stripType}.${k}`);
    for (const state of f.states) {
      const kinds = [f.groundStates.includes(state), f.splitEligibleStates.includes(state) && !f.groundStates.includes(state), state === 'DROPPED'];
      if (f.splitEligibleStates.length || state === 'DROPPED') assert.equal(kinds.filter(Boolean).length, 1, `${stripType}.${state}`);
    }
  }
  assert.throws(() => authority.registerStripTypeFamily({ stripType: 'X' }), /authority registry/);
});

test('S15 eligibility: every IFR type in a ground and an airborne state; MISSION, carrier types and DROPPED refused', () => {
  const elig = (t) => authority.formationEligibility(t);
  assert.deepEqual(elig('DEPARTURE').split, ['PROPOSED', 'PENDING_CLEARANCE', 'CLEARED', 'HELD', 'PUSHBACK', 'TAXI', 'RUNWAY_QUEUE', 'LUAW', 'DEPARTED', 'HANDED_OFF']);
  assert.deepEqual(elig('ARRIVAL').ground, ['LANDED', 'TAXI_IN']);
  assert.ok(elig('ARRIVAL').split.includes('INBOUND') && !elig('ARRIVAL').split.includes('DROPPED'));
  assert.deepEqual(elig('OVERFLIGHT').ground, []);
  for (const t of ['MISSION', 'MARSHAL', 'FINAL', 'PATTERN']) { assert.deepEqual(elig(t).split, []); assert.deepEqual(elig(t).join, []); }
  const lead = formation(2);
  const dropped = mustAct(efsp, c.AP, 'AP', lead, { kind: 'DropStrip' });
  assert.match(split(dropped, 'AP', { size: 1, callsign: 'Z1', assignment: hdg() }).detail, /cannot be split/);
});

test('S16 a ground split needs no assignment; the same on an airborne state is refused', () => {
  const g = groundFormation(3);
  const ack = split(g, 'OPS', { size: 1, callsign: 'G1', assignment: null });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  const part = board.getStrip(ack.splitStripId); const pf = fd(part.flightDataId);
  assert.ok(pf.identity.beaconAssigned); assert.equal(pf.clearance.heading.entries.length, 0);
  assert.equal(pf.timeInputs.takeoffStampedUtc, null);
  assert.equal(split(formation(2), 'AP', { size: 1, callsign: 'G2', assignment: null }).reason, 'ASSIGNMENT_REQUIRED');
});

test('S17 grants: every ATC Position may; tactical and carrier Positions may not', () => {
  for (const p of ['OPS', 'CD', 'GC', 'LC', 'AP', 'CTR', 'RSU', 'SFA', 'PAR']) {
    for (const k of permission.FORMATION_OP_KINDS) assert.equal(classPermission.canMutate(p, k), true, `${p} ${k}`);
  }
  for (const p of ['TAC_C2', 'GCI', 'AIC', 'JTAC', 'CV_MARSHAL', 'CV_PRIFLY', 'CV_APP1', 'CV_APP2']) {
    for (const k of permission.FORMATION_OP_KINDS) assert.equal(classPermission.canMutate(p, k), false, `${p} ${k}`);
  }
  assert.ok(!permission.OP_KINDS.includes('SplitFormation'), 'a literal grant, not an OP_KINDS entry');
});

test('S18 speed is a recorded assignment on DEPARTURE, ARRIVAL and OVERFLIGHT Blocks: no alert, no conformance', () => {
  const { resolveBlockTarget, interlockFor } = require('../src/efsp/block-map.js');
  for (const t of ['DEPARTURE', 'ARRIVAL', 'OVERFLIGHT']) {
    assert.deepEqual(resolveBlockTarget(t, '9A-SPEED'), { kind: 'clearance', field: 'speed' }, t);
    assert.equal(interlockFor(t, '9A-SPEED'), null, `${t} has no control axis`);
  }
  const lead = formation(2);
  const ack = mustAct(efsp, c.AP, 'AP', lead, { kind: 'SetBlock', blockId: '9A-SPEED', value: 'M.80' });
  assert.equal(active(fd(ack.flightDataId), 'speed').value, 'M.80');
  assert.equal(act(efsp, c.AP, 'AP', cur(lead), { kind: 'SetBlock', blockId: '9A-SPEED', value: 'warp' }).ok, false);
});
