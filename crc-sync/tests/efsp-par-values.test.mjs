import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { slot } from './helpers/wire-slots.mjs';

/* docs/adr/0130 (decisions H153): the PAR controller sets an approach's TDZE, TCH, decision height and glidepath angle at run
 * time. The values ride the runway-status record (one per runway end, server-held, so every PAR scope and the monitor agree):
 * the op, who may send it, the ranges, the audit, the mission reset that keeps them, and persistence.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-par-values-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const par = (await import('../src/surveillance/par.js')).default;
const facilityConfig = (await import('../src/efsp/facility-config.js')).createFacilityConfig();
const { RunwayStatusStore } = await import('../src/efsp/runway-status-store.js');
const { MutationLog } = await import('../src/efsp/mutation-log.js');
const permission = await import('../src/efsp/permission.js');
const { checkPersistedShape } = await import('../src/efsp/stores.js');

const INCIRLIK = facilityConfig.getFacilityConfig('INCIRLIK');

function fixtureConfig(over = {}) {
  const incirlik = { ...structuredClone(INCIRLIK), ...over };
  return { getFacilityIds: () => ['INCIRLIK'], getFacilityConfig: () => structuredClone(incirlik) };
}
let logN = 0;
function freshStore({ config, clock } = {}) {
  const logPath = path.join(tmpDir, `store-${++logN}.jsonl`);
  const store = new RunwayStatusStore(config || fixtureConfig(), { mutationLog: new MutationLog(logPath), ...(clock ? { clock } : {}) });
  const log = () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  return { store, log };
}
const set = (store, positionId, fields) => store.apply({ clientMutationId: `m-${Math.random()}`, facilityId: 'INCIRLIK', op: { kind: 'SetParApproach', ...fields } }, positionId, `c-${positionId}`);

test('validateParValue: the ranges, rounding and null (reset to the default)', () => {
  assert.deepEqual(par.validateParValue('gpaDeg', 2.754), { ok: true, value: 2.75 });
  assert.deepEqual(par.validateParValue('gpaDeg', 3.5), { ok: true, value: 3.5 });
  assert.equal(par.validateParValue('gpaDeg', 3.51).ok, false);
  assert.equal(par.validateParValue('gpaDeg', 2.49).ok, false);
  assert.deepEqual(par.validateParValue('tdzeFt', 238.4), { ok: true, value: 238 });
  assert.equal(par.validateParValue('tdzeFt', 15001).ok, false);
  assert.deepEqual(par.validateParValue('tchFt', 0), { ok: true, value: 0 });
  assert.equal(par.validateParValue('tchFt', 201).ok, false);
  assert.equal(par.validateParValue('dhFt', 99).ok, false);
  assert.deepEqual(par.validateParValue('dhFt', 100), { ok: true, value: 100 });
  assert.deepEqual(par.validateParValue('dhFt', null), { ok: true, value: null });
  for (const bad of ['3', NaN, Infinity, {}, true]) assert.equal(par.validateParValue('gpaDeg', bad).ok, false, String(bad));
  const r = par.validateParValue('courseTrueDeg', 56);
  assert.equal(r.ok, false);
  assert.match(r.detail, /unknown PAR approach value/);
});

test('SetParApproach is the PAR Position\'s, and only its (the Position the final is handed to)', () => {
  assert.deepEqual(permission.RUNWAY_STATUS_OP_OWNERS.SetParApproach, ['PAR']);
  for (const id of ['LC', 'AP', 'OPS', 'GC', 'CD', 'CTR', 'CV_MARSHAL']) assert.equal(permission.canActOnRunwayStatus(id, 'SetParApproach'), false, id);
  const { store } = freshStore();
  const r = set(store, 'AP', { runwayEnd: '05', field: 'gpaDeg', value: 3 });
  assert.equal(r.reason, 'PERMISSION_DENIED');
  assert.deepEqual(store.parValues('INCIRLIK'), {});
});

test('a set value is held per runway end, bumps rev once, writes a transition, and null resets it to the default', () => {
  let now = 5_000;
  const { store, log } = freshStore({ clock: { now: () => now } });
  const rev0 = store.getRunwayStatus('INCIRLIK').rev;
  let r = set(store, 'PAR', { runwayEnd: '05', field: 'gpaDeg', value: 2.8 });
  assert.equal(r.ok, true);
  assert.deepEqual(store.parValues('INCIRLIK'), { '05': { gpaDeg: 2.8 } });
  assert.deepEqual(r.runwayStatus.parValues, { '05': { gpaDeg: 2.8 } }, 'the record on the wire carries them');
  assert.equal(r.runwayStatus.rev, rev0 + 1);
  const t = r.runwayStatus.transitions.at(-1);
  assert.deepEqual(t, { op: 'SetParApproach', runwayEnd: '05', field: 'gpaDeg', from: null, to: 2.8, positionId: 'PAR', at: 5_000, by: 'c-PAR' });
  now = 6_000;
  r = set(store, 'PAR', { runwayEnd: '05', field: 'tdzeFt', value: 238 });
  assert.deepEqual(store.parValues('INCIRLIK'), { '05': { gpaDeg: 2.8, tdzeFt: 238 } });
  r = set(store, 'PAR', { runwayEnd: '23', field: 'dhFt', value: 300 });
  assert.deepEqual(store.parValues('INCIRLIK'), { '05': { gpaDeg: 2.8, tdzeFt: 238 }, '23': { dhFt: 300 } });
  // the same value again: an unchanged success, no rev
  const rev = store.getRunwayStatus('INCIRLIK').rev;
  r = set(store, 'PAR', { runwayEnd: '23', field: 'dhFt', value: 300 });
  assert.equal(r.ok, true);
  assert.equal(r.unchanged, true);
  assert.equal(store.getRunwayStatus('INCIRLIK').rev, rev);
  // reset to the default: the field goes, and an end with nothing left goes too
  r = set(store, 'PAR', { runwayEnd: '23', field: 'dhFt', value: null });
  assert.equal(r.ok, true);
  assert.deepEqual(store.parValues('INCIRLIK'), { '05': { gpaDeg: 2.8, tdzeFt: 238 } });
  assert.deepEqual(r.runwayStatus.transitions.at(-1).to, null);
  // audited, at the mission clock, one entry per op (the refusal below too)
  set(store, 'PAR', { runwayEnd: '05', field: 'gpaDeg', value: 9 });
  const entries = log().filter(e => e.op === 'SetParApproach');
  assert.equal(entries.length, 6);
  assert.equal(entries[0].actingPositionId, 'PAR');
  assert.equal(entries[0].runwayStatusFacilityId, 'INCIRLIK');
  assert.equal(entries[0].at, 5_000);
  assert.equal(entries.at(-1).ok, false);
  assert.equal(entries.at(-1).reason, 'VALIDATION_ERROR');
});

test('refusals: an end with no PAR approach, an unknown field, a value out of range; nothing changes', () => {
  const { store } = freshStore();
  let r = set(store, 'PAR', { runwayEnd: '17', field: 'gpaDeg', value: 3 });
  assert.equal(r.reason, 'NOT_FOUND');
  assert.match(r.detail, /no PAR approach to runway 17/);
  r = set(store, 'PAR', { runwayEnd: '05', field: 'courseTrueDeg', value: 60 });
  assert.equal(r.reason, 'VALIDATION_ERROR');
  r = set(store, 'PAR', { runwayEnd: '05', field: 'gpaDeg', value: 4 });
  assert.equal(r.reason, 'VALIDATION_ERROR');
  assert.match(r.detail, /2\.5 to 3\.5/);
  r = set(store, 'PAR', { runwayEnd: '_comment', field: 'gpaDeg', value: 3 });
  assert.equal(r.reason, 'NOT_FOUND');
  assert.deepEqual(store.parValues('INCIRLIK'), {});
  const none = freshStore({ config: fixtureConfig({ parApproaches: undefined }) }).store;
  assert.equal(set(none, 'PAR', { runwayEnd: '05', field: 'gpaDeg', value: 3 }).reason, 'NOT_FOUND');
});

test('the mission reset keeps them (field data, not traffic)', () => {
  const { store } = freshStore();
  set(store, 'PAR', { runwayEnd: '05', field: 'tchFt', value: 55 });
  store.apply({ facilityId: 'INCIRLIK', op: { kind: 'CloseRunway', runwayId: '05/23' } }, 'LC', 'c-LC');
  assert.deepEqual(store.resetForMission(), ['INCIRLIK'], 'the closure is cleared');
  assert.deepEqual(store.parValues('INCIRLIK'), { '05': { tchFt: 55 } });
  const { store: quiet } = freshStore();
  set(quiet, 'PAR', { runwayEnd: '05', field: 'tchFt', value: 55 });
  assert.deepEqual(quiet.resetForMission(), [], 'set PAR values alone are nothing for the reset to clear');
});

test('snapshot/restore round-trips them; an end no longer configured or a value now out of range is dropped; an unknown field stops start-up', () => {
  const { store } = freshStore();
  set(store, 'PAR', { runwayEnd: '05', field: 'gpaDeg', value: 2.9 });
  set(store, 'PAR', { runwayEnd: '23', field: 'tdzeFt', value: 240 });
  const snap = JSON.parse(JSON.stringify(store.snapshot()));
  checkPersistedShape({ runwayStatuses: snap }, 'board.json');
  const { store: reborn } = freshStore();
  reborn.restore(snap);
  assert.deepEqual(reborn.parValues('INCIRLIK'), { '05': { gpaDeg: 2.9 }, '23': { tdzeFt: 240 } });

  const only05 = structuredClone(INCIRLIK.parApproaches);
  delete only05['23'];
  const { store: fewer } = freshStore({ config: fixtureConfig({ parApproaches: only05 }) });
  const odd = structuredClone(snap);
  odd[0].parValues['05'].dhFt = 5000;
  fewer.restore(odd);
  assert.deepEqual(fewer.parValues('INCIRLIK'), { '05': { gpaDeg: 2.9 } });

  const bad = structuredClone(snap);
  bad[0].parValues['05'].glideslope = 3;
  assert.throws(() => freshStore().store.restore(bad), /unknown PAR approach value "glideslope"/);
});

// ── the wire ───────────────────────────────────────────────────────────────

const { createEfsp } = await import('../src/efsp/index.js');
const { crew } = await import('./helpers/efsp-scenario.mjs');

test('efsp-runway-status-mutation SetParApproach: PAR\'s session acks and every client gets the record on the runway-status delta; it persists', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { PAR: 'INCIRLIK', AP: 'INCIRLIK' });
  const send = (member, positionId, op) => efsp.handleMessage(member.session, {
    version: 1, type: 'efsp-runway-status-mutation', clientMutationId: `pv-${Math.random()}`,
    facilityId: 'INCIRLIK', actingPositionId: positionId, op,
  });
  const seq = efsp.runwayStatusStore.currentSeq;
  let out = send(c.PAR, 'PAR', { kind: 'SetParApproach', runwayEnd: '05', field: 'gpaDeg', value: 3.1 });
  assert.equal(out.ack.type, 'efsp-runway-status-ack');
  assert.equal(out.ack.ok, true, JSON.stringify(out.ack));
  assert.equal(slot(out, 'primary').type, 'efsp-runway-status-delta');
  assert.equal(slot(out, 'primary').runwayStatusSeq, seq + 1);
  assert.deepEqual(slot(out, 'primary').runwayStatuses.updated[0].parValues, { '05': { gpaDeg: 3.1 } });
  out = send(c.AP, 'AP', { kind: 'SetParApproach', runwayEnd: '05', field: 'gpaDeg', value: 3.2 });
  assert.equal(out.ack.reason, 'PERMISSION_DENIED');
  out = send(c.AP, 'PAR', { kind: 'SetParApproach', runwayEnd: '05', field: 'gpaDeg', value: 3.2 });
  assert.equal(out.ack.reason, 'NOT_HOLDING_POSITION', 'AP\'s controller naming PAR without holding it');
  const reborn = createEfsp();
  assert.deepEqual(reborn.runwayStatusStore.parValues('INCIRLIK'), { '05': { gpaDeg: 3.1 } });
});
