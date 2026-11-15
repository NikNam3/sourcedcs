'use strict';
import { getEfspStrip } from './efsp-state.js';
import { sendEfspMutation } from './efsp-ws.js';

// The paper gestures' writes (offset, flip, highlight, attention), one at a time per Strip.
//
// Each SetFlag carries the Strip's rev as its baseRev, and crc-sync refuses a stale one. A controller who Ctrl+clicks
// through the highlight colours sends the second click before the first one's ack has brought the new rev, so the
// second came back STALE_REV and the panel said somebody else had changed the Strip. Nobody had.
//
// So a gesture records the value it wants here, and this module sends it: at most one SetFlag per Strip in flight, the
// next one only after the ack (which carries the Strip's current rev), and only for a flag whose wanted value the Strip
// does not already have. Several quick clicks collapse into what the last one asked for. A STALE_REV from a write the
// controller did not make (the server touched the Strip meanwhile) is retried against the rev the refusal brought, a few
// times, without a banner. Any other refusal drops the Strip's wanted values and shows as before.

const STALE_RETRIES = 3;

const _wanted = new Map();   // stripId -> Map(flag -> value)
const _inFlight = new Set(); // stripIds with a SetFlag awaiting its ack
const _acting = new Map();   // stripId -> the acting Position the last gesture named
const _stale = new Map();    // stripId -> STALE_REV refusals in a row

let _sendOverride = null;   // tests only
let _getStrip = getEfspStrip;

/** The flag's value as the controller last asked for it: a write still on its way wins over the Strip record. */
export function effectiveFlag(strip, flag) {
  const wanted = _wanted.get(strip.stripId);
  if (wanted && wanted.has(flag)) return wanted.get(flag);
  return strip.flags ? strip.flags[flag] : undefined;
}

/** The Strip with every pending flag applied, for a gesture deciding whether it sets or clears. */
export function withWantedFlags(strip) {
  const wanted = _wanted.get(strip.stripId);
  if (!wanted || wanted.size === 0) return strip;
  return { ...strip, flags: { ...strip.flags, ...Object.fromEntries(wanted) } };
}

/** Asks for one flag's value on a Strip. Sends now, or after the Strip's write in flight is answered. */
export function writeFlag(actingPositionId, stripId, flag, value) {
  if (!_wanted.has(stripId)) _wanted.set(stripId, new Map());
  _wanted.get(stripId).set(flag, value);
  _acting.set(stripId, actingPositionId);
  _stale.delete(stripId);
  _pump(stripId);
}

function _forget(stripId) {
  _wanted.delete(stripId); _acting.delete(stripId); _stale.delete(stripId);
}

function _pump(stripId) {
  if (_inFlight.has(stripId)) return;
  const strip = _getStrip(stripId);
  const wanted = _wanted.get(stripId);
  if (!strip || !wanted) { _forget(stripId); return; }
  const next = [...wanted].find(([flag, value]) => (strip.flags || {})[flag] !== value);
  if (!next) { _forget(stripId); return; }
  const [flag, value] = next;
  _inFlight.add(stripId);
  (_sendOverride || sendEfspMutation)(_acting.get(stripId), strip, { kind: 'SetFlag', flag, value }, { onAck: (ack) => _onAck(stripId, flag, value, ack) });
}

function _onAck(stripId, flag, value, ack) {
  _inFlight.delete(stripId);
  const wanted = _wanted.get(stripId);
  if (ack.ok) {
    _stale.delete(stripId);
    if (wanted && wanted.get(flag) === value) wanted.delete(flag);
    _pump(stripId);
    return false;
  }
  if (ack.reason === 'STALE_REV' && wanted) {
    const n = (_stale.get(stripId) || 0) + 1;
    _stale.set(stripId, n);
    if (n <= STALE_RETRIES) { _pump(stripId); return true; } // the refusal brought the current Strip: try again on it
  }
  _forget(stripId);
  return false; // the default surface (the refusal banner) shows it
}

/** Tests only: replace the wire and the Strip lookup, and start empty. */
export function _resetFlagWriterForTest({ send, getStrip } = {}) {
  _wanted.clear(); _inFlight.clear(); _acting.clear(); _stale.clear();
  _sendOverride = send || null;
  _getStrip = getStrip || getEfspStrip;
}
