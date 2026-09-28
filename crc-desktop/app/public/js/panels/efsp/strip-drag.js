'use strict';

// Pointer Events drag for Strip reordering within/between Racks (guide
// §7.1-7.2, §5.4). Insertion-index computation is kept PURE and separate
// from the actual pointerdown/pointermove DOM wiring — same discipline as
// los.js's math functions — so it's testable without a DOM.
//
// Guide §7.2 rule 5: "Insertion index MUST be computed from rects cached
// at pointerdown, never from getBoundingClientRect() per move" — the DOM
// wiring (bay-view.js) caches an array of {stripId, top, height} ONCE and
// calls computeInsertionIndex() against that same cached array on every
// pointermove, never re-measuring layout mid-drag.
//
// Two things went wrong under that rule, and neither is the rule's fault
// (lane 4's F-402 and F-404 — one mechanism, two causes):
//
//  1. The cache was taken at pointerdown, which is one layout change too
//     early: .efsp-strip-dragging is `position: fixed`, so the moment the
//     drag actually starts the dragged Strip leaves the flow and every
//     Strip BELOW it moves up by one Strip height. Fixed by re-caching
//     once, after the class is applied — still one measurement per drag,
//     still no per-move getBoundingClientRect() over the Rack.
//  2. The Bay scrolls under the cache — by the wheel, or by Chromium's own
//     autoscroll while the button is held at the container's edge, which
//     happens whether or not the app knows about it. No amount of
//     re-caching at drag-start survives that, so the pointer is instead
//     mapped INTO the cache's coordinate space on each query, by the one
//     number that changed: the scroll container's scrollTop. That is an
//     O(1) property read, not a re-measurement of the Rack.
//
// scrollCompensatedY/cachedTopToViewportY below are that mapping, kept
// here (pure, unit-tested) rather than inline in the DOM wiring for the
// same reason computeInsertionIndex is.

/**
 * A viewport Y, expressed in the coordinate space `rects` were cached in.
 *
 * Scrolling a container down by Δ moves everything inside it up by Δ, so a
 * cached top is Δ too large. Rather than rewriting every cached rect on
 * every scroll, move the single pointer coordinate the other way.
 *
 * @param {number} viewportY — a live pointer clientY
 * @param {number} scrollTopAtCache — the container's scrollTop when the rects were measured
 * @param {number} scrollTopNow — its scrollTop now
 */
function scrollCompensatedY(viewportY, scrollTopAtCache, scrollTopNow) {
  return viewportY + (scrollTopNow - scrollTopAtCache);
}

/** The inverse — a cached top back in live viewport coordinates, for drawing the insertion line where the Strips actually are now rather than where they were when measured. */
function cachedTopToViewportY(cachedY, scrollTopAtCache, scrollTopNow) {
  return cachedY - (scrollTopNow - scrollTopAtCache);
}

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
  module.exports = {
    computeInsertionIndex, computeRackReconciliation, DRAG_THRESHOLD_PX, hasExceededDragThreshold,
    scrollCompensatedY, cachedTopToViewportY,
  };
}
