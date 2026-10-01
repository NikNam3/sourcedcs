'use strict';

// The §11.4 traffic count (docs/adr/0065): one COUNT record per DROPPED Strip
// per Facility, frozen at the moment of the drop, with the categories the
// guide names — local/transient, formation, SUA traversal, alert scramble —
// by UTC hour and by aircraft type. Every drop in the Mutation log has exactly
// one record, counted or not; a drop that is not traffic (a proposal thrown
// away, a mission line, a declined replica) carries an `excludedReason`
// instead of vanishing, so a controller can see why it is not in `flights`
// and the reconciliation below is total.
//
// [SOURCE-DEFINED], all of it: the unit (a flight, i.e. one Strip, with the
// aircraft count beside it — decisions.md H34), the countability rules
// (COUNTABLE_PRE_DROP_STATES), "local" meaning a sortie that departs and
// lands at the Facility's own airfield (H33), and the hour a record lands in
// (the drop, not the takeoff or landing minute).
//
// Fed by MutationLog.onRecord — never by board-store.js, which it does not
// touch. Reconciles against the same log (WP8 acceptance bullet 3): one pure
// predicate pair (isDropTransition/isUndoOfDrop) and one pure countability
// rule, used by both the live listener and reconcileTrafficCount().
//
// Persistence: append-only JSONL (`state/efsp-traffic-count.jsonl`), one line
// per drop or void, never part of efsp-board.json. Retention (default 400
// days, config/efsp-instrumentation.json) is applied ONLY at boot, by an
// atomic sibling-and-rename rewrite. Retention and "which records does the
// retained log still cover" are measured on the WALL clock (a storage
// lifetime); droppedAt and hourUtc are the mission clock (decisions.md H11).

const fs = require('fs');
const { writePath, ensureDirFor } = require('../state-paths');
const { WALL_CLOCK } = require('../mission-clock');
const { getInstrumentationConfig } = require('./instrumentation-config');
const { SCRAMBLE_PRE_AIRBORNE: _SCRAMBLE_PRE } = require('./alert-scramble');

