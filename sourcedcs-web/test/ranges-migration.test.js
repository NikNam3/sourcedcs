'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tokens, boot, fakeRegistry, def, iso } = require('./helpers-routes');

const REG = () => fakeRegistry({ Syria: [def('MOA-1', 5000, 25000), def('MOA-2', 5000, 25000)] });
const range = (id) => ({ id, name: id.toUpperCase(), frequency: '251.000', minAltitude: 0, maxAltitude: 40000 });
const bk = (id, rangeId, alt, s, e, extra) => Object.assign({ id, resourceType: 'range', resourceId: rangeId, altitude: alt, startTime: iso(s), endTime: iso(e), bookedBy: { sub: 'u1', name: 'Viper' }, createdAt: iso(-50) }, extra);
const TARGET = { theater: 'Syria', airspaceId: 'MOA-1' };

test('maps one range: bookings (past and future) move, the range is removed, history keeps its meaning', async () => {
  const reg = REG();
  const h = await boot(reg, { resources: { ranges: [range('r1'), range('r2')] }, bookings: [bk(1, 'r1', 10000, 1, 2), bk(2, 'r1', 12000, -10, -9), bk(3, 'r2', 9000, 1, 2)] });
  try {
    const r = await h.call('POST', '/booking-resources/ranges/r1/migrate', tokens.admin, TARGET);
    assert.equal(r.status, 200);
    assert.equal(r.body.moved, 2);
    assert.deepEqual(reg.calls.fresh, ['Syria'], 'one fresh read, not the cache');
    const moved = h.st.bookings.filter(b => b.resourceType === 'airspace');
    assert.deepEqual(moved.map(b => b.id), [1, 2]);
    for (const b of moved) {
      assert.deepEqual(b.airspaceRef, TARGET);
      assert.equal(b.migratedFromRangeId, 'r1');
      assert.equal(b.resourceId, undefined);
    }
    assert.equal(moved[0].altitude, 10000);
    assert.equal(moved[0].bookedBy.name, 'Viper');
    assert.equal(h.st.bookings.find(b => b.id === 3).resourceType, 'range');
    assert.deepEqual(h.st.bookingResources.ranges.map(x => x.id), ['r2']);
    const legacy = await h.call('GET', '/booking-resources/ranges/legacy', tokens.admin);
    assert.deepEqual(legacy.body.ranges.map(x => x.id), ['r2']);
    assert.equal(legacy.body.ranges[0].bookingCount, 1);
    assert.equal(legacy.body.ranges[0].futureBookingCount, 1);
    assert.ok(h.saves.length >= 2);
  } finally { h.stop(); }
});

test('target unknown: 409, nothing changed', async () => {
  const h = await boot(REG(), { resources: { ranges: [range('r1')] }, bookings: [bk(1, 'r1', 10000, 1, 2)] });
  try {
    const r = await h.call('POST', '/booking-resources/ranges/r1/migrate', tokens.admin, { theater: 'Syria', airspaceId: 'NOPE' });
    assert.equal(r.status, 409);
    assert.equal(r.body.refusals[0].kind, 'UNKNOWN_TARGET');
    assert.equal(h.st.bookings[0].resourceType, 'range');
    assert.equal(h.st.bookingResources.ranges.length, 1);
  } finally { h.stop(); }
});

test('altitude outside the band: refused with the list and all-or-nothing, then allowed with allowOutOfBand', async () => {
  const h = await boot(REG(), { resources: { ranges: [range('r1')] }, bookings: [bk(1, 'r1', 10000, 1, 2), bk(2, 'r1', 3000, 5, 6)] });
  try {
    const r = await h.call('POST', '/booking-resources/ranges/r1/migrate', tokens.admin, TARGET);
    assert.equal(r.status, 409);
    assert.deepEqual(r.body.refusals.map(x => [x.kind, x.bookingId]), [['OUT_OF_BAND', 2]]);
    assert.ok(h.st.bookings.every(b => b.resourceType === 'range'), 'the in-band booking did not move either');
    assert.equal(h.st.bookingResources.ranges.length, 1);
    const ok = await h.call('POST', '/booking-resources/ranges/r1/migrate', tokens.admin, Object.assign({ allowOutOfBand: true }, TARGET));
    assert.equal(ok.status, 200);
    assert.ok(h.st.bookings.every(b => b.resourceType === 'airspace'));
  } finally { h.stop(); }
});

