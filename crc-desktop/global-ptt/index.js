'use strict';

// Global push-to-talk in the main process (docs/adr/0161 §3): picks a listener for this session, puts it behind the
// gate (ptt-gate.js holds the privacy rules, and the two channels, `ptt` and `intercom`, docs/adr/0166 §1), and owns the
// IPC with the renderer. Requiring this file loads nothing native, and nothing here may throw into main.js: a listener
// that cannot load just reports "not available".

const { createPttGate } = require('./ptt-gate');
const { createUiohookListener } = require('./uiohook-listener');
const { createPortalListener } = require('./portal-listener');
const { connectPortal } = require('./portal-client');

const CH = Object.freeze({
  status: 'global-ptt-status', configure: 'global-ptt-configure', capture: 'global-ptt-capture',
  cancelCapture: 'global-ptt-cancel-capture', edge: 'global-ptt-edge', fuse: 'global-ptt-fuse',
});
const OFF = Object.freeze({ enabled: false, binding: null, intercom: null });

/** Which listener this session can use: 'uiohook', 'portal' or null. */
function chooseListenerKind(platform, env) {
  if (platform === 'win32') return 'uiohook';
  if (platform !== 'linux') return null;
  // DISPLAY is set on Wayland too (XWayland), where a hook would start and hear next to nothing: the portal only.
  if (env.XDG_SESSION_TYPE === 'wayland' || env.WAYLAND_DISPLAY) return 'portal';
  return env.DISPLAY ? 'uiohook' : null;
}

function makeListener(kind, env) {
  if (kind === 'uiohook') return createUiohookListener();
  if (kind === 'portal') return createPortalListener({ connect: () => connectPortal({ env }) });
  return null;
}

const warn = (msg) => console.warn(`[global-ptt] ${msg}`);

let current = null;

/**
 * @param {object} win  the BrowserWindow
 * @param {object} [deps]  ipcMain, platform, env, makeListener (tests)
 */
function attach(win, deps = {}) {
  shutdown();
  try {
    const ipc = deps.ipcMain || require('electron').ipcMain;
    const env = deps.env || process.env;
    const kind = chooseListenerKind(deps.platform || process.platform, env);
    const listener = (deps.makeListener || makeListener)(kind, env);
    const wc = win.webContents;
    const sendEdge = (down, channel) => { if (!wc.isDestroyed()) wc.send(CH.edge, down, channel); };
    // S-RO-1 RO8: a hidden page's timers are throttled, and the transmit fuse is one. Off while a listener runs, then
    // back to what it was (radio-only keeps it off all the time, so that is what comes back).
    let throttling = true;
    const onRunning = (on) => {
      if (wc.isDestroyed()) return;
      if (on) { throttling = wc.getBackgroundThrottling(); wc.setBackgroundThrottling(false); }
      else wc.setBackgroundThrottling(throttling);
    };
    const gate = listener ? createPttGate({ listener, sendEdge, onRunning, warn }) : null;

    let reason = listener ? null : 'no-session';
    let probed = null;
    const available = () => (probed = probed || (listener
      ? listener.probe().then(() => true, (err) => {
        warn(`not available: ${err.message}`);
        reason = listener.kind === 'portal' ? 'no-portal' : 'no-native';
        return false;
      })
      : Promise.resolve(false)));
    const usable = async () => (gate && await available() ? gate : null);

    // Only the main window: the Casdoor popup and anything else have no business with this.
    const own = (fn, refused) => (event, arg) => (event.sender === wc ? fn(arg) : refused);
    const unavailable = { available: false, kind: null, reason: null, enabled: false, binding: null, intercom: null, running: false, capturing: false, failed: false };
    const statusOf = (g, s) => (g ? { available: true, kind: listener.kind, reason: null, ...s } : { ...unavailable, reason });

    ipc.handle(CH.status, own(async () => { const g = await usable(); return statusOf(g, g && await g.status()); }, unavailable));
    ipc.handle(CH.configure, own(async (cfg) => { const g = await usable(); return statusOf(g, g && await g.configure(cfg)); }, unavailable));
    ipc.handle(CH.capture, own(async (channel) => { const g = await usable(); return g ? g.capture(channel) : null; }, null));
    const onCancel = own(() => { if (gate) gate.cancelCapture(); });
    ipc.on(CH.cancelCapture, onCancel);
    const onFuse = own((channel) => { if (gate) gate.fuse(channel); });
    ipc.on(CH.fuse, onFuse);

    // A page going away takes its PTT controller with it; the next page turns the listener on again if it wants it.
    const reset = () => { if (gate) gate.configure(OFF); };
    const onNavigate = (details) => { if (details && details.isMainFrame && !details.isSameDocument) reset(); };
    wc.on('did-start-navigation', onNavigate);
    wc.on('render-process-gone', reset);
    win.on('closed', shutdown);

    current = {
      close() {
        for (const ch of [CH.status, CH.configure, CH.capture]) ipc.removeHandler(ch);
        ipc.removeListener(CH.cancelCapture, onCancel);
        ipc.removeListener(CH.fuse, onFuse);
        if (!wc.isDestroyed()) {
          wc.removeListener('did-start-navigation', onNavigate);
          wc.removeListener('render-process-gone', reset);
        }
        return gate ? gate.shutdown() : Promise.resolve();
      },
    };
  } catch (err) {
    warn(`not attached: ${err.message}`);
  }
}

/** Stops the listener and removes the IPC. Safe to call at any time, and more than once. */
function shutdown() {
  const c = current;
  current = null;
  if (!c) return Promise.resolve();
  return Promise.resolve(c.close()).catch((err) => warn(`shutdown failed: ${err.message}`));
}

module.exports = { attach, shutdown, chooseListenerKind, CH };
