'use strict';
import { renderAllOpenEfspBays } from '../bay-view.js';



// ── The popover portal (F-001, F-108, F-109) ─────────────────────────────
//
// All six popovers used to be appended INSIDE the Strip that opened them, and
// every one of them was painted underneath the rest of the panel. It is not a
// z-index that lost a fight: `.efsp-strip` carries `contain: layout style`,
// and `contain: layout` CREATES A STACKING CONTEXT — so a popover's
// `z-index: 50` only ever competed with its own Strip's children, while the
// Strip itself is `z-index: auto` and everything painted after it (the next
// Strip down, the dot-command input, dockview's own containers) sat on top.
// Measured with elementFromPoint at each popover's centre: six popovers, six
// other elements. The CSS comment on `.efsp-strip` records `contain: paint`
// being dropped because it CLIPPED popovers — that fixed the visible half and
// left this one, so re-examining `paint` alone would have missed it entirely.
//
// The same containment has two further consequences, and a fix that only wins
// the stacking contest leaves both standing:
//   - what overflows a contained Strip is INK overflow, so the Bay's
//     scrollHeight never grew to include the popover: scrolling to the bottom
//     of the Bay still did not reach a popover hanging below it (lane 3
//     measured scrollHeight 211 against a popover bottom ~330 px in);
//   - a popover opened from a Strip near the bottom of a short Bay ran off the
//     end of the panel altogether, into dockview — the Coordinate popover was
//     not in a screenshot of #efsp-panel at all.
//
// `contain: layout style` is load-bearing (§7.5 rule 5's reflow isolation, and
// F-208's sticky trailing row now depends on the containing block it makes) so
// it stays and the popover leaves instead: `position: fixed` on document.body,
// placed from the anchor's viewport rect, flipped above the anchor when it
// would run off the bottom and clamped into the viewport otherwise. One move
// escapes the stacking context, the containment and the Bay's overflow, and it
// needs no CSS — every placement declaration here is an inline style.
//
// It dissolves F-110 and the MARSA/bind half of F-201 as a side effect. Those
// two anchored the popover inside the <button> that opens it, so any click in
// the popover bubbled back to that button and rebuilt the popover empty (and a
// Space typed in a field activated the button, with the same result). A
// portalled popover is not a descendant of anything that handles its clicks.

// Which Strip each open popover belongs to, and how to close it.
// _isProtectedStripEl used to ask `stripEl.contains(popoverEl)`, which a
// portalled popover answers false to every time — the protection all six rely
// on would have evaporated silently. It is keyed on the Strip id now.
const _openPopovers = new Map(); // popover element -> { stripId, anchorEl, close, armed }

// Above the panel chrome (.efsp-bay-tabs and the topbar are 50, the airport
// selector 100) and below srs-radio.css's full-screen modal at 200, which
// genuinely should cover a Strip popover.
const POPOVER_Z_INDEX = '150';
const POPOVER_VIEWPORT_MARGIN = 4;

let _popoverTracking = false;
let _postPopoverRenderTimer = null;

function _popoverRoot(anchorEl) {
  return (typeof document !== 'undefined' && document.body) || anchorEl;
}

/**
 * Place a portalled popover against its anchor, in viewport coordinates.
 *
 * Two passes, because the flip decision needs the popover's own height and
 * nothing knows that until it has been laid out. Both happen inside one call,
 * before the browser paints, so there is no visible jump.
 */
