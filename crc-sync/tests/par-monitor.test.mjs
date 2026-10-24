import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import par from '../src/surveillance/par.js';
import { ParMonitor } from '../src/surveillance/par-monitor.js';
import TrackStore from '../src/tracks.js';
import runwayStatus from '../src/efsp/runway-status.js';

// docs/adr/0112: the PAR monitor, walked the way pilots and controllers disturb a final (memory "walk pilot requests"):
// a missed approach mid-sample, a second aircraft on the same final, an aircraft below DA, no radar contact for 3 s, the
// carrier turning under an aircraft on final, no ship, no approach. Delivery to the right Position is ws-hub-par-sample.

const FT_PER_NM = 6076.12;
const INCIRLIK_CFG = JSON.parse(fs.readFileSync(new URL('../config/efsp-facility-incirlik.json', import.meta.url), 'utf8'));
const TUNING = { defaultGlideslopeDeg: 3.06, sampleMs: 500, trailPlots: 12, coverage: { rangeNm: 20, azimuthHalfDeg: 15, elevationMinDeg: -1, elevationMaxDeg: 7, apexBeyondNm: 0.5 } };
const OWN = 2;
const DCS_LTAG_ELEV_FT = 160; // what DCS says the airfield is at (the config leaves TDZE to DCS)

function world({ activeRunway = '05', aptElevFt = DCS_LTAG_ELEV_FT, parValues = {}, wind = null, convergence = 0 } = {}) {
  let t = 1_000_000;
  const wall = { now: () => t, step: (ms) => { t += ms; } };
  const strips = { INCIRLIK: [], CARRIER: [] };
  const flightData = new Map();
  const corr = new Map();
  const tracks = new TrackStore();
  let runwayRecord = { facilityId: 'INCIRLIK', activeRunway, runways: [] };
  const bays = {
    INCIRLIK: [{ bayId: 'par-final', view: 'final', positionId: 'PAR' }, { bayId: 'par-missed', positionId: 'PAR' }],
    CARRIER: [{ bayId: 'cv-app1-final', view: 'final', positionId: 'CV_APP1' }, { bayId: 'cv-app2-final', view: 'final', positionId: 'CV_APP2' }],
  };
  const monitor = new ParMonitor({
    facilityConfig: {
      getFacilityIds: () => ['INCIRLIK', 'CARRIER'],
      getAllBays: (fid) => bays[fid].map(b => ({ ...b, facilityId: fid })),
      getFacilityConfig: (fid) => (fid === 'INCIRLIK' ? INCIRLIK_CFG : {}),
    },
    boardStoreFor: (fid) => ({ getAll: () => strips[fid] }),
    flightDataOf: (id) => flightData.get(id) || null,
    correlatedTrackId: (id) => corr.get(id) || null,
    runwayViewOf: (fid) => (fid === 'INCIRLIK' ? runwayStatus.buildStatusView(INCIRLIK_CFG.runwayStatus, runwayRecord) : null),
    trackOf: (id) => tracks.get(id),
    variationAt: () => 5,
    convergenceAt: () => convergence,
    fieldWindOf: (icao) => (icao === 'LTAG' ? wind : null),
    airportElevationFt: (icao) => (icao === 'LTAG' ? aptElevFt : null),
    parValuesOf: (fid) => (fid === 'INCIRLIK' ? parValues : null),
    wallClock: wall,
    tuning: TUNING,
  });
  let n = 0;
  return {
    monitor, wall, strips, flightData, corr, tracks,
    setActive: (end) => { runwayRecord = { ...runwayRecord, activeRunway: end }; },
    onFinal(fid, bayId, ownerPositionId, { trackId, landingRunway } = {}) {
      const s = { stripId: `s${++n}`, flightDataId: `fd${n}`, stripType: 'FINAL', state: 'ON_FINAL', bayId, rackId: 'main', ownerPositionId };
      strips[fid].push(s);
      if (trackId) corr.set(s.flightDataId, String(trackId));
      if (landingRunway) flightData.set(s.flightDataId, { assigned: { landingRunway } });
      return s;
    },
    fly(id, p, extra = {}) {
      tracks.update({ id, callsign: `T${id}`, coalition: OWN, type: 'F-16C_50', category: 0, lat: p.lat, lon: p.lon, alt: p.altFt / 3.28084, heading: 0, groundSpeed: 72, verticalSpeed: -3.8, ...extra });
    },
  };
}

