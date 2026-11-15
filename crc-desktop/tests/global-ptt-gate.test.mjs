// Global PTT's privacy rules (docs/adr/0161 §3), pinned on crc-desktop/global-ptt/ptt-gate.js with a fake listener.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createPttGate } = require('../global-ptt/ptt-gate.js');

const F13 = { type: 'key', keycode: 91, label: 'F13' };
const F14 = { type: 'key', keycode: 92, label: 'F14' };
const F15 = { type: 'key', keycode: 93, label: 'F15' };

function rig({ startFails = false } = {}) {
  const calls = [], edges = [], timers = [];
  const listener = {
    captureTimeoutMs: 1000,
    accepts: (b) => !!b && b.type === 'key',
    // One edge helper per channel: `edge(down)` is the PTT, `icEdge(down)` the intercom PTT (docs/adr/0166 §1).
    start: async (b, onEdge) => {
      if (startFails) throw new Error('boom');
      calls.push(['start', b.ptt ? b.ptt.keycode : null, ...(b.intercom ? [b.intercom.keycode] : [])]);
      listener.edge = (d) => onEdge('ptt', d);
      listener.icEdge = (d) => onEdge('intercom', d);
    },
    capture: (channel) => new Promise((resolve) => { calls.push(['capture', ...(channel && channel !== 'ptt' ? [channel] : [])]); listener.finish = resolve; }),
    stop: async () => { calls.push(['stop']); },
    cancelCapture: () => { calls.push(['cancel']); listener.finish(null); },
  };
  const gate = createPttGate({
    listener, sendEdge: (d, channel) => edges.push(channel === 'ptt' ? d : [channel, d]),
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
  await r.gate.configure({ enabled: true, binding: { ...F13, label: 'renamed' } });
  assert.equal(r.calls.length, 1);
  await r.gate.configure({ enabled: true, binding: F14 });
  assert.deepEqual(r.calls, [['start', 91], ['stop'], ['start', 92]]);
});

test('a binding the listener cannot use counts as none (one made under another session type)', async () => {
  const r = rig();
  const st = await r.gate.configure({ enabled: true, binding: { shortcutId: 'x', label: 'Meta+F' } });
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
  assert.equal((await r.gate.status()).running, false);
  assert.equal(r.calls.filter(c => c[0] === 'start').length, 0);
});

test('a listener that fails to start leaves it off and throws nothing', async () => {
  const r = rig({ startFails: true });
  const st = await r.gate.configure({ enabled: true, binding: F13 });
  assert.equal(st.running, false);
  assert.equal(st.failed, true);
});

test('shutdown stops the listener and nothing restarts it', async () => {
  const r = rig();
  await r.gate.configure({ enabled: true, binding: F13 });
  await r.gate.shutdown();
  assert.deepEqual(r.calls.at(-1), ['stop']);
  await r.gate.configure({ enabled: true, binding: F13 });
  assert.equal(r.calls.filter(c => c[0] === 'start').length, 1);
});

test('a refused input from a capture binds nothing and is passed on as refused', async () => {
  const r = rig();
  await r.gate.configure({ enabled: true, binding: F13 });
  const p = r.gate.capture();
  await tick();
  r.listener.finish({ refused: true });
  assert.deepEqual(await p, { refused: true });
  assert.deepEqual(r.calls.at(-1), ['start', 91]);
});

test('the fuse holds repeats back, and a release ends it', async () => {
  const r = rig();
  await r.gate.configure({ enabled: true, binding: F13 });
  r.listener.edge(true);
  r.gate.fuse();
  r.listener.edge(true);
  r.listener.edge(false);
  assert.deepEqual(r.edges, [true, false]);
  r.listener.edge(true);
  assert.deepEqual(r.edges, [true, false, true]);
});

test('the intercom channel: its own binding, its own edges; an intercom input alone starts the listener', async () => {
  const r = rig();
  await r.gate.configure({ enabled: true, binding: null, intercom: F15 });
  assert.deepEqual(r.calls, [['start', null, 93]]);
  await r.gate.configure({ enabled: true, binding: F13, intercom: F15 });
  assert.deepEqual(r.calls.slice(1), [['stop'], ['start', 91, 93]]);
  r.listener.icEdge(true); r.listener.edge(true); r.listener.icEdge(true); r.listener.icEdge(false); r.listener.edge(false);
  assert.deepEqual(r.edges, [['intercom', true], true, ['intercom', false], false]);
  const st = await r.gate.status();
  assert.deepEqual([st.binding, st.intercom], [F13, F15]);
});

test('one input is never both: a stored intercom binding equal to the PTT one counts as none', async () => {
  const r = rig();
  const st = await r.gate.configure({ enabled: true, binding: F13, intercom: { ...F13 } });
  assert.equal(st.intercom, null);
  assert.deepEqual(r.calls, [['start', 91]]);
});

test('an intercom capture binds the intercom; the PTT input is refused there as taken', async () => {
  const r = rig();
  await r.gate.configure({ enabled: true, binding: F13 });
  let p = r.gate.capture('intercom');
  await tick();
  assert.deepEqual(r.calls.at(-1), ['capture', 'intercom']);
  r.listener.finish(F13);
  assert.deepEqual(await p, { refused: true, taken: true });
  assert.equal((await r.gate.status()).intercom, null);
  p = r.gate.capture('intercom');
  await tick();
  r.listener.finish(F15);
  assert.deepEqual(await p, F15);
  assert.deepEqual(r.calls.at(-1), ['start', 91, 93]);
});

test('the fuse is per channel', async () => {
  const r = rig();
  await r.gate.configure({ enabled: true, binding: F13, intercom: F15 });
  r.listener.icEdge(true);
  r.gate.fuse('intercom');
  r.listener.icEdge(true);
  r.listener.edge(true);
  assert.deepEqual(r.edges, [['intercom', true], true]);
});

test('no code that handles an input can log it', () => {
  for (const f of ['ptt-gate.js', 'edge-filter.js', 'input-allowlist.js', 'uiohook-listener.js', 'portal-listener.js', 'portal-client.js']) {
    const src = fs.readFileSync(path.join(import.meta.dirname, '../global-ptt', f), 'utf8');
    assert.doesNotMatch(src, /console\./, `${f} must not log`);
  }
});
