import test from 'node:test';
import assert from 'node:assert/strict';

/* Illumination, computed rather than sampled (docs/adr/0043).
 *
 * The renderer sampled the beam angle every 50ms and accepted anything within
 * ±4°. On a 2000ms rotation a 4° beam dwells on a target for ~22ms and the
 * acceptance window is ~44ms wide, so a 50ms tick missed targets depending on
 * where it happened to land. The test named for that case below is the one
 * that matters: it fails against a sampling implementation and passes against
 * this one, whatever the tick rate.
 */

const {
  CoverageEngine, lastCrossing, lastIllumination, signedDeltaDeg, normaliseDeg, bearingDeg,
} = await import('../src/coverage.js');

const DISH = { id: 'apt:X', sweepMs: 2000, angleFromNose: 360 };
const NOSE = { id: 'crc:1', sweepMs: 4000, angleFromNose: 120, heading: 0 };

// ── the scheduling primitive ───────────────────────────────────────────────

test('lastCrossing: finds the event inside the interval and returns its exact instant', () => {
  // period 1000, offset 250, epoch 0 -> events at 250, 1250, 2250, ...
  assert.equal(lastCrossing(0, 300, 0, 1000, 250), 250);
  assert.equal(lastCrossing(1000, 1300, 0, 1000, 250), 1250);
});

test('lastCrossing: returns null when no event falls inside the interval', () => {
  assert.equal(lastCrossing(300, 900, 0, 1000, 250), null);
});

test('lastCrossing: an interval longer than the period yields the most recent event, not the first', () => {
  // Events at 250, 1250, 2250 all fall in (0, 2500] — the latest is the one
  // that matters, because it is the one the client fades from.
  assert.equal(lastCrossing(0, 2500, 0, 1000, 250), 2250);
});

test('lastCrossing: the event boundary is inclusive at `now` and exclusive at `since`', () => {
  assert.equal(lastCrossing(0, 250, 0, 1000, 250), 250, 'an event exactly at now counts');
  assert.equal(lastCrossing(250, 300, 0, 1000, 250), null, 'an event exactly at since does not count twice');
});

test('lastCrossing: a radar with no sweep period never illuminates anything', () => {
  assert.equal(lastCrossing(0, 10000, 0, 0, 0), null);
});

// ── a rotating dish ────────────────────────────────────────────────────────

test('a dish illuminates a target once per rotation, at its bearing fraction of the cycle', () => {
  // Bearing 090 on a 2000ms rotation is a quarter of the way round: 500ms.
  assert.equal(lastIllumination(DISH, 90, 0, 600, 0), 500);
  assert.equal(lastIllumination(DISH, 90, 600, 2600, 0), 2500, 'and once more a rotation later');
  assert.equal(lastIllumination(DISH, 90, 600, 2400, 0), null, 'the next crossing has not happened yet at 2400');
});

test('a dish illuminates a target due north at the start of each rotation', () => {
  assert.equal(lastIllumination(DISH, 0, -1, 100, 0), 0);
  assert.equal(lastIllumination(DISH, 360, 1999, 2100, 0), 2000);
});

test('the 22ms-dwell case: a target is found whatever the tick rate, which sampling could not manage', () => {
  // Bearing 090, 2000ms rotation: the crossing is at 500ms. Walk the whole
  // rotation in ticks of every size from 10ms to 400ms and assert the target
  // is illuminated exactly once per rotation each time. A ±4° sampling gate
  // has a ~44ms window, so every tick longer than that would drop it.
  for (const tickMs of [10, 25, 50, 100, 250, 400]) {
    let hits = 0;
    for (let t = 0; t < 2000; t += tickMs) {
      if (lastIllumination(DISH, 90, t, t + tickMs, 0) != null) hits += 1;
    }
    assert.equal(hits, 1, `tick ${tickMs}ms illuminated the target ${hits} times per rotation`);
  }
});

test('every bearing is illuminated exactly once per rotation', () => {
  for (let bearing = 0; bearing < 360; bearing += 7) {
    let hits = 0;
    for (let t = 0; t < 2000; t += 100) {
      if (lastIllumination(DISH, bearing, t, t + 100, 0) != null) hits += 1;
    }
    assert.equal(hits, 1, `bearing ${bearing} was illuminated ${hits} times`);
  }
});

// ── a nose radar ───────────────────────────────────────────────────────────

test('a nose radar never illuminates a target outside its scan arc', () => {
  // 120° arc centred on heading 0 -> ±60°.
  assert.equal(lastIllumination(NOSE, 90, 0, 100000, 0), null);
  assert.equal(lastIllumination(NOSE, 180, 0, 100000, 0), null);
  assert.equal(lastIllumination(NOSE, 61, 0, 100000, 0), null, 'one degree outside the arc is outside');
  // The arc edge itself is inside it — a target exactly at ±60 is scanned.
  assert.notEqual(lastIllumination(NOSE, 300, 0, 100000, 0), null, 'bearing 300 is -60, on the edge and inside');
  assert.notEqual(lastIllumination(NOSE, 60, 0, 100000, 0), null);
});

