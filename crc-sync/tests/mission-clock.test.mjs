import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crcLog from '../src/log.js';

const { MissionClock, WALL_CLOCK, parseScenarioLocalMs, DEFAULT_STALE_MS, DEFAULT_HOLD_AFTER_MS } = await import('../src/mission-clock.js');
const { MissionSession } = await import('../src/mission-session.js');
const { loadTheaters } = await import('../src/theaters.js');

function quietly(fn) { const cap = crcLog.capture(); try { return fn(); } finally { cap.stop(); } }

// A wall clock the test moves by hand.
function fakeWall(start = Date.UTC(2026, 8, 29, 19, 0, 0)) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

const OFFSETS = { Syria: 3, Caucasus: 4, Afghanistan: 4.5 };
const offsetHoursFor = (theatre) => OFFSETS[theatre] ?? null;

test('parseScenarioLocalMs reads the calendar fields and ignores whatever suffix DCS-gRPC puts on them', () => {
  const expected = Date.UTC(2016, 5, 21, 5, 40, 7);
  assert.equal(parseScenarioLocalMs('2016-06-21T05:40:07Z'), expected);
  assert.equal(parseScenarioLocalMs('2016-06-21T05:40:07+00:00'), expected);
  assert.equal(parseScenarioLocalMs('2016-06-21T05:40:07'), expected);
  assert.equal(parseScenarioLocalMs('2016-06-21T05:40:07.5Z'), expected + 500);
  assert.equal(parseScenarioLocalMs('nonsense'), null);
  assert.equal(parseScenarioLocalMs(null), null);
});

test('in-game local time is converted to Zulu with the theater offset — Syria 0540 local is 0240Z', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setTheatre('Syria');
  clock.sample('2016-06-21T05:40:00Z');
  assert.equal(clock.source, 'MISSION');
  assert.equal(clock.now(), Date.UTC(2016, 5, 21, 2, 40, 0));
});

test('a fractional offset works (Afghanistan, Z+4:30)', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setTheatre('Afghanistan');
  clock.sample('2020-01-01T04:30:00');
  assert.equal(clock.now(), Date.UTC(2020, 0, 1, 0, 0, 0));
});

test('an offset that crosses midnight lands on the previous Zulu day', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setTheatre('Syria');
  clock.sample('2016-06-21T01:00:00');
  assert.equal(clock.now(), Date.UTC(2016, 5, 20, 22, 0, 0));
});

test('between polls it advances at real rate from the last sample', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setTheatre('Syria');
  clock.sample('2016-06-21T05:40:00');
  wall.advance(3200);
  assert.equal(clock.now(), Date.UTC(2016, 5, 21, 2, 40, 3, 200));
});

test('every poll resyncs — a paused mission steps back, an accelerated one steps forward', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setTheatre('Syria');
  clock.sample('2016-06-21T05:40:00');
  wall.advance(5000);
  // Paused: the mission clock did not move, and the next sample says so.
  clock.sample('2016-06-21T05:40:00');
  assert.equal(clock.now(), Date.UTC(2016, 5, 21, 2, 40, 0));
  wall.advance(5000);
  // 4x acceleration: twenty mission seconds in five real ones.
  clock.sample('2016-06-21T05:40:20');
  assert.equal(clock.now(), Date.UTC(2016, 5, 21, 2, 40, 20));
});

test('an unreadable sample is refused and the previous one stands', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setTheatre('Syria');
  clock.sample('2016-06-21T05:40:00');
  assert.equal(clock.sample('garbage'), false);
  assert.equal(clock.now(), Date.UTC(2016, 5, 21, 2, 40, 0));
});

test('before the first sample it is the wall clock, and says so', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setTheatre('Syria');
  assert.equal(clock.source, 'WALL');
  assert.equal(clock.now(), wall());
});

test('a sample before the theater is known stays on the wall clock, and becomes usable once it is', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.sample('2016-06-21T05:40:00');
  assert.equal(clock.source, 'WALL');
  assert.equal(clock.now(), wall());
  clock.setTheatre('Syria');
  assert.equal(clock.source, 'MISSION');
  assert.equal(clock.now(), Date.UTC(2016, 5, 21, 2, 40, 0));
});

