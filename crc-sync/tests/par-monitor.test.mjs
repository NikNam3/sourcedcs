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
const HULL = JSON.parse(fs.readFileSync(new URL('../config/efsp-carriers.json', import.meta.url), 'utf8')).hulls[0];
const TUNING = { defaultGlideslopeDeg: 3.06, sampleMs: 500, trailPlots: 12, coverage: { rangeNm: 20, azimuthHalfDeg: 15, elevationMinDeg: -1, elevationMaxDeg: 7, apexBeyondNm: 0.5 } };
const OWN = 2;
const DCS_LTAG_ELEV_FT = 160; // what DCS says the airfield is at (the config leaves TDZE to DCS)

function world({ activeRunway = '05', aptElevFt = DCS_LTAG_ELEV_FT } = {}) {
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
    tracks: () => tracks.getAll(),
    carrierStore: { defaultHullId: HULL.hullId, hull: () => JSON.parse(JSON.stringify(HULL)) },
    ownCoalition: () => OWN,
    convergenceAt: () => 0,
    variationAt: () => 5,
    airportElevationFt: (icao) => (icao === 'LTAG' ? aptElevFt : null),
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

const RWY05 = { refLat: INCIRLIK_CFG.parApproaches['05'].thresholdLat, refLon: INCIRLIK_CFG.parApproaches['05'].thresholdLon, courseTrueDeg: 56 };
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
  assert.equal(e.approach.kind, 'RUNWAY');
  assert.equal(e.approach.gpaDeg, 3.06);
  assert.equal(e.approach.gpaPublished, false, 'no published angle: the controller\'s default may replace it (H116)');
  assert.equal(e.approach.tdzeFt, DCS_LTAG_ELEV_FT);
  assert.equal(e.approach.daFt, DCS_LTAG_ELEV_FT + 200);
  assert.deepEqual(e.approach.courseDisplay, { value: 51, ref: 'M' }, '056 true less 5 east');
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
  const g23 = { refLat: INCIRLIK_CFG.parApproaches['23'].thresholdLat, refLon: INCIRLIK_CFG.parApproaches['23'].thresholdLon, courseTrueDeg: 236 };
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

// ── the carrier ──────────────────────────────────────────────────────────

function ship(w, { lat = 35, lon = 33.5, heading = 0 } = {}) {
  w.tracks.update({ id: 900, callsign: 'UNION', name: 'UNION', coalition: OWN, type: 'CVN_72', category: 4, lat, lon, alt: 0, heading, groundSpeed: 12, verticalSpeed: 0 });
}
function laneGeom(shipPos, heading) {
  const td = par.carrierTouchdown({ shipLat: shipPos.lat, shipLon: shipPos.lon, headingTrueDeg: heading, aftM: HULL.approach.touchdownAftM, portM: HULL.approach.touchdownPortM });
  return { refLat: td.lat, refLon: td.lon, courseTrueDeg: (heading - HULL.angledDeckDeg + 360) % 360 };
}

test('the carrier lane: the touchdown point on the live ship, the landing area\'s course, 3.5 degrees published', () => {
  const w = world();
  ship(w, { heading: 0 });
  w.onFinal('CARRIER', 'cv-app1-final', 'CV_APP1', { trackId: 21 });
  const g = laneGeom({ lat: 35, lon: 33.5 }, 0);
  w.fly(21, on(g, 3, gp(3, 3.5, 0), HULL.approach.deckHeightFt));
  const [e] = w.monitor.tick();
  assert.equal(e.positionId, 'CV_APP1');
  assert.equal(e.approach.kind, 'CARRIER');
  assert.equal(e.approach.hullId, 'CVN-72');
  assert.equal(e.approach.gpaDeg, 3.5);
  assert.equal(e.approach.gpaPublished, true);
  assert.equal(e.approach.courseTrueDeg, 351);
  assert.deepEqual(e.approach.courseDisplay, { value: 346, ref: 'M' });
  assert.equal(e.plot.rangeNm, 3);
  assert.equal(e.plot.elevDevFt, 0);
  assert.equal(e.plot.azDevFt, 0);
});

test('walk: a second aircraft on the same carrier final: two samples, each its own trail', () => {
  const w = world();
  ship(w);
  const g = laneGeom({ lat: 35, lon: 33.5 }, 0);
  const a = w.onFinal('CARRIER', 'cv-app1-final', 'CV_APP1', { trackId: 22 });
  const b = w.onFinal('CARRIER', 'cv-app1-final', 'CV_APP1', { trackId: 23 });
  w.fly(22, on(g, 2, gp(2, 3.5, 0), 66));
  w.fly(23, on(g, 5, gp(5, 3.5, 0), 66));
  w.monitor.tick();
  w.fly(22, on(g, 1.9, gp(1.9, 3.5, 0), 66));
  const out = w.monitor.tick();
  assert.deepEqual(out.map(e => e.stripId), [a.stripId, b.stripId]);
  assert.equal(out[0].trail.length, 1);
  assert.equal(out[1].trail.length, 0, 'b did not move: no second plot');
  assert.equal(out[0].plot.rangeNm, 1.9);
  assert.equal(out[1].plot.rangeNm, 5);
});

test('walk: the carrier turns under an aircraft on final: the course and the touchdown point follow the ship; the trail keeps what was measured', () => {
  const w = world();
  ship(w, { heading: 0 });
  const g0 = laneGeom({ lat: 35, lon: 33.5 }, 0);
  w.onFinal('CARRIER', 'cv-app2-final', 'CV_APP2', { trackId: 24 });
  w.fly(24, on(g0, 4, gp(4, 3.5, 0), 66));
  const before = w.monitor.tick()[0];
  assert.equal(before.plot.azDevFt, 0);
  ship(w, { heading: 10, lat: 35.001 }); // turned 10 degrees right and moved on
  w.fly(24, on(g0, 3.9, gp(3.9, 3.5, 0), 66)); // the aircraft flew the old line
  const after = w.monitor.tick()[0];
  assert.equal(after.approach.courseTrueDeg, 1);
  // The deck swung right (351 -> 001): the line the aircraft flew now lies east of the new centreline, which is right of course
  // for a pilot flying 001, by about 4 NM * sin 10 degrees.
  assert.ok(after.plot.azDevFt > 4000 && after.plot.azDevFt < 4300, `now well right of the new centreline: ${after.plot.azDevFt}`);
  assert.equal(after.trail[0].azDevFt, 0, 'the earlier plot as it was measured');
});

test('no ship (the hull is not found): both scopes INOP, no plot; the approach is still named', () => {
  const w = world();
  w.onFinal('CARRIER', 'cv-app1-final', 'CV_APP1', { trackId: 25 });
  w.fly(25, { lat: 35, lon: 33.4, altFt: 1200 });
  const [e] = w.monitor.tick();
  assert.deepEqual(e.sensor, { elevation: 'INOP', azimuth: 'INOP', reason: 'NO_SHIP' });
  assert.equal(e.approach.hullId, 'CVN-72');
  assert.equal(e.plot, null);
  assert.equal(e.plotAgeMs, null);
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
