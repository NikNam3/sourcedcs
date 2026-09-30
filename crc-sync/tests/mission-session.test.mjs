import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Which mission are we in (docs/adr/0086, decisions.md S-R2-2).

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-session-'));
const { MissionSession, missionFingerprint, CLOCK_STEP_BACK_MS } = await import('../src/mission-session.js');

const MIN = 60000;
const T0 = Date.UTC(2016, 5, 21, 2, 40, 0); // mission Zulu
const WALL0 = Date.UTC(2026, 8, 30, 19, 0, 0);

const SYRIA = { theatre: 'Syria', waypoints: [{ name: 'INCIRLIK' }, { name: 'ADANA' }], drawings: [{ name: 'MOA 1' }], airports: [] };
const SYRIA_OTHER = { ...SYRIA, drawings: [{ name: 'MOA 2' }] };
const CAUCASUS = { theatre: 'Caucasus', waypoints: [{ name: 'KUTAISI' }], drawings: [], airports: [] };

function clocks({ mission = T0, wall = WALL0, source = 'MISSION' } = {}) {
  const c = { m: mission, w: wall, source };
  c.clock = { now: () => c.m, get source() { return c.source; } };
  c.wallNow = () => c.w;
  c.advance = (ms) => { c.m += ms; c.w += ms; };
  return c;
}

let n = 0;
const freshPath = () => path.join(tmpDir, `s-${++n}.json`);

function quiet(fn) {
  const { log, warn } = console;
  console.log = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; }
}

function build(c, p = freshPath()) {
  const s = quiet(() => new MissionSession({ path: p, clock: c.clock, wallNow: c.wallNow }));
  const rolls = [];
  s.onNewSession((session, previous) => rolls.push({ seq: session.seq, reason: session.reason, previous: previous.seq }));
  return { s, rolls, p };
}

/** A mission running for `ms`, with the 5 s game-time poll feeding the clock. */
function run(c, s, ms) {
  for (let t = 0; t < ms; t += 5000) { c.advance(5000); quiet(() => s.observeClock()); }
}

test('the fingerprint (L1\'s missionKeyOf, hoisted) is stable for the same mission and differs for another', () => {
  assert.equal(missionFingerprint(SYRIA), missionFingerprint(structuredClone(SYRIA)));
  assert.notEqual(missionFingerprint(SYRIA), missionFingerprint(SYRIA_OTHER));
  assert.notEqual(missionFingerprint(SYRIA), missionFingerprint({ ...SYRIA, drawings: [] }));
  assert.match(missionFingerprint(CAUCASUS), /^Caucasus:/);
  assert.equal(missionFingerprint(null), null);
});

test('first boot: session 1, and the first mission-load names it rather than opening another', () => {
  const c = clocks();
  const { s, rolls } = build(c);
  assert.equal(s.currentSeq(), 1);
  assert.equal(s.current().reason, 'FIRST');
  assert.equal(s.current().fingerprint, null);
  const cur = quiet(() => s.noteMissionLoad(SYRIA));
  assert.deepEqual([cur.seq, cur.theatre, cur.fingerprint], [1, 'Syria', missionFingerprint(SYRIA)]);
  assert.deepEqual(rolls, []);
});

test('a gRPC reconnect (mission-load again, same mission, clock carried on) keeps the session', () => {
  const c = clocks();
  const { s, rolls } = build(c);
  quiet(() => s.noteMissionLoad(SYRIA));
  run(c, s, 20 * MIN);
  quiet(() => s.noteMissionLoad(SYRIA));
  run(c, s, MIN);
  assert.equal(s.currentSeq(), 1);
  assert.deepEqual(rolls, []);
});

test('a crc-sync restart onto the same running mission keeps the session', () => {
  const c = clocks();
  const { s, p } = build(c);
  quiet(() => s.noteMissionLoad(SYRIA));
  run(c, s, 30 * MIN);
  c.advance(2 * MIN); // down for two minutes; the mission ran on
  const { s: again, rolls } = build(c, p);
  assert.equal(again.currentSeq(), 1, 'restored from state/');
  quiet(() => again.noteMissionLoad(SYRIA)); // grpc-client emits mission-load on every connect
  run(c, again, MIN);
  assert.equal(again.currentSeq(), 1);
  assert.deepEqual(rolls, []);
});

test('a different .miz starts a new session (MISSION_CHANGED), and onNewSession hears it', () => {
  const c = clocks();
  const { s, rolls } = build(c);
  quiet(() => s.noteMissionLoad(SYRIA));
  run(c, s, 10 * MIN);
  c.advance(10 * MIN);
  const cur = quiet(() => s.noteMissionLoad(SYRIA_OTHER));
  assert.deepEqual([cur.seq, cur.reason, cur.fingerprint], [2, 'MISSION_CHANGED', missionFingerprint(SYRIA_OTHER)]);
  quiet(() => s.noteMissionLoad(CAUCASUS));
  assert.deepEqual(rolls, [
    { seq: 2, reason: 'MISSION_CHANGED', previous: 1 },
    { seq: 3, reason: 'MISSION_CHANGED', previous: 2 },
  ]);
  assert.equal(s.current().theatre, 'Caucasus');
});

test('the same .miz restarted (mission_start, then a mission-load that looks the same) starts a new session', () => {
  const c = clocks();
  const { s, rolls } = build(c);
  quiet(() => s.noteMissionLoad(SYRIA));
  run(c, s, 2 * MIN); // too short for the clock rule to catch it
  c.m = T0; c.w += 30000;
  s.noteMissionStart();
  // Game-time polls between the event and its load are not read: the clock may
  // still carry the previous theater's offset.
  c.m -= 3 * 3600000;
  assert.equal(quiet(() => s.observeClock()), false);
  c.m = T0;
  const cur = quiet(() => s.noteMissionLoad(SYRIA));
  assert.deepEqual([cur.seq, cur.reason, cur.fingerprint], [2, 'MISSION_START', missionFingerprint(SYRIA)]);
  run(c, s, MIN);
  quiet(() => s.noteMissionLoad(SYRIA)); // and a later reconnect keeps it
  assert.equal(s.currentSeq(), 2);
  assert.deepEqual(rolls, [{ seq: 2, reason: 'MISSION_START', previous: 1 }]);
});

