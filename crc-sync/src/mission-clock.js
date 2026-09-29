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
// theater's offset, which is fixed per theater (theater-offsets.js), never a
// setting a controller edits.
//
// grpc-client.js polls every 5 s. Between polls this advances at real rate from
// the last sample; every poll simply resyncs. That covers a paused mission and
// time acceleration without modelling either: a pause shows as time running
// on for up to one poll and then stepping back, acceleration as a step forward.
//
// `source` says which answer `now()` is giving:
//   MISSION            a fresh sample, converted with the theater's offset
//   MISSION_NO_OFFSET  a fresh sample on a theater the table does not list —
//                      mission time, but read as Zulu with offset 0, so it is
//                      right to the minute and may be hours out
//   WALL               no usable sample (none yet, the last one too old — DCS
//                      gone — or the theater not known yet): the wall clock
// Callers never branch on it; it exists so a fallback is visible, on the
// topbar clock and in every Mutation-log record.

const DEFAULT_STALE_MS = 30000; // six missed polls — rides out a gRPC reconnect, not a lost server

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
   * @param {number} [deps.staleMs]         a sample older than this no longer counts
   */
  constructor({ offsetHoursFor = () => null, wallNow = () => Date.now(), staleMs = DEFAULT_STALE_MS } = {}) {
    this._offsetHoursFor = offsetHoursFor;
    this._wallNow = wallNow;
    this._staleMs = staleMs;
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
      console.warn(`[mission-clock] no UTC offset known for theater "${theatre}" — reading its mission time as Zulu (offset 0) until one is added to config/theaters.json`);
    }
  }

  /** One GetScenarioCurrentTime answer. Returns false when the string is unreadable (the previous sample stands). */
  sample(datetime) {
    const localMs = parseScenarioLocalMs(datetime);
    if (localMs === null) return false;
    this._sample = { localMs, wallAt: this._wallNow() };
    return true;
  }

  /** 'MISSION', 'MISSION_NO_OFFSET' or 'WALL' — see the module comment. */
  get source() {
    if (!this._sample || !this._theatre) return 'WALL';
    if (this._wallNow() - this._sample.wallAt > this._staleMs) return 'WALL';
    return this._offsetKnown ? 'MISSION' : 'MISSION_NO_OFFSET';
  }

  /** In-game Zulu, epoch ms. */
  now() {
    const wall = this._wallNow();
    if (this.source === 'WALL') return wall;
    return this._sample.localMs - this._offsetHours * 3600000 + (wall - this._sample.wallAt);
  }
}

module.exports = { MissionClock, WALL_CLOCK, parseScenarioLocalMs, DEFAULT_STALE_MS };
