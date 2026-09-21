'use strict';

/* Unit tests for the dot-command parser (dot-command.js) — the guide's
   §7.1 rule 5 persistent `.verb args` input surface. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseDotCommand } = require('../app/public/js/panels/efsp/dot-command.js');

test('parses a bare verb with no arguments', () => {
  assert.deepEqual(parseDotCommand('.drop'), { verb: 'drop', args: [] });
});

test('parses a verb with a single argument', () => {
  assert.deepEqual(parseDotCommand('.hold 1400'), { verb: 'hold', args: ['1400'] });
});

test('parses a verb with multiple whitespace-separated arguments', () => {
  assert.deepEqual(parseDotCommand('.release 1400 void'), { verb: 'release', args: ['1400', 'void'] });
});

test('collapses multiple spaces between arguments', () => {
  assert.deepEqual(parseDotCommand('.hold   1400    now'), { verb: 'hold', args: ['1400', 'now'] });
});

test('normalizes the verb to lowercase', () => {
  assert.deepEqual(parseDotCommand('.DROP'), { verb: 'drop', args: [] });
});

test('trims leading/trailing whitespace on the whole input', () => {
  assert.deepEqual(parseDotCommand('   .drop   '), { verb: 'drop', args: [] });
});

test('returns null for input not starting with a dot', () => {
  assert.equal(parseDotCommand('drop'), null);
});

test('returns null for empty or whitespace-only input', () => {
  assert.equal(parseDotCommand(''), null);
  assert.equal(parseDotCommand('   '), null);
});

test('returns null for a lone dot with nothing after it', () => {
  assert.equal(parseDotCommand('.'), null);
});

test('returns null/handles undefined input without throwing', () => {
  assert.equal(parseDotCommand(undefined), null);
  assert.equal(parseDotCommand(null), null);
});

// ── WP5: .bind / .unbind (guide §6.6 rule 1, §7.1 rules 4-5) ─────────────
// The badge's candidate picker is a pointer affordance. The guide is explicit
// that the dot-command surface is "a primary feature, not a power-user extra",
// and that data-entry positions need an efficient keyboard path.

test('parseDotCommand reads .bind with a track id', () => {
  assert.deepEqual(parseDotCommand('.bind 101'), { verb: 'bind', args: ['101'] });
});

test('parseDotCommand reads .unbind with no argument', () => {
  assert.deepEqual(parseDotCommand('.unbind'), { verb: 'unbind', args: [] });
});

test('parseDotCommand is case-insensitive on the verb, as it is for every other one', () => {
  assert.deepEqual(parseDotCommand('.BIND 101'), { verb: 'bind', args: ['101'] });
});

test('parseDotCommand keeps a track id that is not numeric — DCS ids are opaque strings', () => {
  assert.deepEqual(parseDotCommand('.bind unit-42'), { verb: 'bind', args: ['unit-42'] });
});
