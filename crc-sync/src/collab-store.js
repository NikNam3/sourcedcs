'use strict';

// What controllers have said about contacts, shared by all of them: IFF
// declarations and tags (a name for a contact nothing else identifies —
// docs/adr/0059). Persisted to state/collab-overlay.json and tied to a DCS
// mission session (docs/adr/0094): a crc-sync restart onto the same running
// mission restores it, a DCS restart or mission reload (new unit ids) discards
// it, and a gRPC reconnect while DCS keeps running keeps it.
//
// Track numbers are not here any more: every contact gets one from
// surveillance/track-numbers.js whether or not anybody has touched it.
//
// Nothing needs a change log: ws-hub.js re-describes every contact each tick
// and sees a change by comparing (surveillance/presentation.js).

const fs = require('fs');
const { statePaths, ensureDirFor } = require('./state-paths');
const { IFF_STATES } = require('./surveillance/iff');

const FILE_NAME = 'collab-overlay.json';
const VERSION = 1;
// How long an entry whose unit is not currently streamed waits for it to come
// back (a gRPC outage, or the first seconds after a crc-sync restart) before it
// is dropped for good. A despawned unit's id is never reused within one DCS
// mission, so waiting costs nothing but memory.
const PARK_MS = 10 * 60 * 1000;
// After a crc-sync restart, how long to wait for the first mission-clock sample
// (the only thing that can reveal a restarted .miz, mission-session.js) before
// trusting the persisted session without it (DCS gone, wall-clock fallback).
const CLOCK_GRACE_MS = 15 * 1000;

/** What makes a unit the same unit: its DCS name and type, else its callsign. */
function identityOfTrack(t) {
  if (!t) return null;
  return {
    name: t.name || null,
    type: t.type || null,
    callsign: t.callsign || null,
    coalition: t.coalition === undefined ? null : t.coalition,
  };
}

function sameUnit(a, b) {
  if (!a || !b) return false;
  if ((a.type || null) !== (b.type || null)) return false;
  if (a.coalition != null && b.coalition != null && a.coalition !== b.coalition) return false;
  if (a.name && b.name) return a.name === b.name;
  return !!a.callsign && a.callsign === b.callsign;
}

class CollaborativeStore {
  /**
   * @param {object} [deps]
   * @param {boolean} [deps.persist] true: keep state/collab-overlay.json (server.js).
   *   Default false, so a bare store in a test never writes state/.
   * @param {string} [deps.path] override of that file (CRCSYNC_COLLAB_PATH)
   * @param {(id:string)=>object|null} [deps.identityOf] the track as streamed now
   * @param {() => number} [deps.sessionSeq] the mission session number (bindSession)
   * @param {() => number} [deps.wallNow]
   * @param {number} [deps.clockGraceMs]
   */
  constructor({ persist = false, path: filePath, identityOf = () => null, sessionSeq = () => 0, wallNow = () => Date.now(), clockGraceMs = CLOCK_GRACE_MS } = {}) {
    this._paths = persist ? statePaths(FILE_NAME, filePath || process.env.CRCSYNC_COLLAB_PATH) : null;
    this._identityOf = identityOf;
    this._sessionSeq = sessionSeq;
    this._wallNow = wallNow;
    this._clockGraceMs = clockGraceMs;
    this._overlay = new Map(); // id (string) -> { id, iff, rename, identity } — live, shown to controllers
    this._parked = new Map();  // id -> entry + { parkedAt } — waiting for its unit to (re)appear
    this._gateOpen = true;     // false until a restored overlay is confirmed to belong to this mission
    this._persistedSeq = null;
    this._seen = { load: false, clock: false };
    this._graceTimer = null;
    this._load();
  }

  /** Server wiring: the session number is known only once MissionSession exists. */
  bindSession(fn) { this._sessionSeq = fn; }

  get(id) { return this._overlay.get(String(id)) || null; }

