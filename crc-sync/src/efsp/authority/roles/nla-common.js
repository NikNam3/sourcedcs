'use strict';

// Helpers more than one Role family's NLA table uses (moved from nla.js, AUTH).

const { runwayInhibitFor } = require('../../field-state');

/**
 * `now` is required everywhere in this module, and is the mission clock's
 * (docs/adr/0079): every gate here is a time of day a controller reads. It
 * used to default to Date.now(), which is the one answer that is always
 * plausible and, with a mission set at 0240Z and flown at 1900Z, always wrong.
 */
function _requireNow(now) {
  if (!Number.isFinite(now)) throw new TypeError('nla: `now` (mission-clock ms) is required');
}

/** Rule 1's inhibit for this Strip's runway, or null (fail open — see field-state.js). */
function _runwayInhibit(strip, fdr, ctx) {
  return runwayInhibitFor(strip, fdr, ctx.fieldStateFor(), { targetRackId: ctx.targetRackId });
}

module.exports = { _requireNow, _runwayInhibit };
