import { test } from 'node:test';
import assert from 'node:assert/strict';
import crcLog from '../src/log.js';

// The booking pull and the calendar built from it (docs/adr/0098 §9): never throws, caches, sends on change only.
const { listUpcomingAirspaceBookings } = await import('../src/efsp/booking-lookup.js');
const { AirspaceCalendar } = await import('../src/efsp/airspace-calendar.js');

const quiet = (t) => { const cap = crcLog.capture(); t.after(() => cap.stop()); };
const json = (body, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const row = (id, start, end, extra = {}) => ({ airspaceRef: { theater: 'Syria', airspaceId: id }, startUtc: start, endUtc: end, by: 'Ann', altitudeFt: 12000, ...extra });

test('lookup: sends the bearer token to /api/bookings/service/upcoming and normalises rows', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => [row('MOA-1', '2026-10-05T10:00:00Z', '2026-10-05T12:00:00Z'), { junk: 1 }, row('X', 'nope', 'nope')] }; };
  const r = await listUpcomingAirspaceBookings({ fetchImpl, baseUrl: 'http://web:7000/', serviceToken: 'tok' });
  assert.equal(seen.url, 'http://web:7000/api/bookings/service/upcoming');
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(r, { ok: true, bookings: [{ theater: 'Syria', airspaceId: 'MOA-1', startUtc: '2026-10-05T10:00:00.000Z', endUtc: '2026-10-05T12:00:00.000Z', by: 'Ann', altitudeFt: 12000 }] });
});

test('lookup: no token, web down, non-2xx, malformed and non-JSON are all {ok:false}, never a throw', async (t) => {
  quiet(t);
  assert.equal((await listUpcomingAirspaceBookings({ fetchImpl: json([]), serviceToken: '' })).ok, false);
  const down = await listUpcomingAirspaceBookings({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); }, serviceToken: 't' });
  assert.deepEqual(down, { ok: false, reason: 'sourcedcs-web unreachable' });
  assert.match((await listUpcomingAirspaceBookings({ fetchImpl: json({}, 401), serviceToken: 't' })).reason, /401/);
  assert.match((await listUpcomingAirspaceBookings({ fetchImpl: json({ not: 'a list' }), serviceToken: 't' })).reason, /malformed/);
  const notJson = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } });
  assert.equal((await listUpcomingAirspaceBookings({ fetchImpl: notJson, serviceToken: 't' })).ok, false);
});

test('lookup: a slow web is aborted at the timeout', async (t) => {
  quiet(t);
  const slow = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  const r = await listUpcomingAirspaceBookings({ fetchImpl: slow, serviceToken: 't', timeoutMs: 20 });
  assert.equal(r.ok, false);
});

function calendar(lists, { now = Date.parse('2026-10-05T09:00:00Z'), theater = 'Syria', bookingUrl = 'https://x/bookings.html' } = {}) {
  const sent = [];
  const state = { now, theater, i: 0 };
  const cal = new AirspaceCalendar({
    list: async () => lists[Math.min(state.i++, lists.length - 1)],
    currentTheater: () => state.theater, bookingUrl, onChange: (m) => sent.push(m), wallClock: { now: () => state.now },
  });
  return { cal, sent, state };
}
const ok = (...bookings) => ({ ok: true, bookings });
const b = (id, h, theater = 'Syria') => ({ theater, airspaceId: id, startUtc: `2026-10-05T${String(h).padStart(2, '0')}:00:00.000Z`, endUtc: `2026-10-05T${String(h + 1).padStart(2, '0')}:00:00.000Z`, by: 'Ann', altitudeFt: 10000 });

test('calendar: the next 3 per airspace, this theater only, sorted, with the link; sent on the first pull', async () => {
  const { cal, sent } = calendar([ok(b('MOA-1', 15), b('MOA-1', 11), b('MOA-1', 13), b('MOA-1', 12), b('MOA-2', 10, 'Other'), b('MOA-2', 10))]);
  assert.equal(await cal.refresh(), true);
  const m = sent[0];
  assert.equal(m.type, 'efsp-airspace-calendar');
  assert.equal(m.theater, 'Syria');
  assert.equal(m.bookingUrl, 'https://x/bookings.html');
  assert.deepEqual(m.byAirspace['MOA-1'].map(x => x.startUtc.slice(11, 13)), ['11', '12', '13']);
  assert.deepEqual(Object.keys(m.byAirspace[ 'MOA-1'][0]).sort(), ['altitudeFt', 'by', 'endUtc', 'startUtc']);
  assert.equal(m.byAirspace['MOA-2'].length, 1, 'the Other theater booking is not in it');
});

test('calendar: no link when the public URL is unset', async () => {
  const { cal, sent } = calendar([ok()], { bookingUrl: null });
  await cal.refresh();
  assert.ok(!('bookingUrl' in sent[0]));
});

test('calendar: sent on change only; a failed pull keeps the cache and sends nothing', async (t) => {
  quiet(t);
  const { cal, sent } = calendar([ok(b('MOA-1', 11)), ok(b('MOA-1', 11)), { ok: false, reason: 'down' }, ok(b('MOA-1', 11), b('MOA-1', 13))]);
  await cal.refresh();
  assert.equal(await cal.refresh(), false, 'same data');
  assert.equal(await cal.refresh(), false, 'web down: the cache stays');
  assert.equal(sent.length, 1);
  assert.equal(cal.message().byAirspace['MOA-1'].length, 1);
  assert.equal(await cal.refresh(), true);
  assert.equal(sent.length, 2);
});

test('calendar: a booking that has ended drops out, and a theater change is a change', async () => {
  const { cal, sent, state } = calendar([ok(b('MOA-1', 11))]);
  await cal.refresh();
  state.theater = 'Other';
  assert.equal(cal.notify(), true);
  assert.deepEqual(sent[1].byAirspace, {});
  state.theater = 'Syria';
  cal.notify();
  state.now = Date.parse('2026-10-05T12:30:00Z');
  assert.equal(cal.notify(), true);
  assert.deepEqual(sent[sent.length - 1].byAirspace, {});
});
