import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const L = await import('../src/log.js');
const { logger, configure, capture, parseLevel, installConsole } = L.default || L;

beforeEach(() => (L.default || L).resetForTests());

test('before configure: info and up are written, debug is not', () => {
  const seen = [];
  configure({ level: undefined, sink: (r) => seen.push(r) });
  const log = logger('t');
  log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
  assert.deepEqual(seen.map((r) => r.level), ['info', 'warn', 'error']);
});

test('each level keeps itself and everything more severe', () => {
  const want = { error: ['error'], warn: ['error', 'warn'], info: ['error', 'warn', 'info'], debug: ['error', 'warn', 'info', 'debug'] };
  for (const [level, expected] of Object.entries(want)) {
    const seen = [];
    configure({ level, sink: (r) => seen.push(r.level) });
    const log = logger('t');
    for (const m of ['error', 'warn', 'info', 'debug']) log[m](m);
    assert.deepEqual(seen, expected, level);
  }
});

test('parseLevel forgives case and whitespace; an unknown value falls back to info and warns once', () => {
  assert.deepEqual(parseLevel(' WARN '), { level: 'warn', valid: true });
  assert.deepEqual(parseLevel(''), { level: 'info', valid: true });
  assert.deepEqual(parseLevel('verbose'), { level: 'info', valid: false });
  const seen = [];
  assert.equal(configure({ level: 'verbose', sink: (r) => seen.push(r) }), 'info');
  configure({ level: 'verbose', sink: (r) => seen.push(r) });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].level, 'warn');
  assert.match(seen[0].line, /LOG_LEVEL="verbose"/);
});

test('line format: ISO time, LEVEL, name, message, key=value (strings with spaces quoted)', () => {
  const cap = capture();
  logger('efsp:board').info('persisted', { facilityId: 'INCIRLIK', ms: 12, note: 'two words', ok: true });
  cap.stop();
  assert.match(cap.lines[0], /^\d{4}-\d\d-\d\dT[\d:.]+Z INFO efsp:board persisted facilityId=INCIRLIK ms=12 note="two words" ok=true$/);
});

test('child binds context; the call context wins on a clash', () => {
  const cap = capture();
  const log = logger('x').child({ facilityId: 'A', n: 1 });
  log.info('m', { n: 2 });
  log.child({ sessionId: 's' }).info('m2');
  cap.stop();
  assert.deepEqual(cap.records[0].ctx, { facilityId: 'A', n: 2 });
  assert.deepEqual(cap.records[1].ctx, { facilityId: 'A', n: 1, sessionId: 's' });
});

test('an Error in the context prints its stack under the line', () => {
  const cap = capture();
  logger('x').error('boom', { err: new Error('bad thing') });
  cap.stop();
  const [first, ...rest] = cap.lines[0].split('\n');
  assert.match(first, /err="Error: bad thing"$/);
  assert.ok(rest.length > 0 && /Error: bad thing/.test(rest[0]) && /at /.test(rest.join('\n')));
});

test('secrets are redacted by key, also nested, and never reach the line', () => {
  const cap = capture();
  logger('x').info('auth', { token: 'abc123', ticket: 't1', Authorization: 'Bearer zzz', client_secret: 's', nested: { accessToken: 'q', ok: 1 } });
  cap.stop();
  assert.doesNotMatch(cap.lines[0], /abc123|t1\b|zzz|=s\b|"q"/);
  assert.equal(cap.records[0].ctx.token, '[redacted]');
  assert.equal(cap.records[0].ctx.nested.accessToken, '[redacted]');
  assert.equal(cap.records[0].ctx.nested.ok, 1);
});

test('capture() records every level regardless of LOG_LEVEL, keeps the stream silent, and stop() ends it', () => {
  const streamed = [];
  configure({ level: 'error', sink: (r) => streamed.push(r) });
  const cap = capture();
  logger('x').debug('d');
  assert.equal(cap.records.length, 1);
  assert.equal(streamed.length, 0);
  cap.stop();
  logger('x').debug('d2');
  logger('x').error('e');
  assert.equal(cap.records.length, 1);
  assert.deepEqual(streamed.map((r) => r.message), ['e']);
});

test('installConsole (absorbed log-level.js): level gates console methods, log counts as info, restore() undoes it', () => {
  const seen = [];
  const c = {};
  for (const m of ['error', 'warn', 'info', 'log', 'debug']) c[m] = (...a) => seen.push([m, ...a]);
  const restore = installConsole(c, 'warn');
  for (const m of ['error', 'warn', 'info', 'log', 'debug']) c[m](m, { a: 1 });
  assert.deepEqual(seen.map((s) => s[0]), ['error', 'warn']);
  assert.deepEqual(seen[0], ['error', 'error', { a: 1 }]);
  restore();
  c.info('back');
  assert.equal(seen.length, 3);
});

test('installConsole warns once about an unknown level', () => {
  const seen = [];
  const c = { warn: (...a) => seen.push(a), error() {}, info() {}, log() {}, debug() {} };
  installConsole(c, 'verbose');
  installConsole(c, 'verbose');
  assert.equal(seen.length, 1);
  assert.match(seen[0][0], /LOG_LEVEL="verbose"/);
});
