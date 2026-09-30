import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

/* docs/adr/0085: what "magnetic" means in crc-sync.
 *
 * The model is checked against NOAA NCEI's own published test values for
 * WMM2025, both files, copied verbatim into tests/fixtures/wmm/:
 *   WMM2025_TEST_VALUES.txt — the 12-point table on
 *     https://www.ncei.noaa.gov/products/world-magnetic-model
 *     (sites/default/files/2025-02/WMM2025_TEST_VALUES.txt)
 *   WMM2025_TestValues.txt  — the 100-point table shipped inside WMM2025COF.zip
 */

const M = await import('../src/magnetic.js');
const { loadTheaters } = await import('../src/theaters.js');

const FIX = path.join(import.meta.dirname, 'fixtures/wmm');
const rows = (file) => fs.readFileSync(path.join(FIX, file), 'utf8').split('\n')
  .filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().split(/\s+/).map(Number));

test('the shipped coefficient file is WMM2025, epoch 2025.0, degree 12', () => {
  const header = fs.readFileSync(M.COF_PATH, 'utf8').split('\n')[0];
  assert.match(header, /2025\.0\s+WMM-2025\s+11\/13\/2024/);
  const model = M.wmmModel();
  assert.equal(model.epoch, 2025);
  assert.equal(model.nMax, 12);
  assert.equal(model.g[1][0], -29351.8);
  assert.equal(model.hDot[1][1], -21.5);
});

test('NCEI 12-point test values: declination to the published 0.01°, X/Y/Z to the published 0.1 nT', () => {
  const vals = rows('WMM2025_TEST_VALUES.txt');
  assert.equal(vals.length, 12);
  for (const [year, hKm, lat, lon, X, Y, Z, , , , D] of vals) {
    const f = M.wmmField(lat, lon, hKm, year);
    const at = `${year} ${hKm}km ${lat},${lon}`;
    assert.ok(Math.abs(f.declination - D) <= 0.005 + 1e-9, `${at}: D ${f.declination} vs ${D}`);
    assert.ok(Math.abs(f.x - X) <= 0.05 + 1e-9, `${at}: X ${f.x} vs ${X}`);
    assert.ok(Math.abs(f.y - Y) <= 0.05 + 1e-9, `${at}: Y ${f.y} vs ${Y}`);
    assert.ok(Math.abs(f.z - Z) <= 0.05 + 1e-9, `${at}: Z ${f.z} vs ${Z}`);
  }
});

test('NCEI 100-point test values (WMM2025COF.zip): every declination to 0.01°, X/Y/Z to 0.01 nT', () => {
  const vals = rows('WMM2025_TestValues.txt');
  assert.equal(vals.length, 100);
  for (const [year, hKm, lat, lon, D, , , X, Y, Z] of vals) {
    const f = M.wmmField(lat, lon, hKm, year);
    const at = `${year} ${hKm}km ${lat},${lon}`;
    assert.ok(Math.abs(f.declination - D) <= 0.005 + 1e-9, `${at}: D ${f.declination} vs ${D}`);
    for (const [k, want] of [['x', X], ['y', Y], ['z', Z]]) {
      assert.ok(Math.abs(f[k] - want) <= 0.01, `${at}: ${k} ${f[k]} vs ${want}`);
    }
  }
});

test('variationAt reads the model at sea level on the MISSION date — the same point moves with the date', () => {
  // NCEI rows: 80N 0E at 0 km is 1.28° in 2025.0 and 2.59° in 2027.5.
  assert.equal(M.variationAt(80, 0, Date.UTC(2025, 0, 1)).toFixed(2), '1.28');
  assert.equal(M.variationAt(80, 0, Date.UTC(2027, 6, 2, 12)).toFixed(2), '2.59');
  // Syria, Incirlik-ish: easterly, a few degrees — the scale the H15 fix is about.
  const inc = M.variationAt(37.0, 35.4, Date.UTC(2026, 0, 1));
  assert.ok(inc > 4 && inc < 7, `Incirlik ${inc}`);
  assert.equal(M.variationAt(NaN, 35, Date.UTC(2026, 0, 1)), null);
  assert.equal(M.variationAt(37, 35, NaN), null);
});

test('decimalYear and the validity window: a 2016 mission is extrapolated, and says so', () => {
  assert.equal(M.decimalYear(Date.UTC(2025, 0, 1)), 2025);
  assert.equal(M.decimalYear(Date.UTC(2027, 6, 2, 12)), 2027.5);
  assert.equal(M.modelDateValid(Date.UTC(2026, 5, 1)), true);
  assert.equal(M.modelDateValid(Date.UTC(2016, 5, 1)), false);
  assert.equal(M.modelDateValid(Date.UTC(2030, 0, 1)), false);
  assert.ok(Number.isFinite(M.variationAt(35, 36, Date.UTC(2016, 5, 1))), 'still a value — the override is the correction');
});