test('the mission clock stepping back more than 5 min starts a new session; a pause does not', () => {
  const c = clocks();
  const { s, rolls } = build(c);
  quiet(() => s.noteMissionLoad(SYRIA));
  run(c, s, 40 * MIN);
  c.m -= 5000; // a paused mission: one poll's worth of step back
  assert.equal(quiet(() => s.observeClock()), false);
  c.m -= CLOCK_STEP_BACK_MS - 10000; // still within 5 min of the highest reading
  assert.equal(quiet(() => s.observeClock()), false);
  assert.equal(s.currentSeq(), 1);
  c.m = T0; // the same .miz reloaded from its start
  assert.equal(quiet(() => s.observeClock()), true);
  assert.deepEqual([s.currentSeq(), s.current().reason, s.current().fingerprint], [2, 'CLOCK_STEP_BACK', missionFingerprint(SYRIA)]);
  assert.deepEqual(rolls, [{ seq: 2, reason: 'CLOCK_STEP_BACK', previous: 1 }]);
  run(c, s, MIN);
  assert.equal(s.currentSeq(), 2, 'the new session measures from its own start');
});

test('the wall-clock fallback (DCS gone) is never read as the clock stepping', () => {
  const c = clocks();
  const { s, rolls } = build(c);
  quiet(() => s.noteMissionLoad(SYRIA));
  run(c, s, 10 * MIN);
  const at = c.m;
  c.source = 'WALL'; c.m = c.w; // years ahead
  quiet(() => s.observeClock());
  c.source = 'MISSION'; c.m = at + MIN;
  quiet(() => s.observeClock());
  assert.equal(s.currentSeq(), 1);
  assert.deepEqual(rolls, []);
});

test('persistence: a restart restores the session and measures a step back against the clock before it', () => {
  const c = clocks();
  const { s, p } = build(c);
  quiet(() => s.noteMissionLoad(SYRIA));
  run(c, s, 60 * MIN);
  quiet(() => s.noteMissionLoad(SYRIA_OTHER)); // session 2
  run(c, s, 45 * MIN);
  const saved = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(saved.seq, 2);
  assert.equal(saved.fingerprint, missionFingerprint(SYRIA_OTHER));
  assert.ok(saved.lastAt >= c.m - MIN, 'the clock high-water mark is written, at most a minute behind');

  // crc-sync is down while the same .miz is restarted from its start.
  c.m = T0; c.w += 10 * MIN;
  const { s: again, rolls } = build(c, p);
  assert.deepEqual([again.currentSeq(), again.current().theatre], [2, 'Syria']);
  quiet(() => again.noteMissionLoad(SYRIA_OTHER)); // same fingerprint: not enough on its own
  assert.equal(again.currentSeq(), 2);
  assert.equal(quiet(() => again.observeClock()), true);
  assert.equal(again.currentSeq(), 3);
  assert.deepEqual(rolls, [{ seq: 3, reason: 'CLOCK_STEP_BACK', previous: 2 }]);
  const { s: third } = build(c, p);
  assert.equal(third.currentSeq(), 3);
});

test('a reconnect whose first clock poll steps back just before the load of ANOTHER mission opens one session, not two', () => {
  const c = clocks();
  const { s, rolls } = build(c);
  quiet(() => s.noteMissionLoad(SYRIA));
  run(c, s, 60 * MIN);
  c.m = T0 - 3 * 3600000; c.w += 5000; // new mission, read with the old theater's offset
  quiet(() => s.observeClock());
  c.w += 10000;
  const cur = quiet(() => s.noteMissionLoad(CAUCASUS));
  assert.deepEqual([cur.seq, cur.reason, cur.theatre], [2, 'CLOCK_STEP_BACK', 'Caucasus']);
  // Its lastAt was reset: the clock re-read with the new offset is not a second step.
  c.m = T0 - 4 * 3600000;
  quiet(() => s.observeClock());
  assert.equal(s.currentSeq(), 2);
  assert.deepEqual(rolls.map(r => r.seq), [2]);
  // Well after that window, another mission is a new session as usual.
  run(c, s, 10 * MIN);
  quiet(() => s.noteMissionLoad(SYRIA));
  assert.equal(s.currentSeq(), 3);
});

test('an unreadable state file is moved aside, not overwritten', () => {
  const c = clocks();
  const p = freshPath();
  fs.writeFileSync(p, '{not json');
  const { s } = build(c, p);
  assert.equal(s.currentSeq(), 1);
  assert.ok(fs.readdirSync(tmpDir).some(f => f.startsWith(path.basename(p) + '.corrupt-')));
  assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).seq, 1);
});

test('onNewSession: unsubscribe, and a failing listener does not stop the others', () => {
  const c = clocks();
  const s = new MissionSession({ path: null, clock: c.clock, wallNow: c.wallNow });
  const heard = [];
  const off = s.onNewSession(() => heard.push('a'));
  s.onNewSession(() => { throw new Error('boom'); });
  s.onNewSession(() => heard.push('c'));
  quiet(() => s.noteMissionLoad(SYRIA));
  quiet(() => s.noteMissionLoad(CAUCASUS));
  off();
  quiet(() => s.noteMissionLoad(SYRIA));
  assert.deepEqual(heard, ['a', 'c', 'c']);
});
