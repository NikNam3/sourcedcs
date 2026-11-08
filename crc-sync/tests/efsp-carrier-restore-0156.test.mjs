import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// docs/adr/0156: a Board snapshot written before the carrier flow (MARSHAL Strips, `caseIAngels` on the stack entries) still
// comes up: the retired carrier Strips are left out and their stack entries go with them; the rest of the Board is kept.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-carrier-restore-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json', CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json', CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER: 'carrier.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json', CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl', CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { createEfsp } = await import('../src/efsp/index.js');
const { freshEfsp, mustAct, recoveryCheckIn } = await import('./helpers/efsp-scenario.mjs');

test('an older snapshot: MARSHAL Strips are left out, their stack entries leave, caseIAngels is read as the assigned angels; other Strips stay', () => {
  const { efsp, c } = freshEfsp(createEfsp, { CV_MARSHAL: 'CARRIER', OPS: 'INCIRLIK' });
  const a = recoveryCheckIn(efsp, c, '301');
  const b = recoveryCheckIn(efsp, c, '302');
  const dep = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { callsign: 'VIPER11', aircraftType: 'F16C' } });
  mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', efsp.boardStoreFor('CARRIER').getStrip(b.stripId), { kind: 'SetBlock', blockId: 'C12', value: '5000' }); // persist
  const file = process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH;
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  // rewrite it as the 2.0.5 build wrote it
  for (const s of saved.boards.CARRIER.strips) if (s.stripId === a.stripId) { s.stripType = 'MARSHAL'; s.state = 'IN_STACK'; }
  for (const e of saved.carriers[0].stacks.MAIN.entries) if (e.flightDataId === b.flightDataId) e.caseIAngels = 9;
  fs.writeFileSync(file, JSON.stringify(saved));
  const again = createEfsp();
  assert.equal(again.boardStoreFor('CARRIER').getStrip(a.stripId), null, 'the MARSHAL Strip is left out');
  assert.ok(again.boardStoreFor('CARRIER').getStrip(b.stripId));
  assert.ok(again.boardStoreFor('INCIRLIK').getStrip(dep.stripId), 'the rest of the Board is kept');
  const entries = again.carrierStore.getRecord().stacks.MAIN.entries;
  assert.deepEqual(entries.map(e => e.flightDataId), [b.flightDataId], 'the left-out flight has left the stack');
  assert.equal(entries[0].angelsOverride, 9);
});
