'use strict';

/* The client's global surface (lane FREEZE, docs/wip/FREEZE.md).
 *
 * index.html loads ~50 classic scripts into ONE global scope. Nothing checks that they get along:
 * two scripts that both declare `const finite` make the second a SyntaxError that kills every later
 * declaration, and two that declare the same `function` silently shadow one another. A refactor that
 * moves code between those files (the bay-view.js split) changes this surface without any test noticing.
 *
 * Three checks:
 *  1. every local <script src> of index.html, in document order, is loaded into one vm context with a
 *     deliberately permissive DOM/browser stub; none may fail to compile or redeclare a name
 *     (a runtime error from the stub's gaps is NOT a failure here: it is recorded, not asserted);
 *  2. no top-level name is declared by two scripts (known cases are listed, with the lane that owns each;
 *     they are asserted as `todo` so the test turns into a plain pass when the owner fixes them);
 *  3. the full set of top-level names is frozen in tests/fixtures/client-global-surface.json.
 *     Rewrite it with GOLDEN_RECORD=1 (a behaviour lane, with its own commit; a refactor lane never does).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeElement } = require('./helpers/dom-stub.js');

// The scripts start async work (auth, config fetch) against globals config.js would define; the stub has none of
// that, so those promises reject after the test is done. They are not what this test is about.
process.on('unhandledRejection', () => {});

const PUBLIC = path.join(__dirname, '../app/public');
const FIXTURE = path.join(__dirname, 'fixtures/client-global-surface.json');

function localScripts() {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  return [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^(https?:)?\/\//.test(s));
}
const fileOf = (src) => path.join(PUBLIC, src.replace(/^\.?\//, ''));

/** Column-0 declarations, which is where a classic script's top-level ones are (nothing nested starts at column 0). */
function topLevelNames(text) {
  const names = new Set();
  const add = (n) => { n = String(n).trim().split('=')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n); };
  for (const m of text.matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) add(m[1]);
  for (const m of text.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) add(m[1]);
  for (const m of text.matchAll(/^(?:const|let|var)\s+[{[]([^}\]=]*)[}\]]\s*=/gm)) for (const n of m[1].split(',')) add(n.split(':').pop());
  for (const m of text.matchAll(/^class\s+([A-Za-z_$][\w$]*)/gm)) add(m[1]);
  return names;
}

const scripts = localScripts().filter(s => fs.existsSync(fileOf(s)));
const missing = localScripts().filter(s => !fs.existsSync(fileOf(s)));

const declaredBy = new Map(); // name -> [script, ...]
for (const s of scripts) for (const n of topLevelNames(fs.readFileSync(fileOf(s), 'utf8'))) {
  if (!declaredBy.has(n)) declaredBy.set(n, []);
  declaredBy.get(n).push(s);
}
const duplicates = Object.fromEntries([...declaredBy].filter(([, f]) => f.length > 1).sort(([a], [b]) => a.localeCompare(b)));

// Duplicates that exist TODAY, and who fixes each. A name not listed here that becomes duplicated fails the test.
const KNOWN_DUPLICATES = {
  finite: 'L18S (final-panel.js redeclares it)',
  _el: 'C0 / UI-B (three scripts)',
  _callsignOfFdr: 'C0 / UI-B (carrier-panel.js and efsp-panel.js)',
};

