import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* The runtime frequency table (docs/adr/0131, H154): controllers set the Position frequencies and the SFA pool at run
 * time, over the facility files' defaults, audited, persisted in state/efsp-frequencies.json, strict on restore. Every
 * consumer reads the effective value; an assignment already made is not rewritten. */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-frequency-table-'));
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
const { freshEfsp, mustAct } = await import('./helpers/efsp-scenario.mjs');
const { channelProblem, positionFrequencyProblem, sfaFrequencyProblem } = await import('../src/efsp/frequency-table.js');

const STAFFED = { GC: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK', PAR: 'INCIRLIK', CTR: 'CENTER' };
let fileN = 0;
const MISSION_NOW = Date.UTC(2026, 9, 17, 14, 30);
const clock = { now: () => MISSION_NOW, source: 'MISSION' };

/** A fresh EFSP on a fresh (or the given) frequency file. */
function fresh(file = path.join(tmpDir, `freq-${++fileN}.json`)) {
  process.env.CRCSYNC_EFSP_FREQUENCIES_PATH = file;
  fs.rmSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, { force: true });
  const { efsp, c } = freshEfsp(createEfsp, STAFFED, { clock });
  return { efsp, c, file };
}

let cmid = 0;
function setFreq(efsp, crewMember, positionId, op, facilityId = 'INCIRLIK') {
  return efsp.handleMessage(crewMember.session, { type: 'efsp-frequency-mutation', clientMutationId: `f-${++cmid}`, facilityId, actingPositionId: positionId, op });
}
const row = (efsp, pred, facilityId = 'INCIRLIK') => efsp.frequencyTable.rowsFor(facilityId).find(pred);
const gnd = (r) => r.positionId === 'GC' && r.label === 'GND';
const rack = (id) => (r) => r.rackId === id;
const logLines = () => fs.readFileSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l));

test('the channel rule: 25 kHz everywhere, 8.33 kHz channel names in the VHF airband', () => {
  assert.equal(channelProblem(275.8), null);
  assert.equal(channelProblem(251.025), null);
  assert.match(channelProblem(251.01), /25 kHz grid/);
  assert.equal(channelProblem(118.005), null);
  assert.equal(channelProblem(118.015), null);
  assert.match(channelProblem(118.02), /8\.33/);
  assert.match(channelProblem(251.0001), /whole kHz/);
  assert.match(positionFrequencyProblem(29), /30 to 400/);
  assert.match(sfaFrequencyProblem(140), /UHF/);
  assert.equal(sfaFrequencyProblem(240.25), null);
});

test('with no file every row is its default', () => {
  const { efsp, file } = fresh();
  assert.equal(fs.existsSync(file), false);
  const rows = efsp.frequencyTable.rowsFor('INCIRLIK');
  assert.deepEqual(rows.filter(r => r.kind === 'POSITION').map(r => [r.positionId, r.label, r.mhz, r.defaultMhz, r.setBy]),
    [['GC', 'GND', 275.8, 275.8, null], ['LC', 'TWR', 251, 251, null]]);
  assert.deepEqual(rows.filter(r => r.kind === 'SFA').map(r => [r.rackId, r.use, r.mhz]),
    [['freq-1', 'INITIAL_CONTACT', 232.1], ['freq-2', 'ROTATION', 233.1], ['freq-3', 'ROTATION', 234.1], ['freq-4', 'ROTATION', 235.1], ['freq-5', 'SPARE', 236.1]]);
  assert.deepEqual(efsp.frequencyTable.rowsFor('CENTER'), [], 'a Facility with no frequencies has no rows');
});

test('a Primary sets a Position frequency: the ack, the delta, the positions and the audit say it', () => {
  const { efsp, c, file } = fresh();
  const out = setFreq(efsp, c.GC, 'GC', { kind: 'SetFrequency', positionId: 'GC', label: 'GND', mhz: 275.925 });
  assert.equal(out.ack.type, 'efsp-frequency-ack');
  assert.equal(out.ack.ok, true, out.ack.detail);
  assert.equal(out.ack.facilityId, 'INCIRLIK');
  assert.deepEqual([out.ack.row.mhz, out.ack.row.defaultMhz, out.ack.row.setBy, out.ack.row.setAt], [275.925, 275.8, 'c-GC', MISSION_NOW]);
  assert.equal(out.broadcasts.length, 1);
  const delta = out.broadcasts[0];
  assert.equal(delta.type, 'efsp-frequency-delta');
  assert.equal(delta.facilityId, 'INCIRLIK');
  assert.equal(delta.frequencies.find(gnd).mhz, 275.925);
  // Every consumer reads the effective value.
  assert.deepEqual(efsp.positionStoreFor('INCIRLIK').frequenciesOf('GC'), [{ label: 'GND', mhz: 275.925 }]);
  assert.equal(efsp.facilityConfig.getPositionFrequencies('INCIRLIK').GC[0].mhz, 275.925);
  assert.equal(efsp.facilityConfig.getShippedPositionFrequencies('INCIRLIK').GC[0].mhz, 275.8, 'the default is untouched');
  // Persisted, only what differs from the default.
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved.facilities, { INCIRLIK: { positions: { GC: { GND: { mhz: 275.925, setAt: MISSION_NOW, setBy: 'c-GC' } } } } });
  // Audited: who, when on the mission clock, old -> new.
  const line = logLines().find(l => l.op === 'SetFrequency');
  assert.deepEqual([line.ok, line.actorId, line.actingPositionId, line.at, line.before, line.after, line.facilityId, line.positionId, line.label],
    [true, 'c-GC', 'GC', MISSION_NOW, 275.8, 275.925, 'INCIRLIK', 'GC', 'GND']);
});

