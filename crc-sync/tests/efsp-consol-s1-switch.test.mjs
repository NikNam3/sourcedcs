import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Supervisor item S1 (docs/parallel/next/CONSOL-BUILD.md, decisions.md S-ARCH-25): "GC on an offer list, so a hand-off into an
// empty GC is delivered there and offered" is undecided with the human. It is a config edit, not code: a Facility whose
// `consolidation` has no GC entry keeps ADR 0105's behaviour (an NLA into an empty GC is inhibited, a transfer refused).
// This file runs the real server on a copy of the shipped Incirlik config with GC's line removed (the "no" edit).

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-consol-s1-'));
const shipped = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../config/efsp-facility-incirlik.json'), 'utf8'));
delete shipped.consolidation.GC;
fs.writeFileSync(path.join(tmpDir, 'incirlik.json'), JSON.stringify(shipped));
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
const { crew, hold, act, mustAct, DEPARTURE_FLIGHT_DATA } = await import('./helpers/efsp-scenario.mjs');

test('S1 "no": with no GC entry in consolidation an empty GC has nobody to offer, a hand-off into it is refused and CD still reaches LC', () => {
  const efsp = createEfsp({ currentTheater: () => 'Test' });
  const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', LC: 'INCIRLIK' });
  const positions = efsp.positionStoreFor('INCIRLIK');
  assert.equal(positions.consolidatedAt('GC'), null, 'GC has no list');
  assert.equal(positions.consolidatedAt('PAR'), null, 'AP is not signed on');
  // CD -> GC (CLEARED -> PUSHBACK) into the empty GC is inhibited / refused
  let s = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: 'S1NO' } });
  const refused = act(efsp, c.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: 'GC', bayId: 'gc-coordination', rackId: 'main' });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'NO_RECEIVING_POSITION');
  // and a GC that leaves with Strips has nobody to offer them to (offeredTo null) even with LC staffed
  const gc = crew(efsp, { GC: 'INCIRLIK' });
  s = mustAct(efsp, c.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: 'GC', bayId: 'gc-coordination', rackId: 'main' });
  const left = hold(efsp, gc.GC.session, 'INCIRLIK', []);
  assert.deepEqual(left.ack.warnings, [{ positionId: 'GC', count: 1, offeredTo: null }]);
});