function loadAll() {
  const permissive = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : permissive()), apply: () => permissive(), construct: () => permissive() });
  const doc = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: makeElement, body: makeElement('body'), addEventListener() {}, removeEventListener() {}, readyState: 'complete', documentElement: makeElement('html') };
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, Date, JSON, Math, Number, Set, Map, WeakMap, Array, Object, String, Boolean, Promise, Symbol, RegExp, Error,
    isNaN, parseInt, parseFloat, URL, URLSearchParams, AbortController, TextEncoder, TextDecoder, Intl,
    crypto: { randomUUID: () => 'id' }, document: doc, localStorage: storage, sessionStorage: storage,
    navigator: { userAgent: 'freeze', platform: 'freeze', language: 'en' }, location: { href: 'http://localhost/', protocol: 'http:', host: 'localhost', hostname: 'localhost', search: '', hash: '' },
    fetch: () => Promise.reject(new Error('no network')), WebSocket: function () {}, Audio: function () {}, Image: function () {},
    maplibregl: permissive(), dockview: permissive(), DockviewCore: permissive(), Chart: permissive(),
    window: {}, ResizeObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }, MutationObserver: function () { this.observe = () => {}; },
    CRC_CONFIG: {}, module: { exports: {} },
  };
  sandbox.window = new Proxy(sandbox, { get: (t, k) => t[k], set: (t, k, v) => { t[k] = v; return true; }, has: () => true });
  sandbox.window.addEventListener = () => {}; sandbox.window.removeEventListener = () => {};
  sandbox.globalThis = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  // What the server's generated /js/config.js defines (app/server.js).
  vm.runInContext('var CRC_SYNC_URL = "ws://localhost:1"; var CASDOOR_CLIENT_ID = ""; var CASDOOR_ENDPOINT = "";', sandbox);
  const results = [];
  for (const s of scripts) {
    const code = fs.readFileSync(fileOf(s), 'utf8');
    try { vm.runInContext(code, sandbox, { filename: s }); results.push({ script: s, ok: true }); }
    catch (e) { results.push({ script: s, ok: false, name: e && e.name, message: String(e && e.message) }); }
  }
  return results;
}

test('client global surface: every index.html script compiles and none redeclares a global', { todo: false }, () => {
  const results = loadAll();
  const hard = results.filter(r => !r.ok && (r.name === 'SyntaxError' || /has already been declared/.test(r.message)));
  // A duplicate `finite` is today's one known SyntaxError; it is asserted as a todo below, not here.
  const unexpected = hard.filter(r => !/Identifier '(finite|_el|_callsignOfFdr)' has already been declared/.test(r.message));
  assert.deepEqual(unexpected, [], 'a script failed to compile or redeclared a global (the rest of that script never ran)');
  assert.ok(scripts.length > 40, `expected index.html to load ~50 local scripts, found ${scripts.length}`);
});

test('client global surface: no NEW top-level name is declared by two scripts', () => {
  const fresh = Object.fromEntries(Object.entries(duplicates).filter(([n]) => !(n in KNOWN_DUPLICATES)));
  assert.deepEqual(fresh, {}, 'two scripts declare the same top-level name: one shadows or breaks the other');
});

test('client global surface: the known duplicate names (todo: owners listed in KNOWN_DUPLICATES)', { todo: 'finite: L18S; _el and _callsignOfFdr: C0 / UI-B' }, () => {
  assert.deepEqual(Object.keys(duplicates), [], `still duplicated: ${Object.entries(duplicates).map(([n, f]) => `${n} (${KNOWN_DUPLICATES[n] || 'new'}: ${f.join(', ')})`).join('; ')}`);
});

test('client global surface: the set of top-level names is frozen', () => {
  const surface = { scripts: scripts.map(s => s.replace(/^\.?\//, '')), notInRepo: missing, names: [...declaredBy.keys()].sort() };
  if (process.env.GOLDEN_RECORD === '1') {
    fs.writeFileSync(FIXTURE, JSON.stringify(surface, null, 1) + '\n');
    return;
  }
  const frozen = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const added = surface.names.filter(n => !frozen.names.includes(n));
  const removed = frozen.names.filter(n => !surface.names.includes(n));
  assert.deepEqual({ added, removed, scripts: surface.scripts }, { added: [], removed: [], scripts: frozen.scripts },
    'the client global surface changed: a refactor must keep every top-level name (a behaviour lane re-records with GOLDEN_RECORD=1)');
});
