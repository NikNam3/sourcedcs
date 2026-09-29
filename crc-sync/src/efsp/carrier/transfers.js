'use strict';

// The carrier's ownership transfers, as data (guide §9.12, docs/adr/0064).
//
// §9.12: "Ownership transfers on the carrier are heterogeneous and MUST NOT be
// unified behind one button: Marshal → Approach is controller-initiated;
// Approach → Final is on radar acquisition; Final → LSO is on the pilot's
// 'ball' call; Case II Marshal → PriFly is on a pilot report. Four different
// trigger types."
//
// ALL of them are controller gestures. Guide §10.3 / defect D5 forbid
// advancing a Strip on surveillance: "radar acquisition" is the controller
// saying "radar contact"; "ball" and "see you" are the controller recording
// what the pilot said. The trigger type is METADATA recorded on the transfer
// and rendered distinctly (WP7A bullet 4). It is never an automation hook.
//
// No transfer kind carries a frequency: frequency is SFA's business (§4.7,
// D17, lane L18).
//
// Provenance:
//   §9.12 (binding)  — the four kinds and their four trigger types; CV_APP1 /
//                      CV_APP2 "fed alternately from the Marshal stack in push
//                      order"; Case II Marshal → PriFly.
//   §4.1 (binding)   — CV_APP1/2 run MARSHAL → FINAL; the LSO is not one of
//                      the four CV Positions.
//   decisions H30    — alternating APP lanes, [SOURCE-DEFINED].
//   [SOURCE-DEFINED] — the lane parity (even push ordinal → CV_APP1); the
//                      fifth row MARSHAL_TO_PATTERN_CASE_I (L4 briefing Q8:
//                      the guide gives Case I no transfer, so it reuses the
//                      CONTROLLER_INITIATED trigger type — the four trigger
//                      TYPES stay four); the button labels.

const TRIGGER_TYPES = Object.freeze(['CONTROLLER_INITIATED', 'RADAR_ACQUISITION', 'PILOT_BALL_CALL', 'PILOT_SEE_YOU']);

const APP_LANES = Object.freeze(['CV_APP1', 'CV_APP2']);

const _row = (r) => Object.freeze({ ...r, from: Object.freeze(r.from), cases: Object.freeze(r.cases) });

const CARRIER_TRANSFERS = Object.freeze({
  MARSHAL_TO_APPROACH: _row({
    trigger: 'CONTROLLER_INITIATED',
    from: ['CV_MARSHAL'], to: APP_LANES,
    cases: ['II', 'III'],
    ownershipChange: true, roleChange: null, // MARSHAL stays MARSHAL
    stackEffect: 'MARK_PUSHED',
    label: 'Commence',
    source: '§9.12',
    guide: '§9.12 — Marshal → Approach is controller-initiated',
  }),
  APPROACH_TO_FINAL: _row({
    trigger: 'RADAR_ACQUISITION',
    from: APP_LANES, to: 'SAME', // same lane controller — §4.1 "MARSHAL → FINAL"
    cases: ['II', 'III'],
    ownershipChange: false, roleChange: Object.freeze({ from: 'MARSHAL', to: 'FINAL' }),
    stackEffect: null,
    label: 'Radar contact',
    source: '§9.12',
    guide: '§9.12 — Approach → Final is on radar acquisition',
  }),
  FINAL_TO_LSO: _row({
    trigger: 'PILOT_BALL_CALL',
    from: APP_LANES, to: 'EXTERNAL_LSO', // the LSO is not an EFSP Position (§4.1 lists four CV Positions)
    cases: ['I', 'II', 'III'],
    ownershipChange: false, roleChange: null, // a state change only (FINAL ON_FINAL → BALL)
    stackEffect: null,
    label: 'Ball',
    source: '§9.12',
    guide: '§9.12 — Final → LSO is on the pilot\'s "ball" call',
  }),
  MARSHAL_TO_PRIFLY: _row({
    trigger: 'PILOT_SEE_YOU',
    from: ['CV_MARSHAL'], to: Object.freeze(['CV_PRIFLY']),
    cases: ['II'],
    ownershipChange: true, roleChange: Object.freeze({ from: 'MARSHAL', to: 'PATTERN' }),
    stackEffect: 'REMOVE_NO_CLOSE_UP',
    label: 'See you',
    source: '§9.12',
    guide: '§9.12 rule 4 — Case II Marshal → PriFly fires on a pilot report',
  }),
  MARSHAL_TO_PATTERN_CASE_I: _row({
    trigger: 'CONTROLLER_INITIATED',
    from: ['CV_MARSHAL'], to: Object.freeze(['CV_PRIFLY']),
    cases: ['I'],
    ownershipChange: true, roleChange: Object.freeze({ from: 'MARSHAL', to: 'PATTERN' }),
    stackEffect: 'REMOVE_NO_CLOSE_UP',
    label: 'To pattern',
    source: '[SOURCE-DEFINED]',
    guide: '[SOURCE-DEFINED] — §9.12 gives Case I no transfer; L4 briefing Q8',
  }),
});

