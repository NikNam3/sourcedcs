'use strict';

// Client-side NLA button labels + the 400ms double-tap guard and 30s Undo-
// availability window (guide §3.5 rules 3 and 5). board-store.js's own
// guards are authoritative (see board-store.js's _applyInvokeNla/_applyUndo)
// — this exists so the button visibly disables/re-enables without waiting
// on a round trip, per §7.9's "local input -> visual feedback < 50ms, never
// waiting on the server" budget. Clock is injectable so the timing logic
// is testable without real setTimeout delays.

// [SOURCE-DEFINED] — mirrors nla.js's STATES_BY_ROLE/computeNla exactly,
// role-keyed since Phase 2 adds ARRIVAL. DEPARTED's label reflects the
// real transfer-shaped Hand Off now (docs/adr/0007, superseding ADR
// 0005's "(local)" stub wording — this IS the real intrafacility
// TransferStrip to APP, just not WP4A's cross-Facility HANDOFF).
const NLA_LABELS = {
  DEPARTURE: {
    PROPOSED:          'Send to Clearance',
    PENDING_CLEARANCE: 'Mark Cleared',
    CLEARED:           'Approve Pushback',
    HELD:              'Release',
    PUSHBACK:          'Taxi',
    TAXI:              'To Runway Queue',
    RUNWAY_QUEUE:      'Line Up and Wait',
    LUAW:              'Cleared for Takeoff',
    DEPARTED:          'Hand Off to APP',
    HANDED_OFF:        'Drop',
  },
  // [SOURCE-DEFINED] ARRIVAL lifecycle labels (docs/adr/0008).
  ARRIVAL: {
    INBOUND:         'Hand to Tower',
    HANDED_TO_TOWER: 'On Final',
    FINAL:           'Landed',
    LANDED:          'Taxi In',
    TAXI_IN:         'Drop',
  },
};

function nlaLabelFor(state, role = 'DEPARTURE') {
  return (NLA_LABELS[role] || {})[state] || null;
}

const DOUBLE_TAP_MS = 400;
const UNDO_WINDOW_MS = 30000;

/** @param {number|null} lastInvokedAt timestamp of the last InvokeNla for this Strip this session, or null */
function isWithinDoubleTapWindow(lastInvokedAt, now) {
  return lastInvokedAt != null && (now - lastInvokedAt) < DOUBLE_TAP_MS;
}

function isUndoAvailable(lastInvokedAt, now) {
  return lastInvokedAt != null && (now - lastInvokedAt) < UNDO_WINDOW_MS;
}

// Board staleness (guide §5.6 rule 5) — "a controller MUST never be unable
// to tell that the Board they are reading is frozen." Pure threshold check,
// same clock-injectable discipline as the two functions above, driven by
// ws-hub.js's per-tick efsp-heartbeat (not by "time since any EFSP message",
// which would false-positive on a genuinely quiet Board).
const DEFAULT_STALE_THRESHOLD_SECONDS = 10;

/** @param {number|null} lastHeartbeatAt timestamp of the last received efsp-heartbeat, or null if none has arrived yet this session */
function isEfspBoardStale(lastHeartbeatAt, now, thresholdSeconds = DEFAULT_STALE_THRESHOLD_SECONDS) {
  if (lastHeartbeatAt == null) return false; // nothing to compare yet — not stale, just not-yet-connected
  return (now - lastHeartbeatAt) >= thresholdSeconds * 1000;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NLA_LABELS, nlaLabelFor, DOUBLE_TAP_MS, UNDO_WINDOW_MS, isWithinDoubleTapWindow, isUndoAvailable,
    DEFAULT_STALE_THRESHOLD_SECONDS, isEfspBoardStale,
  };
}
