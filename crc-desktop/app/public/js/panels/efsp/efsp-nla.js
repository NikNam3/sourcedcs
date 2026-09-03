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

// Per-State authority (guide §3.4's "normally owned by" column) — client
// mirror of permission.js's STATE_OWNERS_BY_ROLE/canActOnState. The SERVER
// check (board-store.js's _applyInvokeNla/_validateBayImpliedTransition,
// docs/adr/0010) is what's actually authoritative and load-bearing; this
// copy exists purely so the NLA button can render as disabled/grey BEFORE
// a click, instead of only failing after one reaches the server. Per §7.9's
// "local input -> visual feedback < 50ms" budget and the same reasoning as
// the double-tap/Undo timers above — this is a UX convenience mirror, not
// a second source of enforcement.
const DEPARTURE_STATE_OWNERS = {
  PROPOSED:          ['OPS'],
  PENDING_CLEARANCE: ['CD'],
  CLEARED:           ['CD'],
  HELD:              ['CD', 'GND'],
  PUSHBACK:          ['GND'],
  TAXI:              ['GND'],
  RUNWAY_QUEUE:      ['TWR'],
  LUAW:              ['TWR'],
  DEPARTED:          ['TWR'],
  HANDED_OFF:        ['APP'],
};

// [SOURCE-DEFINED] ARRIVAL lifecycle authority (docs/adr/0008/0010). CTR
// added to INBOUND (WP4A, docs/adr/0014) — mirrors permission.js exactly.
const ARRIVAL_STATE_OWNERS = {
  INBOUND:         ['APP', 'CTR'],
  HANDED_TO_TOWER: ['TWR'],
  FINAL:           ['TWR'],
  LANDED:          ['TWR'],
  TAXI_IN:         ['GND'],
};

// WP4A (docs/adr/0015) — client mirror of coordination.js's primitive
// table, same "UX convenience, not a second source of enforcement" caveat
// as everything else in this file. Used only for display (Coordinate
// popover labels, POINT_OUT badge text) — bay-view.js's own
// COORDINATION_TARGETS/dispatch never consult this for anything gating.
const COORDINATION_OP_KINDS = ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT'];

const STATE_OWNERS_BY_ROLE = { DEPARTURE: DEPARTURE_STATE_OWNERS, ARRIVAL: ARRIVAL_STATE_OWNERS };

/**
 * @param {string} actingPositionId
 * @param {string} role
 * @param {string} state — the Strip's CURRENT state (the one being advanced FROM)
 * @returns {boolean}
 */
function canActOnState(actingPositionId, role, state) {
  const owners = (STATE_OWNERS_BY_ROLE[role] || {})[state];
  return !!owners && owners.includes(actingPositionId);
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
    STATE_OWNERS_BY_ROLE, DEPARTURE_STATE_OWNERS, ARRIVAL_STATE_OWNERS, canActOnState,
    COORDINATION_OP_KINDS,
  };
}
