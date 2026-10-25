/* H168: the tooltip text for a Strip's left edge (strip-edge.js), and the
   precedence list held to the stylesheet's cascade. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { EDGE_PRECEDENCE, stripEdgeMarkers, stripEdgeTitle } from '../app/public/js/panels/efsp/strip-edge.js';

const CSS = fs.readFileSync(path.join(import.meta.dirname, '../app/public/css/efsp-panel.css'), 'utf8');

test('nothing on the edge, no tooltip', () => {
  assert.deepEqual(stripEdgeMarkers({ classes: ['efsp-strip'] }), []);
  assert.equal(stripEdgeTitle([]), '');
});

test('Highlight alone names the colour and the two ways to change it', () => {
  const title = stripEdgeTitle(stripEdgeMarkers({ classes: ['efsp-strip'], highlight: 'yellow' }));
  assert.match(title, /^Highlight: yellow/);
  assert.match(title, /Right-click to change, Ctrl\+click cycles/);
  assert.doesNotMatch(title, /Also/);
});

test('every edge class has its own sentence', () => {
  const cases = [
    [['efsp-strip-obligation-due'], { obligation: { obligationType: 'NOT_CHECKED_IN', severity: 'WARNING' } }, /^Obligation due: NOT CHECKED IN\. Accepted a while ago/],
    [['efsp-strip-obligation-due', 'efsp-strip-obligation-overdue'], { obligation: { obligationType: 'VOID_TIME_EXPIRED', severity: 'OVERDUE' } }, /^Obligation overdue: VOID TIME EXPIRED\./],
    [['efsp-strip-marsa-armed'], { marsaTitle: 'MARSA — declared by TEXACO11, with 1 other flight. Before rendezvous: assigning a heading or altitude VOIDS this.' }, /^MARSA armed: MARSA — declared by TEXACO11.*VOIDS this\.$/],
    [['efsp-strip-marsa-voided'], { marsaTitle: 'MARSA VOIDED — heading assigned. ATC is separating these aircraft again.' }, /^MARSA voided: .*Press Acknowledge on the Strip\.$/],
    [['efsp-strip-correlation-warned'], { correlationTitle: 'no surveillance contact matches this flight' }, /^Contact lost: no surveillance contact matches this flight\. Find the aircraft and bind it/],
    [['efsp-strip-alert'], { alertReasons: ['Conflict with VIPER12 in 1:30: closest 2.1 NM / 400 ft.'] }, /^Alert: Conflict with VIPER12 .* The edge clears by itself/],
  ];
  for (const [classes, details, re] of cases) {
    const markers = stripEdgeMarkers({ classes, ...details });
    assert.equal(markers.length, 1, classes.join(' '));
    assert.match(stripEdgeTitle(markers), re);
  }
});

test('several at once: the one drawn first, then the others, in cascade order', () => {
  const markers = stripEdgeMarkers({
    classes: ['efsp-strip-obligation-due', 'efsp-strip-correlation-warned', 'efsp-strip-alert'],
    highlight: 'cyan', obligation: { obligationType: 'ETA_REVISION', severity: 'WARNING' },
    correlationTitle: 'the contact this flight was on no longer exists', alertReasons: ['Assigned altitude 120, climbing through 135.'],
  });
  assert.deepEqual(markers.map(m => m.key), ['efsp-strip-alert', 'efsp-strip-correlation-warned', 'efsp-strip-obligation-due', 'highlight']);
  const title = stripEdgeTitle(markers);
  const lines = title.split('\n');
  assert.match(lines[0], /^Alert:/);
  assert.equal(lines[1], 'Also:');
  assert.match(lines[2], /^- Contact lost:/);
  assert.match(lines[3], /^- Obligation due: ETA REVISION\./);
  assert.match(lines[4], /^- Highlight: cyan/);
});

test('an obligation over a Highlight: the obligation is drawn (it recolours the 4px edge)', () => {
  const markers = stripEdgeMarkers({ classes: ['efsp-strip-obligation-due'], highlight: 'lime', obligation: { obligationType: 'X', severity: 'WARNING' } });
  assert.deepEqual(markers.map(m => m.key), ['efsp-strip-obligation-due', 'highlight']);
});

// The list must say what the CSS draws. One-class rules: the later one wins,
// so each must come later in the file than everything below it in the list.
test('EDGE_PRECEDENCE follows efsp-panel.css', () => {
  const ruleAt = (selectorRe) => {
    const m = CSS.match(selectorRe);
    assert.ok(m, `no rule ${selectorRe}`);
    return m.index;
  };
  const leftEdge = (cls) => ruleAt(new RegExp(`\\n\\s*\\.${cls}\\s*\\{[^}]*border-left`));
  const base = ruleAt(/\n\.efsp-strip \{[^}]*border-left: 4px solid var\(--efsp-highlight/);
  const oneClass = EDGE_PRECEDENCE.filter(k => k !== 'efsp-strip-alert' && k !== 'highlight');
  const at = oneClass.map(leftEdge);
  for (let i = 0; i + 1 < at.length; i++) {
    assert.ok(at[i] > at[i + 1], `${oneClass[i]} must be declared after ${oneClass[i + 1]}`);
  }
  assert.ok(at[at.length - 1] > base, 'every edge rule after the base Highlight edge');
  // The alert edge outranks them all by specificity (two classes), and paints the left edge.
  ruleAt(/\n\.efsp-strip\.efsp-strip-alert \{[^}]*border-color:[^}]*box-shadow: inset 3px/);
  assert.equal(EDGE_PRECEDENCE[0], 'efsp-strip-alert');
  assert.equal(EDGE_PRECEDENCE.at(-1), 'highlight');
});
