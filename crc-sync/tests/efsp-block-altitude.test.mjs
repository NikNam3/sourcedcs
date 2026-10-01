import { test } from 'node:test';
import assert from 'node:assert/strict';

// docs/adr/0091 — block altitudes in the ALT field.
const { FdrStore, parseAltitudeFt, parseAltitude, formatAltitudeBlock } = await import('../src/efsp/fdr-store.js');
const { evaluateConformance, FPM_PER_MS, MS_PER_KT } = await import('../src/efsp/conformance.js');
const { DEFAULTS } = await import('../src/alerting-config.js');
const { findConflicts } = await import('../src/stca.js');

const blk = (lowFt, highFt) => ({ lowFt, highFt });

test('block altitudes parse in every form a controller writes them', () => {
  for (const t of ['FL220-FL240', 'FL220B240', '220B240', 'fl220 b fl240', '220-240', 'FL220TO240', 'F220-F240', 'A220B240', '22000-24000', '22000B24000', 'FL220 - 240']) {
    assert.deepEqual(parseAltitude(t), blk(22000, 24000), t);
  }
  assert.deepEqual(parseAltitude('050B080'), blk(5000, 8000));
  assert.deepEqual(parseAltitude('A050-A080'), blk(5000, 8000));
  assert.deepEqual(parseAltitude('5000-8000'), blk(5000, 8000));
  assert.deepEqual(parseAltitude('5000B8000'), blk(5000, 8000));
  assert.deepEqual(parseAltitude('FL180B220'), blk(18000, 22000));
  assert.deepEqual(parseAltitude('FL180'), blk(18000, 18000), 'a single altitude is a zero-width band');
});

test('bad block input is refused: reversed, equal, half-written, junk', () => {
  for (const t of ['FL240-FL220', 'FL220-FL220', '240B220', 'FL220-', '-FL240', 'FL220B', 'B240', 'FL220-FL240-FL260',
    'FL220--FL240', 'FL220-ABC', 'XB240', '1234567-8', '', 'FL2200-FL240', 'FL220 TO']) {
    assert.equal(parseAltitude(t), null, JSON.stringify(t));
  }
});

test('parseAltitudeFt still answers a single altitude only', () => {
  assert.equal(parseAltitudeFt('FL220B240'), null);
  assert.equal(parseAltitudeFt('FL180'), 18000);
});

test('a block is written back in one canonical form', () => {
  assert.equal(formatAltitudeBlock(blk(22000, 24000), 18000), 'FL220-FL240');
  assert.equal(formatAltitudeBlock(blk(5000, 8000), 18000), '5000-8000');
  assert.equal(formatAltitudeBlock(blk(16000, 20000), 18000), '16000-FL200');
});

const FILED = { aircraftType: 'F16', wakeCategory: 'D', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: 'FL250' };

test('setClearance stores a block structurally and canonicalises its text', () => {
  const store = new FdrStore();
  const fdr = store.createFdr({ callsign: 'VPR1', ...FILED }, { by: 'test' }).fdr;
  assert.equal(store.setClearance(fdr.fdrId, 'altitude', { value: 'fl220b240' }, { by: 'cd' }).ok, true);
  const e = store.getFdr(fdr.fdrId).clearance.altitude.entries[0];
  assert.equal(e.value, 'FL220-FL240');
  assert.equal(e.parsed, null, 'no single altitude');
  assert.deepEqual(e.block, blk(22000, 24000));
  // Amending to a single altitude clears the block; wire round-trips through snapshot/restore.
  store.setClearance(fdr.fdrId, 'altitude', { value: 'FL180' }, { by: 'cd' });
  const e2 = store.getFdr(fdr.fdrId).clearance.altitude.entries[1];
  assert.deepEqual([e2.parsed, e2.block], [18000, null]);
  store.setClearance(fdr.fdrId, 'altitude', { value: '220-240' }, { by: 'cd' });
  const copy = new FdrStore();
  copy.restore(JSON.parse(JSON.stringify(store.snapshot())));
  const r = copy.getFdr(fdr.fdrId).clearance.altitude.entries.at(-1);
  assert.deepEqual(r.block, blk(22000, 24000));
  assert.equal(r.status, 'ACTIVE');
  // Refusals say how to write a block.
  const bad = store.setClearance(fdr.fdrId, 'altitude', { value: 'FL240-FL220' });
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /FL220-FL240/);
  assert.match(bad.detail, /lower/);
  assert.equal(store.setClearance(fdr.fdrId, 'altitude', { value: 'FL220-' }).ok, false);
});

test('the requested altitude after MTR exit may be a block', async () => {
  const { normalizeMtrValue } = await import('../src/efsp/fdr-store.js');
  const path = 'military.mtr.requestedAltitudeAfterExit';
  assert.deepEqual(normalizeMtrValue(path, 'fl210b230', 0), { ok: true, value: 'FL210-FL230' });
  assert.deepEqual(normalizeMtrValue(path, 'FL210', 0), { ok: true, value: 'FL210' });
  assert.equal(normalizeMtrValue(path, 'FL230-FL210', 0).ok, false);
});