test('a theater missing from the table runs on offset 0, flagged MISSION_NO_OFFSET, and warns once', (t) => {
  const cap = crcLog.capture(); t.after(() => cap.stop());
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setTheatre('SomeNewMap');
  clock.setTheatre('SomeNewMap');
  clock.sample('2016-06-21T05:40:00');
  assert.equal(clock.source, 'MISSION_NO_OFFSET');
  assert.equal(clock.now(), Date.UTC(2016, 5, 21, 5, 40, 0));
  assert.equal(cap.records.filter(r => r.level === 'warn').length, 1);
});

test('when DCS goes quiet the clock falls back to the wall once the last sample is stale, and recovers on the next', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setTheatre('Syria');
  clock.sample('2016-06-21T05:40:00');
  wall.advance(DEFAULT_STALE_MS);
  assert.equal(clock.source, 'MISSION', 'at the limit it still counts');
  wall.advance(1);
  assert.equal(clock.source, 'WALL');
  assert.equal(clock.now(), wall());
  clock.sample('2016-06-21T05:40:31');
  assert.equal(clock.source, 'MISSION');
  assert.equal(clock.now(), Date.UTC(2016, 5, 21, 2, 40, 31));
});

// ── A pause, a disconnect, a restart (docs/adr/0129) ─────────────────────

const Z0440 = Date.UTC(2016, 5, 21, 1, 40, 0); // Syria 04:40 local

test('a pause: DCS connected but silent for minutes holds the last sample, flagged MISSION_HELD, never WALL', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setLink('connected');
  clock.setTheatre('Syria');
  clock.sample('2016-06-21T04:40:00');
  wall.advance(DEFAULT_HOLD_AFTER_MS);
  assert.equal(clock.source, 'MISSION', 'two missed polls still run on');
  assert.equal(clock.now(), Z0440 + DEFAULT_HOLD_AFTER_MS);
  wall.advance(1);
  assert.equal(clock.source, 'MISSION_HELD');
  const held = clock.now();
  assert.equal(held, Z0440 + DEFAULT_HOLD_AFTER_MS, 'held where it had got to: no step back on entering the hold');
  wall.advance(9 * 60000); // the live test's nine-minute pause
  assert.equal(clock.source, 'MISSION_HELD');
  assert.equal(clock.now(), held, 'a paused game clock does not move');
  // The unpause: the queued answers all say the paused time, and the clock runs again from there.
  clock.sample('2016-06-21T04:40:01');
  assert.equal(clock.source, 'MISSION');
  assert.equal(clock.now(), Z0440 + 1000);
});

test('a pause on a theater without an offset holds too', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setLink('connected');
  clock.setTheatre('SomeNewMap');
  quietly(() => clock.sample('2016-06-21T04:40:00'));
  wall.advance(5 * 60000);
  assert.equal(clock.source, 'MISSION_HELD');
  assert.equal(clock.now(), Date.UTC(2016, 5, 21, 4, 40, 0) + DEFAULT_HOLD_AFTER_MS);
});

test('a disconnect: with the link down the clock runs on, then falls back to WALL after staleMs', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setLink('connected');
  clock.setTheatre('Syria');
  clock.sample('2016-06-21T04:40:00');
  wall.advance(5000);
  clock.setLink('reconnecting');
  wall.advance(DEFAULT_STALE_MS - 5000);
  assert.equal(clock.source, 'MISSION');
  assert.equal(clock.now(), Z0440 + DEFAULT_STALE_MS);
  wall.advance(1);
  assert.equal(clock.source, 'WALL');
  assert.equal(clock.now(), wall());
});

test('a held clock whose link then drops goes to WALL once the sample is past staleMs', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setLink('connected');
  clock.setTheatre('Syria');
  clock.sample('2016-06-21T04:40:00');
  wall.advance(60000);
  assert.equal(clock.source, 'MISSION_HELD');
  clock.setLink('disconnected');
  assert.equal(clock.source, 'WALL');
});

test('a reconnect forgets the sample: WALL until the first new one', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setLink('connected');
  clock.setTheatre('Syria');
  clock.sample('2016-06-21T04:40:00');
  clock.setLink('reconnecting');
  wall.advance(2000);
  assert.equal(clock.source, 'MISSION', 'a brief drop runs on from the old sample');
  clock.setLink('connected');
  assert.equal(clock.source, 'WALL');
  clock.sample('2016-06-21T04:00:03');
  assert.equal(clock.source, 'MISSION');
  assert.equal(clock.now(), Date.UTC(2016, 5, 21, 1, 0, 3));
  clock.setLink('connected'); // no change: nothing forgotten
  assert.equal(clock.source, 'MISSION');
});