test('any Primary may set any Facility\'s frequency; a session Primary nowhere may not', () => {
  const { efsp, c } = fresh();
  assert.equal(setFreq(efsp, c.CTR, 'CTR', { kind: 'SetFrequency', positionId: 'LC', label: 'TWR', mhz: 251.5 }).ack.ok, true, 'CTR at CENTER sets INCIRLIK TWR');
  const stranger = { session: { controllerId: 'nobody' } };
  const out = setFreq(efsp, stranger, 'LC', { kind: 'SetFrequency', positionId: 'LC', label: 'TWR', mhz: 252 });
  assert.equal(out.ack.ok, false);
  assert.equal(out.ack.reason, 'NOT_HOLDING_POSITION');
  assert.equal(out.broadcasts.length, 0);
  assert.equal(row(efsp, r => r.label === 'TWR').mhz, 251.5);
});

test('setting the default back, or ResetFrequency, removes the entry', () => {
  const { efsp, c, file } = fresh();
  setFreq(efsp, c.GC, 'GC', { kind: 'SetFrequency', positionId: 'GC', label: 'GND', mhz: 276 });
  setFreq(efsp, c.LC, 'LC', { kind: 'SetFrequency', positionId: 'LC', label: 'TWR', mhz: 252 });
  const back = setFreq(efsp, c.GC, 'GC', { kind: 'SetFrequency', positionId: 'GC', label: 'GND', mhz: 275.8 });
  assert.equal(back.ack.ok, true);
  assert.deepEqual([back.ack.row.mhz, back.ack.row.setBy, back.ack.row.setAt], [275.8, null, null]);
  const reset = setFreq(efsp, c.LC, 'LC', { kind: 'ResetFrequency', positionId: 'LC', label: 'TWR' });
  assert.equal(reset.ack.ok, true);
  assert.equal(reset.ack.row.mhz, 251);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).facilities, {});
  const unchanged = setFreq(efsp, c.LC, 'LC', { kind: 'ResetFrequency', positionId: 'LC', label: 'TWR' });
  assert.deepEqual([unchanged.ack.ok, unchanged.ack.changed], [true, false]);
});

test('refusals: unknown row, off-grid, out of range, unknown op kind', () => {
  const { efsp, c } = fresh();
  const cases = [
    [{ kind: 'SetFrequency', positionId: 'GC', label: 'ATIS', mhz: 270 }, 'NOT_FOUND'],
    [{ kind: 'SetFrequency', rackId: 'freq-9', mhz: 240 }, 'NOT_FOUND'],
    [{ kind: 'SetFrequency', positionId: 'GC', label: 'GND', mhz: 275.81 }, 'VALIDATION_ERROR'],
    [{ kind: 'SetFrequency', positionId: 'GC', label: 'GND', mhz: 500 }, 'VALIDATION_ERROR'],
    [{ kind: 'SetFrequency', positionId: 'GC', label: 'GND', mhz: '275.9' }, 'VALIDATION_ERROR'],
    [{ kind: 'SetFrequency', rackId: 'freq-2', mhz: 127.5 }, 'VALIDATION_ERROR'],
    [{ kind: 'SetFrequency', rackId: 'freq-2', mhz: 234.1 }, 'VALIDATION_ERROR'], // freq-3's
    [{ kind: 'Delete', positionId: 'GC', label: 'GND' }, 'VALIDATION_ERROR'],
  ];
  for (const [op, reason] of cases) {
    const out = setFreq(efsp, c.AP, 'AP', op);
    assert.equal(out.ack.ok, false, JSON.stringify(op));
    assert.equal(out.ack.reason, reason, `${JSON.stringify(op)}: ${out.ack.detail}`);
  }
  assert.equal(logLines().filter(l => l.op && l.ok === false).length, cases.length, 'refusals reaching the table are audited');
});

test('an SFA frequency: the Bay\'s pool and the Rack it assigns follow the table', () => {
  const { efsp, c } = fresh();
  const out = setFreq(efsp, c.AP, 'AP', { kind: 'SetFrequency', rackId: 'freq-2', mhz: 240.25 });
  assert.equal(out.ack.ok, true, out.ack.detail);
  assert.equal(out.broadcasts[0].frequencies.find(rack('freq-2')).mhz, 240.25);
  const bay = efsp.facilityConfig.getAllBays('INCIRLIK').find(b => b.view === 'sfa-freqs');
  assert.equal(bay.sfaPool.find(p => p.rackId === 'freq-2').mhz, 240.25);
  assert.equal(efsp.facilityConfig.getShippedSingleFrequencyApproach('INCIRLIK').pool[1].mhz, 233.1);
  // Filing an arrival on freq-2 now assigns 240.250.
  const s = mustAct(efsp, c.AP, 'AP', null, { kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: 'SFA1', aircraftType: 'F16', wakeCategory: 'M', originAirport: 'LTAG' } });
  const moved = mustAct(efsp, c.AP, 'AP', s, { kind: 'MoveStrip', bayId: 'ap-sfa', rackId: 'freq-2' });
  assert.equal(efsp.flightDataStore.getFlightData(moved.flightDataId).comms.workingFrequencyMhz, 240.25);
});