const TRAFFIC_COUNT_PATH = writePath('efsp-traffic-count.jsonl', process.env.CRCSYNC_EFSP_TRAFFIC_COUNT_PATH);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The states a Strip must have been in, just before its drop, to be traffic.
 * EVERY Role must have an entry — a test holds this table to nla.js's
 * STATES_BY_ROLE, so a new Role (L17's carrier roles) forces a decision
 * instead of silently vanishing from the count (the ADR 0041 argument).
 */
const COUNTABLE_PRE_DROP_STATES = Object.freeze({
  DEPARTURE: Object.freeze(['DEPARTED', 'HANDED_OFF']),   // it got airborne
  ARRIVAL: Object.freeze(['LANDED', 'TAXI_IN']),          // it got down
  OVERFLIGHT: Object.freeze(['TRANSITING']),              // its only live state
  MISSION: Object.freeze([]),                             // never: shares its FDR with the ATC Strip TOFI linked it to
});

const EXCLUDED_WHEN_NOT_COUNTABLE = Object.freeze({
  DEPARTURE: 'NEVER_DEPARTED',
  ARRIVAL: 'NEVER_LANDED',
  OVERFLIGHT: 'NEVER_TRANSITED',
  MISSION: 'MISSION_LINE',
});

const POLICY = '[SOURCE-DEFINED] one record per DROPPED ATC Strip per Facility; see ADR 0065';

// ── pure helpers ──────────────────────────────────────────────────────────

/** 'YYYY-MM-DDTHH:00Z' — the UTC hour of an epoch-ms instant (guide §11.2: all times UTC). */
function hourKey(ms) {
  return `${new Date(ms).toISOString().slice(0, 13)}:00Z`;
}

/** A log entry that took a Strip INTO DROPPED. Refusals (`ok:false`) never are (T7). */
function isDropTransition(entry) {
  return !!(entry && entry.ok !== false && entry.after && entry.after.state === 'DROPPED'
    && (!entry.before || entry.before.state !== 'DROPPED'));
}

/** An Undo that took a Strip back OUT of DROPPED — voids the record the drop made. */
function isUndoOfDrop(entry) {
  return !!(entry && entry.ok !== false && entry.op === 'Undo' && entry.before && entry.before.state === 'DROPPED'
    && entry.after && entry.after.state !== 'DROPPED');
}

/**
 * A boot marker saying an earlier line never took effect (docs/adr/0081): the
 * process died between writing it and persisting the Board. It voids the drop
 * record that line made, if that line was a drop — matched by stripId and
 * clientMutationId, since the marker does not repeat the before/after.
 */
function isNotPersistedDrop(entry) {
  return !!(entry && entry.op === 'NotPersisted' && entry.stripId && entry.clientMutationId);
}

/**
 * Is this drop traffic? A pure function of the log entry's own before/after
 * Strip records, so the reconciliation can decide it from the log alone.
 * @returns {{counted:boolean, excludedReason:string|null}}
 */
function countability(before, after) {
  const role = after && after.role;
  if (role === 'MISSION') return { counted: false, excludedReason: 'MISSION_LINE' };
  const coord = after && after.coordination;
  if (coord && coord.state === 'REJECTED' && coord.mintedForCoordination) {
    // A replica the receiving Facility declined: the flight never became
    // this Facility's traffic (board-store.js _isRejectedReplica).
    return { counted: false, excludedReason: 'REJECTED_REPLICA' };
  }
  const states = COUNTABLE_PRE_DROP_STATES[role];
  if (!states) return { counted: false, excludedReason: 'UNCLASSIFIED_ROLE' };
  const pre = before && before.state;
  if (states.includes(pre)) return { counted: true, excludedReason: null };
  return { counted: false, excludedReason: EXCLUDED_WHEN_NOT_COUNTABLE[role] || 'UNCLASSIFIED_ROLE' };
}

function _code(v) { return typeof v === 'string' ? v.trim().toUpperCase() : ''; }

/**
 * LOCAL | TRANSIENT | UNKNOWN, and why. "Local" is a sortie that departs and
 * lands at this Facility's own airfield (decisions.md H33, [SOURCE-DEFINED]);
 * real tower counts also call pattern work local, which the EFSP has no data
 * for. `identity.homeStation` is deliberately NOT used — it is the unit's
 * home, not the field's.
 */
function classifyLocality(strip, fdr, homeAirports) {
  if (strip && strip.role === 'OVERFLIGHT') return { locality: 'TRANSIENT', localityBasis: 'OVERFLIGHT' };
  if (strip && strip.role === 'ARRIVAL' && strip.previousLeg) return { locality: 'LOCAL', localityBasis: 'CONVERTED_ARRIVAL' };
  const home = new Set((homeAirports || []).map(_code).filter(Boolean));
  if (home.size === 0) return { locality: 'UNKNOWN', localityBasis: 'NO_HOME_AIRPORT_CONFIGURED' };
  const filed = (fdr && fdr.filed) || {};
  if (strip && strip.role === 'ARRIVAL') {
    const origin = _code(filed.originAirport);
    if (!origin) return { locality: 'UNKNOWN', localityBasis: 'NO_AIRPORT_DATA' };
    return { locality: home.has(origin) ? 'LOCAL' : 'TRANSIENT', localityBasis: 'AIRPORTS' };
  }
  const dep = _code(filed.departureAirport);
  const dest = _code(filed.destinationAirport);
  if (!dep || !dest) return { locality: 'UNKNOWN', localityBasis: 'NO_AIRPORT_DATA' };
  return { locality: home.has(dep) && home.has(dest) ? 'LOCAL' : 'TRANSIENT', localityBasis: 'AIRPORTS' };
}

function normalizeAircraftType(t) {
  const s = _code(t);
  return s || 'UNKNOWN';
}

function countIdFor(entry) {
  return `${entry.stripId}:${entry.clientMutationId || entry.at}`;
}

/** The fields of a record the Mutation log alone determines — what the reconciliation compares. */
function logDerivedRecord(entry, suaIds) {
  const { counted, excludedReason } = countability(entry.before, entry.after);
  return {
    countId: countIdFor(entry),
    stripId: entry.stripId,
    droppedAt: entry.at,
    hourUtc: hourKey(entry.at),
    role: entry.after.role || null,
    dropOp: entry.op || null,
    counted,
    excludedReason,
    suaTraversal: [...(suaIds || [])].sort(),
    dropWallAt: Number.isFinite(entry.wallAt) ? entry.wallAt : null,
    dropClientMutationId: entry.clientMutationId || null,
  };
}

const RECONCILED_FIELDS = ['stripId', 'droppedAt', 'hourUtc', 'role', 'counted', 'excludedReason', 'suaTraversal', 'dropOp'];

function _approvedAirspace(entry) {
  return entry.ok !== false && entry.op === 'ApproveAirspaceEntry' && entry.after && entry.after.airspaceEntry
    ? entry.after.airspaceEntry.airspaceId || null
    : null;
}

/**
 * Replays the log: every drop not undone, keyed by countId, with its
 * log-derived fields and the entry that made it.
 * @returns {Map<string, {record:object, entry:object}>}
 */
function expectedFromLog(logEntries) {
  const sua = new Map();          // stripId -> Set(airspaceId), approvals seen so far
  const pending = new Map();      // countId -> { record, entry }
  const lastByStrip = new Map();  // stripId -> countId of its live drop
  for (const e of logEntries || []) {
    if (!e || e.ok === false || !e.stripId) continue;
    const approved = _approvedAirspace(e);
    if (approved) {
      if (!sua.has(e.stripId)) sua.set(e.stripId, new Set());
      sua.get(e.stripId).add(approved);
    }
    if (isDropTransition(e)) {
      const record = logDerivedRecord(e, sua.get(e.stripId));
      pending.set(record.countId, { record, entry: e });
      lastByStrip.set(e.stripId, record.countId);
    } else if (isUndoOfDrop(e)) {
      const id = lastByStrip.get(e.stripId);
      if (id) { pending.delete(id); lastByStrip.delete(e.stripId); }
    } else if (isNotPersistedDrop(e)) {
      const id = lastByStrip.get(e.stripId);
      if (id && pending.get(id).entry.clientMutationId === e.clientMutationId) { pending.delete(id); lastByStrip.delete(e.stripId); }
    }
  }
  return pending;
}

/** COUNT lines with their VOIDs applied, in file order. */
function liveCountRecords(countEntries) {
  // In file order: a COUNT written AFTER a VOID of its countId revives it. The
  // one way that happens is a drop voided by a NotPersisted marker and then
  // applied by the client's retry, which carries the same clientMutationId and
  // so the same countId (docs/adr/0081).
  const voided = new Set();
  const live = new Map();
  for (const e of countEntries || []) {
    if (!e) continue;
    if (e.type === 'VOID') { voided.add(e.countId); live.delete(e.countId); }
    else if (e.type === 'COUNT') { voided.delete(e.countId); live.set(e.countId, e); }
  }
  return [...live.values()];
}

function _sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) === JSON.stringify(b || []);
  return a === b;
}

