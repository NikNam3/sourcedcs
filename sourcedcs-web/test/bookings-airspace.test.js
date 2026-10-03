'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tokens, boot, fakeRegistry, def, iso } = require('./helpers-routes');

const REG = () => fakeRegistry({ Syria: [def('MOA-1', 5000, 25000), def('OPEN-1', null, null)], Caucasus: [def('MOA-1', 1000, 2000)] });
const body = (o) => Object.assign({ resourceType: 'airspace', airspaceRef: { theater: 'Syria', airspaceId: 'MOA-1' }, startTime: iso(1), endTime: iso(2), altitude: 10000 }, o);

test('books an airspace inside its limits; the booking stores airspaceRef', async () => {
  const h = await boot(REG());
  try {
    const r = await h.call('POST', '/bookings', tokens.member, body());
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.airspaceRef, { theater: 'Syria', airspaceId: 'MOA-1' });
    assert.equal(r.body.resourceType, 'airspace');
    assert.equal(r.body.altitude, 10000);
    assert.equal(h.st.bookings.length, 1);
  } finally { h.stop(); }
});

test('altitude outside the registry limits is refused; null limits mean unbounded; bounds are inclusive', async () => {
  const h = await boot(REG());
  try {
    assert.equal((await h.call('POST', '/bookings', tokens.member, body({ altitude: 4000 }))).status, 400);
    assert.equal((await h.call('POST', '/bookings', tokens.member, body({ altitude: 25001 }))).status, 400);
    assert.equal((await h.call('POST', '/bookings', tokens.member, body({ altitude: 25000 }))).status, 201);
    const open = body({ airspaceRef: { theater: 'Syria', airspaceId: 'OPEN-1' }, altitude: 45000 });
    assert.equal((await h.call('POST', '/bookings', tokens.member, open)).status, 201);
    assert.equal((await h.call('POST', '/bookings', tokens.member, body({ altitude: 'abc' }))).status, 400);
  } finally { h.stop(); }
});

test('the same airspace id in another theater has its own limits', async () => {
  const h = await boot(REG());
  try {
    const r = await h.call('POST', '/bookings', tokens.member, body({ airspaceRef: { theater: 'Caucasus', airspaceId: 'MOA-1' }, altitude: 10000 }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /1000 ft to 2000 ft/);
  } finally { h.stop(); }
});

test('the 999 ft deconfliction rule applies per airspace and window', async () => {
  const h = await boot(REG());
  try {
    assert.equal((await h.call('POST', '/bookings', tokens.member, body())).status, 201);
    assert.equal((await h.call('POST', '/bookings', tokens.member2, body({ altitude: 10500 }))).status, 409);
    assert.equal((await h.call('POST', '/bookings', tokens.member2, body({ altitude: 10999 }))).status, 201);
    assert.equal((await h.call('POST', '/bookings', tokens.member2, body({ altitude: 10000, startTime: iso(5), endTime: iso(6) }))).status, 201);
  } finally { h.stop(); }
});

test('unknown airspace is 404; crc-sync down is 503 for airspace but controller bookings still work', async () => {
  const h = await boot(fakeRegistry({ Syria: 'DOWN' }), { resources: { controllers: [{ id: 'gci', name: 'GCI', frequency: '265.5' }] } });
  try {
    assert.equal((await h.call('POST', '/bookings', tokens.member, body())).status, 503);
    const c = await h.call('POST', '/bookings', tokens.member, { resourceType: 'controller', resourceId: 'gci', startTime: iso(1), endTime: iso(2) });
    assert.equal(c.status, 201);
  } finally { h.stop(); }
  const h2 = await boot(REG());
  try {
    assert.equal((await h2.call('POST', '/bookings', tokens.member, body({ airspaceRef: { theater: 'Syria', airspaceId: 'NOPE' } }))).status, 404);
  } finally { h2.stop(); }
});

test('creating a booking on a legacy range is refused', async () => {
  const h = await boot(REG(), { resources: { ranges: [{ id: 'r1', name: 'R1', frequency: '251', minAltitude: 0, maxAltitude: 9999 }] } });
  try {
    const r = await h.call('POST', '/bookings', tokens.member, { resourceType: 'range', resourceId: 'r1', startTime: iso(1), endTime: iso(2), altitude: 5000 });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'legacy range: migrate it to an airspace');
  } finally { h.stop(); }
});

test('editing an airspace booking re-checks the limits; owner only', async () => {
  const h = await boot(REG());
  try {
    const id = (await h.call('POST', '/bookings', tokens.member, body())).body.id;
    assert.equal((await h.call('PUT', '/bookings/' + id, tokens.member2, { altitude: 12000 })).status, 403);
    assert.equal((await h.call('PUT', '/bookings/' + id, tokens.member, { altitude: 30000 })).status, 400);
    const ok = await h.call('PUT', '/bookings/' + id, tokens.member, { altitude: 12000 });
    assert.equal(ok.status, 200); assert.equal(ok.body.altitude, 12000);
  } finally { h.stop(); }
});

test('cancel works while crc-sync is down', async () => {
  const reg = REG();
  const h = await boot(reg);
  try {
    const id = (await h.call('POST', '/bookings', tokens.member, body())).body.id;
    reg.listAirspaces = async () => ({ ok: false, reason: 'down' });
    assert.equal((await h.call('DELETE', '/bookings/' + id, tokens.member)).status, 200);
  } finally { h.stop(); }
});

test('service endpoint: token required, shape, only future airspace bookings, no user ids', async () => {
  process.env.AIRSPACE_SERVICE_TOKEN = 'svc-secret';
  delete require.cache[require.resolve('../auth.js')];
  delete require.cache[require.resolve('../routes/bookings.js')];
  const h = await boot(REG(), { bookings: [
    { id: 1, resourceType: 'airspace', airspaceRef: { theater: 'Syria', airspaceId: 'MOA-1' }, startTime: iso(3), endTime: iso(4), altitude: 8000, bookedBy: { sub: 'secret-sub', name: 'Viper' } },
    { id: 2, resourceType: 'airspace', airspaceRef: { theater: 'Syria', airspaceId: 'MOA-1' }, startTime: iso(-4), endTime: iso(-3), altitude: 8000, bookedBy: { sub: 's', name: 'Old' } },
    { id: 3, resourceType: 'controller', resourceId: 'gci', startTime: iso(3), endTime: iso(4), bookedBy: { sub: 's', name: 'C' } },
  ] });
  try {
    assert.equal((await h.call('GET', '/bookings/service/upcoming')).status, 401);
    assert.equal((await h.call('GET', '/bookings/service/upcoming', 'wrong')).status, 401);
    assert.equal((await h.call('GET', '/bookings/service/upcoming', tokens.admin)).status, 401);
    const r = await h.call('GET', '/bookings/service/upcoming', 'svc-secret');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 1);
    assert.deepEqual(Object.keys(r.body[0]).sort(), ['airspaceRef', 'altitudeFt', 'by', 'endUtc', 'startUtc']);
    assert.equal(r.body[0].by, 'Viper');
    assert.ok(!JSON.stringify(r.body).includes('secret-sub'));
  } finally {
    h.stop();
    delete process.env.AIRSPACE_SERVICE_TOKEN;
    delete require.cache[require.resolve('../auth.js')];
    delete require.cache[require.resolve('../routes/bookings.js')];
  }
});
