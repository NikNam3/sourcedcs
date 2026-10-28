/* H164 FT-Q2 a: Clearance Delivery originates a DEPARTURE. The + New Strip bar offers CD an origin in its own Bay, in
 * PENDING_CLEARANCE (PROPOSED is OPS's state), and GC/LC still get none. The server side is crc-sync's
 * efsp-cd-create-strip.test.mjs. */

import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/client-env.mjs';

const ws = await import('../app/public/js/panels/efsp/efsp-ws.js');
const { _availableCreateStripOrigins } = await import('../app/public/js/panels/efsp/panel/create-strip.js');

test('CD signed on: the bar offers CD · Departure in cd-pending-clearance, starting PENDING_CLEARANCE', () => {
  ws.sendEfspSetPositions('INCIRLIK', ['CD']);
  const origins = _availableCreateStripOrigins();
  assert.deepEqual(origins.map(o => o.label), ['CD · Departure']);
  const [o] = origins;
  assert.equal(o.actingPositionId, 'CD');
  assert.equal(o.bayId, 'cd-pending-clearance');
  assert.equal(o.stripType || 'DEPARTURE', 'DEPARTURE');
  assert.equal(o.initialState, 'PENDING_CLEARANCE');
});

test('GC or LC alone: nothing to create', () => {
  for (const id of ['GC', 'LC']) {
    ws.sendEfspSetPositions('INCIRLIK', [id]);
    assert.deepEqual(_availableCreateStripOrigins(), [], id);
  }
});
