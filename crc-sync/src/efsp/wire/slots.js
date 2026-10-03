'use strict';

// Broadcast slots: the frames one round trip sends, and the one order they leave in.

// The order a round trip's frames leave in: the primary delta, the peer Facility's, the MARSA relation's, the
// carrier's, the SFA's. A client sees the Strip change before the relation or the Case that rode with it.
const SLOT_ORDER = ['primary', 'peer', 'marsa', 'carrier', 'sfa'];

/**
 * The frames of `slots` (an object keyed by slot name, absent or falsy = nothing to send) as an array in
 * SLOT_ORDER. The array carries a non-enumerable `slots` array naming each frame's slot (never serialised, never
 * read by the hub): the golden harness maps back to named keys from it instead of guessing from frame types.
 */
function orderSlots(slots) {
  // A slot may hold several frames (an array): sign-off can repair the Boards of more than one other Facility.
  const out = [];
  const names = [];
  for (const k of SLOT_ORDER) {
    const v = slots && slots[k];
    if (!v) continue;
    for (const frame of Array.isArray(v) ? v : [v]) { out.push(frame); names.push(k); }
  }
  Object.defineProperty(out, 'slots', { value: names, enumerable: false });
  return out;
}

module.exports = { SLOT_ORDER, orderSlots };