test('an SFA frequency with a flight on it cannot change; a Position frequency change leaves assignments alone', () => {
  const { efsp, c } = fresh();
  const s = mustAct(efsp, c.AP, 'AP', null, { kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: 'SFA2', aircraftType: 'F16', wakeCategory: 'M', originAirport: 'LTAG' } });
  const onRack = mustAct(efsp, c.AP, 'AP', s, { kind: 'MoveStrip', bayId: 'ap-sfa', rackId: 'freq-3' });
  const refused = setFreq(efsp, c.AP, 'AP', { kind: 'SetFrequency', rackId: 'freq-3', mhz: 241 });
  assert.equal(refused.ack.ok, false);
  assert.equal(refused.ack.reason, 'FREQUENCY_IN_USE');
  assert.match(refused.ack.detail, /234\.100/);
  // Another Rack is free to change, and the Strip on freq-3 keeps 234.1.
  assert.equal(setFreq(efsp, c.AP, 'AP', { kind: 'SetFrequency', rackId: 'freq-5', mhz: 241 }).ack.ok, true);
  // A Block 22 frequency equal to the TWR frequency is a fact on the flight: changing TWR does not touch it.
  mustAct(efsp, c.AP, 'AP', efsp.boardStoreFor('INCIRLIK').getStrip(onRack.stripId), { kind: 'SetBlock', blockId: '22', value: '251.000' });
  setFreq(efsp, c.LC, 'LC', { kind: 'SetFrequency', positionId: 'LC', label: 'TWR', mhz: 252 });
  assert.equal(efsp.flightDataStore.getFlightData(onRack.flightDataId).comms.workingFrequencyMhz, 251);
});

test('the snapshot carries the table, and a restart restores it', () => {
  const first = fresh();
  setFreq(first.efsp, first.c.GC, 'GC', { kind: 'SetFrequency', positionId: 'GC', label: 'GND', mhz: 276.1 });
  setFreq(first.efsp, first.c.AP, 'AP', { kind: 'SetFrequency', rackId: 'freq-1', mhz: 242 });
  const snap = first.efsp.snapshotFor();
  assert.equal(snap.frequencies.find(r => r.facilityId === 'INCIRLIK' && gnd(r)).mhz, 276.1);
  assert.equal(snap.positions.find(p => p.positionId === 'GC').frequencies[0].mhz, 276.1);
  assert.equal(snap.bays.find(b => b.view === 'sfa-freqs').sfaPool[0].mhz, 242);

  const again = fresh(first.file);
  assert.equal(row(again.efsp, gnd).mhz, 276.1);
  assert.equal(row(again.efsp, gnd).setBy, 'c-GC');
  assert.equal(row(again.efsp, rack('freq-1')).mhz, 242);
  assert.equal(again.efsp.positionStoreFor('INCIRLIK').frequenciesOf('GC')[0].mhz, 276.1);
});

test('the file is strict: each wrong file stops start-up naming it', () => {
  const entry = { mhz: 276, setAt: 1, setBy: 'x' };
  const bad = [
    ['not json', '{', /not valid JSON/],
    ['unknown top key', { facilities: {}, version: 2 }, /unknown key "version"/],
    ['unknown entry key', { facilities: { INCIRLIK: { positions: { GC: { GND: { ...entry, note: 'x' } } } } } }, /unknown key "facilities.INCIRLIK.positions.GC.GND.note"/],
    ['unknown Facility', { facilities: { NOWHERE: {} } }, /Facility NOWHERE/],
    ['unknown label', { facilities: { INCIRLIK: { positions: { GC: { ATIS: entry } } } } }, /GC ATIS/],
    ['unknown Rack', { facilities: { INCIRLIK: { sfa: { 'freq-9': { ...entry, mhz: 240 } } } } }, /freq-9/],
    ['off-grid', { facilities: { INCIRLIK: { positions: { GC: { GND: { ...entry, mhz: 276.01 } } } } } }, /25 kHz/],
    ['SFA duplicate', { facilities: { INCIRLIK: { sfa: { 'freq-1': { ...entry, mhz: 233.1 } } } } }, /233\.1 MHz twice/],
  ];
  for (const [what, body, pattern] of bad) {
    const file = path.join(tmpDir, `bad-${++fileN}.json`);
    fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
    process.env.CRCSYNC_EFSP_FREQUENCIES_PATH = file;
    assert.throws(() => createEfsp({ clock }), (e) => e.message.includes(file) && pattern.test(e.message), what);
  }
});
