/* A browser-ish global scope for importing the CRC client modules in Node (ESM-1, S-ESM1b).
 *
 * Import it FIRST, before any client module, so its globals exist when the modules evaluate:
 *     import './helpers/client-env.mjs';
 *     import { getEfspStrip } from '../app/public/js/panels/efsp/efsp-state.js';
 * (sibling imports evaluate in order), or preload it: `node --import ./tests/helpers/client-env.mjs --test …`.
 *
 * It defines only what is missing, so a test can still replace any of it afterwards (`document.getElementById = …`,
 * `globalThis.fetch = …`). `window` is globalThis, as in the old vm sandboxes: `globalThis.getLatestTrack = …` is
 * what client code reads as `window.getLatestTrack`. Only true browser globals live here; client functions are
 * imported, and replaced through the modules' explicit setters (docs/wip/ESM-1.md, "Setters").
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeElement } = require('./dom-stub.js');

const g = globalThis;
const define = (name, value) => { if (typeof g[name] === 'undefined') g[name] = value; };

/** Swallows any property access or call: stands in for the CDN globals (maplibregl, dockview). */
export function permissive() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : permissive()),
    apply: () => permissive(),
    construct: () => permissive(),
  });
}

/** An in-memory Storage. */
export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); },
    clear: () => { m.clear(); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

define('window', g);
define('self', g);
define('addEventListener', () => {});
define('removeEventListener', () => {});
define('dispatchEvent', () => true);
define('location', { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', host: 'localhost', hostname: 'localhost', port: '', pathname: '/', search: '', hash: '' });
define('innerWidth', 1280);
define('innerHeight', 800);
define('document', {
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: makeElement,
  body: makeElement('body'), documentElement: makeElement('html'), activeElement: null,
  addEventListener() {}, removeEventListener() {}, readyState: 'complete',
});
define('localStorage', memoryStorage());
define('sessionStorage', memoryStorage());
define('requestAnimationFrame', () => 0);
define('cancelAnimationFrame', () => {});
define('getComputedStyle', () => ({ getPropertyValue: () => '' }));
define('maplibregl', permissive());
define('dockview', permissive());
define('ResizeObserver', function ResizeObserver() { this.observe = () => {}; this.unobserve = () => {}; this.disconnect = () => {}; });
define('MutationObserver', function MutationObserver() { this.observe = () => {}; this.disconnect = () => {}; });
if (typeof g.WebSocket === 'undefined') {
  function WebSocket() { this.readyState = 0; this.send = () => {}; this.close = () => {}; }
  Object.assign(WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  g.WebSocket = WebSocket;
}
// What the local server's generated /js/config.js defines (app/server.js); sync.js assigns them at load.
define('CRC_SYNC_URL', 'ws://localhost:1');
define('CASDOOR_CLIENT_ID', '');
define('CASDOOR_ENDPOINT', '');
define('MAPTILER_KEY', '');
