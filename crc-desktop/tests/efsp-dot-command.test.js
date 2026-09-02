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
