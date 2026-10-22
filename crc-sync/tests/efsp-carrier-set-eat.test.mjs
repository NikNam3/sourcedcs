import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// SetEat (docs/adr/0137, live test U22): the Marshal assigns one holding flight an EAT by hand (CV NATOPS 6.4.2 item 6, 6.4.4:
// marshal control ASSIGNS the EAT; 6.4.5: one minute apart "unless weather or operating circumstances dictate otherwise"). The
// assigned EAT wins over the slot's until cleared, Delta moves it too, two flights never share a minute (6.4.9), it is marked until
// passed, and it goes when the flight commences.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-set-eat-'));
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
const { freshEfsp, mustAct, carrierAct, mustCarrierAct } = await import('./helpers/efsp-scenario.mjs');
const ms = await import('../src/efsp/carrier/marshal-stack.js');

const STAFFED = { CV_MARSHAL: 'CARRIER', CV_PRIFLY: 'CARRIER', CV_APP1: 'CARRIER', CV_APP2: 'CARRIER' };
const fresh = () => freshEfsp(createEfsp, STAFFED);
const MIN = 60_000;
const hhmm = (t) => { const d = new Date(t); return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0'); };
const derived = (efsp) => efsp.carrierStore.view().derived.MAIN;
const of = (efsp, fd) => derived(efsp).find((e) => e.flightDataId === fd);
const entry = (efsp, fd) => efsp.carrierStore.getRecord().stacks.MAIN.entries.find((e) => e.flightDataId === fd);

function checkIn(efsp, c, callsign) {
  return mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', null, {
    kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'MARSHAL', flightData: { callsign, aircraftType: 'F-18C' },
  });
}
function recovery() {
  const { efsp, c } = fresh();
  const a = checkIn(efsp, c, 'AAA11');
  const b = checkIn(efsp, c, 'BBB22');
  mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCarrierState', field: 'rampTime', value: hhmm(Date.now() + 30 * MIN) });
  return { efsp, c, a, b };
}
const setEat = (efsp, c, fd, eat, who = 'CV_MARSHAL') => carrierAct(efsp, c[who], who, { kind: 'SetEat', flightDataId: fd, eat }).ack;

test('an assigned EAT wins over the slot\'s, is shown set, is marked until passed, and clearing it gives the slot\'s back', () => {
  const { efsp, c, a, b } = recovery();
  const slotEat = of(efsp, b.flightDataId).pushTimeUtc;
  const wanted = slotEat + 5 * MIN;
  const ack = setEat(efsp, c, b.flightDataId, hhmm(wanted));
  assert.equal(ack.ok, true, JSON.stringify(ack));
  const d = of(efsp, b.flightDataId);
  assert.deepEqual([d.pushTimeUtc, d.eatSet, d.unpassed], [wanted, true, ['eat']]);
  assert.equal(of(efsp, a.flightDataId).eatSet, undefined, 'the other flight keeps its slot\'s EAT');
  assert.equal(entry(efsp, b.flightDataId).eatOverrideUtc, wanted);
  // the same value again is no change
  assert.equal(setEat(efsp, c, b.flightDataId, hhmm(wanted)).ok, true);
  // cleared: the slot's EAT, and the key is gone from the stored entry
  assert.equal(setEat(efsp, c, b.flightDataId, '').ok, true);
  assert.equal(of(efsp, b.flightDataId).pushTimeUtc, slotEat);
  assert.equal('eatOverrideUtc' in entry(efsp, b.flightDataId), false);
});

test('only the Marshal assigns it, never in Case I, never a time that is not HHMM, never another flight\'s minute (NATOPS 6.4.9)', () => {
  const { efsp, c, a, b } = recovery();
  assert.equal(setEat(efsp, c, b.flightDataId, '2359', 'CV_APP1').reason, 'PERMISSION_DENIED');
  assert.equal(setEat(efsp, c, b.flightDataId, '2359', 'CV_PRIFLY').reason, 'PERMISSION_DENIED');
  assert.match(setEat(efsp, c, b.flightDataId, '25:99').detail, /HHMM/);
  assert.match(setEat(efsp, c, b.flightDataId, hhmm(of(efsp, a.flightDataId).pushTimeUtc)).detail, /6\.4\.9/);
  mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCarrierState', field: 'case', value: 'I' });
  assert.match(setEat(efsp, c, b.flightDataId, '2359').detail, /Case I/);
});

test('Delta moves an assigned EAT with every other holding EAT; a new ramp time leaves it; Commence records it and clears it', () => {
  const { efsp, c, a, b } = recovery();
  const wanted = of(efsp, b.flightDataId).pushTimeUtc + 7 * MIN;
  assert.equal(setEat(efsp, c, b.flightDataId, hhmm(wanted)).ok, true);
  mustCarrierAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', { kind: 'Delta', minutes: 4 });
  assert.equal(of(efsp, b.flightDataId).pushTimeUtc, wanted + 4 * MIN);
  mustCarrierAct(efsp, c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCarrierState', field: 'rampTime', value: hhmm(Date.now() + 40 * MIN) });
  assert.equal(of(efsp, b.flightDataId).pushTimeUtc, wanted + 4 * MIN, 'the Marshal\'s EAT is the Marshal\'s until cleared');
  void a;
  const strip = efsp.boardStoreFor('CARRIER').getAll().find((s) => s.flightDataId === b.flightDataId && s.state !== 'DROPPED');
  mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', strip, { kind: 'CarrierHandoff', transfer: 'MARSHAL_TO_APPROACH', toPositionId: 'CV_APP2' });
  const e = entry(efsp, b.flightDataId);
  assert.deepEqual([e.status, e.eatUtc, 'eatOverrideUtc' in e], ['PUSHED', wanted + 4 * MIN, false]);
});

test('the pure op: a commenced flight has no EAT to assign; a restore keeps an assigned EAT only on a holding flight', () => {
  const s = { stackId: 'MAIN', hullId: null, deltaMs: 0, entries: [
    { flightDataId: 'a', stackIndex: 0, status: 'PUSHED', caseIAngels: null, pushedAtUtc: 1, eatUtc: 1, unpassed: [] },
    { flightDataId: 'b', stackIndex: 1, status: 'HOLDING', caseIAngels: null, pushedAtUtc: null, eatUtc: null, unpassed: [] },
  ] };
  assert.match(ms.setEat(s, { flightDataId: 'a', eatUtc: 5 * MIN }).detail, /commenced/);
  assert.equal(ms.setEat(s, { flightDataId: 'b', eatUtc: 5 * MIN }).stack.entries[1].eatOverrideUtc, 5 * MIN);
  const raw = { ...s, entries: [{ ...s.entries[0], eatOverrideUtc: 9 }, { ...s.entries[1], eatOverrideUtc: 9 * MIN }] };
  const n = ms.normalizeStack(raw).stack;
  assert.deepEqual(n.entries.map((e) => e.eatOverrideUtc), [undefined, 9 * MIN]);
  assert.match(ms.validateStack(raw).detail, /pushed has no EAT/);
});
