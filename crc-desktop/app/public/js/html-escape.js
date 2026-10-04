'use strict';

// The one escaper for the few places that still build HTML from a string (DESK-TIDY-2, ARCH-C 3.2). A leaf: it imports
// nothing. Prefer `textContent` and `createElement`; where a template is genuinely clearer, every dynamic part of an
// `innerHTML` assignment goes through `escapeHtml(...)`. `tests/html-sinks.test.mjs` fails on any other interpolation.
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** @param {unknown} s @returns {string} `s` as text, safe in element content and in a quoted attribute value. */
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
