// Preloaded by `npm test` (`--import`). Two jobs:
//  1. a private TMPDIR root, removed on exit, so tests' mkdtemp dirs leave nothing in /tmp;
//  2. clears every environment variable the server reads, so a developer's shell (a real AIRSPACE_SERVICE_TOKEN,
//     SOURCEDCS_CRCSYNC_URL, DISCORD_BOT_TOKEN, ...) cannot change what a test sees. A test sets what it needs itself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEYS = [
  'AIRSPACE_SERVICE_TOKEN', 'FLIGHT_PLAN_SERVICE_TOKEN', 'RELEASE_UPLOAD_TOKEN', 'SOURCEDCS_CRCSYNC_URL',
  'CASDOOR_CLIENT_ID', 'CASDOOR_CLIENT_SECRET', 'CASDOOR_ENDPOINT',
  'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID', 'APPLY_CHANNEL_ID', 'GRADING_CHANNEL_ID',
  'DISCORD_URL', 'WIKI_URL', 'ATO_URL', 'OLYMPUS_URL', 'CRCSYNC_URL', 'GITHUB_URL',
  'PORT', 'LOG_LEVEL',
];

if (!process.env.SDW_TEST_TMP_OWNER) {
  for (const k of KEYS) delete process.env[k];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sourcedcs-web-test-'));
  process.env.TMPDIR = root;
  process.env.SDW_TEST_TMP_OWNER = String(process.pid);
  process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
}
