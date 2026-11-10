'use strict';

// What may run, and when (docs/adr/0161 §3). A listener sees every input on the machine, so this is the one place that
// decides it runs, and it holds these rules:
//  - the listener runs only while Global PTT is enabled and an input is bound, and stops the moment either goes;
//  - only a press or a release of the bound input leaves it, as a bare boolean, and only on a change;
//  - a capture is refused while disabled, reports one input, ends by itself after a timeout, and forwards nothing;
//  - no input is ever logged here or in a listener.
// Electron-free, so a test drives it with a fake listener. edge-filter.js cleans the edges.

const { createEdgeFilter } = require('./edge-filter');

const CAPTURE_TIMEOUT_MS = 15000;

const sameInput = (a, b) => !!a && !!b && a.type === b.type && a.keycode === b.keycode && a.button === b.button && a.shortcutId === b.shortcutId;

/**
 * @param {object} o
 * @param {{start:Function, stop:Function, capture:Function, cancelCapture:Function, accepts:Function, captureTimeoutMs?:number}} o.listener
 * @param {(down:boolean)=>void} o.sendEdge
 * @param {(running:boolean)=>void} [o.onRunning]  the listener started or stopped
 * @param {Function} [o.setTimeout] @param {Function} [o.clearTimeout]
 * @param {(msg:string)=>void} [o.warn]  for the listener's own failures; never given an input
 */
function createPttGate(o) {
  const st = o.setTimeout || setTimeout, ct = o.clearTimeout || clearTimeout;
  const warn = o.warn || (() => {});
  const listener = o.listener;
  let enabled = false, binding = null, capturing = false, closed = false;
  let running = null;  // the binding the listener is running with
  let failed = false;  // the last start failed
  let chain = Promise.resolve();
  const onRunning = o.onRunning || (() => {});
  const filter = createEdgeFilter({ emit: (d) => o.sendEdge(d), releaseHoldMs: listener.releaseHoldMs, setTimeout: st, clearTimeout: ct });

  function onEdge(down) {
    if (!running) return;
    if (down) filter.press(); else filter.release();
  }

  async function apply() {
    const want = enabled && binding && !capturing && !closed ? binding : null;
    if (running && !sameInput(running, want)) {
      running = null;
      filter.reset(); // a listener that stops with the input down would never report its release
      try { await listener.stop(); } catch (err) { warn(`stop failed: ${err.message}`); }
      onRunning(false);
    }
    if (!want) failed = false;
    if (!want || running) return;
    running = want;
    try {
      const started = await listener.start(want, onEdge);
      failed = false;
      if (started && started.label && binding && sameInput(binding, want)) binding = { ...binding, label: started.label };
      onRunning(true);
    } catch (err) {
      running = null;
      failed = true;
      warn(`start failed: ${err.message}`);
    }
  }

  const settle = () => (chain = chain.then(apply));

  function status() { return { enabled, binding, running: !!running, capturing, failed }; }

  async function configure(cfg) {
    const c = cfg || {};
    enabled = c.enabled === true;
    binding = listener.accepts(c.binding) ? c.binding : null;
    if (!enabled && capturing) listener.cancelCapture();
    await settle();
    return status();
  }

  async function capture() {
    if (!enabled || capturing || closed) return null;
    capturing = true;
    await settle(); // the running listener stops first: nothing is forwarded while a key is being chosen
    const timer = st(() => listener.cancelCapture(), listener.captureTimeoutMs || CAPTURE_TIMEOUT_MS);
    let got = null;
    try {
      got = await listener.capture();
    } catch (err) {
      warn(`capture failed: ${err.message}`);
    } finally {
      ct(timer);
      capturing = false;
    }
    if (got && !got.refused && enabled && !closed) binding = got;
    await settle();
    return enabled ? got : null;
  }

  /** The renderer's transmit fuse fired. */
  function fuse() { filter.fuse(); }

  function cancelCapture() { if (capturing) listener.cancelCapture(); }

  async function shutdown() {
    closed = true;
    enabled = false;
    if (capturing) listener.cancelCapture();
    await settle();
  }

  return { configure, capture, cancelCapture, fuse, shutdown, status: () => chain.then(status) };
}

module.exports = { createPttGate, CAPTURE_TIMEOUT_MS };
