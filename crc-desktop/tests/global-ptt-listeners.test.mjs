// The two listeners behind Global PTT (docs/adr/0161 §3), each on a fake of what it talks to. No hook, no D-Bus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createUiohookListener } = require('../global-ptt/uiohook-listener.js');
const { createPortalListener, SHORTCUT_ID } = require('../global-ptt/portal-listener.js');

const KEYS = { Escape: 1, Space: 57, F13: 91, Ctrl: 29 };

function uiohookRig() {
  const uIOhook = new EventEmitter();
  uIOhook.started = 0; uIOhook.stopped = 0;
  uIOhook.start = () => { uIOhook.started++; };
  uIOhook.stop = () => { uIOhook.stopped++; };
  let loads = 0;
  const listener = createUiohookListener({ load: () => { loads++; return { uIOhook, UiohookKey: KEYS }; }, defer: (fn) => fn() });
  const handlerCount = () => ['keydown', 'keyup', 'mousedown', 'mouseup', 'input', 'mousemove', 'wheel', 'click'].reduce((n, e) => n + uIOhook.listenerCount(e), 0);
  return { uIOhook, listener, handlerCount, loads: () => loads };
}

test('uiohook: making the listener loads nothing native and starts no hook', () => {
  const r = uiohookRig();
  assert.equal(r.loads(), 0);
  assert.equal(r.uIOhook.started, 0);
});

test('uiohook: probing loads the module and starts no hook', async () => {
  const r = uiohookRig();
  await r.listener.probe();
  assert.equal(r.loads(), 1);
  assert.equal(r.uIOhook.started, 0);
});

test('uiohook: a module that cannot load is an error to catch, not a crash at require', async () => {
  const l = createUiohookListener({ load: () => { throw new Error('libX11.so.6: cannot open'); } });
  await assert.rejects(l.probe(), /libX11/);
});

test('uiohook: only the bound key is forwarded', () => {
  const r = uiohookRig();
  const edges = [];
  r.listener.start({ type: 'key', code: 91, name: 'F13' }, (d) => edges.push(d));
  r.uIOhook.emit('keydown', { keycode: 30 });
  r.uIOhook.emit('keyup', { keycode: 30 });
  r.uIOhook.emit('mousedown', { button: 91 });
  assert.deepEqual(edges, []);
  r.uIOhook.emit('keydown', { keycode: 91 });
  r.uIOhook.emit('keyup', { keycode: 91 });
  assert.deepEqual(edges, [true, false]);
});

test('uiohook: only the bound mouse button is forwarded', () => {
  const r = uiohookRig();
  const edges = [];
  r.listener.start({ type: 'mouse', button: 4, name: 'Mouse 4' }, (d) => edges.push(d));
  r.uIOhook.emit('mousedown', { button: 5 });
  r.uIOhook.emit('keydown', { keycode: 4 });
  assert.deepEqual(edges, []);
  r.uIOhook.emit('mousedown', { button: 4 });
  r.uIOhook.emit('mouseup', { button: 4 });
  assert.deepEqual(edges, [true, false]);
});

test('uiohook: stop removes every handler and stops the hook', () => {
  const r = uiohookRig();
  r.listener.start({ type: 'key', code: 91, name: 'F13' }, () => {});
  assert.equal(r.uIOhook.started, 1);
  r.listener.stop();
  assert.equal(r.uIOhook.stopped, 1);
  assert.equal(r.handlerCount(), 0);
});

test('uiohook: a hook that fails to start leaves no handler behind', () => {
  const r = uiohookRig();
  r.uIOhook.start = () => { throw new Error('Failed to open X11 display.'); };
  assert.throws(() => r.listener.start({ type: 'key', code: 91, name: 'F13' }, () => {}), /X11/);
  assert.equal(r.handlerCount(), 0);
  assert.equal(r.uIOhook.stopped, 0);
});

test('uiohook: a capture reports exactly the first input, at its release, then the hook stops', async () => {
  const r = uiohookRig();
  const p = r.listener.capture();
  r.uIOhook.emit('keydown', { keycode: 91 });
  r.uIOhook.emit('keydown', { keycode: 30 }); // a second key while the first is down
  r.uIOhook.emit('keyup', { keycode: 30 });
  assert.equal(r.uIOhook.stopped, 0);
  r.uIOhook.emit('keyup', { keycode: 91 });
  assert.deepEqual(await p, { type: 'key', code: 91, name: 'F13' });
  assert.equal(r.uIOhook.stopped, 1);
  assert.equal(r.handlerCount(), 0);
});

