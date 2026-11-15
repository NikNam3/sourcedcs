'use strict';

// What may run, and when (docs/adr/0161 §3). A listener sees every input on the machine, so this is the one place that
// decides it runs, and it holds these rules:
//  - the listener runs only while Global PTT is enabled and an input is bound, and stops the moment either goes;
//  - only a press or a release of a bound input leaves it, as a bare boolean and its channel, and only on a change;
//  - a capture is refused while disabled, reports one input, ends by itself after a timeout, and forwards nothing;
//  - no input is ever logged here or in a listener.
// Two channels (docs/adr/0166 §1): `ptt`, the PTT key, and `intercom`, the intercom PTT. Each has its own binding and
// its own edge filter; one input is never bound to both (a capture of the other channel's input is refused).
// Electron-free, so a test drives it with a fake listener. edge-filter.js cleans the edges.

const { createEdgeFilter } = require('./edge-filter');

const CAPTURE_TIMEOUT_MS = 15000;
const CHANNELS = Object.freeze(['ptt', 'intercom']);

const sameInput = (a, b) => !!a && !!b && a.type === b.type && a.keycode === b.keycode && a.button === b.button && a.shortcutId === b.shortcutId;
const sameBindings = (a, b) => !!a && !!b && CHANNELS.every(c => (!a[c] && !b[c]) || sameInput(a[c], b[c]));
const channelOf = (c) => (c === 'intercom' ? 'intercom' : 'ptt');

/**
 * @param {object} o
 * @param {{start:Function, stop:Function, capture:Function, cancelCapture:Function, accepts:Function, captureTimeoutMs?:number}} o.listener
 *   `start({ ptt, intercom }, onEdge(channel, down))` with a binding or null per channel; `capture(channel)`;
 *   `accepts(binding, channel)`
 * @param {(down:boolean, channel:string)=>void} o.sendEdge
 * @param {(running:boolean)=>void} [o.onRunning]  the listener started or stopped
 * @param {Function} [o.setTimeout] @param {Function} [o.clearTimeout]
 * @param {(msg:string)=>void} [o.warn]  for the listener's own failures; never given an input
 */
function createPttGate(o) {
  const st = o.setTimeout || setTimeout, ct = o.clearTimeout || clearTimeout;
  const warn = o.warn || (() => {});
  const listener = o.listener;
  let enabled = false, capturing = false, closed = false;
  const bindings = { ptt: null, intercom: null };
  let running = null;  // the bindings the listener is running with
  let failed = false;  // the last start failed
  let chain = Promise.resolve();
  const onRunning = o.onRunning || (() => {});
  const filters = {};
  for (const c of CHANNELS) {
    filters[c] = createEdgeFilter({ emit: (d) => o.sendEdge(d, c), releaseHoldMs: listener.releaseHoldMs, setTimeout: st, clearTimeout: ct });
  }

  function onEdge(channel, down) {
    const c = channelOf(channel);
    if (!running || !running[c]) return;
    if (down) filters[c].press(); else filters[c].release();
  }

  async function apply() {
    const any = bindings.ptt || bindings.intercom;
    const want = enabled && any && !capturing && !closed ? { ...bindings } : null;
    if (running && !sameBindings(running, want)) {
      running = null;
      for (const c of CHANNELS) filters[c].reset(); // a listener that stops with an input down would never report its release
      try { await listener.stop(); } catch (err) { warn(`stop failed: ${err.message}`); }
      onRunning(false);
    }
    if (!want) failed = false;
    if (!want || running) return;
    running = want;
    try {
      const started = await listener.start(want, onEdge);
      failed = false;
      const labels = (started && started.labels) || {};
      for (const c of CHANNELS) {
        if (labels[c] && bindings[c] && sameInput(bindings[c], want[c])) bindings[c] = { ...bindings[c], label: labels[c] };
      }
      onRunning(true);
    } catch (err) {
      running = null;
      failed = true;
      warn(`start failed: ${err.message}`);
    }
  }

  const settle = () => (chain = chain.then(apply));

  function status() { return { enabled, binding: bindings.ptt, intercom: bindings.intercom, running: !!running, capturing, failed }; }

  async function configure(cfg) {
    const c = cfg || {};
    enabled = c.enabled === true;
    bindings.ptt = listener.accepts(c.binding, 'ptt') ? c.binding : null;
    const ic = listener.accepts(c.intercom, 'intercom') ? c.intercom : null;
    bindings.intercom = ic && !sameInput(ic, bindings.ptt) ? ic : null;
    if (!enabled && capturing) listener.cancelCapture();
    await settle();
    return status();
  }

  async function capture(channel) {
    const c = channelOf(channel);
    if (!enabled || capturing || closed) return null;
    capturing = true;
    await settle(); // the running listener stops first: nothing is forwarded while a key is being chosen
    const timer = st(() => listener.cancelCapture(), listener.captureTimeoutMs || CAPTURE_TIMEOUT_MS);
    let got = null;
    try {
      got = await listener.capture(c);
    } catch (err) {
      warn(`capture failed: ${err.message}`);
    } finally {
      ct(timer);
      capturing = false;
    }
    const other = bindings[CHANNELS.find(x => x !== c)];
    if (got && !got.refused && sameInput(got, other)) got = { refused: true, taken: true };
    if (got && !got.refused && enabled && !closed) bindings[c] = got;
    await settle();
    return enabled ? got : null;
  }

  /** The renderer's transmit fuse fired on `channel`. */
  function fuse(channel) { filters[channelOf(channel)].fuse(); }

  function cancelCapture() { if (capturing) listener.cancelCapture(); }

  async function shutdown() {
    closed = true;
    enabled = false;
    if (capturing) listener.cancelCapture();
    await settle();
  }

  return { configure, capture, cancelCapture, fuse, shutdown, status: () => chain.then(status) };
}

module.exports = { createPttGate, CAPTURE_TIMEOUT_MS, CHANNELS };
