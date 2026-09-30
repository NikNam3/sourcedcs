import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CASES, LEGAL_CASE_TRANSITIONS, DEFAULT_CASE,
  initialRecoveryCase, normalizeRecoveryCase, setCase, caseFloor, caseAdvisory, isSequencedCase,
} from '../src/efsp/carrier/recovery-case.js';

// Guide §9.12: "The recovery Case is global session state owned by CV_PRIFLY,
// and it reinterprets every carrier Strip simultaneously." docs/adr/0064.

const T = Date.UTC(2026, 8, 30, 14, 0, 0);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

test('initial Case is the [SOURCE-DEFINED] default III, unset', () => {
  assert.equal(DEFAULT_CASE, 'III');
  assert.deepEqual(initialRecoveryCase(), { value: 'III', setBy: null, setAt: null, history: [] });
});

test('every legal transition succeeds and appends one history entry', () => {
  for (const from of CASES) {
    for (const to of LEGAL_CASE_TRANSITIONS[from]) {
      const start = deepFreeze({ value: from, setBy: null, setAt: null, history: [] });
      const r = setCase(start, to, { by: 'CV_PRIFLY', at: T, note: 'wx' });
      assert.equal(r.ok, true, `${from} → ${to}`);
      assert.equal(r.case.value, to);
      assert.equal(r.case.setBy, 'CV_PRIFLY');
      assert.equal(r.case.setAt, T);
      assert.deepEqual(r.case.history, [{ at: T, by: 'CV_PRIFLY', from, to, note: 'wx' }]);
    }
  }
  // every Case reaches every other one
  for (const c of CASES) assert.equal(LEGAL_CASE_TRANSITIONS[c].length, 2);
});

test('unknown Case refused; same value refused; missing clock refused', () => {
  const c = initialRecoveryCase();
  const bad = setCase(c, 'IV', { by: 'CV_PRIFLY', at: T });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'VALIDATION_ERROR');
  const same = setCase(c, 'III', { by: 'CV_PRIFLY', at: T });
  assert.equal(same.ok, false);
  assert.match(same.detail, /no-op/);
  assert.equal(setCase(c, 'I', { by: 'CV_PRIFLY' }).ok, false, 'no Date.now() fallback');
  assert.equal(setCase(null, 'I', { at: T }).ok, false, 'never throws on bad input');
  assert.equal(setCase({ value: 'X' }, 'I', { at: T }).ok, false);
});

test('history is append-only and the input is not mutated', () => {
  const a = deepFreeze(initialRecoveryCase());
  const b = setCase(a, 'I', { by: 'CV_PRIFLY', at: T }).case;
  deepFreeze(b);
  const c = setCase(b, 'II', { by: 'CV_PRIFLY', at: T + 60_000 }).case;
  assert.equal(a.history.length, 0);
  assert.equal(b.history.length, 1);
  assert.equal(c.history.length, 2);
  assert.deepEqual(c.history[0], b.history[0]);
});

test('normalizeRecoveryCase never refuses (restore path)', () => {
  assert.deepEqual(normalizeRecoveryCase(undefined), initialRecoveryCase());
  assert.equal(normalizeRecoveryCase({ value: 'bogus' }).value, 'III');
  const kept = normalizeRecoveryCase({ value: 'I', setBy: 'CV_PRIFLY', setAt: T, history: [{ at: T, to: 'I' }] });
  assert.equal(kept.value, 'I');
  assert.equal(kept.history.length, 1);
});

test('caseFloor follows §9.12 criteria verbatim', () => {
  const rows = [
    [{ ceilingFt: 5000, visibilityNm: 10, night: true }, 'III'],   // "and all night operations"
    [{ ceilingFt: null, visibilityNm: null, night: true }, 'III'], // night alone decides
    [{ ceilingFt: 900, visibilityNm: 10, night: false }, 'III'],
    [{ ceilingFt: 5000, visibilityNm: 4, night: false }, 'III'],
    [{ ceilingFt: 2000, visibilityNm: 5, night: false }, 'II'],
    [{ ceilingFt: 1000, visibilityNm: 5, night: false }, 'II'],
    [{ ceilingFt: 3000, visibilityNm: 5, night: false }, 'I'],
    [{ ceilingFt: null, visibilityNm: 10, night: false }, null],
    [{ ceilingFt: 5000, visibilityNm: NaN, night: false }, null],
    [{ ceilingFt: 5000, visibilityNm: 10 }, null],                  // night unknown: no guess
    [{}, null],
  ];
  for (const [wx, want] of rows) assert.equal(caseFloor(wx), want, JSON.stringify(wx));
  assert.equal(caseFloor(), null);
});

test('caseAdvisory speaks only when the set Case is less restrictive than the floor', () => {
  const imc = { ceilingFt: 500, visibilityNm: 2, night: false };
  const vmc = { ceilingFt: 5000, visibilityNm: 10, night: false };
  const adv = caseAdvisory('I', imc);
  assert.notEqual(adv, null);
  assert.equal(adv.floor, 'III');
  assert.equal(caseAdvisory('II', imc).floor, 'III');
  assert.equal(caseAdvisory('III', vmc), null, 'more restrictive than needed is PriFly\'s call');
  assert.equal(caseAdvisory('I', vmc), null);
  assert.equal(caseAdvisory('I', { ceilingFt: null, visibilityNm: 1, night: false }), null, 'unknown floor → null');
  assert.equal(caseAdvisory('I', undefined), null);
});

test('setCase never consults the weather: PriFly can set I in IMC', () => {
  // the advisory flags it; the transition still happens (D11: no fabricated authority)
  const r = setCase(initialRecoveryCase(), 'I', { by: 'CV_PRIFLY', at: T });
  assert.equal(r.ok, true);
});

test('isSequencedCase: II and III are, I is not (§9.12 rule 3)', () => {
  assert.equal(isSequencedCase('I'), false);
  assert.equal(isSequencedCase('II'), true);
  assert.equal(isSequencedCase('III'), true);
  assert.equal(isSequencedCase(undefined), false);
});
