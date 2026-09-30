'use strict';

// The client half of the §11.5 metrics (docs/adr/0072): what is measured, how
// it is batched, and when it reaches the wire. crc-sync stamps each event on
// receipt (decisions.md S-R2-3), so the flush timing IS the bucket timing —
// hence the tests on "within one flush interval" and "dropped after 5 min".

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createEfspMetricsClient, efspGestureInputCost, GESTURE_INPUT_COST, EFSP_METRICS_LIMITS: L,
} = require('../app/public/js/panels/efsp/efsp-metrics-client.js');

const BAYS = [
  { bayId: 'gnd-pending', positionId: 'GND', facilityId: 'INCIRLIK' },
  { bayId: 'gnd-taxi-out', positionId: 'GND', facilityId: 'INCIRLIK' },
  { bayId: 'twr-runway-queue', positionId: 'TWR', facilityId: 'INCIRLIK' },
  { bayId: 'ctr-overflight', positionId: 'CTR', facilityId: 'CENTER' },
];

/** A client on a fake clock and fake timers. `tick(ms)` advances both. */
function harness(over = {}) {
  let now = 1000;
  let seq = 0;
  let timers = [];
  let deferred = [];
  const sent = [];
  const warnings = [];
  const state = {
    open: true,
    held: { INCIRLIK: ['GND', 'TWR'], CENTER: [] },
    strips: new Map([
      ['s1', { stripId: 's1', bayId: 'gnd-pending' }],
      ['s2', { stripId: 's2', bayId: 'gnd-taxi-out' }],
      ['s3', { stripId: 's3', bayId: 'twr-runway-queue' }],
    ]),
    visible: null,
    ...over,
  };
  const client = createEfspMetricsClient({
    send: (m) => sent.push(m),
    isOpen: () => state.open,
    bays: () => BAYS,
    held: (f) => state.held[f] || [],
    stripOf: (id) => state.strips.get(id) || null,
    bayHasStrips: (bayId) => [...state.strips.values()].some(s => s.bayId === bayId),
    visibleBayId: () => state.visible,
    perfNow: () => now,
    missionNow: () => 1_700_000_000_000,
    uuid: () => `r${++seq}`,
    setTimer: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
    clearTimer: (t) => { timers = timers.filter(x => x !== t); },
    defer: (fn) => deferred.push(fn),
    warn: (...a) => warnings.push(a.join(' ')),
  });
  const endTask = () => { const d = deferred; deferred = []; d.forEach(fn => fn()); };
  const tick = (ms) => {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > until) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = until;
  };
  // A Bay coming on screen as efsp-panel.js reports it: visible, then the task ends.
  const enterBay = (bayId, positionId) => { state.visible = bayId; client.noteBayVisible(bayId, positionId); endTask(); };
  return { client, sent, warnings, state, tick, endTask, enterBay, events: () => sent.flatMap(r => r.events) };
}

// ── batching and flushing ──

test('each measurement reaches the wire within one flush interval, one report per (Facility, Position)', () => {
  const h = harness();
  h.client.noteSearch('GND', 'gnd-pending');
  h.client.noteGesture('FLIP', 'dblclick', 'TWR');
  assert.equal(h.sent.length, 0, 'batched, not sent per event');
  h.tick(L.FLUSH_MS - 1);
  assert.equal(h.sent.length, 0);
  h.tick(1);
  assert.equal(h.sent.length, 2);
  const byPos = Object.fromEntries(h.sent.map(r => [r.positionId, r]));
  assert.deepEqual(byPos.GND.events, [{ kind: 'SEARCH', bayId: 'gnd-pending', at: 1_700_000_000_000 }]);
  assert.deepEqual(byPos.TWR.events, [{ kind: 'GESTURE', gesture: 'FLIP', inputs: 1, at: 1_700_000_000_000 }]);
  for (const r of h.sent) {
    assert.equal(r.type, 'efsp-metrics-report');
    assert.equal(r.version, 1);
    assert.equal(r.facilityId, 'INCIRLIK');
  }
  assert.notEqual(h.sent[0].reportId, h.sent[1].reportId, 'a fresh reportId per report');
});

test('time-to-find reaches the wire within one flush interval too', () => {
  const h = harness();
  h.enterBay('gnd-pending', 'GND');
  h.tick(2140);
  h.client.noteStripSelected('s1');
  h.tick(L.FLUSH_MS);
  assert.deepEqual(h.events(), [{ kind: 'TIME_TO_FIND', bayId: 'gnd-pending', latencyMs: 2140, at: 1_700_000_000_000 }]);
});

test('20 queued events flush at once; a report never carries more than 100', () => {
  const h = harness();
  for (let i = 0; i < L.FLUSH_AT - 1; i++) h.client.noteSearch('GND', 'gnd-pending');
  assert.equal(h.sent.length, 0);
  h.client.noteSearch('GND', 'gnd-pending');
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].events.length, L.FLUSH_AT);

  // A backlog (built while disconnected) is split.
  const g = harness();
  g.state.open = false;
  for (let i = 0; i < 250; i++) g.client.noteSearch('GND', 'gnd-pending');
  g.state.open = true;
  g.client.flush();
  assert.deepEqual(g.sent.map(r => r.events.length), [100, 100, 50]);
  assert.equal(new Set(g.sent.map(r => r.reportId)).size, 3);
});

