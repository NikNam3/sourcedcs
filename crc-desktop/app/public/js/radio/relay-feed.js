// The relay on /feed (docs/adr/0160): leaf state plus one sender. The panel says which link groups this session has
// (`sendLinkGroups`, whole, whenever they change) and crc-sync answers with what its relay does for them
// (`radio-relay-status`: the networks, connected, error).
//
// crc-sync keeps the groups in memory and drops a session's groups when its socket closes. So while /feed is down the
// status is cleared, and when it is up again the groups are sent again (checked every CHECK_MS; sync.js has no open
// hook).
//
// Nothing runs at import: initRelayFeed() registers the handlers and starts the check, once.

import { sendToSync, isSyncOpen } from '../sync.js';
import { registerEfspMessage } from '../panels/efsp/efsp-message-registry.js';

export const LINK_GROUPS_TYPE = 'radio-link-groups';
export const CHECK_MS = 1000;

let _groups = [];
let _sentKey = null; // what crc-sync has for this socket, or null when it has nothing
let _status = null;
let _wasOpen = false;
let _started = false;
let _registered = false; // the message handlers, once per page (the registry refuses a second)
const _listeners = new Set();

function setStatus(next) {
  const s = next ? { networks: Array.isArray(next.networks) ? next.networks : [], connected: next.connected === true, error: next.error || null } : null;
  if (JSON.stringify(s) === JSON.stringify(_status)) return;
  _status = s;
  for (const fn of _listeners) fn(getRelayStatus());
}

function send() {
  if (!isSyncOpen()) { _sentKey = null; return; }
  sendToSync({ version: 1, type: LINK_GROUPS_TYPE, clientMutationId: crypto.randomUUID(), groups: _groups });
  _sentKey = JSON.stringify(_groups);
}

/** This session's link groups now ([{id, channels}], relay-groups.js relayGroupsOf), the whole list every time. */
export function sendLinkGroups(groups) {
  _groups = Array.isArray(groups) ? groups : [];
  if (JSON.stringify(_groups) !== _sentKey) send();
}

/** What crc-sync last said: {networks, connected, error}, or null before any answer and while /feed is down. */
export function getRelayStatus() { return _status ? { ..._status } : null; }

/** @returns {() => void} unsubscribe */
export function onRelayStatusChanged(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Once, from the radio panel's init. */
export function initRelayFeed({ setInterval: every = setInterval } = {}) {
  if (_started) return;
  _started = true;
  if (!_registered) {
    _registered = true;
    registerEfspMessage('radio-relay-status', (msg) => setStatus(msg));
    registerEfspMessage('radio-link-groups-ack', (msg) => { if (!msg.ok) console.warn('[radio] link groups refused:', msg.reason, msg.detail); });
  }
  const timer = every(() => {
    const open = isSyncOpen();
    if (!open && _wasOpen) { _sentKey = null; setStatus(null); }
    if (open && !_wasOpen && _sentKey === null && _groups.length) send();
    _wasOpen = open;
  }, CHECK_MS);
  if (timer && typeof timer.unref === 'function') timer.unref(); // never what keeps a test process alive
}

/** Tests only. */
export function _resetRelayFeedForTest() { _groups = []; _sentKey = null; _status = null; _wasOpen = false; _started = false; _listeners.clear(); }
