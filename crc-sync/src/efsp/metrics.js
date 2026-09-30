'use strict';

// The §11.5 metric set, collected server-side (docs/adr/0065).
//
// Seven metrics, each carrying a `status` so that a missing source can never
// render as a healthy zero (the correlation rate's "null, never 1.0" rule,
// applied to all of them):
//   COLLECTING        a source is wired and reported something in the window
//   NO_DATA           a source is wired, nothing in the window
//   NOT_INSTRUMENTED  no source has ever reported (the client metrics until L15
//                     ships, staleness until L19 declares its detector)
//
// Buckets are keyed by METRICS SESSION and UTC HOUR. A metrics session is one
// DCS mission load to the next (decisions.md H32); the hour is the UTC hour of
// the mission clock (H11 — "metrics buckets" are named there). The default view
// is the current session, with a ROLLING last hour beside it (S-R2-4), kept in
// one-minute buckets in memory only. Retention (default 30 days,
// restart-to-apply) is a storage lifetime and is measured on the wall clock,
// because mission time can jump years between two missions.
//
// Session identity is an injected seam until supervisor fix F3's shared
// mission-session.js lands (S-R2-2): until then this module tracks it itself,
// with F3's rules — a new session on a mission load that is not the same
// mission carrying on, or when the mission clock steps back by more than 5 min.
//
// Survives a restart: hour buckets, the session list and the `sources` stamps
// live in `state/efsp-metrics.json`, written atomically (sibling + rename) by
// the 60 s tick ONLY when something changed. Up to one tick is lost on a crash.
// Never part of efsp-board.json: _persist runs after every Mutation, and a
// metrics bug must not be able to reach the Board snapshot.
//
// Per-person breakdowns are never exposed (decisions.md H35, S-R2-4): nothing
// on the wire is keyed by controller. "Rejected Mutations per session" is per
// METRICS session (H32); the per-connection records exist in memory only
// (sessionRecords()), for in-process diagnostics.
//
// createEfspInstrumentation() at the bottom composes this with the traffic
// count and installs the TAP: it reassigns efsp.handleMessage on the facade
// (ws-hub.js looks the property up on every message), so every EFSP message,
// its session and its ack pass through here with no edit to efsp-ws.js,
// ws-hub.js or any store. The tap never throws and never changes the result.

const fs = require('fs');
const crypto = require('crypto');
const { writePath, ensureDirFor } = require('../state-paths');
const { WALL_CLOCK } = require('../mission-clock');
const { getInstrumentationConfig } = require('./instrumentation-config');
const { TrafficCount, hourKey } = require('./traffic-count');

const METRICS_PATH = writePath('efsp-metrics.json', process.env.CRCSYNC_EFSP_METRICS_PATH);

const VERSION = 1;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TTF_SAMPLE_CAP = 500;                 // per Position per hour bucket
const TIME_TO_FIND_TARGET_MS = 3000;        // §11.5: p95 < 3 s
const CORRELATION_TARGET = 0.95;            // §11.5 / §6.6 rule 6
const TRANSFER_FAILURE_TARGET = 0.005;      // §11.1: transfer success >= 99.5%
const GESTURES = Object.freeze(['OFFSET', 'FLIP', 'HIGHLIGHT', 'ATTENTION']);
// Server-side cross-check of metric 3: which Strip flag each paper gesture sets.
// `removeIndicator` is not a gesture (the Drop sets it).
const FLAG_TO_GESTURE = Object.freeze({ offset: 'OFFSET', flipped: 'FLIP', highlight: 'HIGHLIGHT', attention: 'ATTENTION' });
const TRANSFER_KINDS = Object.freeze(['TRANSFER', 'NLA_TRANSFER']);
const KNOWN_SOURCES = Object.freeze(['client', 'staleness']);
const MAX_EVENTS_PER_REPORT = 100;
const MAX_LATENCY_MS = 600000;
const MAX_GESTURE_INPUTS = 50;
const MUTATION_DEDUPE_CAP = 5000;           // board-store.js APPLIED_MUTATIONS_CAP's shape
const REPORT_DEDUPE_CAP = 1000;
const SESSIONS_LISTED = 50;
const MAX_WINDOW_HOURS = 720;
// A mission load that turns out to be the SAME mission (a crc-sync restart, a
// gRPC reconnect) is not a new metrics session: same theater, and the mission
// clock carried on from where it was, allowing this much slack either way.
const MISSION_CONTINUATION_SLACK_MS = 5 * 60 * 1000;
// How long a mission load waits for its first mission-clock sample before it
// is resolved without one (DCS answering the load but not the time).
const MISSION_LOAD_RESOLVE_MS = 60 * 1000;
const MINUTE_MS = 60 * 1000;
const ROLLING_WINDOW_MS = HOUR_MS;
const SESSION_RECORDS_KEPT = 50;

// ── small helpers ─────────────────────────────────────────────────────────

class BoundedSet {
  constructor(cap) { this._cap = cap; this._set = new Set(); }
  has(v) { return this._set.has(v); }
  add(v) {
    this._set.add(v);
    if (this._set.size > this._cap) this._set.delete(this._set.values().next().value);
  }
}

function inc(obj, key, n = 1) { obj[key] = (obj[key] || 0) + n; }

/** Nearest-rank percentile of an ascending array; null when empty. */
function percentile(sorted, q) {
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[rank - 1];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.length ? sorted[sorted.length - 1] : null,
  };
}

function ratio(num, den) { return den > 0 ? num / den : null; }

function _transfers(b) {
  return b.transfers || (b.transfers = { attempts: 0, succeeded: 0, failed: 0, routedToCovering: 0, inhibitedPress: 0, byCause: {}, byKind: {} });
}

/** Every hour key of the `n` hours ending with the hour containing `endMs`, ascending. */
function hourRange(endMs, n) {
  const endHour = Math.floor(endMs / HOUR_MS) * HOUR_MS;
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(hourKey(endHour - i * HOUR_MS));
  return out;
}

