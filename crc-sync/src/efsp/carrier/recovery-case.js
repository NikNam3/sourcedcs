'use strict';

// The recovery Case as a value (guide §9.12, docs/adr/0064).
//
// §9.12: "The recovery Case is global session state owned by CV_PRIFLY, and it
// reinterprets every carrier Strip simultaneously. Model it as a broadcast
// session property, never a per-Strip attribute." So the Case is ONE record
// (per hull, in L17's store), and marshal-stack.js's derivation takes it as a
// parameter — no stack entry and no Strip ever stores a Case.
//
// Provenance:
//   §9.12 (binding)  — the three Cases and their weather criteria, "all night
//                      operations" are Case III.
//   [SOURCE-DEFINED] — DEFAULT_CASE = 'III' (L4 briefing Q5: most restrictive
//                      when nothing is known); the transition table allowing
//                      every Case → every other Case.
//
// The weather floor is ADVICE, never a gate. Guide §4.1 says PriFly *sets* the
// Case; the weather inputs are not reliably available; and refusing PriFly's
// call on a model's reading of the weather would be defect D11 (fabricating
// authority). setCase() therefore never consults the weather, and
// caseAdvisory() only speaks when the set Case is LESS restrictive than the
// weather allows (docs/adr/0058's "indicators only when wrong").

const CASES = Object.freeze(['I', 'II', 'III']);

// Any Case → any other Case: PriFly may go I → III directly when weather closes
// in, and III → I at dawn. Written as a table anyway (airspace-store.js's
// LEGAL_TRANSITIONS shape), so a future restriction is one edit.
const LEGAL_CASE_TRANSITIONS = Object.freeze({
  I: Object.freeze(['II', 'III']),
  II: Object.freeze(['I', 'III']),
  III: Object.freeze(['I', 'II']),
});

const DEFAULT_CASE = 'III'; // [SOURCE-DEFINED] — L4 briefing Q5

// Restrictiveness order, for the advisory: a higher rank is more restrictive.
const RANK = Object.freeze({ I: 1, II: 2, III: 3 });

function _fail(detail) {
  return { ok: false, reason: 'VALIDATION_ERROR', detail };
}

function isCase(v) {
  return CASES.includes(v);
}

/** The record L17's store holds per hull and broadcasts. */
function initialRecoveryCase() {
  return { value: DEFAULT_CASE, setBy: null, setAt: null, history: [] };
}

/**
 * Restore path: never refuses. An unknown value becomes the default Case; a
 * missing history becomes []. (Trap T9: a restart must come up.)
 */
function normalizeRecoveryCase(raw) {
  const base = initialRecoveryCase();
  if (!raw || typeof raw !== 'object') return base;
  return {
    value: isCase(raw.value) ? raw.value : base.value,
    setBy: typeof raw.setBy === 'string' ? raw.setBy : null,
    setAt: Number.isFinite(raw.setAt) ? raw.setAt : null,
    history: Array.isArray(raw.history)
      ? raw.history.filter((h) => h && typeof h === 'object').map((h) => ({ ...h }))
      : [],
  };
}

/**
 * @param {object} current   a RecoveryCase
 * @param {string} to        'I' | 'II' | 'III'
 * @param {{by:string, at:number, note?:string}} meta  `at` is the injected mission clock's now() (decisions H11)
 * @returns {{ok:true, case:object} | {ok:false, reason:string, detail:string}}
 */
function setCase(current, to, { by = null, at = null, note = null } = {}) {
  if (!current || typeof current !== 'object' || !isCase(current.value)) {
    return _fail('current recovery Case is not a valid record');
  }
  if (!isCase(to)) return _fail(`unknown recovery Case '${to}' — must be one of ${CASES.join(', ')}`);
  if (to === current.value) return _fail(`recovery Case is already ${to} — a no-op is not a transition`);
  if (!LEGAL_CASE_TRANSITIONS[current.value].includes(to)) {
    return _fail(`Case ${current.value} → ${to} is not a legal transition`);
  }
  if (typeof at !== 'number' || !Number.isFinite(at)) {
    return _fail('`at` must be the mission clock time (epoch ms, Zulu)');
  }
  const entry = { at, by, from: current.value, to, note: note == null ? null : String(note) };
  return {
    ok: true,
    case: {
      value: to,
      setBy: by,
      setAt: at,
      history: [...(Array.isArray(current.history) ? current.history : []), entry],
    },
  };
}

function _num(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * The least restrictive Case the weather allows, from §9.12's criteria verbatim.
 * Unknown weather (any input missing or non-finite) → null. It never guesses.
 * A known `night === true` is Case III regardless of the other inputs.
 */
function caseFloor({ ceilingFt, visibilityNm, night } = {}) {
  if (night === true) return 'III';
  if (typeof night !== 'boolean' || !_num(ceilingFt) || !_num(visibilityNm)) return null;
  if (ceilingFt < 1000 || visibilityNm < 5) return 'III';
  if (ceilingFt < 3000) return 'II';
  return 'I';
}

/**
 * Advice, not a gate: non-null only when the set Case is LESS restrictive than
 * the weather floor. Unknown floor → null.
 */
function caseAdvisory(caseValue, wx) {
  if (!isCase(caseValue)) return null;
  const floor = caseFloor(wx || {});
  if (floor == null) return null;
  if (RANK[caseValue] >= RANK[floor]) return null;
  return {
    floor,
    detail: `Case ${caseValue} is set but the reported weather calls for at least Case ${floor} (§9.12 criteria)`,
  };
}

/** Case II and III recoveries are controller-sequenced; Case I is not (§9.12 rule 3). */
function isSequencedCase(caseValue) {
  return caseValue === 'II' || caseValue === 'III';
}

module.exports = {
  CASES,
  LEGAL_CASE_TRANSITIONS,
  DEFAULT_CASE,
  isCase,
  initialRecoveryCase,
  normalizeRecoveryCase,
  setCase,
  caseFloor,
  caseAdvisory,
  isSequencedCase,
};
