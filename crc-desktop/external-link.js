'use strict';

// Which links the renderer may hand to the user's own browser (S-2PA0), pulled out of main.js so it can be unit tested
// without Electron (the lxsrs-setup.js pattern: `require('electron')` outside a running Electron process is a path string).
//
// The window-open handler denies every `window.open`. The one thing it opens is the booking page crc-sync names in
// `efsp-airspace-calendar.bookingUrl`: the renderer reports that URL (`allow`), and only a URL whose ORIGIN equals its
// origin is opened (`canOpen`). Anything else (another origin, a lookalike host such as sourcedcs.page.evil.com, a
// `javascript:`, `file:` or `data:` URL, userinfo tricks, a malformed string) stays denied. With no booking URL
// known, nothing is opened.
//
// The "Update required" overlay (crc-sync docs/adr/0103) shows the download page named in the `update-required` frame
// (`CRCSYNC_DOWNLOAD_URL`). The renderer reports that URL too (`allowDownload`), and its exact origin joins the booking
// origin. The two are held separately, so a new booking URL never forgets the download origin or the reverse.

/** The origin of an http(s) URL string, or null for anything else (a bad string, another scheme). */
function httpOriginOf(url) {
  if (typeof url !== 'string' || url.length > 2048) return null;
  let parsed;
  try { parsed = new URL(url); } catch (_) { return null; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return parsed.origin;
}

/** A gate holding the origins the renderer has reported: the booking page's and the update download page's. */
function createExternalLinkGate() {
  let allowedOrigin = null;
  let downloadOrigin = null;
  return {
    /** Remember the booking URL's origin; a value that is not an http(s) URL clears it (nothing opens). */
    allow(bookingUrl) { allowedOrigin = httpOriginOf(bookingUrl); return allowedOrigin; },
    /** Remember the origin of the `update-required` frame's download URL; a non-http(s) value (or none) clears it. */
    allowDownload(downloadUrl) { downloadOrigin = httpOriginOf(downloadUrl); return downloadOrigin; },
    /** May this URL be opened in the external browser? Exact origin match against either remembered origin. */
    canOpen(url) {
      const origin = httpOriginOf(url);
      return !!(origin && (origin === allowedOrigin || origin === downloadOrigin));
    },
    allowedOrigin() { return allowedOrigin; },
    downloadOrigin() { return downloadOrigin; },
  };
}

/**
 * Is this the Casdoor login popup the renderer may open? The endpoint is read live (the connection widget can change it
 * at runtime), and the match is the endpoint's exact origin plus the authorize path, not a string prefix: a host such as
 * `https://casdoor.example.com.evil.com` or a userinfo URL shares the prefix of a bare endpoint string but not its origin.
 */
function isCasdoorLoginUrl(url, casdoorEndpoint) {
  const endpointOrigin = httpOriginOf(casdoorEndpoint);
  const origin = httpOriginOf(url);
  if (!endpointOrigin || origin !== endpointOrigin) return false;
  try { return new URL(url).pathname === '/login/oauth/authorize'; } catch (_) { return false; }
}

/** Is this navigation staying on the local server (`http://localhost:<port>`)? */
function isLocalAppUrl(url, port) {
  return httpOriginOf(url) === `http://localhost:${port}`;
}

/** webPreferences for the Casdoor popup: no preload (so no IPC), no Node, isolated and sandboxed. */
const CASDOOR_POPUP_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true, nodeIntegration: false, sandbox: true, preload: undefined,
});

module.exports = { httpOriginOf, createExternalLinkGate, isCasdoorLoginUrl, isLocalAppUrl, CASDOOR_POPUP_WEB_PREFERENCES };
