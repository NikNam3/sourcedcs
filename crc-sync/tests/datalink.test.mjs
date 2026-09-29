import { test } from 'node:test';
import assert from 'node:assert/strict';

// docs/adr/0059 — the datalink feed: own participants report themselves, and
// what their radar is locked on.
const { DatalinkFeed, luaString } = await import('../src/surveillance/datalink.js');
const { USER_COALITION } = await import('../src/surveillance/iff.js');

const HOSTILE = USER_COALITION === 3 ? 2 : 3;
const CONFIG = { participants: ['F-16C_50', 'E-3A'], pliPeriodMs: 4000 };

function storeOf(tracks) { return { getAll: () => tracks }; }
function unit(id, over = {}) {
  return { id, name: `Unit-${id}`, callsign: `Enfield${id}`, type: 'F-16C_50', coalition: USER_COALITION, category: 1, ...over };
}

test('own participants report; other types, the other side and vehicles do not', () => {
  const feed = new DatalinkFeed({
    trackStore: storeOf([
      unit(1), unit(2, { type: 'Su-27' }), unit(3, { coalition: HOSTILE }), unit(4, { category: 3 }), unit(5, { type: 'E-3A' }),
    ]),
    config: CONFIG,
  });
  feed.tick(100000);
  assert.deepEqual([...feed.reports().keys()].sort(), ['1', '5']);
  const r = feed.reports().get('1');
  assert.equal(r.callsign, 'Enfield1');
  assert.equal(r.type, 'F-16C_50');
  assert.equal(r.lock, null);
});

test('a report moves once per period on its own phase, not every tick', () => {
  const feed = new DatalinkFeed({ trackStore: storeOf([unit(1)]), config: CONFIG });
  feed.tick(100000);
  const first = feed.reports().get('1').at;
  assert.ok(first <= 100000 && first > 96000);
  feed.tick(first + 1000);
  assert.equal(feed.reports().get('1').at, first, 'no new report inside the period');
  feed.tick(first + 4000);
  assert.equal(feed.reports().get('1').at, first + 4000);
});

test('a participant that leaves stops reporting', () => {
  const tracks = [unit(1)];
  const feed = new DatalinkFeed({ trackStore: storeOf(tracks), config: CONFIG });
  feed.tick(1000);
  tracks.length = 0;
  feed.tick(2000);
  assert.equal(feed.reports().size, 0);
});

test('locks are polled by unit name and mapped back to contacts', async () => {
  const tracks = [unit(1), unit(9, { type: 'Su-27', coalition: HOSTILE, name: 'Bandit-1' })];
  let asked = null;
  const feed = new DatalinkFeed({
    trackStore: storeOf(tracks), config: CONFIG,
    evalLua: async (lua) => { asked = lua; return { 'Unit-1': 'Bandit-1' }; },
  });
  await feed.pollLocks();
  assert.match(asked, /"Unit-1"/);
  assert.equal(/Bandit-1/.test(asked), false, 'only participants are asked');
  feed.tick(1000);
  assert.equal(feed.reports().get('1').lock, '9');
});

test('an empty answer (lua2json of an empty table is []) clears the locks', async () => {
  let answer = { 'Unit-1': 'Unit-5' };
  const feed = new DatalinkFeed({
    trackStore: storeOf([unit(1), unit(5)]), config: CONFIG, evalLua: async () => answer,
  });
  await feed.pollLocks();
  feed.tick(1000);
  assert.equal(feed.reports().get('1').lock, '5');
  answer = [];
  await feed.pollLocks();
  feed.tick(2000);
  assert.equal(feed.reports().get('1').lock, null);
});

test('a failed poll keeps the last answer', async () => {
  let fail = false;
  const feed = new DatalinkFeed({
    trackStore: storeOf([unit(1), unit(5)]), config: CONFIG,
    evalLua: async () => { if (fail) throw new Error('down'); return { 'Unit-1': 'Unit-5' }; },
  });
  await feed.pollLocks();
  fail = true;
  await feed.pollLocks();
  feed.tick(1000);
  assert.equal(feed.reports().get('1').lock, '5');
});

test('unit names are quoted safely for Lua', () => {
  assert.equal(luaString('a"b\\c'), '"a\\"b\\\\c"');
});
