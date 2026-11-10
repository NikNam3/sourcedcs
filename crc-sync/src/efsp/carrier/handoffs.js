'use strict';

// The carrier handoffs, as data (docs/adr/0156, which replaced the guide §9.12 set of ADR 0064/0074/0137/0155).
//
// One row per handoff, everything it does: who sends it (`from`), who receives it (`to`: a list, or 'SAME' for a state
// change the sender keeps), which Case it is legal in and whose Case that is (`caseOf`: the SHIP's for a launch on deck and
// for Abort, the FLIGHT's for a recovery, since a flight keeps the Case it was given on its initial call), the Strip it
// applies to and what that Strip becomes (`stripType`, `states`, `toStripType`, `toState`, in place, as ConvertToArrival
// does, docs/adr/0023), and what it does to the Marshal stack (`stackEffect`, carrier-store.js applyEffect). The Board
// (board/ops/carrier-handoff.js) holds no carrier doctrine; it reads this.
//
// Every one is a controller gesture (guide §10.3, D5): nothing here reads a radar contact. No row carries a frequency
// (docs/adr/0117). [SOURCE-DEFINED]: the human's rulings of 2026-11-08 (ADR 0156) and 2026-11-10 (ADR 0157: TRAPPED and
// BOLTER, Case I's SIGNAL_CHARLIE).

const TRIGGER_TYPES = Object.freeze(['CONTROLLER_INITIATED']);

const APP_LANES = Object.freeze(['CV_APP1', 'CV_APP2']);
const SEQUENCED = Object.freeze(['II', 'III']);
const ANY_CASE = Object.freeze(['I', 'II', 'III']);

const _row = (r) => Object.freeze({
  trigger: 'CONTROLLER_INITIATED', source: '[SOURCE-DEFINED]', guide: 'docs/adr/0156', stackEffect: null, clearsAssignments: false,
  assignsCode: false, // a Case I flight going to Case II/III gets the squawk Case I did not give it
  ...r,
  from: Object.freeze(r.from), cases: Object.freeze(r.cases), states: Object.freeze(r.states),
  to: Array.isArray(r.to) ? Object.freeze(r.to) : r.to,
});

