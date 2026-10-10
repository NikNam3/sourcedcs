import test from 'node:test';
import assert from 'node:assert/strict';

// The carrier map's geometry and rules (docs/wip/CARRIER-MAP.md): zoom, rings, the ship's frame, the centreline, the stack, the
// patterns' shapes, what is occupied (Strip state first, geometry only to tell a spin from the landing pattern), label declutter.

const m = await import('../app/public/js/panels/efsp/carrier-map-model.js');
const board = await import('../app/public/js/panels/efsp/marshal-board-model.js');

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const ptNear = (p, q, eps = 1e-6) => near(p.e, q.e, eps) && near(p.n, q.n, eps);

test('zoom: 2.5 to 65 nm, the wheel with the radar map\'s feel (a zoom level per 450 px), the range fits the shorter side', () => {
  assert.equal(m.clampRange(1), 2.5);
  assert.equal(m.clampRange(100), 65);
  assert.equal(m.clampRange('x'), 30);
  assert.equal(m.wheelRange(30, 450), 60, 'one zoom level out doubles the range');
  assert.equal(m.wheelRange(30, -450), 15);
  assert.equal(m.wheelRange(60, 450), 65, 'clamped');
  assert.equal(m.wheelRange(3, -450), 2.5);
  assert.equal(m.scaleFor(800, 600, 30), (300 - m.EDGE_PX) / 30, 'the shorter side');
});

test('rings: the spacing by range or the controller\'s, out to the corners, the 10 nm ring at every zoom', () => {
  assert.equal(m.ringSpacingFor(4), 1);
  assert.equal(m.ringSpacingFor(12), 2.5);
  assert.equal(m.ringSpacingFor(30), 5);
  assert.equal(m.ringSpacingFor(65), 10);
  assert.equal(m.ringSpacingFor(65, '2.5'), 2.5);
  for (const range of [2.5, 5, 9.9, 10, 30, 65]) {
    const reach = range * Math.SQRT2 * 1.2;
    const rings = m.ringsFor(range, reach, m.ringSpacingFor(range));
    const ten = rings.filter((r) => r.ten);
    assert.equal(ten.length, 1, `one 10 nm ring at ${range}`);
    assert.equal(ten[0].label, true);
    assert.ok(rings.every((r) => r.nm <= Math.max(reach, 10) + 1e-9), 'none beyond the corners except the 10');
    assert.ok(rings.some((r) => r.nm > range) || reach < range + m.ringSpacingFor(range), `rings carry on into the corners at ${range}`);
  }
  const at30 = m.ringsFor(30, 45, 5).map((r) => r.nm);
  assert.deepEqual(at30, [5, 10, 15, 20, 25, 30, 35, 40, 45]);
});

test('the ship\'s frame: true north up, east right; the axis frame: ahead and to starboard', () => {
  const ship = { lat: 36, lon: 35 };
  const p = m.toFrame(ship, 36 + 10 / 60, 35);
  assert.ok(ptNear(p, { e: 0, n: 10 }));
  const q = m.toFrame(ship, 36, 35 + 10 / 60 / Math.cos(36 * Math.PI / 180));
  assert.ok(ptNear(q, { e: 10, n: 0 }, 1e-9));
  assert.ok(ptNear(m.polar(90, 5), { e: 5, n: 0 }));
  assert.ok(ptNear(m.onAxis(0, 3, 1), { e: 1, n: 3 }), 'BRC north: ahead is north, starboard east');
  assert.ok(ptNear(m.onAxis(90, 3, 1), { e: 3, n: -1 }), 'BRC east: starboard is south');
});

test('the centreline runs astern along the final bearing to the edge with a tick every mile', () => {
  const c = m.extendedCentreline(340, 42.4);
  assert.equal(c.ticks.length, 42);
  assert.ok(ptNear(c.ticks[0], m.polar(160, 1)));
  assert.ok(ptNear(c.to, m.polar(160, 42.4)));
  const moved = m.extendedCentreline(350, 42.4);
  assert.ok(!ptNear(moved.ticks[0], c.ticks[0]), 'an overridden final bearing moves the line');
});

