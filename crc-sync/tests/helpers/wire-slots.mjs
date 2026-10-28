// Test-side reader of the wire result's broadcasts[] (docs/wip/WIRE.md). The skeleton's orderSlots() attaches a
// non-enumerable `slots` array naming each frame's slot; these helpers read it and FAIL LOUDLY when it is missing or
// does not line up with the frames, never guessing a slot from a frame type (primary and peer are both board-deltas).

export const SLOT_KEYS = { primary: 'broadcast', peer: 'peerBroadcast', marsa: 'marsaBroadcast', carrier: 'carrierBroadcast', correlation: 'correlationBroadcast' };

function slotsOf(result) {
  const b = result && result.broadcasts;
  if (!Array.isArray(b)) throw new Error('wire-slots: the result has no broadcasts[]');
  if (b.length === 0) return [];
  if (!Array.isArray(b.slots) || b.slots.length !== b.length) {
    throw new Error('wire-slots: broadcasts[] carries no slot names (ambiguous); it must come from the skeleton\'s orderSlots()');
  }
  return b.slots;
}

/** The frame in slot `name` ('primary' | 'peer' | 'marsa' | 'carrier' | 'correlation'), or undefined. */
export function slot(result, name) {
  if (!(name in SLOT_KEYS)) throw new Error(`wire-slots: unknown slot ${name}`);
  const i = slotsOf(result).indexOf(name);
  return i < 0 ? undefined : result.broadcasts[i];
}

/** The pre-WIRE result shape ({ ack, unaudited?, broadcast, peerBroadcast, ... }) the goldens were recorded in. */
export function legacyShape(result) {
  if (!result || !('broadcasts' in result)) return result;
  const { broadcasts, ...rest } = result;
  const names = slotsOf(result);
  names.forEach((name, i) => { rest[SLOT_KEYS[name]] = broadcasts[i]; });
  return rest;
}
