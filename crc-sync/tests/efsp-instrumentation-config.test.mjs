import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// docs/adr/0065 — the WP8 policy file. A tuning file (decisions.md P5): read
// once, never written. Both directories are pointed at temp dirs BEFORE the
// module (and state-paths.js, which reads them at load) is imported.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-instr-config-'));
const CONFIG = path.join(tmp, 'config');
const STATE = path.join(tmp, 'state');
fs.mkdirSync(CONFIG);
fs.mkdirSync(STATE);
process.env.CRCSYNC_CONFIG_DIR = CONFIG;
process.env.CRCSYNC_STATE_DIR = STATE;
delete process.env.CRCSYNC_EFSP_INSTRUMENTATION_CONFIG_PATH;

// The module loads at import — with writeFileSync stubbed to throw, so a load
// that writes anything fails the import itself.
const realWrite = fs.writeFileSync;
const realAppend = fs.appendFileSync;
fs.writeFileSync = () => { throw new Error('instrumentation-config must never write'); };
fs.appendFileSync = () => { throw new Error('instrumentation-config must never write'); };
const mod = await import('../src/efsp/instrumentation-config.js');
fs.writeFileSync = realWrite;
fs.appendFileSync = realAppend;

const {
  DEFAULT_INSTRUMENTATION_CONFIG, getInstrumentationConfig, loadInstrumentationConfig,
  normalizeInstrumentationConfig, resolveInstrumentationConfigPath,
} = mod;

function quietly(fn) {
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try { return { value: fn(), warns }; } finally { console.warn = orig; }
}

test('with no file anywhere the defaults apply: 30-day log, 30-day metrics, 400-day count, INCIRLIK -> LTAG', () => {
  // The module-level load happened with both dirs empty.
  const c = getInstrumentationConfig();
  assert.deepEqual(c, {
    mutationLog: { retentionDays: 30 },
    metrics: { retentionDays: 30 },
    trafficCount: { retentionDays: 400, homeAirports: { INCIRLIK: ['LTAG'] } },
  });
  assert.equal(c, DEFAULT_INSTRUMENTATION_CONFIG);
});

test('the shipped default is read from config/, and a state/ copy wins over it', () => {
  fs.writeFileSync(path.join(CONFIG, 'efsp-instrumentation.json'), JSON.stringify({ mutationLog: { retentionDays: 45 } }));
  assert.equal(resolveInstrumentationConfigPath(), path.join(CONFIG, 'efsp-instrumentation.json'));
  assert.equal(loadInstrumentationConfig().mutationLog.retentionDays, 45);

  fs.writeFileSync(path.join(STATE, 'efsp-instrumentation.json'), JSON.stringify({ mutationLog: { retentionDays: 60 } }));
  assert.equal(resolveInstrumentationConfigPath(), path.join(STATE, 'efsp-instrumentation.json'));
  assert.equal(loadInstrumentationConfig().mutationLog.retentionDays, 60);
  fs.unlinkSync(path.join(STATE, 'efsp-instrumentation.json'));
  fs.unlinkSync(path.join(CONFIG, 'efsp-instrumentation.json'));
});

test('an invalid retentionDays falls back PER FIELD, with a warning — never "keep forever"', () => {
  for (const bad of [0, -1, '30', 1.5, null]) {
    const { value, warns } = quietly(() => normalizeInstrumentationConfig({
      mutationLog: { retentionDays: bad },
      metrics: { retentionDays: 7 },
    }));
    assert.equal(value.mutationLog.retentionDays, 30, `bad value ${JSON.stringify(bad)}`);
    assert.equal(value.metrics.retentionDays, 7, 'the valid sibling field is kept');
    assert.equal(value.trafficCount.retentionDays, 400);
    assert.ok(warns.some(w => w.includes('mutationLog.retentionDays')), `warned for ${JSON.stringify(bad)}`);
  }
});

test('homeAirports are trimmed and uppercased; a Facility not listed has none', () => {
  const { value } = quietly(() => normalizeInstrumentationConfig({
    trafficCount: { homeAirports: { INCIRLIK: [' ltag ', 'LTAN'], CENTER: 'LTAC' } },
  }));
  assert.deepEqual(value.trafficCount.homeAirports.INCIRLIK, ['LTAG', 'LTAN']);
  assert.equal(value.trafficCount.homeAirports.CENTER, undefined, 'a non-list is dropped, not guessed');
});

test('an unparseable file is the defaults, with a warning', () => {
  const p = path.join(tmp, 'broken.json');
  fs.writeFileSync(p, '{ not json');
  const { value, warns } = quietly(() => loadInstrumentationConfig(p));
  assert.equal(value, DEFAULT_INSTRUMENTATION_CONFIG);
  assert.ok(warns.length > 0);
});

test('the result is deeply frozen', () => {
  const c = normalizeInstrumentationConfig({});
  assert.ok(Object.isFrozen(c));
  assert.ok(Object.isFrozen(c.trafficCount.homeAirports));
  assert.ok(Object.isFrozen(c.trafficCount.homeAirports.INCIRLIK));
  assert.throws(() => { 'use strict'; c.mutationLog.retentionDays = 1; }, TypeError);
});

test('the shipped config file parses to exactly the defaults', () => {
  const shipped = new URL('../config/efsp-instrumentation.json', import.meta.url);
  const value = loadInstrumentationConfig(shipped.pathname);
  assert.deepEqual(value, DEFAULT_INSTRUMENTATION_CONFIG);
});