/** The four kinds §9.12 names — the ones that MUST stay four distinct affordances. */
const GUIDE_TRANSFER_KINDS = Object.freeze(['MARSHAL_TO_APPROACH', 'APPROACH_TO_FINAL', 'FINAL_TO_LSO', 'MARSHAL_TO_PRIFLY']);

function _fail(detail) {
  return { ok: false, reason: 'VALIDATION_ERROR', detail };
}

/**
 * Is this transfer legal in this Case, from this Position, to that one?
 * `to: 'SAME'` means the receiving Position is the sender (toPositionId may be
 * omitted); `to: 'EXTERNAL_LSO'` means nobody in the EFSP receives it
 * (toPositionId must be null/omitted).
 * @returns {{ok:true, transfer:object} | {ok:false, reason:'VALIDATION_ERROR', detail:string}}
 */
function validateCarrierTransfer(kind, { caseValue, fromPositionId, toPositionId = null } = {}) {
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(CARRIER_TRANSFERS, kind)) {
    return _fail(`unknown carrier transfer '${kind}'`);
  }
  const t = CARRIER_TRANSFERS[kind];
  if (!t.cases.includes(caseValue)) {
    return _fail(`${t.label} (${kind}) is a Case ${t.cases.join('/')} transfer; the recovery Case is ${caseValue ?? 'unknown'}`);
  }
  if (!t.from.includes(fromPositionId)) {
    return _fail(`${t.label} (${kind}) is sent by ${t.from.join(' or ')}, not ${fromPositionId ?? 'nobody'}`);
  }
  if (t.to === 'SAME') {
    if (toPositionId != null && toPositionId !== fromPositionId) {
      return _fail(`${t.label} (${kind}) stays with ${fromPositionId}; it does not go to ${toPositionId}`);
    }
  } else if (t.to === 'EXTERNAL_LSO') {
    if (toPositionId != null) return _fail(`${t.label} (${kind}) passes the aircraft to the LSO, who is not an EFSP Position`);
  } else if (!t.to.includes(toPositionId)) {
    return _fail(`${t.label} (${kind}) goes to ${t.to.join(' or ')}, not ${toPositionId ?? 'nobody'}`);
  }
  return { ok: true, transfer: t };
}

/**
 * §9.12: "Feed them alternately from the Marshal stack in push order."
 * Even push ordinal → CV_APP1, odd → CV_APP2 ([SOURCE-DEFINED] parity, guide
 * OQ8). If the preferred lane is unmanned, the other; if neither is, null —
 * the NLA inhibits with nla.js's existing "no receiving Position present".
 * @param {number} pushOrdinal  0-based place in push order
 * @param {{isOccupied:(positionId:string)=>boolean}} ctx
 */
function laneFor(pushOrdinal, { isOccupied = () => true } = {}) {
  if (!Number.isInteger(pushOrdinal) || pushOrdinal < 0) return null;
  const preferred = APP_LANES[pushOrdinal % 2];
  const other = APP_LANES[(pushOrdinal + 1) % 2];
  const occ = (p) => {
    try { return isOccupied(p) === true; } catch { return false; }
  };
  if (occ(preferred)) return preferred;
  if (occ(other)) return other;
  return null;
}

/**
 * Lanes for the HOLDING entries of a derived stack, in push order. The push
 * ordinal is each entry's rank in the stack (PUSHED entries still in the
 * stack count, so a flight's lane does not flip when the one below it
 * commences; vacancies do not count, so the alternation survives a gap).
 * @param {Array<{fdrId, stackIndex, status}>} derivedStack  marshal-stack.deriveStack() output
 * @returns {Array<{fdrId:string, pushOrdinal:number, lane:string|null}>}
 */
function assignLanes(derivedStack, { isOccupied = () => true } = {}) {
  const list = Array.isArray(derivedStack) ? derivedStack.filter((d) => d && Number.isInteger(d.stackIndex)) : [];
  const ordered = list.slice().sort((a, b) => a.stackIndex - b.stackIndex);
  const out = [];
  ordered.forEach((d, i) => {
    if (d.status === 'HOLDING') out.push({ fdrId: d.fdrId, pushOrdinal: i, lane: laneFor(i, { isOccupied }) });
  });
  return out;
}

module.exports = {
  TRIGGER_TYPES,
  APP_LANES,
  CARRIER_TRANSFERS,
  GUIDE_TRANSFER_KINDS,
  validateCarrierTransfer,
  laneFor,
  assignLanes,
};
