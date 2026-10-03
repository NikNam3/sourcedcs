import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { prologue, makeWorld, exchange } from './helpers/control-release-fixture.mjs';

// B4 (docs/wip/SERVER-BUGS.md): the mutation ack carries `warnings: [{ code, detail? }]`; the singular `warning` is gone;
// a replay answers with the same list.

prologue('mutation-warnings-');
const { createEfsp } = await import('../src/efsp/index.js');
const helpers = await import('./helpers/efsp-scenario.mjs');

test('B4 the ack lists every warning as { code, detail }, has no singular `warning`, and a replay repeats the list', () => {
  const w = makeWorld(createEfsp, helpers);
  const ex = exchange(w, helpers, 'B4WARN');
  const t = ex.T();
  const msg = {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'CENTER', actingPositionId: 'CTR',
    stripId: t.stripId, baseRev: t.rev, op: { kind: 'DropStrip' },
  };
  const first = w.efsp.handleMessage(w.c.CTR.session, msg).ack;
  assert.equal(first.ok, true);
  assert.equal('warning' in first, false);
  assert.equal(first.warnings.length, 1);
  assert.equal(first.warnings[0].code, 'COMMS_MOVED_BY_DROP');
  assert.match(first.warnings[0].detail, /communications moved to AP by the drop/);
  const again = w.efsp.handleMessage(w.c.CTR.session, msg).ack;
  assert.equal(again.ok, true);
  assert.deepEqual(again.warnings, first.warnings);
});

test('B4 an ack with nothing to say has no `warnings` key', () => {
  const w = makeWorld(createEfsp, helpers);
  const ex = exchange(w, helpers, 'B4NONE', { accept: false });
  const t = ex.T();
  const ack = w.efsp.handleMessage(w.c.CTR.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'CENTER', actingPositionId: 'CTR',
    stripId: t.stripId, baseRev: t.rev, op: { kind: 'SetBlock', blockId: '7', value: '240' },
  }).ack;
  assert.equal(ack.ok, true);
  assert.equal('warnings' in ack, false);
});
