'use strict';

// Which DCS mission are we in? (docs/adr/0086, decisions.md S-R2-2)
//
// Three decisions hang on "a new mission": the active runway is derived from
// the mission wind once per mission (H22), a metrics session is one mission to
// the next (H32), and finished flights are archived at mission change (H36).
// This module is the one answer all three read.
//
// DCS-gRPC gives no mission id, and grpc-client.js emits 'mission-load' on
// EVERY (re)connect, so neither "a mission-load happened" nor "the mission
// content is the same" is enough on its own. A new session starts when:
//
//   MISSION_START    DCS said so (grpc-client.js 'mission-start'). The same
//                    .miz restarted for tomorrow's sortie has the same
//                    fingerprint, and this is how it is told apart. The roll
//                    happens at the mission-load that follows, so the new
//                    session carries that load's fingerprint and theater.
//   MISSION_CHANGED  a mission-load whose fingerprint differs from the
//                    persisted one: a different mission, loaded while
//                    crc-sync was away or disconnected.
//   CLOCK_STEP_BACK  the mission clock stepped back by more than 5 min: the
//                    same .miz reloaded while crc-sync did not see the
//                    mission_start. A paused mission steps back by at most
//                    one 5 s poll, far inside the margin.
//
// A plain gRPC reconnect, or a crc-sync restart onto the same running mission,
// keeps the session: same fingerprint, and the clock carried on.
//
// Persisted under state/ (docs/adr/0048), so a restart knows what it was in.

const fs = require('fs');
const { statePaths, ensureDirFor } = require('./state-paths');
const { WALL_CLOCK } = require('./mission-clock');

const FILE_NAME = 'mission-session.json';
const VERSION = 1;
const CLOCK_STEP_BACK_MS = 5 * 60 * 1000;
// lastAt only ever moves forward within a session, and a stale persisted value
// only makes the step-back test more lenient, so it need not be written on
// every 5 s poll.
const LAST_AT_PERSIST_MS = 60 * 1000;
// A clock step seen on a reconnect just BEFORE the mission-load that names a
// different mission is the same event, not two: the load adopts the
// fingerprint into the session the step opened instead of opening another.
const CLOCK_ROLL_ADOPT_MS = 2 * 60 * 1000;

const REASONS = Object.freeze(['FIRST', 'MISSION_START', 'MISSION_CHANGED', 'CLOCK_STEP_BACK']);

/**
 * A fingerprint of the loaded mission (hoisted from L1's missionKeyOf): FNV-1a
 * over the theater and the waypoint and drawing names. Same mission content,
 * same fingerprint — which is exactly why it cannot tell a restarted .miz from
 * the one still running, and why mission_start and the clock rule exist.
 */
function missionFingerprint(missionData) {
  if (!missionData) return null;
  const names = (list) => (list || []).map(x => (x && (x.name || x.id)) || '').join('|');
  const text = `${missionData.theatre || ''}#${names(missionData.waypoints)}#${names(missionData.drawings)}`;
  // FNV-1a, 32 bit — small, dependency-free, and only ever compared for equality.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${missionData.theatre || '?'}:${h.toString(16)}`;
}

class MissionSession {
  /**
   * @param {object} [deps]
   * @param {string|null} [deps.path] the state file; null keeps it in memory only
   *   (unit tests, and stores composed without a server). Default:
   *   state/mission-session.json, or CRCSYNC_MISSION_SESSION_PATH.
   * @param {{now:()=>number, source?:string}} [deps.clock] the mission clock (H11)
   * @param {() => number} [deps.wallNow] only for the reconnect adopt window
   */
  constructor({ path: filePath, clock = WALL_CLOCK, wallNow = () => Date.now() } = {}) {
    this._paths = filePath === null ? null : statePaths(FILE_NAME, filePath || process.env.CRCSYNC_MISSION_SESSION_PATH);
    this._clock = clock;
    this._wallNow = wallNow;
    this._listeners = new Set();
    this._pendingStart = false;
    this._persistedLastAt = null;
    this._state = this._load() || this._fresh(1, 'FIRST', null, null);
    if (!this._loaded) this._persist();
  }

  // ── reading ──

  /** The current session: { seq, fingerprint, theatre, reason, startedAt, startedWallAt }. */
  current() {
    const s = this._state;
    return { seq: s.seq, fingerprint: s.fingerprint, theatre: s.theatre, reason: s.reason, startedAt: s.startedAt, startedWallAt: s.startedWallAt };
  }

  currentSeq() { return this._state.seq; }

