/* Nothing in production puts its own names on `window`, and nothing reads one (DESK-GRAPH; README "Client modules").
 *
 * The client is native ES modules: a module imports what it uses. A custom `window.<name>` is a channel the module-graph
 * test cannot see (`window.getLatestTrack` was one, read by five modules; it is now `picture.js`'s `getLatestTrack`).
 * The only custom names that may be read are the two the Electron preload bridges in (`crcLinks`, `crcUpdate`,
 * `crc-desktop/app/preload.js`); everything else must be a standard browser API. The test-only `window.crc`
 * (`e2e/helpers/modules.js`) is written by the specs, never by production code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const JS = path.join(import.meta.dirname, '../app/public/js');
const BRIDGED = new Set(['crcLinks', 'crcUpdate']);
// `window.fromUtc` / `window.toUtc`: a booking record's `window` (a local variable of that name), not the global.
const LOCAL_WINDOW_FIELDS = new Set(['fromUtc', 'toUtc']);
const BROWSER = new Set([
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'location', 'open', 'prompt', 'confirm', 'alert', 'crypto',
  'innerWidth', 'innerHeight', 'devicePixelRatio', 'getSelection', 'requestAnimationFrame', 'cancelAnimationFrame',
  'matchMedia', 'localStorage', 'sessionStorage', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'fetch',
  'getComputedStyle', 'navigator', 'document', 'history', 'screen', 'close', 'focus', 'blur', 'scrollTo', 'performance',
  'ResizeObserver', 'MutationObserver', 'CustomEvent', 'Event', 'URL', 'AudioContext', 'WebSocket', 'btoa', 'atob',
]);

const allJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? allJs(p) : (e.name.endsWith('.js') ? [p] : []);
});
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

test('production code reads or writes no custom window.* name (only the preload bridge and browser APIs)', () => {
  const bad = [];
  for (const f of allJs(JS)) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/\bwindow\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
      if (!BROWSER.has(m[1]) && !BRIDGED.has(m[1]) && !LOCAL_WINDOW_FIELDS.has(m[1])) bad.push(`${path.relative(JS, f)}: window.${m[1]}`);
    }
    for (const m of src.matchAll(/\bwindow\s*\[\s*(['"`])([^'"`]+)\1\s*\]\s*=(?!=)/g)) bad.push(`${path.relative(JS, f)}: window['${m[2]}'] =`);
    for (const m of src.matchAll(/\b(?:globalThis|self)\s*\.\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g)) bad.push(`${path.relative(JS, f)}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

test('the bridged names are really the preload\'s', () => {
  const preload = fs.readFileSync(path.join(import.meta.dirname, '../app/preload.js'), 'utf8');
  for (const n of BRIDGED) assert.ok(preload.includes(n), `app/preload.js no longer exposes ${n}`);
});
