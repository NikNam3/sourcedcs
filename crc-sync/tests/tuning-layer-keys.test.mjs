import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

// H88 item 8 / decisions.md S-RENA2: an operator layer in state/ may only name keys its shipped file has. A key the
// build does not know (an older build's name: `stca` before the W7 rename) is a startup error naming the file and
// the key, never a value silently ignored.

const require = createRequire(import.meta.url);
const { loadAlertingConfig } = require('../src/alerting-config');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tuning-layer-'));
const layer = (name, body) => { const p = path.join(tmp, name); fs.writeFileSync(p, JSON.stringify(body)); return p; };
const SRC = path.join(import.meta.dirname, '../src');
const CONFIG = path.join(import.meta.dirname, '../config');

test('a state/alerting.json with the pre-rename key "stca" stops start-up, naming the file and the key', () => {
  const p = layer('old.json', { stca: { lateralNm: 5 } });
  assert.throws(() => loadAlertingConfig(p), (e) => e.message.includes(p) && /unknown key "stca"/.test(e.message));
});

test('an unknown nested key is refused too; a _comment is free', () => {
  const p = layer('nested.json', { _comment: 'tuned for the exercise', conflictAlert: { lateralNmm: 5 } });
  assert.throws(() => loadAlertingConfig(p), /unknown key "conflictAlert\.lateralNmm"/);
});

test('a partial layer of known keys still overrides key by key', () => {
  const p = layer('ok.json', { _comment: 'x', conflictAlert: { lateralNm: 5 } });
  const c = loadAlertingConfig(p);
  assert.equal(c.conflictAlert.lateralNm, 5);
  assert.equal(c.conflictAlert.verticalFt, JSON.parse(fs.readFileSync(path.join(CONFIG, 'alerting.json'), 'utf8')).conflictAlert.verticalFt);
});

test('the shipped config/alerting.json holds only keys the code knows: its sections are what loadAlertingConfig returns, and every threshold is read in src/', () => {
  const shipped = JSON.parse(fs.readFileSync(path.join(CONFIG, 'alerting.json'), 'utf8'));
  assert.deepEqual(Object.keys(shipped).filter(k => !k.startsWith('_')).sort(), Object.keys(loadAlertingConfig()).sort());
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
  const code = walk(SRC).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  for (const [section, keys] of Object.entries(shipped)) {
    if (section.startsWith('_')) continue;
    for (const k of Object.keys(keys)) assert.match(code, new RegExp(`\\b${k}\\b`), `config/alerting.json ${section}.${k} is read nowhere in src/`);
  }
});