test('the marshal stack: radial from the first fix to the top fix in use, a mark per fix', () => {
  const s = m.marshalStack(160, 21, [22, 21, 23, 23]);
  assert.deepEqual(s.fixes.map((f) => f.dme), [21, 22, 23]);
  assert.equal(s.top, 23);
  assert.ok(ptNear(s.from, m.polar(160, 21)));
  assert.equal(m.marshalStack(160, 21, []).top, 22, 'nobody holding: the first fix and one');
});

test('the bolter racetrack turns in at the assigned approach turn: upwind to 4 nm, downwind 2 nm to port', () => {
  for (const turn of [4, 6, 8]) {
    const pts = m.bolterRacetrack(0, turn);
    const along = pts.map((p) => p.n);
    const lat = pts.map((p) => p.e);
    assert.ok(near(Math.max(...along), 5), 'the far end of the upwind turn, 4 nm + the turn radius');
    assert.ok(near(Math.min(...along), -turn - 1), `turns in ${turn} nm astern (plus the radius)`);
    assert.ok(near(Math.min(...lat), -2), 'downwind 2 nm to port');
    assert.ok(Math.max(...lat) < 1e-9, 'nothing to starboard');
    assert.ok(ptNear(pts[pts.length - 1], { e: 0, n: -turn }), 'back on the final bearing at the approach turn');
  }
});

test('Case I geometry: port holding tangent to the BRC with the ship at 3 o\'clock, 5 nm across; the initial 3 nm astern; the spin 3 nm', () => {
  const ph = m.portHolding(0);
  assert.ok(ptNear(ph.centre, { e: -2.5, n: 0 }));
  assert.equal(ph.r, 2.5);
  const lp = m.landingPattern(0, 351);
  assert.ok(ptNear(lp.initial, { e: 0, n: -3 }));
  assert.ok(lp.points.every((p) => p.e <= 1e-6 || p.n < 0), 'the downwind is to port');
  assert.equal(m.spinCircle().r, 3);
});

test('the tanker racetrack: 10 nm ahead to 6 nm astern, 4 nm abeam on its pattern side', () => {
  for (const [side, sign] of [['port', -1], ['starboard', 1]]) {
    const pts = m.tankerRacetrack(0, side);
    const along = pts.map((p) => p.n);
    const lat = pts.map((p) => p.e * sign);
    assert.ok(near(Math.max(...along), 10, 1e-9));
    assert.ok(near(Math.min(...along), -6, 1e-9));
    assert.ok(near(Math.max(...lat), 4, 1e-9), `4 nm to ${side}`);
    assert.ok(Math.min(...lat) > -1e-9);
  }
});

test('occupied: from the Strip state; geometry only tells a spin from the landing pattern', () => {
  const none = m.occupancy({ caseValue: 'III', rows: [], tankerOnStation: false });
  assert.deepEqual(none, { bolterTurns: [], portHolding: false, landing: false, spin: false, tanker: false });
  const c3 = m.occupancy({ caseValue: 'III', rows: [{ kind: 'hold' }, { kind: 'comm' }, { kind: 'approach' }, { kind: 'bolter', turnNm: 8 }, { kind: 'bolter', turnNm: 4 }, { kind: 'bolter', turnNm: null }], tankerOnStation: true });
  assert.deepEqual(c3.bolterTurns, [4, 6, 8], 'one racetrack per assigned approach turn; none assigned is drawn at 6');
  assert.equal(c3.portHolding, false, 'Case III holds in marshal, not port holding');
  assert.equal(c3.tanker, true);
  const c1 = m.occupancy({ caseValue: 'I', rows: [{ kind: 'hold' }], tankerOnStation: false });
  assert.equal(c1.portHolding, true);
  const at = (e, n, altFt) => () => ({ at: { e, n }, altFt });
  assert.equal(m.occupancy({ caseValue: 'I', rows: [{ kind: 'pattern' }], contactOf: () => null }).landing, true, 'no contact: the landing pattern');
  const spin = m.occupancy({ caseValue: 'I', rows: [{ kind: 'pattern' }], contactOf: at(1, 2, 1200) });
  assert.deepEqual([spin.spin, spin.landing], [true, false], 'within 3.5 nm at 1,200 ft: spinning');
  const low = m.occupancy({ caseValue: 'I', rows: [{ kind: 'pattern' }], contactOf: at(-1.2, -0.5, 600) });
  assert.deepEqual([low.spin, low.landing], [false, true], 'the downwind at 600 ft');
  const far = m.occupancy({ caseValue: 'I', rows: [{ kind: 'pattern' }], contactOf: at(0, -6, 1500) });
  assert.deepEqual([far.spin, far.landing], [false, true]);
});

