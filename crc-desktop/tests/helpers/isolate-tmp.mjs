// Preloaded by `npm test` (`--import`; works for the CommonJS and the ES-module test files alike). Gives the test
// process a private TMPDIR root and removes it on exit, so the mkdtemp dirs of the tests leave nothing in /tmp.
// Child processes inherit TMPDIR and the owner marker, so only the outermost process creates and removes the root.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.CRC_TEST_TMP_OWNER) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crc-desktop-test-'));
  process.env.TMPDIR = root;
  process.env.CRC_TEST_TMP_OWNER = String(process.pid);
  process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
}
