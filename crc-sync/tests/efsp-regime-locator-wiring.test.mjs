import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

// docs/adr/0102 and the ARCH-S wiring finding: the TOFI regime locator is built INSIDE createEfsp from the track
// source it was given (`locateTrack`), never installed later; and a createEfsp with no track source says so loudly
// instead of answering "unknown" forever in silence.
const { createEfsp } = await import('../src/efsp/index.js');
const log = createRequire(import.meta.url)('../src/log.js');

function fileFlight(efsp) {
  const session = { controllerId: 'c-ops', who: 'OPS' };
  efsp.handleMessage(session, { type: 'efsp-set-positions', facilityId: 'INCIRLIK', signedOn: ['OPS'] });
  const { ack } = efsp.handleMessage(session, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'INCIRLIK', actingPositionId: 'OPS',
    op: { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main',
      flightData: { callsign: 'VIPER1', aircraftType: 'F16', wakeCategory: 'M', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: '250' } },
  });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  return ack.strip.flightDataId;
}

function bind(efsp, flightDataId, trackId) {
  const r = efsp.correlationStore.apply({ clientMutationId: crypto.randomUUID(), flightDataId, baseRev: 0, op: { kind: 'BindTrack', trackId } }, 'AP', 'c-ap');
  assert.equal(r.ok, true, JSON.stringify(r));
}

test('the locator answers from the injected track source: a correlated contact with a position is located', () => {
  const asked = [];
  const efsp = createEfsp({ locateTrack: (trackId) => { asked.push(trackId); return { lat: 37, lon: 35, altFt: 5000 }; } });
  const flightDataId = fileFlight(efsp);
  assert.deepEqual(efsp.regimeLocator(flightDataId, 'TACTICAL'), { located: false, inside: [], unknown: [] }, 'no correlated contact: unknown, never outside');
  bind(efsp, flightDataId, '101');
  assert.deepEqual(efsp.regimeLocator(flightDataId, 'TACTICAL'), { located: true, inside: [], unknown: [] });
  assert.deepEqual(asked, ['101']);
});

test('a track source that has no position for the contact leaves it unlocated', () => {
  const efsp = createEfsp({ locateTrack: () => null });
  const flightDataId = fileFlight(efsp);
  bind(efsp, flightDataId, '101');
  assert.equal(efsp.regimeLocator(flightDataId, 'TACTICAL').located, false);
});

test('with no locateTrack at all the first regime question logs an error, once, and answers unlocated', () => {
  const cap = log.capture();
  try {
    const efsp = createEfsp();
    assert.deepEqual(efsp.regimeLocator('fd-1', 'TACTICAL'), { located: false, inside: [], unknown: [] });
    efsp.regimeLocator('fd-2', 'TACTICAL');
    const hits = cap.records.filter(r => r.level === 'error' && /no locateTrack/.test(r.line));
    assert.equal(hits.length, 1, `expected one error line, got: ${cap.lines.join(' | ')}`);
  } finally { cap.stop(); }
});