const CARRIER_HANDOFFS = Object.freeze({
  // PriFly launches: departure control works Case II and III (ADR 0155, 0156).
  // assignsCode: a Case I jet that trapped and is launched again in Case II/III has no squawk yet (ADR 0157).
  LAUNCH_TO_DEPARTURE: _row({
    label: 'LAUNCHED', from: ['CV_PRIFLY'], to: ['CV_DEP'], cases: SEQUENCED, caseOf: 'SHIP',
    stripType: 'CV_LAUNCH', states: ['ON_DECK'], toStripType: 'CV_LAUNCH', toState: 'CV_AIRBORNE', assignsCode: true,
  }),
  // A launch handed to the Marshal is the flight's recovery from then on, in place: same Strip, flight, squawk.
  LAUNCH_TO_MARSHAL: _row({
    label: 'TO MARSHAL', from: ['CV_PRIFLY'], to: ['CV_MARSHAL'], cases: ['I'], caseOf: 'SHIP',
    stripType: 'CV_LAUNCH', states: ['ON_DECK'], toStripType: 'CV_RECOVERY', toState: 'STACK', stackEffect: 'APPEND',
  }),
  DEPARTURE_TO_MARSHAL: _row({
    label: 'TO MARSHAL', from: ['CV_DEP'], to: ['CV_MARSHAL'], cases: ANY_CASE, caseOf: 'SHIP',
    stripType: 'CV_LAUNCH', states: ['CV_AIRBORNE', 'KILO'], toStripType: 'CV_RECOVERY', toState: 'STACK', stackEffect: 'APPEND',
  }),
  COMMENCE: _row({
    label: 'COMMENCE', from: ['CV_MARSHAL'], to: 'SAME', cases: SEQUENCED, caseOf: 'FLIGHT',
    stripType: 'CV_RECOVERY', states: ['STACK'], toStripType: 'CV_RECOVERY', toState: 'COMMENCED', stackEffect: 'MARK_PUSHED',
  }),
  // The lanes are fed alternately in push order (H30, laneFor below); the Marshal may name the other lane.
  TO_APPROACH: _row({
    label: 'TO APPR', from: ['CV_MARSHAL'], to: APP_LANES, cases: SEQUENCED, caseOf: 'FLIGHT',
    stripType: 'CV_RECOVERY', states: ['COMMENCED'], toStripType: 'CV_RECOVERY', toState: 'FINAL_APPROACH',
  }),
  // Case I has no pattern, only the overhead stack: Signal Charlie clears the flight to land, and PriFly has it (ADR 0157).
  CASE_I_TO_PRIFLY: _row({
    label: 'SGNL C', from: ['CV_MARSHAL'], to: ['CV_PRIFLY'], cases: ['I'], caseOf: 'FLIGHT',
    stripType: 'CV_RECOVERY', states: ['STACK'], toStripType: 'CV_RECOVERY', toState: 'SIGNAL_CHARLIE',
  }),
  // The end of an approach (ADR 0157). TRAPPED is the landing: the jet is on deck, PriFly's, and the Strip becomes a launch
  // in place (same Strip, flight and squawk), the inverse of LAUNCH_TO_MARSHAL; the flight leaves its stack (a vacancy, no
  // close-up, H28). BOLTER keeps it where it is: the lane's, in the pattern (Case II/III), or PriFly's, still cleared to
  // land (Case I).
  TRAPPED: _row({
    label: 'TRAPPED', from: APP_LANES, to: ['CV_PRIFLY'], cases: SEQUENCED, caseOf: 'FLIGHT',
    stripType: 'CV_RECOVERY', states: ['BULLSEYE', 'CV_PATTERN'], toStripType: 'CV_LAUNCH', toState: 'ON_DECK',
    stackEffect: 'REMOVE_NO_CLOSE_UP', clearsAssignments: true,
  }),
  BOLTER: _row({
    label: 'BOLTER', from: APP_LANES, to: 'SAME', cases: SEQUENCED, caseOf: 'FLIGHT',
    stripType: 'CV_RECOVERY', states: ['BULLSEYE', 'CV_PATTERN'], toStripType: 'CV_RECOVERY', toState: 'CV_PATTERN',
  }),
  CASE_I_TRAPPED: _row({
    label: 'TRAPPED', from: ['CV_PRIFLY'], to: 'SAME', cases: ['I'], caseOf: 'FLIGHT',
    stripType: 'CV_RECOVERY', states: ['SIGNAL_CHARLIE'], toStripType: 'CV_LAUNCH', toState: 'ON_DECK',
    stackEffect: 'REMOVE_NO_CLOSE_UP',
  }),
  CASE_I_BOLTER: _row({
    label: 'BOLTER', from: ['CV_PRIFLY'], to: 'SAME', cases: ['I'], caseOf: 'FLIGHT',
    stripType: 'CV_RECOVERY', states: ['SIGNAL_CHARLIE'], toStripType: 'CV_RECOVERY', toState: 'SIGNAL_CHARLIE',
  }),
  // Back to stack: the Marshal from COMMENCED on, the lane from its own approach. The flight starts afresh (next free slot,
  // new EAT, nothing the Marshal assigned by hand, no heading, speed or altitude). Not from BULLSEYE or the pattern.
  RETURN_TO_STACK: _row({
    label: 'BACK TO STACK', from: ['CV_MARSHAL', ...APP_LANES], to: ['CV_MARSHAL'], cases: SEQUENCED, caseOf: 'FLIGHT',
    stripType: 'CV_RECOVERY', states: ['COMMENCED', 'FINAL_APPROACH', 'DIRTY'], toStripType: 'CV_RECOVERY', toState: 'STACK',
    stackEffect: 'RETURN_TO_STACK', clearsAssignments: true,
  }),
  // A Case I flight that cannot finish Case I (the weather went): the Marshal sends it to the Case II/III stack, from the
  // stack or once cleared to land (ADR 0157: SIGNAL_CHARLIE, PriFly's, which permission.js mayActBesideOwner lets him).
  ABORT_TO_STACK: _row({
    label: 'ABORT TO CASE II/III', from: ['CV_MARSHAL'], to: ['CV_MARSHAL'], cases: SEQUENCED, caseOf: 'SHIP',
    flightCases: ['I'],
    stripType: 'CV_RECOVERY', states: ['STACK', 'SIGNAL_CHARLIE'], toStripType: 'CV_RECOVERY', toState: 'STACK',
    stackEffect: 'RECASE_TO_STACK', clearsAssignments: true, assignsCode: true,
  }),
});

function _fail(detail) {
  return { ok: false, reason: 'VALIDATION_ERROR', detail };
}

