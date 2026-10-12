import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import crypto from 'crypto';
import { prologue } from './helpers/control-release-fixture.mjs';
import crcLog from '../src/log.js';

// B3 for the six stores besides the Board (docs/wip/STORE-THROWS.md; board-op-throws.test.mjs is the Board's). An op that
// throws AFTER it wrote answers INTERNAL_ERROR (not VALIDATION_ERROR), is audited as a partial line, is persisted, and
// its delta is broadcast, so memory, disk, the audit log and every client agree. The throw is injected by making the
// store's sync-seq `advance` (called when a record is written) run and then throw.

prologue('store-op-throws-');
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify({ Test: [
  { airspaceId: 'MOA-THR', name: 'Throw MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 },
] }));
const { createEfsp } = await import('../src/efsp/index.js');
const helpers = await import('./helpers/efsp-scenario.mjs');

const STAFFED = { OPS: 'INCIRLIK', AP: 'INCIRLIK', LC: 'INCIRLIK', CTR: 'CENTER', CV_PRIFLY: 'CARRIER' };
const fresh = () => {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  const efsp = createEfsp({ currentTheater: () => 'Test' });
  return { efsp, c: helpers.crew(efsp, STAFFED) };
};
const msgOf = (type, member, fields) => ({ version: 1, type, clientMutationId: crypto.randomUUID(), facilityId: member.facilityId, ...fields });

/** Inject the throw, send, and return { reply, msg }. `getStore` is the store whose write is followed by the throw. */
function sendThrowing(efsp, store, member, msg) {
  const real = store._sync.advance;
  store._sync.advance = function (...a) { const r = real.apply(this, a); throw new Error('boom after the write'); };
  const cap = crcLog.capture();
  try { return efsp.handleMessage(member.session, msg); } finally { store._sync.advance = real; cap.stop(); }
}

function assertPartial({ efsp, store, msg, reply, seq0, slot, view, auditField }) {
  assert.equal(reply.ack.ok, false);
  assert.equal(reply.ack.reason, 'INTERNAL_ERROR');
  assert.ok(store.currentSeq > seq0, 'the write happened (the premise)');
  // audited: one partial line
  const entries = efsp.mutationLog.readAll().filter(e => e.clientMutationId === msg.clientMutationId);
  assert.equal(entries.length, 1, 'one audit line');
  assert.equal(entries[0].partial, true);
  assert.equal(entries[0].outcome, 'INTERNAL_ERROR');
  assert.equal(entries[0].reason, 'INTERNAL_ERROR');
  assert.equal(entries[0].ok, false);
  assert.match(entries[0].error, /boom after the write/);
  assert.ok(entries[0].after, 'the line carries what is in the store now');
  if (auditField) auditField(entries[0]);
  // broadcast
  assert.ok(reply.broadcasts.length >= 1, 'what it wrote is broadcast');
  if (slot) assert.ok(reply.broadcasts.slots.includes(slot), `a ${slot} frame`);
  // persisted: a second instance restored from disk holds the written state
  const restored = createEfsp({ currentTheater: () => 'Test' });
  assert.deepEqual(view(restored), view(efsp), 'the snapshot on disk matches memory');
  // a retry is answered from the replay cache, the op does not run twice
  const seq1 = store.currentSeq;
  const retry = efsp.handleMessage(msg.__session, msg);
  assert.equal(retry.ack.reason, 'INTERNAL_ERROR');
  assert.equal(store.currentSeq, seq1);
}

function run(name, setup) {
  test(`B3 ${name}: a throw after a write is INTERNAL_ERROR, audited, persisted and broadcast`, () => {
    const { efsp, c } = fresh();
    const { store, member, msg, slot, view, auditField } = setup(efsp, c);
    Object.defineProperty(msg, '__session', { value: member.session, enumerable: false });
    const seq0 = store.currentSeq;
    const reply = sendThrowing(efsp, store, member, msg);
    assertPartial({ efsp, store, msg, reply, seq0, slot, view, auditField });
  });
}

