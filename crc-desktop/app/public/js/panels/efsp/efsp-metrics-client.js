'use strict';

// The three §11.5 metrics only a client can observe (docs/adr/0072, the client
// half of docs/adr/0065):
//
//   SEARCH        every search run from the Strip panel (guide §4.3: search is
//                 a failure symptom, so it is counted, never its text);
//   TIME_TO_FIND  from a Bay coming on screen to the first selection of a Strip
//                 in it (the Pending-bay choke point);
//   GESTURE       the inputs a paper gesture cost at the entry point it was
//                 made from (§7.3's ceiling is one).
//
// Always loaded and always running, whether or not the METRICS panel is open.
// Measurement only observes: every public hook is null-safe, catches its own
// errors, never awaits, never sends a Mutation and never raises a banner. A bug
// here must not be able to break a Strip click (T4).
//
// crc-sync stamps every reported event on RECEIPT with its mission clock, and
// ignores the client's `at` (decisions.md S-R2-3). So WHEN a batch is sent
// decides which hour it lands in: flush promptly, and drop an event that has
// waited too long rather than stamp it into a later hour. `at` is still sent
// (missionNow()) because it is useful in a log. Durations use performance.now()
// — a duration is not a time of day (H11).

// Code constants, not a tuning file (decisions.md P5). docs/adr/0072.
const EFSP_METRICS_LIMITS = Object.freeze({
  FLUSH_MS: 10 * 1000,          // flush at most this long after an event is queued
  FLUSH_AT: 20,                 // ...or as soon as this many are queued
  MAX_PER_REPORT: 100,          // crc-sync's per-report cap (metrics.js MAX_EVENTS_PER_REPORT)
  QUEUE_CAP: 500,               // while disconnected; the oldest is dropped past this
  MAX_AGE_MS: 5 * 60 * 1000,    // older than this at flush time: dropped, not sent
  TTF_CAP_MS: 10 * 60 * 1000,   // a Bay entry open this long is abandoned
  VISIBILITY_CHECK_MS: 1000,    // how often an open Bay entry checks the panel is still on screen
});

// [SOURCE-DEFINED] — the inputs a controller spends at each gesture entry
// point (docs/adr/0072). Keyed `GESTURE:entry-point`. A new entry point (a
// keyboard shortcut, say) adds a row here; a missing row throws, and the
// test suite fails, rather than being counted as a silent 1.
const GESTURE_INPUT_COST = Object.freeze({
  'FLIP:dblclick': 1,                // a double-click is one input
  'ATTENTION:shift-click': 1,
  'HIGHLIGHT:contextmenu+swatch': 2, // right-click opens the swatches, a click picks one
  'OFFSET:menu': 2,                  // open ⋯, click Offset
  'OFFSET:alt-click': 1,             // UI-A S-L15: one modified click on the Strip
  'HIGHLIGHT:ctrl-click': 1,         // UI-A S-L15: each press steps the colour (yellow, cyan, lime, off)
});

/** The inputs a gesture cost at `entryPoint`. Throws for a pair with no row. */
function efspGestureInputCost(gesture, entryPoint) {
  const cost = GESTURE_INPUT_COST[`${gesture}:${entryPoint}`];
  if (!Number.isInteger(cost)) throw new Error(`[efsp-metrics] no GESTURE_INPUT_COST row for ${gesture}:${entryPoint}`);
  return cost;
}

const _isSearchBay = (bayId) => typeof bayId === 'string' && bayId.endsWith('-search');

