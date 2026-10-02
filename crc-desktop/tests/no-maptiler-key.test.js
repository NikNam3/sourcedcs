'use strict';
// MAPKEY (H82 R3-39): crc-desktop holds no MapTiler key; crc-sync hands it over after login. The old shipped
// key is in git history, so only revoking it at MapTiler retires it (infra/RUNBOOK.md "Rotating the MapTiler
// key"). This pins that none comes back, without writing the old value here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const files = execFileSync('git', ['ls-files', '-z', '--', '.'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean)
  .filter((f) => !/(^|\/)package-lock\.json$/.test(f) && !/\.(png|jpg|ico|icns|svg|webp|gif|zip|whl|pbf)$/i.test(f));

const KEY_PARAM = /key=[A-Za-z0-9]{16,}/;
// The old key's shape: a quoted 20-character alphanumeric token mixing upper case, lower case and digits.
const QUOTED_20 = /['"`]([A-Za-z0-9]{20})['"`]/g;
const mixed = (s) => /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s);

test('no tracked file under crc-desktop/ holds a MapTiler key', () => {
  assert.ok(files.length > 100);
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { continue; }
    assert.ok(!KEY_PARAM.test(text), `${f}: key=<token>`);
    for (const m of text.matchAll(QUOTED_20)) assert.ok(!mixed(m[1]), `${f}: a quoted 20-character mixed token that looks like a key`);
  }
});

test('the key module is gone and the style carries no key placeholder', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'app/maptiler.js')));
  const style = fs.readFileSync(path.join(ROOT, 'app/public/crc-desktop-scope-style.json'), 'utf8');
  assert.ok(!/key=|__MAPTILER_KEY__/.test(style));
});