test('forget() (a mission_start) drops the old mission\'s sample at once', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setLink('connected');
  clock.setTheatre('Syria');
  clock.sample('2016-06-21T04:41:36');
  clock.forget();
  assert.equal(clock.source, 'WALL');
  assert.equal(clock.now(), wall());
});

test('a .miz restart, in the order the feed handlers run it: the new session starts at the new mission\'s first sample, reset once', () => {
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  const session = quietly(() => new MissionSession({ path: null, clock, wallNow: wall }));
  const resets = [];
  session.onMissionReset((s) => resets.push(s.seq));
  const MISSION = { theatre: 'Syria', waypoints: [{ name: 'INCIRLIK' }], drawings: [], airports: [] };
  clock.setLink('connected');
  clock.setTheatre('Syria');
  quietly(() => session.noteMissionLoad(MISSION));
  // 41 minutes of mission from 04:00 local, polled every 5 s.
  for (let t = 0; t <= 41 * 60 + 36; t += 5) {
    clock.sample(`2016-06-21T04:${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    quietly(() => session.observeClock());
    wall.advance(5000);
  }
  assert.equal(session.currentSeq(), 1);
  // The restart: stream ends, reconnects, mission_start, mission-load — all inside the old sample's 30 s.
  clock.setLink('reconnecting');
  wall.advance(2000);
  clock.setLink('connected');
  clock.forget(); // 'mission-start' handler, before the session hears it
  session.noteMissionStart();
  clock.setTheatre('Syria');
  quietly(() => session.noteMissionLoad(MISSION));
  assert.equal(session.currentSeq(), 2);
  assert.equal(session.current().reason, 'MISSION_START');
  assert.equal(session.current().startedAt, null, 'no mission time yet: not the old mission\'s 04:41:36');
  wall.advance(1500);
  clock.sample('2016-06-21T04:00:01');
  quietly(() => session.observeClock());
  assert.equal(session.current().startedAt, Date.UTC(2016, 5, 21, 1, 0, 1));
  assert.deepEqual(resets, [2], 'the same-fingerprint restart is confirmed by the clock, exactly once');
  for (let i = 0; i < 20; i++) { wall.advance(5000); clock.sample(`2016-06-21T04:0${Math.floor((6 + i * 5) / 60)}:${String((6 + i * 5) % 60).padStart(2, '0')}`); quietly(() => session.observeClock()); }
  assert.deepEqual(resets, [2]);
  assert.equal(session.current().startedAt, Date.UTC(2016, 5, 21, 1, 0, 1), 'filled once');
});

test('WALL_CLOCK is the fallback fixtures get, and it labels itself', () => {
  const before = Date.now();
  const t = WALL_CLOCK.now();
  assert.ok(t >= before && t <= Date.now());
  assert.equal(WALL_CLOCK.source, 'WALL');
});

// ── The shipped theater table ───────────────────────────────────────────

test('the shipped table covers every DCS theater, with Syria at Z+3 (decisions.md H11)', () => {
  const theaters = loadTheaters(path.join(import.meta.dirname, '../config/theaters.json'));
  assert.equal(theaters.Syria.utcOffsetHours, 3);
  for (const [name, { utcOffsetHours }] of Object.entries(theaters)) {
    assert.ok(utcOffsetHours >= -12 && utcOffsetHours <= 14, `${name}: ${utcOffsetHours}`);
  }
  for (const name of ['Caucasus', 'Nevada', 'Normandy', 'PersianGulf', 'TheChannel', 'Syria', 'MarianaIslands',
    'MarianaIslandsWWII', 'Falklands', 'SinaiMap', 'Kola', 'Afghanistan', 'Iraq', 'GermanyCW']) {
    assert.ok(name in theaters, `${name} is missing`);
  }
});

test('loadTheaters keeps one object per theater and drops an entry without a numeric offset', (t) => {
  const cap = crcLog.capture(); t.after(() => cap.stop());
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'theaters-test-')), 'theaters.json');
  fs.writeFileSync(file, JSON.stringify({ theaters: { Syria: { utcOffsetHours: 3, futureField: 'kept' }, Broken: { utcOffsetHours: 'three' }, Bare: 3 } }));
  assert.deepEqual(loadTheaters(file), { Syria: { utcOffsetHours: 3, futureField: 'kept' } });
});
