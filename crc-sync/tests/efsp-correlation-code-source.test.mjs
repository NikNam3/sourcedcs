import test from 'node:test';
import assert from 'node:assert/strict';

/* T12 (live test 2026-10-11): a Strip with Block 5 = 0003 stayed NO TRK while a
 * contact's label read 0003. These pin that the label and the correlation
 * beacon rung read ONE source for a contact's code, from the SRS message to
 * the wire: srs-client.js -> Transponders#transponderOf -> presentTrack's
 * `ssr.code` (what track-label.js prints) and, wired exactly as
 * app/monitors.js wires it, the reconciler's `beaconOf`. Stubbed SRS input, no
 * socket, no gRPC.
 */

const SrsClient = (await import('../src/srs-client.js')).default;
const { Transponders } = await import('../src/surveillance/transponder.js');
const { loadSensorSpecs } = await import('../src/radars.js');
const { presentTrack } = await import('../src/surveillance/presentation.js');
const { DEFAULT_OWN_COALITION: OWN } = await import('../src/surveillance/iff.js');
const { CorrelationReconciler } = await import('../src/efsp/correlation-reconciler.js');
const { CorrelationStore } = await import('../src/efsp/correlation-store.js');
const { CodeAllocator } = await import('../src/efsp/code-allocator.js');

const HOSTILE = OWN === 3 ? 2 : 3;
const SSR_RADAR = { caps: { height: false, ssr: true, mode4: false }, sweepMs: 3000, at: 1000 };
const NOBODY = { flightDataId: null, correlation: null, flightDataCallsign: null, flightDataType: null, tag: null, trackNumber: 'TN00001' };
const ENV = { weather: {}, transitionAltFt: 18000 };

function rig() {
  const srs = new SrsClient(); // never connected: messages go straight to _handleMsg
  const transponders = new Transponders({ srs, config: loadSensorSpecs().transponder, ownCoalition: OWN });
  // app/monitors.js's beaconOf, verbatim.
  const beaconOf = (t) => { const x = transponders.transponderOf(t); return x ? x.code : null; };
  const labelCode = (t) => {
    const wire = presentTrack(t, {
      at: 1000, radars: [SSR_RADAR], dl: null, who: NOBODY, mode4: false, iffOverride: null,
      transponder: transponders.transponderOf(t), env: ENV, missionData: null,
    });
    return wire.ssr ? wire.ssr.code : null;
  };
  return { srs, transponders, beaconOf, labelCode };
}

function jet(id, over = {}) {
  return { id, callsign: 'Enfield11', category: 1, coalition: OWN, player: null, lat: 37, lon: 35, alt: 3000, ...over };
}

/** One tick of the real reconciler over one Strip (Block 5 = `assigned`) and the given contacts. */
function correlate(beaconOf, tracks, assigned) {
  const flightDataList = [{ flightDataId: 'f1', identity: { callsign: 'HAWG1', beaconAssigned: assigned } }];
  const store = new CorrelationStore({ flightDataExists: (id) => id === 'f1' });
  const reconciler = new CorrelationReconciler({
    beaconOf,
    trackStore: { getAll: () => tracks },
    flightDataStore: { getAll: () => flightDataList, getFlightData: (id) => flightDataList.find(f => f.flightDataId === id) || null, setBeaconObserved: () => ({ ok: true }) },
    correlationStore: store,
    boardStoreFor: () => ({ getAll: () => [{ stripId: 's1', flightDataId: 'f1', state: 'INBOUND' }] }),
    facilityConfig: { getFacilityIds: () => ['CENTER'] },
  });
  reconciler.tick();
  return store.getCorrelation('f1');
}

// Every shape an SRS client has been seen to send a squawk of 0003 in.
const SQUAWK_0003 = [
  ['IFF block, mode3 a number', { Name: 'Maverick', RadioInfo: { IFF: { mode3: 3, status: 1 } } }],
  ['IFF block, mode3 a zero-padded string', { Name: 'Maverick', RadioInfo: { IFF: { mode3: '0003', status: 1 } } }],
  ['IFF block, PascalCase keys', { Name: 'Maverick', RadioInfo: { IFF: { Mode3: 3, Status: 1 } } }],
  ['lowercase iff block', { Name: 'Maverick', RadioInfo: { iff: { mode3: 3, status: 1 } } }],
  ['legacy top-level Transponder block', { Name: 'Maverick', Transponder: { Mode3: 3 } }],
];

for (const [shape, client] of SQUAWK_0003) {
  test(`a player squawking 0003 over SRS (${shape}): the label and the beacon rung both see 0003, and Block 5 0003 correlates`, () => {
    const { srs, beaconOf, labelCode } = rig();
    srs._handleMsg({ MsgType: 3, Client: client });
    const t = jet(1, { player: 'Maverick' });
    assert.equal(labelCode(t), '0003');
    assert.equal(beaconOf(t), '0003');
    const rec = correlate(beaconOf, [t], '0003');
    assert.equal(rec.state, 'CORRELATED');
    assert.equal(rec.matchedBy, 'BEACON');
    assert.equal(rec.trackId, '1');
  });
}

test('a player whose transponder is off, or set to SRS\'s "no code" -1, shows no code and is not acquired by one', () => {
  const { srs, beaconOf, labelCode } = rig();
  srs._handleMsg({ MsgType: 3, Client: { Name: 'Off', RadioInfo: { IFF: { mode3: 3, status: 0 } } } });
  srs._handleMsg({ MsgType: 3, Client: { Name: 'NoCode', RadioInfo: { IFF: { mode3: -1, status: 1 } } } });
  for (const t of [jet(1, { player: 'Off' }), jet(2, { player: 'NoCode' })]) {
    assert.equal(labelCode(t), null);
    assert.equal(beaconOf(t), null);
  }
});

test('a player SRS does not know by that name shows no code, and the beacon rung sees none either', () => {
  // SRS keys by its own client name; when it differs from the DCS player name, neither side gets a code.
  const { srs, beaconOf, labelCode } = rig();
  srs._handleMsg({ MsgType: 3, Client: { Name: 'Mav (SRS)', RadioInfo: { IFF: { mode3: 3, status: 1 } } } });
  const t = jet(1, { player: 'Maverick' });
  assert.equal(labelCode(t), null);
  assert.equal(beaconOf(t), null);
});

test('an own AI aircraft: the label and the beacon rung see the same synthetic 6xxx code', () => {
  const { beaconOf, labelCode } = rig();
  const t = jet(5);
  const code = beaconOf(t);
  assert.match(code, /^6[0-7]{3}$/);
  assert.equal(labelCode(t), code);
  // It matches a flight data carrying exactly that code ...
  assert.equal(correlate(beaconOf, [t], code).matchedBy, 'BEACON');
  // ... which Block 5 can never hold: the block is the AI's, so an AI contact is
  // acquired by callsign or a binding, never by an assigned code.
  assert.equal(new CodeAllocator().validateAssignment(code, 'f1').ok, false);
  assert.equal(correlate(beaconOf, [t], '0003').state, 'UNCORRELATED');
});

test('a hostile AI aircraft squawks nothing: no code on the label, none for the beacon rung', () => {
  const { beaconOf, labelCode } = rig();
  const t = jet(6, { coalition: HOSTILE });
  assert.equal(labelCode(t), null);
  assert.equal(beaconOf(t), null);
});
