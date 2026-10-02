'use strict';

// Client-side NLA button labels + the 400ms double-tap guard and 30s Undo-
// availability window (guide §3.5 rules 3 and 5). crc-sync's own
// guards are authoritative (see board/ops/invoke-nla.js's `_applyInvokeNla` and
// board/ops/undo.js's `_applyUndo`)
// — this exists so the button visibly disables/re-enables without waiting
// on a round trip, per §7.9's "local input -> visual feedback < 50ms, never
// waiting on the server" budget. Clock is injectable so the timing logic
// is testable without real setTimeout delays.

// [SOURCE-DEFINED] — mirrors crc-sync's STATES_BY_STRIP_TYPE (authority/index.js) and
// the strip-type `computeNla` functions (authority/strip-types/*.js) exactly,
// role-keyed since Phase 2 adds ARRIVAL. DEPARTED's label reflects the
// real transfer-shaped Hand Off now (docs/adr/0007, superseding ADR
// 0005's "(local)" stub wording — this IS the real intrafacility
// TransferStrip to AP, just not WP4A's cross-Facility HANDOFF).
export const NLA_LABELS = {
  DEPARTURE: {
    PROPOSED:          'Send to Clearance',
    PENDING_CLEARANCE: 'Mark Cleared',
    CLEARED:           'Approve Pushback',
    HELD:              'Release',
    PUSHBACK:          'Taxi',
    TAXI:              'To Runway Queue',
    RUNWAY_QUEUE:      'Line Up and Wait',
    LUAW:              'Cleared for Takeoff',
    DEPARTED:          'Hand Off to AP',
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
  // [SOURCE-DEFINED] OVERFLIGHT labels (docs/adr/0087; the states are the
  // guide's, the labels ours) — mirrors authority/strip-types/overflight.js's computeOverflightNla exactly.
  // IN_SECTOR's step is "leaves our airspace" (no transfer); handing the flight
  // to our next Facility is Coordinate/HANDOFF, so the label says what it does
  // and does not read as that (questions-round3 Q3-11).
  OVERFLIGHT: {
    INBOUND:    'Radar Contact',
    IN_SECTOR:  'Leaves Sector',
    HANDED_OFF: 'Drop',
  },
  // [SOURCE-DEFINED] — the guide's own mission lifecycle (guide line 215, under
  // §3.4's [SOURCE-DEFINED] heading). WP4A second slice, mirroring
  // authority/strip-types/mission.js's computeMissionNla exactly.
  MISSION: {
    TASKED:      'Airborne',
    AIRBORNE:    'On Station',
    ON_STATION:  'Off Station',
    OFF_STATION: 'RTB',
    RTB:         'Drop',
  },
  // The carrier's strip types (crc-sync's docs/adr/0074, nla.js's computeMarshalNla,
  // computeFinalNla, computePatternNla). IN_STACK's label is Case-dependent
  // ('Commence' in Case II and III, 'To pattern' in Case I): the server's own
  // `strip.nla.carrierHandoff` names the handoff and nlaButtonLabel() below
  // reads its label from CARRIER_HANDOFFS; this is the fallback.
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

// The carrier's handoffs (guide §9.12: four different buttons, four trigger
// types, "MUST NOT be unified behind one button"). A client mirror of
// crc-sync's carrier/handoffs.js, drift-tested like the tables below. `seeYou`
// (MARSHAL_TO_PRIFLY) is the Case II second button beside the NLA.
export const CARRIER_HANDOFFS = {
  MARSHAL_TO_APPROACH:       { label: 'Commence',      trigger: 'CONTROLLER_INITIATED', from: ['CV_MARSHAL'], cases: ['II', 'III'] },
  APPROACH_TO_FINAL:         { label: 'Radar contact', trigger: 'RADAR_ACQUISITION',    from: ['CV_APP1', 'CV_APP2'], cases: ['II', 'III'] },
  FINAL_TO_LSO:              { label: 'Ball',          trigger: 'PILOT_BALL_CALL',      from: ['CV_APP1', 'CV_APP2'], cases: ['I', 'II', 'III'] },
  MARSHAL_TO_PRIFLY:         { label: 'See you',       trigger: 'PILOT_SEE_YOU',        from: ['CV_MARSHAL'], cases: ['II'] },
  MARSHAL_TO_PATTERN_CASE_I: { label: 'To pattern',    trigger: 'CONTROLLER_INITIATED', from: ['CV_MARSHAL'], cases: ['I'] },
};

/** The label on a Strip's NLA button: the handoff's own name when the server says the NLA is one, else the strip type's state table. */
export function nlaButtonLabel(strip) {
  const t = strip && strip.nla && strip.nla.carrierHandoff;
  if (t && CARRIER_HANDOFFS[t]) return CARRIER_HANDOFFS[t].label;
  return strip ? nlaLabelFor(strip.state, strip.stripType) : null;
}

export function nlaLabelFor(state, stripType = 'DEPARTURE') {
  return (NLA_LABELS[stripType] || {})[state] || null;
}

// [SOURCE-DEFINED] (guide §3.4) — mirrors authority/strip-types/departure.js's marker.
// Per-State authority (guide §3.4's "normally owned by" column), client
// mirror of crc-sync's STATE_OWNERS_BY_STRIP_TYPE (authority/index.js) and
// permission.js's canActOnState. The SERVER check (board/ops/invoke-nla.js's
// `_applyInvokeNla` and board/placement.js's
// `validateBayImpliedTransition`,
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
// TOFI_OP_KINDS below — the tables are still worth holding to the authority tables,
// and the function is still what makes them testable.
export const DEPARTURE_STATE_OWNERS = {
  PROPOSED:          ['OPS'],
  PENDING_CLEARANCE: ['CD'],
  CLEARED:           ['CD'],
  HELD:              ['CD', 'GC'],
  PUSHBACK:          ['GC'],
  TAXI:              ['GC'],
  RUNWAY_QUEUE:      ['LC'],
  LUAW:              ['LC'],
  DEPARTED:          ['LC'],
  HANDED_OFF:        ['AP', 'CTR'], // docs/adr/0022 bug fix — mirrors the authority tables exactly
};

// [SOURCE-DEFINED] ARRIVAL lifecycle authority (docs/adr/0008/0010). CTR
// added to INBOUND (WP4A, docs/adr/0014) — mirrors the authority tables exactly.
export const ARRIVAL_STATE_OWNERS = {
  INBOUND:         ['AP', 'CTR', 'SFA'], // SFA (docs/adr/0075) works the inbound aircraft on its frequencies
  HANDED_TO_TOWER: ['LC'],
  FINAL:           ['LC'],
  LANDED:          ['LC'],
  TAXI_IN:         ['GC'],
};

// [SOURCE-DEFINED] OVERFLIGHT lifecycle authority (docs/adr/0087) — mirrors the authority tables exactly.
export const OVERFLIGHT_STATE_OWNERS = {
  INBOUND:    ['AP', 'CTR'],
  IN_SECTOR:  ['AP', 'CTR'],
  HANDED_OFF: ['AP', 'CTR'],
};

// [SOURCE-DEFINED] — the guide's own mission lifecycle (guide line 215, under
// §3.4's [SOURCE-DEFINED] heading). WP4A second slice, mirroring crc-sync's MISSION_STATE_OWNERS (authority/strip-types/mission.js) exactly.
// AIC/JTAC deliberately absent — see that module's own comment.
export const MISSION_STATE_OWNERS = {
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
export const COORDINATION_OP_KINDS = ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT'];

// WP4A second slice — client mirror of crc-sync's TOFI_OP_KINDS (authority/op-kinds.js), same
// convenience-only caveat. Used only by the drift test below — bay-view.js
// gates its own TOFI button off TOFI_COUNTERPARTS (which Positions have a
// valid target, not which op kinds exist), consistent with how
// COORDINATION_OP_KINDS above is also drift-tested only, never consulted
// by bay-view.js's own gating logic.
export const TOFI_OP_KINDS = ['TOFI'];

// WP4A gap-closure (docs/adr/0022) — client mirror of coordination.js's
// COORDINATION_ELIGIBLE_STATES, same "UX convenience, server has the real
// gate in _applyCoordinationPropose" caveat as everything else here.
// bay-view.js's _canProposeCoordination consults this directly (unlike
// COORDINATION_OP_KINDS above, which only the drift test reads).
export const COORDINATION_ELIGIBLE_STATES = { ARRIVAL: 'INBOUND', DEPARTURE: 'HANDED_OFF', OVERFLIGHT: 'IN_SECTOR' };

// TOFI's own eligibility gate — client mirror of coordination.js's
// TOFI_ELIGIBLE_STATES (OVERFLIGHT at IN_SECTOR, docs/adr/0087). Read by
// bay-view.js's _canProposeTofiEntry.
export const TOFI_ELIGIBLE_STATES = { DEPARTURE: 'HANDED_OFF', ARRIVAL: 'INBOUND', OVERFLIGHT: 'IN_SECTOR' };

// The carrier's three strip types — mirrors the authority tables exactly (crc-sync docs/adr/0074).
export const MARSHAL_STATE_OWNERS = { LAUNCH: ['CV_MARSHAL'], IN_STACK: ['CV_MARSHAL'], COMMENCED: ['CV_APP1', 'CV_APP2'] };
// PAR (docs/adr/0075) shares FINAL, RSU shares PATTERN: the same strip types, more owners.
export const FINAL_STATE_OWNERS = { ON_FINAL: ['CV_APP1', 'CV_APP2', 'PAR'], BALL: ['CV_APP1', 'CV_APP2', 'PAR'], BOLTER_WAVEOFF: ['CV_APP1', 'CV_APP2', 'PAR'] };
export const PATTERN_STATE_OWNERS = { IN_PATTERN: ['CV_PRIFLY', 'RSU'], RECOVERED: ['CV_PRIFLY', 'RSU'] };

export const STATE_OWNERS_BY_STRIP_TYPE = {
  DEPARTURE: DEPARTURE_STATE_OWNERS, ARRIVAL: ARRIVAL_STATE_OWNERS, OVERFLIGHT: OVERFLIGHT_STATE_OWNERS, MISSION: MISSION_STATE_OWNERS,
  MARSHAL: MARSHAL_STATE_OWNERS, FINAL: FINAL_STATE_OWNERS, PATTERN: PATTERN_STATE_OWNERS,
};

/**
 * @param {string} actingPositionId
 * @param {string} role
 * @param {string} state — the Strip's CURRENT state (the one being advanced FROM)
 * @returns {boolean}
 */
export function canActOnState(actingPositionId, stripType, state) {
  const owners = (STATE_OWNERS_BY_STRIP_TYPE[stripType] || {})[state];
  return !!owners && owners.includes(actingPositionId);
}

export const DOUBLE_TAP_MS = 400;
export const UNDO_WINDOW_MS = 30000;

/**
 * @param {number|null} lastInvokedAt timestamp of the last advancing press, or null
 *
 * bay-view.js's _swallowRepeatAdvance is the caller, and it keys this
 * BOARD-WIDE rather than per Strip — deliberately unlike crc-sync's own
 * 400ms guard (board-store.js's double-tap map). The bug this catches (lane 1's F-101) is the second tap landing
 * on the neighbour that reflowed up under the pointer once the first Strip was
 * transferred away, which no per-stripId key can see.
 */
export function isWithinDoubleTapWindow(lastInvokedAt, now) {
  return lastInvokedAt != null && (now - lastInvokedAt) < DOUBLE_TAP_MS;
}

export function isUndoAvailable(lastInvokedAt, now) {
  return lastInvokedAt != null && (now - lastInvokedAt) < UNDO_WINDOW_MS;
}

// Board staleness (guide §5.6 rule 5) — "a controller MUST never be unable
// to tell that the Board they are reading is frozen." Pure threshold check,
// same clock-injectable discipline as the two functions above, driven by
// ws-hub.js's per-tick efsp-heartbeat (not by "time since any EFSP message",
// which would false-positive on a genuinely quiet Board).
export const DEFAULT_STALE_THRESHOLD_SECONDS = 10;

/** @param {number|null} lastHeartbeatAt timestamp of the last received efsp-heartbeat, or null if none has arrived yet this session */
export function isEfspBoardStale(lastHeartbeatAt, now, thresholdSeconds = DEFAULT_STALE_THRESHOLD_SECONDS) {
  if (lastHeartbeatAt == null) return false; // nothing to compare yet — not stale, just not-yet-connected
  return (now - lastHeartbeatAt) >= thresholdSeconds * 1000;
}

// UI-A U8: once the mission line a TOFI exchange is with has gone OFF_STATION or RTB, the
// flight is leaving tactical control, so the ATC side's next step is the TOFI Exit. The Strip
// shows it in the NLA slot (strip-view.js's _buildLifeBlock). Pure: the caller looks the mission
// Strip up (the ATC Strip's tofiCoordination.peerStripId).
export const TOFI_EXIT_DUE_MISSION_STATES = ['OFF_STATION', 'RTB'];

/** True when `strip` (an ATC-side Strip in ACTIVE TOFI) should offer TOFI Exit as its primary action. */
export function tofiExitDueFor(strip, missionStrip) {
  if (!strip || strip.stripType === 'MISSION') return false;
  const tofi = strip.tofiCoordination;
  if (!tofi || tofi.state !== 'ACTIVE') return false;
  return !!missionStrip && missionStrip.stripType === 'MISSION'
    && TOFI_EXIT_DUE_MISSION_STATES.includes(missionStrip.state);
}
