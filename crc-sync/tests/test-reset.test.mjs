// The Playwright reset hook must be impossible to enable in production (docs/wip/E2EH.md, Q3-14).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { mountTestReset, RESET_EXIT_CODE } = require('../src/test-reset.js');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakeApp() {
  const routes = [];
  return { routes, get: (p, ...h) => routes.push(['GET', p, h]), post: (p, ...h) => routes.push(['POST', p, h]) };
}

test('mounts nothing unless CRCSYNC_TEST_RESET is exactly "1"', () => {
  for (const v of [undefined, '', '0', 'true', 'yes', ' 1']) {
    const app = fakeApp();
    assert.equal(mountTestReset(app, { env: v === undefined ? {} : { CRCSYNC_TEST_RESET: v } }), false);
    assert.equal(app.routes.length, 0, `value ${JSON.stringify(v)} must not mount`);
  }
});

test('refuses to mount under NODE_ENV=production', () => {
  assert.throws(() => mountTestReset(fakeApp(), { env: { CRCSYNC_TEST_RESET: '1', NODE_ENV: 'production' } }), /never run in production/);
});

test('mounted routes answer loopback peers only and reset exits with the supervisor code', async () => {
  const app = fakeApp();
  let exitCode = null;
  assert.equal(mountTestReset(app, { env: { CRCSYNC_TEST_RESET: '1' }, exit: (c) => { exitCode = c; }, delayMs: 1 }), true);
  const reset = app.routes.find(([m, p]) => m === 'POST' && p === '/__test/reset');
  assert.ok(reset);
  const [guard, handler] = reset[2];
  const mk = (addr) => { const r = { req: { socket: { remoteAddress: addr } }, status: null, body: null, ended: false };
    r.res = { status(c) { r.status = c; return this; }, end() { r.ended = true; }, json(b) { r.body = b; } }; return r; };
  const remote = mk('10.0.0.5'); let nexted = false;
  guard(remote.req, remote.res, () => { nexted = true; });
  assert.equal(nexted, false); assert.equal(remote.status, 404);
  const local = mk('::ffff:127.0.0.1');
  guard(local.req, local.res, () => handler(local.req, local.res));
  assert.equal(local.body.ok, true);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(exitCode, RESET_EXIT_CODE);
});

test('nothing shipped sets CRCSYNC_TEST_RESET', () => {
  const files = [
    path.join(ROOT, 'Dockerfile'),
    path.join(ROOT, '..', 'infra', 'docker-compose.yml'),
    path.join(ROOT, '..', '.env.example'),
  ].filter((f) => fs.existsSync(f));
  assert.ok(files.length >= 2);
  for (const f of files) assert.ok(!fs.readFileSync(f, 'utf8').includes('CRCSYNC_TEST_RESET'), `${f} must not mention the test reset variable`);
});

function boot(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crc-reset-test-'));
  const port = 3300 + Math.floor(Math.random() * 600);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: {
      ...process.env, PORT: String(port), CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: path.join(dir, 'b.json'),
      CRCSYNC_EFSP_MUTATION_LOG_PATH: path.join(dir, 'm.jsonl'), CRCSYNC_TERRAIN_CACHE_DIR: path.join(dir, 't'),
      DCS_GRPC_HOST: '127.0.0.1:1', SRS_HOST: '127.0.0.1', SRS_PORT: '1', CRCSYNC_TEST_RESET: undefined, ...env,
    },
  });
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  return { child, port, exited };
}
async function up(port) {
  for (let i = 0; i < 100; i++) {
    try { await fetch(`http://127.0.0.1:${port}/__test/boot`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not come up');
}

test('the real server without the env var has no reset route and survives a POST', async () => {
  const s = boot({});
  try {
    await up(s.port);
    const boot1 = await fetch(`http://127.0.0.1:${s.port}/__test/boot`);
    assert.equal(boot1.status, 404);
    const r = await fetch(`http://127.0.0.1:${s.port}/__test/reset`, { method: 'POST' });
    assert.equal(r.status, 404);
    await new Promise((r2) => setTimeout(r2, 300));
    assert.equal(s.child.exitCode, null, 'the process must still be running');
  } finally { s.child.kill(); await s.exited; }
});

test('the real server with the env var resets by exiting 75', async () => {
  const s = boot({ CRCSYNC_TEST_RESET: '1' });
  try {
    await up(s.port);
    const b = await (await fetch(`http://127.0.0.1:${s.port}/__test/boot`)).json();
    assert.ok(b.bootId);
    const r = await fetch(`http://127.0.0.1:${s.port}/__test/reset`, { method: 'POST' });
    assert.equal(r.status, 200);
    assert.equal(await s.exited, RESET_EXIT_CODE);
  } finally { s.child.kill(); }
});
