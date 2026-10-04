'use strict';

// The EFSP change bus (DESK-GRAPH; docs/wip/ARCH-C.md 3.1). A message handler (or a panel that changed something) says
// WHAT changed, with `markEfspChanged('alerts')`; each renderer says what it DEPENDS on, with
// `onEfspChanged(['board', 'alerts'], render)`. Neither imports the other, so a low module no longer imports a renderer
// to ask for a redraw, and a new feature subscribes instead of finding every handler that changes its input.
//
// A leaf on purpose (it imports nothing), like efsp-message-registry.js: every renderer imports it to subscribe, so it
// is fully evaluated first whichever module a graph is entered from.
//
// Flush rule: state first, render second. `dispatchEfspMessage` runs a handler inside `batchEfspChanges`, so the marks a
// handler makes are flushed once, after the handler has finished applying state. Outside a batch (a click, a timer) a mark
// flushes at once. A subscriber that appears under several marked topics runs once per flush, and the subscribers run in
// `order` (a highlight that a Strip reads while it is built is RESOLVE; the panel chrome, the Bays and the map follow),
// then in the order they subscribed. A subscriber that marks another topic is flushed after the current pass.

/** The topics, by what changed. Marking or subscribing to a name not listed here throws, so a typo cannot go silent. */
export const EFSP_TOPICS = Object.freeze({
  snapshot: 'a Board snapshot arrived (connect, reconnect, a new Board lifetime)',
  board: 'the Board\'s Strips changed (snapshot, delta, a Mutation ack that moved one)',
  ack: 'a Mutation ack arrived; the Bays redraw (the Strip may have changed under a pending state)',
  panel: 'the EFSP panel\'s own chrome (tab counts, arrivals line, create-Strip availability)',
  positions: 'the signed-on Positions changed',
  correlations: 'a correlation record changed',
  marsa: 'a MARSA relation changed',
  alerts: 'the conformance / conflict / obligation / surveillance picture changed',
  sfa: 'an SFA frequency rotation changed',
  bays: 'the open Bays must redraw (a popover closed, a Strip moved, a refusal landed)',
  map: 'the scope must redraw',
});

/** Subscriber order within one flush. */
export const ORDER = Object.freeze({ RESOLVE: 0, PANEL: 1, BAYS: 2, VIEW: 3 });

const _subscribers = []; // { topics: Set, fn, order, seq }
let _seq = 0;
let _pending = new Set();
let _depth = 0;
let _flushing = false;

function checkTopics(topics, who) {
  const list = Array.isArray(topics) ? topics : [topics];
  if (!list.length) throw new Error(`${who}: at least one topic is required`);
  for (const t of list) if (!Object.hasOwn(EFSP_TOPICS, t)) throw new Error(`${who}: unknown topic "${t}"`);
  return list;
}

/** Subscribes `fn()` to one topic or a list. Returns nothing: a view subscribes once, at load. */
export function onEfspChanged(topics, fn, { order = ORDER.VIEW } = {}) {
  const list = checkTopics(topics, 'onEfspChanged');
  if (typeof fn !== 'function') throw new Error('onEfspChanged: a function is required');
  _subscribers.push({ topics: new Set(list), fn, order, seq: _seq++ });
}

/** Says these topics changed. Flushes now, unless inside `batchEfspChanges` (then at its end). */
export function markEfspChanged(...topics) {
  for (const t of checkTopics(topics, 'markEfspChanged')) _pending.add(t);
  if (_depth === 0) flushEfspChanges();
}

/** Runs `fn`, then flushes the marks it made once. Nests: only the outermost call flushes. */
export function batchEfspChanges(fn) {
  _depth++;
  try { return fn(); } finally { _depth--; if (_depth === 0) flushEfspChanges(); }
}

/** Calls every subscriber of a pending topic once, in order. A topic marked by a subscriber is flushed in the next pass. */
export function flushEfspChanges() {
  if (_flushing) return; // the running flush picks up what a subscriber marked
  _flushing = true;
  try {
    for (let pass = 0; _pending.size; pass++) {
      if (pass >= 8) { _pending = new Set(); throw new Error('efsp change bus: subscribers keep marking each other (8 passes)'); }
      const topics = _pending;
      _pending = new Set();
      const due = _subscribers.filter(s => { for (const t of topics) if (s.topics.has(t)) return true; return false; })
        .sort((a, b) => a.order - b.order || a.seq - b.seq);
      for (const fn of new Set(due.map(d => d.fn))) fn();
    }
  } finally { _flushing = false; }
}

/** The subscriptions, for a test: [{ topics: [...], order }] in flush order. */
export function efspChangeSubscriptions() {
  return [..._subscribers].sort((a, b) => a.order - b.order || a.seq - b.seq).map(s => ({ topics: [...s.topics].sort(), order: s.order }));
}