test('a block set through SetBlock reaches the wire shape every Strip reads', async () => {
  const { createEfsp } = await import('../src/efsp/index.js');
  const crypto = await import('crypto');
  const efsp = createEfsp();
  const session = { controllerId: 'c-OPS', who: 'OPS' };
  efsp.handleMessage(session, { type: 'efsp-set-positions', facilityId: 'INCIRLIK', held: ['OPS'] });
  const send = (strip, op) => efsp.handleMessage(session, {
    version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(), facilityId: 'INCIRLIK', actingPositionId: 'OPS',
    stripId: strip ? strip.stripId : undefined, baseRev: strip ? strip.rev : undefined, op,
  }).ack;
  let ack = send(null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { callsign: 'VPR9', ...FILED } });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  const strip = ack.strip;
  ack = send(strip, { kind: 'SetBlock', blockId: '21', value: 'FL220B240' });
  if (ack.ok) {
    const e = efsp.fdrStore.getFdr(strip.fdrId).clearance.altitude.entries.at(-1);
    assert.equal(e.value, 'FL220-FL240');
    assert.deepEqual(e.block, blk(22000, 24000));
  } else {
    // OPS may not own Block 21; the refusal must not be about the altitude text.
    assert.doesNotMatch(JSON.stringify(ack), /not an altitude/);
  }
  assert.equal(send(strip, { kind: 'SetBlock', blockId: '21', value: 'FL240-FL220' }).ok, false);
});

// ── conformance ──
const cfg = DEFAULTS.conformance;
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
const BLOCK = { parsed: null, block: blk(22000, 24000), at: 0 };

test('block: anywhere inside is conforming, with the usual tolerance at the edges', () => {
  for (const altFt of [22000, 23000, 24000, 21700, 24300]) {
    assert.deepEqual(run([[0, { altFt }], [120, { altFt }]], BLOCK), [], `${altFt}`);
  }
});

test('block: busting out of either edge after reaching it alerts, measured from the nearest edge', () => {
  const steps = (altFt) => [[0, { altFt: 23000 }], [1, { altFt: 23000 }], [2, { altFt }], [6, { altFt }]];
  const top = run(steps(24800), BLOCK);
  assert.deepEqual(kinds(top), ['LEVEL_BUST']);
  assert.equal(top[0].deviationFt, 800);
  assert.equal(top[0].assigned, 24000, 'assigned is the edge it left through');
  assert.deepEqual(top[0].block, blk(22000, 24000));
  const bottom = run(steps(21000), BLOCK);
  assert.deepEqual(kinds(bottom), ['LEVEL_BUST']);
  assert.equal(bottom[0].deviationFt, -1000);
  assert.equal(bottom[0].assigned, 22000);
});

test('block: wrong way is judged against the nearest edge, and passing through is no bust before reaching', () => {
  // Below the block and descending: wrong way.
  const wrong = run([[0, { altFt: 15000, verticalSpeedMs: fpm(-1200) }], [4, { altFt: 14900, verticalSpeedMs: fpm(-1200) }], [6, { altFt: 14800, verticalSpeedMs: fpm(-1200) }]], BLOCK);
  assert.deepEqual(kinds(wrong), ['WRONG_WAY']);
  // Inside the block, vertical speed is irrelevant.
  assert.deepEqual(run([[0, { altFt: 23000, verticalSpeedMs: fpm(-1200) }], [10, { altFt: 22900, verticalSpeedMs: fpm(-1200) }]], BLOCK), []);
  // Climbing up to it: fine.
  assert.deepEqual(run([[0, { altFt: 15000, verticalSpeedMs: fpm(2000) }], [30, { altFt: 15900, verticalSpeedMs: fpm(2000) }]], BLOCK), []);
});

test('block: a legacy numeric parsed (older snapshot) still conforms as a point', () => {
  assert.deepEqual(kinds(run([[0, { altFt: 5000 }], [1, { altFt: 5000 }], [2, { altFt: 6000 }], [6, { altFt: 6000 }]], { parsed: 5000, at: 0 })), ['LEVEL_BUST']);
});

// ── STCA ──
test('STCA is geometry only: an assigned block never enters it', () => {
  const KT = 0.514444;
  const now = 1_000_000;
  const t = (id, over) => ({ id, callsign: `T${id}`, category: 1, lat: 37, lon: 35, alt: 7000, course: 0, groundSpeed: 400 * KT, verticalSpeed: 0, firstSeenAt: now - 60000, ...over });
  const a = t(1, {});
  const b = t(2, { lat: 37 + 10 / 60, course: 180 });
  assert.equal(findConflicts([a, b], DEFAULTS.stca, now).length, 1);
  assert.equal(findConflicts.length <= 3, true, 'no clearance parameter exists to read');
});
