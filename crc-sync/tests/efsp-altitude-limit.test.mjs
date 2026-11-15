import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPaths } from './helpers/with-paths.mjs';

// state-paths.js reads CRCSYNC_STATE_DIR at module load: point it at a temp dir before any import.
withPaths('efsp-altitude-limit-test-', {}, { stateDir: true }).apply();

// docs/adr/0163 — an assigned altitude limit, "<080" (at or below) and ">FL240" (at or above).
const { parseAltitude, formatAltitudeBlock, isAltitudeLimit, bandEnds, entryBand } = await import('../src/efsp/altitude-band.js');
const { FlightDataStore, normalizeMtrValue } = await import('../src/efsp/flight-data-store.js');
const { evaluateConformance, FPM_PER_MS, MS_PER_KT } = await import('../src/efsp/conformance.js');
const { HandoffControl } = await import('../src/efsp/board/handoff-control.js');
const { altitudeBandOf, bandOverlaps } = await import('../src/efsp/airspace/route-geometry.js');
const { loadAlertingConfig } = await import('../src/alerting-config.js');

const band = (lowFt, highFt) => ({ lowFt, highFt });
const TA = 18000;

test('a limit parses from every single-altitude form with < or > before it', () => {
  for (const t of ['<080', '<A080', '<8000', '< 080', '<F080', '<FL080']) assert.deepEqual(parseAltitude(t), band(null, 8000), t);
  for (const t of ['>FL240', '>240', '>F240', '>24000', '> fl240']) assert.deepEqual(parseAltitude(t), band(24000, null), t);
  for (const t of ['<', '>', '<<080', '<>080', '<FL220-FL240', '>220B240', '080<', '<ABC', '<1234567']) {
    assert.equal(parseAltitude(t), null, JSON.stringify(t));
  }
  assert.equal(isAltitudeLimit(band(null, 8000)), true);
  assert.equal(isAltitudeLimit(band(24000, null)), true);
  assert.equal(isAltitudeLimit(band(22000, 24000)), false);
  assert.equal(isAltitudeLimit(band(8000, 8000)), false);
});

test('a limit is written as typed below the transition altitude, as a flight level at and above it', () => {
  assert.equal(formatAltitudeBlock(band(null, 8000), TA, '080'), '<080');
  assert.equal(formatAltitudeBlock(band(null, 8000), TA, '8000'), '<8000');
  assert.equal(formatAltitudeBlock(band(24000, null), TA, '240'), '>FL240');
  assert.equal(formatAltitudeBlock(band(24000, null), TA, '24000'), '>FL240');
  assert.equal(formatAltitudeBlock(band(12000, null), 10000, '120'), '>FL120', 'Syria: TA 10,000 ft');
  assert.equal(formatAltitudeBlock(band(null, 8000), TA), '<8000', 'feet without the typed text');
  // Closed blocks are unchanged.
  assert.equal(formatAltitudeBlock(band(22000, 24000), TA), 'FL220-FL240');
});

test('bandEnds reads an open end as an infinity; entryBand reads every entry shape', () => {
  assert.deepEqual(bandEnds(band(null, 8000)), { low: -Infinity, high: 8000 });
  assert.deepEqual(bandEnds(band(24000, null)), { low: 24000, high: Infinity });
  assert.deepEqual(entryBand({ parsed: 9000, block: null }), band(9000, 9000));
  assert.deepEqual(entryBand({ parsed: null, block: band(null, 8000) }), band(null, 8000));
  assert.equal(entryBand({ parsed: null, block: null }), null);
  assert.equal(entryBand(null), null);
});

const FILED = { aircraftType: 'F16', wakeCategory: 'M', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: 'FL250' };

