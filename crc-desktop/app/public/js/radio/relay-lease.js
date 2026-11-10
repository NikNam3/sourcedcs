// The relay leases on /feed (ADR 0158 §4, ADR 0159): leaf state plus one sender. The client says which channels it
// wants to relay for (`wantRelayLeases`, every channel of its link groups, whenever the radio set changes) and crc-sync
// says which it holds (`radio-relay-leases`). A claim is declarative: it names every channel wanted now, so a channel
// no longer named (unlinked, the Position left, a retune) is released by the same claim.
//
// crc-sync keeps the table in memory and drops a session's leases when its socket closes. So while /feed is down this
// client holds nothing, and when it is up again the claim is sent again (checked every CHECK_MS).
//
// Nothing runs at import: initRelayLease() registers the handlers and starts the check, once.

import { sendToSync, isSyncOpen } from '../sync.js';
import { registerEfspMessage } from '../panels/efsp/efsp-message-registry.js';

export const CLAIM_TYPE = 'radio-relay-claim';
export const CHECK_MS = 1000;

let _wanted = [];
let _sentKey = null; // the claim crc-sync has for this socket, or null when it has none
let _held = [];
let _wasOpen = false;
let _started = false;
let _registered = false; // the message handlers, once per page (the registry refuses a second)
const _listeners = new Set();

function setHeld(next) {
  const h = Array.isArray(next) ? [...next].sort() : [];
  if (h.join(',') === _held.join(',')) return;
  _held = h;
  for (const fn of _listeners) fn(getHeldRelayLeases());
}

function sendClaim() {
  if (!isSyncOpen()) { _sentKey = null; return; }
  sendToSync({ version: 1, type: CLAIM_TYPE, clientMutationId: crypto.randomUUID(), channels: _wanted });
  _sentKey = _wanted.join(',');
}

/** The channels this client wants the relay leases for now (the whole list, every time). */
export function wantRelayLeases(keys) {
  _wanted = [...new Set((keys || []).filter(k => typeof k === 'string'))].sort();
  if (_wanted.join(',') !== _sentKey) sendClaim();
}

/** The channel keys crc-sync granted this client. */
export function getHeldRelayLeases() { return [..._held]; }

/** @returns {() => void} unsubscribe */
export function onRelayLeasesChanged(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Once, from the radio panel's init. */
export function initRelayLease({ setInterval: every = setInterval } = {}) {
  if (_started) return;
  _started = true;
  if (!_registered) {
    _registered = true;
    registerEfspMessage('radio-relay-leases', (msg) => setHeld(msg.held));
    registerEfspMessage('radio-relay-ack', (msg) => { if (!msg.ok) console.warn('[radio] relay lease claim refused:', msg.reason, msg.detail); });
  }
  const timer = every(() => {
    const open = isSyncOpen();
    if (!open && _wasOpen) { _sentKey = null; setHeld([]); }
    if (open && !_wasOpen && _wanted.length) sendClaim();
    _wasOpen = open;
  }, CHECK_MS);
  if (timer && typeof timer.unref === 'function') timer.unref(); // never what keeps a test process alive
}

/** Tests only. */
export function _resetRelayLeaseForTest() { _wanted = []; _sentKey = null; _held = []; _wasOpen = false; _started = false; _listeners.clear(); }
