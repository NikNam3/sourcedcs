/** The rule lines (TOLD 1.8 "Rule lines"). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FigureSet } from '../src/core/data/figure-set.ts';
import { mark } from '../src/core/told/rules.ts';
import { DASH } from '../src/web/format.ts';
import { ruleLine } from '../src/web/rule-lines.ts';

import { loadFigureSet } from './helpers/data.ts';

const FIGURES: FigureSet = loadFigureSet(['B7-2.sh1']);

test('mil-roll-50', () => {
  assert.equal(
    ruleLine(mark('mil-roll-50', 'exact', { percent: 97.5 }), 'MIL', null, FIGURES),
    'MIL roll 97.5 % of runway: over 50 %, afterburner takeoff required (para. 3.6.6)',
  );
  assert.equal(
    ruleLine(mark('mil-roll-50', 'conservative', { percent: 97.5 }), 'MIL', null, FIGURES),
    'MIL conservative roll 97.5 % of runway: over 50 %, afterburner takeoff required (para. 3.6.6)',
  );
});

test('takeoff-roll-80', () => {
  assert.equal(
    ruleLine(mark('takeoff-roll-80', 'exact', { percent: 84.2 }), 'MAX AB', null, FIGURES),
    'MAX AB roll 84.2 % of runway: over 80 % (para. 3.6.3)',
  );
  assert.equal(
    ruleLine(mark('takeoff-roll-80', 'conservative', { percent: 84.24 }), 'MIL', null, FIGURES),
    'MIL conservative roll 84.2 % of runway: over 80 % (para. 3.6.3)',
  );
});

test('landing-roll-80', () => {
  assert.equal(
    ruleLine(mark('landing-roll-80', 'exact', { percent: 83 }), 'heavyweight wet', null, FIGURES),
    'Landing roll, heavyweight wet, 83.0 % of runway: over 80 % (para. 3.18)',
  );
  assert.equal(
    ruleLine(mark('landing-roll-80', 'conservative', { percent: 83 }), 'normal dry', null, FIGURES),
    'Landing roll, normal dry conservative, 83.0 % of runway: over 80 % (para. 3.18)',
  );
});

test('a roll rule takes the percentage from the mark only; the rcr argument is ignored, none gives a dash', () => {
  assert.equal(
    ruleLine(mark('takeoff-roll-80', 'exact', { percent: 84.2 }), 'MAX AB', 99, FIGURES),
    'MAX AB roll 84.2 % of runway: over 80 % (para. 3.6.3)',
  );
  assert.equal(
    ruleLine(mark('landing-roll-80', 'exact', { percent: 83 }), 'normal dry', 8, FIGURES),
    'Landing roll, normal dry, 83.0 % of runway: over 80 % (para. 3.18)',
  );
  assert.equal(
    ruleLine(mark('takeoff-roll-80', 'exact'), 'MAX AB', 84.2, FIGURES),
    `MAX AB roll ${DASH} % of runway: over 80 % (para. 3.6.3)`,
  );
});

test('landing-rcr-10 without an RCR: a dash', () => {
  assert.equal(
    ruleLine(mark('landing-rcr-10', 'exact', { field: 'rcrDry' }), null, null, FIGURES),
    `RCR ${DASH} at the landing field: below 10 (para. 3.18)`,
  );
});

test('landing-rcr-10: the RCR from the argument', () => {
  assert.equal(
    ruleLine(mark('landing-rcr-10', 'exact', { field: 'rcrWet' }), null, 8, FIGURES),
    'RCR 8 at the landing field: below 10 (para. 3.18)',
  );
  assert.equal(
    ruleLine(mark('landing-rcr-10', 'exact'), 'normal wet', 8, FIGURES),
    'RCR 8 at the landing field: below 10 (para. 3.18)',
  );
});

test('b7-2-limit: the limit line label from B7-2 sh. 1', () => {
  assert.equal(
    ruleLine(mark('b7-2-limit', 'exact', { line: 'brakeEnergy' }), 'heavyweight dry', null, FIGURES),
    'Landing, heavyweight dry: beyond the maximum brake energy limit (Fig. B7-2 sh. 1)',
  );
  assert.equal(
    ruleLine(mark('b7-2-limit', 'conservative', { line: 'brakeEnergy' }), 'heavyweight dry', null, FIGURES),
    'Landing, heavyweight dry conservative: beyond the maximum brake energy limit (Fig. B7-2 sh. 1)',
  );
  assert.equal(
    ruleLine(mark('b7-2-limit', 'exact', { line: 'mlgTire' }), 'normal wet', null, FIGURES),
    'Landing, normal wet: beyond the MLG tire limit speed (225 kt — no wind) (Fig. B7-2 sh. 1)',
  );
  assert.equal(
    ruleLine(mark('b7-2-limit', 'exact', { line: 'nlgTire' }), 'normal dry', null, FIGURES),
    'Landing, normal dry: beyond the NLG tire limit speed (217 kt — no wind) (Fig. B7-2 sh. 1)',
  );
});

test('b7-2-limit without the line or its data: a limit line', () => {
  assert.equal(
    ruleLine(mark('b7-2-limit', 'exact'), 'heavyweight dry', null, FIGURES),
    'Landing, heavyweight dry: beyond a limit line (Fig. B7-2 sh. 1)',
  );
  assert.equal(
    ruleLine(mark('b7-2-limit', 'exact', { line: 'brakeEnergy' }), 'heavyweight dry', null, {}),
    'Landing, heavyweight dry: beyond a limit line (Fig. B7-2 sh. 1)',
  );
});

test('no column: the generic subject', () => {
  assert.equal(
    ruleLine(mark('takeoff-roll-80', 'exact', { percent: 84.2 }), null, null, FIGURES),
    'Takeoff roll 84.2 % of runway: over 80 % (para. 3.6.3)',
  );
  assert.equal(
    ruleLine(mark('mil-roll-50', 'exact', { percent: 97.5 }), null, null, FIGURES),
    'MIL roll 97.5 % of runway: over 50 %, afterburner takeoff required (para. 3.6.6)',
  );
  assert.equal(
    ruleLine(mark('landing-roll-80', 'exact', { percent: 83 }), null, null, FIGURES),
    'Landing roll, 83.0 % of runway: over 80 % (para. 3.18)',
  );
  assert.equal(
    ruleLine(mark('b7-2-limit', 'conservative', { line: 'brakeEnergy' }), null, null, FIGURES),
    'Landing, conservative: beyond the maximum brake energy limit (Fig. B7-2 sh. 1)',
  );
});
