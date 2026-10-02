// Preloaded by `npm test` and `npm run freeze` (package.json `--import`): every crc-sync test process gets its own
// empty state/ directory unless the test sets CRCSYNC_STATE_DIR itself. Without this, a test that builds the EFSP
// without overriding every path read and wrote the checkout's real crc-sync/state/ (a developer's live data).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.CRCSYNC_STATE_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crcsync-test-state-'));
  process.env.CRCSYNC_STATE_DIR = dir;
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
}
