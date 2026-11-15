'use strict';

// The desktop entry the XDG portal looks CRC up by (docs/adr/0161 §3). The portal's Registry.Register(appId) answers
// "App info not found" unless `<appId>.desktop` is installed with an Exec that exists, and an AppImage installs none. An
// unregistered app has no id: KDE then keeps its shortcuts under nothing and its configure dialog has nothing to show
// (found on Fedora 44, Plasma 6.8, 2026-11-15). So on Linux CRC writes its own entry under ~/.local/share/applications,
// hidden from menus, and rewrites it when the Exec changed (a new AppImage path). Electron-free, for tests.

const path = require('path');

const APP_ID = 'page.sourcedcs.crc'; // build.appId, portal-listener.js APP_ID

const quote = (s) => `"${String(s).replace(/(["\\`$])/g, '\\$1')}"`;

/** The entry's text for this Exec. */
function desktopEntryText(exec) {
  return ['[Desktop Entry]', 'Type=Application', 'Name=CRC', 'Comment=SOURCE DCS controller client', `Exec=${exec}`,
    'NoDisplay=true', 'Terminal=false', ''].join('\n');
}

/** The command line that starts this CRC: the AppImage, else the Electron binary (with the app folder in development). */
function execLine({ env, execPath, appPath, packaged }) {
  if (env.APPIMAGE) return quote(env.APPIMAGE);
  return packaged ? quote(execPath) : `${quote(execPath)} ${quote(appPath)}`;
}

/**
 * Writes `<home>/.local/share/applications/page.sourcedcs.crc.desktop` when it is missing or names another Exec.
 * @returns {'written'|'unchanged'|'skipped'}  skipped: not Linux, no home
 */
function ensureDesktopEntry({ platform, env, home, execPath, appPath, packaged, fs = require('fs') }) {
  if (platform !== 'linux' || !home) return 'skipped';
  const dir = path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'applications');
  const file = path.join(dir, `${APP_ID}.desktop`);
  const text = desktopEntryText(execLine({ env, execPath, appPath, packaged }));
  let before = null;
  try { before = fs.readFileSync(file, 'utf8'); } catch { /* none yet */ }
  if (before === text) return 'unchanged';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, text);
  return 'written';
}

module.exports = { APP_ID, desktopEntryText, execLine, ensureDesktopEntry };
