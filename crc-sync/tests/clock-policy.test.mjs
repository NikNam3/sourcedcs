import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The clock policy (R3-16 / S3-3, ADR 0079, H11): EFSP times come from the injected mission clock. A read of the
// WALL clock under src/efsp is allowed only where this list says so, one entry per Date.now() / bare new Date() site.
// It replaces freeze guard 3 and guard-wall-clock.json (R0 step 6).
//
// This list is a STRUCTURE FIXTURE (refactor README): a lane that moves a site from one file or function to another
// changes that entry's `file` and `function` and keeps its `reason`. A lane that adds a site adds an entry; a lane
// that removes one removes it. Whether a site should move clocks is TIME-B's decision, not this test's.
// `function` is the nearest enclosing function, method or constructor by name (see enclosingFunction below).
// `reason` quotes the code's own comment or ADR 0079's table.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/efsp');

export const WALL_ALLOW_LIST = [
  { file: 'src/efsp/archiver.js', function: 'constructor', clock: 'wall',
    reason: '`wallNow` is "the retention clock (a storage lifetime, like L5\'s rotation)"; the archive window is wall time (docs/adr/0082)' },
  { file: 'src/efsp/correlation-reconciler.js', function: '_accumulate', clock: 'wall',
    reason: 'ADR 0079 table: Correlation below-target warning throttle | wall | limits how often the log is written (code: "stays on the wall clock (_warnIfBelowTarget)")' },
  { file: 'src/efsp/index.js', function: '_persist', clock: 'wall',
    reason: 'Wall time of this write: the boot reconcile reads the log tail from here to find Mutations audited but never persisted (docs/adr/0081)' },
  { file: 'src/efsp/metrics.js', function: 'constructor', clock: 'wall',
    reason: '`wallNow` "retention only" (the metrics store\'s own doc comment)' },
  { file: 'src/efsp/metrics.js', function: 'createEfspInstrumentation', clock: 'wall',
    reason: 'the default of the `wallNow` handed on to the metrics and traffic-count stores, which are "retention only"' },
  { file: 'src/efsp/mutation-log.js', function: 'constructor', clock: 'wall',
    reason: 'Days here are WALL-clock UTC days. Retention is a storage lifetime (mutation-log.js header comment)' },
  { file: 'src/efsp/traffic-count.js', function: 'constructor', clock: 'wall',
    reason: '`wallNow`: "retention only"; the report windows and timestamps use the mission clock' },
];

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(c|m)?js$/.test(e.name)) out.push(p);
  }
  return out;
};

/** Block and line comments blanked, line structure kept so a line number still points at the right place. */
export const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
  .split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

const NOT_A_FUNCTION = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'await', 'typeof', 'new']);

/** Name of the nearest enclosing function: the last line above with a class-method (indent 2) or top-level (indent 0) head. */
export function enclosingFunction(lines, idx) {
  for (let i = idx; i >= 0; i--) {
    const m = /^(?: {2})?(?:static\s+)?(?:async\s+)?(?:function\s*\*?\s*)?([A-Za-z_$][\w$]*)\s*\(/.exec(lines[i]);
    if (m && !NOT_A_FUNCTION.has(m[1]) && !/^(?: {2})?(?:const|let|var|module|exports)\b/.test(lines[i])) {
      const fm = /^function\s+([A-Za-z_$][\w$]*)/.exec(lines[i]);
      return fm ? fm[1] : m[1];
    }
    const g = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(lines[i]);
    if (g) return g[1];
  }
  return '(module)';
}

/** Every wall-clock read in `files` as { file, function, kind }. */
export function findWallSites(files, rootDir = path.resolve(SRC, '../..')) {
  const sites = [];
  for (const f of files) {
    const lines = stripComments(fs.readFileSync(f, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      const n = (line.match(/Date\.now\b/g) || []).length + (line.match(/new Date\(\s*\)/g) || []).length;
      for (let k = 0; k < n; k++) sites.push({ file: path.relative(rootDir, f).split(path.sep).join('/'), function: enclosingFunction(lines, i) });
    });
  }
  return sites;
}

const keyOf = (s) => `${s.file} :: ${s.function}`;
const countBy = (arr) => arr.reduce((m, s) => m.set(keyOf(s), (m.get(keyOf(s)) || 0) + 1), new Map());

/** Pure comparison, so the test can prove it fires on made-up input. */
export function compareSites(found, allowed) {
  const have = countBy(found), want = countBy(allowed);
  const missing = [], stale = [];
  for (const [k, n] of have) if (n > (want.get(k) || 0)) missing.push(`${k} (found ${n}, listed ${want.get(k) || 0})`);
  for (const [k, n] of want) if (n > (have.get(k) || 0)) stale.push(`${k} (listed ${n}, found ${have.get(k) || 0})`);
  return { missing, stale };
}

test('clock policy: every wall-clock read under src/efsp is on the allow-list, and every entry has a site', () => {
  const found = findWallSites(walk(SRC).sort());
  const { missing, stale } = compareSites(found, WALL_ALLOW_LIST);
  assert.deepEqual(missing, [], 'a Date.now() / new Date() site is not in WALL_ALLOW_LIST (tests/clock-policy.test.mjs). EFSP times come from the mission clock (ADR 0079, H11): use it, or add an entry with a reason the code itself states');
  assert.deepEqual(stale, [], 'WALL_ALLOW_LIST has an entry with no site: the site moved (update file and function, keep the reason) or was removed (delete the entry)');
});

test('clock policy: every entry names a reason and the wall clock', () => {
  for (const e of WALL_ALLOW_LIST) {
    assert.equal(e.clock, 'wall', `${keyOf(e)}: clock must be 'wall'`);
    assert.ok(typeof e.reason === 'string' && e.reason.length > 20, `${keyOf(e)}: reason missing`);
  }
});

test('clock policy self-test: the comparison fires on a new site and on a stale entry', () => {
  const allowed = [{ file: 'a.js', function: 'f' }];
  assert.deepEqual(compareSites([{ file: 'a.js', function: 'f' }], allowed), { missing: [], stale: [] });
  assert.equal(compareSites([{ file: 'a.js', function: 'f' }, { file: 'b.js', function: 'g' }], allowed).missing.length, 1);
  assert.equal(compareSites([{ file: 'a.js', function: 'f' }, { file: 'a.js', function: 'f' }], allowed).missing.length, 1, 'a second site in the same function');
  assert.equal(compareSites([], allowed).stale.length, 1);
});

test('clock policy self-test: comments are ignored and a bare new Date() counts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clock-probe-'));
  try {
    const f = path.join(tmp, 'x.js');
    fs.writeFileSync(f, '// Date.now() in a comment\n/* new Date() in a block */\nclass A {\n  m() {\n    return Date.now();\n  }\n  n() {\n    return new Date();\n  }\n}\nfunction top() { return 1; }\n');
    const sites = findWallSites([f], tmp);
    assert.deepEqual(sites.map(s => s.function), ['m', 'n']);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
