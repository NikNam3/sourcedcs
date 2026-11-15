/* The values the scope gestures write (docs/adr/0164): Ctrl+drag heading, Alt+wheel altitude. gesture-values.js is
 * pure; alt-preview.js is the leaf the data blocks read the preview from. */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALT_FINE_STEP_FT, ALT_STEP_FT, altitudeStart, formatAssignedAltitude, headingText, parseAssignedAltitude, roundHeading,
  shiftAltitude, wheelNotches,
} from '../app/public/js/scope-gestures/gesture-values.js';
import { altPreviewFor, clearAltPreview, setAltPreview, withAltPreview } from '../app/public/js/scope-gestures/alt-preview.js';
import { assignedPreviewText, atcAssignedText } from '../app/public/js/track-label.js';

const TA = 18000;

test('heading: nearest 5 degrees, north is 360 never 000', () => {
  assert.equal(roundHeading(47.4), 45);
  assert.equal(roundHeading(47.5), 50);
  assert.equal(roundHeading(358), 360);
  assert.equal(roundHeading(0), 360);
  assert.equal(roundHeading(2.4), 360);
  assert.equal(roundHeading(2.5), 5);
  assert.equal(roundHeading(-10), 350);
  assert.equal(roundHeading(null), null);
  assert.equal(headingText(5), '005');
  assert.equal(headingText(360), '360');
  assert.equal(headingText(null), '---');
});

test('altitude text reads like crc-sync parseAltitude: FL, A, hundreds, feet, blocks', () => {
  const ft = (t) => { const a = parseAssignedAltitude(t); return a && [a.prefix, a.lowFt, a.highFt]; };
  assert.deepEqual(ft('FL240'), ['', 24000, 24000]);
  assert.deepEqual(ft('080'), ['', 8000, 8000]);
  assert.deepEqual(ft('A050'), ['', 5000, 5000]);
  assert.deepEqual(ft('8500'), ['', 8500, 8500]);
  assert.deepEqual(ft('080B120'), ['', 8000, 12000]);
  assert.deepEqual(ft('FL220-FL240'), ['', 22000, 24000]);
  assert.deepEqual(ft('220TO240'), ['', 22000, 24000]);
  assert.equal(parseAssignedAltitude('240B220'), null);
  assert.equal(parseAssignedAltitude(''), null);
  assert.equal(parseAssignedAltitude('VFR'), null);
});

test('a leading < or > is kept and only the number moves (the altitude-limit syntax)', () => {
  const below = parseAssignedAltitude('<FL240');
  assert.deepEqual([below.prefix, below.lowFt, below.highFt], ['<', 24000, 24000]);
  assert.equal(formatAssignedAltitude(shiftAltitude(below, 1, ALT_STEP_FT), TA), '<FL250');
  // Below the transition altitude the typed form is kept (U-ALT-LIMITS): <080 shifts to <090.
  assert.equal(formatAssignedAltitude(shiftAltitude(parseAssignedAltitude('<080'), 1, ALT_STEP_FT), TA), '<090');
  assert.equal(formatAssignedAltitude(shiftAltitude(parseAssignedAltitude('>080'), -2, ALT_STEP_FT), TA), '>060');
  assert.equal(formatAssignedAltitude(shiftAltitude(parseAssignedAltitude('>8000'), -2, ALT_STEP_FT), TA), '>6000');
  assert.equal(formatAssignedAltitude(shiftAltitude(parseAssignedAltitude('A050'), 1, ALT_STEP_FT), TA), 'A060');
  // Climbing through the transition altitude: a flight level.
  assert.equal(formatAssignedAltitude(shiftAltitude(parseAssignedAltitude('170'), 1, ALT_STEP_FT), TA), 'FL180');
  assert.equal(formatAssignedAltitude(shiftAltitude(parseAssignedAltitude('080'), 1, ALT_FINE_STEP_FT), TA), '081');
});

test('a limit stored without its text starts from its one end (U-ALT-LIMITS shape)', () => {
  const pick = (a) => [a.prefix, a.lowFt, a.highFt];
  assert.deepEqual(pick(altitudeStart({ value: '', parsed: null, block: { lowFt: null, highFt: 9000 } }, null, ALT_STEP_FT)), ['<', 9000, 9000]);
  assert.deepEqual(pick(altitudeStart({ value: '', parsed: null, block: { lowFt: 25000, highFt: null } }, null, ALT_STEP_FT)), ['>', 25000, 25000]);
  assert.deepEqual(pick(altitudeStart({ value: '>FL250', parsed: null, block: { lowFt: 25000, highFt: null } }, null, ALT_STEP_FT)), ['>', 25000, 25000]);
});