/**
 * Is this handoff legal in this Case, from this Position, to that one? `shipCase` is the ship's, `flightCase` the flight's
 * (carrier/strip-types.js flightCaseOf); the row's `caseOf` says which one its `cases` are about, and `flightCases`, when
 * a row has it, holds the flight's Case too. `to: 'SAME'` means the sender keeps the Strip (toPositionId may be omitted).
 * @returns {{ok:true, transfer:object} | {ok:false, reason:'VALIDATION_ERROR', detail:string}}
 */
function validateCarrierHandoff(kind, { shipCase, flightCase, fromPositionId, toPositionId = null } = {}) {
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(CARRIER_HANDOFFS, kind)) {
    return _fail(`unknown carrier transfer '${kind}'`);
  }
  const t = CARRIER_HANDOFFS[kind];
  const caseValue = t.caseOf === 'SHIP' ? shipCase : flightCase;
  if (!t.cases.includes(caseValue)) {
    const whose = t.caseOf === 'SHIP' ? 'the ship is in' : 'the flight is flying';
    return _fail(`${t.label} is a Case ${t.cases.join('/')} transfer; ${whose} Case ${caseValue ?? 'unknown'}`);
  }
  if (t.flightCases && !t.flightCases.includes(flightCase)) {
    return _fail(`${t.label} is for a Case ${t.flightCases.join('/')} flight; this one is flying Case ${flightCase ?? 'unknown'}`);
  }
  if (!t.from.includes(fromPositionId)) {
    return _fail(`${t.label} is sent by ${t.from.join(' or ')}, not ${fromPositionId ?? 'nobody'}`);
  }
  if (t.to === 'SAME') {
    if (toPositionId != null && toPositionId !== fromPositionId) {
      return _fail(`${t.label} stays with ${fromPositionId}; it does not go to ${toPositionId}`);
    }
  } else if (!t.to.includes(toPositionId)) {
    return _fail(`${t.label} goes to ${t.to.join(' or ')}, not ${toPositionId ?? 'nobody'}`);
  }
  return { ok: true, transfer: t };
}

/**
 * §9.12: "Feed them alternately from the Marshal stack in push order."
 * Even push ordinal → CV_APP1, odd → CV_APP2 ([SOURCE-DEFINED] parity, guide
 * OQ8). If the preferred lane is unstaffed, the other; if neither is, null —
 * the NLA inhibits with nla.js's existing "no receiving Position present".
 * @param {number} pushOrdinal  0-based place in push order
 * @param {{isStaffed:(positionId:string)=>boolean}} ctx
 */
function laneFor(pushOrdinal, { isStaffed = () => true } = {}) {
  if (!Number.isInteger(pushOrdinal) || pushOrdinal < 0) return null;
  const preferred = APP_LANES[pushOrdinal % 2];
  const other = APP_LANES[(pushOrdinal + 1) % 2];
  const occ = (p) => {
    try { return isStaffed(p) === true; } catch { return false; }
  };
  if (occ(preferred)) return preferred;
  if (occ(other)) return other;
  return null;
}

/**
 * Lanes for the entries of a derived stack, in push order. The push
 * ordinal is each entry's rank in the stack (PUSHED entries still in the
 * stack count, so a flight's lane does not flip when the one below it
 * commences; vacancies do not count, so the alternation survives a gap).
 * @param {Array<{flightDataId, stackIndex, status}>} derivedStack  marshal-stack.deriveStack() output
 * @returns {Array<{flightDataId:string, pushOrdinal:number, lane:string|null}>}
 */
function assignLanes(derivedStack, { isStaffed = () => true } = {}) {
  const list = Array.isArray(derivedStack) ? derivedStack.filter((d) => d && Number.isInteger(d.stackIndex)) : [];
  const ordered = list.slice().sort((a, b) => a.stackIndex - b.stackIndex);
  const out = [];
  ordered.forEach((d, i) => {
    // docs/adr/0156: a commenced flight is still the Marshal's (TO APPR hands it to its lane), so it keeps its lane.
    out.push({ flightDataId: d.flightDataId, pushOrdinal: i, lane: laneFor(i, { isStaffed }) });
  });
  return out;
}

module.exports = {
  TRIGGER_TYPES,
  APP_LANES,
  CARRIER_HANDOFFS,
  validateCarrierHandoff,
  laneFor,
  assignLanes,
};
