'use strict';
import {
  cachedTopToViewportY, computeInsertionIndex, hasExceededDragThreshold, scrollCompensatedY
} from '../strip-drag.js';
import { carrierMoveToSlot } from '../carrier-panel.js';
import { _isPseudoBayId } from './open-bays.js';
import { _defaultBayFor, _defaultRackFor, _moveStrip, _transferStrip, renderAllOpenEfspBays } from '../bay-view.js';


// ── Pointer Events drag ──────────────────────────────────────────────────
// Named _efspDrag, not _drag: app.js declares a top-level `let _drag` for the
// map's label-offset dragging (map-setup.js). When every script shared one
// global scope, reusing `_drag` was a SyntaxError that killed the whole
// renderer silently (app.js failed to parse, so initDock()/the WS connection
// never ran). Modules have their own scope now; the distinct name stays so a
// grep for either finds one thing.

export let _efspDrag = null; // { strip, bayId, rackEl, rects, scrollEl, cacheScrollTop, insertionEl, dragEl, dragWidth, lastClientY, dropTargetEl, hasMoved }

/** The element the Rack scrolls inside — renderBay() appends every Rack straight into the Bay's own `#efsp-bay-content`, which is the `overflow-y: auto` box. Guarded because the unit-test DOM stub has neither `parentElement` nor `scrollTop`. */
function _scrollParentOfRack(rackEl) {
  return rackEl.parentElement || rackEl.parentNode || null;
}

function _scrollTopOf(el) {
  return el && typeof el.scrollTop === 'number' ? el.scrollTop : 0;
}

/**
 * Measure the Racks's other Strips, once, and remember the scroll offset the
 * measurement was taken at (F-402/F-404 — see strip-drag.js's module comment
 * for why the cache is taken here rather than at pointerdown, and why the
 * scroll offset has to travel with it).
 *
 * Also the only place `_efspDrag.rackEl` changes: a drag that crosses into a
 * second Rack (F-406) re-measures against that Rack and commits there.
 */
function _cacheRackRects(rackEl) {
  const drag = _efspDrag;
  drag.rackEl = rackEl;
  drag.scrollEl = _scrollParentOfRack(rackEl);
  drag.cacheScrollTop = _scrollTopOf(drag.scrollEl);
  drag.rects = [...rackEl.querySelectorAll('.efsp-strip')]
    .filter(el => el.dataset.stripId !== drag.strip.stripId)
    .map(el => {
      const r = el.getBoundingClientRect();
      return { stripId: el.dataset.stripId, top: r.top, height: r.height };
    });
}

