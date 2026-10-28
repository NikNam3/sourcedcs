// The Playwright harness's crc-sync, booted in `npm test` (ARCH-W 5.5, E2E-STAB).
//
// `371bedde` changed a state file's shape and every spec died: the harness's crc-sync refused to start on the file the
// harness wrote, and nobody ran Playwright to find out. This builds the environment and the state directory exactly as
// playwright.config.js and the reset supervisor do (e2e/helpers/harness-env.js, shared), starts the real server.js on an
// ephemeral port, waits for it to listen, and does one /feed round trip, so a change to a state or config shape (or to a
// handler that throws at the first frame, as S-WIREfix's did) trips here in about two seconds.
//
// It needs crc-sync's dependencies. crc-desktop's release job installs only crc-desktop, so there it is skipped, with
// the reason; crc-sync-docker.yml installs both and runs it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { SYNC_DIR, syncEnv, seedState } = require('../e2e/helpers/harness-env.js');
const haveSync = fs.existsSync(path.join(SYNC_DIR, 'node_modules', 'express'));
const skip = haveSync ? false : 'crc-sync/node_modules is not installed (run `npm ci` in crc-sync)';

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeToken = (name) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: name, name, exp: Math.floor(Date.now() / 1000) + 3600 })}.e2e`;

test('crc-sync boots on the harness environment and answers a /feed round trip', { skip, timeout: 30000 }, async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crc-e2e-boot-'));
  const port = await freePort();
  seedState(stateDir);
  const env = { ...process.env, ...syncEnv(stateDir, port), CRCSYNC_TEST_RESET: '1' };
  delete env.NODE_ENV;
  let output = '';
  const child = spawn(process.execPath, ['server.js'], { cwd: SYNC_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  try {
    // Reaches listening, or the process exits first and its own output says why.
    const up = async () => {
      for (;;) {
        if (child.exitCode !== null) throw new Error(`crc-sync exited ${child.exitCode} before listening:\n${output.slice(-2000)}`);
        try { const r = await fetch(`http://127.0.0.1:${port}/__test/boot`); if (r.ok) return; } catch (_) { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    await up();

    // The same three steps the client takes: a ticket for a bearer token, the feed with the protocol, a declaration of Positions.
    const { WIRE_PROTOCOL } = require(path.join(SYNC_DIR, 'src', 'wire-protocol.js'));
    const res = await fetch(`http://127.0.0.1:${port}/api/ws-ticket`, { method: 'POST', headers: { Authorization: `Bearer ${fakeToken('e2e-boot')}` } });
    assert.equal(res.status, 200, 'the ticket endpoint answers a well-formed bearer token');
    const { ticket } = await res.json();
    const WebSocket = createRequire(path.join(SYNC_DIR, 'package.json'))('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/feed?ticket=${encodeURIComponent(ticket)}&protocol=${WIRE_PROTOCOL}&client=e2e-boot`);
    const types = [];
    const ack = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no efsp-positions-ack in 10 s; frames seen: ${types.join(', ')}\n${output.slice(-1500)}`)), 10000);
      ws.on('error', reject);
      ws.on('close', (code) => { if (code === 4426) reject(new Error('update-required: the harness and crc-sync disagree about the wire protocol')); });
      ws.on('open', () => ws.send(JSON.stringify({ version: 1, type: 'efsp-set-positions', facilityId: 'INCIRLIK', signedOn: ['OPS'] })));
      ws.on('message', (data) => {
        const msg = JSON.parse(String(data));
        types.push(msg.type);
        if (msg.type === 'efsp-positions-ack') { clearTimeout(timer); resolve(msg); }
      });
    });
    assert.deepEqual(ack.signedOn, ['OPS']);
    assert.ok(types.includes('efsp-snapshot') || types.length > 1, `the feed sent more than the ack: ${types.join(', ')}`);
    ws.close();
  } finally {
    child.kill('SIGTERM');
    await exited;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