/** Position ids that occur in more than one Facility — keying metrics by positionId (Q13) is only safe while this is empty. */
function duplicatePositionIds(facilityConfig) {
  const seen = new Map();
  const dup = new Set();
  for (const f of facilityConfig.getFacilityIds()) {
    for (const p of facilityConfig.getPositionSet(f)) {
      if (seen.has(p) && seen.get(p) !== f) dup.add(p);
      seen.set(p, f);
    }
  }
  return [...dup].sort();
}

function _intParam(raw, { min, max, name }) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const s = typeof raw === 'number' ? String(raw) : raw;
  if (typeof s !== 'string' || !/^-?\d+$/.test(s)) return { error: `${name} must be an integer` };
  const v = Number(s);
  if (!Number.isSafeInteger(v) || (min !== undefined && v < min) || (max !== undefined && v > max)) {
    return { error: `${name} must be an integer${min !== undefined ? ` from ${min}` : ''}${max !== undefined ? ` to ${max}` : ''}` };
  }
  return { value: v };
}

// ── the metric store ──────────────────────────────────────────────────────

class EfspMetrics {
  /**
   * @param {object} deps
   * @param {string} [deps.path]
   * @param {{now:()=>number, source?:string}} [deps.clock] the mission clock (H11)
   * @param {() => number} [deps.wallNow] retention only
   * @param {{retentionDays?:number}} [deps.config]
   * @param {string[]} [deps.facilityIds]
   * @param {(facilityId:string) => object|null} [deps.positionStoreFor]
   * @param {() => object|null} [deps.correlationStats] CorrelationReconciler.getStats — NEVER called at construction (T12)
   * @param {() => object|null} [deps.obligationStats]  ForwardingObligationMonitor.getComplianceStats — likewise
   */
  constructor({ path: filePath, clock = WALL_CLOCK, wallNow = () => Date.now(), config, facilityIds = [], positionStoreFor = () => null, correlationStats = null, obligationStats = null } = {}) {
    const defaults = getInstrumentationConfig().metrics;
    this._path = filePath || METRICS_PATH;
    this._clock = clock;
    this._wallNow = wallNow;
    this._retentionDays = config && Number.isInteger(config.retentionDays) && config.retentionDays >= 1 ? config.retentionDays : defaults.retentionDays;
    this._facilityIds = [...facilityIds];
    this._positionStoreFor = positionStoreFor;
    this._correlationStats = correlationStats;
    this._obligationStats = obligationStats;
    this._serviceStartedAt = clock.now();
    this._tapInstalled = false;

    this._sources = { client: null, staleness: null };
    this._missions = [];           // [{ seq, theatre, loadedWallAt, startedAt, lastAt, lastWallAt }]
    this._buckets = new Map();     // `${seq}|${hourUtc}` -> bucket (persisted)
    this._minutes = new Map();     // `${seq}|${minuteMs}` -> bucket, the rolling hour (memory only)
    this._pendingLoad = null;
    this._dirty = false;
    this._writes = 0;
    this._reports = new BoundedSet(REPORT_DEDUPE_CAP);
    this._load();
  }

  // ── persistence ──

  _load() {
    let raw;
    try {
      raw = fs.readFileSync(this._path, 'utf8');
    } catch {
      return; // first run
    }
    try {
      const data = JSON.parse(raw);
      this._sources = { client: null, staleness: null, ...(data.sources || {}) };
      this._missions = Array.isArray(data.missions) ? data.missions : [];
      for (const b of Array.isArray(data.buckets) ? data.buckets : []) {
        if (b && Number.isInteger(b.mission) && typeof b.hourUtc === 'string') this._buckets.set(`${b.mission}|${b.hourUtc}`, b);
      }
    } catch (e) {
      // Kept for inspection rather than overwritten by the next flush.
      const aside = `${this._path}.corrupt-${this._wallNow()}`;
      try { fs.renameSync(this._path, aside); } catch { /* nothing more to do */ }
      console.warn(`[efsp-metrics] ${this._path} was unreadable (${e.message}) — moved to ${aside}, starting empty`);
    }
  }

  /** Writes the file if anything changed since the last write. */
  flush() {
    if (!this._dirty) return false;
    try {
      ensureDirFor(this._path);
      const payload = JSON.stringify({
        version: VERSION,
        sources: this._sources,
        missions: this._missions,
        buckets: [...this._buckets.values()],
      });
      const tmp = `${this._path}.tmp`;
      fs.writeFileSync(tmp, payload);
      fs.renameSync(tmp, this._path);
      this._dirty = false;
      this._writes += 1;
      return true;
    } catch (e) {
      console.warn('[efsp-metrics] failed to persist:', e.message);
      return false;
    }
  }

  /** Drops hour buckets last written more than retentionDays ago (wall clock), and sessions left with none. */
  prune() {
    const cutoff = this._wallNow() - this._retentionDays * DAY_MS;
    let removed = 0;
    for (const [key, b] of this._buckets) {
      if (!Number.isFinite(b.wallLast) || b.wallLast < cutoff) { this._buckets.delete(key); removed++; }
    }
    const current = this._missions.length ? this._missions[this._missions.length - 1].seq : null;
    const withBuckets = new Set([...this._buckets.values()].map(b => b.mission));
    const before = this._missions.length;
    this._missions = this._missions.filter(m => m.seq === current || withBuckets.has(m.seq));
    if (removed || this._missions.length !== before) this._dirty = true;
    return removed;
  }

  // ── metrics sessions (decisions.md H32) ──

  /** Called on every DCS mission load (server.js's grpcClient 'mission-load'). */
  noteMissionLoad({ theatre = null } = {}) {
    this._pendingLoad = { theatre: theatre || null, wallAt: this._wallNow() };
  }