const RWY05 = { refLat: INCIRLIK_CFG.parApproaches['05'].thresholdLat, refLon: INCIRLIK_CFG.parApproaches['05'].thresholdLon, courseTrueDeg: INCIRLIK_CFG.parApproaches['05'].courseTrueDeg };
/** A point `nm` out on a course from a reference, `rightFt` right of it, `heightFt` above `tdzeFt`. */
function on(g, nm, heightFt, tdzeFt, rightFt = 0) {
  const back = par.offsetPoint(g.refLat, g.refLon, (g.courseTrueDeg + 180) % 360, nm * 1852);
  const p = rightFt ? par.offsetPoint(back.lat, back.lon, (g.courseTrueDeg + 90 + (rightFt < 0 ? 180 : 0)) % 360, Math.abs(rightFt) * 0.3048) : back;
  return { lat: p.lat, lon: p.lon, altFt: tdzeFt + heightFt };
}
const gp = (nm, gpa = 3.06, tch = 50) => tch + nm * FT_PER_NM * Math.tan(gpa * Math.PI / 180);

test('PAR at Incirlik: the threshold of the runway the flight lands on, TDZE from DCS, the default glideslope, magnetic course', () => {
  const w = world();
  const s = w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 11 });
  w.fly(11, on(RWY05, 5, gp(5), DCS_LTAG_ELEV_FT));
  const [e] = w.monitor.tick();
  assert.deepEqual(Object.keys(e), [...par.SAMPLE_KEYS]);
  assert.equal(e.stripId, s.stripId);
  assert.equal(e.positionId, 'PAR');
  assert.equal(e.facilityId, 'INCIRLIK');
  assert.deepEqual(Object.keys(e.approach), [...par.APPROACH_KEYS]);
  assert.equal(e.approach.id, 'LTAG-05');
  assert.equal(e.approach.gpaDeg, 3.06);
  assert.deepEqual(e.approach.defaults, { tdzeFt: DCS_LTAG_ELEV_FT, tchFt: 50, dhFt: 200, gpaDeg: 3.06 }, 'no published angle: par.json\'s default (H116)');
  assert.deepEqual(e.approach.set, [], 'nothing set by a controller');
  assert.equal(e.approach.tdzeFt, DCS_LTAG_ELEV_FT);
  assert.equal(e.approach.daFt, DCS_LTAG_ELEV_FT + 200);
  assert.deepEqual(e.approach.courseDisplay, { value: 48, ref: 'M' }, '052.7 true less 5 east');
  assert.deepEqual(e.sensor, { elevation: 'OK', azimuth: 'OK', reason: null });
  assert.equal(e.plot.rangeNm, 5);
  assert.equal(e.plot.elevDevFt, 0);
  assert.equal(e.plot.azDevFt, 0);
  assert.equal(e.plotAgeMs, 0);
  assert.deepEqual(e.trail, []);
});

test('the flight\'s assigned landing runway wins over the active one; no runway at all is NO_APPROACH', () => {
  const w = world({ activeRunway: '05' });
  w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 12, landingRunway: '23' });
  const g23 = { refLat: INCIRLIK_CFG.parApproaches['23'].thresholdLat, refLon: INCIRLIK_CFG.parApproaches['23'].thresholdLon, courseTrueDeg: INCIRLIK_CFG.parApproaches['23'].courseTrueDeg };
  w.fly(12, on(g23, 4, gp(4), DCS_LTAG_ELEV_FT));
  let [e] = w.monitor.tick();
  assert.equal(e.approach.runwayEnd, '23');
  assert.equal(e.plot.rangeNm, 4);
  const v = world({ activeRunway: null });
  v.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 13 });
  v.fly(13, on(RWY05, 4, gp(4), DCS_LTAG_ELEV_FT));
  [e] = v.monitor.tick();
  assert.equal(e.approach, null);
  assert.deepEqual(e.sensor, { elevation: 'INOP', azimuth: 'INOP', reason: 'NO_APPROACH' });
  assert.equal(e.plot, null);
});

test('no TDZE (the config leaves it to DCS and DCS has none): elevation INOP, azimuth still measured', () => {
  const w = world({ aptElevFt: null });
  w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 14 });
  w.fly(14, on(RWY05, 3, gp(3), 0, 200));
  const [e] = w.monitor.tick();
  assert.deepEqual(e.sensor, { elevation: 'INOP', azimuth: 'OK', reason: 'NO_TDZE' });
  assert.equal(e.plot.heightFt, null);
  assert.equal(e.plot.elevDevDeg, null);
  assert.ok(Math.abs(e.plot.azDevFt - 200) <= 1);
});