test('a closed socket keeps the queue and retries at the next flush', () => {
  const h = harness();
  h.state.open = false;
  h.client.noteSearch('GND', 'gnd-pending');
  h.tick(L.FLUSH_MS);
  assert.equal(h.sent.length, 0);
  assert.equal(h.client.stats().pending, 1);
  h.state.open = true;
  h.tick(L.FLUSH_MS);
  assert.equal(h.sent.length, 1);
  assert.equal(h.client.stats().pending, 0);
});

test('the disconnected queue is capped at 500, dropping the oldest', () => {
  const h = harness();
  h.state.open = false;
  for (let i = 0; i < L.QUEUE_CAP + 5; i++) h.client.noteGesture(i < 5 ? 'OFFSET' : 'FLIP', i < 5 ? 'menu' : 'dblclick', 'TWR');
  assert.equal(h.client.stats().pending, L.QUEUE_CAP);
  assert.equal(h.client.stats().droppedOverflow, 5);
  assert.ok(h.client._queue().every(q => q.event.gesture === 'FLIP'), 'the five oldest (OFFSET) went');
});

test('an event queued for more than 5 minutes is dropped, not sent into a later hour', () => {
  const h = harness();
  h.state.open = false;
  h.client.noteSearch('GND', 'gnd-pending');
  h.tick(L.MAX_AGE_MS - 1000);
  h.client.noteSearch('GND', 'gnd-taxi-out');
  h.tick(2000); // the first is now past 5 min, the second is not
  h.state.open = true;
  h.client.flush();
  assert.deepEqual(h.events().map(e => e.bayId), ['gnd-taxi-out']);
  assert.equal(h.client.stats().droppedStale, 1);
});

test('a Position not held is never reported (crc-sync would refuse it); one warning per session', () => {
  const h = harness();
  h.client.noteSearch('CTR', 'ctr-overflight');
  h.client.noteSearch('CTR', 'ctr-overflight');
  h.client.noteSearch(null, null);
  h.client.flush();
  assert.equal(h.sent.length, 0);
  assert.equal(h.client.stats().droppedNotHeld, 3);
  assert.equal(h.warnings.length, 1);
});

test('events for a Position released before the flush are dropped', () => {
  const h = harness();
  h.client.noteSearch('GND', 'gnd-pending');
  h.state.held.INCIRLIK = ['TWR'];
  h.client.flush();
  assert.equal(h.sent.length, 0);
  assert.equal(h.client.stats().droppedReleased, 1);
});

test('a search carries its Position and source Bay, never its text', () => {
  const h = harness();
  h.client.noteSearch('GND', 'gnd-pending');
  h.client.flush();
  assert.deepEqual(Object.keys(h.events()[0]).sort(), ['at', 'bayId', 'kind']);
});

test('`at` is the injected mission clock (logged only; crc-sync stamps on receipt)', () => {
  const h = harness();
  h.client.noteGesture('ATTENTION', 'shift-click', 'GND');
  h.client.flush();
  assert.equal(h.events()[0].at, 1_700_000_000_000);
});

test('acks: one warning per distinct refusal reason, never anything else', () => {
  const h = harness();
  h.client.onAck({ type: 'efsp-metrics-report-ack', ok: true, accepted: 3, rejected: [] });
  h.client.onAck({ ok: true, accepted: 1, rejected: [{ index: 1, reason: 'VALIDATION_ERROR', detail: 'x' }] });
  h.client.onAck({ ok: true, accepted: 1, rejected: [{ index: 0, reason: 'VALIDATION_ERROR' }] });
  h.client.onAck({ ok: false, reason: 'NOT_HOLDING_POSITION', detail: 'you do not hold GND' });
  h.client.onAck({ ok: true, accepted: 0, rejected: [], duplicate: true });
  assert.equal(h.warnings.length, 2);
  assert.deepEqual(h.client.stats().rejectedByReason, { VALIDATION_ERROR: 2, NOT_HOLDING_POSITION: 1 });
});

// ── time-to-find ──

test('time-to-find: Bay entry to the first selection of a Strip in it, once per entry', () => {
  const h = harness();
  h.enterBay('gnd-pending', 'GND');
  h.tick(900);
  h.client.noteStripSelected('s1');
  h.tick(500);
  h.client.noteStripSelected('s1'); // a second selection in the same entry
  h.client.flush();
  assert.deepEqual(h.events().map(e => e.latencyMs), [900]);
  assert.equal(h.sent[0].positionId, 'GND');
});

test('time-to-find: re-renders of the same Bay do not restart the clock (T5)', () => {
  const h = harness();
  h.enterBay('gnd-pending', 'GND');
  h.tick(1000);
  h.client.noteBayVisible('gnd-pending', 'GND'); // a board delta redraws
  h.tick(1000);
  h.client.noteStripSelected('s1');
  h.client.flush();
  assert.deepEqual(h.events().map(e => e.latencyMs), [2000]);
});

