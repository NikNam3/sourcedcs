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
export function scrollCompensatedY(viewportY, scrollTopAtCache, scrollTopNow) {
  return viewportY + (scrollTopNow - scrollTopAtCache);
}

/** The inverse — a cached top back in live viewport coordinates, for drawing the insertion line where the Strips actually are now rather than where they were when measured. */
export function cachedTopToViewportY(cachedY, scrollTopAtCache, scrollTopNow) {
  return cachedY - (scrollTopNow - scrollTopAtCache);
}

// What the drop follows: the dragged Strip, not the cursor (H167).
//
// The Rack is measured closed up (F-402): the dragged Strip is out of the flow
// and the Strip that was below it now sits where it was. The question used to
// be "which neighbour midpoint is the CURSOR above", and the cursor is
// wherever on the Strip the controller grabbed it. Grab a Strip in its lower
// half, jitter 6 px past DRAG_THRESHOLD_PX on a click or a double-click, and
// the cursor was already below the midpoint of the Strip that had closed up
// under it: the drop landed one place down, with the ghost still over its own
// slot. A grab in the upper half moved nothing, hence "sometimes".
//
// Now the question is "which slot is the GHOST's top edge nearest". A slot is
// a place the dragged Strip's top can land: the top of each Strip in the
// closed-up Rack, or one gap below the last. At zero travel the ghost's top is
// exactly the top of its own slot, so a release there is no move, whatever
// half was grabbed and whatever the neighbours' heights (a flipped Strip is
// shorter). To move one place the ghost has to travel past the midpoint
// between two slot tops, i.e. about half the neighbour it passes, in either
// direction.

/**
 * @param {{stripId:string, top:number, height:number}[]} rects — the other
 *   Strips of the target Rack, top-to-bottom, measured once per drag (in the
 *   closed-up layout, see the module comment).
 * @param {number} ghostTopY — the dragged Strip's top edge, in the rects'
 *   coordinate space: the pointer Y minus where on the Strip it was grabbed
 *   (`grabOffsetY`), scroll-compensated like any other Y.
 * @returns {{index:number, afterStripId:string|null, beforeStripId:string|null}}
 *   afterStripId/beforeStripId feed directly into a MoveStrip/TransferStrip
 *   Mutation's neighbor references (crc-sync resolves the actual
 *   orderKey server-side — see board/placement.js's `resolveOrderKey` and the
 *   board-store.js module comment on why the client never computes a raw
 *   orderKey itself).
 */
export function computeInsertionIndex(rects, ghostTopY) {
  const n = rects.length;
  // The slot after the last Strip starts one inter-Strip gap below it; the gap
  // is read off the last pair (vertical margins collapse, so every pair has
  // the same one), 0 when there is no pair to read.
  const lastGap = n >= 2 ? Math.max(0, rects[n - 1].top - (rects[n - 2].top + rects[n - 2].height)) : 0;
  for (let i = 0; i < n; i++) {
    const nextSlotTop = i + 1 < n ? rects[i + 1].top : rects[i].top + rects[i].height + lastGap;
    const boundary = (rects[i].top + nextSlotTop) / 2;
    if (ghostTopY < boundary) {
      return {
        index: i,
        afterStripId: i > 0 ? rects[i - 1].stripId : null,
        beforeStripId: rects[i].stripId,
      };
    }
  }
  return {
    index: n,
    afterStripId: n > 0 ? rects[n - 1].stripId : null,
    beforeStripId: null,
  };
}

/**
 * True when a drop would leave the Strip exactly where it already is: same
 * Rack, same two neighbours. No MoveStrip is sent for it (a same-place drop
 * used to send one whenever the Strip had a neighbour).
 *
 * @param {{bayId:string, rackId:string, afterStripId:string|null, beforeStripId:string|null}} origin
 *   where the Strip was at pointerdown (its neighbours in the DOM order then)
 * @param {{bayId:string, rackId:string, afterStripId:string|null, beforeStripId:string|null}} target
 */
export function isUnchangedPlacement(origin, target) {
  return origin.bayId === target.bayId && origin.rackId === target.rackId
    && (origin.afterStripId ?? null) === (target.afterStripId ?? null)
    && (origin.beforeStripId ?? null) === (target.beforeStripId ?? null);
}

// A pointerdown+pointerup with negligible movement is a click, not a drag
// — bay/drag.js's _finishDrag gates BOTH its commit branches on this: below
// it nothing is captured, measured or sent, and the drop-target detection
// under the cursor (the Position/Bay tabs) is never consulted. Matches the
// drag-threshold convention virtually every production drag-and-drop
// implementation uses for the same reason. Past it, a jittered click still
// moves nothing: computeInsertionIndex follows the ghost, not the cursor.
export const DRAG_THRESHOLD_PX = 5;

// The Position/Bay tabs are a drop target only after more travel than a click
// can slip (H167). The Bay tabs sit directly on top of the Bay content: in a
// scrolled Bay a Strip is cut by that edge, and a press just under it with
// ~10 px of upward slip released over a Bay tab and moved the Strip to that
// Bay (measured in l4-drag). A deliberate drag to a tab goes further than this.
export const TAB_DROP_MIN_TRAVEL_PX = 16;

/** @returns {boolean} true once the pointer has travelled far enough from pointerdown for a Position/Bay tab under it to count as a drop target. */
export function isTabDropTravel(dx, dy) {
  return Math.hypot(dx, dy) > TAB_DROP_MIN_TRAVEL_PX;
}

/** @returns {boolean} true once total pointer travel from pointerdown exceeds DRAG_THRESHOLD_PX — the point at which a gesture stops being "just a click." */
export function hasExceededDragThreshold(dx, dy) {
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
export function computeRackReconciliation(existingIds, wantedIds, dirtyIds, protectedIds) {
  const existingSet = new Set(existingIds);
  const wantedSet = new Set(wantedIds);

  const toRemove = existingIds.filter(id => !wantedSet.has(id) && !protectedIds.has(id));

  const order = wantedIds.map(id => ({
    stripId: id,
    rebuild: (!existingSet.has(id) || dirtyIds.has(id)) && !protectedIds.has(id),
  }));

  return { toRemove, order };
}
