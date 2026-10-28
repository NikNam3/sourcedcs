'use strict';

// The one clock EFSP tells time by (docs/adr/0079): the DCS mission's own
// clock, in Zulu, as epoch milliseconds.
//
// The wall clock is the wrong answer for anything a controller reads as a time
// of day. A mission set at 0240Z and flown at 1900Z real time has every void
// deadline, release time, vul window and Strip clock five hours off if they
// are measured against Date.now() — and a controller cannot see that anything
// is wrong, because each number on its own looks plausible.
//
// DCS-gRPC's GetScenarioCurrentTime answers with an ISO 8601 string built from
// the mission date plus timer.getAbsTime(), i.e. the theater's LOCAL time of
// day, whatever suffix the string carries. Converting it to Zulu needs the
// theater's offset, which is fixed per theater (config/theaters.json through theaters.js), never a
// setting a controller edits.
//
// grpc-client.js polls every 5 s. Between polls this advances at real rate from
// the last sample; every poll simply resyncs, so time acceleration shows as a
// step forward.
//
// A PAUSE (docs/adr/0129) silences DCS-gRPC: the channel stays up and crc-sync
// stays connected, but no time answer comes back until the unpause. While the
// link is up and the last sample is older than holdAfterMs (two missed polls),
// the clock HOLDS at the sample plus holdAfterMs: a paused game clock does not
// move, and the held value never steps back from what was already read. The
// wall clock is the fallback only when DCS is really gone (the link down past
// staleMs) or there is no sample. A mission_start or a reconnect forgets the
// sample (`forget()`): it belonged to the mission before, and until the first
// new one the answer is WALL (a few seconds) rather than the old mission's time.
//
// `source` says which answer `now()` is giving:
//   MISSION            a fresh sample, converted with the theater's offset
//   MISSION_NO_OFFSET  a fresh sample on a theater the table does not list —
//                      mission time, but read as Zulu with offset 0, so it is
//                      right to the minute and may be hours out
//   MISSION_HELD       DCS connected but silent (paused): the last sample's
//                      time, not advancing (offset or not)
//   WALL               no usable sample (none yet, forgotten on a restart or
//                      reconnect, the last one too old with the link down —
//                      DCS gone — or the theater not known yet): the wall clock
// Callers never branch on it; it exists so a fallback is visible, on the
// topbar clock and in every Mutation-log record.

const log = require('./log').logger('mission-clock');

const DEFAULT_STALE_MS = 30000; // six missed polls — rides out a gRPC reconnect, not a lost server
// [OURS] (docs/adr/0129): two missed 5 s polls and some slack — with the link up, the game is paused.
const DEFAULT_HOLD_AFTER_MS = 12000;

// "2016-06-21T02:40:07Z", "...+00:00", "...T02:40:07.5" — only the calendar
// fields are read. The suffix is not trusted: the value is theater local time.
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/;

/** A DCS scenario datetime string to its LOCAL wall-face as epoch ms (read as if it were UTC), or null. */
function parseScenarioLocalMs(datetime) {
  const m = ISO_RE.exec(String(datetime || ''));
  if (!m) return null;
  const frac = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], frac);
  return Number.isFinite(ms) ? ms : null;
}

/** For stores built outside the composition root (unit-test fixtures) — the same answer MissionClock gives before its first sample. */
const WALL_CLOCK = Object.freeze({ now: () => Date.now(), source: 'WALL' });

class MissionClock {
  /**
   * @param {object} [deps]
   * @param {(theatre:string) => number|null} [deps.offsetHoursFor] local = Z + offset; null when the theater is not listed
   * @param {() => number} [deps.wallNow]   injectable for tests
   * @param {number} [deps.staleMs]         with the link down, a sample older than this no longer counts
   * @param {number} [deps.holdAfterMs]     with the link up, a sample older than this means paused: hold
   */
  constructor({ offsetHoursFor = () => null, wallNow = () => Date.now(), staleMs = DEFAULT_STALE_MS, holdAfterMs = DEFAULT_HOLD_AFTER_MS } = {}) {
    this._offsetHoursFor = offsetHoursFor;
    this._wallNow = wallNow;
    this._staleMs = staleMs;
    this._holdAfterMs = Math.min(holdAfterMs, staleMs);
    this._linkUp = false; // the DCS-gRPC client's state is 'connected' (setLink, from app/feed-handlers.js)
    this._theatre = null;
    this._offsetHours = 0;
    this._offsetKnown = false;
    this._sample = null; // { localMs, wallAt }
    this._warnedTheatre = null;
  }

  /** The theater the mission is on (grpc-client.js's GetTheatre, on mission load). */
  setTheatre(theatre) {
    this._theatre = theatre || null;
    const offset = theatre ? this._offsetHoursFor(theatre) : null;
    this._offsetKnown = Number.isFinite(offset);
    this._offsetHours = this._offsetKnown ? offset : 0;
    if (theatre && !this._offsetKnown && this._warnedTheatre !== theatre) {
      this._warnedTheatre = theatre;
      log.warn('no UTC offset known for theater — reading its mission time as Zulu (offset 0) until one is added to config/theaters.json', { theater: theatre });
    }
  }

  /** One GetScenarioCurrentTime answer. Returns false when the string is unreadable (the previous sample stands). */
  sample(datetime) {
    const localMs = parseScenarioLocalMs(datetime);
    if (localMs === null) return false;
    this._sample = { localMs, wallAt: this._wallNow() };
    return true;
  }

  /**
   * The DCS-gRPC client's link state (grpc-client.js 'link': 'connected', 'reconnecting', 'disconnected'). Coming up
   * again forgets the sample: whatever DCS did while the link was down (a restart, a different mission), the old
   * sample no longer says what time it is there.
   */
  setLink(state) {
    const up = state === 'connected';
    if (up && !this._linkUp) this.forget();
    this._linkUp = up;
  }

  /** Drops the sample (a mission_start, a reconnect): WALL until the next one. */
  forget() {
    this._sample = null;
  }

  /** 'MISSION', 'MISSION_NO_OFFSET', 'MISSION_HELD' or 'WALL' — see the module comment. */
  get source() {
    if (!this._sample || !this._theatre) return 'WALL';
    const age = this._wallNow() - this._sample.wallAt;
    if (this._linkUp) {
      if (age > this._holdAfterMs) return 'MISSION_HELD';
    } else if (age > this._staleMs) {
      return 'WALL';
    }
    return this._offsetKnown ? 'MISSION' : 'MISSION_NO_OFFSET';
  }

  /** In-game Zulu, epoch ms. */
  now() {
    const wall = this._wallNow();
    const source = this.source;
    if (source === 'WALL') return wall;
    const age = wall - this._sample.wallAt;
    return this._sample.localMs - this._offsetHours * 3600000 + (source === 'MISSION_HELD' ? this._holdAfterMs : age);
  }
}

module.exports = { MissionClock, WALL_CLOCK, parseScenarioLocalMs, DEFAULT_STALE_MS, DEFAULT_HOLD_AFTER_MS };
