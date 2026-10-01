import { test } from 'node:test';
import assert from 'node:assert/strict';

// Lane TA — the theater's transition altitude decides how an altitude's TEXT is
// written (FL at and above it, feet below). Stored values are feet either way.
const { FdrStore, parseAltitude, formatAltitudeBlock, normalizeMtrValue } = await import('../src/efsp/fdr-store.js');
const { indicatedAltFt } = await import('../src/altimetry.js');
const { TheaterContext } = await import('../src/theater-context.js');

const blk = (lowFt, highFt) => ({ lowFt, highFt });
const SYRIA = 10000;
const CAUCASUS = 18000;
const FILED = { aircraftType: 'F16', wakeCategory: 'D', departureAirport: 'LTAG', destinationAirport: 'LTAC', route: 'DCT', requestedAltitude: 'FL250' };

test('Syria (TA 10,000): 10,000 ft and up is a flight level, below is feet', () => {
  assert.equal(formatAltitudeBlock(blk(10000, 12000), SYRIA), 'FL100-FL120');
  assert.equal(formatAltitudeBlock(blk(8000, 10000), SYRIA), '8000-FL100');
  assert.equal(formatAltitudeBlock(blk(5000, 8000), SYRIA), '5000-8000');
  assert.equal(formatAltitudeBlock(blk(22000, 24000), SYRIA), 'FL220-FL240', 'FL220-FL240 stays a block');
});

test('a theater with 18,000: the switch is where it was', () => {
  assert.equal(formatAltitudeBlock(blk(10000, 12000), CAUCASUS), '10000-12000');
  assert.equal(formatAltitudeBlock(blk(16000, 20000), CAUCASUS), '16000-FL200');
  assert.equal(formatAltitudeBlock(blk(22000, 24000), CAUCASUS), 'FL220-FL240');
});

test('parsing is unit-based, so FL100 is 10,000 ft whatever the theater', () => {
  assert.deepEqual(parseAltitude('FL100'), blk(10000, 10000));
  assert.deepEqual(parseAltitude('FL100-FL120'), blk(10000, 12000));
  assert.deepEqual(parseAltitude('FL220-FL240'), blk(22000, 24000));
  assert.deepEqual(parseAltitude('100B120'), blk(10000, 12000));
});

test('the MTR requested altitude after exit is written with the theater transition altitude', () => {
  const path = 'military.mtr.requestedAltitudeAfterExit';
  assert.deepEqual(normalizeMtrValue(path, '100b120', 0, SYRIA), { ok: true, value: 'FL100-FL120' });
  assert.deepEqual(normalizeMtrValue(path, '100b120', 0, CAUCASUS), { ok: true, value: '10000-12000' });
});

for (const [name, ta, text, shown] of [
  ['Syria', SYRIA, '100B120', 'FL100-FL120'],
  ['an 18,000 ft theater', CAUCASUS, '100B120', '10000-12000'],
  ['Syria, high block', SYRIA, 'FL220B240', 'FL220-FL240'],
]) {
  test(`setClearance in ${name} writes the block text with the injected transition altitude and stores feet`, () => {
    const store = new FdrStore(undefined, { transitionAltFt: () => ta });
    const fdr = store.createFdr({ callsign: 'VPR9', ...FILED }, { by: 'test' }).fdr;
    const r = store.setClearance(fdr.fdrId, 'altitude', { value: text }, { by: 'cd' });
    assert.equal(r.ok, true, JSON.stringify(r));
    const e = store.getFdr(fdr.fdrId).clearance.altitude.entries.at(-1);
    assert.equal(e.value, shown);
    assert.equal(e.block.lowFt % 100, 0);
    assert.ok(e.block.lowFt >= 10000, 'stored in feet');
  });
}

test('the transition altitude is read when the text is written, so a theater change applies to the next entry', () => {
  let ta = CAUCASUS;
  const store = new FdrStore(undefined, { transitionAltFt: () => ta });
  const fdr = store.createFdr({ callsign: 'VPR9', ...FILED }, { by: 'test' }).fdr;
  store.setClearance(fdr.fdrId, 'altitude', { value: '100B120' }, { by: 'cd' });
  ta = SYRIA;
  store.setClearance(fdr.fdrId, 'altitude', { value: '100B120' }, { by: 'cd' });
  const entries = store.getFdr(fdr.fdrId).clearance.altitude.entries;
  assert.equal(entries.at(-2).value, '10000-12000');
  assert.equal(entries.at(-1).value, 'FL100-FL120');
});

test('theater context answers the theater table, else the 18,000 default', () => {
  const ctx = new TheaterContext({ theaters: { Syria: { utcOffsetHours: 3, transitionAltFt: 10000 }, Kola: { utcOffsetHours: 3 } }, clock: { now: () => 0, source: 'WALL' } });
  assert.equal(ctx.transitionAltFt(), 18000, 'no mission yet');
  ctx.setMission({ theatre: 'Syria', airports: [] });
  assert.equal(ctx.transitionAltFt(), 10000);
  assert.equal(ctx.wireBody().transitionAltFt, 10000);
  ctx.setMission({ theatre: 'Kola', airports: [] });
  assert.equal(ctx.transitionAltFt(), 18000);
});

test('indicated altitude switches to standard pressure at the theater transition altitude', () => {
  const wx = { pressurePa: 99000, tempK: 288.15 };
  const syria = indicatedAltFt(3500, wx, SYRIA);     // 11,483 ft: above Syria's TA
  const caucasus = indicatedAltFt(3500, wx, CAUCASUS); // below 18,000: QNH
  assert.ok(syria > caucasus + 300, `${syria} vs ${caucasus}`);
});
