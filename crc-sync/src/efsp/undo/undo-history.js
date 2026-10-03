'use strict';

// One undo history for every one-click Strip move (docs/adr/0100, decisions.md H95, H100).
//
// THE CONTRACT every op module follows (board/ops/*.js): each module declares `undo`, either
//
//   undo: 'none'
//
// or an undo declaration
//
//   undo: {
//     label(op, strip, ctx) -> string                  what the client's undo slot says ("Hand off VIPER1 -> APP")
//     scope(ctx, strip, op) -> Scope | null            everything the op may write, read BEFORE it applies; null means
//                                                      THIS action is not undoable (a module whose op kind has several
//                                                      actions, e.g. HANDOFF's TRANSFER_* marks vs its other actions,
//                                                      TOFI PROPOSE vs ACCEPT, decides per action)
//     created?(result, ctx) -> { strips?: [{facilityId, stripId}], flightData?: [id] }   what it made, read after
//   }
//
//   Scope = {
//     strips:      [{ facilityId, stripId }],   Strips on this Board or another (a peer Board's Strip by its Facility)
//     flightData:  [flightDataId],              flight data records it may write (path by path, OBSERVED_PATHS never)
//     codes?:      [code],                      beacon codes it may release (re-acquired on undo, D23: never stolen)
//     carrier?:    [{ flightDataId }],          Marshal stack entries it may mark pushed or remove
//     marsa?:      [relationId | { flightDataId }],  MARSA relations it may end (by id, or every relation of a flight)
//   }
//
// A module without the key fails the op-table test (tests/undo-history.test.mjs, U17), so every new op decides.
// An action that changed nothing (an empty footprint, e.g. the NLA's 400 ms double-tap guard) is never undoable.
//
// HOW CHANGES ARE SEEN. Every Mutation on every Board runs inside one frame: `begin(actionId, meta, scope)` before
// the op applies (scope null: the op is not undoable, but its changes are still observed), `commit(result)` after it,
// `abort()` when it threw. Every Board touch and every flight-data write calls `observe(change)`:
//
//   change = { facilityId, kind: 'strip' | 'flightData', id, unobserved?, paths?, system? }
//
// inside a frame it joins that frame's footprint; outside one it is a system change (a sign-off's reassignment, a
// tick's write) and blocks every open record whose scope it touches. A peer write (`receive*`) happens inside the
// SENDER's frame and carries the touched Board's facilityId, so the record of an action at one Facility sees another
// Facility's answer as "from another Facility" (H100 Q-U3 a). Placement-only touches (a rebalance re-keying the
// neighbours) never count (ADR 0100 §4).
//
// At commit: an undoable frame whose footprint is inside `scope + created` becomes a record (10 s, wall clock); one
// whose footprint escaped is logged at warn and is NOT undoable (never half-restored). Every other open record whose
// scope the frame touched either lists the frame as voided (same Facility, footprint inside that scope) or is blocked
// by it (another Facility, a system change, or a footprint reaching outside the scope).
//
// `undo(actionId, actingPositionId, wallNow)` returns the Plan (before-images, created ids, voided Mutations) or a
// refusal; the Undo op (board/ops/undo.js) validates and applies the Plan, then calls `complete(plan)`, which drops
// every record the restore overlapped. Nothing here is persisted or on the wire (ADR 0100 §2).

const log = require('../../log').logger('efsp:undo');

/** The undo window (H95: 10 s, was 30 s). A ruling, not tuning: a named constant, mirrored by the client. */
const UNDO_WINDOW_MS = 10_000;

const SCOPE_KEYS = ['strips', 'flightData', 'codes', 'carrier', 'marsa'];

function stripKey(facilityId, stripId) { return `strip:${facilityId}/${stripId}`; }
function flightDataKey(id) { return `flightData:${id}`; }
function changeKey(change) {
  return change.kind === 'strip' ? stripKey(change.facilityId, change.id) : flightDataKey(change.id);
}

/**
 * Checks one op module's `undo` declaration (the op-table test and StripOps' construction use it).
 * @returns {string|null} what is wrong, or null
 */
function undoDeclarationProblem(entry) {
  if (!entry || !Object.prototype.hasOwnProperty.call(entry, 'undo')) return `${entry && entry.kind} declares no undo`;
  const u = entry.undo;
  if (u === 'none') return null;
  if (!u || typeof u !== 'object') return `${entry.kind}: undo must be 'none' or a declaration`;
  if (typeof u.label !== 'function') return `${entry.kind}: undo.label must be a function`;
  if (typeof u.scope !== 'function') return `${entry.kind}: undo.scope must be a function`;
  if (u.created !== undefined && typeof u.created !== 'function') return `${entry.kind}: undo.created must be a function`;
  return null;
}