  /**
   * `fn(session, previous)` after every new session (H36's archiver, H22's
   * re-derivation on a clock step). Not called for the first session or when a
   * load only names the session it is already in. Returns an unsubscribe.
   */
  onNewSession(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  // ── inputs (server.js wires these to grpc-client.js) ──

  /** DCS mission_start: the next mission-load is a new mission, whatever it contains. */
  noteMissionStart() {
    this._pendingStart = true;
  }

  /** Every mission-load (every gRPC connect, and after each mission_start). Returns current(). */
  noteMissionLoad(missionData) {
    const fingerprint = missionFingerprint(missionData);
    const theatre = (missionData && missionData.theatre) || null;
    const s = this._state;
    if (this._pendingStart) {
      this._pendingStart = false;
      this._roll('MISSION_START', fingerprint, theatre);
    } else if (fingerprint === null || fingerprint === s.fingerprint) {
      // A reconnect or a restart onto the same mission.
    } else if (s.fingerprint === null
      || (s.reason === 'CLOCK_STEP_BACK' && this._wallNow() - s.startedWallAt <= CLOCK_ROLL_ADOPT_MS)) {
      // The session before any load (first boot) — or one a clock step opened
      // a moment ago on this same reconnect — takes the load's identity.
      Object.assign(s, { fingerprint, theatre, lastAt: null });
      this._persist();
    } else {
      this._roll('MISSION_CHANGED', fingerprint, theatre);
    }
    return this.current();
  }

  /**
   * Called after each mission-clock sample (grpc-client.js 'game-time'). Opens
   * a new session when the clock stepped back by more than 5 min. Ignored on the
   * wall-clock fallback, and between a mission_start and its load (the clock
   * may still carry the previous theater's offset). Returns true on a roll.
   */
  observeClock() {
    if (this._pendingStart) return false;
    if ((this._clock.source || 'WALL') === 'WALL') return false;
    const now = this._clock.now();
    if (!Number.isFinite(now)) return false;
    const s = this._state;
    if (s.lastAt !== null && now < s.lastAt - CLOCK_STEP_BACK_MS) {
      this._roll('CLOCK_STEP_BACK', s.fingerprint, s.theatre, now);
      return true;
    }
    if (s.lastAt === null || now > s.lastAt) {
      s.lastAt = now;
      if (this._persistedLastAt === null || now - this._persistedLastAt >= LAST_AT_PERSIST_MS) this._persist();
    }
    return false;
  }

  // ── internals ──

  _fresh(seq, reason, fingerprint, theatre, lastAt = null) {
    const source = this._clock.source || 'WALL';
    return {
      seq, reason, fingerprint, theatre,
      startedAt: source === 'WALL' ? null : this._clock.now(),
      startedWallAt: this._wallNow(),
      // The highest mission-clock reading seen in this session. Reset on a
      // load-driven roll: the clock may still carry the previous theater's
      // offset until server.js has set the new one.
      lastAt,
    };
  }

  _roll(reason, fingerprint, theatre, lastAt = null) {
    const previous = this.current();
    this._state = this._fresh(previous.seq + 1, reason, fingerprint, theatre, lastAt);
    this._persist();
    console.log(`[mission-session] session ${this._state.seq} (${reason}) — ${theatre || 'unknown theater'}, mission ${fingerprint || 'unknown'}`);
    const session = this.current();
    for (const fn of this._listeners) {
      try { fn(session, previous); } catch (e) { console.warn('[mission-session] onNewSession listener failed:', e.message); }
    }
  }

  _load() {
    this._loaded = false;
    if (!this._paths) return null;
    let raw;
    try {
      raw = fs.readFileSync(this._paths.read, 'utf8');
    } catch {
      return null; // first run
    }
    try {
      const d = JSON.parse(raw);
      if (!d || !Number.isSafeInteger(d.seq) || d.seq < 1) throw new Error('no session number');
      this._loaded = true;
      const num = (v) => (Number.isFinite(v) ? v : null);
      const state = {
        seq: d.seq,
        reason: REASONS.includes(d.reason) ? d.reason : 'FIRST',
        fingerprint: typeof d.fingerprint === 'string' ? d.fingerprint : null,
        theatre: typeof d.theatre === 'string' ? d.theatre : null,
        startedAt: num(d.startedAt),
        startedWallAt: num(d.startedWallAt),
        lastAt: num(d.lastAt),
      };
      this._persistedLastAt = state.lastAt;
      return state;
    } catch (e) {
      // Kept for inspection rather than overwritten.
      const aside = `${this._paths.read}.corrupt-${this._wallNow()}`;
      try { fs.renameSync(this._paths.read, aside); } catch { /* nothing more to do */ }
      console.warn(`[mission-session] ${this._paths.read} was unreadable (${e.message}) — moved to ${aside}, starting a new session`);
      return null;
    }
  }

  _persist() {
    if (!this._paths) { this._persistedLastAt = this._state.lastAt; return; }
    try {
      ensureDirFor(this._paths.write);
      const tmp = `${this._paths.write}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: VERSION, ...this._state }));
      fs.renameSync(tmp, this._paths.write);
      this._persistedLastAt = this._state.lastAt;
    } catch (e) {
      console.warn('[mission-session] failed to persist:', e.message);
    }
  }
}

module.exports = { MissionSession, missionFingerprint, CLOCK_STEP_BACK_MS };
