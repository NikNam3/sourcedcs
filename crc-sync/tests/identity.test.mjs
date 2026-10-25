import { test } from 'node:test';
import assert from 'node:assert/strict';

// docs/adr/0059 — who a contact is, the same for every controller.
const { Identity } = await import('../src/surveillance/identity.js');
const { TrackNumbers } = await import('../src/surveillance/track-numbers.js');

function setup({ correlations = [], flightDataList = {}, tags = {} } = {}) {
  const records = correlations;
  const identity = new Identity({
    correlationStore: { trackIndex: () => new Map(records.map(r => [r.trackId, { flightDataId: r.flightDataId, state: r.state }])) },
    flightDataStore: { getFlightData: (id) => flightDataList[id] || null },
    collab: { get: (id) => (tags[id] ? { rename: { value: tags[id] } } : null) },
    trackNumbers: new TrackNumbers(),
  });
  identity.indexTick();
  return { identity, records };
}
const FDR = { f1: { identity: { callsign: 'VIPER11', aircraftType: 'F16' } } };

test('a correlated contact is its flight', () => {
  const { identity } = setup({ correlations: [{ trackId: '1', flightDataId: 'f1', state: 'CORRELATED' }], flightDataList: FDR });
  const who = identity.identify(1);
  assert.equal(who.flightDataCallsign, 'VIPER11');
  assert.equal(who.flightDataType, 'F16');
  assert.equal(who.correlation, 'CORRELATED');
  assert.equal(identity.labelFor(1), 'VIPER11');
});

test('only a CORRELATED record names a contact (there is no provisional state, docs/adr/0142)', () => {
  const { identity } = setup({ correlations: [{ trackId: '1', flightDataId: 'f1', state: 'UNCORRELATED' }], flightDataList: FDR });
  assert.equal(identity.identify('1').correlation, null);
  assert.equal(identity.identify('1').flightDataCallsign, null);
});

test("the flight's callsign beats a controller's tag; the tag names what nothing else does", () => {
  const { identity } = setup({
    correlations: [{ trackId: '1', flightDataId: 'f1', state: 'CORRELATED' }], flightDataList: FDR,
    tags: { 1: 'BANDIT', 2: 'TANKER' },
  });
  assert.equal(identity.labelFor('1'), 'VIPER11');
  assert.equal(identity.identify('1').tag, 'BANDIT', 'the tag is still there for when the correlation goes');
  assert.equal(identity.labelFor('2'), 'TANKER');
});

test('an ambiguous or uncorrelated record names nobody; every contact has a track number', () => {
  const { identity } = setup({ correlations: [{ trackId: '1', flightDataId: 'f1', state: 'AMBIGUOUS_BEACON' }], flightDataList: FDR });
  const who = identity.identify('1');
  assert.equal(who.flightDataCallsign, null);
  assert.match(who.trackNumber, /^TN\d{5}$/);
  assert.equal(identity.labelFor('1'), who.trackNumber);
  assert.equal(identity.identify('1').trackNumber, who.trackNumber, 'stable');
});

test('a correlation made after the index was built shows on the next tick', () => {
  const { identity, records } = setup({ flightDataList: FDR });
  assert.equal(identity.identify('1').flightDataCallsign, null);
  records.push({ trackId: '1', flightDataId: 'f1', state: 'CORRELATED' });
  identity.indexTick();
  assert.equal(identity.identify('1').flightDataCallsign, 'VIPER11');
});

test('track numbers: sequential, released when the contact leaves, reset on reload', () => {
  const tn = new TrackNumbers();
  assert.equal(tn.get('a'), 'TN00001');
  assert.equal(tn.get('b'), 'TN00002');
  assert.equal(tn.get('a'), 'TN00001');
  tn.retain(new Set(['b']));
  assert.equal(tn.get('a'), 'TN00003', 'a contact that left and came back is a new track');
  tn.clear();
  assert.equal(tn.get('z'), 'TN00001');
});
