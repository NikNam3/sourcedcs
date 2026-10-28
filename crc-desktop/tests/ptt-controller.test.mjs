// B8: the SRS push-to-talk must not stay open (docs/wip/ARCH-C.md §3.4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPttController, clampMaxTxSeconds, PTT_MAX_TX_DEFAULT_S, PTT_REPEAT_MS } from '../app/public/js/ptt-controller.js';

function rig({ typing = false, maxS } = {}) {
  const handlers = { doc: {}, win: {} };
  const posts = []; const active = []; const logs = [];
  let now = 0; const timers = new Map(); let nextId = 1;
  const addTimer = (fn, ms, repeat) => { const id = nextId++; timers.set(id, { fn, at: now + ms, ms, repeat }); return id; };
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, t] = due; now = t.at;
      if (t.repeat) t.at += t.ms; else timers.delete(id);
      t.fn();
    }
    now = end;
  };
  const state = { typing };
  const doc = { hidden: false, addEventListener: (n, f) => { handlers.doc[n] = f; } };
  const win = { addEventListener: (n, f) => { handlers.win[n] = f; } };
  const ptt = createPttController({
    post: (p) => posts.push(p), setActive: (on) => active.push(on), getKey: () => 'Space', isTyping: () => state.typing,
    win, doc, getMaxTxSeconds: maxS === undefined ? undefined : () => maxS, log: (m) => logs.push(m),
    setInterval: (fn, ms) => addTimer(fn, ms, true), clearInterval: (id) => timers.delete(id),
    setTimeout: (fn, ms) => addTimer(fn, ms, false), clearTimeout: (id) => timers.delete(id),
  });
  const key = (type, code = 'Space', extra = {}) => handlers.doc[type]({ code, repeat: false, preventDefault() {}, ...extra });
  return { ptt, posts, active, logs, handlers, state, doc, advance, key, timers };
}

test('keydown starts, re-sends every 400 ms, keyup stops', () => {
  const r = rig();
  r.key('keydown');
  assert.deepEqual(r.posts, ['/ptt/start']);
  r.advance(PTT_REPEAT_MS * 2);
  assert.equal(r.posts.length, 3);
  r.key('keyup');
  assert.equal(r.posts.at(-1), '/ptt/stop');
  r.advance(5000);
  assert.equal(r.posts.length, 4, 'no re-sends after the release');
});

test('keyup releases even when focus is now in an input (was ignored)', () => {
  const r = rig();
  r.key('keydown');
  r.state.typing = true; // focus moved into a field while the key was down
  r.key('keyup');
  assert.equal(r.ptt.isHeld(), false);
  assert.equal(r.posts.at(-1), '/ptt/stop');
});

test('keydown inside an input does not transmit', () => {
  const r = rig({ typing: true });
  r.key('keydown');
  assert.deepEqual(r.posts, []);
});

test('window blur and a hidden page release (alt-tab: the keyup never arrives)', () => {
  for (const lose of [(r) => r.handlers.win.blur(), (r) => { r.doc.hidden = true; r.handlers.doc.visibilitychange(); }]) {
    const r = rig();
    r.key('keydown');
    lose(r);
    assert.equal(r.ptt.isHeld(), false);
    assert.equal(r.posts.at(-1), '/ptt/stop');
  }
});

test('becoming visible again does not release or transmit', () => {
  const r = rig();
  r.doc.hidden = false; r.handlers.doc.visibilitychange();
  assert.deepEqual(r.posts, []);
});

test('the maximum transmit time ends a held key, and the key must be lifted before it transmits again', () => {
  const r = rig();
  r.key('keydown');
  r.advance(PTT_MAX_TX_DEFAULT_S * 1000 - 1);
  assert.equal(r.ptt.isHeld(), true);
  r.advance(1);
  assert.equal(r.ptt.isHeld(), false);
  assert.equal(r.posts.at(-1), '/ptt/stop');
  assert.match(r.logs[0], /30 s maximum/);
  r.key('keydown', 'Space', { repeat: true }); // OS auto-repeat is not a new press
  assert.equal(r.ptt.isHeld(), false);
  r.advance(3000);
  assert.equal(r.timers.size, 0);
});

test('the maximum is configurable and clamped', () => {
  const r = rig({ maxS: 10 });
  r.key('keydown'); r.advance(10000);
  assert.equal(r.ptt.isHeld(), false);
  assert.equal(clampMaxTxSeconds('abc'), PTT_MAX_TX_DEFAULT_S);
  assert.equal(clampMaxTxSeconds(0), 5);
  assert.equal(clampMaxTxSeconds(9999), 120);
});
