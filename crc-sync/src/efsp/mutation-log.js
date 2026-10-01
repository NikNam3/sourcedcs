'use strict';

// Append-only audit log for EFSP Mutations (guide §5.2, §11.3). New pattern
// for crc-sync — see docs/adr/0002-durable-board-persistence.md. Nothing
// else in this codebase keeps a durable, ever-growing log; theater-settings
// .js/apt-config.js persist current *state* only, not history.
//
// Format: one JSON object per line (JSONL), append-only.
//
// RETENTION (guide §11.3, docs/adr/0065). The live file is rotated into day
// segments and whole segments are deleted once they age out — nothing is ever
// rewritten, so "append-only" holds for every entry that exists. Before each
// append, if the live file's last write was on an earlier UTC day it is
// renamed to `<stem>.<YYYY-MM-DD>[.n]<ext>`, named by the day of its NEWEST
// entry (its mtime). A legacy file that spans weeks is therefore kept until
// its newest entry expires: rotation never deletes anything younger than the
// retention. A segment whose day is older than `today - retentionDays` is
// deleted — at rotation, and once at construction so an idle server still
// prunes at boot. retentionDays is a SOURCE policy choice (default 30,
// config/efsp-instrumentation.json, restart-to-apply).
//
// Days here are WALL-clock UTC days. Retention is a storage lifetime, like a
// TTL, not a time a controller reads (decisions.md H11 draws exactly that
// line), and file mtimes are wall time. The entries' own `at` stays mission
// time.

const fs = require('fs');
const path = require('path');
const { writePath, ensureDirFor } = require('../state-paths');
const { WALL_CLOCK } = require('../mission-clock');
const { getInstrumentationConfig } = require('./instrumentation-config');

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC calendar day of an epoch-ms instant, 'YYYY-MM-DD'. */
function utcDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Overridable so tests exercise the append/read path against a temp file
// instead of the real squadron-wide log — same pattern as theater-settings
// .js's CRCSYNC_THEATER_SETTINGS_PATH.
// Append-only audit state, so it lives in data/ rather than config/ — it was
// previously written into the image and committed to git (see state-paths.js).
const MUTATION_LOG_PATH = writePath('efsp-mutations.jsonl', process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH);

class MutationLog {
  /**
   * @param {string} [filePath]
   * @param {{clock?:{now:()=>number, source:string}}} [deps] the mission clock
   *   the stores stamp `at` with (docs/adr/0079), so each record can say which
   *   clock that was.
   */
  constructor(filePath, { clock = WALL_CLOCK, retentionDays, wallNow = () => Date.now() } = {}) {
    this._path = filePath || MUTATION_LOG_PATH;
    this._clock = clock;
    this._wallNow = wallNow;
    this._retentionDays = Number.isInteger(retentionDays) && retentionDays >= 1
      ? retentionDays
      : getInstrumentationConfig().mutationLog.retentionDays;
    this._listeners = [];
    // UTC day of the live file's newest entry; undefined until first looked
    // at (then its mtime), null when there is no live file yet.
    this._activeDay = undefined;
    const ext = path.extname(this._path);
    this._dir = path.dirname(this._path);
    this._ext = ext;
    this._stem = path.basename(this._path, ext);
    // Exactly this log's segments — never "every *.jsonl in the directory":
    // tests (and a misconfigured deploy) share directories.
    this._segmentRe = new RegExp(`^${escapeRegExp(this._stem)}\\.(\\d{4}-\\d{2}-\\d{2})(?:\\.(\\d+))?${escapeRegExp(ext)}$`);
    this.prune();
  }

  /** Retention in days (read once from config unless the constructor was given one). */
  get retentionDays() { return this._retentionDays; }

  /**
   * Registers a listener called synchronously after every SUCCESSFUL append,
   * with the entry as written. A failed append notifies nobody, so anything
   * built from the listener is a subset of the log. A throwing listener is
   * warned and skipped; it never breaks record() or the next listener.
   * @returns {() => void} unsubscribe
   */
  onRecord(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  }

