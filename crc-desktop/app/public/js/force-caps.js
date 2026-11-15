'use strict';
// Forced capitals (lane U-STRIP-FACE, Decision Desk SF-Q1 a): every text field whose value ends up on a Strip is typed in
// capitals, remarks included. The VALUE is uppercased as it is typed (or pasted), not just drawn in capitals by CSS, so what
// is sent is what the controller saw. The caret and the selection stay where they were. A leaf module: it imports nothing.
//
// Only typing changes the value: a field opened on an old lowercase value keeps it until the controller types into it, so
// opening and committing an untouched editor is still the no-op it was.

/** Uppercase `el.value` in place, keeping the selection. Exported for the tests. */
export function upperKeepingCaret(el) {
  const value = String(el.value == null ? '' : el.value);
  const upper = value.toUpperCase();
  if (upper === value) return false;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const direction = el.selectionDirection;
  el.value = upper;
  // A few letters grow when uppercased (ß -> SS), so the offsets are those of the uppercased prefix.
  if (typeof start === 'number' && typeof end === 'number' && typeof el.setSelectionRange === 'function') {
    el.setSelectionRange(value.slice(0, start).toUpperCase().length, value.slice(0, end).toUpperCase().length, direction || undefined);
  }
  return true;
}

/**
 * Makes an <input> or <textarea> type in capitals. Idempotent; returns `el`. The listener is a capture listener, and on
 * the target itself capture listeners run before the others, so every other 'input' listener (a draft keeper, a preview)
 * reads the uppercased value whichever was added first.
 */
export function forceCaps(el) {
  if (!el || !el.addEventListener || (el.dataset && el.dataset.forceCaps === '1')) return el;
  if (el.dataset) el.dataset.forceCaps = '1';
  // An IME composition is left alone until it ends; uppercasing mid-composition breaks it.
  el.addEventListener('input', (e) => { if (!(e && e.isComposing)) upperKeepingCaret(el); }, true);
  el.addEventListener('compositionend', () => upperKeepingCaret(el), true);
  return el;
}
