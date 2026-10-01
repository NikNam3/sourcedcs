import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The collaborator seam (plan §2.3): the files under src/efsp/board/ are collaborators of the Board, not parts of one
// big object. Four rules keep each one extractable and keep the wiring in one place:
//   1. no `require` of board-store.js or of a sibling under board/, except that every file under board/ may require
//      board/strip-util.js (S-R0q: BOARD-1's audit.js needs deepClone from it) and board/ops/index.js may require its
//      op files;
//   2. no `<expr>._<name>` read where <expr> is not `this` (another object's private member);
//   3. no module-level `let`/`var`, and no module-level `const` bound to a `new Map/Set/[]/{}` that is mutated
//      (hidden shared state between Boards);
//   4. rules are read only as `this._rules.X` or `rules.X`, never aliased, destructured or indexed.
// The folder does not exist at the base, so the repo-level test passes on zero files; the self-test proves each check.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/efsp');
const BOARD_DIR = path.join(SRC, 'board');
const BOARD_STORE = path.join(SRC, 'board-store.js');

const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
  .split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(c|m)?js$/.test(e.name)) out.push(p);
  }
  return out;
};

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** 1. Requires. `file` is the absolute path of the file the text belongs to. */
export function checkRequires(text, file, boardDir = BOARD_DIR, boardStore = BOARD_STORE) {
  const out = [];
  const re = /(?:require\(\s*|from\s+|import\s*\(\s*|import\s+)(['"])(\.{1,2}\/[^'"]*|\.{1,2})\1/g;
  for (const m of stripComments(text).matchAll(re)) {
    const target = path.resolve(path.dirname(file), m[2]).replace(/\.(c|m)?js$/, '');
    const norm = (p) => p.replace(/\.(c|m)?js$/, '');
    const inBoard = target === norm(boardDir) || target.startsWith(boardDir + path.sep);
    const toStore = target === norm(boardStore);
    if (!inBoard && !toStore) continue;
    const rel = path.relative(boardDir, file).split(path.sep).join('/');
    const tgt = inBoard ? path.relative(boardDir, target).split(path.sep).join('/') : 'board-store';
    const allowed = tgt === 'strip-util' || (rel === 'ops/index.js' && tgt.startsWith('ops/') && tgt !== 'ops/index');
    if (!allowed) out.push(`${rel}:${lineOf(text, m.index)} requires ${m[2]} (${toStore ? 'board-store.js' : 'a sibling under board/'})`);
  }
  return out;
}

/** 2. A private member read off something that is not `this`. */
export function checkPrivateReads(text) {
  const src = stripComments(text);
  const out = [];
  for (const m of src.matchAll(/\??\.\s*(_[A-Za-z]\w*)/g)) {
    const before = /([A-Za-z_$][\w$]*|[)\]])\s*$/.exec(src.slice(Math.max(0, m.index - 60), m.index));
    if (!before || before[1] !== 'this') out.push(`line ${lineOf(src, m.index)}: ${before ? before[1] : '?'}.${m[1]}`);
  }
  return out;
}

/** 3. Module-level mutable state. */
export function checkModuleState(text) {
  const src = stripComments(text);
  const out = [];
  for (const m of src.matchAll(/^(let|var)\s+([A-Za-z_$][\w$]*)/gm)) out.push(`line ${lineOf(src, m.index)}: module-level ${m[1]} ${m[2]}`);
  for (const m of src.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*(new\s+(?:Map|Set|WeakMap|WeakSet)\b|\[\s*\]|\{\s*\})/gm)) {
    const n = m[1].replace(/\$/g, '\\$');
    const mutated = new RegExp(`\\b${n}\\s*\\.\\s*(set|add|push|pop|shift|unshift|splice|delete|clear|sort|reverse|fill)\\s*\\(|\\b${n}\\s*(\\[[^\\]]*\\]|\\.[A-Za-z_$][\\w$]*)\\s*(=(?!=)|\\+=|-=|\\+\\+|--)|Object\\.assign\\(\\s*${n}\\b|\\bdelete\\s+${n}\\b`).test(src);
    if (mutated) out.push(`line ${lineOf(src, m.index)}: module-level const ${m[1]} is mutated`);
  }
  return out;
}

/** 4. Rules read only as this._rules.X or rules.X. */
export function checkRulesAccess(text) {
  const src = stripComments(text);
  const out = [];
  for (const m of src.matchAll(/this\._rules\b(?!\s*\.\s*[A-Za-z_$])/g)) out.push(`line ${lineOf(src, m.index)}: this._rules used as a whole`);
  for (const m of src.matchAll(/(?<![\w$.])rules\s*\[/g)) out.push(`line ${lineOf(src, m.index)}: rules indexed`);
  for (const m of src.matchAll(/(?:=|\(|,|:|return)\s*rules\s*(?=[;,)}\n]|$)/gm)) {
    // `rules` as a bare value: aliased, passed on or returned. A parameter list `({ rules })` is a declaration.
    if (/\{\s*rules\s*[,}]/.test(src.slice(Math.max(0, m.index - 40), m.index + m[0].length + 3)) && !/=\s*rules/.test(m[0])) continue;
    out.push(`line ${lineOf(src, m.index)}: rules used as a whole value`);
  }
  for (const m of src.matchAll(/\{[^}]*\}\s*=\s*(?:this\._)?rules\b/g)) out.push(`line ${lineOf(src, m.index)}: rules destructured`);
  return out;
}

