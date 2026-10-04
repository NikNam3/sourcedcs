/* The client's one Facility topology (efsp/facility-topology.js, ARCH-C #8) agrees with crc-sync's shipped Facility
   configs, and every client table that names a Facility derives it from that module. Reads config/ and the server
   source text, so it does not depend on facility-config.js's loading API. */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as topo from '../app/public/js/panels/efsp/facility-topology.js';
import { COORDINATION_TARGETS, CARRIER_HANDOFF_TARGET, TOFI_COUNTERPARTS } from '../app/public/js/panels/efsp/bay/authority-mirror.js';
import { FACILITY_POSITIONS as capsTable } from '../app/public/js/panels/efsp/airspace-capabilities.js';
import { readClient, readServer } from './helpers/mirror-source.mjs';

const CONFIG = path.join(import.meta.dirname, '../../crc-sync/config');
const shipped = fs.readdirSync(CONFIG).filter(f => /^efsp-facility-.*\.json$/.test(f))
  .map(f => JSON.parse(fs.readFileSync(path.join(CONFIG, f), 'utf8')));

test('FACILITY_POSITIONS is the shipped Facility configs\' Position sets, same order', () => {
  assert.deepEqual(topo.FACILITY_POSITIONS, Object.fromEntries(shipped.map(c => [c.facility, c.positions])));
  assert.deepEqual(Object.keys(topo.FACILITY_POSITIONS).sort(), shipped.map(c => c.facility).sort());
});

test('DEFAULT_FACILITY_ID is the server\'s, and is the first Facility listed', () => {
  const m = /^const DEFAULT_FACILITY_ID = '([A-Z]+)'/m.exec(readServer('efsp/facility-config.js'));
  assert.ok(m, 'facility-config.js no longer declares DEFAULT_FACILITY_ID; update the parity test');
  assert.equal(topo.DEFAULT_FACILITY_ID, m[1]);
  assert.equal(topo.shippedFacilityIds()[0], topo.DEFAULT_FACILITY_ID);
});

test('facilityOfPosition and positionsOf agree with the table; an unlisted Position is a RANGES one', () => {
  for (const c of shipped) for (const p of c.positions) assert.equal(topo.facilityOfPosition(p), c.facility);
  assert.equal(topo.facilityOfPosition('RNG1'), 'RANGES');
  assert.equal(topo.facilityOfPosition(null), null);
  assert.deepEqual(topo.positionsOf('RANGES'), []);
  assert.deepEqual(topo.allFacilityIds(), [...Object.keys(topo.FACILITY_POSITIONS), 'RANGES']);
});

test('the airspace capabilities module uses the same table, not a copy', () => {
  assert.equal(capsTable, topo.FACILITY_POSITIONS);
});

test('every coordination, carrier and TOFI target names the Facility its Position really belongs to', () => {
  const home = Object.fromEntries(shipped.flatMap(c => c.positions.map(p => [p, c.facility])));
  const all = [...Object.values(COORDINATION_TARGETS), CARRIER_HANDOFF_TARGET, ...Object.values(TOFI_COUNTERPARTS).flat()];
  assert.ok(all.length >= 5);
  for (const t of all) assert.equal(t.facilityId, home[t.positionId], `${t.positionId}`);
});

test('no client module outside the topology hard-codes a Facility id for a default or a fallback', () => {
  for (const f of ['panels/radar-panel.js', 'panels/metrics-panel.js', 'panels/efsp/efsp-ws.js', 'panels/efsp/ato-import.js']) {
    const src = readClient(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /'(INCIRLIK|TACTICAL|CENTER)'/, f);
  }
});
