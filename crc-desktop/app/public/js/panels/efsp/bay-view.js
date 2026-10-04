'use strict';
import { efspLinesWithOthers, getEfspBays, getEfspRack, getEfspStrip, isWithOthersBayId, searchEfspStrips } from './efsp-state.js';
import { carrierOrderRack, renderCarrierStackBoard } from './carrier-panel.js';
import { renderBayDescriptorView } from './bay-views.js';
import { getActiveEfspSearchQuery } from './panel/tabs.js';
import { computeRackReconciliation } from './strip-drag.js';
import { _isPseudoBayId, _openBayContainers } from './bay/open-bays.js';
import { _buildStripEl } from './bay/strip-element.js';
import { _expandedStripId } from './bay/strip-expanded.js';
import { _refreshOpsFiledIfStale, _renderOpsFiledCards } from './bay/ops-cards.js';
import { _efspDrag } from './bay/drag.js';
import { _stripHasOpenPopover } from './bay/popover-portal.js';
import { _buildBlockCell } from './bay/block-edit.js';
import { ORDER, onEfspChanged } from './efsp-change-bus.js';
import { _moveStrip } from './bay/dispatch.js';
import { _clearSelectedStrip, _selectedStripId } from './bay/selection.js';
import { setStripSigner } from './bay/strip-signer.js';
import { _stripElNeedsRebuild, _stripRenderSignature } from './bay/strip-signature.js';

// Bay/Rack rendering + Pointer Events drag (guide §7.1-7.2, §7.5). DOM-only
// — not unit tested (crc-desktop's test suite has no DOM harness; see the
// implementation plan's explicit "manual QA, not Playwright" decision).
// The math this file calls (computeInsertionIndex) IS unit tested, in
// strip-drag.js.
//
// Rendering rules followed here, from the guide:
//   §7.5.2 — no virtualization; a Bay is tens of Strips.
//   §7.5.3 — batch incoming updates into one rAF commit.
//   §7.5.4 — keyed by stable stripId, never destroy-and-recreate on reorder.
//   §7.5.5 — contain: layout style paint per Strip (see efsp-panel.css).
//   §7.2.1 — a single insertion line, not live list reflow.
//   §7.2.3 — the dragged Strip is semi-transparent while moving.
//   §7.2.4 — dragged element moves via `transform: translate3d()` only,
//            `position: fixed`, never top/left.
//   §7.2.5 — insertion index computed from ONE cached set of rects, never
//            re-measured per pointermove. Cached the instant the dragged
//            Strip leaves the flow rather than at pointerdown, and read
//            through the scroll offset it was taken at — see strip-drag.js's
//            module comment (F-402, F-404).
//   §7.8.1 — every drag has a non-drag alternative: click-to-select, then
//            click a Rack to move there (WCAG 2.2 SC 2.5.7).
//   §7.8 rule 3 — a re-render restores focus by Strip ID, and ONLY when the
//            element that had it is gone (renderBay); Space and Enter belong
//            to whatever control inside the Strip has focus, so the Strip's
//            own selection keys stand aside for it (_onStripKeydown).
//   §3.7 rule 5 / §7.4 rule 2 — an edited Block commits on Enter, reverts on
//            Esc, and does NEITHER on blur. One edit is open at a time
//            (_openBlockEdit); an abandoned one survives a rebuild rather
//            than blocking it.


// Non-drag move path (WCAG 2.2 SC 2.5.7): select a Strip, then click a
// Rack's header to move the selection there — no pointer drag required.
function _onRackHeaderClick(bayId, rackId) {
  if (_isPseudoBayId(bayId)) return; // the search / with-others pseudo-Bay isn't a real destination server-side (guide §4.3) — nothing to move "into"
  if (!_selectedStripId) return;
  const strip = getEfspStrip(_selectedStripId);
  if (!strip) return;
  _moveStrip(strip, bayId, rackId, null, null);
  _clearSelectedStrip();
}

