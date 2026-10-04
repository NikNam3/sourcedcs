/* The client's module graph (ESM-1; replaces FREEZE's client-global-surface guard).
 *
 * The client is native ES modules (H87): index.html loads /js/config.js and the CDN scripts as classic scripts, then
 * one module, js/main.js, which imports the rest. These checks keep that true:
 *  1. index.html holds exactly one module script (js/main.js) and no other local script but /js/config.js;
 *  2. every .js under app/public/js is reachable from main.js, and every import names a file that exists;
 *  3. the whole graph evaluates in Node under a DOM stub with no throw. Node links named imports against the
 *     target's exports before evaluating anything, so this also proves every import resolves to an export;
 *  4. the set of exported names per file is frozen in tests/fixtures/module-graph-exports.json. It is a structure
 *     fixture: rewrite it with GOLDEN_RECORD=1 when the structure changes on purpose, and list the change;
 *  5. no CommonJS export guard is left in the client;
 *  6. every module also evaluates as its OWN entry, each in a fresh graph (helpers/fresh-graph.mjs): a cycle evaluates
 *     in a different order from another entry, so a TDZ read that main.js's order hides would show here (W1-ESM-3);
 *  7. (the classic-globals bridge guard is gone: BRIDGE deleted the bridge);
 *  8. no identifier in a module names another module's export unless the module imports it or declares it locally.
 *     A missed import behind a `typeof X === 'function'` guard would otherwise switch a feature off silently (W1-ESM-6).
 * Import cycles are allowed (no module reads a cycle partner's binding at top level, docs/wip/ESM-1.md step 5);
 * the test prints them as diagnostics.
 */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { permissive } from './helpers/client-env.mjs';
import { freshGraph } from './helpers/fresh-graph.mjs';

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

/** client-env.mjs's globals, with permissive elements; srs-radio.js wires its controls and starts its polls at load. */
function installDomStub() {
  document.getElementById = () => permissive();
  globalThis.setInterval = () => 0;
}

/** Source text with comments and string/template text removed (template `${…}` expressions kept). */
function codeOnly(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    if (c === "'" || c === '"') { i++; while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; i++; } i++; out += '""'; continue; }
    if (c === '`') {
      i++; out += '`';
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          let depth = 1, e = ''; i += 2;
          while (i < src.length && depth) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; if (depth) e += src[i]; i++; }
          out += ' ' + codeOnly(e) + ' ';
          continue;
        }
        i++;
      }
      i++; out += '`';
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** Names a module declares anywhere (declarations, destructuring, parameters, catch bindings): a coarse superset. */
function localNames(code) {
  const local = new Set();
  const addList = (list) => list.split(',').forEach(x => x.split('=')[0].replace(/^\s*\.\.\./, '').replace(/[{}[\]]/g, ' ').split(/[\s:]+/).forEach(y => y && local.add(y)));
  for (const m of code.matchAll(/\b(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]=]*)[}\]]/g)) addList(m[1]);
  for (const m of code.matchAll(/function\s*\*?\s*[A-Za-z_$]*\s*\(([^)]*)\)/g)) addList(m[1]);
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) addList(m[1]);
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) local.add(m[1]);
  for (const m of code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  return local;
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
  const surface = { exports: exportsByFile };
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
});

test('module graph: every module evaluates as its own entry, in a fresh graph', async () => {
  installDomStub();
  process.on('unhandledRejection', () => {});
  const failed = [];
  for (const abs of [...graph().keys()].filter(p => p !== MAIN).sort()) {
    try { await freshGraph().import(abs); } catch (e) { failed.push(`${rel(abs)}: ${e && e.message}`); }
  }
  assert.deepEqual(failed, []);
});

// Intentional shadows: a local name that equals another module's export but is not declared in a way localNames sees.
const SHADOW_ALLOW = {};

test('module graph: no module reads another module\'s export without importing it', () => {
  const owner = new Map();
  const frozen = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).exports;
  for (const [f, names] of Object.entries(frozen)) for (const n of names) if (!owner.has(n)) owner.set(n, f);
  const missed = [];
  for (const f of Object.keys(frozen)) {
    const src = fs.readFileSync(path.join(JS, f), 'utf8');
    const code = codeOnly(src);
    const imported = new Set();
    for (const m of src.matchAll(/^\s*import\s*\{([^}]*)\}\s*from/gm)) for (const x of m[1].split(',')) { const t = x.trim().split(/\s+as\s+/).pop(); if (t) imported.add(t); }
    const local = localNames(code);
    const allow = new Set(SHADOW_ALLOW[f] || []);
    for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)(?!\s*:(?!:))/g)) {
      const n = m[1], o = owner.get(n);
      if (!o || o === f || imported.has(n) || local.has(n) || allow.has(n)) continue;
      missed.push(`${f}: ${n} (exported by ${o})`);
    }
  }
  assert.deepEqual([...new Set(missed)], []);
});

/* 9. The import cycle cannot grow back (DESK-GRAPH; docs/wip/ARCH-C.md 1.2).
 * Before DESK-GRAPH one strongly connected component held 59 of 106 modules (app.js, bay-view.js's re-exports and
 * the renderers called by hand pulled everything into it). After: 39 of 114. The bound below is the size at the end of
 * DESK-GRAPH; lower it when a lane shrinks the cycle, never raise it. Leaves and rule modules must stay outside any cycle. */
const LARGEST_CYCLE_MAX = 36;
const NEVER_IN_A_CYCLE = [
  'settings.js', 'picture.js', 'map-handle.js', 'view-state.js', 'scope-constants.js', 'format.js', 'html-escape.js',
  'geo.js', 'iff.js', 'icons.js', 'track-label.js', 'panels/efsp/efsp-change-bus.js', 'panels/efsp/efsp-message-registry.js',
  'panels/efsp/control-release-rules.js', 'panels/efsp/carrier-state.js',
  'panels/efsp/carrier-final-distance.js', 'panels/efsp/runway-status-rules.js', 'panels/efsp/facility-topology.js',
  'panels/efsp/sync-cursor.js',
];

test('module graph: the largest import cycle stays small, and the leaves and rule modules are in none', () => {
  const cs = cycles(graph());
  const largest = Math.max(0, ...cs.map(c => c.length));
  assert.ok(largest <= LARGEST_CYCLE_MAX, `the largest import cycle holds ${largest} modules (limit ${LARGEST_CYCLE_MAX}): ${cs.find(c => c.length === largest).join(', ')}`);
  const inCycle = new Set(cs.flat());
  const present = NEVER_IN_A_CYCLE.filter(f => fs.existsSync(path.join(JS, f)));
  assert.deepEqual(present.filter(f => inCycle.has(f)), []);
  assert.ok(present.length >= NEVER_IN_A_CYCLE.length - 2, 'the list names modules that exist');
});