function flight(efsp, c, callsign) {
  return helpers.mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...helpers.DEPARTURE_FLIGHT_DATA, callsign },
  });
}

run('correlation', (efsp, c) => {
  const strip = flight(efsp, c, 'THR1');
  return {
    store: efsp.correlationStore, member: c.OPS,
    msg: msgOf('efsp-correlation-mutation', c.OPS, { flightDataId: strip.flightDataId, actingPositionId: 'OPS', op: { kind: 'BindTrack', trackId: '42' } }),
    // The track id is volatile and nulled on restore (correlation-store.js), so the revision is what is compared.
    view: (e) => e.correlationStore.getCorrelation(strip.flightDataId).rev,
  };
});

run('MARSA', (efsp, c) => {
  const a = flight(efsp, c, 'THR2'); const b = flight(efsp, c, 'THR3');
  return {
    store: efsp.marsaStore, member: c.OPS, slot: 'marsa',
    msg: msgOf('efsp-marsa-mutation', c.OPS, {
      actingPositionId: 'OPS',
      op: { kind: 'DeclareMarsa', participants: [a.flightDataId, b.flightDataId], startEvent: 'TANKER_ACCEPTED', endCondition: 'VERTICALLY_POSITIONED', declaringCallsign: 'THR2' },
    }),
    view: (e) => e.marsaStore.getAll(),
  };
});

run('airspace', (efsp, c) => {
  const rec = efsp.airspaceStore.getAirspace('MOA-THR');
  return {
    store: efsp.airspaceStore, member: c.CTR, slot: 'primary',
    msg: msgOf('efsp-airspace-mutation', c.CTR, { airspaceId: 'MOA-THR', baseRev: rec.rev, actingPositionId: 'CTR', op: { kind: 'ScheduleAirspace', fromUtc: Date.now(), toUtc: Date.now() + 3600000 } }),
    view: (e) => e.airspaceStore.getAirspace('MOA-THR'),
    auditField: (line) => assert.equal(line.airspaceId, 'MOA-THR'),
  };
});

run('runway status', (efsp, c) => {
  const cur = efsp.runwayStatusStore.getRunwayStatus('INCIRLIK');
  return {
    store: efsp.runwayStatusStore, member: c.LC, slot: 'primary',
    msg: msgOf('efsp-runway-status-mutation', c.LC, { baseRev: cur.rev, actingPositionId: 'LC', op: { kind: 'CloseRunway', runwayId: cur.runways[0].runwayId, reason: 'test' } }),
    view: (e) => e.runwayStatusStore.getRunwayStatus('INCIRLIK'),
  };
});

run('carrier', (efsp, c) => ({
  store: efsp.carrierStore, member: c.CV_PRIFLY, slot: 'carrier',
  msg: msgOf('efsp-carrier-mutation', c.CV_PRIFLY, { actingPositionId: 'CV_PRIFLY', op: { kind: 'SetCarrierState', field: 'altimeter', value: 29.92 } }),
  view: (e) => e.carrierStore.getAll(),
}));

test('B3 a store throw before any write is a plain INTERNAL_ERROR: no partial audit line, no broadcast', () => {
  const { efsp, c } = fresh();
  const strip = flight(efsp, c, 'THR9');
  const store = efsp.correlationStore;
  const real = store._bind;
  store._bind = () => { throw new Error('before any write'); };
  const msg = msgOf('efsp-correlation-mutation', c.OPS, { flightDataId: strip.flightDataId, actingPositionId: 'OPS', op: { kind: 'BindTrack', trackId: '7' } });
  const cap = crcLog.capture();
  let reply;
  try { reply = efsp.handleMessage(c.OPS.session, msg); } finally { store._bind = real; cap.stop(); }
  assert.equal(reply.ack.reason, 'INTERNAL_ERROR');
  assert.equal(reply.broadcasts.length, 0);
  const [line] = efsp.mutationLog.readAll().filter(e => e.clientMutationId === msg.clientMutationId);
  assert.equal(line.reason, 'INTERNAL_ERROR');
  assert.equal(line.partial, undefined);
});
