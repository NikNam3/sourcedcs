'use strict';

// Pure append-only annotation supersession model (guide §3.7), mirroring
// board-store.js's _applyAnnotationSet exactly. Used here for CLIENT-SIDE
// optimistic preview only — the server's own application of the same
// rules is authoritative and always wins on ack (efsp-state.js's
// applyEfspMutationAck applies the server's returned Strip regardless of
// outcome). Kept pure/testable, separate from the Tab/Shift+Tab cycling
// and Enter-commit/Esc-revert DOM key handling (efsp-panel.js).
//
// Guide §3.7 rule 5 / §7.4 rule 2: Enter commits, Esc cancels and reverts,
// and there is NO auto-commit on blur — that contract lives entirely in
// the DOM key handling this file doesn't contain; this file only computes
// what "commit" produces.

/**
 * Returns a NEW annotations object (does not mutate `annotations`) with
 * the amendment applied, or null if `confirmVacated` was requested but
 * there is no ACTIVE entry to strike (mirrors board-store.js's own
 * VALIDATION_ERROR case for that scenario — caller should not have
 * offered the confirm-vacated action in the first place if this happens).
 */
function applyAnnotationLocally(annotations, blockId, value, confirmVacated) {
  const next = { ...annotations };
  const existing = next[blockId] || { blockId, entries: [] };
  const entries = existing.entries.map(e => ({ ...e }));
  const active = entries.find(e => e.status === 'ACTIVE');

  if (confirmVacated) {
    if (!active) return null;
    active.status = 'STRUCK';
  } else {
    if (active) active.status = 'SUPERSEDED';
    entries.push({ value, status: 'ACTIVE', at: Date.now(), by: null });
  }

  next[blockId] = { blockId, entries };
  return next;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { applyAnnotationLocally };
}
