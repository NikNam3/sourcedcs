import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// docs/adr/0058 — the flight's assigned altitude and heading, on the FDR.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-clearance-test-'));
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = path.join(tmpDir, 'incirlik.json');
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER = path.join(tmpDir, 'center.json');
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL = path.join(tmpDir, 'tactical.json');
process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH = path.join(tmpDir, 'board.json');
process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH = path.join(tmpDir, 'mutations.jsonl');
process.env.CRCSYNC_EFSP_AIRSPACES_PATH = path.join(tmpDir, 'airspaces.json');
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify([]));

const { createEfsp } = await import('../src/efsp/index.js');
const { FdrStore, parseAltitudeFt, parseHeadingDeg } = await import('../src/efsp/fdr-store.js');
const { migrateClearanceAnnotations } = await import('../src/efsp/clearance-migration.js');
const { computeDueObligations } = await import('../src/efsp/forwarding-obligations.js');

function crew(efsp, spec) {
  const out = {};
  for (const [positionId, facilityId] of Object.entries(spec)) {
    const session = { controllerId: `c-${positionId}`, who: positionId };
    efsp.handleMessage(session, { type: 'efsp-set-positions', facilityId, held: [positionId] });
    out[positionId] = { session, facilityId };
  }
  return out;
}
function act(efsp, member, positionId, strip, op) {
  return efsp.handleMessage(member.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: member.facilityId, actingPositionId: positionId,
    stripId: strip ? strip.stripId : undefined, baseRev: strip ? strip.rev : undefined, op,
  }).ack;
}
function mustAct(efsp, member, positionId, strip, op) {
  const ack = act(efsp, member, positionId, strip, op);
  assert.equal(ack.ok, true, `${op.kind} as ${positionId}: ${JSON.stringify(ack)}`);
  return ack.strip;
}
const FILED = { aircraftType: 'F16', wakeCategory: 'D', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: 'FL250' };
const active = (cell) => cell.entries.find(e => e.status === 'ACTIVE');

test('altitudes and headings parse the way a strip writes them', () => {
  assert.equal(parseAltitudeFt('FL180'), 18000);
  assert.equal(parseAltitudeFt('050'), 5000);
  assert.equal(parseAltitudeFt('A050'), 5000);
  assert.equal(parseAltitudeFt('5000'), 5000);
  assert.equal(parseAltitudeFt('climb'), null);
  assert.equal(parseHeadingDeg('050'), 50);
  assert.equal(parseHeadingDeg('000'), 360);
  assert.equal(parseHeadingDeg('361'), null);
});

test('setClearance keeps §3.7 history, confirms vacated only on altitude, and refuses nonsense', () => {
  const store = new FdrStore();
  const fdr = store.createFdr({ callsign: 'VPR1', ...FILED }, { by: 'test' }).fdr;
  assert.equal(store.setClearance(fdr.fdrId, 'altitude', { value: '050' }, { by: 'cd' }).ok, true);
  assert.equal(store.setClearance(fdr.fdrId, 'altitude', { value: 'FL180' }, { by: 'app' }).ok, true);
  const cell = store.getFdr(fdr.fdrId).clearance.altitude;
  assert.deepEqual(cell.entries.map(e => [e.value, e.status, e.parsed]), [['050', 'SUPERSEDED', 5000], ['FL180', 'ACTIVE', 18000]]);

  assert.equal(store.setClearance(fdr.fdrId, 'altitude', { confirmVacated: true }).ok, true);
  assert.equal(cell.entries[1].status, 'STRUCK');
  assert.equal(store.setClearance(fdr.fdrId, 'heading', { confirmVacated: true }).ok, false, 'a heading is never vacated');
  const refused = store.setClearance(fdr.fdrId, 'altitude', { value: 'climb' });
  assert.equal(refused.ok, false);
  assert.match(refused.detail, /FL180/, 'the refusal says how to write it');
  // Clearing a heading ("resume own navigation") is an amendment like any other.
  store.setClearance(fdr.fdrId, 'heading', { value: '270' });
  store.setClearance(fdr.fdrId, 'heading', { value: '' });
  assert.equal(active(store.getFdr(fdr.fdrId).clearance.heading).value, '');
});

