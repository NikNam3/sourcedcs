import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* An SFA frequency Rack IS the flight's frequency (docs/adr/0117, sfa.js): a Strip on `ap-sfa`'s freq-2 is a flight on
 * 233.1. Anything else that rewrites the working frequency — an airspace approval (the briefing's small-items row,
 * S-ARCH-69), clearing it, Block 22 — must not leave the Strip on a Rack whose frequency the flight no longer has.
 * The Strip follows: onto the Rack of its new frequency when the pool has one, else to AP's ordinary Bay for its state. */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-sfa-follow-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER: 'carrier.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify({ Test: [
  // A range AP controls, on its own frequency (not in the SFA pool).
  { airspaceId: 'RANGE-SOUTH', name: 'South A/G Range', type: 'RESTRICTED', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', usingPositionId: 'SOUTH_RANGE', controlFrequencyMhz: 283.5 },
  // One whose working frequency happens to be an SFA pool frequency (freq-4, 235.1).
  { airspaceId: 'MOA-POOL', name: 'Pool MOA', type: 'MOA', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', workingFrequencyMhz: 235.1 },
] }));

const { createEfsp } = await import('../src/efsp/index.js');
const { freshEfsp, mustAct } = await import('./helpers/efsp-scenario.mjs');

const STAFFED = { OPS: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK', PAR: 'INCIRLIK' };
const fresh = () => freshEfsp(createEfsp, STAFFED, { currentTheater: () => 'Test' });
const board = (efsp) => efsp.boardStoreFor('INCIRLIK');
const reread = (efsp, s) => board(efsp).getStrip(s.stripId);
const freqOf = (efsp, s) => efsp.flightDataStore.getFlightData(s.flightDataId).comms.workingFrequencyMhz;
let n = 0;

/** An inbound ARRIVAL AP has filed on `rackId` of ap-sfa (so its frequency is that Rack's). */
function onSfa(efsp, c, rackId = 'freq-2') {
  const s = mustAct(efsp, c.AP, 'AP', null, {
    kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: `SFA${++n}`, aircraftType: 'F16', wakeCategory: 'M', originAirport: 'LTAG' },
  });
  return mustAct(efsp, c.AP, 'AP', s, { kind: 'MoveStrip', bayId: 'ap-sfa', rackId });
}

test('an airspace approval onto a frequency outside the pool takes the Strip off ap-sfa', () => {
  const { efsp, c } = fresh();
  const s = onSfa(efsp, c);
  assert.equal(freqOf(efsp, s), 233.1);
  const after = mustAct(efsp, c.AP, 'AP', s, { kind: 'ApproveAirspaceEntry', airspaceId: 'RANGE-SOUTH' });
  assert.equal(freqOf(efsp, after), 283.5);
  const now = reread(efsp, s);
  assert.equal(now.bayId, 'ap-inbound', 'no Strip is left on a frequency Rack it is no longer on');
  assert.equal(now.rackId, 'main');
  assert.equal(now.state, 'INBOUND');
  assert.equal(now.ownerPositionId, 'AP');
});

test('an airspace approval onto a pool frequency files the Strip on that frequency\'s Rack', () => {
  const { efsp, c } = fresh();
  const s = onSfa(efsp, c);
  mustAct(efsp, c.AP, 'AP', s, { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-POOL' });
  const now = reread(efsp, s);
  assert.equal(freqOf(efsp, now), 235.1);
  assert.deepEqual([now.bayId, now.rackId], ['ap-sfa', 'freq-4']);
});

test('an explicit frequency, clearing the entry and Block 22 follow the same rule', () => {
  const { efsp, c } = fresh();
  let s = onSfa(efsp, c);
  s = mustAct(efsp, c.AP, 'AP', s, { kind: 'ApproveAirspaceEntry', airspaceId: 'RANGE-SOUTH', frequencyMhz: 234.1 });
  assert.deepEqual([reread(efsp, s).bayId, reread(efsp, s).rackId], ['ap-sfa', 'freq-3'], 'an override onto freq-3');
  s = mustAct(efsp, c.AP, 'AP', reread(efsp, s), { kind: 'ClearAirspaceEntry' });
  assert.equal(freqOf(efsp, s), null);
  assert.deepEqual([reread(efsp, s).bayId, reread(efsp, s).rackId], ['ap-inbound', 'main'], 'no frequency: no SFA Rack');

  const t = onSfa(efsp, c, 'freq-1');
  mustAct(efsp, c.AP, 'AP', t, { kind: 'SetBlock', blockId: '22', value: '236.1' });
  assert.deepEqual([reread(efsp, t).bayId, reread(efsp, t).rackId], ['ap-sfa', 'freq-5']);
  mustAct(efsp, c.AP, 'AP', reread(efsp, t), { kind: 'SetBlock', blockId: '22', value: '300.0' });
  assert.deepEqual([reread(efsp, t).bayId, reread(efsp, t).rackId], ['ap-inbound', 'main']);
});

test('a Strip not on ap-sfa is not moved by a frequency change', () => {
  const { efsp, c } = fresh();
  const s = mustAct(efsp, c.AP, 'AP', null, {
    kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: 'PLAIN1', aircraftType: 'F16', wakeCategory: 'M', originAirport: 'LTAG' },
  });
  mustAct(efsp, c.AP, 'AP', s, { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-POOL' });
  assert.deepEqual([reread(efsp, s).bayId, reread(efsp, s).rackId], ['ap-inbound', 'main'], 'only a Strip on an SFA Rack follows');
});