/**
 * WP8 acceptance bullet 3: does the traffic count agree with the Mutation log?
 *
 * With `from`/`to` (mission-time epoch ms, `to` exclusive), both sides are
 * cut to drops in that window. Without them, the window is what BOTH stores
 * still hold: the whole retained log, against the count records written since
 * the log's oldest retained entry (the count outlives the log: 400 days vs 30).
 *
 * Only log-derivable fields are compared (RECONCILED_FIELDS). Locality,
 * formation, aircraft type and alert scramble come from the FDR, which the
 * log does not carry; the classifier's unit tests cover those instead.
 */
function reconcileTrafficCount(logEntries, countEntries, { from = null, to = null } = {}) {
  const log = logEntries || [];
  const expectedMap = expectedFromLog(log);
  let records = liveCountRecords(countEntries);
  const inWindow = (ms) => (from === null || ms >= from) && (to === null || ms < to);

  let expected = [...expectedMap.values()].map(x => x.record);
  if (from !== null || to !== null) {
    expected = expected.filter(r => inWindow(r.droppedAt));
    records = records.filter(r => inWindow(r.droppedAt));
  } else if (log.length === 0) {
    records = [];
  } else {
    const first = log[0];
    if (first && Number.isFinite(first.wallAt)) {
      let lower = Infinity;
      for (const e of log) if (Number.isFinite(e.wallAt) && e.wallAt < lower) lower = e.wallAt;
      records = records.filter(r => !Number.isFinite(r.dropWallAt) || r.dropWallAt >= lower);
    }
  }

  const byId = new Map(records.map(r => [r.countId, r]));
  const missing = [];
  const mismatched = [];
  for (const exp of expected) {
    const got = byId.get(exp.countId);
    if (!got) {
      missing.push({ countId: exp.countId, stripId: exp.stripId, droppedAt: exp.droppedAt, clientMutationId: exp.dropClientMutationId });
      continue;
    }
    for (const field of RECONCILED_FIELDS) {
      if (!_sameValue(exp[field], got[field])) mismatched.push({ countId: exp.countId, field, log: exp[field], count: got[field] });
    }
  }
  const expectedIds = new Set(expected.map(r => r.countId));
  const extra = records.filter(r => !expectedIds.has(r.countId))
    .map(r => ({ countId: r.countId, stripId: r.stripId, droppedAt: r.droppedAt }));

  return {
    ok: missing.length === 0 && extra.length === 0 && mismatched.length === 0,
    window: { from, to },
    expected: expected.length,
    actual: records.length,
    missing, extra, mismatched,
  };
}