/** A Scope with every key present and each list de-duplicated. */
function normalizeScope(scope) {
  const out = {};
  for (const k of SCOPE_KEYS) out[k] = [];
  if (!scope) return out;
  const seen = new Set();
  for (const k of SCOPE_KEYS) {
    for (const v of scope[k] || []) {
      if (v == null) continue;
      const key = `${k}:${typeof v === 'object' ? JSON.stringify(v) : v}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out[k].push(v);
    }
  }
  return out;
}

/** The observable keys of a Scope (Strips and flight data; the side stores are checked at restore). */
function scopeKeys(scope, created) {
  const keys = new Set();
  for (const s of scope.strips) keys.add(stripKey(s.facilityId, s.stripId));
  for (const id of scope.flightData) keys.add(flightDataKey(id));
  if (created) {
    for (const s of created.strips || []) keys.add(stripKey(s.facilityId, s.stripId));
    for (const id of created.flightData || []) keys.add(flightDataKey(id));
  }
  return keys;
}

class UndoHistory {
  /**
   * @param {object} deps
   * @param {{now: () => number}} deps.wallClock the injected wall clock (a pure duration, docs/adr/0096)
   * @param {object} [deps.capture] how a Scope's before-images are taken (see `attach`)
   * @param {number} [deps.windowMs] UNDO_WINDOW_MS unless a test says otherwise
   */
  constructor({ wallClock, capture = null, windowMs = UNDO_WINDOW_MS } = {}) {
    if (!wallClock || typeof wallClock.now !== 'function') throw new Error('UndoHistory needs an injected wall clock');
    this._wall = wallClock;
    this._windowMs = windowMs;
    this._capture = capture;
    this._frames = [];            // open frames, innermost last
    this._records = new Map();    // actionId -> record, oldest first
  }

  get windowMs() { return this._windowMs; }

  /**
   * How before-images are taken, attached once the stores exist (createEfsp):
   *   strip(facilityId, stripId) -> { strip, placement: {bayId, rackId, afterStripId} } | null
   *   flightData(id)             -> a deep copy | null
   *   code(code)                 -> { code, holder } (the allocator's holder now)
   *   carrier(flightDataId)      -> the stack entry's image (index, pushed...) | null
   *   marsa(ref)                 -> [relation image] (a ref is a relationId or {flightDataId})
   */
  attach(capture) { this._capture = capture; }

  /**
   * The attached environment: the capture functions above plus what the Undo op restores through
   * (`boardFor(facilityId)`, `flightDataStore`, `carrierStore`, `marsaStore`).
   */
  get env() { return this._capture; }

  // ── frames ───────────────────────────────────────────────────────────────

  /**
   * Opens the frame of one Mutation.
   * @param {string|null} actionId the Mutation's clientMutationId (an unkeyed Mutation is never undoable)
   * @param {{facilityId:string, actingPositionId?:string, actorId?:string, op:string, label?:string,
   *          stripId?:string, at?:number, undo?:boolean}} meta  `undo: true` marks the Undo's own frame
   * @param {object|null} scope the op's declared Scope, or null when the op is not undoable
   */
  begin(actionId, meta, scope) {
    const frame = {
      actionId: actionId || null,
      meta: { ...meta },
      scope: null,
      images: null,
      footprint: new Set(),
      paths: new Map(),           // flightDataId -> Set(path) written in this frame
      isUndo: !!(meta && meta.undo),
    };
    if (scope && frame.actionId) {
      frame.scope = normalizeScope(scope);
      frame.images = this._captureScope(frame.scope);
    }
    this._frames.push(frame);
    return frame;
  }

  /** The innermost open frame, or null. */
  get currentFrame() { return this._frames.length ? this._frames[this._frames.length - 1] : null; }

  /**
   * One change to a record. Inside a frame it joins the footprint; outside, it is a system change.
   */
  observe(change) {
    if (!change || change.unobserved) return;
    const frame = this.currentFrame;
    if (frame && !change.system) {
      const key = changeKey(change);
      frame.footprint.add(key);
      if (change.kind === 'flightData' && Array.isArray(change.paths)) {
        const set = frame.paths.get(change.id) || new Set();
        for (const p of change.paths) set.add(p);
        frame.paths.set(change.id, set);
      }
      return;
    }
    // A system change: it blocks every record whose scope holds the record it changed.
    const key = changeKey(change);
    for (const record of this._records.values()) {
      if (record.blockedBy || !record.keys.has(key)) continue;
      record.blockedBy = { kind: 'SYSTEM', op: change.op || 'system', facilityId: change.facilityId || null, id: change.id };
    }
  }

  /**
   * Closes the innermost frame.
   * @param {object} result the op's result (`ok`)
   * @param {{created?:object}} [extra] what the op created (its module's `undo.created(result)`)
   * @returns {{actionId:string, label:string, windowMs:number}|null} the ack's `undoable`, or null
   */
  commit(result, { created } = {}) {
    const frame = this._frames.pop();
    if (!frame) return null;
    // A refusal is never recorded. Whatever it did change on the way (a FULL release that a refused control Block write
    // settled, docs/adr/0101) stands, and blocks the open records it touched like a system change: an undo must not
    // restore over it.
    if (!result || !result.ok) {
      if (frame.footprint.size) this._blockByRefused(frame);
      return null;
    }
    if (!frame.isUndo) this._attribute(frame);
    if (!frame.scope) return null;
    return this._record(frame, created || null);
  }

  _blockByRefused(frame) {
    for (const record of this._records.values()) {
      if (record.blockedBy || record.actionId === frame.actionId) continue;
      for (const k of frame.footprint) {
        if (!record.keys.has(k)) continue;
        record.blockedBy = { kind: 'SYSTEM', op: `${frame.meta.op} (refused)`, facilityId: frame.meta.facilityId || null, id: k };
        break;
      }
    }
  }

  /** Closes the innermost frame without recording anything (the op threw). */
  abort() { this._frames.pop(); }

  _attribute(frame) {
    if (frame.footprint.size === 0) return;
    for (const record of this._records.values()) {
      if (record.blockedBy || record.actionId === frame.actionId) continue;
      let overlaps = false;
      let escapes = false;
      for (const k of frame.footprint) {
        if (record.keys.has(k)) overlaps = true; else escapes = true;
      }
      if (!overlaps) continue;
      const who = {
        clientMutationId: frame.actionId, op: frame.meta.op, facilityId: frame.meta.facilityId || null,
        actingPositionId: frame.meta.actingPositionId || null, actorId: frame.meta.actorId || null,
        at: frame.meta.at == null ? null : frame.meta.at,
      };
      if (frame.meta.facilityId !== record.meta.facilityId) {
        record.blockedBy = { kind: 'OTHER_FACILITY', ...who };
      } else if (escapes) {
        record.blockedBy = { kind: 'OUTSIDE_SCOPE', ...who };
      } else {
        record.voided.push(who);
        for (const [id, set] of frame.paths) {
          const mine = record.paths.get(id) || new Set();
          for (const p of set) mine.add(p);
          record.paths.set(id, mine);
        }
      }
    }
  }

  _record(frame, created) {
    if (frame.footprint.size === 0) return null; // it changed nothing: nothing to undo, and no record to overlap others
    const keys = scopeKeys(frame.scope, created);
    const escaped = [...frame.footprint].filter(k => !keys.has(k));
    if (escaped.length) {
      log.warn('an action touched records outside its declared undo scope; it is not undoable', {
        actionId: frame.actionId, op: frame.meta.op, escaped,
      });
      return null;
    }
    const wallAt = this._wall.now();
    const record = {
      actionId: frame.actionId,
      meta: frame.meta,
      scope: frame.scope,
      images: frame.images,
      created: { strips: (created && created.strips) || [], flightData: (created && created.flightData) || [] },
      keys,
      paths: new Map([...frame.paths].map(([id, set]) => [id, new Set(set)])),
      wallAt,
      expiresAt: wallAt + this._windowMs,
      voided: [],
      blockedBy: null,
    };
    this._records.set(record.actionId, record);
    return { actionId: record.actionId, label: frame.meta.label || frame.meta.op, windowMs: this._windowMs };
  }

  _captureScope(scope) {
    const c = this._capture;
    if (!c) return { strips: [], flightData: [], codes: [], carrier: [], marsa: [] };
    return {
      strips: scope.strips.map(s => ({ facilityId: s.facilityId, stripId: s.stripId, ...(c.strip(s.facilityId, s.stripId) || { strip: null }) })),
      flightData: scope.flightData.map(id => ({ id, image: c.flightData(id) })),
      codes: scope.codes.map(code => (c.code ? c.code(code) : { code, holder: null })),
      carrier: scope.carrier.map(e => ({ flightDataId: e.flightDataId, image: c.carrier ? c.carrier(e.flightDataId) : null })),
      marsa: scope.marsa.flatMap(ref => (c.marsa ? c.marsa(ref) : [])),
    };
  }

  // ── undo ─────────────────────────────────────────────────────────────────

  /** Forgets every record whose window has closed (`wallNow >= expiresAt`). */
  expire(wallNow = this._wall.now()) {
    for (const [id, r] of this._records) if (wallNow >= r.expiresAt) this._records.delete(id);
  }

  /**
   * The newest open action whose scope holds this Strip, optionally by one Position, or null. For tools (the soak
   * driver) and tests that hold a Strip rather than an ack; a client always has the ack's `undoable`.
   */
  latestActionFor({ facilityId, stripId }, actingPositionId = null) {
    const key = stripKey(facilityId, stripId);
    let found = null;
    for (const r of this._records.values()) {
      if (r.keys.has(key) && (!actingPositionId || r.meta.actingPositionId === actingPositionId)) found = r.actionId;
    }
    return found;
  }

  /** The open record of an action, or null (tests, the wire's routing). */
  recordOf(actionId) { return this._records.get(actionId) || null; }

  /**
   * The Plan for undoing `actionId`, or a refusal. Nothing is changed here: the Undo op validates the Plan against
   * the Boards (existence, staffing, Bay capacity, the control invariant) and applies it, then calls `complete`.
   * @returns {{ok:true, plan:object}|{ok:false, reason:string, detail:string}}
   */
  undo(actionId, actingPositionId, wallNow = this._wall.now()) {
    this.expire(wallNow);
    const record = typeof actionId === 'string' ? this._records.get(actionId) : null;
    if (!record) return { ok: false, reason: 'UNDO_UNAVAILABLE', detail: 'nothing to undo: the action is unknown, already undone, or its 10 s window has closed' };
    if (record.meta.actingPositionId !== actingPositionId) {
      return { ok: false, reason: 'PERMISSION_DENIED', detail: `only ${record.meta.actingPositionId} may undo its own action` };
    }
    if (record.blockedBy) {
      return { ok: false, reason: 'UNDO_BLOCKED', detail: blockedDetail(record.blockedBy), blockedBy: record.blockedBy };
    }
    return {
      ok: true,
      plan: {
        actionId: record.actionId,
        meta: record.meta,
        scope: record.scope,
        images: record.images,
        created: record.created,
        paths: record.paths,
        voided: record.voided.slice(),
      },
    };
  }

  /**
   * After a successful restore: drops the undone record and every record whose scope overlaps it, or whose action
   * it voided (H95: B's undo of a voided action is no longer offered).
   */
  complete(plan) {
    const undone = this._records.get(plan.actionId);
    if (!undone) return;
    const voidedIds = new Set(plan.voided.map(v => v.clientMutationId).filter(Boolean));
    for (const [id, r] of this._records) {
      if (id === plan.actionId || voidedIds.has(id) || [...r.keys].some(k => undone.keys.has(k))) this._records.delete(id);
    }
  }

  /** Every record, for tests. */
  get size() { return this._records.size; }
}

/**
 * The environment an UndoHistory is attached to (createEfsp, or a Board built alone): how a Scope's before-images are
 * taken and the stores the Undo op restores through. `carrierStore`/`marsaStore` may be absent (a Board built alone).
 */
function undoEnv({ boardFor, flightDataStore, carrierStore = null, marsaStore = null }) {
  return {
    boardFor, flightDataStore, carrierStore, marsaStore,
    strip: (facilityId, stripId) => { const b = boardFor(facilityId); return b ? b.captureForUndo(stripId) : null; },
    flightData: (id) => { const f = flightDataStore.getFlightData(id); return f ? JSON.parse(JSON.stringify(f)) : null; },
    code: (code) => ({ code, holder: flightDataStore.codeAllocator.holderOf(code) }),
    carrier: (flightDataId) => (carrierStore ? carrierStore.entryImage(flightDataId) : null),
    marsa: (ref) => (marsaStore ? marsaStore.relationImages(ref) : []),
  };
}

function blockedDetail(b) {
  if (b.kind === 'SYSTEM') return `a system change (${b.op}) has changed ${b.id} since; undo it by hand`;
  const who = `${b.op}${b.actingPositionId ? ` by ${b.actingPositionId}` : ''}${b.facilityId ? ` at ${b.facilityId}` : ''}`;
  if (b.kind === 'OTHER_FACILITY') return `another Facility has answered or changed it since (${who}); undo it through the coordination`;
  return `a later change reached beyond this action (${who}); undo that first`;
}

module.exports = { UndoHistory, UNDO_WINDOW_MS, undoEnv, undoDeclarationProblem, normalizeScope, stripKey, flightDataKey };