export function _onStripPointerDown(e, strip) {
  // pointerdown fires (and bubbles) BEFORE click — a button/input inside
  // the Strip (the NLA button, future gesture buttons, an annotation
  // cell) would have its click hijacked into a drag-start every time,
  // even with stopPropagation() on the button's own click handler, since
  // the drag has already begun by the time click fires. Let interactive
  // children handle their own pointer events entirely.
  if (e.target.closest('button, input, textarea, select, [contenteditable]')) return;
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  const rackEl = e.currentTarget.closest('.efsp-rack');
  if (!rackEl) return;

  // setPointerCapture is deliberately NOT called here — see _capturePointer.

  const insertionEl = document.createElement('div');
  insertionEl.className = 'efsp-insertion-line';
  insertionEl.style.display = 'none'; // hidden until real movement — see _onStripPointerMove
  rackEl.appendChild(insertionEl);

  // .efsp-strip-dragging (semi-transparent + position:fixed, §7.2.3) is
  // NOT applied here — deliberately deferred to _onStripPointerMove, only
  // once real movement crosses DRAG_THRESHOLD_PX. Applying it immediately
  // on pointerdown made even a plain click visually "pop" the Strip out of
  // the flow for an instant (position:fixed kicking in with no actual
  // drag), and a double-click — two independent pointerdown/pointerup
  // cycles — popped it twice in quick succession, which read as a glitch.
  //
  // The other Strips' rects are not measured here either, and for the same
  // reason turned into a defect: measuring them before that class is applied
  // measures a layout the drag is about to invalidate (F-402). _cacheRackRects
  // runs from _onStripPointerMove instead, immediately after the class. The
  // one thing that MUST be read now is the dragged Strip's own width, which is
  // only available while it is still in the flow.

  _efspDrag = {
    strip, insertionEl, dragEl: e.currentTarget,
    // F-403 — `position: fixed` resolves against the nearest ancestor with
    // `contain: layout`, which here is dockview's `.dv-grid-view`: the whole
    // dock grid, not the panel. With `width: auto` the ghost then shrink-to-
    // fits against THAT and is drawn ~700px wide over the map beside the
    // panel. Nothing in CSS can name this number (see .efsp-strip-dragging's
    // comment in efsp-panel.css, which records the two rules that were tried),
    // so it is pinned here and cleared in _finishDrag.
    dragWidth: e.currentTarget.getBoundingClientRect().width,
    // The Bay a cross-Rack drag may not leave: a move to another BAY is what
    // the Position/Bay tabs are for (_findDropTargetAt), and they carry
    // ownership semantics a bare Rack element does not.
    bayId: rackEl.dataset.bayId,
    rackEl, rects: [], scrollEl: null, cacheScrollTop: 0, // filled by _cacheRackRects once the drag is real
    startX: e.clientX, startY: e.clientY, lastClientY: e.clientY,
    pointerId: e.pointerId,
    captured: false, // see _capturePointer
    dropTargetEl: null,
    hasMoved: false, // set true in _onStripPointerMove once movement exceeds DRAG_THRESHOLD_PX
  };

  // On `document`, not on the Strip, because the pointer is NOT captured yet
  // and a fast flick can put the cursor outside the Strip before the drag
  // threshold is crossed — listeners on the Strip would simply stop hearing
  // about it and the drag would hang half-started.
  document.addEventListener('pointermove', _onStripPointerMove);
  document.addEventListener('pointerup', _onStripPointerUp);
  document.addEventListener('pointercancel', _onStripPointerCancel);
}

/**
 * Take the pointer capture — at the drag THRESHOLD, not at pointerdown.
 *
 * Capturing retargets the compatibility mouse events too, `click` included:
 * with capture held by the Strip, a click on a Block cell inside it is
 * delivered to the STRIP and the cell's own click handler never runs, so the
 * cell cannot be opened for editing at all. Measured in Chromium, not assumed.
 *
 * That is why every editable cell used to stopPropagation() its pointerdown —
 * the Strip's drag-start had to be kept away from it. F-105 then grew those
 * cells from 28x20 to 44x44 of border box, overhanging 12px vertically and 3px
 * horizontally past the box a controller can see, and the guard grew with
 * them: in lc-runway-queue, a pointerdown 8px into a Strip lands inside Block
 * 14D's target (border box from x=15, visible box from x=18) and started no
 * drag at all. Most of a Strip had quietly stopped being draggable, which is
 * what lane 4's F-406 spec actually trips over.
 *
 * Deferring the capture resolves both at once, and needs neither side to give
 * anything up: below DRAG_THRESHOLD_PX nothing is captured, so a press on a
 * cell is an ordinary click on that cell and the editor opens; past it the
 * Strip captures, the click is retargeted away from the cell, and the gesture
 * is a drag. The threshold was always the thing that told those two apart
 * (see strip-drag.js's hasExceededDragThreshold) — it just was not being
 * asked until after the decision had been made.
 */
function _capturePointer() {
  if (!_efspDrag || _efspDrag.captured) return;
  _efspDrag.captured = true;
  if (typeof _efspDrag.dragEl.setPointerCapture === 'function') {
    _efspDrag.dragEl.setPointerCapture(_efspDrag.pointerId);
  }
}