  _mission() {
    const wall = this._wallNow();
    const source = this._clock.source || 'WALL';
    const missionTime = source !== 'WALL';
    const nowM = this._clock.now();
    const open = (theatre, loadedWallAt) => {
      const prev = this._missions[this._missions.length - 1];
      this._missions.push({
        seq: (prev ? prev.seq : 0) + 1, theatre, loadedWallAt, startedAt: nowM,
        lastAt: missionTime ? nowM : null, lastWallAt: missionTime ? wall : null,
      });
      this._dirty = true;
    };
    if (!this._missions.length) open(null, null);
    let cur = this._missions[this._missions.length - 1];

    const p = this._pendingLoad;
    if (p && (missionTime || wall - p.wallAt > MISSION_LOAD_RESOLVE_MS)) {
      this._pendingLoad = null;
      const continues = missionTime && cur.theatre === p.theatre && cur.lastAt !== null
        && nowM >= cur.lastAt - MISSION_CONTINUATION_SLACK_MS
        && nowM <= cur.lastAt + Math.max(0, wall - cur.lastWallAt) + MISSION_CONTINUATION_SLACK_MS;
      if (cur.theatre === null && cur.loadedWallAt === null) {
        // Everything before the first mission load belongs to it.
        Object.assign(cur, { theatre: p.theatre, loadedWallAt: p.wallAt });
        if (cur.lastAt === null) cur.startedAt = nowM;
        this._dirty = true;
      } else if (!continues) {
        open(p.theatre, p.wallAt);
      }
    } else if (missionTime && cur.lastAt !== null && nowM < cur.lastAt - MISSION_CONTINUATION_SLACK_MS) {
      // The mission clock stepped back: a different mission (S-R2-2).
      open(cur.theatre, null);
    }
    cur = this._missions[this._missions.length - 1];
    if (missionTime) {
      if (cur.lastAt === null || nowM > cur.lastAt) cur.lastAt = nowM;
      cur.lastWallAt = wall;
    }
    return cur;
  }

  /** The current metrics session's number (traffic-count records carry it). */
  currentMissionSession() { return this._mission().seq; }

  /**
   * Applies `fn` to the hour bucket (persisted) and the minute bucket (the
   * rolling hour, memory only) that `at` falls in, in the current session.
   */
  _record(at, fn) {
    const seq = this._mission().seq;
    const hourUtc = hourKey(at);
    const hk = `${seq}|${hourUtc}`;
    let h = this._buckets.get(hk);
    if (!h) { h = { mission: seq, hourUtc }; this._buckets.set(hk, h); }
    h.wallLast = this._wallNow();
    this._dirty = true;
    const minute = Math.floor(at / MINUTE_MS) * MINUTE_MS;
    const mk = `${seq}|${minute}`;
    let m = this._minutes.get(mk);
    if (!m) { m = { mission: seq, minute }; this._minutes.set(mk, m); this._pruneMinutes(at); }
    fn(h);
    fn(m);
  }

  _pruneMinutes(now = this._clock.now()) {
    const seq = this._missions.length ? this._missions[this._missions.length - 1].seq : null;
    for (const [k, m] of this._minutes) {
      if (m.mission !== seq || m.minute < now - ROLLING_WINDOW_MS || m.minute > now + MINUTE_MS) this._minutes.delete(k);
    }
  }

  // ── recorders ──

  /** Metric 5's denominator and numerator: every Mutation attempt, and each refusal. */
  recordMutation({ at = this._clock.now(), type, op, positionId, ok, reason }) {
    this._record(at, (b) => {
      const r = b.rejections || (b.rejections = { mutations: 0, total: 0, byReason: {}, byType: {}, byOp: {}, byPosition: {} });
      r.mutations += 1;
      if (ok) return;
      r.total += 1;
      inc(r.byReason, reason || 'UNKNOWN');
      inc(r.byType, type || 'UNKNOWN');
      if (op) inc(r.byOp, op);
      if (positionId) inc(r.byPosition, positionId);
    });
  }

  /** Metric 7: one transfer attempt and its outcome. */
  recordTransfer({ at = this._clock.now(), kind, ok, cause, routedTo }) {
    this._record(at, (b) => {
      const t = _transfers(b);
      t.attempts += 1;
      const k = t.byKind[kind] || (t.byKind[kind] = { attempts: 0, failed: 0 });
      k.attempts += 1;
      if (ok) {
        t.succeeded += 1;
        if (routedTo) t.routedToCovering += 1;
      } else {
        t.failed += 1;
        k.failed += 1;
        inc(t.byCause, cause || 'UNKNOWN');
      }
    });
  }

  /**
   * An owner's NLA press whose status was inhibited before it was pressed
   * (S-R2-5): not a transfer attempt — nothing was attempted — but counted
   * beside the transfers, so a button pressed against its inhibit is visible.
   */
  recordInhibitedPress({ at = this._clock.now() } = {}) {
    this._record(at, (b) => { _transfers(b).inhibitedPress += 1; });
  }

  /** Metric 3's server cross-check: a successful SetFlag of a paper-gesture flag. */
  recordSetFlag({ at = this._clock.now(), flag }) {
    const gesture = FLAG_TO_GESTURE[flag];
    if (!gesture) return;
    this._record(at, (b) => inc(b.setFlag || (b.setFlag = {}), gesture));
  }

  recordSystemReassign({ at = this._clock.now() } = {}) {
    this._record(at, (b) => { b.systemReassigned = (b.systemReassigned || 0) + 1; });
  }

  /**
   * Stamps a source as wired, so a genuine zero reads COLLECTING rather than
   * NOT_INSTRUMENTED. L19 calls declareSource('staleness') once where it wires
   * its detector. An unknown name throws: a typo is a bug, not data.
   */
  declareSource(name) {
    if (!KNOWN_SOURCES.includes(name)) throw new Error(`[efsp-metrics] unknown metrics source: ${JSON.stringify(name)} (known: ${KNOWN_SOURCES.join(', ')})`);
    if (this._sources[name] === null || this._sources[name] === undefined) {
      this._sources[name] = this._clock.now();
      this._dirty = true;
    }
  }

  /**
   * Metric 6 (§10.4) — L19's hook, one call per staleness detection:
   *   metrics.recordStaleness({ at, facilityId, positionId, stripId, fdrId, stripState, trackState, durationMs })
   * Only the aggregate is kept.
   */
  recordStaleness({ at = this._clock.now(), positionId, stripState } = {}) {
    this.declareSource('staleness');
    this._record(at, (b) => {
      const s = b.staleness || (b.staleness = { total: 0, byPosition: {}, byState: {} });
      s.total += 1;
      inc(s.byPosition, positionId || 'UNKNOWN');
      inc(s.byState, stripState || 'UNKNOWN');
    });
  }

