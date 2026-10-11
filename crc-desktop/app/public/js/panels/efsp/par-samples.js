'use strict';

// The PAR samples this session is sent (crc-sync docs/adr/0112): one per aircraft on a final worked by a Position this
// controller is signed on to, keyed by Strip id, replaced whole by every `par-sample` frame. A leaf: it imports nothing,
// so every reader (the FINAL view, the carrier DIST Block, the PAR panel) can import it without a cycle.
//
// A sample is { stripId, facilityId, positionId, approach, sensor, plot, plotAgeMs, trail } (crc-sync
// surveillance/par.js). `plotAgeMs` is how old the plot was when the frame left the server; `receivedAt` (this client's
// clock) lets a reader add the time since, for "NO PLOT" (H115).

let _byStrip = new Map();
let _at = null;
let _receivedAt = null;

/** Applies a `par-sample` frame: the samples it carries replace every earlier one. */
export function applyParSamples(msg, receivedAt = Date.now()) {
  const next = new Map();
  for (const s of (msg && Array.isArray(msg.samples) ? msg.samples : [])) if (s && s.stripId) next.set(s.stripId, s);
  _byStrip = next;
  _at = msg && Number.isFinite(msg.at) ? msg.at : null;
  _receivedAt = receivedAt;
}

/** The sample for a Strip, or null when this session is not sent one (not on final, or not its final). */
export function parSampleFor(stripId) {
  return _byStrip.get(stripId) || null;
}

/** Every sample of the last frame. */
export function parSamples() {
  return [..._byStrip.values()];
}

/** The last frame's mission time and when it arrived here. */
export function parSampleTimes() {
  return { at: _at, receivedAt: _receivedAt };
}

/** Forgets every sample (a new connection starts empty until the server's next tick). */
export function clearParSamples() {
  _byStrip = new Map();
  _at = null;
  _receivedAt = null;
}
