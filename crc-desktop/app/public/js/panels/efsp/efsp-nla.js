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
  // [SOURCE-DEFINED] OVERFLIGHT lifecycle labels (docs/adr/0023) — mirrors
  // nla.js's computeOverflightNla exactly.
  OVERFLIGHT: {
    TRANSITING: 'Drop',
  },
  // WP4A second slice — MISSION lifecycle labels, mirroring nla.js's
  // computeMissionNla exactly (guide's own §9.8 lifecycle, line 215).
  MISSION: {
    TASKED:      'Airborne',
    AIRBORNE:    'On Station',
    ON_STATION:  'Off Station',
    OFF_STATION: 'RTB',
    RTB:         'Drop',
  },
  // The carrier's Roles (crc-sync's docs/adr/0074, nla.js's computeMarshalNla,
  // computeFinalNla, computePatternNla). IN_STACK's label is Case-dependent
  // ('Commence' in Case II and III, 'To pattern' in Case I): the server's own
  // `strip.nla.carrierTransfer` names the hand-over and nlaButtonLabel() below
  // reads its label from CARRIER_TRANSFERS; this is the fallback.
  MARSHAL: {
    LAUNCH:    'Launched',
    IN_STACK:  'Commence',
    COMMENCED: 'Radar contact',
  },
  FINAL: {
    ON_FINAL:       'Ball',
    BALL:           'Trapped',
    BOLTER_WAVEOFF: 'Back on final',
  },
  PATTERN: {
    IN_PATTERN: 'Recovered',
    RECOVERED:  'Drop',
  },
};

// The carrier's hand-overs (guide §9.12: four different buttons, four trigger
// types, "MUST NOT be unified behind one button"). A client mirror of
// crc-sync's carrier/transfers.js, drift-tested like the tables below. `seeYou`
// (MARSHAL_TO_PRIFLY) is the Case II second button beside the NLA.
const CARRIER_TRANSFERS = {
  MARSHAL_TO_APPROACH:       { label: 'Commence',      trigger: 'CONTROLLER_INITIATED', from: ['CV_MARSHAL'], cases: ['II', 'III'] },
  APPROACH_TO_FINAL:         { label: 'Radar contact', trigger: 'RADAR_ACQUISITION',    from: ['CV_APP1', 'CV_APP2'], cases: ['II', 'III'] },
  FINAL_TO_LSO:              { label: 'Ball',          trigger: 'PILOT_BALL_CALL',      from: ['CV_APP1', 'CV_APP2'], cases: ['I', 'II', 'III'] },
  MARSHAL_TO_PRIFLY:         { label: 'See you',       trigger: 'PILOT_SEE_YOU',        from: ['CV_MARSHAL'], cases: ['II'] },
  MARSHAL_TO_PATTERN_CASE_I: { label: 'To pattern',    trigger: 'CONTROLLER_INITIATED', from: ['CV_MARSHAL'], cases: ['I'] },
};

/** The label on a Strip's NLA button: the hand-over's own name when the server says the NLA is one, else the Role's state table. */
function nlaButtonLabel(strip) {
  const t = strip && strip.nla && strip.nla.carrierTransfer;
  if (t && CARRIER_TRANSFERS[t]) return CARRIER_TRANSFERS[t].label;
  return strip ? nlaLabelFor(strip.state, strip.role) : null;
}

function nlaLabelFor(state, role = 'DEPARTURE') {
  return (NLA_LABELS[role] || {})[state] || null;
}

// Per-State authority (guide §3.4's "normally owned by" column) — client
// mirror of permission.js's STATE_OWNERS_BY_ROLE/canActOnState. The SERVER
// check (board-store.js's _applyInvokeNla/_validateBayImpliedTransition,
// docs/adr/0010) is what's actually authoritative and load-bearing.
//
// This copy used to be what greyed the NLA button out before a click. It is
// not any more: crc-sync now stamps every Strip it broadcasts with `nla` —
// what pressing that button would do right now, and the reason it would be
// refused when it would be — so the panel renders the server's own answer
// with its own wording (bay-view.js's NLA block, docs/ui-findings/lane4.md
// F-408). Keeping a local copy of three of the server's dozen-odd inhibit
// rules would be two sources for one question, and the smaller source is the
// one that drifts.
//
// So this is now drift-tested only, exactly like COORDINATION_OP_KINDS and
// TOFI_OP_KINDS below — the tables are still worth holding to permission.js,
// and the function is still what makes them testable.
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
  HANDED_OFF:        ['APP', 'CTR'], // docs/adr/0022 bug fix — mirrors permission.js exactly
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

// [SOURCE-DEFINED] OVERFLIGHT lifecycle authority (docs/adr/0023) — mirrors permission.js exactly.
const OVERFLIGHT_STATE_OWNERS = {
  TRANSITING: ['APP', 'CTR'],
};

// WP4A second slice — MISSION lifecycle authority, mirroring permission.js's
// MISSION_STATE_OWNERS exactly. AIC/JTAC deliberately absent — see that
// module's own comment.
const MISSION_STATE_OWNERS = {
  TASKED:      ['TAC_C2', 'GCI'],
  AIRBORNE:    ['TAC_C2', 'GCI'],
  ON_STATION:  ['TAC_C2', 'GCI'],
  OFF_STATION: ['TAC_C2', 'GCI'],
  RTB:         ['TAC_C2', 'GCI'],
};

