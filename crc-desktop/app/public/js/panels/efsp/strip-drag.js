'use strict';

// Pointer Events drag for Strip reordering within/between Racks (guide
// §7.1-7.2, §5.4). Insertion-index computation is kept PURE and separate
// from the actual pointerdown/pointermove DOM wiring — same discipline as
// los.js's math functions — so it's testable without a DOM.
//
// Guide §7.2 rule 5: "Insertion index MUST be computed from rects cached
// at pointerdown, never from getBoundingClientRect() per move" — the DOM
// wiring (efsp-panel.js) caches an array of {stripId, top, height} once at
// pointerdown and calls computeInsertionIndex() against that same cached
// array on every pointermove, never re-measuring layout mid-drag.

/**
 * @param {{stripId:string, top:number, height:number}[]} rects — Strip
 *   rects in the target Rack, top-to-bottom order, cached at pointerdown.
 * @param {number} pointerY
 * @returns {{index:number, afterStripId:string|null, beforeStripId:string|null}}
 *   afterStripId/beforeStripId feed directly into a MoveStrip/TransferStrip
 *   Mutation's neighbor references (board-store.js resolves the actual
 *   orderKey server-side — see board-store.js's module comment on why the
 *   client never computes a raw orderKey itself).
 */
function computeInsertionIndex(rects, pointerY) {
  for (let i = 0; i < rects.length; i++) {
    const mid = rects[i].top + rects[i].height / 2;
    if (pointerY < mid) {
      return {
        index: i,
        afterStripId: i > 0 ? rects[i - 1].stripId : null,
        beforeStripId: rects[i].stripId,
      };
    }
  }
  return {
    index: rects.length,
    afterStripId: rects.length > 0 ? rects[rects.length - 1].stripId : null,
    beforeStripId: null,
  };
}

// A pointerdown+pointerup with negligible movement is a click, not a drag
// — bay-view.js's _finishDrag gates BOTH its commit branches on this,
// because computeInsertionIndex() above always resolves to SOME neighbor
// position whenever a Rack has other Strips in it (it has no "no change"
// case), so without this threshold a plain click could silently reorder
// or relocate a Strip via drop-target detection under the cursor at that
// instant. Matches the drag-threshold convention virtually every
// production drag-and-drop implementation uses for the same reason.
const DRAG_THRESHOLD_PX = 5;

/** @returns {boolean} true once total pointer travel from pointerdown exceeds DRAG_THRESHOLD_PX — the point at which a gesture stops being "just a click." */
function hasExceededDragThreshold(dx, dy) {
  return Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
}

/**
 * Pure keyed-diff decision for renderBay()'s Rack reconciliation (guide
 * §7.5.4 "keyed by stable stripId, never destroy-and-recreate", §4.8.5 rule
 * 3 "recomposition MUST NOT disturb an in-progress drag, an open annotation
 * cell, or scroll position", defect D6 silent mutation loss). Decides which
 * existing Strip elements to remove and which wanted Strips need a fresh
 * element built, WITHOUT ever touching a protected (mid-drag / open-edit)
 * Strip — bay-view.js's DOM wiring is the impure half that actually walks
 * the decision and reorders elements; this half is what's unit-testable.
 *
 * @param {string[]} existingIds — current Strip element stripIds, in current DOM order
 * @param {string[]} wantedIds — stripIds that belong in this Rack now, in wanted order
 * @param {Set<string>} dirtyIds — stripIds whose element must be rebuilt even
 *   though it still exists (its `rev` changed, or some other rendered
 *   property not tracked by rev did — e.g. local selection state)
 * @param {Set<string>} protectedIds — stripIds that must never be removed or
 *   rebuilt (currently mid-drag, or has an open annotation/Block edit)
 * @returns {{
 *   toRemove: string[],
 *   order: {stripId:string, rebuild:boolean}[],
 * }}
 */
function computeRackReconciliation(existingIds, wantedIds, dirtyIds, protectedIds) {
  const existingSet = new Set(existingIds);
  const wantedSet = new Set(wantedIds);

  const toRemove = existingIds.filter(id => !wantedSet.has(id) && !protectedIds.has(id));

  const order = wantedIds.map(id => ({
    stripId: id,
    rebuild: (!existingSet.has(id) || dirtyIds.has(id)) && !protectedIds.has(id),
  }));

  return { toRemove, order };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeInsertionIndex, computeRackReconciliation, DRAG_THRESHOLD_PX, hasExceededDragThreshold };
}