test('uiohook: a capture names sided modifiers and mouse buttons', async () => {
  let r = uiohookRig();
  let p = r.listener.capture();
  r.uIOhook.emit('keydown', { keycode: 29 }); r.uIOhook.emit('keyup', { keycode: 29 });
  assert.equal((await p).name, 'Left Ctrl');
  r = uiohookRig();
  p = r.listener.capture();
  r.uIOhook.emit('mousedown', { button: 4 }); r.uIOhook.emit('mouseup', { button: 4 });
  assert.deepEqual(await p, { type: 'mouse', button: 4, name: 'Mouse 4' });
});

test('uiohook: the left button is never captured or accepted; Escape cancels', async () => {
  const r = uiohookRig();
  const p = r.listener.capture();
  r.uIOhook.emit('mousedown', { button: 1 }); r.uIOhook.emit('mouseup', { button: 1 });
  assert.equal(r.uIOhook.stopped, 0);
  r.uIOhook.emit('keydown', { keycode: 1 });
  assert.equal(await p, null);
  assert.equal(r.listener.accepts({ type: 'mouse', button: 1, name: 'x' }), false);
});

test('uiohook: cancelling a capture stops the hook', async () => {
  const r = uiohookRig();
  const p = r.listener.capture();
  r.listener.cancelCapture();
  assert.equal(await p, null);
  assert.equal(r.uIOhook.stopped, 1);
});

function portalRig({ bindCode = 0, trigger = 'Meta+F13', version = 2, registerFails = false } = {}) {
  const log = [], signals = {};
  const client = {
    version: async () => version,
    register: async (id) => { log.push(['register', id]); if (registerFails) throw new Error('refused'); },
    request: async (member) => {
      log.push([member]);
      if (member === 'CreateSession') return { code: 0, results: { session_handle: '/s/1' } };
      return { code: bindCode, results: { shortcuts: [[SHORTCUT_ID, [['trigger_description', [[], [trigger]]]]]] } };
    },
    onSignal: async (name, fn) => { signals[name] = fn; return () => { log.push(['off', name]); delete signals[name]; }; },
    closeSession: async (s) => { log.push(['closeSession', s]); },
    close: () => log.push(['close']),
  };
  const listener = createPortalListener({ connect: async () => { log.push(['connect']); return client; } });
  return { listener, log, signals };
}
const BOUND = { type: 'portal', id: SHORTCUT_ID, name: 'Meta+F13' };

test('portal: register comes before every other portal call', async () => {
  const r = portalRig();
  await r.listener.start(BOUND, () => {});
  assert.deepEqual(r.log.slice(0, 3), [['connect'], ['register', 'page.sourcedcs.crc'], ['CreateSession']]);
});

test('portal: an older portal refusing to register is not a failure', async () => {
  const r = portalRig({ registerFails: true });
  assert.deepEqual(await r.listener.start(BOUND, () => {}), { name: 'Meta+F13' });
});

test('portal: Activated and Deactivated become edges, for this session and shortcut only', async () => {
  const r = portalRig();
  const edges = [];
  await r.listener.start(BOUND, (d) => edges.push(d));
  r.signals.Activated(['/other', SHORTCUT_ID, 1, []]);
  r.signals.Activated(['/s/1', 'not_ours', 1, []]);
  assert.deepEqual(edges, []);
  r.signals.Activated(['/s/1', SHORTCUT_ID, 1, []]);
  r.signals.Deactivated(['/s/1', SHORTCUT_ID, 2, []]);
  assert.deepEqual(edges, [true, false]);
});

test('portal: stop unsubscribes, closes the session and the connection', async () => {
  const r = portalRig();
  await r.listener.start(BOUND, () => {});
  await r.listener.stop();
  assert.deepEqual(r.signals, {});
  assert.deepEqual(r.log.slice(-1), [['close']]);
  assert.ok(r.log.some(l => l[0] === 'closeSession' && l[1] === '/s/1'));
});

test('portal: a capture returns the name the desktop gave, and closes what it opened', async () => {
  const r = portalRig();
  assert.deepEqual(await r.listener.capture(), BOUND);
  assert.deepEqual(r.log.slice(-1), [['close']]);
});

test('portal: the controller refusing the dialog is no binding', async () => {
  const r = portalRig({ bindCode: 1 });
  assert.equal(await r.listener.capture(), null);
});

test('portal: a refused bind at start closes everything and fails the start', async () => {
  const r = portalRig({ bindCode: 2 });
  await assert.rejects(r.listener.start(BOUND, () => {}), /refused/);
  assert.deepEqual(r.signals, {});
  assert.deepEqual(r.log.slice(-1), [['close']]);
});

test('portal: probing asks for the version and touches no shortcut', async () => {
  const r = portalRig();
  await r.listener.probe();
  assert.deepEqual(r.log, [['connect'], ['close']]);
  await assert.rejects(portalRig({ version: 0 }).listener.probe(), /no GlobalShortcuts/);
});
