import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// docs/adr/0128 (H151): transit through active SUA, walked through the real EFSP wiring (wire family, rights over the
// real Facility config, the store's live-Strip view, the facade's sweep and the mission reset).

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-transit-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);

fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify({ Test: [
  { airspaceId: 'MOA-TAC', name: 'Tac MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'TACTICAL', workingFrequencyMhz: 134.25 },
  { airspaceId: 'MOA-ATC', name: 'Atc MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 135.25 },
] }));

const { createEfsp } = await import('../src/efsp/index.js');
const { crew, airspaceAct, mustAirspaceAct, airborneDeparture, mustAct, DEPARTURE_FLIGHT_DATA } = await import('./helpers/efsp-scenario.mjs');

const STAFF = { OPS: 'INCIRLIK', AP: 'INCIRLIK', LC: 'INCIRLIK', CTR: 'CENTER', TAC_C2: 'TACTICAL' };
const WINDOW = () => ({ fromUtc: Date.now(), toUtc: Date.now() + 2 * 60 * 60 * 1000 });

function world() {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  const efsp = createEfsp({ currentTheater: () => 'Test' });
  const c = crew(efsp, STAFF);
  mustAirspaceAct(efsp, c.TAC_C2, 'TAC_C2', 'MOA-TAC', { kind: 'ScheduleAirspace', ...WINDOW() });
  mustAirspaceAct(efsp, c.TAC_C2, 'TAC_C2', 'MOA-TAC', { kind: 'RequestActivation' });
  mustAirspaceAct(efsp, c.CTR, 'CTR', 'MOA-TAC', { kind: 'ApproveActivation' });
  mustAirspaceAct(efsp, c.CTR, 'CTR', 'MOA-ATC', { kind: 'ScheduleAirspace', ...WINDOW() });
  mustAirspaceAct(efsp, c.CTR, 'CTR', 'MOA-ATC', { kind: 'ApproveActivation' });
  const strip = airborneDeparture(efsp, c);
  const r = efsp.flightDataStore.setClearance(strip.flightDataId, 'altitude', { value: '190' }, { by: 'c-AP' });
  assert.equal(r.ok, true, r.detail);
  return { efsp, c, strip };
}
const transit = (efsp, airspaceId, fd) => (efsp.airspaceStore.getAirspace(airspaceId).transits || []).find(t => t.flightDataId === fd) || null;

test('AP asks TAC_C2 for a transit of the MRU-worked MOA; CTR may not decide it; TAC_C2 approves; the delta goes to everyone', () => {
  const { efsp, c, strip } = world();
  const fd = strip.flightDataId;
  const ask = efsp.handleMessage(c.AP.session, { version: 1, type: 'efsp-airspace-mutation', clientMutationId: 'm1', airspaceId: 'MOA-TAC', actingPositionId: 'AP', op: { kind: 'RequestTransit', flightDataId: fd } });
  assert.equal(ask.ack.ok, true, JSON.stringify(ask.ack));
  const delta = [].concat(ask.broadcasts || []).find(m => m && m.type === 'efsp-airspace-delta');
  assert.equal(delta.airspaces.updated[0].transits[0].state, 'REQUESTED', 'the record goes to everyone with its transits');
  assert.equal(transit(efsp, 'MOA-TAC', fd).state, 'REQUESTED');
  assert.equal(airspaceAct(efsp, c.CTR, 'CTR', 'MOA-TAC', { kind: 'ApproveTransit', flightDataId: fd }).reason, 'PERMISSION_DENIED');
  assert.equal(airspaceAct(efsp, c.OPS, 'OPS', 'MOA-TAC', { kind: 'ApproveTransit', flightDataId: fd }).reason, 'PERMISSION_DENIED');
  mustAirspaceAct(efsp, c.TAC_C2, 'TAC_C2', 'MOA-TAC', { kind: 'ApproveTransit', flightDataId: fd });
  assert.equal(transit(efsp, 'MOA-TAC', fd).state, 'APPROVED');
  assert.equal(efsp.airspaceStore.approvedTransit('MOA-TAC', fd).decidedPositionId, 'TAC_C2');
  // no frequency change (unlike ApproveAirspaceEntry)
  assert.equal(efsp.flightDataStore.getFlightData(fd).comms.workingFrequencyMhz ?? null, null);
});

test('a VFR flight (nothing assigned) and a Position not holding the flight are refused', () => {
  const { efsp, c, strip } = world();
  assert.equal(airspaceAct(efsp, c.LC, 'LC', 'MOA-ATC', { kind: 'RequestTransit', flightDataId: strip.flightDataId }).reason, 'PERMISSION_DENIED');
  const vfrStrip = airborneDeparture(efsp, c, { ...DEPARTURE_FLIGHT_DATA, callsign: 'CESSNA1' }); // nothing assigned: VFR (vfr.js)
  const vfr = airspaceAct(efsp, c.AP, 'AP', 'MOA-ATC', { kind: 'RequestTransit', flightDataId: vfrStrip.flightDataId });
  assert.equal(vfr.reason, 'VALIDATION_ERROR');
  assert.match(vfr.detail, /VFR/);
});

test('the sweep ends a transit once the flight has no live Strip, with one airspace delta, and persists it', () => {
  const { efsp, c, strip } = world();
  mustAirspaceAct(efsp, c.AP, 'AP', 'MOA-ATC', { kind: 'RequestTransit', flightDataId: strip.flightDataId });
  assert.deepEqual(efsp.sweepTransits(), { ended: 0, messages: [] });
  mustAct(efsp, c.AP, 'AP', efsp.boardStoreFor('INCIRLIK').getStrip(strip.stripId), { kind: 'DropStrip' });
  const { ended, messages } = efsp.sweepTransits();
  assert.equal(ended, 1);
  assert.deepEqual(messages.map(m => [m.type, m.airspaces.updated.map(a => [a.airspaceId, a.transits.length])]), [['efsp-airspace-delta', [['MOA-ATC', 0]]]]);
  assert.equal(messages[0].airspaceSeq, efsp.airspaceStore.currentSeq);
  const saved = JSON.parse(fs.readFileSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, 'utf8'));
  assert.deepEqual(saved.airspaces.byTheater.Test.find(r => r.airspaceId === 'MOA-ATC').transits, []);
});

test('the mission reset ends every transit and sends the airspace delta', () => {
  const { efsp, c, strip } = world();
  mustAirspaceAct(efsp, c.AP, 'AP', 'MOA-ATC', { kind: 'RequestTransit', flightDataId: strip.flightDataId });
  mustAirspaceAct(efsp, c.AP, 'AP', 'MOA-TAC', { kind: 'RequestTransit', flightDataId: strip.flightDataId });
  const { frames, summary } = efsp.resetForMission({ seq: 2, reason: 'test' });
  assert.equal(summary.transitsEnded, 2);
  const airspaceFrames = frames.filter(f => f.type === 'efsp-airspace-delta');
  assert.equal(airspaceFrames.length, 2, 'one delta per record');
  assert.deepEqual(efsp.airspaceStore.getAll().flatMap(a => a.transits), []);
});

test('a restart restores the transits from the snapshot', () => {
  const { efsp, c, strip } = world();
  mustAirspaceAct(efsp, c.AP, 'AP', 'MOA-ATC', { kind: 'RequestTransit', flightDataId: strip.flightDataId });
  efsp.persist();
  const again = createEfsp({ currentTheater: () => 'Test' });
  assert.equal(transit(again, 'MOA-ATC', strip.flightDataId).state, 'REQUESTED');
});
