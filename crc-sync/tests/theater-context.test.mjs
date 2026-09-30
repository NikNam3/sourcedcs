import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { createRequire } from 'module';
import WsHub from '../src/ws-hub.js';
import TrackStore from '../src/tracks.js';
import CollaborativeStore from '../src/collab-store.js';

/* docs/adr/0085: the theater's facts on the server, on the wire, and on the
 * client. The client half (crc-desktop/app/public/js/magnetic.js) is loaded
 * here as-is, so the parity checks run against the file the app ships. */

const { TheaterContext, DEFAULT_TRANSITION_ALT_FT } = await import('../src/theater-context.js');
const { loadTheaters } = await import('../src/theaters.js');
const M = await import('../src/magnetic.js');

const require = createRequire(import.meta.url);
const client = require(path.join(import.meta.dirname, '../../crc-desktop/app/public/js/magnetic.js'));

const THEATERS = loadTheaters(path.join(import.meta.dirname, '../config/theaters.json'));
const JAN_2026 = Date.UTC(2026, 0, 15, 10);

function clock(ms = JAN_2026, source = 'MISSION') {
  return { ms, source, now() { return this.ms; } };
}

// A Syria mission's airfields, roughly: Incirlik, Damascus, Ramat David, Larnaca.
const SYRIA = {
  theatre: 'Syria',
  airports: [
    { name: 'Incirlik', lat: 37.00, lon: 35.43 },
    { name: 'Damascus', lat: 33.41, lon: 36.52 },
    { name: 'Ramat David', lat: 32.67, lon: 35.18 },
    { name: 'Larnaca', lat: 34.88, lon: 33.63 },
  ],
};

function syria(c = clock()) {
  const ctx = new TheaterContext({ theaters: THEATERS, clock: c });
  ctx.setMission(SYRIA);
  return ctx;
}

// ── server ───────────────────────────────────────────────────────────────

test('transition altitude comes from the theater; an unknown theater gets the old 18,000 ft', () => {
  assert.equal(syria().transitionAltFt(), 10000);
  const ctx = new TheaterContext({ theaters: THEATERS, clock: clock() });
  assert.equal(ctx.transitionAltFt(), DEFAULT_TRANSITION_ALT_FT);
  ctx.setMission({ theatre: 'NoSuchMap', airports: [] });
  assert.equal(ctx.transitionAltFt(), 18000);
});

test('a typed magnetic value becomes true with the model at that position and mission date, and back', () => {
  const ctx = syria();
  const v = M.variationAt(37, 35.43, Math.floor(JAN_2026 / 86400000) * 86400000);
  assert.ok(Math.abs(ctx.variationAt(37, 35.43) - v) < 1e-12);
  const t = ctx.magneticToTrue(50, 37, 35.43);
  assert.ok(Math.abs(t - (50 + v)) < 1e-9);
  assert.ok(Math.abs(ctx.trueToMagnetic(t, 37, 35.43) - 50) < 1e-9);
});

test('a DCS grid course → magnetic goes through convergence, then variation; unknown projection → null', () => {
  const ctx = syria();
  const [lat, lon] = [37, 35.43];
  const want = M.normDeg(90 + M.convergenceAt(lat, lon, THEATERS.Syria) - ctx.variationAt(lat, lon));
  assert.ok(Math.abs(ctx.gridToMagnetic(90, lat, lon) - want) < 1e-9);
  const kola = new TheaterContext({ theaters: THEATERS, clock: clock() });
  kola.setMission({ theatre: 'Kola', airports: [{ lat: 68, lon: 33 }] });
  assert.equal(kola.gridToMagnetic(90, 68, 33), null, 'Kola has no central meridian in the table yet');
});

test('the theater override reaches every conversion', () => {
  const theaters = { ...THEATERS, Syria: { ...THEATERS.Syria, magneticVariation: { fixedDeg: 4 } } };
  const ctx = new TheaterContext({ theaters, clock: clock() });
  ctx.setMission(SYRIA);
  assert.equal(ctx.variationAt(33, 36), 4);
  assert.equal(ctx.magneticToTrue(90, 33, 36), 94);
  const body = ctx.wireBody();
  assert.equal(body.magnetic.source, 'FIXED');
  assert.equal(body.magnetic.fixedDeg, 4);
});

test('the date moves variation: a new mission day, or the first mission sample after the wall clock, is a change', () => {
  const c = clock(JAN_2026, 'WALL');
  const ctx = syria(c);
  assert.equal(ctx.noteClock(), false, 'nothing changed');
  c.source = 'MISSION';
  assert.equal(ctx.noteClock(), true);
  c.ms += 3600e3;
  assert.equal(ctx.noteClock(), false, 'same day');
  c.ms += 86400e3;
  assert.equal(ctx.noteClock(), true);
  c.ms = Date.UTC(2016, 5, 1);
  assert.equal(ctx.noteClock(), true);
  assert.equal(ctx.wireBody().magnetic.modelDateValid, false);
});

// ── the wire ─────────────────────────────────────────────────────────────

const OPEN = 1;
function fakeWs() {
  const sent = [];
  return { readyState: OPEN, send: (raw) => sent.push(JSON.parse(raw)), sent, on() {} };
}
function hubWith(theater) {
  return new WsHub({ trackStore: new TrackStore(), collabStore: new CollaborativeStore(), theater });
}

const THEATER_KEYS = ['version', 'type', 'theatre', 'transitionAltFt', 'dateMs', 'dateSource', 'magnetic', 'convergence'].sort();

