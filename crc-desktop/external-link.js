'use strict';

// Which links the renderer may hand to the user's own browser (S-2PA0), pulled out of main.js so it can be unit tested
// without Electron (the lxsrs-setup.js pattern: `require('electron')` outside a running Electron process is a path string).
//
// The window-open handler denies every `window.open`. The one thing it opens is the booking page crc-sync names in
// `efsp-airspace-calendar.bookingUrl`: the renderer reports that URL (`allow`), and only a URL whose ORIGIN equals its
// origin is opened (`canOpen`). Anything else (another origin, a lookalike host such as sourcedcs.page.evil.com, a
// `javascript:`, `file:` or `data:` URL, userinfo tricks, a malformed string) stays denied. With no booking URL
// known, nothing is opened.

/** The origin of an http(s) URL string, or null for anything else (a bad string, another scheme). */
function httpOriginOf(url) {
  if (typeof url !== 'string' || url.length > 2048) return null;
  let parsed;
  try { parsed = new URL(url); } catch (_) { return null; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return parsed.origin;
}

/** A gate holding the one origin the renderer has reported. */
function createExternalLinkGate() {
  let allowedOrigin = null;
  return {
    /** Remember the booking URL's origin; a value that is not an http(s) URL clears it (nothing opens). */
    allow(bookingUrl) { allowedOrigin = httpOriginOf(bookingUrl); return allowedOrigin; },
    /** May this URL be opened in the external browser? Exact origin match only. */
    canOpen(url) {
      const origin = httpOriginOf(url);
      return !!(allowedOrigin && origin && origin === allowedOrigin);
    },
    allowedOrigin() { return allowedOrigin; },
  };
}

module.exports = { httpOriginOf, createExternalLinkGate };