export function renderBay(container, bayId) {
  if (!container) return;
  if (bayId === 'ops-filed') {
    _renderOpsFiledCards(container);
    _refreshOpsFiledIfStale(container);
    return;
  }
  // The search pseudo-Bay (guide §4.3) is client-local — efsp-panel.js
  // synthesizes it, it's never in getEfspBays()'s server-driven list, so
  // it needs its own lookup instead of falling through to "unknown bayId,
  // clear the container".
  const bay = _isPseudoBayId(bayId)
    ? { bayId, rackIds: ['results'] }
    : getEfspBays().find(b => b.bayId === bayId);
  if (!bay) { container.innerHTML = ''; return; }

  const scrollTop = container.scrollTop;
  const activeEl = document.activeElement || null;
  const activeStripEl = activeEl ? activeEl.closest('.efsp-strip') : null;
  const focusedStripId = activeStripEl && container.contains(activeStripEl) ? activeStripEl.dataset.stripId : null;

  // Keyed by rackId ALONE would be wrong: multiple Bays share the literal
  // Rack id "main" (e.g. OPS's ops-filed AND ops-proposed both use
  // rackIds:['main']). A leftover Rack element from whichever Bay was
  // rendered into this container before still passes "rackId is in
  // bay.rackIds" and would get silently REUSED for the new Bay — with its
  // dataset.bayId never updated, since only _buildRackShell sets it, only
  // on creation. That's a real bug that shipped: switching from ops-filed
  // to ops-proposed reused ops-filed's stale "main" Rack element, so every
  // drag inside the (correctly strip-populated, but wrongly bay-tagged)
  // Rack silently targeted ops-filed regardless of drag direction. Keying
  // — and clearing — by the (bayId, rackId) PAIR is what actually fixes it.
  const existingRackEls = new Map();
  for (const el of [...container.children]) {
    if (el.dataset.bayId === bayId && bay.rackIds.includes(el.dataset.rackId)) {
      existingRackEls.set(el.dataset.rackId, el);
    } else if (el.classList.contains('efsp-bay-view') && el.dataset.bayId === bayId) {
      // This Bay's descriptor view (bay-views.js) is kept, so a control the controller is in survives a re-render.
    } else {
      el.remove(); // a different Bay's leftover Rack (or a Rack no longer in this Bay's rackIds)
    }
  }
  for (const rackId of bay.rackIds) {
    let rackEl = existingRackEls.get(rackId);
    if (!rackEl) {
      rackEl = _buildRackShell(bayId, rackId);
      container.appendChild(rackEl);
    }
    _reconcileRackStrips(rackEl, bayId, rackId);
  }

  // The Marshal stack's slot board (crc-sync docs/adr/0074): vacancies, derived fields, drop targets.
  if (bayId === 'cv-marshal-stack') renderCarrierStackBoard(container);
  // The Bay's descriptor view (crc-sync docs/adr/0093): the pattern board, the FINAL panel or the SFA rotation header.
  renderBayDescriptorView(container, bay);

  container.scrollTop = scrollTop;
  if (focusedStripId && activeEl && !container.contains(activeEl)) {
    // Re-focus by Strip ID, never DOM index (guide §7.8 rule 3) — a
    // reconciled/rebuilt element is a different node than the one that had
    // focus before this call.
    //
    // ONLY when the node that had focus is actually gone, though. Refocusing
    // unconditionally also TOOK focus: a Strip that survived reconciliation
    // still holds whatever was focused inside it, and focusing the Strip
    // element moved focus off it — so every board delta, ack and selection
    // change emptied the Block input a controller was in the middle of typing
    // into, and the rest of what they typed went nowhere (lane 2's F-202,
    // and the half of F-201 that swallows everything after the space).
    const el = container.querySelector(`.efsp-strip[data-strip-id="${CSS.escape(focusedStripId)}"]`);
    if (el) el.focus();
  }
}

function _buildRackShell(bayId, rackId) {
  const rackEl = document.createElement('div');
  rackEl.className = 'efsp-rack';
  rackEl.dataset.bayId = bayId;
  rackEl.dataset.rackId = rackId;
  rackEl.setAttribute('role', 'list');

  const header = document.createElement('div');
  header.className = 'efsp-rack-header';
  header.textContent = rackId;
  header.addEventListener('click', () => _onRackHeaderClick(bayId, rackId));
  rackEl.appendChild(header);

  return rackEl;
}

/** A Strip element is protected from removal/rebuild while it's mid-drag, is being typed into, or has any of the six popovers open — reconciling around it (never through it) is what actually fixes defect D6 here. */
export function _isProtectedStripEl(el) {
  if (_efspDrag && _efspDrag.strip.stripId === el.dataset.stripId) return true;
  // An open Block edit or picker holds the Strip still — but only while the
  // controller is actually IN it. Unconditional, this froze a Strip for good
  // the moment somebody clicked away from a half-typed Block (lane 2's
  // F-204): other controllers' changes to it never appeared again, a hand-off
  // left it drawn in the wrong Bay still offering its old NLA (which then came
  // back STALE_REV), and the only way out was to find the input, refocus it
  // and press Esc. Nothing ended the edit otherwise — _startBlockEdit's own
  // comment used to claim the next re-render would replace it, and the
  // protection here was exactly what stopped that re-render happening.
  //
  // An abandoned edit is not lost by the rebuild: _buildBlockCell puts it back
  // from _openBlockEdit with what was typed still in it. Blur still neither
  // commits nor reverts.
  const editEl = el.querySelector('.efsp-block-input');
  if (editEl && document.activeElement === editEl) return true;
  // Same for any other form control the controller is in — the TOFI regime
  // select above all, whose open dropdown belongs to the element a rebuild
  // would detach. Buttons deliberately do not count: a focused NLA button
  // would otherwise freeze its Strip after every press.
  const active = document.activeElement;
  if (active && active !== editEl && typeof el.contains === 'function' && el.contains(active)
      && /^(select|input|textarea)$/i.test(active.tagName || '')) return true;
  // An open popover holds its Strip still. This was six separate
  // `el.contains(_open*PopoverEl)` lines, and the list was found incomplete
  // three separate times after the same bug — highlight, coordinate, TOFI and
  // airspace were each added one at a time, and bind and MARSA were both still
  // missing at the third discovery. So the rule is enumerated rather than
  // listed: _mountPopover records which Strip every popover belongs to, and a
  // seventh popover is protected by having been mounted at all.
  //
  // Containment is no longer the question and cannot be: F-001 portals every
  // popover out to document.body, so `el.contains(popover)` is false for all
  // six. efsp-ui-reachability.test.mjs opens each popover in turn and asserts
  // its Strip is protected, which is what holds this to the class.
  if (_stripHasOpenPopover(el.dataset.stripId)) return true;
  return false;
}

