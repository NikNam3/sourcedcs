/* The client's module graph (ESM-1; replaces FREEZE's client-global-surface guard).
 *
 * The client is native ES modules (H87): index.html loads /js/config.js and the CDN scripts as classic scripts, then
 * one module, js/main.js, which imports the rest. These checks keep that true:
 *  1. index.html holds exactly one module script (js/main.js) and no other local script but /js/config.js;
 *  2. every .js under app/public/js is reachable from main.js, and every import names a file that exists;
 *  3. the whole graph evaluates in Node under a DOM stub with no throw. Node links named imports against the
 *     target's exports before evaluating anything, so this also proves every import resolves to an export;
 *  4. the set of exported names per file, and the names js/classic-globals-bridge.js puts on window (a
 *     transitional debt, S-ESM1a), are frozen in tests/fixtures/module-graph-exports.json. It is a structure
 *     fixture: rewrite it with GOLDEN_RECORD=1 when the structure changes on purpose, and list the change;
 *  5. no CommonJS export guard is left in the client.
 * Import cycles are allowed (no module reads a cycle partner's binding at top level, docs/wip/ESM-1.md step 5);
 * the test prints them as diagnostics.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { makeElement } = require('./helpers/dom-stub.js');

const PUBLIC = path.join(import.meta.dirname, '../app/public');
const JS = path.join(PUBLIC, 'js');
const MAIN = path.join(JS, 'main.js');
const FIXTURE = path.join(import.meta.dirname, 'fixtures/module-graph-exports.json');
const rel = (abs) => path.relative(JS, abs).split(path.sep).join('/');

function allJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? allJs(p) : (e.name.endsWith('.js') ? [p] : []);
  });
}

/** Static (`import … from '…'`, `import '…'`) and dynamic (`import('…')`) specifiers, resolved to absolute paths. */
function importsOf(abs) {
  const text = fs.readFileSync(abs, 'utf8');
  const specs = [
    ...[...text.matchAll(/^\s*import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map(m => m[1]),
    ...[...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]),
  ];
  return specs.map(s => path.resolve(path.dirname(abs), s));
}

function graph() {
  const seen = new Map(); // abs -> [abs]
  const visit = (abs) => { if (seen.has(abs)) return; const deps = fs.existsSync(abs) ? importsOf(abs) : []; seen.set(abs, deps); deps.forEach(visit); };
  visit(MAIN);
  return seen;
}

function cycles(g) {
  let i = 0; const stack = [], on = new Set(), ix = new Map(), low = new Map(), out = [];
  const sc = (v) => {
    ix.set(v, i); low.set(v, i); i++; stack.push(v); on.add(v);
    for (const w of g.get(v) || []) {
      if (!ix.has(w)) { sc(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), ix.get(w)));
    }
    if (low.get(v) === ix.get(v)) { const c = []; let w; do { w = stack.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1) out.push(c.map(rel).sort()); }
  };
  for (const v of g.keys()) if (!ix.has(v)) sc(v);
  return out;
}

/** A browser-ish global scope: true browser globals only (the modules import everything else). */
function installDomStub() {
  const permissive = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : permissive()), apply: () => permissive(), construct: () => permissive() });
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.assign(globalThis, {
    document: {
      getElementById: () => permissive(), querySelector: () => null, querySelectorAll: () => [], createElement: makeElement,
      body: makeElement('body'), documentElement: makeElement('html'), addEventListener() {}, removeEventListener() {}, readyState: 'complete',
    },
    localStorage: storage, sessionStorage: storage, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    setInterval: () => 0, clearInterval() {},
    maplibregl: permissive(), dockview: permissive(), WebSocket: function () {}, Audio: function () {}, Image: function () {},
    ResizeObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }, MutationObserver: function () { this.observe = () => {}; },
    fetch: () => Promise.reject(new Error('no network')),
    // What the local server's generated /js/config.js defines (app/server.js).
    CRC_SYNC_URL: 'ws://localhost:1', CASDOOR_CLIENT_ID: '', CASDOOR_ENDPOINT: '', MAPTILER_KEY: '',
  });
  // `history` is the one exported name a browser window already has (checked in Chromium); the bridge leaves it alone.
  globalThis.window = { history: {}, addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800, location: { href: 'http://localhost/' } };
}

test('module graph: index.html loads config.js as a classic script and exactly one module, js/main.js', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const tags = [...html.matchAll(/<script\b([^>]*)>/g)].map(m => m[1]);
  const modules = tags.filter(a => /type="module"/.test(a));
  assert.deepEqual(modules.map(a => (a.match(/src="([^"]+)"/) || [])[1]), ['./js/main.js']);
  const localClassic = tags.filter(a => !/type="module"/.test(a)).map(a => (a.match(/src="([^"]+)"/) || [])[1]).filter(s => s && !/^(https?:)?\/\//.test(s));
  assert.deepEqual(localClassic, ['/js/config.js']);
});

test('module graph: every client file is reachable from main.js and every import names an existing file', (t) => {
  const g = graph();
  const missing = [...g.values()].flat().filter(p => !fs.existsSync(p)).map(rel);
  assert.deepEqual([...new Set(missing)], [], 'an import names a file that does not exist');
  const unreachable = allJs(JS).filter(p => !g.has(p)).map(rel);
  assert.deepEqual(unreachable, [], 'a client file is not reachable from main.js (index.html no longer loads it)');
  for (const c of cycles(g)) t.diagnostic(`import cycle (${c.length} modules): ${c.join(', ')}`);
});

test('module graph: no CommonJS export guard is left in the client', () => {
  // Code only: a comment that still describes the old guard is L20's to reword (docs/wip/ESM-1.md, Findings).
  const left = allJs(JS).filter(p => /^[^/\n]*(\bmodule\.exports\b|\btypeof module\b)/m.test(fs.readFileSync(p, 'utf8'))).map(rel);
  assert.deepEqual(left, []);
});

test('module graph: the whole graph evaluates under the DOM stub, and the exported names are frozen', async () => {
  installDomStub();
  // The modules start async work (config fetch, auth) the stub cannot serve; that is not what this test is about.
  process.on('unhandledRejection', () => {});
  const files = [...graph().keys()].filter(p => p !== MAIN).sort(); // main.js only boots the app (the e2e smoke covers it)
  const exportsByFile = {};
  for (const abs of files) {
    const ns = await import(pathToFileURL(abs).href);
    exportsByFile[rel(abs)] = Object.keys(ns).sort();
  }
  const bridge = await import(pathToFileURL(path.join(JS, 'classic-globals-bridge.js')).href);
  const surface = {
    exports: exportsByFile,
    bridge: { count: bridge.BRIDGED.length, skipped: [...bridge.SKIPPED].sort(), names: [...bridge.BRIDGED].sort() },
  };
  if (process.env.GOLDEN_RECORD === '1') {
    fs.writeFileSync(FIXTURE, JSON.stringify(surface, null, 1) + '\n');
    return;
  }
  const frozen = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(Object.keys(surface.exports), Object.keys(frozen.exports), 'the set of client modules changed');
  for (const f of Object.keys(frozen.exports)) {
    const added = surface.exports[f].filter(n => !frozen.exports[f].includes(n));
    const removed = frozen.exports[f].filter(n => !surface.exports[f].includes(n));
    assert.deepEqual({ file: f, added, removed }, { file: f, added: [], removed: [] },
      'the exported names changed: list the change and re-record with GOLDEN_RECORD=1');
  }
  assert.deepEqual(surface.bridge, frozen.bridge, 'the classic-globals bridge changed (S-ESM1a: it may only shrink)');
});