/**
 * The measuring core, with every dependency injected so it runs under
 * node:test. The browser singleton below wires it to the real globals.
 *
 * @param {object} deps
 * @param {(msg:object) => void} deps.send               sends one efsp-metrics-report
 * @param {() => boolean} deps.isOpen                    is the crc-sync socket open
 * @param {() => Array<{bayId:string, positionId:string, facilityId:string}>} deps.bays
 * @param {(facilityId:string) => string[]} deps.held    Positions held at a Facility
 * @param {(stripId:string) => object|null} deps.stripOf
 * @param {(bayId:string) => boolean} deps.bayHasStrips
 * @param {() => string|null} deps.visibleBayId          the Bay on screen, null when the panel is hidden
 * @param {() => number} deps.perfNow                    a monotonic ms clock, for durations
 * @param {(() => number)|null} [deps.missionNow]        the mission clock, for `at` (logs only)
 * @param {() => string} deps.uuid
 * @param {(fn:Function, ms:number) => any} deps.setTimer
 * @param {(handle:any) => void} deps.clearTimer
 * @param {(fn:Function) => void} deps.defer             runs fn after the current task (a microtask)
 * @param {(...args:any[]) => void} [deps.warn]
 */
function createEfspMetricsClient(deps) {
  const L = EFSP_METRICS_LIMITS;
  const warn = deps.warn || ((...a) => console.warn(...a));
  const warned = new Set();
  const warnOnce = (key, ...args) => { if (warned.has(key)) return; warned.add(key); warn(...args); };

  let queue = [];          // [{ facilityId, positionId, event, queuedAt }]
  let flushTimer = null;
  const stats = {
    queued: 0, sent: 0, reports: 0,
    droppedNotHeld: 0, droppedOverflow: 0, droppedStale: 0, droppedReleased: 0,
    ttfSamples: 0, ttfAbandoned: 0, ttfNotAFind: 0,
    acked: 0, rejected: 0, rejectedByReason: {},
  };

  function _facilityOf(positionId) {
    const bay = (deps.bays() || []).find(b => b && b.positionId === positionId);
    return bay ? bay.facilityId : null;
  }

  function _holds(facilityId, positionId) {
    return !!facilityId && (deps.held(facilityId) || []).includes(positionId);
  }

  function _enqueue(positionId, event) {
    const facilityId = _facilityOf(positionId);
    if (!positionId || !_holds(facilityId, positionId)) {
      // crc-sync would refuse the report (NOT_HOLDING_POSITION) — T7.
      stats.droppedNotHeld += 1;
      warnOnce('not-held', `[efsp-metrics] dropping a ${event.kind} for ${positionId || 'no Position'}: not held (logged once)`);
      return;
    }
    if (deps.missionNow) event.at = deps.missionNow();
    queue.push({ facilityId, positionId, event, queuedAt: deps.perfNow() });
    stats.queued += 1;
    if (queue.length > L.QUEUE_CAP) {
      queue.splice(0, queue.length - L.QUEUE_CAP);
      stats.droppedOverflow += 1;
    }
    if (queue.length >= L.FLUSH_AT) flush();
    else if (!flushTimer) flushTimer = deps.setTimer(() => { flushTimer = null; flush(); }, L.FLUSH_MS);
  }

  /** Sends everything queued, one report per (Facility, Position), ≤ 100 events each. */
  function flush() {
    if (flushTimer) { deps.clearTimer(flushTimer); flushTimer = null; }
    const now = deps.perfNow();
    const fresh = queue.filter(q => now - q.queuedAt <= L.MAX_AGE_MS);
    stats.droppedStale += queue.length - fresh.length;
    queue = fresh;
    if (!queue.length) return 0;
    if (!deps.isOpen()) {
      // Kept, and retried at the next flush; the age check above bounds it.
      flushTimer = deps.setTimer(() => { flushTimer = null; flush(); }, L.FLUSH_MS);
      return 0;
    }
    const groups = new Map();
    for (const q of queue) {
      const key = `${q.facilityId}|${q.positionId}`;
      if (!groups.has(key)) groups.set(key, { facilityId: q.facilityId, positionId: q.positionId, events: [] });
      groups.get(key).events.push(q.event);
    }
    queue = [];
    let sent = 0;
    for (const g of groups.values()) {
      if (!_holds(g.facilityId, g.positionId)) {
        // Released since it was queued: crc-sync would refuse it (T7).
        stats.droppedReleased += g.events.length;
        continue;
      }
      for (let i = 0; i < g.events.length; i += L.MAX_PER_REPORT) {
        const events = g.events.slice(i, i + L.MAX_PER_REPORT);
        deps.send({
          version: 1, type: 'efsp-metrics-report', reportId: deps.uuid(),
          facilityId: g.facilityId, positionId: g.positionId, events,
        });
        stats.reports += 1;
        stats.sent += events.length;
        sent += events.length;
      }
    }
    return sent;
  }

  function onAck(msg) {
    if (!msg) return;
    stats.acked += 1;
    const reasons = [];
    if (msg.ok === false) reasons.push(msg.reason || 'UNKNOWN');
    for (const r of msg.rejected || []) reasons.push((r && r.reason) || 'UNKNOWN');
    for (const reason of reasons) {
      stats.rejected += 1;
      stats.rejectedByReason[reason] = (stats.rejectedByReason[reason] || 0) + 1;
      // Never a banner: measurement does not talk to the controller (§2).
      warnOnce(`ack:${reason}`, `[efsp-metrics] crc-sync refused a metrics report: ${reason}${msg.detail ? ` (${msg.detail})` : ''} (logged once per reason)`);
    }
  }

  // ── 1. search ──

  function noteSearch(positionId, bayId) {
    const event = { kind: 'SEARCH' };
    if (typeof bayId === 'string' && bayId) event.bayId = bayId;
    _enqueue(positionId, event); // never the query text (T3)
  }

  // ── 2. time-to-find (docs/adr/0072 — [SOURCE-DEFINED]) ──
  //
  // Starts when a Bay BECOMES visible; stops at the first selection of a Strip
  // in that Bay (any Strip, for the search pseudo-Bay: its results are Strips
  // of other Bays). Abandoned, with no sample, when the controller leaves the
  // Bay, hides the panel, or 10 minutes pass. A selection in the same task as
  // the Bay entry is not a find — that is the arrivals line opening a Bay and
  // selecting a Strip in one click (T6).

  let lastVisible = null;   // dedupes _renderBayTabs, which runs on every refresh (T5)
  let entry = null;         // { bayId, positionId, startedAt, sameTask }
  let watchTimer = null;

  function _stopWatch() { if (watchTimer) { deps.clearTimer(watchTimer); watchTimer = null; } }

  function _abandon() {
    if (entry) stats.ttfAbandoned += 1;
    entry = null;
    _stopWatch();
  }

  function _watch() {
    watchTimer = deps.setTimer(() => {
      watchTimer = null;
      if (!entry) return;
      if (deps.perfNow() - entry.startedAt > L.TTF_CAP_MS) { _abandon(); return; }
      const visible = deps.visibleBayId();
      if (visible !== entry.bayId) {
        _abandon();
        // Forget it, so the panel coming back into view starts a new entry.
        lastVisible = visible;
        return;
      }
      _watch();
    }, L.VISIBILITY_CHECK_MS);
  }

  function noteBayVisible(bayId, positionId) {
    const id = bayId || null;
    if (id === lastVisible) return;
    _abandon();
    lastVisible = id;
    if (!id || !positionId) return;
    // A Bay with nothing in it has nothing to find.
    if (!_isSearchBay(id) && !deps.bayHasStrips(id)) return;
    const e = { bayId: id, positionId, startedAt: deps.perfNow(), sameTask: true };
    entry = e;
    deps.defer(() => { e.sameTask = false; });
    _watch();
  }

  function noteStripSelected(stripId) {
    if (!entry || !stripId) return; // a toggle-off is not a find
    const strip = deps.stripOf(stripId);
    if (!strip) return;
    if (!_isSearchBay(entry.bayId) && strip.bayId !== entry.bayId) return;
    const done = entry;
    entry = null;
    _stopWatch();
    if (done.sameTask) { stats.ttfNotAFind += 1; return; }
    const latencyMs = Math.max(0, Math.round(deps.perfNow() - done.startedAt));
    if (latencyMs > L.TTF_CAP_MS) { stats.ttfAbandoned += 1; return; }
    stats.ttfSamples += 1;
    _enqueue(done.positionId, { kind: 'TIME_TO_FIND', bayId: done.bayId, latencyMs });
  }

  // ── 3. inputs per gesture ──

  function noteGesture(gesture, entryPoint, positionId) {
    const inputs = efspGestureInputCost(gesture, entryPoint);
    _enqueue(positionId, { kind: 'GESTURE', gesture, inputs });
  }

  return {
    noteSearch, noteBayVisible, noteStripSelected, noteGesture, flush, onAck,
    stats: () => ({ ...stats, rejectedByReason: { ...stats.rejectedByReason }, pending: queue.length }),
    _queue: () => queue.map(q => ({ ...q, event: { ...q.event } })),
    _entry: () => (entry ? { ...entry } : null),
  };
}