test('setClearance stores a limit as a block with one open end, parsed null, and it survives snapshot/restore', () => {
  const store = new FlightDataStore();
  const id = store.createFlightData({ callsign: 'VPR1', ...FILED }, { by: 'test' }).flightData.flightDataId;
  assert.equal(store.setClearance(id, 'altitude', { value: '<080' }, { by: 'ap' }).ok, true);
  let e = store.getFlightData(id).clearance.altitude.entries.at(-1);
  assert.deepEqual([e.value, e.parsed, e.block], ['<080', null, band(null, 8000)]);
  assert.equal(store.setClearance(id, 'altitude', { value: '>240' }, { by: 'ap' }).ok, true);
  e = store.getFlightData(id).clearance.altitude.entries.at(-1);
  assert.deepEqual([e.value, e.parsed, e.block], ['>FL240', null, band(24000, null)]);
  // The Alt+wheel shift keeps the operator: "<090" is a new limit, the old one superseded.
  store.setClearance(id, 'altitude', { value: '<090' }, { by: 'ap' });
  const entries = store.getFlightData(id).clearance.altitude.entries;
  assert.deepEqual(entries.map(x => x.status), ['SUPERSEDED', 'SUPERSEDED', 'ACTIVE']);
  assert.deepEqual(entries.at(-1).block, band(null, 9000));
  const copy = new FlightDataStore();
  copy.restore(JSON.parse(JSON.stringify(store.snapshot())));
  const r = copy.getFlightData(id).clearance.altitude.entries.at(-1);
  assert.deepEqual([r.value, r.block, r.status], ['<090', band(null, 9000), 'ACTIVE']);
  const bad = store.setClearance(id, 'altitude', { value: '<FL220-FL240' });
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /<080/);
});

test('the requested altitude after MTR exit may be a limit', () => {
  const p = 'military.mtr.requestedAltitudeAfterExit';
  assert.deepEqual(normalizeMtrValue(p, '<080', 0, TA), { ok: true, value: '<080' });
  assert.deepEqual(normalizeMtrValue(p, '>230', 0, TA), { ok: true, value: '>FL230' });
});

// ── conformance (AL-Q2 a) ──
const cfg = loadAlertingConfig().conformance;
const FAST = 250 * MS_PER_KT;
const fpm = (v) => v / FPM_PER_MS;
function run(steps, alt) {
  const mem = {};
  let alerts = [];
  for (const [t, over] of steps) {
    alerts = evaluateConformance({ hdg: null, alt, course: 50, groundSpeedMs: FAST, verticalSpeedMs: 0, altFt: 10000, ...over }, mem, t * 1000, cfg);
  }
  return alerts;
}
const kinds = (a) => a.map(x => x.kind);
const AOB = { parsed: null, block: band(null, 8000), at: 1 };
const AOA = { parsed: null, block: band(24000, null), at: 2 };

test('limit: anywhere on the allowed side conforms, climbing or descending, never a level to reach', () => {
  for (const altFt of [500, 3000, 7999, 8000, 8400]) {
    for (const v of [0, 3000, -3000]) assert.deepEqual(run([[0, { altFt, verticalSpeedMs: fpm(v) }], [60, { altFt, verticalSpeedMs: fpm(v) }]], AOB), [], `AOB ${altFt} ${v}`);
  }
  for (const altFt of [24000, 30000, 45000, 23600]) {
    for (const v of [0, 3000, -3000]) assert.deepEqual(run([[0, { altFt, verticalSpeedMs: fpm(v) }], [60, { altFt, verticalSpeedMs: fpm(v) }]], AOA), [], `AOA ${altFt} ${v}`);
  }
});

test('limit: past it by more than levelBustFt is a LEVEL_BUST, measured from the limit', () => {
  const steps = (altFt) => [[0, { altFt: 5000 }], [1, { altFt: 5000 }], [2, { altFt }], [6, { altFt }]];
  const up = run(steps(8000 + cfg.levelBustFt + 100), AOB);
  assert.deepEqual(kinds(up), ['LEVEL_BUST']);
  assert.equal(up[0].assigned, 8000);
  assert.equal(up[0].deviationFt, cfg.levelBustFt + 100);
  assert.deepEqual(up[0].block, band(null, 8000), 'the open end goes out as null, never an infinity');
  assert.deepEqual(run(steps(8000 + cfg.levelBustFt - 50), AOB), [], 'within levelBustFt is no bust');
  const down = run([[0, { altFt: 30000 }], [1, { altFt: 30000 }], [2, { altFt: 23000 }], [6, { altFt: 23000 }]], AOA);
  assert.deepEqual(kinds(down), ['LEVEL_BUST']);
  assert.equal(down[0].assigned, 24000);
  assert.equal(down[0].deviationFt, -1000);
});

