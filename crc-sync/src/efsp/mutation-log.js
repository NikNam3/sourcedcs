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
const path = require('path');

// Overridable so tests exercise the append/read path against a temp file
// instead of the real squadron-wide log — same pattern as theater-settings
// .js's CRCSYNC_THEATER_SETTINGS_PATH.
const MUTATION_LOG_PATH = process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH
  || path.join(__dirname, '../../config/efsp-mutations.jsonl');

class MutationLog {
  constructor(filePath) {
    this._path = filePath || MUTATION_LOG_PATH;
  }

  /**
   * Appends one audit entry (§4.8.1: stripId, actingPositionId, actorId,
   * timestamp, before/after, clientMutationId). Never throws — a logging
   * failure must not break the Mutation it's recording.
   */
  record(entry) {
    try {
      fs.appendFileSync(this._path, JSON.stringify(entry) + '\n');
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