test('occupied follows the Strips through a recovery: pattern appears with the Strip and is gone after it', () => {
  const fd = { identity: { callsign: 'A' }, military: { carrier: { sideNumber: '201', approachTurnNm: 8 } } };
  const view = { derived: { MAIN: [] }, slots: { MAIN: [] } };
  const rowsOf = (strips) => board.buildBoard({ view, strips, flightDataOf: () => fd, dmeOf: null, now: 0 }).rows;
  const s = (state, type = 'FINAL', facilityId = 'CARRIER') => ({ stripId: 's1', flightDataId: 'f1', stripType: type, state, facilityId, ownerPositionId: 'CV_APP1' });
  const occ = (strips) => m.occupancy({ caseValue: 'III', rows: rowsOf(strips), tankerOnStation: false });
  assert.deepEqual(occ([s('ON_FINAL')]).bolterTurns, []);
  assert.deepEqual(occ([s('BOLTER_WAVEOFF')]).bolterTurns, [8]);
  assert.deepEqual(occ([s('ON_FINAL')]).bolterTurns, [], 'back on final: gone');
  assert.deepEqual(occ([{ ...s('BOLTER_WAVEOFF'), state: 'DROPPED' }]).bolterTurns, []);
  assert.equal(m.occupancy({ caseValue: 'I', rows: rowsOf([s('IN_PATTERN', 'PATTERN', 'INCIRLIK')]) }).landing, false,
    'an airfield\'s PATTERN Strip is not in the carrier\'s pattern');
  assert.equal(m.occupancy({ caseValue: 'I', rows: rowsOf([s('IN_PATTERN', 'PATTERN')]) }).landing, true);
});

test('declutter: labels that would overlap are moved, the first keeps its place, a moved label is marked', () => {
  const labels = [0, 1, 2, 3].map((i) => ({ id: `a${i}`, x: 100, y: 100 + i * 4, w: 60, h: 13 }));
  const out = m.declutter(labels, { dx: 9, dy: 10 });
  assert.equal(out.get('a0').moved, false);
  assert.deepEqual([out.get('a0').x, out.get('a0').y], [109, 90]);
  const boxes = labels.map((l) => ({ ...out.get(l.id), w: l.w, h: l.h }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `labels ${i} and ${j} overlap`);
    }
  }
  assert.ok(labels.slice(1).every((l) => out.get(l.id).moved));
  const apart = m.declutter([{ id: 'x', x: 0, y: 0, w: 50, h: 13 }, { id: 'y', x: 0, y: 200, w: 50, h: 13 }]);
  assert.equal(apart.get('y').moved, false, 'labels far apart stay put');
});

test('declutter: a label keeps clear of the obstacles (the ship, the symbols, the stack\'s name)', () => {
  const out = m.declutter([{ id: 'a', x: 100, y: 100, w: 60, h: 13 }], { dx: 9, dy: 10, obstacles: [{ x: 105, y: 85, w: 30, h: 20 }] });
  const b = out.get('a');
  assert.equal(b.moved, true);
  assert.ok(!(b.x < 135 && 105 < b.x + 60 && b.y < 105 && 85 < b.y + 13));
});