test('a theater override: fixedDeg replaces the model, offsetDeg corrects it', () => {
  const date = Date.UTC(2026, 0, 1);
  const model = M.variationAt(35, 36, date);
  assert.equal(M.variationAt(35, 36, date, { fixedDeg: 4 }), 4);
  assert.equal(M.variationAt(0, 120, date, { fixedDeg: 4 }), 4, 'anywhere on the map');
  assert.ok(Math.abs(M.variationAt(35, 36, date, { offsetDeg: 0.5 }) - (model + 0.5)) < 1e-12);
  assert.equal(M.variationSource(null), 'WMM2025');
  assert.equal(M.variationSource({ fixedDeg: 4 }), 'FIXED');
  assert.equal(M.variationSource({ offsetDeg: 1 }), 'WMM2025+OFFSET');
});

test('true ↔ magnetic: magnetic = true − east variation, and back; unknown variation never passes true off as magnetic', () => {
  assert.equal(M.trueToMagnetic(100, 5), 95);
  assert.equal(M.trueToMagnetic(2, 5), 357);
  assert.equal(M.magneticToTrue(357, 5), 2);
  assert.equal(M.trueToMagnetic(100, null), null);
  assert.equal(M.magneticToTrue(100, undefined), null);
  for (let d = 0; d < 360; d += 7) assert.ok(Math.abs(M.magneticToTrue(M.trueToMagnetic(d, 5.4), 5.4) - d) < 1e-9);
});

test('convergence: true = grid + γ, γ = (lon − lon0)·sin(lat); unknown projection is null, never 0', () => {
  const syria = { tmCentralMeridianDeg: 39 };
  assert.equal(M.convergenceAt(35, 39, syria), 0, 'on the central meridian');
  assert.ok(Math.abs(M.convergenceAt(35, 36, syria) - (-3 * Math.sin(35 * Math.PI / 180))) < 1e-12);
  assert.equal(M.convergenceAt(35, 36, {}), null);
  assert.equal(M.convergenceAt(35, 36, null), null);
});

test('same sign as the carrier model: angles.js gridToTrue(grid, convergenceAt(...)) is the true heading', async () => {
  const { gridToTrue } = await import('../src/efsp/carrier/angles.js');
  const syria = { tmCentralMeridianDeg: 39 };
  const gamma = M.convergenceAt(35, 36, syria); // west of the meridian: grid north lies west of true north
  assert.ok(gamma < 0);
  assert.ok(Math.abs(gridToTrue(90, gamma) - (90 + gamma)) < 1e-12);
});

// ── config/theaters.json ─────────────────────────────────────────────────

const SHIPPED = path.join(import.meta.dirname, '../config/theaters.json');

test('transition altitude is per theater: Syria 10,000 ft (H62), every theater has one', () => {
  const theaters = loadTheaters(SHIPPED);
  assert.equal(theaters.Syria.transitionAltFt, 10000);
  for (const [name, t] of Object.entries(theaters)) assert.ok(t.transitionAltFt > 0, `${name} has no transitionAltFt`);
});

test('the central meridians are miztoyaml projection.py\'s, theater for theater', () => {
  const py = fs.readFileSync(path.join(import.meta.dirname, '../../tools/miztoyaml/projection.py'), 'utf8');
  const table = Object.fromEntries([...py.matchAll(/"(\w+)":\s*dict\(lon0=\s*(-?\d+(?:\.\d+)?)/g)].map(m => [m[1], Number(m[2])]));
  assert.ok(Object.keys(table).length >= 8);
  const theaters = loadTheaters(SHIPPED);
  for (const [name, lon0] of Object.entries(table)) assert.equal(theaters[name]?.tmCentralMeridianDeg, lon0, name);
  for (const [name, t] of Object.entries(theaters)) {
    if ('tmCentralMeridianDeg' in t) assert.ok(name in table, `${name} has a meridian projection.py does not`);
  }
});

test('the loader keeps a valid override and drops a malformed one (both kinds at once is ambiguous), with a warning', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theaters-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'theaters.json');
  fs.writeFileSync(file, JSON.stringify({ theaters: {
    A: { utcOffsetHours: 0, magneticVariation: { fixedDeg: 3 } },
    B: { utcOffsetHours: 0, magneticVariation: { offsetDeg: -1 } },
    C: { utcOffsetHours: 0, magneticVariation: { fixedDeg: 3, offsetDeg: 1 } },
    D: { utcOffsetHours: 0, transitionAltFt: 'high', tmCentralMeridianDeg: 'x' },
  } }));
  const th = loadTheaters(file);
  assert.deepEqual(th.A.magneticVariation, { fixedDeg: 3 });
  assert.deepEqual(th.B.magneticVariation, { offsetDeg: -1 });
  assert.equal('magneticVariation' in th.C, false);
  assert.equal('transitionAltFt' in th.D, false);
  assert.equal('tmCentralMeridianDeg' in th.D, false);
  assert.equal(warn.mock.callCount(), 3);
});
