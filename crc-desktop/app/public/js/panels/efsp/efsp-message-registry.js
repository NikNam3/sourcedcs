'use strict';

// The client's EFSP message registry (CMSG, docs/wip/CMSG.md): crc-sync's `efsp-*` frames are routed here
// by type. Each family's module registers its handlers at load with registerEfspMessage(); app.js's
// ws.onmessage makes one dispatchEfspMessage(msg) call and knows no EFSP type by name.
//
// A leaf module on purpose (it imports nothing): every family module imports it to register, so it must be
// fully evaluated before any of them runs, whichever module a graph is entered from.

const _handlers = new Map();

/** Registers `handler(msg)` for a message type. A second registration of the same type throws at load. */
export function registerEfspMessage(type, handler) {
  if (typeof type !== 'string' || !type) throw new Error('registerEfspMessage: a type is required');
  if (typeof handler !== 'function') throw new Error(`registerEfspMessage(${type}): a handler function is required`);
  if (_handlers.has(type)) throw new Error(`registerEfspMessage: ${type} is already registered`);
  _handlers.set(type, handler);
}

const _observers = [];

/** `fn(msg)` runs before the handler of every message dispatched (store sync reads the seq/epoch each family frame carries). */
export function addEfspMessageObserver(fn) {
  if (typeof fn !== 'function') throw new Error('addEfspMessageObserver: a function is required');
  _observers.push(fn);
}

/** Runs the handler registered for msg.type. Returns true if one ran; an unregistered type is ignored. */
export function dispatchEfspMessage(msg) {
  const handler = msg && _handlers.get(msg.type);
  if (!handler) return false;
  for (const fn of _observers) fn(msg);
  handler(msg);
  return true;
}

const _storeRedraws = new Map();

/**
 * How a store's family redraws its panels from the state it already holds (DESK-SYNC): the same code its delta handler
 * runs after applying a delta. A resync slice replaces a store's state wholesale and then calls `redrawEfspStore(key)`,
 * instead of dispatching a synthetic empty frame at the delta handler. `key` is a `STORE_SYNC` key (efsp-state.js).
 */
export function registerEfspStoreRedraw(key, fn) {
  if (typeof key !== 'string' || !key) throw new Error('registerEfspStoreRedraw: a store key is required');
  if (typeof fn !== 'function') throw new Error(`registerEfspStoreRedraw(${key}): a function is required`);
  if (_storeRedraws.has(key)) throw new Error(`registerEfspStoreRedraw: ${key} is already registered`);
  _storeRedraws.set(key, fn);
}

/** Redraws one store's panels. A key nobody registered is a bug, not a no-op. */
export function redrawEfspStore(key) {
  const fn = _storeRedraws.get(key);
  if (!fn) throw new Error(`redrawEfspStore: no redraw registered for ${key}`);
  fn();
}

/** The store keys with a redraw, sorted (a test checks they are exactly STORE_SYNC's). */
export function registeredEfspStoreRedraws() { return [..._storeRedraws.keys()].sort(); }

/** The registered types, sorted (the ws-message-contract test reads this). */
export function registeredEfspTypes() {
  return [..._handlers.keys()].sort();
}
