'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tokens, boot, fakeRegistry, def, iso } = require('./helpers-routes');

const REG = () => fakeRegistry({ Syria: [def('MOA-1', 5000, 25000), def('OPEN-1', null, null)], Caucasus: [def('MOA-1', 1000, 2000)] });
const body = (o) => Object.assign({ resourceType: 'airspace', airspaceRef: { theater: 'Syria', airspaceId: 'MOA-1' }, startTime: iso(1), endTime: iso(2), altitude: 10000 }, o);

/* Its own file: bookingLimiter allows 20 POSTs a minute per process. */
test('an unlimited airspace still needs a whole number of feet in 0..100000 (the schema bounds)', async () => {
  const h = await boot(REG());
  try {
    const open = (altitude) => body({ airspaceRef: { theater: 'Syria', airspaceId: 'OPEN-1' }, altitude });
    for (const bad of [-5000, 100001, 1500.5, '']) {
      assert.equal((await h.call('POST', '/bookings', tokens.member, open(bad))).status, 400, String(bad));
    }
    assert.equal((await h.call('POST', '/bookings', tokens.member, open(100000))).status, 201);
  } finally { h.stop(); }
});