// "Other Bays reachable through header drop zones that double as drag
// targets" (guide §4.2) — the always-visible Position/Bay tabs (rendered
// by efsp-panel.js, marked with data-efsp-drop-position/data-efsp-drop-bay)
// accept a drop as a cross-Position TransferStrip or cross-Bay MoveStrip.
// setPointerCapture (see _capturePointer) means pointer events keep
// targeting the dragged Strip element even when the cursor is over a tab
// elsewhere in the panel — elementFromPoint is what actually finds what's
// visually underneath the cursor instead.
function _findDropTargetAt(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  // A Marshal stack slot (crc-sync docs/adr/0074) is a drop target too: one gesture, one Move.
  return el ? el.closest('[data-efsp-drop-position], [data-efsp-drop-slot]') : null;
}

/**
 * Which Rack is under the pointer (F-406).
 *
 * _finishDrag used to commit unconditionally to the Rack the drag STARTED in,
 * and rects were cached only for that Rack, so a Strip dragged from RWY-05
 * onto RWY-23 in lc-runway-queue snapped back into RWY-05 and said nothing.
 * The only drop targets that changed a Strip's location were the Position and
 * Bay tabs, which are per Bay — nothing was per Rack, even though this
 * module's own header has always claimed "within/between Racks" and a runway
 * change for a queued departure is an ordinary pilot request
 * (docs/efsp-wp6-plan.md §Verification 5).
 *
 * Returns null over anything that is not a Rack of the same Bay — the gap
 * between two Racks, the Bay's own padding — and the caller then keeps the
 * Rack it already had, so letting go there reorders where the insertion line
 * is drawn rather than doing nothing.
 */
function _findRackAt(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const rackEl = el ? el.closest('.efsp-rack') : null;
  if (!rackEl || !_efspDrag || rackEl.dataset.bayId !== _efspDrag.bayId) return null;
  return rackEl;
}

// Holding a dragged Strip near the top or bottom edge of the Bay scrolls it.
// This used to happen only by accident: Chromium's text-selection autoscroll,
// when the press landed on a field's text. Layout C put the grab area in the
// tab, which has no text there, and the Bay stopped scrolling at all — so a
// slot below the fold could not be reached. Scroll changes are compensated
// the same way a wheel scroll mid-drag is (F-404).
const DRAG_AUTOSCROLL_EDGE_PX = 32;
const DRAG_AUTOSCROLL_MAX_PX = 14;
let _dragAutoscrollFrame = null;

function _dragAutoscrollStep() {
  _dragAutoscrollFrame = null;
  const drag = _efspDrag;
  if (!drag || !drag.hasMoved || !drag.scrollEl || typeof drag.lastClientX !== 'number') return;
  const r = drag.scrollEl.getBoundingClientRect();
  const y = drag.lastClientY;
  let speed = 0;
  if (y > r.bottom - DRAG_AUTOSCROLL_EDGE_PX) speed = Math.min(1, (y - (r.bottom - DRAG_AUTOSCROLL_EDGE_PX)) / DRAG_AUTOSCROLL_EDGE_PX);
  else if (y < r.top + DRAG_AUTOSCROLL_EDGE_PX) speed = -Math.min(1, ((r.top + DRAG_AUTOSCROLL_EDGE_PX) - y) / DRAG_AUTOSCROLL_EDGE_PX);
  if (speed === 0) return;
  const before = drag.scrollEl.scrollTop;
  drag.scrollEl.scrollTop = before + Math.max(1, Math.round(Math.abs(speed) * DRAG_AUTOSCROLL_MAX_PX)) * Math.sign(speed);
  if (drag.scrollEl.scrollTop === before) return; // at the end of the Bay
  // Redraw the insertion line against the new scroll position.
  _onStripPointerMove({ clientX: drag.lastClientX, clientY: y });
  _requestDragAutoscroll();
}

function _requestDragAutoscroll() {
  if (_dragAutoscrollFrame || typeof requestAnimationFrame !== 'function') return;
  _dragAutoscrollFrame = requestAnimationFrame(_dragAutoscrollStep);
}

