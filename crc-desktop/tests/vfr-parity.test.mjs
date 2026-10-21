/* VFR the FAA way (crc-sync H136 VQ2): the client's hand copy (panels/efsp/vfr.js) answers as crc-sync/src/efsp/vfr.js,
   which the airspace-entry alert reads (crc-sync docs/adr/0119). */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { hasNoClearance } from '../app/public/js/panels/efsp/vfr.js';

const require = createRequire(import.meta.url);
const server = require('../../crc-sync/src/efsp/vfr.js');

const cell = (...statuses) => ({ entries: statuses.map(status => ({ status, parsed: 100 })) });
const CASES = [
  null, undefined, {}, { clearance: null }, { clearance: {} },
  { clearance: { altitude: cell(), heading: cell() } },
  { clearance: { altitude: cell('ACTIVE'), heading: cell() } },
  { clearance: { altitude: cell(), heading: cell('ACTIVE') } },
  { clearance: { altitude: cell('SUPERSEDED'), heading: cell('CANCELLED') } },
  { clearance: { altitude: cell('SUPERSEDED', 'ACTIVE') } },
  { clearance: { altitude: { entries: null } } },
  // S-ARCH-76: a cleared assignment (setClearance's empty value) is no clearance.
  { clearance: { altitude: { entries: [{ status: 'ACTIVE', value: '', parsed: null, block: null }] } } },
  { clearance: { heading: { entries: [{ status: 'SUPERSEDED', value: '090', parsed: 90 }, { status: 'ACTIVE', value: ' ', parsed: null }] } } },
  { clearance: { altitude: { entries: [{ status: 'ACTIVE', value: 'FL220-FL240', parsed: null, block: { lowFt: 22000, highFt: 24000 } }] } } },
  { clearance: { altitude: { entries: [{ status: 'ACTIVE' }] } } },
];

test('hasNoClearance: the client answers as crc-sync for every shape', () => {
  for (const fd of CASES) assert.equal(hasNoClearance(fd), server.hasNoClearance(fd), JSON.stringify(fd));
  assert.equal(hasNoClearance(CASES[5]), true);
  assert.equal(hasNoClearance(CASES[6]), false);
  assert.equal(hasNoClearance(CASES[11]), true);
  assert.equal(hasNoClearance(CASES[12]), true);
  assert.equal(hasNoClearance(CASES[13]), false);
  assert.equal(hasNoClearance(CASES[14]), true);
});
