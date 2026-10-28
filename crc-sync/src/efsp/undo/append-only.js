'use strict';

// Append-only cells under an undo (docs/adr/0100 §3, H100 Q-U4 a): Strip annotations and flight-data clearance cells
// (guide §3.7; JO 7110.65 2-3-1 forbids erasing an item) are never truncated. An entry added since the before-image is
// marked VOIDED with the undone action's id; an entry the before-image held gets its status back (the entry it had
// superseded is ACTIVE again).

/**
 * @param {{entries: object[]}|undefined} imageCell the cell as it was before the action (undefined: it did not exist)
 * @param {{entries: object[]}} cell the live cell, changed in place
 * @param {string} voidedBy the undone action's id
 * @returns {boolean} whether anything changed
 */
function voidAppendedEntries(imageCell, cell, voidedBy) {
  if (!cell || !Array.isArray(cell.entries)) return false;
  const before = (imageCell && Array.isArray(imageCell.entries)) ? imageCell.entries : [];
  let changed = false;
  cell.entries.forEach((entry, i) => {
    if (i < before.length) {
      if (entry.status !== before[i].status) { entry.status = before[i].status; changed = true; }
    } else if (entry.status !== 'VOIDED') {
      entry.status = 'VOIDED';
      entry.voidedBy = voidedBy;
      changed = true;
    }
  });
  return changed;
}

module.exports = { voidAppendedEntries };
