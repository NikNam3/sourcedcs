'use strict';

/* Unit tests for the client-side NLA label table and the 400ms double-tap /
   30s Undo window logic (efsp-nla.js), using an injected fake `now` rather
   than real timers — same discipline as los-math.test.js. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NLA_LABELS, nlaLabelFor, DOUBLE_TAP_MS, UNDO_WINDOW_MS,
  isWithinDoubleTapWindow, isUndoAvailable,
  DEFAULT_STALE_THRESHOLD_SECONDS, isEfspBoardStale,
  STATE_OWNERS_BY_ROLE, DEPARTURE_STATE_OWNERS, ARRIVAL_STATE_OWNERS, canActOnState,
} = require('../app/public/js/panels/efsp/efsp-nla.js');

test('every DEPARTURE lifecycle state except DROPPED has a label', () => {
  for (const state of ['PROPOSED', 'PENDING_CLEARANCE', 'CLEARED', 'HELD', 'PUSHBACK', 'TAXI', 'RUNWAY_QUEUE', 'LUAW', 'DEPARTED', 'HANDED_OFF']) {
    assert.ok(nlaLabelFor(state), state);
  }
  assert.equal(nlaLabelFor('DROPPED'), null); // terminal, no NLA
});

test('nlaLabelFor returns null for an unknown state rather than throwing', () => {
  assert.equal(nlaLabelFor('NOT_A_STATE'), null);
});

test('DEPARTED uses the real Hand-Off-to-APP wording (docs/adr/0007), not ADR 0005\'s old "(local)" stub', () => {
  assert.equal(NLA_LABELS.DEPARTURE.DEPARTED, 'Hand Off to APP');
});

// ── ARRIVAL lifecycle (Phase 2, docs/adr/0008) ──────────────────────────

test('every ARRIVAL lifecycle state except DROPPED has a label', () => {
  for (const state of ['INBOUND', 'HANDED_TO_TOWER', 'FINAL', 'LANDED', 'TAXI_IN']) {
    assert.ok(nlaLabelFor(state, 'ARRIVAL'), state);
  }
  assert.equal(nlaLabelFor('DROPPED', 'ARRIVAL'), null);
});

test('nlaLabelFor defaults to the DEPARTURE table when no role is given', () => {
  assert.equal(nlaLabelFor('PROPOSED'), nlaLabelFor('PROPOSED', 'DEPARTURE'));
});

test('nlaLabelFor keeps DEPARTURE and ARRIVAL labels for the same state string entirely separate — e.g. neither role leaks the other\'s label for a state name they happen to share, like DROPPED', () => {
  assert.equal(nlaLabelFor('DROPPED', 'DEPARTURE'), null);
  assert.equal(nlaLabelFor('DROPPED', 'ARRIVAL'), null);
});

test('nlaLabelFor returns null for an unknown role rather than throwing', () => {
  assert.equal(nlaLabelFor('PROPOSED', 'OVERFLIGHT'), null);
});

// ── Double-tap guard ─────────────────────────────────────────────────────

test('isWithinDoubleTapWindow is true just under 400ms after the last invoke', () => {
  assert.equal(isWithinDoubleTapWindow(1000, 1000 + DOUBLE_TAP_MS - 1), true);
});

test('isWithinDoubleTapWindow is false at exactly 400ms and beyond', () => {
  assert.equal(isWithinDoubleTapWindow(1000, 1000 + DOUBLE_TAP_MS), false);
  assert.equal(isWithinDoubleTapWindow(1000, 1000 + DOUBLE_TAP_MS + 1), false);
});

test('isWithinDoubleTapWindow is false when there was no prior invoke (null)', () => {
  assert.equal(isWithinDoubleTapWindow(null, 5000), false);
});

// ── Undo window ──────────────────────────────────────────────────────────

test('isUndoAvailable is true just under 30s after the last NLA invoke', () => {
  assert.equal(isUndoAvailable(1000, 1000 + UNDO_WINDOW_MS - 1), true);
});

test('isUndoAvailable is false at exactly 30s and beyond', () => {
  assert.equal(isUndoAvailable(1000, 1000 + UNDO_WINDOW_MS), false);
  assert.equal(isUndoAvailable(1000, 1000 + UNDO_WINDOW_MS + 1), false);
});

test('isUndoAvailable is false when there was no prior invoke (null)', () => {
  assert.equal(isUndoAvailable(null, 5000), false);
});

// ── Board staleness (guide §5.6 rule 5) ─────────────────────────────────

test('isEfspBoardStale is false just under the threshold since the last heartbeat', () => {
  assert.equal(isEfspBoardStale(1000, 1000 + DEFAULT_STALE_THRESHOLD_SECONDS * 1000 - 1), false);
});

test('isEfspBoardStale is true at exactly the threshold and beyond', () => {
  assert.equal(isEfspBoardStale(1000, 1000 + DEFAULT_STALE_THRESHOLD_SECONDS * 1000), true);
  assert.equal(isEfspBoardStale(1000, 1000 + DEFAULT_STALE_THRESHOLD_SECONDS * 1000 + 1), true);
});

test('isEfspBoardStale is false when no heartbeat has ever arrived (null) — not-yet-connected is not "stale"', () => {
  assert.equal(isEfspBoardStale(null, 999999), false);
});

test('isEfspBoardStale respects a custom threshold', () => {
  assert.equal(isEfspBoardStale(1000, 1000 + 4999, 5), false);
  assert.equal(isEfspBoardStale(1000, 1000 + 5000, 5), true);
});

// ── canActOnState (guide §3.4 "normally owned by", docs/adr/0010) ───────
// Client-side mirror of permission.js's STATE_OWNERS_BY_ROLE — a UX
// convenience so the NLA button can render disabled BEFORE a click, not
// the enforcement itself (the server is authoritative, see board-store.js).

test('canActOnState has exactly three parameters, same shape as the server-side check', () => {
  assert.equal(canActOnState.length, 3);
});

test('the exact hazard this exists to prevent: OPS is NOT authorized for PENDING_CLEARANCE or CLEARED, even though it may still own the Strip', () => {
  assert.equal(canActOnState('OPS', 'DEPARTURE', 'PENDING_CLEARANCE'), false);
  assert.equal(canActOnState('OPS', 'DEPARTURE', 'CLEARED'), false);
  assert.equal(canActOnState('CD', 'DEPARTURE', 'PENDING_CLEARANCE'), true);
  assert.equal(canActOnState('CD', 'DEPARTURE', 'CLEARED'), true);
});

test('OPS is authorized for PROPOSED (its own state)', () => {
  assert.equal(canActOnState('OPS', 'DEPARTURE', 'PROPOSED'), true);
});

test('HELD is shared between CD and GND, no one else', () => {
  assert.equal(canActOnState('CD', 'DEPARTURE', 'HELD'), true);
  assert.equal(canActOnState('GND', 'DEPARTURE', 'HELD'), true);
  assert.equal(canActOnState('TWR', 'DEPARTURE', 'HELD'), false);
});

test('ARRIVAL states use their own independent table', () => {
  assert.equal(canActOnState('APP', 'ARRIVAL', 'INBOUND'), true);
  assert.equal(canActOnState('GND', 'ARRIVAL', 'TAXI_IN'), true);
  assert.equal(canActOnState('OPS', 'ARRIVAL', 'INBOUND'), false);
});

test('canActOnState returns false for an unknown state, role, or Position, never a throw', () => {
  assert.equal(canActOnState('TWR', 'DEPARTURE', 'DROPPED'), false);
  assert.equal(canActOnState('OPS', 'DEPARTURE', 'NOT_A_STATE'), false);
  assert.equal(canActOnState('OPS', 'OVERFLIGHT', 'PROPOSED'), false);
  assert.equal(canActOnState('NOT_A_POSITION', 'DEPARTURE', 'PROPOSED'), false);
});

test('this client mirror stays in lockstep with the real, authoritative server table (permission.js) — this is a UX convenience, not a second source of truth, so drift here would be silently misleading, not just cosmetic', () => {
  const server = require('../../crc-sync/src/efsp/permission.js');
  assert.deepEqual(STATE_OWNERS_BY_ROLE, server.STATE_OWNERS_BY_ROLE);
  assert.deepEqual(DEPARTURE_STATE_OWNERS, server.DEPARTURE_STATE_OWNERS);
  assert.deepEqual(ARRIVAL_STATE_OWNERS, server.ARRIVAL_STATE_OWNERS);
});