test('`theater` goes out on connect with exactly its keys — its own message, not a field of game-time', () => {
  const hub = hubWith(syria());
  const ws = fakeWs();
  hub._onConnect(ws, { crcUser: { name: 'c1' } });
  const msg = ws.sent.find(m => m.type === 'theater');
  assert.ok(msg, 'no theater message on connect');
  assert.deepEqual(Object.keys(msg).sort(), THEATER_KEYS);
  assert.deepEqual(Object.keys(msg.magnetic).sort(), ['fixedDeg', 'grid', 'modelDateValid', 'source']);
  assert.deepEqual(Object.keys(msg.convergence), ['tmCentralMeridianDeg']);
  assert.equal(msg.theatre, 'Syria');
  assert.equal(msg.transitionAltFt, 10000);
  assert.equal(msg.convergence.tmCentralMeridianDeg, 39);
  const gt = ws.sent.find(m => m.type === 'game-time');
  assert.deepEqual(Object.keys(gt).sort(), ['source', 'type', 'version', 'zuluMs'], 'game-time is unchanged');
  assert.equal(ws.sent.some(m => m.type === 'theater-settings'), false, 'the old message is gone');
});

test('the grid covers every airfield with room to spare, and stays small', () => {
  const { grid } = syria().wireBody().magnetic;
  for (const a of SYRIA.airports) {
    assert.ok(a.lat >= grid.latMin + 2 && a.lat <= grid.latMin + (grid.rows - 1) * grid.stepDeg - 2, a.name);
    assert.ok(a.lon >= grid.lonMin + 2 && a.lon <= grid.lonMin + (grid.cols - 1) * grid.stepDeg - 2, a.name);
  }
  assert.equal(grid.deg.length, grid.rows * grid.cols);
  assert.ok(JSON.stringify(grid).length < 4000, 'a few hundred numbers, not thousands');
});

test('no mission yet: no grid, and the client says unknown rather than guessing', () => {
  const ctx = new TheaterContext({ theaters: THEATERS, clock: clock() });
  const body = ctx.wireBody();
  assert.equal(body.theatre, null);
  assert.equal(body.magnetic.grid, null);
  client.applyTheaterFacts(body);
  assert.equal(client.toMagneticDisplay(90, 35, 36), null);
  assert.equal(client.magneticText(90, 35, 36), '---');
});

test('`theaterSettingsSet` is no longer a message: nothing changes and nothing is broadcast', () => {
  const ctx = syria();
  const hub = hubWith(ctx);
  const ws = fakeWs();
  hub._wss = { clients: [ws] };
  hub._onMessage(ws, { controllerId: 'c1', lastSent: new Map(), labelRevs: new Map() },
    JSON.stringify({ type: 'theaterSettingsSet', transitionAltFt: 5000, hdgCorrection: 7 }));
  assert.deepEqual(ws.sent, []);
  assert.equal(ctx.transitionAltFt(), 10000);
});

test('broadcastTheater sends the current body to everyone', () => {
  const hub = hubWith(syria());
  const ws = fakeWs();
  hub._wss = { clients: [ws] };
  hub.broadcastTheater();
  assert.equal(ws.sent.length, 1);
  assert.equal(ws.sent[0].type, 'theater');
});

// ── client parity ────────────────────────────────────────────────────────

test('convergence parity: the client\'s gridConvergenceDeg equals the server\'s convergenceAt, theater by theater', () => {
  for (const [name, entry] of Object.entries(THEATERS)) {
    const ctx = new TheaterContext({ theaters: THEATERS, clock: clock() });
    ctx.setMission({ theatre: name, airports: [] });
    client.applyTheaterFacts(ctx.wireBody());
    for (const [lat, lon] of [[33, 30], [35.5, 36.2], [-51.7, -59], [68, 33], [36, -115], [49.2, -0.5], [13.4, 144.8]]) {
      const s = M.convergenceAt(lat, lon, entry);
      const c = client.gridConvergenceDeg(lat, lon);
      if (s == null) assert.equal(c, null, `${name} ${lat},${lon}`);
      else assert.ok(Math.abs(s - c) < 1e-12, `${name} ${lat},${lon}: ${s} vs ${c}`);
    }
  }
});

test('variation parity: the client reads the server\'s model to within 0.05° anywhere over the airfields', () => {
  const ctx = syria();
  client.applyTheaterFacts(ctx.wireBody());
  let worst = 0;
  for (let lat = 32.5; lat <= 37.5; lat += 0.37) {
    for (let lon = 33.3; lon <= 37; lon += 0.41) {
      worst = Math.max(worst, Math.abs(client.magneticVariationAt(lat, lon) - ctx.variationAt(lat, lon)));
    }
  }
  assert.ok(worst < 0.05, `worst ${worst}`);
});

test('toMagneticDisplay rounds the server\'s true→magnetic, and shows 0 as 000', () => {
  const ctx = syria();
  client.applyTheaterFacts(ctx.wireBody());
  for (const deg of [0, 5, 90, 181.4, 359.9]) {
    const server = ctx.trueToMagnetic(deg, 35, 36);
    const shown = client.toMagneticDisplay(deg, 35, 36);
    const d = Math.abs(((shown - server + 540) % 360) - 180);
    assert.ok(d <= 0.55, `${deg}: ${shown} vs ${server}`);
  }
  const v = client.magneticVariationAt(35, 36);
  assert.equal(client.magneticText(v, 35, 36), '000');
  assert.ok(client.toMagneticDisplay(90) != null, 'no position: the theater centre');
});