test('walk: no radar contact for 3 s: the last plot stays and says how old it is; the next fix is a fresh plot and the old one joins the trail', () => {
  const w = world();
  w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 15 });
  w.fly(15, on(RWY05, 4, gp(4), DCS_LTAG_ELEV_FT));
  const first = w.monitor.tick()[0].plot;
  for (let i = 1; i <= 6; i++) { w.wall.step(500); w.monitor.tick(); }
  let [e] = w.monitor.tick();
  assert.deepEqual(e.plot, first, 'DCS has not moved it: no new plot');
  assert.equal(e.plotAgeMs, 3000, 'the client\'s NO PLOT after 3 s reads this (H115)');
  w.tracks.remove(15);
  w.wall.step(1000);
  [e] = w.monitor.tick();
  assert.deepEqual(e.plot, first);
  assert.equal(e.plotAgeMs, 4000, 'the contact gone altogether: still the last plot, older');
  w.fly(15, on(RWY05, 3.8, gp(3.8), DCS_LTAG_ELEV_FT));
  [e] = w.monitor.tick();
  assert.equal(e.plotAgeMs, 0);
  assert.equal(e.plot.rangeNm, 3.8);
  assert.equal(e.trail.length, 1);
  assert.equal(e.trail[0].rangeNm, 4);
  assert.deepEqual(Object.keys(e.trail[0]), [...par.TRAIL_KEYS]);
});

test('walk: the trail holds the last 12 plots, oldest first', () => {
  const w = world();
  w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 16 });
  let e;
  for (let i = 0; i < 20; i++) {
    w.fly(16, on(RWY05, 8 - i * 0.1, gp(8 - i * 0.1), DCS_LTAG_ELEV_FT));
    [e] = w.monitor.tick();
    w.wall.step(1000);
  }
  assert.equal(e.trail.length, 12);
  assert.equal(e.trail[0].rangeNm, 8 - 7 * 0.1);
  assert.equal(e.trail[11].rangeNm, Math.round((8 - 18 * 0.1) * 100) / 100);
  assert.equal(e.plot.rangeNm, Math.round((8 - 19 * 0.1) * 100) / 100);
});

test('walk: a missed approach mid-sample ends the sample with the op; back on final starts a fresh trail', () => {
  const w = world();
  const s = w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 17 });
  w.fly(17, on(RWY05, 3, gp(3), DCS_LTAG_ELEV_FT));
  w.monitor.tick();
  w.fly(17, on(RWY05, 2.8, gp(2.8) + 300, DCS_LTAG_ELEV_FT));
  assert.equal(w.monitor.tick()[0].trail.length, 1);
  Object.assign(s, { bayId: 'par-missed', state: 'BOLTER_WAVEOFF' }); // PAR's Missed approach (ADR 0075)
  assert.deepEqual(w.monitor.tick(), []);
  Object.assign(s, { bayId: 'par-final', state: 'ON_FINAL' });
  w.fly(17, on(RWY05, 6, gp(6), DCS_LTAG_ELEV_FT));
  const [e] = w.monitor.tick();
  assert.deepEqual(e.trail, [], 'nothing from the first attempt');
  assert.equal(e.plot.rangeNm, 6);
});

test('walk: going around before the controller presses Missed approach: climbing out of the PAR\'s volume, the plot ages', () => {
  const w = world();
  w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 18 });
  w.fly(18, on(RWY05, 1, gp(1), DCS_LTAG_ELEV_FT));
  w.monitor.tick();
  w.wall.step(1000);
  w.fly(18, on(RWY05, 0.3, 1500, DCS_LTAG_ELEV_FT)); // well above 7 degrees from the antenna
  const [e] = w.monitor.tick();
  assert.equal(e.plot.rangeNm, 1, 'no plot outside the volume');
  assert.equal(e.plotAgeMs, 1000);
});

test('walk: an aircraft below DA keeps its sample, to the foot; nothing changes at DA on the server (H116: the client stops colouring)', () => {
  const w = world();
  w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 19 });
  w.fly(19, on(RWY05, 0.3, 117, DCS_LTAG_ELEV_FT, -40));
  const [e] = w.monitor.tick();
  assert.equal(e.plot.heightFt, 117);
  assert.ok(e.plot.heightFt + e.approach.tdzeFt < e.approach.daFt, 'below DA');
  assert.equal(e.plot.azDevFt, -40);
  assert.equal(e.sensor.elevation, 'OK');
});

