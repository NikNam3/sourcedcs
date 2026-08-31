'use strict';

/* Tests the pure utility functions in store.js — extracted from server.js
   in the Phase 2 architecture pass (see the repo-root architecture plan). */

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../store.js');

/* ══════════════════════════════════════════════════════════
   parseCallsign
══════════════════════════════════════════════════════════ */

test('parseCallsign: full format extracts the quoted callsign', () => {
  assert.equal(store.parseCallsign('(101st) John Smith "VIPER"'), 'VIPER');
});

test('parseCallsign: bare format (no quoted callsign) falls back to display name', () => {
  assert.equal(store.parseCallsign('(101st) John Smith'), 'John Smith');
});

test('parseCallsign: no parenthetical at all returns the whole nick trimmed', () => {
  assert.equal(store.parseCallsign('  Just A Name  '), 'Just A Name');
});

test('parseCallsign: empty/missing nick returns empty string', () => {
  assert.equal(store.parseCallsign(''), '');
  assert.equal(store.parseCallsign(null), '');
});

/* ══════════════════════════════════════════════════════════
   sanitizeStr
══════════════════════════════════════════════════════════ */

test('sanitizeStr: trims, coerces null/undefined to empty string, truncates to maxLen', () => {
  assert.equal(store.sanitizeStr('  hello  ', 10), 'hello');
  assert.equal(store.sanitizeStr(null, 10), '');
  assert.equal(store.sanitizeStr(undefined, 10), '');
  assert.equal(store.sanitizeStr('this is way too long', 4), 'this');
});

/* ══════════════════════════════════════════════════════════
   normalizeSkillTree
══════════════════════════════════════════════════════════ */

test('normalizeSkillTree: passes through an already-migrated v2 tree unchanged', () => {
  const v2 = { version: 2, tree: [{ id: 'a', title: 'A' }] };
  assert.equal(store.normalizeSkillTree(v2), v2);
});

test('normalizeSkillTree: migrates legacy categories/modules into v2 Module shape', () => {
  const legacy = {
    categories: [{
      id: 'cat1',
      name: 'Category One',
      modules: [{ id: 'mod1', title: 'Module One', min_pass_grade: 'G', prerequisites: ['other'] }],
    }],
  };
  const migrated = store.normalizeSkillTree(legacy);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.tree[0].id, 'cat1');
  assert.equal(migrated.tree[0].title, 'Category One');
  assert.equal(migrated.tree[0].subModules[0].id, 'mod1');
  assert.deepEqual(migrated.tree[0].subModules[0].requirements, ['other']);
  assert.deepEqual(migrated.tree[0].subModules[0].gradingItems, [{ id: 'mod1', min_pass_grade: 'G' }]);
});

test('normalizeSkillTree: invalid min_pass_grade falls back to G', () => {
  const legacy = { categories: [{ id: 'c', modules: [{ id: 'm', min_pass_grade: 'not-a-grade' }] }] };
  const migrated = store.normalizeSkillTree(legacy);
  assert.equal(migrated.tree[0].subModules[0].gradingItems[0].min_pass_grade, 'G');
});
