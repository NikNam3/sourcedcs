// Forced capitals (lane U-STRIP-FACE, SF-Q1 a): a Strip field's value is uppercased as typed, the caret kept, and the
// listener runs before any other 'input' listener on the same field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { forceCaps, upperKeepingCaret } from '../app/public/js/force-caps.js';

function fakeInput(value = '') {
  const listeners = [];
  return {
    value, selectionStart: value.length, selectionEnd: value.length, selectionDirection: 'none', dataset: {},
    setSelectionRange(s, e, d) { this.selectionStart = s; this.selectionEnd = e; this.selectionDirection = d; },
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture: !!capture }); },
    // The DOM's order on the target: capture listeners first, then the rest, each in the order added.
    dispatch(type, e = {}) {
      for (const pass of [true, false]) for (const l of listeners) if (l.type === type && l.capture === pass) l.fn(e);
    },
    type(text, at = this.selectionStart) {
      this.value = this.value.slice(0, at) + text + this.value.slice(at);
      this.selectionStart = this.selectionEnd = at + text.length;
      this.dispatch('input');
    },
  };
}

test('typing lowercase puts capitals in the value', () => {
  const el = forceCaps(fakeInput());
  el.type('n123ab');
  assert.equal(el.value, 'N123AB');
});

test('the caret stays where it was when typing in the middle', () => {
  const el = forceCaps(fakeInput('KLAX DCT'));
  el.type('j', 4);
  assert.equal(el.value, 'KLAXJ DCT');
  assert.equal(el.selectionStart, 5);
  assert.equal(el.selectionEnd, 5);
});

test('a selection is kept, and a letter that grows (ß) moves the offsets with it', () => {
  const el = { value: 'straße x', selectionStart: 6, selectionEnd: 8, selectionDirection: 'forward', setSelectionRange(s, e, d) { Object.assign(this, { selectionStart: s, selectionEnd: e, selectionDirection: d }); } };
  assert.equal(upperKeepingCaret(el), true);
  assert.equal(el.value, 'STRASSE X');
  assert.deepEqual([el.selectionStart, el.selectionEnd, el.selectionDirection], [7, 9, 'forward']);
});

test('a value already in capitals is left alone (no caret move)', () => {
  const el = { value: 'FL210', selectionStart: 2, selectionEnd: 2, setSelectionRange() { throw new Error('should not move'); } };
  assert.equal(upperKeepingCaret(el), false);
});

test('an editor opened on an old lowercase value keeps it until typed into', () => {
  const el = forceCaps(fakeInput('old remark'));
  assert.equal(el.value, 'old remark');
  el.type('!');
  assert.equal(el.value, 'OLD REMARK!');
});

test('a listener added earlier (a draft keeper) still reads the uppercased value', () => {
  const el = fakeInput();
  let draft = null;
  el.addEventListener('input', () => { draft = el.value; });
  forceCaps(el);
  el.type('abc');
  assert.equal(draft, 'ABC');
});

test('an IME composition is not touched until it ends', () => {
  const el = forceCaps(fakeInput());
  el.value = 'ab';
  el.dispatch('input', { isComposing: true });
  assert.equal(el.value, 'ab');
  el.dispatch('compositionend');
  assert.equal(el.value, 'AB');
});

test('forceCaps is idempotent and tolerates a missing element', () => {
  const el = fakeInput();
  forceCaps(el); forceCaps(el);
  assert.equal(el.dataset.forceCaps, '1');
  assert.equal(forceCaps(null), null);
});