test('time-to-find: a selection in another Bay does not stop the clock', () => {
  const h = harness();
  h.enterBay('gnd-pending', 'GND');
  h.tick(300);
  h.client.noteStripSelected('s3'); // a map click resolving to a Strip elsewhere
  h.tick(300);
  h.client.noteStripSelected('s1');
  h.client.flush();
  assert.deepEqual(h.events().map(e => e.latencyMs), [600]);
});

test('time-to-find: leaving the Bay abandons the entry, with no sample', () => {
  const h = harness();
  h.enterBay('gnd-pending', 'GND');
  h.tick(500);
  h.enterBay('gnd-taxi-out', 'GND');
  h.tick(500);
  h.client.noteStripSelected('s1'); // s1 is in the Bay just left
  h.client.flush();
  assert.equal(h.sent.length, 0);
  assert.equal(h.client.stats().ttfAbandoned, 1);
});

test('time-to-find: hiding the panel abandons the entry; showing it again starts a new one', () => {
  const h = harness();
  h.enterBay('gnd-pending', 'GND');
  h.state.visible = null; // docked behind another tab — no render happens
  h.tick(L.VISIBILITY_CHECK_MS);
  assert.equal(h.client._entry(), null);
  assert.equal(h.client.stats().ttfAbandoned, 1);
  h.tick(60_000);
  h.enterBay('gnd-pending', 'GND'); // onShow re-renders the same Bay
  h.tick(700);
  h.client.noteStripSelected('s1');
  h.client.flush();
  assert.deepEqual(h.events().map(e => e.latencyMs), [700]);
});

test('time-to-find: a hide reported by a render (null) abandons too', () => {
  const h = harness();
  h.enterBay('gnd-pending', 'GND');
  h.client.noteBayVisible(null, 'GND');
  assert.equal(h.client._entry(), null);
  assert.equal(h.client.stats().ttfAbandoned, 1);
});

test('time-to-find: 10 minutes without a find abandons the entry', () => {
  const h = harness();
  h.state.visible = 'gnd-pending';
  h.enterBay('gnd-pending', 'GND');
  h.tick(L.TTF_CAP_MS + L.VISIBILITY_CHECK_MS);
  h.client.noteStripSelected('s1');
  h.client.flush();
  assert.equal(h.sent.length, 0);
  assert.equal(h.client.stats().ttfAbandoned, 1);
});

test('time-to-find: the arrivals line (open a Bay and select in one click) is not a find (T6)', () => {
  const h = harness();
  h.state.visible = 'gnd-pending';
  h.client.noteBayVisible('gnd-pending', 'GND');
  h.client.noteStripSelected('s1'); // same task — selectEfspStripById right after the render
  h.endTask();
  h.client.flush();
  assert.equal(h.sent.length, 0);
  assert.equal(h.client.stats().ttfNotAFind, 1);
});

test('time-to-find: a toggle-off is not a sample and does not end the entry', () => {
  const h = harness();
  h.enterBay('gnd-pending', 'GND');
  h.tick(200);
  h.client.noteStripSelected(null);
  h.tick(200);
  h.client.noteStripSelected('s1');
  h.client.flush();
  assert.deepEqual(h.events().map(e => e.latencyMs), [400]);
});

test('time-to-find: a Bay with no Strips starts no clock', () => {
  const h = harness();
  h.state.strips.delete('s2');
  h.enterBay('gnd-taxi-out', 'GND');
  assert.equal(h.client._entry(), null);
});

test('time-to-find: in the search pseudo-Bay any Strip found stops the clock, for the searching Position', () => {
  const h = harness();
  h.enterBay('GND-search', 'GND');
  h.tick(1200);
  h.client.noteStripSelected('s3'); // a TWR Strip, found by GND's search
  h.client.flush();
  assert.deepEqual(h.events(), [{ kind: 'TIME_TO_FIND', bayId: 'GND-search', latencyMs: 1200, at: 1_700_000_000_000 }]);
  assert.equal(h.sent[0].positionId, 'GND');
});

// ── gestures ──

test('every gesture entry point has a declared cost; a missing row throws rather than counting 1', () => {
  assert.equal(efspGestureInputCost('FLIP', 'dblclick'), 1);
  assert.equal(efspGestureInputCost('ATTENTION', 'shift-click'), 1);
  assert.equal(efspGestureInputCost('HIGHLIGHT', 'contextmenu+swatch'), 2);
  assert.equal(efspGestureInputCost('OFFSET', 'menu'), 2);
  assert.throws(() => efspGestureInputCost('FLIP', 'keyboard'), /no GESTURE_INPUT_COST row/);
  assert.deepEqual(Object.keys(GESTURE_INPUT_COST).map(k => k.split(':')[0]).sort(), ['ATTENTION', 'FLIP', 'HIGHLIGHT', 'OFFSET']);
  for (const v of Object.values(GESTURE_INPUT_COST)) assert.ok(Number.isInteger(v) && v >= 1 && v <= 50, 'inside crc-sync\'s 1..50');
});
