// The game-time poll and the link state the mission clock reads (docs/adr/0129), against a stub MissionService: no
// network. A pause queues GetScenarioCurrentTime requests and answers them all on the unpause; a mission_start or a
// reconnect makes every answer still in flight the old mission's, so those are dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crcLog from '../src/log.js';

const require = createRequire(import.meta.url);
const GrpcClient = require('../src/grpc-client.js');

function stubbed(t) {
  const cap = crcLog.capture();
  t.after(() => cap.stop());
  const c = new GrpcClient({ env: {} });
  const pending = []; // callbacks of unanswered GetScenarioCurrentTime calls, oldest first
  c._missionSvc = { GetScenarioCurrentTime: (_req, cb) => pending.push(cb) };
  const times = [];
  const links = [];
  c.on('game-time', (dt) => times.push(dt));
  c.on('link', (s) => links.push(s));
  t.after(() => c.close());
  return { c, pending, times, links };
}

test('a pause: requests queue and all answer on the unpause, every one delivered', (t) => {
  const { c, pending, times } = stubbed(t);
  c._setState('connected');
  pending.length = 0; // the fetch the connect itself asked for
  for (let i = 0; i < 4; i++) c._fetchGameTime();
  for (const cb of pending.splice(0)) cb(null, { datetime: '2016-06-21T04:40:00' });
  assert.deepEqual(times, Array(4).fill('2016-06-21T04:40:00'));
});

test('link: every state change is emitted at once (no 4 s debounce), and coming up asks for the time straight away', (t) => {
  const { c, pending, links } = stubbed(t);
  c._setState('connected');
  assert.equal(pending.length, 1, 'a fetch on connect');
  c._setState('reconnecting');
  c._setState('reconnecting');
  c._setState('connected');
  assert.deepEqual(links, ['connected', 'reconnecting', 'connected']);
  assert.equal(c.linkState, 'connected');
  assert.equal(pending.length, 2);
});

test('an answer asked before a reconnect is dropped; one asked after is delivered', (t) => {
  const { c, pending, times } = stubbed(t);
  c._setState('connected');
  pending.length = 0;
  c._fetchGameTime();
  const old = pending.shift();
  c._setState('reconnecting');
  c._setState('connected');
  const fresh = pending.shift();
  old(null, { datetime: '2016-06-21T04:41:36' });
  fresh(null, { datetime: '2016-06-21T04:00:02' });
  assert.deepEqual(times, ['2016-06-21T04:00:02']);
});

test('a mission_start drops the old mission\'s answer still in flight and asks again at once', (t) => {
  const { c, pending, times } = stubbed(t);
  const events = [];
  c.on('mission-start', () => events.push('mission-start'));
  c._fetchMissionWithRetry = () => events.push('fetch-mission');
  c._setState('connected');
  pending.length = 0;
  c._fetchGameTime();
  const old = pending.shift();
  // The event stream's mission_start, as _startEventStream handles it.
  let onData = null;
  c._missionSvc.StreamEvents = () => ({ on: (ev, fn) => { if (ev === 'data') onData = fn; }, cancel() {} });
  c._startEventStream();
  onData({ mission_start: {} });
  assert.deepEqual(events, ['mission-start', 'fetch-mission']);
  assert.equal(pending.length, 1, 'asked for the new mission\'s time straight away');
  old(null, { datetime: '2016-06-21T04:41:36' });
  pending.shift()(null, { datetime: '2016-06-21T04:00:01' });
  assert.deepEqual(times, ['2016-06-21T04:00:01']);
});
