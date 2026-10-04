// A refusal code the server can send must be listed in src/efsp/refusal-codes.js (and so worded by the client).
// The scan reads source: a code in an `ok: false` object, or passed to a refuse/fail helper.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { REFUSAL_CODES } = require('../src/efsp/refusal-codes.js');

const SRC = new URL('../src/', import.meta.url).pathname;
function walk(d, out = []) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

function scan() {
  const found = new Map();
  const pats = [
    /ok: ?false[^\n]*reason: ?'([A-Z][A-Z_]{3,})'/g,
    /reason: ?'([A-Z][A-Z_]{3,})'[^\n]*ok: ?false/g,
    /\b_?(?:refuse|_fail|fail|verr|reject|refusal)\w*\([^)]*'([A-Z][A-Z_]{3,})'/g,
  ];
  for (const f of walk(SRC)) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return;
      for (const re of pats) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(l))) { if (!found.has(m[1])) found.set(m[1], `${path.relative(SRC, f)}:${i + 1}`); }
      }
    });
  }
  return found;
}

test('every refusal code in source is in REFUSAL_CODES', () => {
  const found = scan();
  assert.ok(found.size >= 10, 'the scan finds the codes at all');
  const missing = [...found].filter(([c]) => !REFUSAL_CODES.includes(c)).map(([c, at]) => `${c} (${at})`);
  assert.deepEqual(missing, [], 'add these to src/efsp/refusal-codes.js and to crc-desktop panel/refusal.js MUTATION_ERROR_MESSAGES');
});

test('every code in REFUSAL_CODES is still sent somewhere', () => {
  const found = scan();
  // UNDO_* are built by a helper the scan reads as a plain literal too; INTERNAL_ERROR by board-store's catch.
  assert.deepEqual(REFUSAL_CODES.filter(c => !found.has(c)), []);
});