const ALL = [
  ['require', (t, f) => checkRequires(t, f)],
  ['private read', (t) => checkPrivateReads(t)],
  ['module state', (t) => checkModuleState(t)],
  ['rules access', (t) => checkRulesAccess(t)],
];

test('board seam: src/efsp/board/** keeps to the four collaborator rules', () => {
  const files = walk(BOARD_DIR).sort();
  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const [name, check] of ALL) for (const v of check(text, f)) bad.push(`${path.relative(SRC, f)} [${name}] ${v}`);
  }
  assert.deepEqual(bad, [], 'a collaborator under board/ broke the seam (docs/wip/ARCH-plan.md §2.3)');
});

// ---- self-test: each check fires on a bad snippet and stays quiet on a good one --------------------------------

const F = (rel) => path.join(BOARD_DIR, rel);

test('board seam self-test, 1: requires', () => {
  assert.equal(checkRequires("const { BoardStore } = require('../board-store');", F('strip-ops.js')).length, 1, 'board-store from a collaborator');
  assert.equal(checkRequires("const x = require('./other-op');", F('strip-ops.js')).length, 1, 'a sibling');
  assert.equal(checkRequires("import { y } from './ops/index.js';", F('strip-ops.js')).length, 1, 'ops from a non-ops file');
  assert.equal(checkRequires("const u = require('../strip-util');", F('ops/set-flag.js')).length, 0, 'ops -> strip-util is allowed');
  assert.equal(checkRequires("const { deepClone } = require('./strip-util');", F('audit.js')).length, 0, 'any board/ file -> strip-util is allowed (S-R0q)');
  assert.equal(checkRequires("const u = require('../other');", F('ops/set-flag.js')).length, 1, 'ops -> anything else is not');
  assert.equal(checkRequires("const a = require('./set-flag');\nconst b = require('./drop');", F('ops/index.js')).length, 0, 'ops/index -> its op files');
  assert.equal(checkRequires("const a = require('./set-flag');", F('ops/drop.js')).length, 1, 'an op requiring a sibling op');
  assert.equal(checkRequires("const o = require('../../order-key');\nconst p = require('node:path');\nconst d = require('../permission');", F('strip-ops.js')).length, 0, 'files outside board/ and packages are fine');
  assert.equal(checkRequires("// const x = require('../board-store');", F('strip-ops.js')).length, 0, 'comments are ignored');
});

test('board seam self-test, 2: private reads off something that is not this', () => {
  assert.equal(checkPrivateReads('const a = store._strips.get(id);').length, 1);
  assert.equal(checkPrivateReads('this._store._strips.get(id);').length, 1, 'a private of a collaborator reached through this');
  assert.equal(checkPrivateReads('foo()._hidden;').length, 1);
  assert.equal(checkPrivateReads('const m = this._state._strips;').length, 1, 'chained: a private of a private');
  assert.equal(checkPrivateReads('const m = x.y._z;').length, 1, 'chained: x.y._z');
  assert.equal(checkPrivateReads('const m = this._a._b._c;').length, 2, 'every hop after the first');
  assert.equal(checkPrivateReads('const a = this._strips.get(id); this._rules.x(); this._a = this._b;').length, 0);
  assert.equal(checkPrivateReads('// store._strips in a comment\nconst s = "x";').length, 0);
});

test('board seam self-test, 3: module-level state', () => {
  assert.equal(checkModuleState('let counter = 0;').length, 1);
  assert.equal(checkModuleState('var seen = {};').length, 1);
  assert.equal(checkModuleState('const cache = new Map();\nfunction f(k, v) { cache.set(k, v); }').length, 1, 'a Map that is written');
  assert.equal(checkModuleState('const seen = [];\nfunction f(x) { seen.push(x); }').length, 1, 'an array that is pushed to');
  assert.equal(checkModuleState('const o = {};\nfunction f() { o.x = 1; }').length, 1, 'an object that is assigned into');
  assert.equal(checkModuleState('const cache = new Map();\nfunction f(k) { return cache.get(k); }').length, 0, 'a Map that is only read');
  assert.equal(checkModuleState('const LIMIT = 40;\nconst NAMES = Object.freeze(["a"]);\nfunction f() { let n = 0; n += 1; return n; }').length, 0, 'constants and function-level let');
});

test('board seam self-test, 4: rules access', () => {
  assert.equal(checkRulesAccess('const r = this._rules;').length, 1, 'aliased');
  assert.equal(checkRulesAccess('const { isOccupied } = this._rules;').length >= 1, true, 'destructured');
  assert.equal(checkRulesAccess('const { isOccupied } = rules;').length >= 1, true, 'destructured bare');
  assert.equal(checkRulesAccess('const f = this._rules[name];').length, 1, 'indexed');
  assert.equal(checkRulesAccess('const f = rules[name];').length, 1, 'indexed bare');
  assert.equal(checkRulesAccess('helper(a, rules);').length, 1, 'passed on whole');
  assert.equal(checkRulesAccess('const ok = this._rules.isOccupied(p) && rules.canCreateStripRole(a, b);').length, 0);
  assert.equal(checkRulesAccess('function make({ rules }) { return rules.isOccupied(p); }').length, 0, 'a parameter named rules is a declaration');
  assert.equal(checkRulesAccess('// const r = this._rules;').length, 0, 'comments are ignored');
});
