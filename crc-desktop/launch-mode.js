'use strict';

// Which of crc-desktop's two launch modes runs (docs/adr/0161 §1): the full CRC, or the radio alone. Kept in
// userData/launch-mode.json as `{ "mode": "full" | "radio" }`; `--radio-only` and `--full` on the command line override
// it for that run, so a shortcut can pin either. Electron-free, for unit testing without a real Electron process (the
// lxsrs-setup.js pattern).

const fs = require('fs');
const path = require('path');

const FULL = 'full';
const RADIO = 'radio';
const FLAG_MODES = Object.freeze({ '--radio-only': RADIO, '--full': FULL });

const isLaunchMode = (mode) => mode === FULL || mode === RADIO;

function launchModePath(userDataDir) { return path.join(userDataDir, 'launch-mode.json'); }

/** The stored mode; `full` when the file is absent, unreadable or names anything else. */
function readLaunchMode(filePath) {
  try {
    const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return stored && isLaunchMode(stored.mode) ? stored.mode : FULL;
  } catch (_) {
    return FULL;
  }
}

/** Stores `mode`. False (and nothing written) for anything but a launch mode or when the write fails. */
function writeLaunchMode(filePath, mode) {
  if (!isLaunchMode(mode)) return false;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ mode }) + '\n');
    fs.renameSync(tmp, filePath);
    return true;
  } catch (err) {
    console.error('[launch-mode] could not store the mode:', err.message);
    return false;
  }
}

/** The mode a command line asks for, the last flag winning, or null when it asks for none. */
function modeFromArgs(argv) {
  let mode = null;
  for (const arg of argv) if (Object.hasOwn(FLAG_MODES, arg)) mode = FLAG_MODES[arg];
  return mode;
}

/** This run's mode: the command line's, else the stored one. */
function resolveLaunchMode(filePath, argv) { return modeFromArgs(argv) || readLaunchMode(filePath); }

/** Which SRS client runs: radio-only is always the built-in one, never lxsrs. */
function radioClientFor(mode, configured) { return mode === RADIO ? 'node' : configured; }

/** The window of a mode: its size and the local page it opens. */
function windowFor(mode) {
  return mode === RADIO
    ? { width: 640, height: 480, page: '/radio-only.html', titlePrefix: 'CRC RADIO' }
    : { width: 1400, height: 900, page: '/', titlePrefix: 'CRC' };
}

/**
 * `app.relaunch`'s options after a switch: this run's arguments without an override, or a `--radio-only` shortcut would
 * pin the mode just left. An AppImage relaunches through its own file: `process.execPath` is inside its mount, which goes
 * away when this process exits.
 */
function relaunchOptions(argv, env) {
  const args = argv.slice(1).filter(arg => !Object.hasOwn(FLAG_MODES, arg));
  return env.APPIMAGE ? { execPath: env.APPIMAGE, args } : { args };
}

module.exports = {
  FULL, RADIO, isLaunchMode, launchModePath, readLaunchMode, writeLaunchMode, modeFromArgs, resolveLaunchMode,
  radioClientFor, windowFor, relaunchOptions,
};