// ── the browser singleton and the global hooks ─────────────────────────────

let _efspMetricsClient = null;

function _efspMetrics() {
  if (_efspMetricsClient) return _efspMetricsClient;
  const has = (name) => typeof globalThis[name] === 'function';
  _efspMetricsClient = createEfspMetricsClient({
    send: (msg) => _sendEfsp(msg),
    isOpen: () => (has('isSyncOpen') ? isSyncOpen() : false),
    bays: () => (has('getEfspBays') ? getEfspBays() : []),
    held: (facilityId) => (has('getActingPositions') ? getActingPositions(facilityId) : []),
    stripOf: (stripId) => (has('getEfspStrip') ? getEfspStrip(stripId) : null),
    bayHasStrips: (bayId) => (has('getAllEfspStrips') ? getAllEfspStrips().some(s => s && s.bayId === bayId) : false),
    visibleBayId: () => (has('efspVisibleBayId') ? efspVisibleBayId() : null),
    perfNow: typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
      ? () => performance.now() : () => Date.now(), // a duration only, never an `at`
    missionNow: has('missionNow') ? () => missionNow() : null,
    uuid: () => crypto.randomUUID(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h),
    defer: typeof queueMicrotask === 'function' ? (fn) => queueMicrotask(fn) : (fn) => Promise.resolve().then(fn),
  });
  return _efspMetricsClient;
}

