'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadJSON, saveJSON } = require('../json-file');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'json-file-')); }

test('saveJSON round-trips and leaves no temp file', () => {
  const d = tmpDir();
  try {
    const f = path.join(d, 'a.json');
    saveJSON(f, { a: 1 });
    assert.deepEqual(loadJSON(f, null), { a: 1 });
    assert.deepEqual(fs.readdirSync(d), ['a.json']);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('a crash mid-write leaves the old file intact', () => {
  const d = tmpDir();
  const realRename = fs.renameSync;
  try {
    const f = path.join(d, 'a.json');
    saveJSON(f, { old: true });
    fs.renameSync = () => { throw new Error('simulated crash before rename'); };
    assert.throws(() => saveJSON(f, { old: false }), /simulated crash/);
    fs.renameSync = realRename;
    assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { old: true });
    assert.deepEqual(fs.readdirSync(d), ['a.json']);
  } finally { fs.renameSync = realRename; fs.rmSync(d, { recursive: true, force: true }); }
});

test('a missing file gives the fallback and creates nothing', () => {
  const d = tmpDir();
  try {
    assert.deepEqual(loadJSON(path.join(d, 'none.json'), []), []);
    assert.deepEqual(fs.readdirSync(d), []);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('a corrupt file is set aside, not lost, and a later save does not overwrite it', () => {
  const d = tmpDir();
  const origErr = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const f = path.join(d, 'voice.json');
    fs.writeFileSync(f, '{"members": {"1": {"da');
    assert.deepEqual(loadJSON(f, {}), {});
    assert.ok(!fs.existsSync(f));
    const aside = fs.readdirSync(d).filter((n) => n.startsWith('voice.json.corrupt-'));
    assert.equal(aside.length, 1);
    assert.equal(fs.readFileSync(path.join(d, aside[0]), 'utf8'), '{"members": {"1": {"da');
    assert.ok(logged.some((l) => l.includes('set aside')));
    saveJSON(f, {});
    assert.equal(fs.readFileSync(path.join(d, aside[0]), 'utf8'), '{"members": {"1": {"da');
  } finally { console.error = origErr; fs.rmSync(d, { recursive: true, force: true }); }
});