// ── the carrier: no PAR (decisions H125, docs/adr/0116) ─────────────────

test('a carrier FINAL Strip on a carrier final Bay gets no sample: the PAR is an airfield feature only', () => {
  const w = world();
  w.tracks.update({ id: 900, callsign: 'UNION', name: 'UNION', coalition: OWN, type: 'CVN_72', category: 4, lat: 35, lon: 33.5, alt: 0, heading: 0, groundSpeed: 12, verticalSpeed: 0 });
  w.onFinal('CARRIER', 'cv-app1-final', 'CV_APP1', { trackId: 21 });
  w.onFinal('CARRIER', 'cv-app2-final', 'CV_APP2', { trackId: 22 });
  w.fly(21, { lat: 34.95, lon: 33.5, altFt: 1000 });
  assert.deepEqual(w.monitor.tick(), []);
  const s = w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 11 });
  w.fly(11, on(RWY05, 5, gp(5), DCS_LTAG_ELEV_FT));
  assert.deepEqual(w.monitor.tick().map(e => e.stripId), [s.stripId], 'only the airfield\'s final');
});

test('a Strip with no correlated contact is sampled with no plot (the panel says so); only ON_FINAL FINAL Strips in a final Bay count', () => {
  const w = world();
  w.onFinal('INCIRLIK', 'par-final', 'PAR', {});
  w.strips.INCIRLIK.push({ stripId: 'x1', flightDataId: 'fx', stripType: 'ARRIVAL', state: 'INBOUND', bayId: 'par-final', ownerPositionId: 'PAR' });
  w.strips.INCIRLIK.push({ stripId: 'x2', flightDataId: 'fy', stripType: 'FINAL', state: 'ON_FINAL', bayId: 'par-missed', ownerPositionId: 'PAR' });
  const out = w.monitor.tick();
  assert.equal(out.length, 1);
  assert.equal(out[0].plot, null);
});

// docs/adr/0130 (decisions H153): the PAR controller's values replace the defaults for the runway end they were set on, and the
// sample is measured against them, so every scope agrees with the monitor.
test('controller-set values: TDZE, TCH, DH and the angle replace the defaults on that runway end, and the plot is measured against them', () => {
  const w = world({ parValues: { '05': { tdzeFt: 238, tchFt: 54, dhFt: 300, gpaDeg: 2.75 } } });
  w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 21 });
  w.fly(21, on(RWY05, 5, gp(5, 2.75, 54), 238));
  const [e] = w.monitor.tick();
  assert.equal(e.approach.tdzeFt, 238);
  assert.equal(e.approach.tchFt, 54);
  assert.equal(e.approach.dhFt, 300);
  assert.equal(e.approach.daFt, 538, 'DA = the set TDZE + the set DH');
  assert.equal(e.approach.gpaDeg, 2.75);
  assert.deepEqual(e.approach.set, ['tdzeFt', 'tchFt', 'dhFt', 'gpaDeg']);
  assert.deepEqual(e.approach.defaults, { tdzeFt: DCS_LTAG_ELEV_FT, tchFt: 50, dhFt: 200, gpaDeg: 3.06 }, 'the defaults ride along for "reset"');
  assert.equal(e.plot.elevDevFt, 0, 'on the set glidepath from the set TCH above the set TDZE');
  assert.equal(e.plot.elevDevDeg, 0);
  assert.equal(e.plot.heightFt, Math.round(gp(5, 2.75, 54)));
});

test('controller-set values: one set value leaves the others at their defaults; another runway end is untouched', () => {
  const w = world({ activeRunway: '23', parValues: { '05': { gpaDeg: 3.2 } } });
  w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 22 });
  const g23 = { refLat: INCIRLIK_CFG.parApproaches['23'].thresholdLat, refLon: INCIRLIK_CFG.parApproaches['23'].thresholdLon, courseTrueDeg: INCIRLIK_CFG.parApproaches['23'].courseTrueDeg };
  w.fly(22, on(g23, 4, gp(4), DCS_LTAG_ELEV_FT));
  let [e] = w.monitor.tick();
  assert.equal(e.approach.gpaDeg, 3.06, 'runway 23 has nothing set');
  assert.deepEqual(e.approach.set, []);
  const v = world({ parValues: { '05': { gpaDeg: 3.2 } } });
  v.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 23 });
  v.fly(23, on(RWY05, 4, gp(4, 3.2), DCS_LTAG_ELEV_FT));
  [e] = v.monitor.tick();
  assert.equal(e.approach.gpaDeg, 3.2);
  assert.equal(e.approach.tdzeFt, DCS_LTAG_ELEV_FT, 'TDZE still DCS\'s');
  assert.deepEqual(e.approach.set, ['gpaDeg']);
  assert.equal(e.plot.elevDevFt, 0);
});