  /**
   * Appends one audit entry (§4.8.1: stripId, actingPositionId, actorId,
   * timestamp, before/after, clientMutationId). Never throws — a logging
   * failure must not break the Mutation it's recording.
   *
   * The entry's own `at` is mission time (docs/adr/0079) — when the event
   * happened in the scenario the controllers were working. Two fields are
   * added here: `atSource`, 'WALL' if the mission clock had fallen back when
   * it was stamped, and `wallAt`, the real time it was written, for reading
   * the log against server logs and anything else outside the scenario.
   */
  record(entry) {
    let stamped;
    try {
      ensureDirFor(this._path);
      const wallAt = this._wallNow();
      this._rotateIfNewDay(utcDay(wallAt));
      stamped = { ...entry, atSource: this._clock.source, wallAt };
      fs.appendFileSync(this._path, JSON.stringify(stamped) + '\n');
      this._activeDay = utcDay(wallAt);
    } catch (e) {
      console.warn('[efsp-mutation-log] failed to append:', e.message);
      return;
    }
    for (const fn of this._listeners) {
      try { fn(stamped); } catch (e) { console.warn('[efsp-mutation-log] a record listener threw:', e.message); }
    }
  }

  _liveDay() {
    if (this._activeDay !== undefined) return this._activeDay;
    try {
      const st = fs.statSync(this._path);
      this._activeDay = st.size > 0 ? utcDay(st.mtimeMs) : null;
    } catch {
      this._activeDay = null;
    }
    return this._activeDay;
  }

  _rotateIfNewDay(today) {
    const activeDay = this._liveDay();
    if (!activeDay || activeDay === today) return;
    let target = this._segmentPath(activeDay, 0);
    for (let n = 1; fs.existsSync(target); n++) target = this._segmentPath(activeDay, n);
    try {
      fs.renameSync(this._path, target);
    } catch (e) {
      // Nothing lost: the entry still goes to the live file, which simply
      // stays unrotated until the next day's first append tries again.
      console.warn('[efsp-mutation-log] failed to rotate:', e.message);
      return;
    }
    this._activeDay = null;
    this.prune();
  }

  _segmentPath(day, n) {
    return path.join(this._dir, `${this._stem}.${day}${n ? `.${n}` : ''}${this._ext}`);
  }

  /** This log's day segments, oldest first: [{ day, n, file }]. */
  _segments() {
    let names;
    try { names = fs.readdirSync(this._dir); } catch { return []; }
    const out = [];
    for (const name of names) {
      const m = this._segmentRe.exec(name);
      if (m) out.push({ day: m[1], n: m[2] ? Number(m[2]) : 0, file: path.join(this._dir, name) });
    }
    return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.n - b.n));
  }

  /**
   * Deletes every segment of this log whose day is older than
   * `today - retentionDays` (a segment of day D survives through D+retention).
   * Whole-segment deletion is the only way an entry ever leaves the log.
   * @returns {number} segments deleted
   */
  prune() {
    const cutoff = utcDay(this._wallNow() - this._retentionDays * DAY_MS);
    let deleted = 0;
    for (const seg of this._segments()) {
      if (seg.day >= cutoff) continue;
      try { fs.unlinkSync(seg.file); deleted++; } catch (e) { console.warn('[efsp-mutation-log] failed to prune', seg.file, e.message); }
    }
    return deleted;
  }

  _readFile(file) {
    try {
      return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  /** Every retained entry — the day segments in day order, then the live file. Inspection, boot reconciliation and tests only — not on any hot path. */
  readAll() {
    return this.readSince(-Infinity);
  }

  /**
   * Retained entries written at or after `wallMs` (wall clock, like the
   * segment days). Segments whose whole day is earlier are not even read;
   * an entry without a `wallAt` (written before docs/adr/0079) is kept.
   */
  readSince(wallMs) {
    const fromDay = Number.isFinite(wallMs) ? utcDay(wallMs) : null;
    const out = [];
    for (const seg of this._segments()) {
      if (fromDay && seg.day < fromDay) continue;
      out.push(...this._readFile(seg.file));
    }
    out.push(...this._readFile(this._path));
    if (!Number.isFinite(wallMs)) return out;
    return out.filter(e => !Number.isFinite(e.wallAt) || e.wallAt >= wallMs);
  }
}

module.exports = { MutationLog, MUTATION_LOG_PATH, };
