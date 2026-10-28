const test = require('node:test');
const assert = require('node:assert');
const { createLogger, parseLevel } = require('../logger');

function sink() {
  const calls = [];
  return { calls, log: (...a) => calls.push(['log', ...a]), warn: (...a) => calls.push(['warn', ...a]), error: (...a) => calls.push(['error', ...a]) };
}
function emitAll(l) { l.error('e'); l.warn('w'); l.info('i'); l.debug('d'); }

test('default is info', () => {
  const s = sink(); emitAll(createLogger(undefined, s));
  assert.deepStrictEqual(s.calls.map((c) => c[1]), ['e', 'w', 'i']);
});
test('error prints only errors', () => {
  const s = sink(); emitAll(createLogger('error', s));
  assert.deepStrictEqual(s.calls.map((c) => c[1]), ['e']);
});
test('warn prints error and warn', () => {
  const s = sink(); emitAll(createLogger('warn', s));
  assert.deepStrictEqual(s.calls.map((c) => c[1]), ['e', 'w']);
});
test('debug prints everything', () => {
  const s = sink(); emitAll(createLogger('DEBUG', s));
  assert.deepStrictEqual(s.calls.map((c) => c[1]), ['e', 'w', 'i', 'd']);
});
test('unknown value falls back to info', () => {
  assert.strictEqual(parseLevel('verbose'), 'info');
  assert.strictEqual(parseLevel(''), 'info');
});
