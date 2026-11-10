// Global PTT's choice of listener and its IPC (docs/adr/0161 §3): crc-desktop/global-ptt/index.js, on a fake Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { attach, shutdown, chooseListenerKind, CH } = require('../global-ptt/index.js');

test('the listener follows the session', () => {
  assert.equal(chooseListenerKind('win32', {}), 'uiohook');
  assert.equal(chooseListenerKind('darwin', {}), null);
  assert.equal(chooseListenerKind('linux', { XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' }), 'portal');
  assert.equal(chooseListenerKind('linux', { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }), 'uiohook');
  assert.equal(chooseListenerKind('linux', { WAYLAND_DISPLAY: 'wayland-0' }), 'portal');
  assert.equal(chooseListenerKind('linux', { DISPLAY: ':0' }), 'uiohook');
  assert.equal(chooseListenerKind('linux', {}), null);
});

function rig({ probeFails = false, noListener = false } = {}) {
  const handlers = {};
  const ipc = new EventEmitter();
  ipc.handle = (ch, fn) => { assert.equal(handlers[ch], undefined, `${ch} registered twice`); handlers[ch] = fn; };
  ipc.removeHandler = (ch) => { delete handlers[ch]; };
  const wc = new EventEmitter();
  const sent = [];
  wc.isDestroyed = () => false;
  wc.send = (ch, v) => sent.push([ch, v]);
  const win = new EventEmitter();
  win.webContents = wc;
  const listener = {
    kind: 'fake', started: 0, stopped: 0,
    probe: async () => { if (probeFails) throw new Error('nope'); },
    accepts: (b) => !!b,
    start: async (_b, onEdge) => { listener.started++; listener.edge = onEdge; },
    stop: async () => { listener.stopped++; },
    capture: async () => ({ type: 'key', code: 91, name: 'F13' }),
    cancelCapture() {},
  };
  attach(win, { ipcMain: ipc, platform: 'linux', env: {}, makeListener: () => (noListener ? null : listener) });
  const call = (ch, arg, sender = wc) => handlers[ch]({ sender }, arg);
  return { handlers, ipc, wc, win, listener, sent, call };
}
const ON = { enabled: true, binding: { type: 'key', code: 91, name: 'F13' } };

test('attaching starts nothing', async (t) => {
  t.after(shutdown);
  const r = rig();
  assert.equal(r.listener.started, 0);
  const st = await r.call(CH.status);
  assert.equal(st.available, true);
  assert.equal(st.running, false);
  assert.equal(r.listener.started, 0);
});

test('no listener, or one that cannot load: reported as not available, and never started', async (t) => {
  t.after(shutdown);
  for (const opts of [{ noListener: true }, { probeFails: true }]) {
    const r = rig(opts);
    assert.equal((await r.call(CH.status)).available, false);
    assert.equal((await r.call(CH.configure, ON)).available, false);
    assert.equal(await r.call(CH.capture), null);
    assert.equal(r.listener.started, 0);
    await shutdown();
  }
});

test('an edge reaches the window as a bare boolean', async (t) => {
  t.after(shutdown);
  const r = rig();
  await r.call(CH.configure, ON);
  r.listener.edge(true);
  r.listener.edge(false);
  assert.deepEqual(r.sent, [[CH.edge, true], [CH.edge, false]]);
});

test('a sender other than the main window gets nothing', async (t) => {
  t.after(shutdown);
  const r = rig();
  const st = await r.call(CH.configure, ON, new EventEmitter());
  assert.equal(st.available, false);
  assert.equal(r.listener.started, 0);
  assert.equal(await r.call(CH.capture, undefined, new EventEmitter()), null);
});

test('the page navigating or crashing stops the listener; an in-page navigation does not', async (t) => {
  t.after(shutdown);
  const r = rig();
  const settled = () => new Promise(res => setImmediate(res));
  await r.call(CH.configure, ON);
  r.wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  await settled();
  assert.equal(r.listener.stopped, 0);
  r.wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  await settled();
  assert.equal(r.listener.stopped, 1);
  await r.call(CH.configure, ON);
  r.wc.emit('render-process-gone');
  await settled();
  assert.equal(r.listener.stopped, 2);
});

test('shutdown stops the listener and removes the IPC; attaching again works', async () => {
  const r = rig();
  await r.call(CH.configure, ON);
  await shutdown();
  assert.equal(r.listener.stopped, 1);
  assert.deepEqual(r.handlers, {});
  assert.equal(r.ipc.listenerCount(CH.cancelCapture), 0);
  await shutdown(); // twice is fine
  const again = rig();
  assert.equal((await again.call(CH.status)).available, true);
  await shutdown();
});

test('attach never throws into main.js', () => {
  assert.doesNotThrow(() => attach({}, { ipcMain: {}, platform: 'linux', env: {}, makeListener: () => { throw new Error('boom'); } }));
});