test('the strip\'s text: FL at and above the transition altitude, feet below, a block low-high', () => {
  assert.equal(formatAssignedAltitude({ lowFt: 18000, highFt: 18000 }, TA), 'FL180');
  assert.equal(formatAssignedAltitude({ lowFt: 17000, highFt: 17000 }, TA), '17000');
  assert.equal(formatAssignedAltitude({ lowFt: 9000, highFt: 9000 }, 10000), '9000');
  assert.equal(formatAssignedAltitude({ lowFt: 10000, highFt: 10000 }, 10000), 'FL100');
  assert.equal(formatAssignedAltitude({ lowFt: 8000, highFt: 12000 }, TA), '8000-12000');
  assert.equal(formatAssignedAltitude({ lowFt: 16000, highFt: 20000 }, TA), '16000-FL200');
});

test('a block moves as a whole and keeps its height', () => {
  const b = parseAssignedAltitude('080B120');
  const up = shiftAltitude(b, 1, ALT_STEP_FT);
  assert.deepEqual([up.lowFt, up.highFt], [9000, 13000]);
  const fine = shiftAltitude(b, -3, ALT_FINE_STEP_FT);
  assert.deepEqual([fine.lowFt, fine.highFt], [7700, 11700]);
});

test('a move that leaves the strip\'s range is not made', () => {
  const low = { prefix: '', lowFt: 1000, highFt: 1000 };
  assert.equal(shiftAltitude(low, -1, ALT_STEP_FT), low);
  const high = { prefix: '', lowFt: 99000, highFt: 99000 };
  assert.equal(shiftAltitude(high, 1, ALT_STEP_FT), high);
  assert.equal(shiftAltitude(high, 9, ALT_FINE_STEP_FT).lowFt, 99900);
});

test('the start: the assigned altitude, else the current altitude rounded to the step', () => {
  const pick = (a) => [a.prefix, a.lowFt, a.highFt];
  assert.deepEqual(pick(altitudeStart({ value: '080B120', parsed: null, block: { lowFt: 8000, highFt: 12000 } }, 15000, ALT_STEP_FT)), ['', 8000, 12000]);
  // Not rounded: the wheel moves the assigned value by whole steps from where it is.
  assert.deepEqual(pick(altitudeStart({ value: '8550', parsed: 8550 }, 15000, ALT_STEP_FT)), ['', 8550, 8550]);
  // The stored numbers when the text is not one this client reads.
  assert.deepEqual(altitudeStart({ value: '???', parsed: 7000 }, null, ALT_STEP_FT), { prefix: '', lowFt: 7000, highFt: 7000 });
  assert.deepEqual(altitudeStart(null, 12480, ALT_STEP_FT), { prefix: '', lowFt: 12000, highFt: 12000 });
  assert.deepEqual(altitudeStart(null, 12480, ALT_FINE_STEP_FT), { prefix: '', lowFt: 12500, highFt: 12500 });
  assert.equal(altitudeStart(null, null, ALT_STEP_FT), null);
});

test('wheel notches: one per mouse-wheel event, touchpad deltas add up, up climbs', () => {
  assert.deepEqual(wheelNotches(0, -100), { notches: 1, acc: 0 });
  assert.deepEqual(wheelNotches(0, 53), { notches: -1, acc: 0 });
  assert.deepEqual(wheelNotches(0, 120), { notches: -1, acc: 0 });
  assert.deepEqual(wheelNotches(0, 0, -100), { notches: 1, acc: 0 }, 'Shift+wheel arrives as deltaX');
  assert.deepEqual(wheelNotches(0, -3, 0, 1), { notches: 1, acc: 0 }, 'lines');
  let r = wheelNotches(0, -30);
  assert.equal(r.notches, 0);
  r = wheelNotches(r.acc, -30); r = wheelNotches(r.acc, -30);
  assert.equal(r.notches, 0);
  r = wheelNotches(r.acc, -30);
  assert.deepEqual(r, { notches: 1, acc: 0 });
});

test('the preview stands in for the assigned altitude on that contact only, marked ?', () => {
  clearAltPreview();
  const assigned = { altFt: 8000, altBlock: null, hdg: 250 };
  assert.equal(withAltPreview('t1', assigned), assigned);
  setAltPreview('t1', { lowFt: 9000, highFt: 9000 });
  assert.ok(altPreviewFor('t1'));
  assert.equal(altPreviewFor('t2'), null);
  const shown = withAltPreview('t1', assigned);
  assert.deepEqual(shown, { altFt: 9000, altBlock: null, hdg: 250, altPreview: true });
  assert.equal(atcAssignedText(shown, 12000), 'A090? H250');
  setAltPreview('t1', { lowFt: 9000, highFt: 13000 });
  assert.equal(assignedPreviewText(withAltPreview('t1', null)), 'A090B130?');
  clearAltPreview();
  assert.equal(altPreviewFor('t1'), null);
});
