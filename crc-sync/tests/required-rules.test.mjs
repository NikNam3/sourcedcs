import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fullRules, DEFAULT_RULES } from './helpers/full-rules.mjs';

// ARCH-D5 (H80): a rule the Board reads and the caller omitted is a start-up error. The required set is the names
// board-store.js and board/** read as `rules.<name>` (the scan freeze guard 1 also runs); src/efsp/required-rules.js
// lists them. An ordinary test: the freeze suite is opt-in after the refactor window.

const require = createRequire(import.meta.url);
const { REQUIRED_RULES } = require('../src/efsp/required-rules.js');
const { BoardStore } = require('../src/efsp/board-store.js');
const { assertAuthorityCoverage } = require('../src/efsp/index.js');
const SRC = path.resolve(import.meta.dirname, '../src/efsp');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.js$/.test(e.name)) out.push(p);
  }
  return out;
}
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

test('REQUIRED_RULES is exactly the set of rule names the Board reads', () => {
  const read = new Set();
  for (const f of [path.join(SRC, 'board-store.js'), ...walk(path.join(SRC, 'board'))]) {
    for (const m of stripComments(fs.readFileSync(f, 'utf8')).matchAll(/(?:this\._rules|(?<![\w$.])rules|\b(?:ctx|this)\.rules)\.([A-Za-z_]\w*)/g)) read.add(m[1]);
  }
  assert.deepEqual([...read].sort(), [...REQUIRED_RULES].sort(), 'a rule the Board reads is not in src/efsp/required-rules.js (or the reverse)');
  assert.deepEqual(Object.keys(DEFAULT_RULES).sort(), [...REQUIRED_RULES].sort(), 'tests/helpers/full-rules.mjs covers exactly the required rules');
});

test('a BoardStore built without rules it reads fails at construction, naming each one', () => {
  const { facilityId, peerBoard, ...partial } = fullRules();
  assert.throws(() => new BoardStore({ getFdr: () => null }, partial), (e) => /2 required rule\(s\)/.test(e.message) && e.message.includes('facilityId') && e.message.includes('peerBoard'));
  assert.throws(() => new BoardStore({ getFdr: () => null }, {}), /50 required rule\(s\)/);
  // null, false and [] are values, not absences
  assert.doesNotThrow(() => new BoardStore({ getFdr: () => null }, fullRules({ facilityId: null, aitAuthorized: false, standingReleases: [] })));
});

test('a configured Position with no registered Position family stops start-up', () => {
  const config = {
    getFacilityIds: () => ['F'],
    getPositionSet: () => ['TWR', 'NOBODY'],
    getPositionClass: () => 'CONTROLLER',
  };
  assert.throws(() => assertAuthorityCoverage(config), /F\/NOBODY/);
  assert.doesNotThrow(() => assertAuthorityCoverage({ ...config, getPositionSet: () => ['TWR'] }));
});
