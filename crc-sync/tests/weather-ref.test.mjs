import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crcLog from '../src/log.js';

// The atmosphere poll asks for no weather before mission data has arrived, and then at the first airport (DATA-3:
// no literal 41/41 reference point, no theater table point; the theater and the airports arrive in the same fetch).
const require = createRequire(import.meta.url);
const GrpcClient = require('../src/grpc-client.js');

test('no weather request goes out before mission data; then the first airport is asked at once', async (t) => {
  const cap = crcLog.capture(); t.after(() => cap.stop());
  const calls = [];
  const c = new GrpcClient();
  c._atmSvc = { GetTemperatureAndPressure: (req, cb) => { calls.push(req.position); cb(null, { pressure: 99000, temperature: 290 }); } };
  c._startWeatherPoll();
  c._fetchWeather();
  assert.equal(calls.length, 0, 'before mission data: no poll, the ISA stands');
  assert.equal(c.getWeather().pressurePa, 101325);
  c.fetchMissionData = async () => ({ airports: [], waypoints: [], drawings: [], theatre: 'Syria' });
  c._fetchMissionWithRetry();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.length, 0, 'a theater with no airports yet is still no reference');
  c.fetchMissionData = async () => ({ airports: [{ name: 'Incirlik', lat: 37.0, lon: 35.4 }], waypoints: [], drawings: [], theatre: 'Syria' });
  c._fetchMissionWithRetry();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls, [{ lat: 37.0, lon: 35.4, alt: 0 }]);
  assert.equal(c.getWeather().pressurePa, 99000);
  c.close();
});