  /** Metric 1's denominator: one minute of manning per Position with a Primary. The 60 s tick calls it. */
  sampleManning(at = this._clock.now()) {
    for (const f of this._facilityIds) {
      const store = this._positionStoreFor(f);
      if (!store) continue;
      for (const p of store.getAll()) {
        if (!p.primary) continue;
        this._record(at, (b) => {
          const m = b.manning || (b.manning = {});
          const row = m[p.positionId] || (m[p.positionId] = { facilityId: f, minutes: 0 });
          row.minutes += 1;
        });
      }
    }
  }

  /** Metric 4: one sample of the live correlation rate, weighted by what was eligible. */
  sampleCorrelation(at = this._clock.now()) {
    if (!this._correlationStats) return false;
    const stats = this._correlationStats();
    // rate is null on an empty board (T19): skip, never multiply null.
    if (!stats || stats.rate === null || stats.rate === undefined || !(stats.eligible > 0)) return false;
    this._record(at, (b) => {
      const c = b.correlation || (b.correlation = { matchedSum: 0, eligibleSum: 0, samples: 0 });
      c.matchedSum += stats.rate * stats.eligible;
      c.eligibleSum += stats.eligible;
      c.samples += 1;
    });
    return true;
  }

  /** The 60 s tick: sample, prune, write if anything changed. Never throws. */
  tick() {
    const at = this._clock.now();
    // _mission() first: it resolves a pending mission load and keeps the
    // session's lastAt current, which is what tells "the same mission carrying
    // on" from "the same mission file loaded again".
    for (const step of [() => this._mission(), () => this.sampleManning(at), () => this.sampleCorrelation(at), () => this.prune(), () => this._pruneMinutes(at), () => this.flush()]) {
      try { step(); } catch (e) { console.warn('[efsp-metrics] tick step failed:', e.message); }
    }
  }

  // ── client-reported measurements (metrics 1-3) ──

  /**
   * `efsp-metrics-report`. The reporting controller must hold the Position
   * right now, as Primary or Observer (the ADR 0029 binding: a client claim is
   * checked at the wire). Events are validated one by one; valid ones in a
   * partly invalid report are kept. No search text is ever sent or stored.
   *
   * Every event is stamped with the server's mission clock ON RECEIPT; a
   * client `at` is ignored (S-R2-3), so one clock decides every bucket.
   */
  handleReport(session, msg, now = this._clock.now()) {
    const ack = (extra) => ({ version: VERSION, type: 'efsp-metrics-report-ack', reportId: msg && msg.reportId, ...extra });
    const invalid = (detail) => ack({ ok: false, reason: 'VALIDATION_ERROR', detail });
    if (!msg || typeof msg.reportId !== 'string' || !msg.reportId || msg.reportId.length > 128) return invalid('reportId must be a non-empty string');
    if (!this._facilityIds.includes(msg.facilityId)) return invalid(`unknown facilityId: ${msg.facilityId}`);
    if (typeof msg.positionId !== 'string' || !msg.positionId) return invalid('positionId is required');
    if (!Array.isArray(msg.events)) return invalid('events must be a list');
    if (msg.events.length > MAX_EVENTS_PER_REPORT) return invalid(`at most ${MAX_EVENTS_PER_REPORT} events per report`);
    const store = this._positionStoreFor(msg.facilityId);
    const controllerId = session && session.controllerId;
    const holds = !!store && !!controllerId
      && (store.primaryOf(msg.positionId) === controllerId
        // observersOf() lists { controllerId, controllerName, since } records
        || store.observersOf(msg.positionId).some(o => (o && typeof o === 'object' ? o.controllerId : o) === controllerId));
    if (!holds) {
      return ack({ ok: false, reason: 'NOT_HOLDING_POSITION', detail: `you do not hold ${msg.positionId} at ${msg.facilityId}` });
    }
    if (this._reports.has(msg.reportId)) return ack({ ok: true, accepted: 0, rejected: [], duplicate: true });
    this._reports.add(msg.reportId);

    const rejected = [];
    let accepted = 0;
    msg.events.forEach((ev, index) => {
      const problem = this._eventProblem(ev);
      if (problem) { rejected.push({ index, reason: 'VALIDATION_ERROR', detail: problem }); return; }
      this._recordClientEvent(msg.facilityId, msg.positionId, ev, now);
      accepted += 1;
    });
    if (accepted > 0 && (this._sources.client === null || this._sources.client === undefined)) {
      this._sources.client = now;
      this._dirty = true;
    }
    return ack({ ok: true, accepted, rejected });
  }

  _eventProblem(ev) {
    if (!ev || typeof ev !== 'object') return 'event must be an object';
    if (ev.bayId !== undefined && (typeof ev.bayId !== 'string' || ev.bayId.length > 64)) return 'bayId must be a short string';
    switch (ev.kind) {
      case 'SEARCH': return null;
      case 'TIME_TO_FIND':
        if (!Number.isInteger(ev.latencyMs) || ev.latencyMs < 0 || ev.latencyMs > MAX_LATENCY_MS) return `latencyMs out of range (integer 0..${MAX_LATENCY_MS})`;
        return null;
      case 'GESTURE':
        if (!GESTURES.includes(ev.gesture)) return `gesture must be one of ${GESTURES.join(', ')}`;
        if (!Number.isInteger(ev.inputs) || ev.inputs < 1 || ev.inputs > MAX_GESTURE_INPUTS) return `inputs out of range (integer 1..${MAX_GESTURE_INPUTS})`;
        return null;
      default: return `unknown event kind: ${JSON.stringify(ev.kind)}`;
    }
  }