test('a nose radar illuminates a target inside the arc twice per there-and-back cycle', () => {
  // A full cycle is 2*sweepMs = 8000ms. A target dead ahead sits at the middle
  // of the arc, so it is crossed on the way out and again on the way back.
  let hits = 0;
  for (let t = 0; t < 8000; t += 100) {
    if (lastIllumination(NOSE, 0, t, t + 100, 0) != null) hits += 1;
  }
  assert.equal(hits, 2);
});

test('a nose radar sweeping outward reaches the left edge of its arc before the right', () => {
  const left = lastIllumination(NOSE, 300, 0, 8000, 0);   // -60, u = 0
  const right = lastIllumination(NOSE, 60, 0, 8000, 0);   // +60, u = 1
  // Within one cycle the left edge is crossed at t=0 and t=8000, the right at
  // t=4000; taking the latest crossing in the window gives 8000 vs 4000.
  assert.ok(left > right, `left edge ${left} should be later in this window than right ${right}`);
});

test('a nose radar follows the aircraft: the same bearing leaves the arc when the heading changes', () => {
  const turned = { ...NOSE, heading: 180 };
  assert.equal(lastIllumination(NOSE, 0, 0, 100000, 0) != null, true);
  assert.equal(lastIllumination(turned, 0, 0, 100000, 0), null);
  assert.equal(lastIllumination(turned, 180, 0, 100000, 0) != null, true);
});

// ── angle helpers ──────────────────────────────────────────────────────────

test('signedDeltaDeg wraps to (-180, 180]', () => {
  assert.equal(signedDeltaDeg(10, 350), 20);
  assert.equal(signedDeltaDeg(350, 10), -20);
  assert.equal(signedDeltaDeg(0, 0), 0);
  assert.equal(normaliseDeg(-90), 270);
});

test('bearingDeg: due east and due north come out as 090 and 000', () => {
  assert.ok(Math.abs(bearingDeg(37, 35, 37, 36) - 90) < 0.5);
  assert.ok(Math.abs(bearingDeg(37, 35, 38, 35)) < 0.5);
});

// ── the engine ─────────────────────────────────────────────────────────────

const AIRFIELD = {
  id: 'apt:X', type: 'airport', lat: 37, lon: 35, elevM: 60,
  rangeM: 40 * 1852, sweepMs: 2000,
  seesGround: true, seesShips: false, noGroundAircraft: false,
  angleFromNose: 360, heading: 0,
};
const APPROACH = { ...AIRFIELD, id: 'app:X', type: 'approach', rangeM: 80 * 1852, sweepMs: 3000, seesGround: false, noGroundAircraft: true };

function aircraft(id, lat, lon, alt = 6000, category = 1) {
  return { id, callsign: `T${id}`, type: 'F-16C_50', category, lat, lon, alt, heading: 0 };
}

/** Sweeps a whole rotation in 250ms ticks and returns every track ever illuminated. */
function sweepOnce(engine, radars, tracks, missionData = null, sweepMs = 3000) {
  const seen = new Set();
  for (let t = 0; t <= sweepMs + 250; t += 250) {
    const { changed } = engine.tick(radars, tracks, missionData, 1_000_000 + t);
    for (const c of changed) seen.add(c.trackId);
  }
  return seen;
}

test('a track inside range is illuminated within one rotation', () => {
  const engine = new CoverageEngine();
  const seen = sweepOnce(engine, [APPROACH], [aircraft(1, 37.2, 35.2)]);
  assert.deepEqual([...seen], ['1']);
});

test('a track beyond the radar range is never illuminated', () => {
  const engine = new CoverageEngine();
  // ~6 degrees of latitude is well past 80nm.
  const seen = sweepOnce(engine, [APPROACH], [aircraft(1, 43, 35)]);
  assert.equal(seen.size, 0);
});

test('a ground vehicle is seen only by the radar that sees ground', () => {
  const engine = new CoverageEngine();
  const vehicle = aircraft(5, 37.05, 35.05, 60, 3);
  assert.deepEqual([...sweepOnce(engine, [AIRFIELD], [vehicle], null, 2000)], ['5']);
  assert.equal(sweepOnce(new CoverageEngine(), [APPROACH], [vehicle]).size, 0);
});

test('a ship is seen only by a radar that sees ships', () => {
  const engine = new CoverageEngine();
  const ship = { ...aircraft(6, 37.05, 35.05, 0, 4) };
  assert.equal(sweepOnce(engine, [AIRFIELD], [ship], null, 2000).size, 0);
  const shipSeeing = { ...APPROACH, seesShips: true };
  assert.deepEqual([...sweepOnce(new CoverageEngine(), [shipSeeing], [ship])], ['6']);
});

