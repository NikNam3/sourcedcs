'use strict';

/* Regression tests for the two real bugs found while shipping crc-desktop's
   autoupdate/packaging: an ENOTDIR crash from spawning with a cwd inside
   app.asar, and a first-run venv setup that silently reused a half-finished
   install after being interrupted. Both are exercised here without needing
   a real Electron process or a real Python/pip — see lxsrs-setup.js's own
   comments for why the logic lives there instead of main.js. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  computePythonPkgDir, computeRuntimeCwd, venvPaths, isVenvReady, ensureLxsrsVenv,
  lxsrsArgs,
} = require('../lxsrs-setup');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lxsrs-setup-test-'));
}

/* ══════════════════════════════════════════════════════════
   computePythonPkgDir / computeRuntimeCwd
   Regression: __dirname resolves inside app.asar when packaged -- a single
   file on disk, not a real directory. spawn()'s cwd can't chdir into it
   (ENOTDIR). Both functions must route to a real directory once packaged.
══════════════════════════════════════════════════════════ */

test('computePythonPkgDir: dev (unpackaged) uses dirname/python-pkg', () => {
  const result = computePythonPkgDir(false, '/some/resources/path', '/project/crc-desktop');
  assert.equal(result, path.join('/project/crc-desktop', 'python-pkg'));
});

test('computePythonPkgDir: packaged uses resourcesPath/python-pkg, not dirname', () => {
  const result = computePythonPkgDir(true, '/tmp/.mount_CRC-1.xyz/resources', '/tmp/.mount_CRC-1.xyz/resources/app.asar');
  assert.equal(result, path.join('/tmp/.mount_CRC-1.xyz/resources', 'python-pkg'));
  // The regression this guards: never derive the packaged path from
  // dirname, which is inside app.asar.
  assert.ok(!result.includes('app.asar'));
});

test('computeRuntimeCwd: dev (unpackaged) uses dirname', () => {
  const result = computeRuntimeCwd(false, '/home/user/.config/crc-desktop', '/project/crc-desktop');
  assert.equal(result, path.join('/project/crc-desktop'));
});

test('computeRuntimeCwd: packaged uses userDataPath, never a path inside app.asar', () => {
  const dirname = '/tmp/.mount_CRC-1.xyz/resources/app.asar';
  const result = computeRuntimeCwd(true, '/home/user/.config/crc-desktop', dirname);
  assert.equal(result, '/home/user/.config/crc-desktop');
  assert.ok(!result.includes('app.asar'), 'cwd must not resolve inside app.asar -- spawn() cannot chdir into a file (ENOTDIR)');
});

/* ══════════════════════════════════════════════════════════
   isVenvReady / venvPaths
   Regression: checking only "does venvPython exist" treats a venv that was
   created but never finished `pip install` (app closed, network dropped)
   as fully set up -- forever, since nothing ever retries it.
══════════════════════════════════════════════════════════ */

test('isVenvReady: false for a venv dir that does not exist at all', () => {
  const venvDir = path.join(tmpDir(), 'does-not-exist');
  assert.equal(isVenvReady(venvDir), false);
});