function _onStripPointerMove(e) {
  if (!_efspDrag) return;
  _efspDrag.lastClientY = e.clientY;
  _efspDrag.lastClientX = e.clientX;
  const dy = e.clientY - _efspDrag.startY;

  if (!_efspDrag.hasMoved) {
    // A click with negligible movement must never commit a reorder or
    // transfer (a controller hit exactly this: clicking a newly-created
    // Strip relocated it to another Bay with no deliberate drag at all —
    // see strip-drag.js's hasExceededDragThreshold for the full reasoning).
    const dx = e.clientX - _efspDrag.startX;
    if (!hasExceededDragThreshold(dx, dy)) return; // still just a click so far — no capture, no visual drag feedback at all yet
    _efspDrag.hasMoved = true;
    _capturePointer(); // only now — see _capturePointer
    _efspDrag.dragEl.classList.add('efsp-strip-dragging'); // semi-transparent while moving, §7.2.3 — see _onStripPointerDown's comment on why this is deferred to here
    _efspDrag.dragEl.style.width = `${_efspDrag.dragWidth}px`; // F-403 — see _onStripPointerDown's dragWidth
    // F-402 — NOW, not on pointerdown. The class above is `position: fixed`,
    // so this is the first moment the Rack's other Strips are where the
    // controller will actually see them for the rest of the drag; the
    // getBoundingClientRect() inside flushes the pending layout, so it reads
    // the closed-up Rack rather than the one that was there a line ago. Still
    // exactly one measurement per drag (§7.2 rule 5).
    _cacheRackRects(_efspDrag.rackEl);
  }

  // transform-only movement (§7.2.4) — never top/left.
  _efspDrag.dragEl.style.transform = `translate3d(0, ${dy}px, 0)`;
  _requestDragAutoscroll();

  const dropTargetEl = _findDropTargetAt(e.clientX, e.clientY);
  if (dropTargetEl !== _efspDrag.dropTargetEl) {
    if (_efspDrag.dropTargetEl) _efspDrag.dropTargetEl.classList.remove('efsp-drop-target');
    if (dropTargetEl) dropTargetEl.classList.add('efsp-drop-target');
    _efspDrag.dropTargetEl = dropTargetEl;
  }

  if (dropTargetEl) {
    // Over a tab — hide the in-rack insertion line, the drop is going
    // somewhere else entirely.
    _efspDrag.insertionEl.style.display = 'none';
    return;
  }
  // F-406 — follow the pointer into a second Rack of the same Bay. Only when
  // it is actually over one: over the gap between two Racks the drag keeps
  // whichever Rack it last resolved, which is where the line is drawn.
  const rackUnder = _findRackAt(e.clientX, e.clientY);
  if (rackUnder && rackUnder !== _efspDrag.rackEl) {
    rackUnder.appendChild(_efspDrag.insertionEl); // `top` is relative to the Rack (see .efsp-rack's `position: relative`)
    _cacheRackRects(rackUnder);
  }

  _efspDrag.insertionEl.style.display = '';

  const { rects, rackEl, cacheScrollTop, scrollEl } = _efspDrag;
  const scrollNow = _scrollTopOf(scrollEl);
  const { index } = computeInsertionIndex(rects, scrollCompensatedY(e.clientY, cacheScrollTop, scrollNow));
  const rackTop = rackEl.getBoundingClientRect().top;
  let lineY;
  if (rects.length === 0) {
    // An empty Rack — reachable now that a drag can cross into one (F-406).
    // Under the header, not at the Rack's very top edge, which is where
    // `targetTop = 0` used to put the line: above the Rack entirely.
    const header = rackEl.querySelector('.efsp-rack-header');
    lineY = header ? header.getBoundingClientRect().bottom - rackTop : 0;
  } else {
    const last = rects[rects.length - 1];
    const cachedTop = index < rects.length ? rects[index].top : last.top + last.height;
    lineY = cachedTopToViewportY(cachedTop, cacheScrollTop, scrollNow) - rackTop;
  }
  _efspDrag.insertionEl.style.top = `${lineY}px`;
}

