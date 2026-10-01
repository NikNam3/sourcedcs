import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseLevel, install } = await import('../src/log-level.js');

function fakeConsole() {
  const seen = [];
  const c = {};
  for (const m of ['error', 'warn', 'info', 'log', 'debug']) c[m] = (...a) => seen.push([m, ...a]);
  return { c, seen };
}
function emitAll(c) { for (const m of ['error', 'warn', 'info', 'log', 'debug']) c[m](m); }
const heard = (seen) => seen.map(s => s[0]);

test('default is info: error, warn, info and log are heard, debug is not', () => {
  const { c, seen } = fakeConsole();
  install(c, undefined);
  emitAll(c);
  assert.deepEqual(heard(seen), ['error', 'warn', 'info', 'log']);
});

test('each level keeps itself and everything more severe', () => {
  const want = {
    error: ['error'],
    warn: ['error', 'warn'],
    info: ['error', 'warn', 'info', 'log'],
    debug: ['error', 'warn', 'info', 'log', 'debug'],
  };
  for (const [level, expected] of Object.entries(want)) {
    const { c, seen } = fakeConsole();
    install(c, level);
    emitAll(c);
    assert.deepEqual(heard(seen), expected, level);
  }
});

test('case and whitespace are forgiven; an unknown value falls back to info and warns once', () => {
  assert.deepEqual(parseLevel(' WARN '), { level: 'warn', valid: true });
  assert.deepEqual(parseLevel(''), { level: 'info', valid: true });
  assert.deepEqual(parseLevel('verbose'), { level: 'info', valid: false });
  const { c, seen } = fakeConsole();
  install(c, 'verbose');
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], 'warn');
  assert.match(seen[0][1], /LOG_LEVEL="verbose"/);
});

test('arguments pass through untouched, and restore() puts the console back', () => {
  const { c, seen } = fakeConsole();
  const restore = install(c, 'error');
  c.error('a', { b: 1 });
  c.info('hidden');
  assert.deepEqual(seen, [['error', 'a', { b: 1 }]]);
  restore();
  c.info('back');
  assert.equal(seen.length, 2);
});