test('isVenvReady: false for a venv whose python3 exists but setup never completed', () => {
  // Reproduces the exact bug: a `python3 -m venv` step that succeeded, but
  // pip install got interrupted before finishing.
  const venvDir = tmpDir();
  fs.mkdirSync(path.join(venvDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(venvDir, 'bin', 'python3'), '');
  assert.equal(isVenvReady(venvDir), false);
});

test('isVenvReady: true once the completion marker is written', () => {
  const venvDir = tmpDir();
  const { completeMarker } = venvPaths(venvDir);
  fs.mkdirSync(path.dirname(completeMarker), { recursive: true });
  fs.writeFileSync(completeMarker, new Date().toISOString());
  assert.equal(isVenvReady(venvDir), true);
});

/* ══════════════════════════════════════════════════════════
   ensureLxsrsVenv — fake python3/pip via a stub script on PATH, so these
   run fast and offline (no real venv/network needed) while still exercising
   the real spawn/promise/retry logic in lxsrs-setup.js.
══════════════════════════════════════════════════════════ */

// Writes a fake `python3` onto PATH that: creates `<venvDir>/bin/python3`
// when run as `-m venv <dir>`, and exits with `pipExitCode` when run as
// `-m pip install ...` (so ensureLxsrsVenv's two runCmd calls both resolve
// against this one stub, matching how `venvPython` is just `<venvDir>/bin/python3`).
function stubPython3(binDir, pipExitCode) {
  fs.mkdirSync(binDir, { recursive: true });
  const stub = path.join(binDir, 'python3');
  fs.writeFileSync(stub, `#!/bin/sh
if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then
  mkdir -p "$3/bin"
  cp "$0" "$3/bin/python3"
  exit 0
fi
if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  exit ${pipExitCode}
fi
exit 1
`);
  fs.chmodSync(stub, 0o755);
  return stub;
}

function withStubOnPath(binDir, fn) {
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath}`;
  return Promise.resolve(fn()).finally(() => { process.env.PATH = originalPath; });
}

// stubPython3's fake is a POSIX shell script (#!/bin/sh + chmod +x) --
// Windows has no concept of executing that (no shebang interpretation, no
// exec bit; PATH resolution there is extension-based) and PATH itself
// isn't ':'-joined. spawn('python3', ...) just fails to find/run it, which
// happens to produce the same `null` result some of these tests expect
// anyway (for the wrong reason) and not others. Skip rather than chase a
// second, Windows-specific fake interpreter: ensureLxsrsVenv only ever
// runs on Linux in production (main.js's `if (IS_LINUX)` guard).
const SKIP_STUB_ON_WINDOWS = process.platform === 'win32'
  ? 'stubPython3 is a POSIX shell script; ensureLxsrsVenv is Linux-only in production'
  : false;

test('ensureLxsrsVenv: successful install writes the completion marker and returns venvPython', { skip: SKIP_STUB_ON_WINDOWS }, async () => {
  const root = tmpDir();
  const venvDir = path.join(root, 'venv');
  stubPython3(path.join(root, 'stub-bin'), 0);

  const logs = [];
  const result = await withStubOnPath(path.join(root, 'stub-bin'), () => ensureLxsrsVenv(venvDir, l => logs.push(l)));

  assert.equal(result, venvPaths(venvDir).venvPython);
  assert.equal(isVenvReady(venvDir), true);
  assert.ok(logs.some(l => l.includes('done')));
});

test('ensureLxsrsVenv: failed pip install does not write the marker and returns null', { skip: SKIP_STUB_ON_WINDOWS }, async () => {
  const root = tmpDir();
  const venvDir = path.join(root, 'venv');
  stubPython3(path.join(root, 'stub-bin'), 1); // pip install "fails"

  const logs = [];
  const result = await withStubOnPath(path.join(root, 'stub-bin'), () => ensureLxsrsVenv(venvDir, l => logs.push(l)));

  assert.equal(result, null);
  assert.equal(isVenvReady(venvDir), false);
  assert.ok(logs.some(l => l.includes('failed to set up')));
});

test('ensureLxsrsVenv: a half-finished venv from an interrupted run is retried, not silently reused', { skip: SKIP_STUB_ON_WINDOWS }, async () => {
  // This is the exact failure mode found while testing crc-desktop v1.0.9:
  // a first attempt got killed mid pip-install, leaving venvPython present
  // with no third-party deps and no marker; a second launch reused it as-is
  // and lxsrs crashed with "No module named 'opuslib'".
  const root = tmpDir();
  const venvDir = path.join(root, 'venv');
  fs.mkdirSync(path.join(venvDir, 'bin'), { recursive: true });
  // present (and executable, like a real interpreter), but no marker
  fs.writeFileSync(path.join(venvDir, 'bin', 'python3'), '#!/bin/sh\nexit 1\n');
  fs.chmodSync(path.join(venvDir, 'bin', 'python3'), 0o755);
  assert.equal(isVenvReady(venvDir), false);

  stubPython3(path.join(root, 'stub-bin'), 0); // this run "succeeds"
  const result = await withStubOnPath(path.join(root, 'stub-bin'), () => ensureLxsrsVenv(venvDir));

  assert.equal(result, venvPaths(venvDir).venvPython);
  assert.equal(isVenvReady(venvDir), true, 'must retry and complete setup instead of trusting the stale venv');
});

test('ensureLxsrsVenv: an already-complete venv is reused without re-running setup', async () => {
  const root = tmpDir();
  const venvDir = path.join(root, 'venv');
  const { venvPython, completeMarker } = venvPaths(venvDir);
  fs.mkdirSync(path.dirname(venvPython), { recursive: true });
  fs.writeFileSync(venvPython, '');
  fs.writeFileSync(completeMarker, new Date().toISOString());

  // No stub python3 on PATH at all -- if this tried to re-run setup, the
  // bare `spawn('python3', ...)` call would fail with ENOENT/reject.
  const result = await ensureLxsrsVenv(venvDir);
  assert.equal(result, venvPython);
});

// H147 RQ5: every frequency the bridge uses comes from config.json; an unset
// defaultFreq passes nothing, so the bridge leaves an added radio untuned.
test('lxsrsArgs: frequencies come from config, defaultFreq only when set', () => {
  const base = { freqs: ['262.500', '305.500'], txFreq: '262.500', srsHost: 'h', srsPort: 5002, srsApiPort: 5003 };
  const args = lxsrsArgs({ ...base, defaultFreq: '243.000' });
  assert.deepEqual(args, [
    '-m', 'lxsrs_v2', '--freq', '262.500', '--freq', '305.500', '--tx-freq', '262.500',
    '--default-freq', '243.000', '--host', 'h', '--port', '5002', '--play-audio', '--api-port', '5003',
  ]);
  assert.equal(lxsrsArgs(base).includes('--default-freq'), false);
});

test('config.json names the bridge frequencies, main.js has none of its own', () => {
  const config = require('../config.json');
  assert.ok(Array.isArray(config.freqs) && config.freqs.length > 0);
  assert.ok(config.defaultFreq, 'config.json defaultFreq: the frequency an added radio tunes to');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.doesNotMatch(main, /\b2[0-9]{2}\.[0-9]{1,3}\b|[0-9]{3}_?000_?000/);
  assert.match(main, /lxsrsArgs\(config\)/);
});
