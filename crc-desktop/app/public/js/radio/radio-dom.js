'use strict';

// The radio panel's one DOM helper: an element with a class, text and attributes. A leaf.

/** `el('span', 'radio-freq', '275.800', { title: '...' })`. Attributes with a null or false value are left out; `value` goes
 *  last in `attrs` when it depends on `min`/`max`. */
export function el(tag, className, text, attrs = {}) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null && text !== '') e.textContent = String(text);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k === 'disabled') e.disabled = true;
    else if (k === 'value') e.value = String(v); // the property: a form control's live value
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  return e;
}