  _entry(id) {
    const key = String(id);
    let e = this._overlay.get(key);
    if (!e) {
      this._parked.delete(key); // a fresh word about this id supersedes a waiting one
      e = { id: key, iff: null, rename: null, identity: identityOfTrack(this._identityOf(key)) };
      this._overlay.set(key, e);
    }
    return e;
  }

  // Drops an entry entirely once it is empty, so evictStale does not carry
  // empty husks forever.
  _dropIfEmpty(id) {
    const key = String(id);
    const e = this._overlay.get(key);
    if (e && !e.iff && !e.rename) { this._overlay.delete(key); this._persist(); }
  }

  // ── IFF declaration ───────────────────────────────────────────────────────

  declare(id, state, by) {
    if (!IFF_STATES.includes(state)) return null;
    const e = this._entry(id);
    e.iff = { state, by: by || null, at: Date.now() };
    this._persist();
    return e;
  }

  clearDeclare(id) {
    const e = this._overlay.get(String(id));
    if (!e || !e.iff) return;
    e.iff = null;
    this._persist();
    this._dropIfEmpty(id);
  }

  // ── Tag ────────────────────────────────────────────────────────────────────

  rename(id, value, by) {
    const clean = String(value || '').trim().toUpperCase();
    if (!clean) return this.clearRename(id);
    const e = this._entry(id);
    e.rename = { value: clean, by: by || null, at: Date.now() };
    this._persist();
    return e;
  }

  clearRename(id) {
    const e = this._overlay.get(String(id));
    if (!e || !e.rename) return;
    e.rename = null;
    this._persist();
    this._dropIfEmpty(id);
  }

  // ── New mission session ────────────────────────────────────────────────────

  /** A new DCS mission session (mission-session.js onNewSession): everything goes. */
  clear() {
    this._overlay.clear();
    this._parked.clear();
    this._gateOpen = true;
    this._clearGrace();
    this._persist();
  }

  // ── Unit continuity ──────────────────────────────────────────────────────
  // Called for every streamed unit. A unit whose id is held — live or parked —
  // must still BE the unit declared about, or its id was re-minted and the
  // entry is dropped. A parked entry whose unit is back is revived.

  observeUnit(track) {
    const key = String(track.id);
    const live = this._overlay.get(key);
    const parked = live ? null : this._parked.get(key);
    if (!live && !parked) return;
    const now = identityOfTrack(track);
    if (live) {
      if (!live.identity) { live.identity = now; this._persist(); return; }
      if (!sameUnit(live.identity, now)) { this._overlay.delete(key); this._persist(); }
      return;
    }
    if (!sameUnit(parked.identity, now)) { this._parked.delete(key); this._persist(); return; }
    if (!this._gateOpen) return; // not yet known to belong to this mission
    this._parked.delete(key);
    delete parked.parkedAt;
    this._overlay.set(key, parked);
    this._persist();
  }

  /** DCS said the unit is gone (despawned or killed): its declaration goes with it. */
  release(id) {
    const key = String(id);
    const had = this._overlay.delete(key) | this._parked.delete(key);
    if (had) this._persist();
  }

  // ── Restart restore gate ─────────────────────────────────────────────────
  // After a crc-sync restart the restored entries wait, unshown, until the
  // mission session has had its say: the first mission-load (a different
  // mission) and the first mission-clock sample (the same .miz restarted).
  // If MissionSession rolled meanwhile, clear() already emptied them.

  noteMissionLoad() { this._seen.load = true; this._maybeOpen(); }

  noteClockSample() { this._seen.clock = true; this._maybeOpen(); }

  _maybeOpen() {
    if (this._gateOpen) return;
    if (!this._seen.load) return;
    if (this._seen.clock) return this._open();
    if (!this._graceTimer) {
      this._graceTimer = setTimeout(() => { this._graceTimer = null; this._open(); }, this._clockGraceMs);
      if (this._graceTimer.unref) this._graceTimer.unref();
    }
  }

