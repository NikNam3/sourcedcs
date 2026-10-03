'use strict';

// The catch-all every EFSP store's `apply` has (docs/wip/STORE-THROWS.md, B3; BoardStore.applyMutation is the template).
// A throw is a server fault, not a refusal of the request: `INTERNAL_ERROR`, never `VALIDATION_ERROR`. An op that threw
// may already have written (a rev bump, a record changed before the throw), and such writes cannot be taken back in
// general, so a throw after a write is treated as a crash: the result is marked `partial`, which makes its caller
// audit what is now in the store (`partialAuditTail`), persist the snapshot and broadcast the delta, so memory, disk,
// the audit log and every client agree. A throw before any write stays a plain refusal.

/**
 * @param {string} what — e.g. 'correlation op'
 * @param {unknown} err
 * @param {boolean} wrote — whether the store's sync seq moved since the op began
 */
function internalError(what, err, wrote) {
  const result = { ok: false, reason: 'INTERNAL_ERROR', detail: `internal error processing ${what}` };
  if (wrote) {
    result.partial = true;
    result.internalError = String(err && err.message ? err.message : err).slice(0, 500);
  }
  return result;
}

/** The audit line's extra keys for a partial result (spread into the record). */
function partialAuditTail(result) {
  return result.partial ? { outcome: 'INTERNAL_ERROR', partial: true, error: result.internalError } : {};
}

module.exports = { internalError, partialAuditTail };