test('limit: past it and moving further away is WRONG_WAY; past it and returning is not', () => {
  const away = run([[0, { altFt: 12000, verticalSpeedMs: fpm(1500) }], [cfg.wrongWayPersistSec + 1, { altFt: 12500, verticalSpeedMs: fpm(1500) }]], AOB);
  assert.deepEqual(kinds(away), ['WRONG_WAY']);
  assert.equal(away[0].assigned, 8000);
  const back = run([[0, { altFt: 12000, verticalSpeedMs: fpm(-1500) }], [cfg.wrongWayPersistSec + 1, { altFt: 11500, verticalSpeedMs: fpm(-1500) }]], AOB);
  assert.deepEqual(back, []);
  const below = run([[0, { altFt: 20000, verticalSpeedMs: fpm(-1500) }], [cfg.wrongWayPersistSec + 1, { altFt: 19800, verticalSpeedMs: fpm(-1500) }]], AOA);
  assert.deepEqual(kinds(below), ['WRONG_WAY']);
  assert.equal(below[0].assigned, 24000);
  assert.deepEqual(run([[0, { altFt: 20000, verticalSpeedMs: fpm(1500) }], [10, { altFt: 21000, verticalSpeedMs: fpm(1500) }]], AOA), []);
});

// ── the control-axis attestation (handoff-control) ──
function scopes(curEntry, value) {
  const fd = { clearance: { altitude: { entries: curEntry ? [{ ...curEntry, status: 'ACTIVE' }] : [] } } };
  const ctl = Object.create(HandoffControl.prototype);
  ctl._flightDataStore = { getFlightData: () => fd };
  return ctl._neededScopes('ALTITUDE', { flightDataId: 'x' }, { value }).needed;
}

test('a limit needs the directions it opens past the current assignment', () => {
  assert.deepEqual(scopes({ parsed: 8000, block: null }, '<100'), ['CLIMB', 'DESCENT'], 'at or below 100 lets it climb and descend');
  assert.deepEqual(scopes({ parsed: 8000, block: null }, '<080'), ['DESCENT'], 'at or below 080 lets it descend');
  assert.deepEqual(scopes({ parsed: 8000, block: null }, '>060'), ['CLIMB', 'DESCENT']);
  assert.deepEqual(scopes({ parsed: 8000, block: null }, '<060'), ['DESCENT']);
  assert.deepEqual(scopes({ parsed: 8000, block: null }, '>100'), ['CLIMB']);
  assert.deepEqual(scopes({ parsed: null, block: band(null, 8000) }, '<080'), []);
  assert.deepEqual(scopes({ parsed: null, block: band(null, 8000) }, '060'), [], 'a level inside the limit');
  assert.deepEqual(scopes({ parsed: null, block: band(null, 8000) }, '100'), ['CLIMB']);
  assert.deepEqual(scopes({ parsed: null, block: band(24000, null) }, '<100'), ['DESCENT']);
  // A closed block keeps the overlap rule.
  assert.deepEqual(scopes({ parsed: null, block: band(22000, 24000) }, 'FL230-FL250'), []);
});

// ── the airspace route check (route-geometry) ──
test('a limit is an open band against an airspace\'s vertical limits', () => {
  const fd = (value, block) => ({ filed: {}, clearance: { altitude: { entries: [{ status: 'ACTIVE', value, parsed: null, block }] } } });
  assert.deepEqual(altitudeBandOf(fd('<080', band(null, 8000))), band(null, 8000));
  assert.deepEqual(altitudeBandOf({ filed: { requestedAltitude: '>FL240' } }), band(24000, null));
  const area = { altLowerFt: 10000, altUpperFt: 20000 };
  assert.equal(bandOverlaps(band(null, 8000), area), false, 'at or below 080 stays under it');
  assert.equal(bandOverlaps(band(null, 12000), area), true);
  assert.equal(bandOverlaps(band(24000, null), area), false, 'at or above FL240 stays over it');
  assert.equal(bandOverlaps(band(15000, null), area), true);
  assert.equal(bandOverlaps(band(null, 8000), { altLowerFt: null, altUpperFt: 5000 }), true);
});
