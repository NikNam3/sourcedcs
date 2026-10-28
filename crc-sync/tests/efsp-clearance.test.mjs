import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { withPaths, FACILITIES, BOARD, MUTATION_LOG, AIRSPACES } from './helpers/with-paths.mjs';

// docs/adr/0058 — the flight's assigned altitude and heading, on the flight data.

const paths = withPaths('efsp-clearance-test-', { ...FACILITIES, ...BOARD, ...MUTATION_LOG, ...AIRSPACES }).apply();
const tmpDir = paths.dir;
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify({}));

const { createEfsp } = await import('../src/efsp/index.js');
const { FlightDataStore, parseAltitudeFt, parseHeadingDeg } = await import('../src/efsp/flight-data-store.js');
const { computeDueObligations } = await import('../src/efsp/forwarding-obligations.js');

function crew(efsp, spec) {
  const out = {};
  for (const [positionId, facilityId] of Object.entries(spec)) {
    const session = { controllerId: `c-${positionId}`, who: positionId };
    efsp.handleMessage(session, { type: 'efsp-set-positions', facilityId, signedOn: [positionId] });
    out[positionId] = { session, facilityId };
  }
  return out;
}
function act(efsp, member, positionId, strip, op) {
  return efsp.handleMessage(member.session, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: member.facilityId, actingPositionId: positionId,
    stripId: strip ? strip.stripId : undefined, baseRev: strip ? strip.rev : undefined, op,
  }).ack;
}
function mustAct(efsp, member, positionId, strip, op) {
  const ack = act(efsp, member, positionId, strip, op);
  assert.equal(ack.ok, true, `${op.kind} as ${positionId}: ${JSON.stringify(ack)}`);
  return ack.strip;
}
const FILED = { aircraftType: 'F16', wakeCategory: 'M', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: 'FL250' };
const active = (cell) => cell.entries.find(e => e.status === 'ACTIVE');

test('altitudes and headings parse the way a strip writes them', () => {
  assert.equal(parseAltitudeFt('FL180'), 18000);
  assert.equal(parseAltitudeFt('050'), 5000);
  assert.equal(parseAltitudeFt('A050'), 5000);
  assert.equal(parseAltitudeFt('5000'), 5000);
  assert.equal(parseAltitudeFt('climb'), null);
  assert.equal(parseHeadingDeg('050'), 50);
  assert.equal(parseHeadingDeg('000'), 360);
  assert.equal(parseHeadingDeg('361'), null);
});

test('setClearance keeps §3.7 history, confirms vacated only on altitude, and refuses nonsense', () => {
  const store = new FlightDataStore();
  const flightData = store.createFlightData({ callsign: 'VPR1', ...FILED }, { by: 'test' }).flightData;
  assert.equal(store.setClearance(flightData.flightDataId, 'altitude', { value: '050' }, { by: 'cd' }).ok, true);
  assert.equal(store.setClearance(flightData.flightDataId, 'altitude', { value: 'FL180' }, { by: 'app' }).ok, true);
  const cell = store.getFlightData(flightData.flightDataId).clearance.altitude;
  assert.deepEqual(cell.entries.map(e => [e.value, e.status, e.parsed]), [['050', 'SUPERSEDED', 5000], ['FL180', 'ACTIVE', 18000]]);

  assert.equal(store.setClearance(flightData.flightDataId, 'altitude', { confirmVacated: true }).ok, true);
  assert.equal(cell.entries[1].status, 'STRUCK');
  assert.equal(store.setClearance(flightData.flightDataId, 'heading', { confirmVacated: true }).ok, false, 'a heading is never vacated');
  const refused = store.setClearance(flightData.flightDataId, 'altitude', { value: 'climb' });
  assert.equal(refused.ok, false);
  assert.match(refused.detail, /FL180/, 'the refusal says how to write it');
  // Clearing a heading ("resume own navigation") is an amendment like any other.
  store.setClearance(flightData.flightDataId, 'heading', { value: '270' });
  store.setClearance(flightData.flightDataId, 'heading', { value: '' });
  assert.equal(active(store.getFlightData(flightData.flightDataId).clearance.heading).value, '');
});

test('what AP assigns is on CTR\'s copy of the flight — one clearance, not one per Strip', () => {
  const efsp = createEfsp();
  const c = crew(efsp, { OPS: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER' });
  let strip = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { callsign: 'VPR2', ...FILED } });
  strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'SetState', toState: 'HANDED_OFF' });
  strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'TransferStrip', toPositionId: 'AP', bayId: 'ap-departures', rackId: 'main' });
  strip = mustAct(efsp, c.AP, 'AP', strip, { kind: 'SetBlock', blockId: '21', value: 'FL180' });
  strip = mustAct(efsp, c.AP, 'AP', strip, { kind: 'SetBlock', blockId: '20', value: '090' });
  const proposed = mustAct(efsp, c.AP, 'AP', strip, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' });
  const replica = efsp.boardStoreFor('CENTER').getStrip(proposed.coordination.peerStripId);
  const flightData = efsp.flightDataStore.getFlightData(replica.flightDataId);
  assert.equal(replica.flightDataId, strip.flightDataId);
  assert.equal(active(flightData.clearance.altitude).value, 'FL180');
  assert.equal(active(flightData.clearance.heading).value, '090');
  assert.equal(replica.annotations['21'], undefined, 'nothing is stored on the Strip');
});

test('issuing a clearance altitude is not a flight-plan amendment — no AMENDMENT_INSIDE_30MIN', () => {
  const store = new FlightDataStore();
  const flightData = store.createFlightData({ callsign: 'VPR3', ...FILED, proposedDepartureTimeUtc: Date.now() + 10 * 60 * 1000 }, { by: 'test' }).flightData;
  flightData.updatedAt = Date.now() - 5 * 60 * 1000; // filed a while ago
  store.setClearance(flightData.flightDataId, 'altitude', { value: '050' }, { by: 'cd' });
  const strip = { stripId: 's', flightDataId: flightData.flightDataId, stripType: 'DEPARTURE', state: 'CLEARED', coordination: null };
  const due = computeDueObligations(strip, store.getFlightData(flightData.flightDataId), Date.now());
  assert.equal(due.some(o => o.obligationType === 'AMENDMENT_INSIDE_30MIN'), false);
});