// ── aggregation ───────────────────────────────────────────────────────────

function emptyTotals() {
  return {
    flights: 0, aircraft: 0, local: 0, transient: 0, unknown: 0,
    formation: 0, formationAircraft: 0, suaTraversal: 0, alertScramble: 0,
    excluded: 0, excludedByReason: {},
  };
}

function addToTotals(t, r) {
  if (!r.counted) {
    t.excluded += 1;
    const reason = r.excludedReason || 'UNKNOWN';
    t.excludedByReason[reason] = (t.excludedByReason[reason] || 0) + 1;
    return;
  }
  const size = Number.isInteger(r.flightSize) && r.flightSize > 0 ? r.flightSize : 1;
  t.flights += 1;
  t.aircraft += size;
  if (r.locality === 'LOCAL') t.local += 1;
  else if (r.locality === 'TRANSIENT') t.transient += 1;
  else t.unknown += 1;
  if (r.formation) { t.formation += 1; t.formationAircraft += size; }
  if (r.suaTraversal && r.suaTraversal.length) t.suaTraversal += 1;
  if (r.alertScramble) t.alertScramble += 1;
}

function emptyTypeTotals() {
  return { flights: 0, aircraft: 0, local: 0, transient: 0, unknown: 0, formation: 0, suaTraversal: 0, alertScramble: 0 };
}

// ── the live counter ──────────────────────────────────────────────────────

class TrafficCount {
  /**
   * @param {object} deps
   * @param {import('./mutation-log').MutationLog} deps.mutationLog
   * @param {object} deps.fdrStore
   * @param {(facilityId:string) => object|null} deps.boardStoreFor
   * @param {string[]} deps.facilityIds
   * @param {{retentionDays?:number, homeAirports?:object}} [deps.config]
   * @param {string} [deps.path]
   * @param {{now:()=>number}} [deps.clock]  the mission clock — report windows and timestamps
   * @param {() => number} [deps.wallNow]    retention only
   * @param {() => (number|null)} [deps.missionSessionOf] the metrics session (decisions.md H32) a drop belongs to
   */
  constructor({ mutationLog, fdrStore, boardStoreFor, facilityIds, config, path: filePath, clock = WALL_CLOCK, wallNow = () => Date.now(), missionSessionOf = () => null }) {
    const defaults = getInstrumentationConfig().trafficCount;
    this._log = mutationLog;
    this._fdrStore = fdrStore;
    this._boardStoreFor = boardStoreFor;
    this._facilityIds = [...(facilityIds || [])];
    this._retentionDays = config && Number.isInteger(config.retentionDays) && config.retentionDays >= 1 ? config.retentionDays : defaults.retentionDays;
    this._homeAirports = (config && config.homeAirports) || defaults.homeAirports;
    this._path = filePath || TRAFFIC_COUNT_PATH;
    this._clock = clock;
    this._wallNow = wallNow;
    this._missionSessionOf = missionSessionOf;

    this._entries = [];          // every COUNT and VOID line retained, file order
    this._records = new Map();   // countId -> COUNT (live and voided)
    this._voided = new Set();
    this._liveByStrip = new Map(); // stripId -> countId of its unvoided drop
    this._sua = new Map();       // stripId -> Set(airspaceId): the SUA latch
    this._scramble = new Set();  // stripId: the alert-scramble latch
    this._lastReconciliation = null;

    this._load();
    this._rebuildLatches();
    this._unsubscribe = mutationLog ? mutationLog.onRecord((entry) => this._onLogEntry(entry)) : () => {};
    this.reconcile({ backfill: true });
  }