function _reconcileRackStrips(rackEl, bayId, rackId) {
  const wanted = bayId.endsWith('-search') ? searchEfspStrips(getActiveEfspSearchQuery())
    : isWithOthersBayId(bayId) ? efspLinesWithOthers(bayId.slice(0, -'-with'.length))
      : carrierOrderRack(bayId, getEfspRack(bayId, rackId)); // the Marshal stack Bay is ordered by slot (docs/adr/0074)
  const wantedById = new Map(wanted.map(s => [s.stripId, s]));
  const existingEls = new Map(
    [...rackEl.children].filter(el => el.classList.contains('efsp-strip')).map(el => [el.dataset.stripId, el])
  );

  const protectedIds = new Set([...existingEls].filter(([, el]) => _isProtectedStripEl(el)).map(([id]) => id));
  const dirtyIds = new Set(
    [...existingEls]
      .filter(([id, el]) => {
        const w = wantedById.get(id);
        if (!w) return false; // no longer wanted — toRemove handles it, not a rebuild
        return _stripElNeedsRebuild(el, w, _selectedStripId, _expandedStripId);
      })
      .map(([id]) => id)
  );

  const { toRemove, order } = computeRackReconciliation(
    [...existingEls.keys()], wanted.map(s => s.stripId), dirtyIds, protectedIds,
  );

  for (const stripId of toRemove) {
    existingEls.get(stripId).remove();
    existingEls.delete(stripId);
  }

  let cursor = rackEl.firstElementChild.nextSibling; // first element after the header, or null
  for (const { stripId, rebuild } of order) {
    if (protectedIds.has(stripId)) continue; // never move OR rebuild — leave it exactly where it is; it reconciles on a later render once unprotected

    let el = existingEls.get(stripId);
    if (!el) {
      const fresh = _buildStripEl(wantedById.get(stripId));
      rackEl.insertBefore(fresh, cursor);
      existingEls.set(stripId, fresh);
      cursor = fresh.nextSibling; // unchanged in practice — fresh was inserted right before the old cursor
      continue;
    }
    if (rebuild) {
      // If `el` (about to be replaced) IS the current cursor, replaceWith()
      // is about to detach the exact node `cursor` points to — capture a
      // stable successor FIRST. Skipping this is what caused a live
      // "Failed to execute 'insertBefore': the node before which the new
      // node is to be inserted is not a child of this node" crash on
      // every ordinary rebuild (an offset toggle, any Mutation ack): cursor
      // kept referencing the now-detached old element, and the very next
      // insertBefore(el, cursor) call below failed because that node was
      // no longer attached to rackEl at all.
      if (el === cursor) cursor = el.nextSibling;
      const fresh = _buildStripEl(wantedById.get(stripId));
      el.replaceWith(fresh);
      el = fresh;
      existingEls.set(stripId, el);
    }
    if (el !== cursor) rackEl.insertBefore(el, cursor);
    cursor = el.nextSibling;
  }
}

// rAF-batched multi-Bay re-render (§7.5.3) — coalesces bursts of Board
// deltas into one paint rather than one per incoming message.
let _renderScheduled = false;

export function renderAllOpenEfspBays() {
  if (_renderScheduled) return;
  _renderScheduled = true;
  requestAnimationFrame(() => {
    _renderScheduled = false;
    for (const { containerEl, bayId } of _openBayContainers) renderBay(containerEl, bayId);
  });
}

// ESM-1 (S-ESM1b): the unit tests replaced these globals to count calls; these are those seams.
export function _setRenderAllOpenEfspBaysForTest(fn) { renderAllOpenEfspBays = fn; }
export function _setRenderBayForTest(fn) { renderBay = fn; }

// What redraws the open Bays (efsp-change-bus.js): the Board, an ack, correlation, MARSA, alerts and SFA, and a direct
// 'bays' request from a popover, a drag or a refusal. Called through the binding so a test's replacement counts.
// The signature reads strip-view.js's alerts, which imports strip-element.js, so the element builder is handed it here.
setStripSigner(_stripRenderSignature);

onEfspChanged(['snapshot', 'board', 'ack', 'bays', 'selection', 'correlations', 'marsa', 'alerts', 'sfa'], () => renderAllOpenEfspBays(), { order: ORDER.BAYS });