test('what APP assigns is on CTR\'s copy of the flight — one clearance, not one per Strip', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' });
  let strip = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { callsign: 'VPR2', ...FILED } });
  strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'SetState', toState: 'HANDED_OFF' });
  strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main' });
  strip = mustAct(efsp, c.APP, 'APP', strip, { kind: 'SetBlock', blockId: '21', value: 'FL180' });
  strip = mustAct(efsp, c.APP, 'APP', strip, { kind: 'SetBlock', blockId: '20', value: '090' });
  const proposed = mustAct(efsp, c.APP, 'APP', strip, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
  const replica = efsp.boardStoreFor('CENTER').getStrip(proposed.coordination.peerStripId);
  const fdr = efsp.fdrStore.getFdr(replica.fdrId);
  assert.equal(replica.fdrId, strip.fdrId);
  assert.equal(active(fdr.clearance.altitude).value, 'FL180');
  assert.equal(active(fdr.clearance.heading).value, '090');
  assert.equal(replica.annotations['21'], undefined, 'nothing is stored on the Strip');
});

test('issuing a clearance altitude is not a flight-plan amendment — no AMENDMENT_INSIDE_30MIN', () => {
  const store = new FdrStore();
  const fdr = store.createFdr({ callsign: 'VPR3', ...FILED, proposedDepartureTimeUtc: Date.now() + 10 * 60 * 1000 }, { by: 'test' }).fdr;
  fdr.updatedAt = Date.now() - 5 * 60 * 1000; // filed a while ago
  store.setClearance(fdr.fdrId, 'altitude', { value: '050' }, { by: 'cd' });
  const strip = { stripId: 's', fdrId: fdr.fdrId, role: 'DEPARTURE', state: 'CLEARED', coordination: null };
  const due = computeDueObligations(strip, store.getFdr(fdr.fdrId), Date.now());
  assert.equal(due.some(o => o.obligationType === 'AMENDMENT_INSIDE_30MIN'), false);
});

test('an old Board\'s clearance annotations move onto their flights on restore', () => {
  const store = new FdrStore();
  const a = store.createFdr({ callsign: 'VPR4', ...FILED }, { by: 'test' }).fdr;
  const b = store.createFdr({ callsign: 'VPR5', ...FILED }, { by: 'test' }).fdr;
  const history = [{ value: '050', status: 'SUPERSEDED', at: 1, by: 'cd' }, { value: 'fl180', status: 'ACTIVE', at: 2, by: 'app' }];
  const strips = [
    { stripId: 's1', fdrId: a.fdrId, role: 'DEPARTURE', annotations: { '21': { blockId: '21', entries: history }, '24': { blockId: '24', entries: [] } } },
    // A replica of the same flight with its own hand-copied note: the first one wins.
    { stripId: 's2', fdrId: a.fdrId, role: 'DEPARTURE', annotations: { '21': { blockId: '21', entries: [{ value: '999', status: 'ACTIVE', at: 3 }] } } },
    { stripId: 's3', fdrId: b.fdrId, role: 'ARRIVAL', annotations: { '9A-VECTOR': { blockId: '9A-VECTOR', entries: [{ value: '270', status: 'ACTIVE', at: 4 }] } } },
  ];
  assert.equal(migrateClearanceAnnotations(strips, id => store.getFdr(id)), 2);
  assert.deepEqual(store.getFdr(a.fdrId).clearance.altitude.entries.map(e => [e.value, e.status, e.parsed]),
    [['050', 'SUPERSEDED', 5000], ['FL180', 'ACTIVE', 18000]]);
  assert.equal(active(store.getFdr(b.fdrId).clearance.heading).parsed, 270);
  assert.equal(strips[0].annotations['21'], undefined);
  assert.ok(strips[0].annotations['24'], 'other annotations are untouched');
  assert.equal(strips[1].annotations['21'], undefined);
});
