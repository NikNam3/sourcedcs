import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// docs/adr/0087 — a Board saved before the guide's four overflight states
// holds TRANSITING Strips; they come back IN_SECTOR, once.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-ovf-mig-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const { createEfsp } = await import('../src/efsp/index.js');
const { migrateOverflightStates } = await import('../src/efsp/overflight-migration.js');
const { crew, mustAct } = await import('./helpers/efsp-scenario.mjs');

test('migrateOverflightStates maps TRANSITING to IN_SECTOR, only for OVERFLIGHT, and a second run is a no-op', () => {
  const strips = [
    { role: 'OVERFLIGHT', state: 'TRANSITING' }, { role: 'OVERFLIGHT', state: 'DROPPED' },
    { role: 'OVERFLIGHT', state: 'INBOUND' }, { role: 'ARRIVAL', state: 'INBOUND' }, { role: 'DEPARTURE', state: 'TRANSITING' },
  ];
  assert.equal(migrateOverflightStates(strips), 1);
  assert.deepEqual(strips.map(s => s.state), ['IN_SECTOR', 'DROPPED', 'INBOUND', 'INBOUND', 'TRANSITING']);
  assert.equal(migrateOverflightStates(strips), 0);
});

test('a persisted Board holding a TRANSITING Strip restores it IN_SECTOR, and restoring again changes nothing', () => {
  const first = createEfsp();
  const c = crew(first, { CTR: 'CENTER' });
  const strip = mustAct(first, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-overflight', rackId: 'main', role: 'OVERFLIGHT',
    fdr: { callsign: 'OLD1', aircraftType: 'A320', wakeCategory: 'M', originAirport: 'LTBA', destinationAirport: 'OJAI' },
  });
  const file = process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH;
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  const saved = body.boards.CENTER.strips.find(s => s.stripId === strip.stripId);
  assert.equal(saved.state, 'INBOUND');
  saved.state = 'TRANSITING'; // what the old build wrote
  fs.writeFileSync(file, JSON.stringify(body));

  const second = createEfsp();
  assert.equal(second.boardStoreFor('CENTER').getStrip(strip.stripId).state, 'IN_SECTOR');
  const again = createEfsp();
  assert.equal(again.boardStoreFor('CENTER').getStrip(strip.stripId).state, 'IN_SECTOR');
});