test('a controller-set TDZE gives elevation where DCS has no field elevation (NO_TDZE clears)', () => {
  const w = world({ aptElevFt: null, parValues: { '05': { tdzeFt: 238 } } });
  w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 24 });
  w.fly(24, on(RWY05, 3, gp(3), 238));
  const [e] = w.monitor.tick();
  assert.deepEqual(e.sensor, { elevation: 'OK', azimuth: 'OK', reason: null });
  assert.equal(e.approach.defaults.tdzeFt, null);
  assert.equal(e.plot.elevDevFt, 0);
});

// decisions H156 PV-Q1 a, H161 V2-Q1 a: the PAR controller sets the approach values with nobody on the final, so the monitor
// also says which approach each final's next aircraft flies (the active runway end's), whatever is on it.
test('empty final: the approach of the active runway end, with the set values; none without an active runway; never the carrier', () => {
  const w = world({ parValues: { '05': { gpaDeg: 3 } } });
  assert.deepEqual(w.monitor.tick(), [], 'nobody on the final');
  const list = w.monitor.finalApproaches();
  assert.equal(list.length, 1, 'one per airfield final Bay; the carrier finals have no PAR (H125)');
  assert.deepEqual(Object.keys(list[0]), [...par.FINAL_APPROACH_KEYS]);
  assert.equal(list[0].facilityId, 'INCIRLIK');
  assert.equal(list[0].positionId, 'PAR');
  assert.equal(list[0].approach.id, 'LTAG-05');
  assert.deepEqual(Object.keys(list[0].approach), [...par.APPROACH_KEYS]);
  assert.equal(list[0].approach.gpaDeg, 3);
  assert.deepEqual(list[0].approach.set, ['gpaDeg']);
  assert.equal(list[0].approach.tdzeFt, DCS_LTAG_ELEV_FT);
  w.setActive('23');
  assert.equal(w.monitor.finalApproaches()[0].approach.id, 'LTAG-23', 'follows the runway change');
  w.setActive(null);
  assert.deepEqual(w.monitor.finalApproaches(), [], 'no active runway: no approach to show');
});

test('empty final: an aircraft on the final does not change the next approach (its own runway is its sample\'s)', () => {
  const w = world();
  w.onFinal('INCIRLIK', 'par-final', 'PAR', { landingRunway: '23' });
  const [e] = w.monitor.tick();
  assert.equal(e.approach.id, 'LTAG-23');
  assert.equal(w.monitor.finalApproaches()[0].approach.id, 'LTAG-05');
});

// ── docs/adr/0139: the glidepath alert's figures and the needed heading ─────────────────────────────────────────────────

test('glidepathOf: the latest fresh plot\'s elevation deviation and whether it is beyond DA; null when stale, INOP or absent', () => {
  const w = world();
  const s = w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 11 });
  assert.equal(w.monitor.glidepathOf('INCIRLIK', s.stripId), null, 'never sampled');
  w.fly(11, on(RWY05, 5, gp(5) - 300, DCS_LTAG_ELEV_FT));
  w.monitor.tick();
  const g = w.monitor.glidepathOf('INCIRLIK', s.stripId);
  assert.ok(g.elevDevDeg < -0.5, `well below the glidepath (${g.elevDevDeg})`);
  assert.equal(g.beyondDa, true);
  w.wall.step(3500);
  w.monitor.tick(); // DCS has not moved the aircraft: the plot ages
  assert.equal(w.monitor.glidepathOf('INCIRLIK', s.stripId), null, 'a plot older than NO PLOT is no basis for an alert');
  w.fly(11, on(RWY05, 0.4, gp(0.4) - 40, DCS_LTAG_ELEV_FT));
  w.monitor.tick();
  assert.equal(w.monitor.glidepathOf('INCIRLIK', s.stripId).beyondDa, false, '0.4 NM is inside DA (200 ft DH on 3.06 deg is ~0.5 NM)');
});