  _recordClientEvent(facilityId, positionId, ev, now) {
    this._record(now, (b) => {
      if (ev.kind === 'SEARCH') {
        const s = b.search || (b.search = {});
        const row = s[positionId] || (s[positionId] = { facilityId, count: 0 });
        row.count += 1;
      } else if (ev.kind === 'TIME_TO_FIND') {
        const t = b.ttf || (b.ttf = {});
        const row = t[positionId] || (t[positionId] = { facilityId, samples: [], dropped: 0 });
        // Past the cap the NEWEST are dropped, and counted, so a flood cannot
        // grow the file and the loss is visible.
        if (row.samples.length < TTF_SAMPLE_CAP) row.samples.push(ev.latencyMs);
        else row.dropped += 1;
      } else if (ev.kind === 'GESTURE') {
        const g = b.gestures || (b.gestures = {});
        const row = g[ev.gesture] || (g[ev.gesture] = { count: 0, inputsSum: 0, inputsMax: 0, overCeiling: 0 });
        row.count += 1;
        row.inputsSum += ev.inputs;
        row.inputsMax = Math.max(row.inputsMax, ev.inputs);
        if (ev.inputs > 1) row.overCeiling += 1;
      }
    });
  }

  // ── the report (docs/adr/0065 "Exposure" — a contract L15 builds against) ──

  missionSessions() {
    const current = this._missions.length ? this._missions[this._missions.length - 1].seq : null;
    return this._missions.map(m => ({ seq: m.seq, theatre: m.theatre, startedAt: m.startedAt, lastAt: m.lastAt, current: m.seq === current }));
  }

  /**
   * @param {{hours?:number|null, missionSession?:number|null}} q
   *   missionSession: default the current one. hours: the last N hours of that
   *   session; default the whole session (capped at 720).
   * @returns {object} the metrics body; throws RangeError for an unknown session
   */
  buildMetricsBody({ hours = null, missionSession = null } = {}) {
    const now = this._clock.now();
    const current = this._mission();
    const target = missionSession === null ? current : this._missions.find(m => m.seq === missionSession);
    if (!target) throw new RangeError(`unknown missionSession: ${missionSession}`);
    const isCurrent = target.seq === current.seq;
    const end = isCurrent ? now : (target.lastAt ?? target.startedAt);
    const sessionHours = Math.floor(end / HOUR_MS) - Math.floor(target.startedAt / HOUR_MS) + 1;
    const n = hours !== null ? hours : Math.min(MAX_WINDOW_HOURS, Math.max(1, sessionHours));
    const hourKeys = hourRange(end, n);
    const window = hourKeys.map(h => [h, this._buckets.get(`${target.seq}|${h}`)]).filter(([, b]) => b);

    let lastHour = null;
    if (isCurrent) {
      this._pruneMinutes(now);
      const from = now - ROLLING_WINDOW_MS;
      const minutes = [...this._minutes.values()].filter(m => m.mission === target.seq && m.minute >= Math.floor(from / MINUTE_MS) * MINUTE_MS && m.minute <= now);
      lastHour = { from, to: now, metrics: this._aggregate(minutes.map(m => [null, m]), target.seq) };
    }

    return {
      ok: true, version: VERSION, generatedAt: now, serviceStartedAt: this._serviceStartedAt,
      missionSession: { seq: target.seq, theatre: target.theatre, startedAt: target.startedAt, lastAt: target.lastAt, current: isCurrent },
      missionSessions: this.missionSessions(),
      windowHours: n,
      hours: hourKeys,
      sources: { client: this._sources.client ?? null, staleness: this._sources.staleness ?? null },
      metrics: this._aggregate(window, target.seq),
      lastHour,
    };
  }

