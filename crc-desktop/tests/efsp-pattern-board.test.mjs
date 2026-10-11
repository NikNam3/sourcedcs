/* The pattern board (§4.2, §4.1 rule 4), against stand-in data. (The FINAL talk-down component that shared this file was replaced
 * by the PAR panel, docs/wip/PAR-2.md; its tests are tests/par-panel.test.mjs.)
 *
 * The case that carries the deliverable: the pattern board advises and never refuses, and never hides a Strip whose rack is not a leg.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './helpers/client-env.mjs';
import domStub from './helpers/dom-stub.js';
import * as P from '../app/public/js/panels/efsp/pattern-board.js';

const { makeElement, descendants } = domStub;
const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../app/public/js/panels/efsp');

const doc = { createElement: makeElement };
const click = (el) => (el._listeners.click || []).forEach(fn => fn({}));

// ---- pattern board --------------------------------------------------------------------------

const strips = [
  { stripId: 'a', callsign: 'VIPR 11', type: 'F-16', intent: 'FULL_STOP', legId: 'initial', enteredPatternS: 800, order: 1 },
  { stripId: 'b', callsign: 'HAWG 41', type: 'A-10', intent: 'LOW_APPROACH', legId: 'initial', enteredPatternS: 700, order: 2 },
  { stripId: 'c', callsign: 'RAGE 31', type: 'F-16', intent: 'TOUCH_AND_GO', legId: 'final', enteredPatternS: 900, order: 1 },
  { stripId: 'd', callsign: 'PACK 61', type: 'F-15E', intent: 'TOUCH_AND_GO', legId: 'final', enteredPatternS: 100, order: 2 },
];

test('the board has one column per leg, chips in rack order, minutes from the mission clock', () => {
  const m = P.patternBoardModel({ legs: P.RSU_LEGS, strips, nowS: 1000 });
  assert.deepEqual(m.columns.map(c => [c.legId, c.count]), [['closed', 0], ['initial', 2], ['base', 0], ['final', 2]]);
  assert.deepEqual(m.columns[1].chips.map(c => c.callsign), ['VIPR 11', 'HAWG 41']);
  assert.equal(m.columns[1].chips[0].minutes, 3);
  assert.equal(m.columns[1].chips[0].intent, 'Full stop');
  assert.equal(m.total, 4);
});

test('advisories: crowded final and long in pattern; never anything that refuses', () => {
  const m = P.patternBoardModel({ legs: P.RSU_LEGS, strips, nowS: 1000 });
  assert.deepEqual(m.advisories.map(a => a.kind), ['CROWDED_FINAL', 'LONG_IN_PATTERN']);
  assert.match(m.advisories[0].text, /^2 on final: advisory/);
  assert.match(m.advisories[1].text, /^PACK 61 15 min in pattern/);
  assert.ok(!m.columns.some(c => c.chips.some(x => x.refused)), 'nothing on the board carries a refusal');
});

test('a closed or suspended runway with aircraft in the pattern is advised, an empty pattern is not', () => {
  assert.ok(P.patternBoardModel({ legs: P.RSU_LEGS, strips, nowS: 1000, runwayOpenStatus: 'SUSPENDED' })
    .advisories.some(a => a.kind === 'RUNWAY_NOT_OPEN'));
  assert.deepEqual(P.patternBoardModel({ legs: P.RSU_LEGS, strips: [], nowS: 1000, runwayOpenStatus: 'CLOSED' }).advisories, []);
});

test('a Strip whose rack is not a leg is shown as UNPLACED, never hidden', () => {
  const m = P.patternBoardModel({ legs: P.RSU_LEGS, strips: [{ stripId: 'x', callsign: 'LOST 1', legId: 'main' }], nowS: 0 });
  const un = m.columns.find(c => c.legId === P.UNPLACED_LEG);
  assert.deepEqual(un.chips.map(c => c.callsign), ['LOST 1']);
  assert.equal(m.total, 1);
});

test('PriFly uses the same component with its own legs, and a missing clock gives no minutes', () => {
  assert.deepEqual(P.PRIFLY_LEGS.map(l => l.id), ['initial', 'break', 'downwind', 'groove']);
  const m = P.patternBoardModel({ legs: P.PRIFLY_LEGS, strips: [{ stripId: 'x', callsign: 'A', legId: 'groove', enteredPatternS: 5 }] });
  assert.equal(m.columns[3].chips[0].minutes, null);
  assert.equal(m.columns[3].chips[0].long, false);
});

test('moves are descriptions: next-leg, and the last leg has none', () => {
  assert.equal(P.nextLeg(P.RSU_LEGS, 'initial'), 'base');
  assert.equal(P.nextLeg(P.RSU_LEGS, 'final'), null);
  assert.deepEqual(P.moveToLeg('a', 'base'), { kind: 'MoveToLeg', stripId: 'a', rackId: 'base' });
});

test('rendered board: next-leg, drop and the two chip actions send the right descriptions', () => {
  const moves = []; const acts = [];
  const m = P.patternBoardModel({ legs: P.RSU_LEGS, strips: [strips[0]], nowS: 1000 });
  const root = P.renderPatternBoard(m, { doc, legs: P.RSU_LEGS, onMove: x => moves.push(x), onAction: x => acts.push(x) });
  const all = descendants(root);
  const next = all.find(n => n.className === 'efsp-pattern-next');
  click(next);
  const landed = all.find(n => n.dataset.action === 'LANDED');
  const drop = all.find(n => n.dataset.action === 'DROP');
  click(landed); click(drop);
  const baseLeg = all.find(n => n.dataset.leg === 'base');
  baseLeg._listeners.drop.forEach(fn => fn({ preventDefault() {}, dataTransfer: { getData: () => 'a' } }));
  assert.deepEqual(moves, [{ kind: 'MoveToLeg', stripId: 'a', rackId: 'base' }, { kind: 'MoveToLeg', stripId: 'a', rackId: 'base' }]);
  assert.deepEqual(acts, [
    { stripId: 'a', id: 'LANDED', toState: 'RECOVERED' },
    { stripId: 'a', id: 'DROP', toState: 'DROPPED' },
  ]);
  assert.equal(all.filter(n => n.className === 'efsp-pattern-leg').length, 4);
});

test('the pattern board does not read the wall clock (H11)', () => {
  for (const f of ['pattern-board.js']) {
    const src = fs.readFileSync(path.join(CLIENT, f), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/Date\.now|new Date\(/.test(src), `${f} reads the wall clock`);
  }
});
