import { test } from 'node:test';
import assert from 'node:assert/strict';

/* Guide §9.5 (docs/adr/0069): hung ordnance is an ADVISORY on runway assignment
 * and a routing constraint toward the hot cargo pad — the pure function alone.
 * The sortie is walked in efsp-scenario-ordnance.test.mjs.
 */

const { hungOrdnanceAdvisoryFor, buildStatusView } = await import('../src/efsp/field-state.js');
const nla = await import('../src/efsp/nla.js');

/** A field-state record in the shape field-state-store.js getFieldState puts on the wire. */
function record({ pad = 'Hot cargo pad', activeRunway = '05', status = 'OPEN', facilityId = 'INCIRLIK' } = {}) {
  return {
    facilityId,
    rev: 3,
    activeRunway,
    activeRunwaySource: 'WIND',
    runways: [{
      runwayId: '05/23', ends: ['05', '23'], endHeadingsTrue: { '05': 56, '23': 236 },
      rackIds: { '05': 'rwy-05', '23': 'rwy-23' }, status, arrestingGear: [],
      suspension: null, closure: null, lastInspection: null, pendingRequest: null,
    }],
    runwayChange: null,
    hotCargoPad: pad === null ? { occupied: false, occupantFdrId: null } : { name: pad, occupied: false, occupantFdrId: null },
    alertPad: { name: 'Alert pad', occupied: false, occupantFdrId: null },
    runwayChangeInProgress: false,
  };
}

const fdrWith = (ordnanceState, over = {}) => ({
  identity: { callsign: 'VIPER11', beaconAssigned: '4001' },
  filed: { route: 'DCT', requestedAltitude: '250', departureAirport: 'LTAG', destinationAirport: 'LTAG', departureRunway: null, ...over.filed },
  assigned: { releaseState: 'RELEASED', landingRunway: null, ...over.assigned },
  military: { ordnanceState, hookRequired: false },
});

const arrival = (over = {}) => ({ stripId: 's1', fdrId: 'f1', facilityId: 'INCIRLIK', role: 'ARRIVAL', state: 'HANDED_TO_TOWER', rackId: 'main', ...over });
const departure = (over = {}) => ({ stripId: 's2', fdrId: 'f2', facilityId: 'INCIRLIK', role: 'DEPARTURE', state: 'TAXI', rackId: 'main', ...over });

// H21: the advisory states the fact and recommends no runway. A small list of
// the ways a recommendation gets phrased; the reason must contain none of them.
const RECOMMENDS = /\b(use runway|prefer|preferred|recommend|closer|closest|nearer|nearest|should land|best runway|expect runway)\b/i;

test('CLEAN, LOADED and EXPENDED produce no advisory', () => {
  for (const state of ['CLEAN', 'LOADED', 'EXPENDED']) {
    assert.equal(hungOrdnanceAdvisoryFor(arrival(), fdrWith(state), record()), null, state);
    assert.equal(hungOrdnanceAdvisoryFor(departure(), fdrWith(state), record()), null, state);
  }
  assert.equal(hungOrdnanceAdvisoryFor(arrival(), { identity: {} }, record()), null, 'no military block');
  assert.equal(hungOrdnanceAdvisoryFor(arrival(), null, record()), null, 'no FDR (archived, S-R2-13)');
});

test('HUNG on an ARRIVAL names the hot cargo pad and the resolved runway, and recommends none', () => {
  const a = hungOrdnanceAdvisoryFor(arrival(), fdrWith('HUNG'), record());
  assert.deepEqual(a, {
    kind: 'HUNG_ORDNANCE', runway: '05/23', end: '05', runwaySource: 'ACTIVE_RUNWAY', padName: 'Hot cargo pad',
    text: 'HUNG',
    reason: 'Hung ordnance. SOURCE practice: after landing, taxi to Hot cargo pad; the runway is the controller\'s call. Runway 05/23 (05) assigned.',
  });
  assert.doesNotMatch(a.reason, RECOMMENDS);
  assert.doesNotMatch(a.reason, /kunsan|faa|usaf/i, 'SOURCE practice, never cited as doctrine');
  // The runway it names is whatever the Strip resolves to — 8B over the active end (S-Q25).
  const b = hungOrdnanceAdvisoryFor(arrival(), fdrWith('HUNG', { assigned: { landingRunway: '23' } }), record());
  assert.equal(b.end, '23');
  assert.equal(b.runwaySource, 'FDR');
  assert.match(b.reason, /Runway 05\/23 \(23\) assigned\.$/);
  assert.doesNotMatch(b.reason, RECOMMENDS);
  // A rack beats the FDR field.
  assert.equal(hungOrdnanceAdvisoryFor(arrival({ rackId: 'rwy-05' }), fdrWith('HUNG', { assigned: { landingRunway: '23' } }), record()).runwaySource, 'RACK');
});

