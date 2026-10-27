/* Which flights are VFR (crc-sync docs/adr/0146): the client's hand copy (panels/efsp/vfr.js) answers as
   crc-sync/src/efsp/vfr.js, which the airspace-entry alert and the transit rules read. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isVfrFlight, isVfrStrip, VFR_STRIP_TYPE } from '../app/public/js/panels/efsp/vfr.js';

const require = createRequire(import.meta.url);
const server = require('../../crc-sync/src/efsp/vfr.js');

const S = (stripType, state) => ({ stripType, state });
const CASES = [null, undefined, S('VFR', 'TRACKED'), S('VFR', 'DROPPED'), S('OVERFLIGHT', 'IN_SECTOR'), S('DEPARTURE', 'DEPARTED'), {}];

test('isVfrStrip / isVfrFlight: the client answers as crc-sync for every shape', () => {
  assert.equal(VFR_STRIP_TYPE, server.VFR_STRIP_TYPE);
  for (const s of CASES) assert.equal(isVfrStrip(s), server.isVfrStrip(s), JSON.stringify(s));
  for (const list of [[], null, [S('VFR', 'TRACKED')], [S('VFR', 'DROPPED'), S('ARRIVAL', 'INBOUND')], [S('ARRIVAL', 'INBOUND'), S('VFR', 'TRACKED')]]) {
    assert.equal(isVfrFlight(list), server.isVfrFlight(list), JSON.stringify(list));
  }
  assert.equal(isVfrFlight([S('VFR', 'TRACKED')]), true);
});