test('two ranges into one airspace: the second trips the 999 ft rule, nothing moves; fixing a booking lets it through', async () => {
  const h = await boot(REG(), { resources: { ranges: [range('r1'), range('r2')] }, bookings: [bk(1, 'r1', 10000, 1, 3), bk(2, 'r2', 10500, 2, 4)] });
  try {
    assert.equal((await h.call('POST', '/booking-resources/ranges/r1/migrate', tokens.admin, TARGET)).status, 200);
    const r = await h.call('POST', '/booking-resources/ranges/r2/migrate', tokens.admin, TARGET);
    assert.equal(r.status, 409);
    assert.deepEqual(r.body.refusals.map(x => [x.kind, x.bookingId, x.otherBookingId]), [['DECONFLICTION', 2, 1]]);
    assert.equal(h.st.bookings.find(b => b.id === 2).resourceType, 'range');
    assert.ok(h.st.bookingResources.ranges.some(x => x.id === 'r2'));
    h.st.bookings.find(b => b.id === 2).altitude = 12000;   /* the admin edits it first */
    assert.equal((await h.call('POST', '/booking-resources/ranges/r2/migrate', tokens.admin, TARGET)).status, 200);
  } finally { h.stop(); }
});

test('past bookings that overlapped in the past do not block a merge', async () => {
  const h = await boot(REG(), { resources: { ranges: [range('r1'), range('r2')] }, bookings: [bk(1, 'r1', 10000, -5, -3), bk(2, 'r2', 10200, -4, -2)] });
  try {
    assert.equal((await h.call('POST', '/booking-resources/ranges/r1/migrate', tokens.admin, TARGET)).status, 200);
    assert.equal((await h.call('POST', '/booking-resources/ranges/r2/migrate', tokens.admin, TARGET)).status, 200);
  } finally { h.stop(); }
});

test('idempotent: a re-run answers 200 alreadyMigrated; a never-existing range is 404', async () => {
  const h = await boot(REG(), { resources: { ranges: [range('r1')] }, bookings: [bk(1, 'r1', 10000, 1, 2)] });
  try {
    await h.call('POST', '/booking-resources/ranges/r1/migrate', tokens.admin, TARGET);
    const again = await h.call('POST', '/booking-resources/ranges/r1/migrate', tokens.admin, TARGET);
    assert.equal(again.status, 200);
    assert.equal(again.body.alreadyMigrated, true);
    assert.equal(again.body.moved, 1);
    assert.equal((await h.call('POST', '/booking-resources/ranges/zzz/migrate', tokens.admin, TARGET)).status, 404);
  } finally { h.stop(); }
});

test('role gate: members are refused on both migration routes; no login is 401', async () => {
  const h = await boot(REG(), { resources: { ranges: [range('r1')] } });
  try {
    assert.equal((await h.call('POST', '/booking-resources/ranges/r1/migrate', tokens.member, TARGET)).status, 403);
    assert.equal((await h.call('GET', '/booking-resources/ranges/legacy', tokens.member)).status, 403);
    assert.equal((await h.call('POST', '/booking-resources/ranges/r1/migrate', null, TARGET)).status, 401);
    assert.equal(h.st.bookingResources.ranges.length, 1);
  } finally { h.stop(); }
});

test('crc-sync down: 503 and nothing changes; missing target fields are 400', async () => {
  const h = await boot(fakeRegistry({ Syria: 'DOWN' }), { resources: { ranges: [range('r1')] }, bookings: [bk(1, 'r1', 10000, 1, 2)] });
  try {
    assert.equal((await h.call('POST', '/booking-resources/ranges/r1/migrate', tokens.admin, TARGET)).status, 503);
    assert.equal((await h.call('POST', '/booking-resources/ranges/r1/migrate', tokens.admin, {})).status, 400);
    assert.equal(h.st.bookings[0].resourceType, 'range');
  } finally { h.stop(); }
});

test('legacy range routes: create is always 410; update and delete are 410 once none remain', async () => {
  const h = await boot(REG(), { resources: { ranges: [range('r1')] }, bookings: [bk(1, 'r1', 10000, 1, 2)] });
  try {
    assert.equal((await h.call('POST', '/booking-resources/ranges', tokens.admin, { id: 'x', name: 'X', frequency: '1', minAltitude: 0, maxAltitude: 1 })).status, 410);
    assert.equal((await h.call('PUT', '/booking-resources/ranges/r1', tokens.admin, { name: 'New' })).status, 200);
    await h.call('POST', '/booking-resources/ranges/r1/migrate', tokens.admin, TARGET);
    assert.equal((await h.call('PUT', '/booking-resources/ranges/r1', tokens.admin, { name: 'New' })).status, 410);
    assert.equal((await h.call('DELETE', '/booking-resources/ranges/r1', tokens.admin)).status, 410);
    assert.equal((await h.call('GET', '/booking-resources/ranges/legacy', tokens.admin)).body.ranges.length, 0);
  } finally { h.stop(); }
});