test('HUNG with no runway resolved states the pad alone', () => {
  const a = hungOrdnanceAdvisoryFor(arrival(), fdrWith('HUNG'), record({ activeRunway: null }));
  assert.equal(a.runway, null);
  assert.equal(a.end, null);
  assert.equal(a.runwaySource, null);
  assert.equal(a.reason, 'Hung ordnance. SOURCE practice: after landing, taxi to Hot cargo pad; the runway is the controller\'s call.');
});

test('HUNG with no pad configured says so', () => {
  for (const pad of [null, '', '   ']) {
    const a = hungOrdnanceAdvisoryFor(arrival(), fdrWith('HUNG'), record({ pad }));
    assert.equal(a.padName, null, JSON.stringify(pad));
    assert.equal(a.reason, 'Hung ordnance. No hot cargo pad is configured at INCIRLIK (SOURCE practice). Runway 05/23 (05) assigned.');
  }
});

test('HUNG on a DEPARTURE says "if it returns" (an aborted sortie, Q1)', () => {
  const a = hungOrdnanceAdvisoryFor(departure(), fdrWith('HUNG'), record());
  assert.match(a.reason, /^Hung ordnance\. SOURCE practice: if it returns, taxi to Hot cargo pad;/);
  assert.doesNotMatch(a.reason, RECOMMENDS);
});

test('HUNG at a Facility with no field state returns null', () => {
  assert.equal(hungOrdnanceAdvisoryFor(arrival({ facilityId: 'CENTER' }), fdrWith('HUNG'), null), null);
  assert.equal(hungOrdnanceAdvisoryFor(arrival({ facilityId: 'CENTER' }), fdrWith('HUNG'), undefined), null);
});

test('OVERFLIGHT and MISSION never advise', () => {
  assert.equal(hungOrdnanceAdvisoryFor(arrival({ role: 'OVERFLIGHT', state: 'ACTIVE' }), fdrWith('HUNG'), record()), null);
  // A MISSION Strip shares the FDR with its ATC twin (docs/adr/0052): the twin carries the chip.
  assert.equal(hungOrdnanceAdvisoryFor(arrival({ role: 'MISSION', state: 'ON_STATION' }), fdrWith('HUNG'), record()), null);
});

test('DROPPED never advises', () => {
  assert.equal(hungOrdnanceAdvisoryFor(arrival({ state: 'DROPPED' }), fdrWith('HUNG'), record()), null);
  assert.equal(hungOrdnanceAdvisoryFor(departure({ state: 'DROPPED' }), fdrWith('HUNG'), record()), null);
});

test('the advisory is never an inhibit: NLA for a HUNG flight equals the same flight CLEAN', () => {
  const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
  const rec = record();
  const view = buildStatusView(rec, rec);
  const ctx = { isOccupied: () => true, coveringPositionFor: () => null, fieldStateFor: () => view };
  const cases = [
    [arrival({ state: 'HANDED_TO_TOWER' }), { assigned: { landingRunway: '05' } }],
    [arrival({ state: 'FINAL' }), { assigned: { landingRunway: '05' } }],
    [arrival({ state: 'LANDED' }), {}],
    [departure({ state: 'TAXI' }), { filed: { departureRunway: '05' } }],
    [departure({ state: 'RUNWAY_QUEUE', rackId: 'rwy-05' }), { filed: { departureRunway: '05' } }],
    [departure({ state: 'LUAW', rackId: 'rwy-05' }), { filed: { departureRunway: '05' } }],
  ];
  for (const [strip, over] of cases) {
    const hung = nla.computeNla(strip, fdrWith('HUNG', over), NOW, ctx);
    const clean = nla.computeNla(strip, fdrWith('CLEAN', over), NOW, ctx);
    assert.deepEqual(hung, clean, `${strip.role} ${strip.state}`);
    assert.equal(hung.inhibited, undefined, `${strip.role} ${strip.state} is not inhibited`);
    assert.ok(hungOrdnanceAdvisoryFor(strip, fdrWith('HUNG', over), rec), 'the advisory is live meanwhile');
  }
});

test('the function is pure: it never mutates its inputs', () => {
  const rec = record();
  const fdr = fdrWith('HUNG');
  const strip = arrival();
  const before = JSON.stringify([rec, fdr, strip]);
  hungOrdnanceAdvisoryFor(strip, fdr, rec);
  assert.equal(JSON.stringify([rec, fdr, strip]), before);
});