  /**
   * The nine metric blocks over a list of [hourKey|null, bucket]. A null key
   * (the rolling hour's minute buckets) contributes to the totals but to no
   * `byHour` series, so the rolling block has the same shape with empty series.
   */
  _aggregate(entries, seq) {
    const series = (h) => h !== null;
    const clientStatus = (has) => (this._sources.client === null || this._sources.client === undefined ? 'NOT_INSTRUMENTED' : has ? 'COLLECTING' : 'NO_DATA');

    // 1 — search invocations per manned Position-hour
    const byPosition = {};
    let searchTotal = 0;
    for (const [h, b] of entries) {
      const positions = new Set([...Object.keys(b.search || {}), ...Object.keys(b.manning || {})]);
      for (const p of positions) {
        const s = (b.search || {})[p];
        const m = (b.manning || {})[p];
        const row = byPosition[p] || (byPosition[p] = { facilityId: (s || m).facilityId, total: 0, mannedMinutes: 0, byHour: {} });
        const count = s ? s.count : 0;
        const minutes = m ? m.minutes : 0;
        row.total += count;
        row.mannedMinutes += minutes;
        searchTotal += count;
        if (series(h)) row.byHour[h] = { missionSession: seq, count, mannedMinutes: minutes, perMannedHour: minutes > 0 ? count / (minutes / 60) : null };
      }
    }
    for (const row of Object.values(byPosition)) {
      row.mannedHours = row.mannedMinutes / 60;
      row.perMannedHour = row.mannedMinutes > 0 ? row.total / row.mannedHours : null;
      delete row.mannedMinutes;
    }
    const searchHas = entries.some(([, b]) => b.search);

    // 2 — time-to-find
    const allTtf = [];
    const ttfByPosition = {};
    const ttfByHour = {};
    let dropped = 0;
    for (const [h, b] of entries) {
      const hourSamples = [];
      for (const [p, row] of Object.entries(b.ttf || {})) {
        (ttfByPosition[p] || (ttfByPosition[p] = [])).push(...row.samples);
        hourSamples.push(...row.samples);
        dropped += row.dropped || 0;
      }
      if (!hourSamples.length) continue;
      allTtf.push(...hourSamples);
      if (series(h)) {
        const s = summarize(hourSamples);
        ttfByHour[h] = { missionSession: seq, samples: s.samples, p95Ms: s.p95Ms };
      }
    }
    const ttf = summarize(allTtf);

    // 3 — inputs per paper gesture, and the server's own SetFlag count
    const byGesture = {};
    const serverSetFlagMutations = {};
    for (const g of GESTURES) {
      let count = 0, sum = 0, max = 0, over = 0, flags = 0;
      for (const [, b] of entries) {
        const row = (b.gestures || {})[g];
        if (row) { count += row.count; sum += row.inputsSum; max = Math.max(max, row.inputsMax); over += row.overCeiling; }
        flags += (b.setFlag || {})[g] || 0;
      }
      byGesture[g] = { count, meanInputs: count ? sum / count : null, maxInputs: count ? max : null, overCeiling: over };
      serverSetFlagMutations[g] = flags;
    }
    const gestureHas = entries.some(([, b]) => b.gestures);

    // 4 — correlation
    let matched = 0, eligible = 0, corrSamples = 0;
    const corrByHour = {};
    for (const [h, b] of entries) {
      if (!b.correlation) continue;
      matched += b.correlation.matchedSum;
      eligible += b.correlation.eligibleSum;
      corrSamples += b.correlation.samples;
      if (series(h)) corrByHour[h] = { missionSession: seq, rate: ratio(b.correlation.matchedSum, b.correlation.eligibleSum), samples: b.correlation.samples };
    }
    let live = null;
    if (this._correlationStats) {
      try { live = this._correlationStats() || null; } catch (e) { console.warn('[efsp-metrics] correlation stats getter threw:', e.message); }
    }

    // 5 — rejected Mutations
    const rej = { mutations: 0, total: 0, byReason: {}, byType: {}, byOp: {}, byPosition: {} };
    const rejByHour = {};
    for (const [h, b] of entries) {
      const r = b.rejections;
      if (!r) continue;
      rej.mutations += r.mutations; rej.total += r.total;
      for (const k of ['byReason', 'byType', 'byOp', 'byPosition']) for (const [key, v] of Object.entries(r[k])) inc(rej[k], key, v);
      if (series(h)) rejByHour[h] = { missionSession: seq, mutations: r.mutations, total: r.total, byReason: { ...r.byReason } };
    }

    // 6 — staleness (L19)
    const stalenessDeclared = this._sources.staleness !== null && this._sources.staleness !== undefined;
    const stale = { total: stalenessDeclared ? 0 : null, byPosition: {}, byState: {}, byHour: {} };
    for (const [h, b] of entries) {
      if (!b.staleness) continue;
      stale.total = (stale.total || 0) + b.staleness.total;
      for (const [k, v] of Object.entries(b.staleness.byPosition)) inc(stale.byPosition, k, v);
      for (const [k, v] of Object.entries(b.staleness.byState)) inc(stale.byState, k, v);
      if (series(h)) stale.byHour[h] = { missionSession: seq, total: b.staleness.total };
    }

    // 7 — transfers
    const tr = { attempts: 0, succeeded: 0, failed: 0, routedToCovering: 0, inhibitedPress: 0, byCause: {}, byKind: {} };
    for (const k of TRANSFER_KINDS) tr.byKind[k] = { attempts: 0, failed: 0 };
    const trByHour = {};
    for (const [h, b] of entries) {
      const t = b.transfers;
      if (!t) continue;
      tr.attempts += t.attempts; tr.succeeded += t.succeeded; tr.failed += t.failed;
      tr.routedToCovering += t.routedToCovering; tr.inhibitedPress += t.inhibitedPress || 0;
      for (const [k, v] of Object.entries(t.byCause)) inc(tr.byCause, k, v);
      for (const [k, v] of Object.entries(t.byKind)) {
        const row = tr.byKind[k] || (tr.byKind[k] = { attempts: 0, failed: 0 });
        row.attempts += v.attempts; row.failed += v.failed;
      }
      if (series(h)) trByHour[h] = { missionSession: seq, attempts: t.attempts, failed: t.failed, inhibitedPress: t.inhibitedPress || 0, byCause: { ...t.byCause } };
    }

    // not §11.5: obligations (L7's, verbatim — counts, not rates: `met` is only
    // meaningful for ADVANCE_FORWARDING and VOID_TIME_EXPIRED, ADR 0067) and
    // system reassignments
    let obligationsLive = null;
    let obligationsStatus = 'NOT_INSTRUMENTED';
    if (this._obligationStats) {
      try { obligationsLive = this._obligationStats() || {}; obligationsStatus = 'COLLECTING'; } catch (e) { console.warn('[efsp-metrics] obligation stats getter threw:', e.message); }
    }
    let reassigned = 0;
    const reassignedByHour = {};
    for (const [h, b] of entries) {
      if (!b.systemReassigned) continue;
      reassigned += b.systemReassigned;
      if (series(h)) reassignedByHour[h] = { missionSession: seq, total: b.systemReassigned };
    }

    return {
      searchInvocations: {
        status: clientStatus(searchHas), target: { kind: 'TRENDING_DOWN' },
        total: searchTotal, byPosition,
      },
      timeToFind: {
        status: clientStatus(allTtf.length > 0), target: { kind: 'P95_BELOW_MS', value: TIME_TO_FIND_TARGET_MS },
        samples: ttf.samples, p50Ms: ttf.p50Ms, p95Ms: ttf.p95Ms, maxMs: ttf.maxMs,
        pass: ttf.p95Ms === null ? null : ttf.p95Ms < TIME_TO_FIND_TARGET_MS,
        droppedSamples: dropped,
        byPosition: Object.fromEntries(Object.entries(ttfByPosition).map(([p, v]) => [p, summarize(v)])),
        byHour: ttfByHour,
      },
      gestureInputs: {
        status: clientStatus(gestureHas), target: { kind: 'EQUALS', value: 1 },
        byGesture, serverSetFlagMutations,
      },
      correlation: {
        status: !this._correlationStats ? 'NOT_INSTRUMENTED' : corrSamples > 0 ? 'COLLECTING' : 'NO_DATA',
        target: { kind: 'AT_LEAST', value: CORRELATION_TARGET },
        windowRate: ratio(matched, eligible), live, byHour: corrByHour,
      },
      rejectedMutations: {
        status: !this._tapInstalled ? 'NOT_INSTRUMENTED' : rej.mutations > 0 ? 'COLLECTING' : 'NO_DATA',
        target: { kind: 'TRENDING_DOWN' },
        mutations: rej.mutations, total: rej.total,
        byReason: rej.byReason, byType: rej.byType, byOp: rej.byOp, byPosition: rej.byPosition,
        byHour: rejByHour,
      },
      staleness: {
        status: !stalenessDeclared ? 'NOT_INSTRUMENTED' : stale.total > 0 ? 'COLLECTING' : 'NO_DATA',
        target: { kind: 'TRENDING_DOWN' },
        total: stale.total, byPosition: stale.byPosition, byState: stale.byState, byHour: stale.byHour,
      },
      transfers: {
        status: !this._tapInstalled ? 'NOT_INSTRUMENTED' : tr.attempts > 0 ? 'COLLECTING' : 'NO_DATA',
        target: { kind: 'AT_MOST', value: TRANSFER_FAILURE_TARGET },
        attempts: tr.attempts, succeeded: tr.succeeded, failed: tr.failed,
        failureRate: ratio(tr.failed, tr.attempts), routedToCovering: tr.routedToCovering,
        inhibitedPress: tr.inhibitedPress,
        byCause: tr.byCause, byKind: tr.byKind, byHour: trByHour,
      },
      obligations: { status: obligationsStatus, live: obligationsLive },
      systemReassigned: { total: reassigned, byHour: reassignedByHour },
    };
  }
}