function _efspMetricsSafely(what, fn) {
  try { fn(_efspMetrics()); } catch (e) { console.warn(`[efsp-metrics] ${what} failed:`, e && e.message); }
}

/** From efsp-panel.js's _runEfspSearch, non-empty query only. `bayId` is the Bay the search was run FROM. */
function noteEfspSearch(positionId, bayId) { _efspMetricsSafely('search hook', m => m.noteSearch(positionId, bayId)); }
/** From efsp-panel.js's _renderBayTabs on every render — the Bay on screen, or null when the panel is hidden. */
function noteEfspBayVisible(bayId, positionId) { _efspMetricsSafely('bay hook', m => m.noteBayVisible(bayId, positionId)); }
/** From bay-view.js's _selectStrip / selectEfspStripById, with the new selection (null when cleared). */
function noteEfspStripSelected(stripId) { _efspMetricsSafely('selection hook', m => m.noteStripSelected(stripId)); }
/** From each gesture entry point, AFTER _dispatchGesture dispatched; `positionId` is what it returned. */
function noteEfspGesture(gesture, entryPoint, positionId) {
  if (!positionId) return; // _dispatchGesture declined: nothing happened, nothing to count
  _efspMetricsSafely('gesture hook', m => m.noteGesture(gesture, entryPoint, positionId));
}
/** app.js: `efsp-metrics-report-ack`. */
function onEfspMetricsReportAck(msg) { _efspMetricsSafely('ack', m => m.onAck(msg)); }
/** Sends what is queued now rather than at the next flush (tests, and beforeunload). */
function flushEfspMetricsNow() { let n = 0; _efspMetricsSafely('flush', m => { n = m.flush(); }); return n; }
/** Local counters — drops, abandons, samples — for a log or the e2e walk. */
function efspMetricsClientStats() { let s = null; _efspMetricsSafely('stats', m => { s = m.stats(); }); return s; }

if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => { flushEfspMetricsNow(); });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createEfspMetricsClient, efspGestureInputCost, GESTURE_INPUT_COST, EFSP_METRICS_LIMITS };
}
