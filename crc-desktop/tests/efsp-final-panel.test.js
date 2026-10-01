'use strict';

/* The FINAL component (guide §7.10) and the pattern board (§4.2, §4.1 rule 4), against stand-in data.
 * Panel code only: no Position carries either yet (docs/wip/L18.md, the server half).
 *
 * The cases that carry the deliverable:
 *   - FINAL renders NO input, select or textarea (§7.10: no data entry during the approach);
 *   - a required call is a CROSSING, so one sample, or a missing field, never prompts;
 *   - PAR and carrier share one component and differ only in labels, not in target state;
 *   - the pattern board advises and never refuses, and never hides a Strip whose rack is not a leg.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeElement, descendants } = require('./helpers/dom-stub');

const CLIENT = path.join(__dirname, '../app/public/js/panels/efsp');
const F = require(path.join(CLIENT, 'final-panel.js'));
const P = require(path.join(CLIENT, 'pattern-board.js'));

const doc = { createElement: makeElement };
const click = (el) => (el._listeners.click || []).forEach(fn => fn({}));

// ---- FINAL ----------------------------------------------------------------------------------

const par = (over) => ({ kind: 'PAR', stripId: 's1', callsign: 'VIPR 11', runway: '23', decisionAltFt: 1250,
  distanceNm: 4.2, altitudeFt: 1600, glidepathDevDeg: 0.1, nowS: 100, cadenceOriginS: 100, ...over });

test('a mile call falls due when the distance crosses an integer, and only then', () => {
  assert.deepEqual(F.finalCallsDue(par({ distanceNm: 3.1 }), par({ distanceNm: 2.9 })), [{ kind: 'MILE', miles: 3 }]);
  assert.deepEqual(F.finalCallsDue(par({ distanceNm: 3.5 }), par({ distanceNm: 3.2 })), []);
  assert.deepEqual(F.finalCallsDue(par({ distanceNm: 1.2 }), par({ distanceNm: 0.8 })), [{ kind: 'MILE', miles: 1 }]);
  assert.equal(F.promptText({ kind: 'MILE', miles: 1 }), 'Mile call: 1 mile');
});

test('no previous sample, or a missing field, prompts nothing', () => {
  assert.deepEqual(F.finalCallsDue(null, par()), []);
  assert.deepEqual(F.finalCallsDue(par({ glidepathDevDeg: undefined }), par({ glidepathDevDeg: 1.5 })), []);
  assert.deepEqual(F.finalCallsDue(par({ altitudeFt: undefined }), par({ altitudeFt: 1000 }), { decisionAltFt: 1250 }), []);
});

test('decision altitude, glidepath interception and trend deviation', () => {
  assert.deepEqual(F.finalCallsDue(par({ altitudeFt: 1300 }), par({ altitudeFt: 1240 }), { decisionAltFt: 1250 }),
    [{ kind: 'DECISION_ALTITUDE' }]);
  assert.deepEqual(F.finalCallsDue(par({ glidepathDevDeg: 0.8 }), par({ glidepathDevDeg: 0.2 })),
    [{ kind: 'GLIDEPATH_INTERCEPT' }]);
  assert.deepEqual(F.finalCallsDue(par({ glidepathDevDeg: 0.4 }), par({ glidepathDevDeg: 0.6 })),
    [{ kind: 'TREND_DEVIATION' }]);
  // Inside tolerance a wobble is not a trend.
  assert.deepEqual(F.finalCallsDue(par({ glidepathDevDeg: 0.0 }), par({ glidepathDevDeg: 0.25 })), []);
});

test('the most urgent call wins when two fall due in one sample', () => {
  const calls = F.finalCallsDue(par({ distanceNm: 1.1, altitudeFt: 1300 }), par({ distanceNm: 0.9, altitudeFt: 1240 }),
    { decisionAltFt: 1250 });
  assert.deepEqual(calls.map(c => c.kind), ['DECISION_ALTITUDE', 'MILE']);
});

test('the tracker holds a prompt for 4 s of mission clock, then clears it', () => {
  const t = F.createFinalTracker();
  assert.equal(t.update(par({ distanceNm: 3.1, nowS: 100 })).prompt, null);
  assert.equal(t.update(par({ distanceNm: 2.9, nowS: 105 })).prompt.text, 'Mile call: 3 miles');
  assert.equal(t.update(par({ distanceNm: 2.8, nowS: 108 })).prompt.text, 'Mile call: 3 miles');
  assert.equal(t.update(par({ distanceNm: 2.7, nowS: 109 })).prompt, null);
});

test('the cadence is a 5 s metronome off the mission clock, and survives a missing clock', () => {
  assert.deepEqual(F.cadenceAt(102.5, 100), { phase: 0.5, nextInS: 2.5 });
  assert.equal(F.cadenceAt(110, 100).phase, 0);
  assert.deepEqual(F.cadenceAt(undefined, 0), { phase: 0, nextInS: 5 });
  assert.equal(F.cadenceAt(98, 100).phase, 0.6, 'a clock before the origin wraps, never goes negative');
});

test('figures format, and a missing value reads as -- rather than NaN', () => {
  const vm = F.finalViewModel(par({ distanceNm: 4.24, decisionAltFt: 1250 }), null);
  assert.equal(vm.distance, '4.2 nm');
  assert.equal(vm.decisionAlt, '1,250');
  assert.equal(vm.deviation, 'ON (+0.1°)');
  const blank = F.finalViewModel({ kind: 'PAR' }, null);
  assert.deepEqual([blank.distance, blank.decisionAlt, blank.deviation, blank.runway], ['--', '--', '--', '--']);
  assert.equal(F.formatDeviation(0.9), 'ABOVE 0.9°');
  assert.equal(F.formatDeviation(-0.9), 'BELOW 0.9°');
});

test('PAR and the carrier share target states and differ only in labels', () => {
  const p = F.terminalActionsFor('PAR');
  const c = F.terminalActionsFor('CARRIER');
  assert.deepEqual(p.map(a => a.toState), c.map(a => a.toState));
  assert.deepEqual(p.map(a => a.toState), ['BALL', 'BOLTER_WAVEOFF']);
  assert.deepEqual(p.map(a => a.label), ['Landing assured', 'Missed approach']);
  assert.deepEqual(c.map(a => a.label), ['Ball', 'Waveoff']);
  // Every target is a state the FINAL Role already owns (ADR 0064 B2); no new state is invented here.
  for (const a of [...p, ...c]) assert.ok(['ON_FINAL', 'BALL', 'BOLTER_WAVEOFF', 'DROPPED'].includes(a.toState));
});

test('the rendered FINAL has no input at all, and exactly the two terminal buttons', () => {
  const sent = [];
  const root = F.renderFinalPanel(F.finalViewModel(par(), null), { doc, onTerminal: (x) => sent.push(x) });
  const all = descendants(root);
  const bad = all.filter(n => ['input', 'select', 'textarea'].includes(n.tagName));
  assert.deepEqual(bad, [], 'guide 7.10: MUST NOT require any data entry during the approach');
  const buttons = all.filter(n => n.tagName === 'button');
  assert.deepEqual(buttons.map(b => b.dataset.terminal), ['ASSURED', 'MISSED']);
  click(buttons[0]);
  click(buttons[1]);
  assert.deepEqual(sent, [
    { stripId: 's1', id: 'ASSURED', toState: 'BALL' },
    { stripId: 's1', id: 'MISSED', toState: 'BOLTER_WAVEOFF' },
  ]);
});

test('the carrier render says Deck, not Runway, and shows the prompt when one is due', () => {
  const vm = F.finalViewModel(par({ kind: 'CARRIER', runway: 'CVN-72' }), { kind: 'MILE', text: 'Mile call: 2 miles' });
  const texts = descendants(F.renderFinalPanel(vm, { doc })).map(n => n.textContent);
  assert.ok(texts.includes('Deck'));
  assert.ok(texts.includes('Mile call: 2 miles'));
  assert.ok(!texts.includes('Runway'));
});

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
  assert.ok(P.patternBoardModel({ legs: P.RSU_LEGS, strips, nowS: 1000, runwayStatus: 'SUSPENDED' })
    .advisories.some(a => a.kind === 'RUNWAY_NOT_OPEN'));
  assert.deepEqual(P.patternBoardModel({ legs: P.RSU_LEGS, strips: [], nowS: 1000, runwayStatus: 'CLOSED' }).advisories, []);
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

test('neither module reads the wall clock (H11)', () => {
  const fs = require('fs');
  for (const f of ['final-panel.js', 'pattern-board.js']) {
    const src = fs.readFileSync(path.join(CLIENT, f), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/Date\.now|new Date\(/.test(src), `${f} reads the wall clock`);
  }
});
