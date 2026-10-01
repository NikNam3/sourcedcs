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
  const names = SLOT_ORDER.filter((k) => slots && slots[k]);
  const out = names.map((k) => slots[k]);
  Object.defineProperty(out, 'slots', { value: names, enumerable: false });
  return out;
}

module.exports = { SLOT_ORDER, orderSlots };