  _open() {
    this._clearGrace();
    if (this._gateOpen) return;
    if (this._persistedSeq !== this._sessionSeq()) {
      this._parked.clear(); // belongs to another session
    } else {
      const t = this._wallNow();
      for (const e of this._parked.values()) e.parkedAt = t; // the grace starts now
    }
    this._gateOpen = true;
    // Units streamed while the gate was closed are not re-announced for seconds
    // (an unchanged unit is only re-sent by the keepalive): settle them now.
    for (const id of [...this._parked.keys()]) {
      const track = this._identityOf(id);
      if (track) this.observeUnit({ id, ...track });
    }
    this._persist();
  }

  _clearGrace() { if (this._graceTimer) { clearTimeout(this._graceTimer); this._graceTimer = null; } }

  close() { this._clearGrace(); }

  // ── Stale-track eviction ─────────────────────────────────────────────────
  // Called from the same tick as TrackStore's stale-reaper. A declared or
  // tagged track that is no longer streamed is PARKED, not forgotten: a gRPC
  // outage longer than the 12 s reaper must not cost the declarations, and
  // observeUnit() revives it only if the same unit comes back under that id.
  // Parked entries expire after PARK_MS.

  evictStale(activeTrackIds) {
    let count = 0;
    const t = this._wallNow();
    for (const [id, e] of [...this._overlay]) {
      if (!activeTrackIds.has(id)) {
        this._overlay.delete(id);
        this._parked.set(id, { ...e, parkedAt: t });
        count++;
      }
    }
    for (const [id, e] of [...this._parked]) {
      if (e.parkedAt != null && t - e.parkedAt > PARK_MS) { this._parked.delete(id); count++; }
    }
    if (count) this._persist();
    return count;
  }

  getAll() { return [...this._overlay.values()]; }

  // ── Persistence ──────────────────────────────────────────────────────────

  _load() {
    if (!this._paths) return;
    let raw;
    try { raw = fs.readFileSync(this._paths.read, 'utf8'); } catch { return; } // first run
    try {
      const d = JSON.parse(raw);
      if (!d || d.version !== VERSION || !Number.isSafeInteger(d.seq) || !Array.isArray(d.entries)) throw new Error('unrecognised shape');
      this._persistedSeq = d.seq;
      for (const e of d.entries) {
        if (!e || e.id == null || (!e.iff && !e.rename) || !e.identity) continue;
        if (e.iff && !IFF_STATES.includes(e.iff.state)) e.iff = null;
        if (!e.iff && !e.rename) continue;
        this._parked.set(String(e.id), { id: String(e.id), iff: e.iff || null, rename: e.rename || null, identity: e.identity, parkedAt: null });
      }
      if (this._parked.size) this._gateOpen = false;
    } catch (err) {
      const aside = `${this._paths.read}.corrupt-${this._wallNow()}`;
      try { fs.renameSync(this._paths.read, aside); } catch { /* nothing more to do */ }
      console.warn(`[collab-store] ${this._paths.read} was unreadable (${err.message}) — moved to ${aside}, starting empty`);
    }
  }

  _persist() {
    if (!this._paths) return;
    try {
      ensureDirFor(this._paths.write);
      // While the gate is closed the file still describes the OLD session; a
      // write then must not relabel it with the new one.
      const seq = this._gateOpen ? this._sessionSeq() : this._persistedSeq;
      const entries = [...this._overlay.values(), ...this._parked.values()]
        .map(({ id, iff, rename, identity }) => ({ id, iff, rename, identity }));
      const tmp = `${this._paths.write}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: VERSION, seq, entries }));
      fs.renameSync(tmp, this._paths.write);
      this._persistedSeq = seq;
    } catch (e) {
      console.warn('[collab-store] failed to persist:', e.message);
    }
  }
}

module.exports = CollaborativeStore;
module.exports.PARK_MS = PARK_MS;
module.exports.sameUnit = sameUnit;