test('glidepathOf: with the elevation INOP (no TDZE anywhere) there is nothing to alert on', () => {
  const w = world({ aptElevFt: null });
  const s = w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 11 });
  w.fly(11, on(RWY05, 5, gp(5), DCS_LTAG_ELEV_FT));
  w.monitor.tick();
  assert.equal(w.monitor.glidepathOf('INCIRLIK', s.stripId), null);
});

test('headings: the needed heading holds the course in the field wind, the current is the aircraft\'s, both magnetic', () => {
  // the course is 052.7 true; variation 5 E. A 20 kt wind from 142.7 true (straight across from the right) at 140 kt TAS.
  const w = world({ wind: { windFromTrue: 142.7, windKt: 20 } });
  w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 11 });
  const tasKt = 140;
  const wcaDeg = Math.asin(20 / tasKt) * 180 / Math.PI; // 8.2
  // ground vector = air vector + wind: flying 052.7 + wca true, drifting back onto the course
  const hdgT = 52.7 + wcaDeg;
  const toward = (142.7 + 180) * Math.PI / 180;
  const gx = tasKt * Math.sin(hdgT * Math.PI / 180) + 20 * Math.sin(toward);
  const gy = tasKt * Math.cos(hdgT * Math.PI / 180) + 20 * Math.cos(toward);
  const course = Math.atan2(gx, gy) * 180 / Math.PI;
  w.fly(11, on(RWY05, 5, gp(5), DCS_LTAG_ELEV_FT), { heading: hdgT + 3, course, groundSpeed: Math.hypot(gx, gy) / 1.943844 });
  const [e] = w.monitor.tick();
  assert.deepEqual(Object.keys(e.headings), [...par.HEADINGS_KEYS]);
  assert.equal(e.headings.needed, Math.round(52.7 + wcaDeg - 5), 'course + wind correction, magnetic');
  assert.equal(e.headings.current, Math.round(hdgT + 3 - 5), 'DCS heading, magnetic');
  assert.equal(e.headings.windFrom, Math.round(142.7 - 5));
  assert.equal(e.headings.windKt, 20);
});

test('headings: no field wind (or no variation) leaves the needed heading empty, never the course passed off as one', () => {
  const w = world();
  w.onFinal('INCIRLIK', 'par-final', 'PAR', { trackId: 11 });
  w.fly(11, on(RWY05, 5, gp(5), DCS_LTAG_ELEV_FT), { heading: 50, course: 52 });
  const [e] = w.monitor.tick();
  assert.equal(e.headings.needed, null);
  assert.equal(e.headings.current, 45);
});

test('neededHeading: calm is the course; a headwind changes nothing; a crosswind stronger than the aircraft is no answer', () => {
  const calm = par.neededHeading({ courseTrueDeg: 52.7, windFromTrueDeg: 0, windKt: 0, trackTrueDeg: 52.7, gsKt: 140 });
  assert.ok(Math.abs(calm.headingTrueDeg - 52.7) < 1e-9);
  const head = par.neededHeading({ courseTrueDeg: 52.7, windFromTrueDeg: 52.7, windKt: 30, trackTrueDeg: 52.7, gsKt: 110 });
  assert.ok(Math.abs(head.headingTrueDeg - 52.7) < 1e-9);
  assert.ok(Math.abs(head.tasKt - 140) < 1e-9);
  const left = par.neededHeading({ courseTrueDeg: 5, windFromTrueDeg: 275, windKt: 20, trackTrueDeg: 5, gsKt: 140 });
  assert.ok(left.headingTrueDeg > 355, `a wind from the left takes the heading left of the course, through north (${left.headingTrueDeg})`);
  assert.equal(par.neededHeading({ courseTrueDeg: 0, windFromTrueDeg: 270, windKt: 90, trackTrueDeg: 90, gsKt: 80 }), null, 'a 10 kt aircraft in a 90 kt crosswind');
  assert.equal(par.neededHeading({ courseTrueDeg: 0, windFromTrueDeg: null, windKt: 10, trackTrueDeg: 0, gsKt: 100 }), null);
});

test('rangeAtDaNm: where the glidepath reaches DA, the client\'s formula', () => {
  const r = par.rangeAtDaNm({ dhFt: 200, tchFt: 50, gpaDeg: 3.06 });
  assert.ok(Math.abs(r - 150 / (FT_PER_NM * Math.tan(3.06 * Math.PI / 180))) < 1e-12);
  assert.equal(par.rangeAtDaNm({ dhFt: null, tchFt: 50, gpaDeg: 3 }), 0);
});
