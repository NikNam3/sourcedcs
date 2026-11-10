// Global PTT's privacy rules (docs/adr/0161 §3), pinned on crc-desktop/global-ptt/ptt-gate.js with a fake listener.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createPttGate } = require('../global-ptt/ptt-gate.js');

const F13 = { type: 'key', code: 91, name: 'F13' };
const F14 = { type: 'key', code: 92, name: 'F14' };

function rig({ startFails = false } = {}) {
  const calls = [], edges = [], timers = [];
  const listener = {
    captureTimeoutMs: 1000,
    accepts: (b) => !!b && b.type === 'key',
    start: async (b, onEdge) => { if (startFails) throw new Error('boom'); calls.push(['start', b.code]); listener.edge = onEdge; },
    stop: async () => { calls.push(['stop']); },
    capture: () => new Promise((resolve) => { calls.push(['capture']); listener.finish = resolve; }),
    cancelCapture: () => { calls.push(['cancel']); listener.finish(null); },
  };
  const gate = createPttGate({
    listener, sendEdge: (d) => edges.push(d),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (id) => { timers[id - 1].cleared = true; },
  });
  return { gate, listener, calls, edges, timers };
}
const tick = () => new Promise(r => setImmediate(r));

test('the listener does not start until Global PTT is enabled and an input is bound', async () => {
  const r = rig();
  await r.gate.configure({ enabled: false, binding: F13 });
  await r.gate.configure({ enabled: true, binding: null });
  assert.deepEqual(r.calls, []);
  await r.gate.configure({ enabled: true, binding: F13 });
  assert.deepEqual(r.calls, [['start', 91]]);
});

test('disabling stops the listener, and a held input is released on the way out', async () => {
  const r = rig();
  await r.gate.configure({ enabled: true, binding: F13 });
  r.listener.edge(true);
  await r.gate.configure({ enabled: false, binding: F13 });
  assert.deepEqual(r.calls, [['start', 91], ['stop']]);
  assert.deepEqual(r.edges, [true, false]);
});

test('an edge after the stop goes nowhere', async () => {
  const r = rig();
  await r.gate.configure({ enabled: true, binding: F13 });
  const late = r.listener.edge;
  await r.gate.configure({ enabled: false, binding: null });
  late(true);
  assert.deepEqual(r.edges, []);
});

test('only changes are forwarded, as a bare boolean', async () => {
  const r = rig();
  await r.gate.configure({ enabled: true, binding: F13 });
  r.listener.edge(true); r.listener.edge(true); r.listener.edge(true); r.listener.edge(false); r.listener.edge(false);
  assert.deepEqual(r.edges, [true, false]);
});

test('a new binding restarts the listener; the same one does not', async () => {
  const r = rig();
  await r.gate.configure({ enabled: true, binding: F13 });
  await r.gate.configure({ enabled: true, binding: { ...F13, name: 'renamed' } });
  assert.equal(r.calls.length, 1);
  await r.gate.configure({ enabled: true, binding: F14 });
  assert.deepEqual(r.calls, [['start', 91], ['stop'], ['start', 92]]);
});

test('a binding the listener cannot use counts as none (one made under another session type)', async () => {
  const r = rig();
  const st = await r.gate.configure({ enabled: true, binding: { type: 'portal', id: 'x', name: 'Meta+F' } });
  assert.deepEqual(r.calls, []);
  assert.equal(st.binding, null);
});

test('a capture is refused while disabled', async () => {
  const r = rig();
  assert.equal(await r.gate.capture(), null);
  assert.deepEqual(r.calls, []);
});

test('a capture stops forwarding, reports one input, then listens for that input', async () => {
  const r = rig();
  await r.gate.configure({ enabled: true, binding: F13 });
  const p = r.gate.capture();
  await tick();
  assert.deepEqual(r.calls, [['start', 91], ['stop'], ['capture']]);
  r.listener.finish(F14);
  assert.deepEqual(await p, F14);
  assert.deepEqual(r.calls.at(-1), ['start', 92]);
  assert.equal(r.timers[0].cleared, true);
});

test('only one capture at a time', async () => {
  const r = rig();
  await r.gate.configure({ enabled: true, binding: null });
  const p = r.gate.capture();
  await tick();
  assert.equal(await r.gate.capture(), null);
  assert.equal(r.calls.filter(c => c[0] === 'capture').length, 1);
  r.listener.finish(null);
  await p;
});

test('a capture ends by itself at the timeout, and keeps the old binding', async () => {
  const r = rig();
  await r.gate.configure({ enabled: true, binding: F13 });
  const p = r.gate.capture();
  await tick();
  assert.equal(r.timers[0].ms, 1000);
  r.timers[0].fn();
  assert.equal(await p, null);
  assert.deepEqual(r.calls.at(-1), ['start', 91]);
});

test('disabling during a capture cancels it and leaves nothing running', async () => {
  const r = rig();
  await r.gate.configure({ enabled: true, binding: null });
  const p = r.gate.capture();
  await tick();
  await r.gate.configure({ enabled: false, binding: null });
  assert.equal(await p, null);
  assert.equal(r.gate.status().running, false);
  assert.equal(r.calls.filter(c => c[0] === 'start').length, 0);
});

test('a listener that fails to start leaves it off and throws nothing', async () => {
  const r = rig({ startFails: true });
  const st = await r.gate.configure({ enabled: true, binding: F13 });
  assert.equal(st.running, false);
});

test('shutdown stops the listener and nothing restarts it', async () => {
  const r = rig();
  await r.gate.configure({ enabled: true, binding: F13 });
  await r.gate.shutdown();
  assert.deepEqual(r.calls.at(-1), ['stop']);
  await r.gate.configure({ enabled: true, binding: F13 });
  assert.equal(r.calls.filter(c => c[0] === 'start').length, 1);
});

test('no code that handles an input can log it', () => {
  for (const f of ['ptt-gate.js', 'uiohook-listener.js', 'portal-listener.js', 'portal-client.js']) {
    const src = fs.readFileSync(path.join(import.meta.dirname, '../global-ptt', f), 'utf8');
    assert.doesNotMatch(src, /console\./, `${f} must not log`);
  }
});