// WP4A (docs/adr/0015) — client mirror of coordination.js's primitive
// table, same "UX convenience, not a second source of enforcement" caveat
// as everything else in this file. Used only for display (Coordinate
// popover labels, POINT_OUT badge text) — bay-view.js's own
// COORDINATION_TARGETS/dispatch never consult this for anything gating.
const COORDINATION_OP_KINDS = ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT'];

// WP4A second slice — client mirror of permission.js's TOFI_OP_KINDS, same
// convenience-only caveat. Used only by the drift test below — bay-view.js
// gates its own TOFI button off TOFI_COUNTERPARTS (which Positions have a
// valid target, not which op kinds exist), consistent with how
// COORDINATION_OP_KINDS above is also drift-tested only, never consulted
// by bay-view.js's own gating logic.
const TOFI_OP_KINDS = ['TOFI'];

// WP4A gap-closure (docs/adr/0022) — client mirror of coordination.js's
// COORDINATION_ELIGIBLE_STATES, same "UX convenience, server has the real
// gate in _applyCoordinationPropose" caveat as everything else here.
// bay-view.js's _canProposeCoordination consults this directly (unlike
// COORDINATION_OP_KINDS above, which only the drift test reads).
const COORDINATION_ELIGIBLE_STATES = { ARRIVAL: 'INBOUND', DEPARTURE: 'HANDED_OFF' };

// TOFI's own eligibility gate — client mirror of coordination.js's
// TOFI_ELIGIBLE_STATES. Wider than the coordination one only by OVERFLIGHT,
// which is absent above because it never originates a HANDOFF, not because
// it is ever on the ground. Read by bay-view.js's _canProposeTofiEntry.
const TOFI_ELIGIBLE_STATES = { DEPARTURE: 'HANDED_OFF', ARRIVAL: 'INBOUND', OVERFLIGHT: 'TRANSITING' };

// The carrier's three Roles — mirrors permission.js exactly (crc-sync docs/adr/0074).
const MARSHAL_STATE_OWNERS = { LAUNCH: ['CV_MARSHAL'], IN_STACK: ['CV_MARSHAL'], COMMENCED: ['CV_APP1', 'CV_APP2'] };
const FINAL_STATE_OWNERS = { ON_FINAL: ['CV_APP1', 'CV_APP2'], BALL: ['CV_APP1', 'CV_APP2'], BOLTER_WAVEOFF: ['CV_APP1', 'CV_APP2'] };
const PATTERN_STATE_OWNERS = { IN_PATTERN: ['CV_PRIFLY'], RECOVERED: ['CV_PRIFLY'] };

const STATE_OWNERS_BY_ROLE = {
  DEPARTURE: DEPARTURE_STATE_OWNERS, ARRIVAL: ARRIVAL_STATE_OWNERS, OVERFLIGHT: OVERFLIGHT_STATE_OWNERS, MISSION: MISSION_STATE_OWNERS,
  MARSHAL: MARSHAL_STATE_OWNERS, FINAL: FINAL_STATE_OWNERS, PATTERN: PATTERN_STATE_OWNERS,
};

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

/**
 * @param {number|null} lastInvokedAt timestamp of the last advancing press, or null
 *
 * bay-view.js's _swallowRepeatAdvance is the caller, and it keys this
 * BOARD-WIDE rather than per Strip — deliberately unlike board-store.js's own
 * 400ms guard. The bug this catches (lane 1's F-101) is the second tap landing
 * on the neighbour that reflowed up under the pointer once the first Strip was
 * transferred away, which no per-stripId key can see.
 */
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

// UI-A U8: once the mission line a TOFI exchange is with has gone OFF_STATION or RTB, the
// flight is leaving tactical control, so the ATC side's next step is the TOFI Exit. The Strip
// shows it in the NLA slot (strip-view.js's _buildLifeBlock). Pure: the caller looks the mission
// Strip up (the ATC Strip's tofiCoordination.peerStripId).
const TOFI_EXIT_DUE_MISSION_STATES = ['OFF_STATION', 'RTB'];

/** True when `strip` (an ATC-side Strip in ACTIVE TOFI) should offer TOFI Exit as its primary action. */
function tofiExitDueFor(strip, missionStrip) {
  if (!strip || strip.role === 'MISSION') return false;
  const tofi = strip.tofiCoordination;
  if (!tofi || tofi.state !== 'ACTIVE') return false;
  return !!missionStrip && missionStrip.role === 'MISSION'
    && TOFI_EXIT_DUE_MISSION_STATES.includes(missionStrip.state);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TOFI_EXIT_DUE_MISSION_STATES, tofiExitDueFor,
    NLA_LABELS, nlaLabelFor, DOUBLE_TAP_MS, UNDO_WINDOW_MS, isWithinDoubleTapWindow, isUndoAvailable,
    DEFAULT_STALE_THRESHOLD_SECONDS, isEfspBoardStale,
    STATE_OWNERS_BY_ROLE, DEPARTURE_STATE_OWNERS, ARRIVAL_STATE_OWNERS, OVERFLIGHT_STATE_OWNERS, MISSION_STATE_OWNERS, canActOnState,
    MARSHAL_STATE_OWNERS, FINAL_STATE_OWNERS, PATTERN_STATE_OWNERS, CARRIER_TRANSFERS, nlaButtonLabel,
    COORDINATION_OP_KINDS, COORDINATION_ELIGIBLE_STATES, TOFI_OP_KINDS, TOFI_ELIGIBLE_STATES,
  };
}
