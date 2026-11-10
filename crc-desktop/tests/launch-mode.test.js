'use strict';

// crc-desktop's two launch modes (docs/adr/0161 §1): launch-mode.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  launchModePath, readLaunchMode, writeLaunchMode, modeFromArgs, resolveLaunchMode, radioClientFor, windowFor, relaunchOptions,
  appImageRelaunch, switchLaunchMode,
} = require('../launch-mode');

function tmpFile() {
  return launchModePath(fs.mkdtempSync(path.join(os.tmpdir(), 'launch-mode-')));
}

test('no file means full', () => {
  assert.equal(readLaunchMode(tmpFile()), 'full');
});

test('a written mode reads back, and the file holds exactly the ADR\'s shape', () => {
  const file = tmpFile();
  assert.equal(writeLaunchMode(file, 'radio'), true);
  assert.equal(readLaunchMode(file), 'radio');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mode: 'radio' });
  assert.equal(writeLaunchMode(file, 'full'), true);
  assert.equal(readLaunchMode(file), 'full');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['launch-mode.json'], 'no temporary file is left');
});

test('a write creates a userData directory that does not exist yet', () => {
  const file = path.join(path.dirname(tmpFile()), 'not-yet', 'launch-mode.json');
  assert.equal(writeLaunchMode(file, 'radio'), true);
  assert.equal(readLaunchMode(file), 'radio');
});

test('anything but a mode is refused and writes nothing', () => {
  const file = tmpFile();
  for (const bad of ['RADIO', '', null, undefined, 1, {}]) assert.equal(writeLaunchMode(file, bad), false);
  assert.equal(fs.existsSync(file), false);
});

test('invalid content falls back to full', () => {
  const file = tmpFile();
  for (const content of ['not json', 'null', '[]', '{"mode":"other"}', '{}']) {
    fs.writeFileSync(file, content);
    assert.equal(readLaunchMode(file), 'full', content);
  }
});

test('the command line overrides the file for that run, and does not write it', () => {
  const file = tmpFile();
  writeLaunchMode(file, 'radio');
  assert.equal(resolveLaunchMode(file, ['crc', '--full']), 'full');
  assert.equal(readLaunchMode(file), 'radio');
  writeLaunchMode(file, 'full');
  assert.equal(resolveLaunchMode(file, ['crc', '--radio-only']), 'radio');
  assert.equal(resolveLaunchMode(file, ['crc']), 'full');
});

test('the last flag wins; other arguments are no flags', () => {
  assert.equal(modeFromArgs(['crc', '--full', '--radio-only']), 'radio');
  assert.equal(modeFromArgs(['crc', '--radio-only', '--full']), 'full');
  assert.equal(modeFromArgs(['crc', '.', '--no-sandbox', '--radio', 'full']), null);
});

test('radio-only always runs the built-in radio; full keeps what config.json chose', () => {
  assert.equal(radioClientFor('radio', 'lxsrs'), 'node');
  assert.equal(radioClientFor('radio', 'node'), 'node');
  assert.equal(radioClientFor('full', 'lxsrs'), 'lxsrs');
  assert.equal(radioClientFor('full', 'node'), 'node');
});

test('each mode has its window', () => {
  assert.deepEqual(windowFor('radio'), { width: 640, height: 480, page: '/radio-only.html', titlePrefix: 'CRC RADIO' });
  assert.deepEqual(windowFor('full'), { width: 1400, height: 900, page: '/', titlePrefix: 'CRC' });
});

test('a relaunch drops an override, so a pinned shortcut does not undo the switch, and keeps the other arguments', () => {
  assert.deepEqual(relaunchOptions(['/x/electron', '.', '--radio-only', '--no-sandbox'], {}), { args: ['.', '--no-sandbox'] });
  assert.deepEqual(relaunchOptions(['/x/crc', '--full'], {}), { args: [] });
});

test('an AppImage relaunches through its own file', () => {
  assert.deepEqual(relaunchOptions(['/tmp/.mount_x/crc', '--radio-only'], { APPIMAGE: '/home/u/CRC.AppImage' }), { execPath: '/home/u/CRC.AppImage', args: [] });
});

function switchRig({ env = {}, filePath = tmpFile() } = {}) {
  const calls = [];
  const autoUpdater = { autoInstallOnAppQuit: true };
  const note = (name) => (...args) => calls.push([name, autoUpdater.autoInstallOnAppQuit, ...args]);
  const deps = {
    filePath, env, argv: ['/x/crc', '--radio-only', '--no-sandbox'], autoUpdater,
    app: { relaunch: note('relaunch'), quit: note('quit'), exit: note('exit') },
    spawn: (...args) => { note('spawn')(...args); return { unref: note('unref') }; },
    runQuitHandlers: note('quit-handlers'),
  };
  return { calls, deps, autoUpdater, filePath };
}

test('a switch stores the mode, stops the update installing on this quit, then relaunches and quits', () => {
  const { calls, deps, filePath } = switchRig();
  assert.equal(switchLaunchMode('full', deps), true);
  assert.equal(readLaunchMode(filePath), 'full');
  assert.deepEqual(calls, [['relaunch', false, { args: ['--no-sandbox'] }], ['quit', false]]);
});

test('an AppImage switch spawns a delayed relaunch, runs the quit handlers itself, and exits', () => {
  const { calls, deps } = switchRig({ env: { APPIMAGE: '/home/u/my CRC.AppImage' } });
  assert.equal(switchLaunchMode('radio', deps), true);
  assert.deepEqual(calls.map(c => c[0]), ['spawn', 'unref', 'quit-handlers', 'exit']);
  assert.ok(calls.every(c => c[1] === false), 'the update is held back before anything else');
  assert.deepEqual(calls[0].slice(2), ['sh', ['-c', 'sleep 1; exec "$0" "$@"', '/home/u/my CRC.AppImage', '--no-sandbox'], { detached: true, stdio: 'ignore' }]);
  assert.deepEqual(calls[3].slice(2), [0]);
});

test('a refused mode changes nothing: no relaunch, and the update still installs on a later quit', () => {
  const { calls, deps, autoUpdater } = switchRig();
  assert.equal(switchLaunchMode('nonsense', deps), false);
  assert.deepEqual(calls, []);
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);
});

test('the AppImage path is an argument, never shell text', () => {
  assert.deepEqual(appImageRelaunch('/a/$(x).AppImage', []).args, ['-c', 'sleep 1; exec "$0" "$@"', '/a/$(x).AppImage']);
});

test('main.js takes the single-instance lock before the local server is required, and only focuses on a second launch', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const lock = main.indexOf('app.requestSingleInstanceLock()');
  assert.ok(lock > 0 && lock < main.indexOf("require('./app/server.js')"));
  const second = main.slice(main.indexOf("app.on('second-instance'"), main.indexOf('let nodeProc'));
  assert.match(second, /win\.focus\(\)/);
  assert.doesNotMatch(second, /argv|writeLaunchMode|relaunch/);
  assert.match(main, /if \(!isFirstInstance\) return;/);
});

test('main.js never throttles the radio-only window, and only that one here', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /if \(launchMode === RADIO\) win\.webContents\.setBackgroundThrottling\(false\);/);
});
