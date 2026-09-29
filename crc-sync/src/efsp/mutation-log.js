'use strict';

// Append-only audit log for EFSP Mutations (guide §5.2, §11.3). New pattern
// for crc-sync — see docs/adr/0002-durable-board-persistence.md. Nothing
// else in this codebase keeps a durable, ever-growing log; theater-settings
// .js/apt-config.js persist current *state* only, not history.
//
// Format: one JSON object per line (JSONL), append-only. The 30-day-default
// retention/rotation job the guide describes (§11.3) is WP8 scope, not
// Phase 1 — see the implementation plan's placeholder-decisions list.

const fs = require('fs');
const { writePath, ensureDirFor } = require('../state-paths');
const { WALL_CLOCK } = require('../mission-clock');

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
  constructor(filePath, { clock = WALL_CLOCK } = {}) {
    this._path = filePath || MUTATION_LOG_PATH;
    this._clock = clock;
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
    try {
      ensureDirFor(this._path);
      const stamped = { ...entry, atSource: this._clock.source, wallAt: Date.now() };
      fs.appendFileSync(this._path, JSON.stringify(stamped) + '\n');
    } catch (e) {
      console.warn('[efsp-mutation-log] failed to append:', e.message);
    }
  }

  /** Reads every entry currently on disk, in append order. Inspection/test use only — not on any hot path. */
  readAll() {
    try {
      const raw = fs.readFileSync(this._path, 'utf8');
      return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }
}

module.exports = { MutationLog, MUTATION_LOG_PATH };
