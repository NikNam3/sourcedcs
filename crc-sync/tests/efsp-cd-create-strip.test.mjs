import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { withPaths } from './helpers/with-paths.mjs';

// state-paths.js reads CRCSYNC_STATE_DIR at module load: a temp dir before any import.
withPaths('efsp-cd-create-strip-test-', {}, { stateDir: true }).apply();

// H164 FT-Q2 a: Clearance Delivery originates a DEPARTURE Strip (a pilot calls for a clearance with nothing on file at
// OPS). It starts in PENDING_CLEARANCE in CD's own Bay, which CD works; PROPOSED stays OPS's.
const { createEfsp } = await import('../src/efsp/index.js');

const FILED = { aircraftType: 'F16', wakeCategory: 'M', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: 'FL250' };

function as(efsp, positionId) {
  const session = { controllerId: `c-${positionId}`, who: positionId };
  efsp.handleMessage(session, { type: 'efsp-set-positions', facilityId: 'INCIRLIK', signedOn: [positionId] });
  return (strip, op) => efsp.handleMessage(session, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'INCIRLIK', actingPositionId: positionId,
    stripId: strip ? strip.stripId : undefined, baseRev: strip ? strip.rev : undefined, op,
  }).ack;
}

test('CD creates a DEPARTURE in PENDING_CLEARANCE in its own Bay, and clears it', () => {
  const efsp = createEfsp();
  const cd = as(efsp, 'CD');
  const ack = cd(null, { kind: 'CreateStrip', bayId: 'cd-pending-clearance', rackId: 'main', stripType: 'DEPARTURE', initialState: 'PENDING_CLEARANCE', flightData: { callsign: 'VPR7', ...FILED } });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(ack.strip.ownerPositionId, 'CD');
  assert.equal(ack.strip.state, 'PENDING_CLEARANCE');
  assert.equal(ack.strip.stripType, 'DEPARTURE');
  const next = cd(ack.strip, { kind: 'InvokeNla' });
  assert.equal(next.ok, true, JSON.stringify(next));
  assert.equal(next.strip.state, 'CLEARED');
});

test('CD originates no ARRIVAL or OVERFLIGHT; GC and LC still create nothing', () => {
  const efsp = createEfsp();
  const cd = as(efsp, 'CD');
  for (const stripType of ['ARRIVAL', 'OVERFLIGHT']) {
    const ack = cd(null, { kind: 'CreateStrip', bayId: 'cd-pending-clearance', rackId: 'main', stripType, flightData: { callsign: 'VPR8', ...FILED } });
    assert.equal(ack.ok, false, stripType);
    assert.equal(ack.reason, 'PERMISSION_DENIED', stripType);
  }
  for (const id of ['GC', 'LC']) {
    const ack = as(efsp, id)(null, { kind: 'CreateStrip', bayId: 'cd-pending-clearance', rackId: 'main', stripType: 'DEPARTURE', flightData: { callsign: 'VPR9', ...FILED } });
    assert.equal(ack.ok, false, id);
  }
});

test('a Strip created in a Bay that implies a state starts in it, when its strip type has that state', () => {
  const efsp = createEfsp();
  const cd = as(efsp, 'CD');
  const ack = cd(null, { kind: 'CreateStrip', bayId: 'cd-pending-clearance', rackId: 'main', stripType: 'DEPARTURE', flightData: { callsign: 'VPR6', ...FILED } });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(ack.strip.state, 'PENDING_CLEARANCE', 'no initialState sent: the Bay decides, not the DEPARTURE default PROPOSED');
  const ops = as(efsp, 'OPS')(null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { callsign: 'VPR5', ...FILED } });
  assert.equal(ops.strip.state, 'PROPOSED');
});
