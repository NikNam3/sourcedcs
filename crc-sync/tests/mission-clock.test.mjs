import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { MissionClock, WALL_CLOCK, parseScenarioLocalMs, DEFAULT_STALE_MS } = await import('../src/mission-clock.js');
const { loadTheaters } = await import('../src/theaters.js');

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
  const warn = t.mock.method(console, 'warn', () => {});
  const wall = fakeWall();
  const clock = new MissionClock({ offsetHoursFor, wallNow: wall });
  clock.setTheatre('SomeNewMap');
  clock.setTheatre('SomeNewMap');
  clock.sample('2016-06-21T05:40:00');
  assert.equal(clock.source, 'MISSION_NO_OFFSET');
  assert.equal(clock.now(), Date.UTC(2016, 5, 21, 5, 40, 0));
  assert.equal(warn.mock.callCount(), 1);
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
  t.mock.method(console, 'warn', () => {});
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'theaters-test-')), 'theaters.json');
  fs.writeFileSync(file, JSON.stringify({ theaters: { Syria: { utcOffsetHours: 3, futureField: 'kept' }, Broken: { utcOffsetHours: 'three' }, Bare: 3 } }));
  assert.deepEqual(loadTheaters(file), { Syria: { utcOffsetHours: 3, futureField: 'kept' } });
});
