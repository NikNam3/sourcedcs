// The two lxsrs_v2 copies must be byte-identical (S-ARCH-71): `lxsrs_v2/lxsrs_v2/` is the source,
// `crc-desktop/python-pkg/lxsrs_v2/` is what the packaged app ships (pip-installed with --no-deps and committed).
// A drift means the installer ships a radio bridge nobody tested. Fix one by running
// crc-desktop/scripts/sync-lxsrs.sh and committing python-pkg/.
//
// Plain file walk, no python/pip, so it runs on every leg of the release matrix (windows included).
// Python bytecode caches are ignored; the dist-info metadata beside the vendored package is not compared.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = path.join(REPO, 'lxsrs_v2', 'lxsrs_v2');
const VENDORED = path.join(REPO, 'crc-desktop', 'python-pkg', 'lxsrs_v2');

const ignored = (name) => name === '__pycache__' || name.endsWith('.pyc');

function listFiles(root) {
  const out = [];
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (ignored(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out.push(r);
    }
  })('');
  return out.sort();
}

// Relative paths (with '/') that differ: only in a, only in b, or different bytes.
function diffTrees(a, b) {
  const fa = listFiles(a);
  const fb = listFiles(b);
  const inB = new Set(fb);
  const inA = new Set(fa);
  const onlyA = fa.filter((f) => !inB.has(f));
  const onlyB = fb.filter((f) => !inA.has(f));
  const changed = fa.filter((f) => inB.has(f)
    && !fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));
  return { onlyA, onlyB, changed };
}

function describeDiff({ onlyA, onlyB, changed }) {
  return [
    ...onlyA.map((f) => `only in lxsrs_v2/lxsrs_v2: ${f}`),
    ...onlyB.map((f) => `only in crc-desktop/python-pkg/lxsrs_v2: ${f}`),
    ...changed.map((f) => `differs: ${f}`),
  ];
}

test('lxsrs_v2: the vendored copy in crc-desktop/python-pkg matches the source package', () => {
  assert.ok(fs.existsSync(path.join(SOURCE, '__init__.py')), `source package missing at ${SOURCE}`);
  assert.ok(fs.existsSync(path.join(VENDORED, '__init__.py')), `vendored package missing at ${VENDORED}`);
  const lines = describeDiff(diffTrees(SOURCE, VENDORED));
  assert.deepEqual(lines, [], `lxsrs_v2 copies drifted (run crc-desktop/scripts/sync-lxsrs.sh and commit):\n  ${lines.join('\n  ')}`);
});

test('lxsrs_v2 diff: names every added, missing and changed file, ignores bytecode caches', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lxsrs-diff-'));
  try {
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    for (const d of [a, b]) {
      fs.mkdirSync(path.join(d, 'sub', '__pycache__'), { recursive: true });
      fs.writeFileSync(path.join(d, 'same.py'), 'x = 1\n');
      fs.writeFileSync(path.join(d, 'sub', '__pycache__', 'm.cpython-312.pyc'), d);
    }
    fs.writeFileSync(path.join(a, 'sub', 'edited.py'), 'y = 1\n');
    fs.writeFileSync(path.join(b, 'sub', 'edited.py'), 'y = 2\n');
    fs.writeFileSync(path.join(a, 'new.py'), '');
    fs.writeFileSync(path.join(b, 'sub', 'stale.wav'), '');
    fs.writeFileSync(path.join(b, 'stray.pyc'), '');
    assert.deepEqual(describeDiff(diffTrees(a, b)), [
      'only in lxsrs_v2/lxsrs_v2: new.py',
      'only in crc-desktop/python-pkg/lxsrs_v2: sub/stale.wav',
      'differs: sub/edited.py',
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
