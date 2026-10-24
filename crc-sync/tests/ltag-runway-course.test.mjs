// U-LTAG-COURSE (decisions H163): the LTAG final course, pinned in numbers.
//
// The squadron mission (STT v21, dated 2026-08-27) places nav points on the RWY 05 extended final (3IN05,
// 4IN05, 7IN05, 9IN05) and the thresholds RW05/RW23. In DCS x/z they lie on a GRID bearing of exactly 055.00.
// Through the Syria projection that is 052.7 TRUE (grid convergence at LTAG is about -2.15), and WMM2025 at
// LTAG on the mission date gives 5.74 E, so the final reads 047 magnetic on our scope. DCS's own map ruler
// reads 049.6 because it measures from grid north (docs/wip/U-LTAG-COURSE.md). The shipped Incirlik facility
// used to say 56 true (the runway number read as magnetic), 3.3 degrees off the pavement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import magnetic from '../src/magnetic.js';

const CFG = JSON.parse(fs.readFileSync(new URL('../config/efsp-facility-incirlik.json', import.meta.url), 'utf8'));
const THEATERS = JSON.parse(fs.readFileSync(new URL('../config/theaters.json', import.meta.url), 'utf8'));
const MISSION_DATE = Date.UTC(2026, 7, 27);
const LTAG = { lat: 37.0021, lon: 35.4259 };

const RAD = Math.PI / 180;
function bearingTrue(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}
function distM(lat1, lon1, lat2, lon2) {
  const dy = (lat2 - lat1) * 111320, dx = (lon2 - lon1) * 111320 * Math.cos(lat1 * RAD);
  return Math.hypot(dx, dy);
}

// What DCS's coord.LOtoLL gives for the mission's RW05/RW23 nav points (Syria TM, central meridian 39).
const DCS_RW05 = { lat: 36.99382, lon: 35.41255 };
const DCS_RW23 = { lat: 37.01027, lon: 35.43963 };
// The real thresholds (aeronautical database), for scale: the DCS runway is the real one.
const REAL_RW05 = { lat: 36.9937, lon: 35.4122 };
const REAL_RW23 = { lat: 37.0103, lon: 35.4395 };

test('the PAR thresholds are where DCS puts the runway ends', () => {
  const a = CFG.parApproaches;
  assert.ok(distM(a['05'].thresholdLat, a['05'].thresholdLon, DCS_RW05.lat, DCS_RW05.lon) < 5);
  assert.ok(distM(a['23'].thresholdLat, a['23'].thresholdLon, DCS_RW23.lat, DCS_RW23.lon) < 5);
  assert.ok(distM(DCS_RW05.lat, DCS_RW05.lon, REAL_RW05.lat, REAL_RW05.lon) < 50);
  assert.ok(distM(DCS_RW23.lat, DCS_RW23.lon, REAL_RW23.lat, REAL_RW23.lon) < 50);
});

test('each final course is the threshold-to-threshold bearing, the same in the runway inventory', () => {
  const a = CFG.parApproaches;
  const b05 = bearingTrue(a['05'].thresholdLat, a['05'].thresholdLon, a['23'].thresholdLat, a['23'].thresholdLon);
  const b23 = bearingTrue(a['23'].thresholdLat, a['23'].thresholdLon, a['05'].thresholdLat, a['05'].thresholdLon);
  assert.ok(Math.abs(b05 - 52.72) < 0.05, `05 bearing ${b05}`);
  assert.ok(Math.abs(a['05'].courseTrueDeg - b05) < 0.1);
  assert.ok(Math.abs(a['23'].courseTrueDeg - b23) < 0.1);
  const inv = CFG.runwayStatus.runways.find(r => r.runwayId === '05/23');
  assert.equal(inv.endHeadingsTrue['05'], a['05'].courseTrueDeg);
  assert.equal(inv.endHeadingsTrue['23'], a['23'].courseTrueDeg);
});

test('at LTAG on the mission date: grid 055.0 is 052.7 true and 047 magnetic', () => {
  const gamma = magnetic.convergenceAt(LTAG.lat, LTAG.lon, THEATERS.theaters.Syria);
  assert.ok(Math.abs(gamma - (-2.15)) < 0.01, `convergence ${gamma}`);
  const v = magnetic.variationAt(LTAG.lat, LTAG.lon, MISSION_DATE);
  assert.ok(Math.abs(v - 5.74) < 0.01, `variation ${v}`);
  const trueFromGrid = 55.0 + gamma; // DCS x/z bearing of 3IN05..9IN05 → RW05
  assert.ok(Math.abs(trueFromGrid - CFG.parApproaches['05'].courseTrueDeg) < 0.2);
  assert.equal(Math.round(magnetic.trueToMagnetic(CFG.parApproaches['05'].courseTrueDeg, v)), 47);
  // DCS's ruler: grid minus its own variation, so it differs from ours by the convergence plus the model gap.
  assert.ok(Math.abs((55.0 - 49.6) - v) < 0.4, 'the declination DCS implies is within 0.4 of WMM2025');
});
