'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureDesktopEntry, execLine } = require('../global-ptt/desktop-entry.js');

test('the portal desktop entry is written once per Exec, under XDG_DATA_HOME, hidden from menus', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'crc-de-'));
  const base = { platform: 'linux', env: { APPIMAGE: '/opt/CRC-2.3.2.AppImage' }, home, execPath: '/x/electron', appPath: '/x/app', packaged: true };
  assert.equal(ensureDesktopEntry(base), 'written');
  const file = path.join(home, '.local/share/applications/page.sourcedcs.crc.desktop');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^Exec="\/opt\/CRC-2\.3\.2\.AppImage"$/m);
  assert.match(text, /^NoDisplay=true$/m);
  assert.equal(ensureDesktopEntry(base), 'unchanged');
  assert.equal(ensureDesktopEntry({ ...base, env: { APPIMAGE: '/opt/CRC-2.3.3.AppImage' } }), 'written', 'a new AppImage path');
  assert.equal(ensureDesktopEntry({ ...base, platform: 'win32' }), 'skipped');
  fs.rmSync(home, { recursive: true, force: true });
});

test('development runs name the Electron binary and the app folder', () => {
  assert.equal(execLine({ env: {}, execPath: '/n/electron', appPath: '/w/crc-desktop', packaged: false }), '"/n/electron" "/w/crc-desktop"');
  assert.equal(execLine({ env: {}, execPath: '/usr/lib/crc/crc', packaged: true }), '"/usr/lib/crc/crc"');
});