// ── composition: the tap, the builders, the WS request ────────────────────

/**
 * Builds the metric store and the traffic count, and installs the tap on
 * `efsp.handleMessage`. server.js calls this once, before server.listen().
 *
 * The two getters are closures over consts server.js declares AFTER this call
 * (T12): they must not be called here, only from tick() or a request.
 */
function createEfspInstrumentation({
  efsp, facilityConfig, correlationStats = null, obligationStats = null,
  clock = efsp.clock || WALL_CLOCK, wallNow = () => Date.now(),
  config = getInstrumentationConfig(), metricsPath, trafficCountPath,
}) {
  const facilityIds = facilityConfig.getFacilityIds();
  const dup = duplicatePositionIds(facilityConfig);
  if (dup.length) console.warn(`[efsp-metrics] Position ids ${dup.join(', ')} exist in more than one Facility — metrics keyed by positionId will merge them (docs/adr/0065)`);

  const metrics = new EfspMetrics({
    path: metricsPath, clock, wallNow, config: config.metrics, facilityIds,
    positionStoreFor: efsp.positionStoreFor, correlationStats, obligationStats,
  });
  const trafficCount = new TrafficCount({
    mutationLog: efsp.mutationLog, fdrStore: efsp.fdrStore, boardStoreFor: efsp.boardStoreFor,
    facilityIds, config: config.trafficCount, path: trafficCountPath, clock, wallNow,
    missionSessionOf: () => metrics.currentMissionSession(),
  });
  efsp.mutationLog.onRecord((entry) => {
    if (entry && entry.ok !== false && entry.op === 'SystemReassign') metrics.recordSystemReassign({ at: entry.at });
  });

  const defaultFacilityId = facilityConfig.DEFAULT_FACILITY_ID;
  const seenMutations = new BoundedSet(MUTATION_DEDUPE_CAP);

  // ── read builders, shared by HTTP and WS ──

  function parseMetricsQuery(q = {}) {
    const hours = _intParam(q.hours, { min: 1, max: MAX_WINDOW_HOURS, name: 'hours' });
    if (hours.error) return { error: hours.error };
    const mission = _intParam(q.missionSession, { min: 1, name: 'missionSession' });
    if (mission.error) return { error: mission.error };
    return { hours: hours.value, missionSession: mission.value };
  }

  function parseTrafficQuery(q = {}) {
    const facilityId = q.facilityId === undefined || q.facilityId === null || q.facilityId === '' ? null : q.facilityId;
    if (facilityId !== null && !facilityIds.includes(facilityId)) return { error: `unknown facilityId: ${facilityId}` };
    const from = _intParam(q.from, { name: 'from' });
    if (from.error) return { error: from.error };
    const to = _intParam(q.to, { name: 'to' });
    if (to.error) return { error: to.error };
    if (from.value !== null && to.value !== null && from.value > to.value) return { error: 'from must not be after to' };
    const mission = _intParam(q.missionSession, { min: 1, name: 'missionSession' });
    if (mission.error) return { error: mission.error };
    const detail = q.detail === true || q.detail === 1 || q.detail === '1' || q.detail === 'true';
    return { facilityId, from: from.value, to: to.value, detail, missionSession: mission.value };
  }

  function _bad(detail) { return { status: 400, body: { ok: false, reason: 'VALIDATION_ERROR', detail } }; }

  /** GET /api/efsp/metrics — `{ status, body }`, never throws. */
  function metricsHttp(query) {
    try {
      const q = parseMetricsQuery(query);
      if (q.error) return _bad(q.error);
      return { status: 200, body: metrics.buildMetricsBody(q) };
    } catch (e) {
      if (e instanceof RangeError) return { status: 404, body: { ok: false, reason: 'NOT_FOUND', detail: e.message } };
      console.error('[efsp-metrics] metrics report failed:', e);
      return { status: 503, body: { ok: false, reason: 'metrics report failed unexpectedly' } };
    }
  }

  /** GET /api/efsp/traffic-count — `{ status, body }`, never throws. */
  function trafficCountHttp(query) {
    try {
      const q = parseTrafficQuery(query);
      if (q.error) return _bad(q.error);
      return { status: 200, body: trafficCount.report(q) };
    } catch (e) {
      console.error('[efsp-metrics] traffic count report failed:', e);
      return { status: 503, body: { ok: false, reason: 'traffic count report failed unexpectedly' } };
    }
  }

  function _metricsRequestAck(msg) {
    const base = { version: VERSION, type: 'efsp-metrics', requestId: msg.requestId };
    const m = metricsHttp({ hours: msg.hours, missionSession: msg.missionSession });
    if (m.status !== 200) return { ...base, ...m.body };
    const out = { ...base, ok: true, metrics: m.body };
    if (msg.trafficCount && typeof msg.trafficCount === 'object') {
      const t = trafficCountHttp(msg.trafficCount);
      if (t.status !== 200) return { ...base, ...t.body };
      out.trafficCount = t.body;
    }
    return out;
  }

  // ── the tap ──

  function _pre(msg) {
    if (msg.type !== 'efsp-mutation' || !msg.op || msg.op.kind !== 'InvokeNla') return null;
    const board = efsp.boardStoreFor(msg.facilityId || defaultFacilityId);
    const strip = board && board.getStrip(msg.stripId);
    // Only the OWNER's press can be a transfer (T4): once a transfer commits,
    // nlaStatusFor describes the receiver's next step, not the sender's.
    // nlaStatusFor, never efsp-ws's _stampStrip, which would notify the NLA
    // status monitor (T17).
    if (!strip || strip.ownerPositionId !== msg.actingPositionId) return null;
    const status = board.nlaStatusFor(strip);
    if (!status) return null;
    // Pressed against its own inhibit: nothing was attempted (S-R2-5).
    if (status.inhibited) return { inhibitedPress: true };
    return status.transferTo ? { nlaTransfer: true } : null;
  }

  // Per-connection records — memory only, never on the wire (H35, S-R2-4).
  const liveSessions = new WeakMap();
  const liveSessionList = new Set();
  const endedSessions = [];
  function _sessionRecord(session, at) {
    if (!session || typeof session !== 'object') return null;
    let rec = liveSessions.get(session);
    if (!rec) {
      rec = { sessionId: crypto.randomUUID(), controllerId: session.controllerId || null, startedAt: at, endedAt: null,
        mutations: 0, rejected: 0, byReason: {}, transfers: { attempts: 0, failed: 0 } };
      liveSessions.set(session, rec);
      liveSessionList.add(rec);
    }
    return rec;
  }

  function _post(session, msg, result, pre) {
    if (!/-mutation$/.test(msg.type) || !result || !result.ack) return;
    // A reconnecting client replays its queue; the store answers from cache.
    // Count each clientMutationId once (T2).
    const id = msg.clientMutationId;
    if (id !== undefined && id !== null) {
      if (seenMutations.has(id)) return;
      seenMutations.add(id);
    }
    const ack = result.ack;
    const ok = ack.ok !== false;
    const at = clock.now();
    const op = msg.op && msg.op.kind;
    metrics.recordMutation({ at, type: msg.type, op, positionId: msg.actingPositionId, ok, reason: ack.reason });
    const rec = _sessionRecord(session, at);
    if (rec) {
      rec.mutations += 1;
      if (!ok) { rec.rejected += 1; inc(rec.byReason, ack.reason || 'UNKNOWN'); }
    }

    if (msg.type === 'efsp-mutation') {
      const kind = op === 'TransferStrip' ? 'TRANSFER' : pre && pre.nlaTransfer ? 'NLA_TRANSFER' : null;
      if (kind) {
        metrics.recordTransfer({ at, kind, ok, cause: ack.reason, routedTo: ack.routedTo });
        if (rec) { rec.transfers.attempts += 1; if (!ok) rec.transfers.failed += 1; }
      } else if (pre && pre.inhibitedPress) {
        metrics.recordInhibitedPress({ at });
      }
      if (ok && op === 'SetFlag' && msg.op) metrics.recordSetFlag({ at, flag: msg.op.flag });
    }

    // §11.3: every Mutation is recorded, refusals included. board-store logs
    // none of its refusals (T1), and NOT_HOLDING_POSITION never reaches any
    // store; the airspace/correlation/MARSA stores already log their own.
    if (!ok && (msg.type === 'efsp-mutation' || ack.reason === 'NOT_HOLDING_POSITION')) {
      const subject = {};
      for (const k of ['stripId', 'airspaceId', 'fdrId', 'marsaId']) if (msg[k] !== undefined) subject[k] = msg[k];
      efsp.mutationLog.record({
        clientMutationId: id === undefined ? null : id,
        type: msg.type,
        op: op || null,
        ...subject,
        facilityId: ack.facilityId || msg.facilityId || null,
        actingPositionId: msg.actingPositionId || null,
        actorId: (session && session.controllerId) || null,
        at,
        ok: false,
        reason: ack.reason || 'UNKNOWN',
        detail: ack.detail || null,
        source: 'wire',
      });
    }
  }

  const original = efsp.handleMessage;
  efsp.handleMessage = (session, msg) => {
    if (msg && msg.type === 'efsp-metrics-report') {
      try { return { ack: metrics.handleReport(session, msg) }; } catch (e) {
        console.warn('[efsp-metrics] report handling failed:', e.message);
        return { ack: { version: VERSION, type: 'efsp-metrics-report-ack', reportId: msg.reportId, ok: false, reason: 'INTERNAL_ERROR' } };
      }
    }
    if (msg && msg.type === 'efsp-metrics-request') {
      return { ack: _metricsRequestAck(msg) };
    }
    let pre = null;
    try { if (msg && typeof msg.type === 'string') pre = _pre(msg); } catch (e) { console.warn('[efsp-metrics] tap (pre) failed:', e.message); }
    const result = original(session, msg);
    try { if (msg && typeof msg.type === 'string') _post(session, msg, result, pre); } catch (e) { console.warn('[efsp-metrics] tap failed:', e.message); }
    return result;
  };
  const originalDisconnect = efsp.onDisconnect;
  efsp.onDisconnect = (session) => {
    try {
      const rec = session && liveSessions.get(session);
      if (rec) {
        rec.endedAt = clock.now();
        liveSessions.delete(session);
        liveSessionList.delete(rec);
        endedSessions.push(rec);
        if (endedSessions.length > SESSION_RECORDS_KEPT) endedSessions.shift();
      }
    } catch (e) { console.warn('[efsp-metrics] tap (disconnect) failed:', e.message); }
    return originalDisconnect(session);
  };
  metrics._tapInstalled = true;

  return {
    metrics,
    trafficCount,
    tick: () => metrics.tick(),
    noteMissionLoad: (missionData) => metrics.noteMissionLoad({ theatre: missionData && missionData.theatre }),
    metricsHttp,
    trafficCountHttp,
    /** Per-connection records, live first then the last 50 ended. In-process only — never serve these (H35). */
    sessionRecords: () => [...liveSessionList, ...[...endedSessions].reverse()].map(r => ({ ...r, byReason: { ...r.byReason }, transfers: { ...r.transfers } })),
  };
}

module.exports = {
  EfspMetrics,
  createEfspInstrumentation,
  duplicatePositionIds,
  percentile,
  hourRange,
  METRICS_PATH,
  GESTURES,
  FLAG_TO_GESTURE,
  KNOWN_SOURCES,
  TTF_SAMPLE_CAP,
};