  // ── boot ──

  _load() {
    let lines = [];
    try {
      lines = fs.readFileSync(this._path, 'utf8').split('\n').filter(Boolean);
    } catch {
      return;
    }
    const parsed = [];
    for (const line of lines) {
      try { parsed.push(JSON.parse(line)); } catch { console.warn('[efsp-traffic-count] skipping an unreadable line'); }
    }
    const cutoff = this._wallNow() - this._retentionDays * DAY_MS;
    const expired = new Set();
    for (const e of parsed) {
      if (e && e.type === 'COUNT') {
        const t = Number.isFinite(e.dropWallAt) ? e.dropWallAt : e.droppedAt;
        if (Number.isFinite(t) && t < cutoff) expired.add(e.countId);
      }
    }
    const kept = parsed.filter(e => e && (e.type === 'COUNT' || e.type === 'VOID') && !expired.has(e.countId));
    if (expired.size > 0 || kept.length !== lines.length) this._rewrite(kept);
    for (const e of kept) this._index(e);
  }

  /** Boot-only compaction: sibling then rename, so a crash mid-write leaves the old file whole. */
  _rewrite(entries) {
    try {
      ensureDirFor(this._path);
      const tmp = `${this._path}.tmp`;
      fs.writeFileSync(tmp, entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
      fs.renameSync(tmp, this._path);
    } catch (e) {
      console.warn('[efsp-traffic-count] failed to compact:', e.message);
    }
  }

  _index(e) {
    this._entries.push(e);
    if (e.type === 'COUNT') {
      this._records.set(e.countId, e);
      this._voided.delete(e.countId); // a retried drop revives its voided countId (liveCountRecords)
      this._liveByStrip.set(e.stripId, e.countId);
    } else if (e.type === 'VOID') {
      this._voided.add(e.countId);
      const rec = this._records.get(e.countId);
      if (rec && this._liveByStrip.get(rec.stripId) === e.countId) this._liveByStrip.delete(rec.stripId);
    }
  }

  /**
   * The latches only matter for Strips still live, and both come back at
   * boot: SUA from the retained log's approvals, scramble from the FDR as it
   * is now (there is no history of alertStatus anywhere to replay).
   */
  _rebuildLatches() {
    const live = new Map(); // stripId -> strip
    for (const f of this._facilityIds) {
      const bs = this._boardStoreFor(f);
      if (!bs) continue;
      for (const s of bs.getAll()) if (s.state !== 'DROPPED') live.set(s.stripId, s);
    }
    if (live.size === 0) return;
    if (this._log) {
      for (const e of this._log.readAll()) {
        if (!live.has(e.stripId)) continue;
        const a = _approvedAirspace(e);
        if (a) this._latchSua(e.stripId, a);
      }
    }
    for (const s of live.values()) this._maybeLatchScramble(s.stripId, s.fdrId);
  }

  // ── live ──

  _latchSua(stripId, airspaceId) {
    if (!this._sua.has(stripId)) this._sua.set(stripId, new Set());
    this._sua.get(stripId).add(airspaceId);
  }

  _maybeLatchScramble(stripId, fdrId) {
    const fdr = fdrId && this._fdrStore ? this._fdrStore.getFdr(fdrId) : null;
    if (fdr && fdr.military && fdr.military.alertStatus === 'SCRAMBLE') this._scramble.add(stripId);
  }

  _facilityOf(stripId) {
    for (const f of this._facilityIds) {
      const bs = this._boardStoreFor(f);
      if (bs && bs.getStrip(stripId)) return f;
    }
    return null;
  }

  _onLogEntry(entry) {
    if (!entry || entry.ok === false || !entry.stripId) return;
    const strip = entry.after || entry.before;
    if (strip && strip.state !== 'DROPPED') this._maybeLatchScramble(entry.stripId, strip.fdrId);
    // A scramble called off while the aircraft was still on the ground never
    // flew: it counts as the Strip's ordinary operation (decisions.md S-L13).
    // Called off after departure, it was flown and the latch stays.
    if (entry.op === 'SetBlock' && entry.blockId === '14E' && entry.value !== 'SCRAMBLE'
        && entry.before && _SCRAMBLE_PRE.DEPARTURE.includes(entry.before.state)) {
      this._scramble.delete(entry.stripId);
    }
    const approved = _approvedAirspace(entry);
    if (approved) this._latchSua(entry.stripId, approved);

    if (isDropTransition(entry)) {
      this._append(this._buildRecord(entry, { backfilled: false }));
      this._sua.delete(entry.stripId);
      this._scramble.delete(entry.stripId);
    } else if (isUndoOfDrop(entry)) {
      const countId = this._liveByStrip.get(entry.stripId);
      if (!countId) return;
      const rec = this._records.get(countId);
      this._append({
        type: 'VOID', countId, at: entry.at, wallAt: Number.isFinite(entry.wallAt) ? entry.wallAt : this._wallNow(),
        clientMutationId: entry.clientMutationId || null, actorId: entry.actorId || null,
      });
      // The Strip is live again: what it had latched before the drop still holds.
      for (const a of (rec && rec.suaTraversal) || []) this._latchSua(entry.stripId, a);
      if (rec && rec.alertScramble) this._scramble.add(entry.stripId);
    } else if (isNotPersistedDrop(entry)) {
      // The drop this COUNT recorded never reached the Board (a crash before
      // persist); the Strip came back live. VOID it — the retry, if one comes,
      // writes the COUNT again (docs/adr/0081).
      const countId = this._liveByStrip.get(entry.stripId);
      const rec = countId ? this._records.get(countId) : null;
      if (!rec || rec.dropClientMutationId !== entry.clientMutationId) return;
      // Only a COUNT written before the marker: the retry's COUNT (same
      // countId, written after it) is the drop that did take effect.
      if (Number.isFinite(rec.dropWallAt) && Number.isFinite(entry.wallAt) && rec.dropWallAt > entry.wallAt) return;
      this._append({
        type: 'VOID', countId, at: entry.at, wallAt: Number.isFinite(entry.wallAt) ? entry.wallAt : this._wallNow(),
        clientMutationId: entry.clientMutationId, actorId: entry.actorId || null, reason: 'NOT_PERSISTED',
      });
    }
  }

  /**
   * Freezes a record from the log entry plus the FDR as it is RIGHT NOW (the
   * FDR outlives the Strip and keeps changing, T5). Backfill is the one case
   * that uses a later FDR, and says so.
   */
  _buildRecord(entry, { backfilled, sua }) {
    const base = logDerivedRecord(entry, sua || this._sua.get(entry.stripId));
    const strip = entry.after;
    const fdr = strip.fdrId && this._fdrStore ? this._fdrStore.getFdr(strip.fdrId) : null;
    // The entry names its Facility (docs/adr/0083), so a Strip no Board holds any more
    // (archived) keeps it; older entries fall back to looking the Strip up.
    const facilityId = entry.facilityId || this._facilityOf(entry.stripId) || 'UNKNOWN';
    const identity = (fdr && fdr.identity) || {};
    const flightSize = Number.isInteger(identity.flightSize) && identity.flightSize > 0 ? identity.flightSize : 1;
    // An FDR that is gone (archived after the drop — wave 2's L24, S-R2-13)
    // leaves nothing to classify by: UNKNOWN, and say why.
    const { locality, localityBasis } = fdr
      ? classifyLocality(strip, fdr, this._homeAirports[facilityId])
      : { locality: 'UNKNOWN', localityBasis: 'ARCHIVED' };
    const scramble = this._scramble.has(entry.stripId) || !!(fdr && fdr.military && fdr.military.alertStatus === 'SCRAMBLE');
    return {
      type: 'COUNT',
      countId: base.countId,
      stripId: base.stripId,
      fdrId: strip.fdrId || null,
      facilityId,
      role: base.role,
      // The FDR's controller-entered callsign — never a DCS track's (ADR 0059).
      callsign: identity.callsign || null,
      droppedAt: base.droppedAt,
      hourUtc: base.hourUtc,
      dropWallAt: base.dropWallAt,
      missionSession: this._missionSessionOf(),
      dropOp: base.dropOp,
      dropClientMutationId: base.dropClientMutationId,
      actingPositionId: entry.actingPositionId || null,
      actorId: entry.actorId || null,
      counted: base.counted,
      excludedReason: base.excludedReason,
      aircraftType: normalizeAircraftType(identity.aircraftType),
      flightSize,
      legs: strip.previousLeg ? 2 : 1,
      locality, localityBasis,
      formation: flightSize > 1,
      suaTraversal: base.suaTraversal,
      alertScramble: scramble,
      backfilled: !!backfilled,
    };
  }

  _append(e) {
    try {
      ensureDirFor(this._path);
      fs.appendFileSync(this._path, JSON.stringify(e) + '\n');
    } catch (err) {
      // Kept in memory regardless; the next boot's reconciliation finds it
      // missing from the file and backfills it from the log.
      console.warn('[efsp-traffic-count] failed to append:', err.message);
    }
    this._index(e);
  }

  /**
   * L13's escape hatch (Q11): call after writing fdr.military.alertStatus
   * outside a logged Strip Mutation, so a SCRAMBLE that is reset before the
   * drop still counts.
   */
  noteFdr(fdrId) {
    for (const f of this._facilityIds) {
      const bs = this._boardStoreFor(f);
      if (!bs) continue;
      for (const s of bs.getAll()) if (s.fdrId === fdrId && s.state !== 'DROPPED') this._maybeLatchScramble(s.stripId, fdrId);
    }
  }

  /** Stops listening to the Mutation log (tests; a second instance on the same files). */
  close() { this._unsubscribe(); }

  /** Every COUNT/VOID line retained, file order (the reconciliation's input). */
  entries() { return [...this._entries]; }

  /**
   * Runs the reconciliation against the retained log; with `backfill`, a
   * drop the log has and the count lacks is written now, classified from the
   * log entry and the CURRENT FDR, marked `backfilled: true`. Extra and
   * mismatched records are warned and kept — a record is never deleted
   * because the log lost something.
   */
  reconcile({ backfill = false } = {}) {
    const logEntries = this._log ? this._log.readAll() : [];
    // The NotPersisted markers are written at boot, before this instance
    // subscribes to the log, so the live branch never saw them. Replayed here;
    // _onLogEntry only voids a COUNT still live for that clientMutationId, so
    // a marker already applied is a no-op (docs/adr/0081).
    if (backfill) for (const e of logEntries) if (isNotPersistedDrop(e)) this._onLogEntry(e);
    let result = reconcileTrafficCount(logEntries, this._entries, {});
    let backfilled = 0;
    if (backfill && result.missing.length > 0) {
      const expected = expectedFromLog(logEntries);
      for (const m of result.missing) {
        const x = expected.get(m.countId);
        if (!x) continue;
        this._append(this._buildRecord(x.entry, { backfilled: true, sua: x.record.suaTraversal }));
        backfilled += 1;
      }
      console.warn(`[efsp-traffic-count] backfilled ${backfilled} count record(s) the Mutation log has and the count file lacked`);
      result = reconcileTrafficCount(logEntries, this._entries, {});
    }
    if (result.extra.length || result.mismatched.length) {
      console.warn(`[efsp-traffic-count] reconciliation: ${result.extra.length} extra, ${result.mismatched.length} mismatched — kept, not deleted`);
    }
    this._lastReconciliation = { ...result, checkedAt: this._clock.now(), backfilled };
    return this._lastReconciliation;
  }

  lastReconciliation() { return this._lastReconciliation; }

  /**
   * Does this Strip's drop have an unvoided record? The archiver's guard
   * (docs/adr/0082, T3): a DROPPED Strip is archived only once counted.
   */
  hasCountFor(stripId) { return this._liveByStrip.has(stripId); }

  /** Unvoided COUNT records. */
  records() {
    return [...this._records.values()].filter(r => !this._voided.has(r.countId));
  }

  /**
   * The traffic body of the WP8 contract (docs/adr/0065 §"Exposure").
   * @param {{facilityId?:string, from?:number, to?:number, detail?:boolean, missionSession?:number}} q
   *   from/to: mission-time epoch ms, `to` exclusive; default the last 24 h.
   */
  report({ facilityId = null, from = null, to = null, detail = false, missionSession = null } = {}) {
    const now = this._clock.now();
    const toMs = to === null ? now + 1 : to;
    const fromMs = from === null ? toMs - DAY_MS : from;
    const records = this.records().filter(r =>
      r.droppedAt >= fromMs && r.droppedAt < toMs
      && (!facilityId || r.facilityId === facilityId)
      && (missionSession === null || r.missionSession === missionSession));

    const facilityIds = facilityId ? [facilityId] : [...new Set([...this._facilityIds, ...records.map(r => r.facilityId)])];
    const facilities = {};
    for (const f of facilityIds) {
      const mine = records.filter(r => r.facilityId === f);
      const totals = emptyTotals();
      const byHour = new Map();
      const byAircraftType = {};
      const byRole = {};
      for (const r of mine) {
        addToTotals(totals, r);
        if (!byHour.has(r.hourUtc)) byHour.set(r.hourUtc, { hourUtc: r.hourUtc, ...emptyTotals(), byAircraftType: {} });
        const h = byHour.get(r.hourUtc);
        addToTotals(h, r);
        if (!r.counted) continue;
        const size = r.flightSize || 1;
        if (!h.byAircraftType[r.aircraftType]) h.byAircraftType[r.aircraftType] = { flights: 0, aircraft: 0 };
        h.byAircraftType[r.aircraftType].flights += 1;
        h.byAircraftType[r.aircraftType].aircraft += size;
        if (!byAircraftType[r.aircraftType]) byAircraftType[r.aircraftType] = emptyTypeTotals();
        const t = byAircraftType[r.aircraftType];
        t.flights += 1; t.aircraft += size;
        if (r.locality === 'LOCAL') t.local += 1; else if (r.locality === 'TRANSIENT') t.transient += 1; else t.unknown += 1;
        if (r.formation) t.formation += 1;
        if (r.suaTraversal && r.suaTraversal.length) t.suaTraversal += 1;
        if (r.alertScramble) t.alertScramble += 1;
        byRole[r.role] = (byRole[r.role] || 0) + 1;
      }
      facilities[f] = {
        homeAirports: [...(this._homeAirports[f] || [])],
        totals,
        byHour: [...byHour.values()].sort((a, b) => (a.hourUtc < b.hourUtc ? -1 : 1)),
        byAircraftType,
        byRole,
      };
    }

    const rec = this._lastReconciliation;
    const body = {
      ok: true, version: 1, generatedAt: now, from: fromMs, to: toMs, unit: 'FLIGHT', policy: POLICY,
      missionSession,
      facilities,
      reconciliation: rec ? {
        checkedAt: rec.checkedAt, ok: rec.ok, window: rec.window, expected: rec.expected, actual: rec.actual,
        missing: rec.missing.length, extra: rec.extra.length, mismatched: rec.mismatched.length, backfilled: rec.backfilled,
      } : null,
    };
    // Per-person breakdowns are hidden from the dashboard (decisions.md H35):
    // the file keeps actorId for audit, the wire does not.
    if (detail) body.records = records.map(({ actorId, ...r }) => r);
    return body;
  }
}

module.exports = {
  TrafficCount,
  TRAFFIC_COUNT_PATH,
  COUNTABLE_PRE_DROP_STATES,
  hourKey,
  isDropTransition,
  isUndoOfDrop,
  isNotPersistedDrop,
  countability,
  classifyLocality,
  normalizeAircraftType,
  countIdFor,
  logDerivedRecord,
  expectedFromLog,
  liveCountRecords,
  reconcileTrafficCount,
  emptyTotals,
};