function _placePopover(popover, anchorEl) {
  if (!anchorEl || typeof anchorEl.getBoundingClientRect !== 'function') return;
  const a = anchorEl.getBoundingClientRect();
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 0;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
  const m = POPOVER_VIEWPORT_MARGIN;

  // The CSS puts these at `top: 100%` with `left`/`right` offsets against the
  // Strip; fixed positioning has to neutralise the axis it does not set.
  popover.style.position = 'fixed';
  popover.style.right = 'auto';
  popover.style.bottom = 'auto';
  popover.style.left = '0px';
  popover.style.top = '0px';

  const r = popover.getBoundingClientRect();
  const w = r.width || 0;
  const h = r.height || 0;

  // Below the anchor by default; above it when that would run off the bottom
  // of the viewport, which is the case that made Coordinate and TOFI invisible
  // on a short Bay. Clamped if it fits neither way — a popover pinned to the
  // bottom edge overlapping its anchor still beats one nobody can see.
  let top = a.bottom + m;
  if (vh && top + h > vh - m) {
    const above = a.top - m - h;
    top = above >= m ? above : Math.max(m, vh - m - h);
  }
  let left = a.left;
  if (vw) left = Math.min(left, vw - m - w);
  left = Math.max(m, left);

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

export function _mountPopover(popover, anchorEl, strip, close) {
  popover.style.zIndex = POPOVER_Z_INDEX;
  _popoverRoot(anchorEl).appendChild(popover);
  const entry = { stripId: strip && strip.stripId, anchorEl, close, armed: false };
  _openPopovers.set(popover, entry);
  _placePopover(popover, anchorEl);
  _startPopoverTracking();
  // Outside-click is armed one tick later, so the event that opened the popover (a contextmenu, a click that bubbles to a
  // document listener) cannot also close it.
  setTimeout(() => { entry.armed = true; }, 0);
}

/**
 * The one popover/menu opener (DESK-TIDY-2, ARCH-C 3.3). The caller builds `el`; the portal owns what every popover
 * shares: position (portalled, flipped, clamped), one open at a time (opening closes whichever is open), outside
 * pointerdown and Escape close, the stop of pointerdown inside it (the Bay must not start a drag), optional first focus,
 * and the deferred render a close owes its Strip. `onClose` runs once, whichever way it closed.
 * @param {{ el: HTMLElement, anchor: HTMLElement, strip?: {stripId?: string}, onClose?: () => void, focus?: HTMLElement|null }} o
 * @returns {{ el: HTMLElement, close: () => void }}
 */
export function openPopover({ el, anchor, strip, onClose, focus }) {
  _closeAllPopovers();
  let closed = false;
  const handle = {
    el,
    close() {
      if (closed) return;
      closed = true;
      _unmountPopover(el);
      if (onClose) onClose();
    },
  };
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  _mountPopover(el, anchor, strip, handle.close);
  if (focus && typeof focus.focus === 'function') focus.focus();
  return handle;
}

export function _unmountPopover(popover) {
  if (!popover) return;
  if (popover.parentNode) popover.parentNode.removeChild(popover);
  _openPopovers.delete(popover);
  if (_openPopovers.size === 0) _stopPopoverTracking();
  _requestPostPopoverRender();
}

/**
 * A popover's Send (DESK-ACKS): the popover stays open, input intact, until the server answers. An accepted ack closes it;
 * a refusal leaves it open (the refusal banner says why), so a note or a form that was refused is not lost. `send(onAck)`
 * dispatches and returns true when something was sent. The button is dead while the request is in flight. A popover the
 * controller closed meanwhile (outside click, Escape, another popover) is left alone when the ack lands.
 * @returns {boolean} whether a request went out
 */
export function _sendFromPopover(popover, button, send) {
  if (button) button.disabled = true;
  const sent = send((ack) => {
    if (button) button.disabled = false;
    const open = _openPopovers.get(popover);
    if (ack.ok && open) open.close();
    return false; // not handled here: a refusal still gets the banner
  });
  if (!sent && button) button.disabled = false;
  return !!sent;
}

/** Does any open popover belong to this Strip? The portalled replacement for six `el.contains(...)` checks. */
export function _stripHasOpenPopover(stripId) {
  if (!stripId) return false;
  for (const entry of _openPopovers.values()) if (entry.stripId === stripId) return true;
  return false;
}

function _closeAllPopovers() {
  for (const entry of [..._openPopovers.values()]) entry.close();
}

// A fixed element does not move when the Bay scrolls or the window resizes,
// so it has to be told. Capture phase on `scroll`: the Bay scrolls, not the
// window, and a scroll event on an inner element does not bubble — capture is
// the only way one listener sees every scroller between here and the root.
function _startPopoverTracking() {
  if (_popoverTracking || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  _popoverTracking = true;
  window.addEventListener('scroll', _onPopoverViewportChange, true);
  window.addEventListener('resize', _onPopoverViewportChange);
  document.addEventListener('keydown', _onDocKeydownClosePopover, true);
  document.addEventListener('pointerdown', _onDocPointerDownClosePopover, true);
}

function _stopPopoverTracking() {
  if (!_popoverTracking) return;
  _popoverTracking = false;
  window.removeEventListener('scroll', _onPopoverViewportChange, true);
  window.removeEventListener('resize', _onPopoverViewportChange);
  document.removeEventListener('keydown', _onDocKeydownClosePopover, true);
  document.removeEventListener('pointerdown', _onDocPointerDownClosePopover, true);
}

// Capture phase on `document`: it runs before the popover's own handlers, so it must test the target (a bare close would
// tear the pressed row out of the DOM between pointerdown and pointerup and no click would ever fire on it).
function _onDocPointerDownClosePopover(e) {
  for (const [popover, entry] of [..._openPopovers]) {
    if (entry.armed && !popover.contains(e.target)) entry.close();
  }
}

function _onPopoverViewportChange() {
  for (const [popover, entry] of [..._openPopovers]) {
    // The anchor went with its Strip (a Bay closed, a Strip transferred away).
    // A popover left floating over the panel with nothing behind it is worse
    // than one that closes.
    if (entry.anchorEl && entry.anchorEl.isConnected === false) { entry.close(); continue; }
    _placePopover(popover, entry.anchorEl);
  }
}

/**
 * Escape closes the popover (F-109).
 *
 * Not a doctrine requirement — no rule asks for it — but in this same panel
 * Escape reverts a Block edit and an enum <select> (§7.4 rule 2) and collapses
 * the expanded view, so a controller who has learned "Esc backs out" finds it
 * works on a Block and not on the popover next to it.
 *
 * On `document` in the CAPTURE phase for both halves of that: it fires wherever
 * focus happens to be (the opener <button>, a field in the popover, or nothing
 * at all), and stopping it here is what keeps the same keypress from ALSO
 * reverting the Block edit or collapsing the Strip behind the popover.
 */
function _onDocKeydownClosePopover(e) {
  if (e.key !== 'Escape' || _openPopovers.size === 0) return;
  e.preventDefault();
  e.stopPropagation();
  _closeAllPopovers();
}

/**
 * F-108 — a popover closed WITHOUT acting left its Strip out of date.
 *
 * _reconcileRackStrips skips a protected Strip on the grounds that "it
 * reconciles on a later render once unprotected", and nothing ever asked for
 * that later render: on a quiet Board the Strip kept showing whatever it
 * showed when the popover opened, indefinitely. Acting hid it, because the
 * ack's own render caught the Strip up.
 *
 * Deferred rather than called from _unmountPopover directly: every
 * _open*Popover closes the previous popover first, and a synchronous render
 * there would tear out the anchor element mid-open. By the time the timer
 * runs, a reopened popover is registered again and the render is correctly
 * skipped — the Strip is still protected.
 */
function _requestPostPopoverRender() {
  if (_postPopoverRenderTimer) return;
  _postPopoverRenderTimer = setTimeout(() => {
    _postPopoverRenderTimer = null;
    if (_openPopovers.size > 0) return;
    renderAllOpenEfspBays();
  }, 0);
}
