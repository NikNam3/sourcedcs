// ═══════════════════════════════════════════════════════════
// modal.js — shared open/close/outside-click-to-close plumbing
//
// This page has 5 modals (squadron CRUD, Discord role mapping, role sort
// order, vacation, per-member heatmap) that previously each hand-copied
// the same display:flex/none + body.style.overflow toggle and the same
// "click on the overlay itself closes it" wiring. Loaded FIRST (see
// wing-admin.html) because every other wing-admin/*.js file calls
// wireModalOutsideClick(...) at its own top level (not deferred inside a
// function), so it must already be defined by the time those files run.
//
// Public API:
//   openModal(overlayId) / closeModal(overlayId)
//   wireModalOutsideClick(overlayId, onClose)
// ═══════════════════════════════════════════════════════════

'use strict';

function openModal(overlayId) {
  document.getElementById(overlayId).style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal(overlayId) {
  document.getElementById(overlayId).style.display = 'none';
  document.body.style.overflow = '';
}

function wireModalOutsideClick(overlayId, onClose) {
  document.getElementById(overlayId).addEventListener('click', function (e) {
    if (e.target === this) onClose();
  });
}