test('an approach radar ignores an aircraft on the ground', () => {
  const missionData = { airports: [{ name: 'X', lat: 37, lon: 35, elev: 50 }] };
  const onRamp = aircraft(7, 37.001, 35.001, 60);
  assert.equal(sweepOnce(new CoverageEngine(), [APPROACH], [onRamp], missionData).size, 0);
  // The airfield surveillance radar, which has noGroundAircraft false, sees it.
  assert.deepEqual([...sweepOnce(new CoverageEngine(), [AIRFIELD], [onRamp], missionData, 2000)], ['7']);
});

test('a radar sitting on the ramp illuminates nothing', () => {
  const grounded = { ...APPROACH, id: 'crc:9', onGround: true };
  assert.equal(sweepOnce(new CoverageEngine(), [grounded], [aircraft(1, 37.2, 35.2)]).size, 0);
});

test('every controller shares one sweep phase — that is the point of moving this server-side', () => {
  const engine = new CoverageEngine();
  const first = engine.sweepStartFor('app:X', 5_000);
  assert.equal(engine.sweepStartFor('app:X', 9_999), first, 'the phase is minted once and never drifts');
});

test('terrain blocking removes a track that range and beam would have accepted', () => {
  const blocking = { hasLineOfSight: () => false };
  assert.equal(sweepOnce(new CoverageEngine({ terrain: blocking }), [APPROACH], [aircraft(1, 37.2, 35.2)]).size, 0);
});

test("terrain that is still loading fails open — going blind is worse than seeing too much", () => {
  const warming = { hasLineOfSight: () => 'unknown' };
  const engine = new CoverageEngine({ terrain: warming });
  assert.deepEqual([...sweepOnce(engine, [APPROACH], [aircraft(1, 37.2, 35.2)])], ['1']);
  assert.ok(engine.stats.losUnknown > 0);
});

test('a ground contact skips terrain masking, because DCS airfields are not flattened in the DEM', () => {
  const blocking = { hasLineOfSight: () => false };
  const engine = new CoverageEngine({ terrain: blocking });
  const vehicle = aircraft(5, 37.05, 35.05, 60, 3);
  assert.deepEqual([...sweepOnce(engine, [AIRFIELD], [vehicle], null, 2000)], ['5']);
});

test('a line-of-sight answer is reused inside its window instead of re-walking the terrain', () => {
  let calls = 0;
  const terrain = { hasLineOfSight: () => { calls += 1; return true; } };
  const engine = new CoverageEngine({ terrain });
  const tracks = [aircraft(1, 37.2, 35.2)];
  // Two rotations of 250ms ticks: the pair is illuminated twice, but the
  // terrain is only walked once inside the 1000ms cache window.
  sweepOnce(engine, [APPROACH], tracks);
  assert.ok(calls <= 4, `terrain was walked ${calls} times across two rotations`);
});

test('illuminationFor remembers a track between sweeps, which is what the client fades from', () => {
  const engine = new CoverageEngine();
  sweepOnce(engine, [APPROACH], [aircraft(1, 37.2, 35.2)]);
  const hit = engine.illuminationFor('1');
  assert.ok(hit, 'the track should still be in the picture after its beam passed');
  assert.deepEqual(hit.radarIds, ['app:X']);
  assert.equal(engine.illuminationFor('nobody'), null);
});

test('isVisibleThrough answers whether a given set of radars has ever illuminated a track', () => {
  const engine = new CoverageEngine();
  sweepOnce(engine, [APPROACH], [aircraft(1, 37.2, 35.2)]);
  assert.equal(engine.isVisibleThrough('1', new Set(['app:X'])), true);
  assert.equal(engine.isVisibleThrough('1', new Set(['apt:Y'])), false);
  assert.equal(engine.isVisibleThrough('2', new Set(['app:X'])), false);
});

test('a track that leaves the picture is forgotten rather than accumulating forever', () => {
  const engine = new CoverageEngine();
  sweepOnce(engine, [APPROACH], [aircraft(1, 37.2, 35.2)]);
  assert.ok(engine.illuminationFor('1'));
  engine.tick([APPROACH], [], null, 2_000_000);
  assert.equal(engine.illuminationFor('1'), null);
});

test('reset clears the phases and the picture — a mission reload voids every answer', () => {
  const engine = new CoverageEngine();
  sweepOnce(engine, [APPROACH], [aircraft(1, 37.2, 35.2)]);
  const phase = engine.sweepStartFor('app:X', 1);
  engine.reset();
  assert.equal(engine.illuminationFor('1'), null);
  assert.notEqual(engine.sweepStartFor('app:X', 12_345), phase);
});

test('two radars illuminating one track both appear against it', () => {
  const engine = new CoverageEngine();
  const second = { ...APPROACH, id: 'app:Y' };
  sweepOnce(engine, [APPROACH, second], [aircraft(1, 37.2, 35.2)]);
  assert.deepEqual(engine.illuminationFor('1').radarIds.sort(), ['app:X', 'app:Y']);
});