function _finishDrag(commit) {
  if (!_efspDrag) return;
  const { strip, rackEl, rects, dragEl, insertionEl, lastClientY, dropTargetEl, hasMoved, scrollEl, cacheScrollTop } = _efspDrag;
  if (_dragAutoscrollFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(_dragAutoscrollFrame);
  _dragAutoscrollFrame = null;
  document.removeEventListener('pointermove', _onStripPointerMove);
  document.removeEventListener('pointerup', _onStripPointerUp);
  document.removeEventListener('pointercancel', _onStripPointerCancel);
  dragEl.classList.remove('efsp-strip-dragging');
  dragEl.style.transform = '';
  dragEl.style.width = ''; // F-403 — pinned in _onStripPointerMove alongside the class above
  insertionEl.remove();
  if (dropTargetEl) dropTargetEl.classList.remove('efsp-drop-target');

  // hasMoved gates BOTH branches below — a click with no real movement
  // (DRAG_THRESHOLD_PX) commits nothing at all; the Strip's own separate
  // 'click' listener handles selection instead. Without this gate,
  // computeInsertionIndex() always resolves to SOME neighbor position
  // whenever the Rack has other Strips in it (it never itself reports "no
  // change"), so a plain click could silently reorder or relocate a Strip.
  if (commit && hasMoved && dropTargetEl && dropTargetEl.dataset.efspDropSlot !== undefined) {
    carrierMoveToSlot(strip, Number(dropTargetEl.dataset.efspDropSlot));
  } else if (commit && hasMoved && dropTargetEl) {
    const toPositionId = dropTargetEl.dataset.efspDropPosition;
    const explicitBayId = dropTargetEl.dataset.efspDropBay || null;
    if (toPositionId === strip.ownerPositionId && explicitBayId) {
      // Dropped on one of your OWN Bay tabs — same-owner relocation, no handoff.
      _moveStrip(strip, explicitBayId, _defaultRackFor(explicitBayId), null, null);
    } else if (toPositionId && toPositionId !== strip.ownerPositionId) {
      const targetBay = explicitBayId ? { bayId: explicitBayId, rackIds: [_defaultRackFor(explicitBayId)] } : _defaultBayFor(toPositionId);
      if (targetBay) _transferStrip(strip, toPositionId, targetBay.bayId, targetBay.rackIds[0]);
    }
  } else if (commit && hasMoved && !_isPseudoBayId(rackEl.dataset.bayId)) {
    // Use the last known pointer Y directly, captured on every pointermove
    // above — NOT parsed back out of the CSS transform string, which is
    // already cleared by the time we'd read it here.
    //
    // Mapped into the cache's coordinate space against the scroll offset read
    // HERE rather than the one the last pointermove saw, because the Bay can
    // scroll with no pointermove at all: Chromium autoscrolls the overflow
    // container on its own while the button is held at its edge (F-404's
    // second route), and the release then lands in a Rack that has moved since
    // the app last heard about it. `rackEl` is whichever Rack the pointer was
    // last over, which is the one the insertion line was drawn in (F-406).
    const { afterStripId, beforeStripId } = computeInsertionIndex(
      rects, scrollCompensatedY(lastClientY, cacheScrollTop, _scrollTopOf(scrollEl)),
    );
    const bayId = rackEl.dataset.bayId;
    const rackId = rackEl.dataset.rackId;
    if (bayId !== strip.bayId || rackId !== strip.rackId || afterStripId !== null || beforeStripId !== null) {
      _moveStrip(strip, bayId, rackId, afterStripId, beforeStripId);
    }
  }
  // A drop back inside the search pseudo-Bay itself (no dropTargetEl, and
  // the source rack IS the search Rack) is deliberately a no-op — there is
  // nothing to reorder in a synthetic Rack that doesn't exist server-side
  // (guide §4.3). Dropping a search-result Strip onto a REAL Position/Bay
  // tab still works fully — that's the `dropTargetEl` branch above, keyed
  // off the destination, not the source Rack.
  _efspDrag = null;
  renderAllOpenEfspBays();
}

function _onStripPointerUp() { _finishDrag(true); }
function _onStripPointerCancel() { _finishDrag(false); }
