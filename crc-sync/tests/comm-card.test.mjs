import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// config/comm-card.json (R3-53, H31, DATA-3): the loader, the validator and the approach rule that reads it.
const require = createRequire(import.meta.url);
const { loadCommCard, validateCommCard } = require('../src/comm-card.js');
const { validateCarrierFlightField } = require('../src/efsp/carrier/flight-record.js');
const FILLED = JSON.parse(fs.readFileSync(new URL('./fixtures/comm-card/filled-example.json', import.meta.url), 'utf8'));
const SHIPPED = loadCommCard();

function tmp(obj) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crcsync-comm-')), 'comm-card.json');
  fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return f;
}

test('the shipped card: today\'s five approach types, range 1..20, no buttons and no frequencies yet', () => {
  assert.deepEqual(SHIPPED.approachTypes, ['TACAN', 'ICLS', 'ACLS', 'PAR', 'VISUAL']);
  assert.deepEqual(SHIPPED.approachButtons, { min: 1, max: 20, buttons: [] });
  assert.deepEqual(SHIPPED.frequencies, []);
});

test('empty buttons: today\'s integer range; the refusal names the source', () => {
  assert.deepEqual(validateCarrierFlightField('approachButton', 20, SHIPPED), { ok: true, value: 20 });
  assert.deepEqual(validateCarrierFlightField('approachButton', '1', SHIPPED), { ok: true, value: 1 });
  for (const v of [0, 21, 'x']) {
    const r = validateCarrierFlightField('approachButton', v, SHIPPED);
    assert.equal(r.ok, false, String(v));
    assert.match(r.detail, /an integer 1\.\.20 \(config\/comm-card\.json approachButtons min\/max\)/);
  }
  assert.match(validateCarrierFlightField('approachButton', '305.5', SHIPPED).detail, /looks like a frequency/);
});

test('a filled list: membership in buttons[].button, and the card\'s own approach types', () => {
  validateCommCard(FILLED);
  assert.deepEqual(validateCarrierFlightField('approachButton', 7, FILLED), { ok: true, value: 7 });
  const r = validateCarrierFlightField('approachButton', 5, FILLED);
  assert.equal(r.ok, false);
  assert.match(r.detail, /one of 3, 7, 12 \(the squadron's list, config\/comm-card\.json approachButtons\.buttons\)/);
  assert.deepEqual(validateCarrierFlightField('approachType', 'marshal', FILLED), { ok: true, value: 'MARSHAL' });
  assert.equal(validateCarrierFlightField('approachType', 'marshal', SHIPPED).ok, false);
});

test('a state layer overrides key by key; an unknown key, a bad value or an unparseable shipped file stops start-up naming file and key', () => {
  assert.deepEqual(loadCommCard(tmp({ approachButtons: FILLED.approachButtons })).approachButtons.buttons.map((b) => b.button), [3, 7, 12]);
  assert.deepEqual(loadCommCard(tmp({ approachButtons: FILLED.approachButtons })).approachTypes, SHIPPED.approachTypes);
  assert.throws(() => loadCommCard(tmp({ approachButons: {} })), /unknown key "approachButons"/);
  assert.throws(() => loadCommCard(tmp({ approachButtons: { min: 1, max: 20, buttons: [{ button: 25, label: 'x' }] } })), /"approachButtons\.buttons\[0\]\.button" must be an integer within 1\.\.20/);
  assert.throws(() => loadCommCard(tmp({ approachButtons: { min: 1, max: 20, buttons: [{ button: 2, label: 'a' }, { button: 2, label: 'b' }] } })), /listed twice/);
  assert.throws(() => loadCommCard(tmp({ frequencies: [{ id: 'a', name: 'A', mhz: 1, use: 'bogus' }] })), /"frequencies\[0\]\.use" must be one of approach, tower/);
  assert.throws(() => loadCommCard(tmp({ approachTypes: ['tacan'] })), /"approachTypes"/);
});

test('a missing shipped file is a start-up error naming it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crcsync-comm-missing-'));
  const r = require('node:child_process').spawnSync(process.execPath, ['-e', `
    const fs = require('fs'); const path = require('path');
    const real = fs.readFileSync;
    fs.readFileSync = (f, ...a) => String(f).endsWith('comm-card.json') ? (() => { throw new Error('ENOENT: no such file'); })() : real(f, ...a);
    require(${JSON.stringify(path.resolve('src/comm-card.js'))}).loadCommCard();
  `], { encoding: 'utf8', env: { ...process.env, CRCSYNC_STATE_DIR: dir } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cannot read the shipped tuning file .*comm-card\.json/);
});
