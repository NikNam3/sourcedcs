import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import crcLog from '../src/log.js';

// The atmosphere poll's reference point is the theater's `weatherRef` (config/theaters.json, DATA-3), not a
// literal 41/41: no poll before the theater is known, the theater's point until the first airport, then the airport.
const require = createRequire(import.meta.url);
const { loadTheaters } = require('../src/theaters.js');
const GrpcClient = require('../src/grpc-client.js');
const SHIPPED = path.join(import.meta.dirname, '../config/theaters.json');

function clientWithAtm(theaters) {
  const calls = [];
  const c = new GrpcClient({ theaters });
  c._atmSvc = { GetTemperatureAndPressure: (req, cb) => { calls.push(req.position); cb(null, { pressure: 101325, temperature: 288.15 }); } };
  return { c, calls };
}

test('the shipped table gives every theater a weatherRef near its centre', () => {
  const th = loadTheaters();
  assert.equal(Object.keys(th).length, 14);
  for (const [name, t] of Object.entries(th)) {
    assert.ok(t.weatherRef && Math.abs(t.weatherRef.lat) <= 90 && Math.abs(t.weatherRef.lon) <= 180, name);
  }
  assert.deepEqual(th.Syria.weatherRef, { lat: 34.5, lon: 37.0 });
});

test('loadTheaters: an invalid weatherRef in an override is dropped with a warning; a shipped theater without one stops start-up', (t) => {
  const cap = crcLog.capture(); t.after(() => cap.stop());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theaters-wref-'));
  const f = path.join(dir, 'theaters.json');
  fs.writeFileSync(f, JSON.stringify({ theaters: { Syria: { utcOffsetHours: 3, weatherRef: { lat: 99, lon: 0 } } } }));
  assert.deepEqual(loadTheaters(f), { Syria: { utcOffsetHours: 3 } });
  // Shipped config without it: a child process reading a config dir that lacks the field.
  const cfg = path.join(dir, 'config');
  fs.mkdirSync(cfg);
  const shipped = JSON.parse(fs.readFileSync(SHIPPED, 'utf8'));
  delete shipped.theaters.Kola.weatherRef;
  fs.writeFileSync(path.join(cfg, 'theaters.json'), JSON.stringify(shipped));
  const r = require('node:child_process').spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.resolve('src/theaters.js'))}).loadTheaters()`], {
    encoding: 'utf8', env: { ...process.env, CRCSYNC_CONFIG_DIR: cfg, CRCSYNC_STATE_DIR: path.join(dir, 'state') },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /"Kola" needs weatherRef/);
});

test('no weather poll before the theater is known; then the theater point; then the first airport', async (t) => {
  const cap = crcLog.capture(); t.after(() => cap.stop());
  const { c, calls } = clientWithAtm(loadTheaters());
  c._fetchWeather();
  assert.equal(calls.length, 0, 'theater unknown: no poll, the ISA stands');
  assert.equal(c.getWeather ? c.getWeather().pressurePa : 101325, 101325);
  c._useTheaterWeatherRef('UNKNOWN');
  assert.equal(calls.length, 0, 'a theater the table lacks is still unknown');
  c._useTheaterWeatherRef('Syria');
  assert.deepEqual(calls, [{ lat: 34.5, lon: 37.0, alt: 0 }], 'asked at once, at Syria\'s point');
  c.fetchMissionData = async () => ({ airports: [{ name: 'Incirlik', lat: 37.0, lon: 35.4 }], waypoints: [], drawings: [], theatre: 'Syria' });
  c._fetchMissionWithRetry();
  await new Promise((r) => setTimeout(r, 20));
  c._fetchWeather();
  assert.deepEqual(calls.at(-1), { lat: 37.0, lon: 35.4, alt: 0 }, 'the first airport replaces the theater point');
  c.close();
});
