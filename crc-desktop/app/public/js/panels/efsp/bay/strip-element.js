'use strict';
import { getEfspFlightData, getEfspObligation } from '../efsp-state.js';
import { _buildStripLayout } from '../strip-view.js';
import { setAttention, toggleFlip, toggleOffset } from '../efsp-gestures.js';
import { noteEfspGesture } from '../efsp-metrics-client.js';
import { STRIP_CONTROL_SELECTOR, _dispatchGesture } from './dispatch.js';
import { _selectStrip, _selectedStripId } from './selection.js';
import { _blockLabel, _buildBlockCell, _refusalForStrip, _setRestoredEditInThisStrip } from './block-edit.js';
import { _cycleHighlight, _openHighlightPopover } from './popovers/highlight.js';
import { _onStripPointerDown } from './drag.js';
import { markEfspChanged } from '../efsp-change-bus.js';
import { stripSigner } from './strip-signer.js';
import { _appendExpandedView, _expandedStripId, _setExpandedStripId } from './strip-expanded.js';

export function _buildStripEl(strip) {
  _setRestoredEditInThisStrip(false); // an open Block edit is restored into exactly one cell of this Strip
  const flightData = getEfspFlightData(strip.flightDataId);
  const el = document.createElement('div');
  el.className = 'efsp-strip';
  el.dataset.stripId = strip.stripId;
  el.dataset.rev = String(strip.rev); // renderBay()'s keyed reconciliation reuse check
  // Expansion is CLIENT-LOCAL state and does not move `rev`, so the
  // reconciler cannot see a toggle unless the rendered element records what it
  // was built as — exactly the problem selection already had, solved the same
  // way. Without this the toggle set _expandedStripId, asked for a re-render,
  // and the reconciler reused every element unchanged: nothing on screen moved.
  el.dataset.expanded = _expandedStripId === strip.stripId ? '1' : '0';
  // Everything this element renders OUTSIDE the Strip record (bay/strip-signature.js), stamped through the signer bay-view.js registers.
  const sign = stripSigner();
  if (sign) el.dataset.sig = sign(strip);
  el.dataset.positionId = strip.ownerPositionId; // read during drag drop-target resolution
  if (strip.flags.offset) el.classList.add('efsp-strip-offset');
  if (strip.flags.flipped) el.classList.add('efsp-strip-flipped');
  if (strip.flags.highlight) el.style.setProperty('--efsp-highlight', strip.flags.highlight);
  if (strip.flags.attention) el.classList.add('efsp-strip-attention');
  el.classList.toggle('efsp-strip-selected', strip.stripId === _selectedStripId);

  // WP4A (docs/adr/0021) — a distinct third alert tier, deliberately NOT
  // reusing efsp-strip-attention's red (reserved, guide §7.7 rule 4) or
  // the mutation-error red — a due-but-not-yet-catastrophic obligation
  // reads differently from "this Strip needs your attention right now."
  const obligation = getEfspObligation(strip.stripId);
  if (obligation) {
    el.classList.add('efsp-strip-obligation-due');
    if (obligation.severity === 'OVERDUE') el.classList.add('efsp-strip-obligation-overdue');
  }

  // F-103 — a refusal left no mark at all on the Strip it was about, so the
  // banner had to be matched to a Strip by reading the callsign back off it.
  // Honours a null stripId as "mark nothing" (see _refusalForStrip).
  const refusal = _refusalForStrip(strip);
  if (refusal) {
    el.classList.add('efsp-strip-refused');
    el.dataset.refusedReason = refusal.reason || '';
    el.title = refusal.message;
  }
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'listitem');
  el.setAttribute('aria-label', `Strip ${_blockLabel(flightData, strip, '1')}`);

  if (strip.flags.flipped) {
    // Flip (guide §7.3): hides all Blocks except aircraft ID — content
    // only. Event listeners are still attached below UNCONDITIONALLY — a
    // flipped Strip must remain double-clickable (to un-flip it),
    // selectable and draggable. An earlier version of this function
    // returned early right here, before any listener was ever attached,
    // which made a flipped Strip permanently inert with no way back
    // through the UI at all — this is that fix.
    el.appendChild(_buildBlockCell(strip, '1'));
  } else {
    // Layout C (docs/adr/0056): tab | fields | tools. strip-view.js.
    _buildStripLayout(el, strip, obligation);
  }

  // Flip: dblclick. Highlight: right-click (contextmenu) opens a 3-swatch
  // popover, or Ctrl+click steps the colour. Offset: Alt+click. Attention: Shift+click. All three guarded the same way the
  // NLA/offset buttons are guarded against drag-start (_onStripPointerDown
  // already ignores pointerdown on interactive children; these fire on the
  // Strip body itself, so they're gated here instead by checking e.target
  // isn't an editable Block cell — clicking IN a Block cell must never also
  // toggle Attention).
  el.addEventListener('click', (e) => {
    if (e.target.closest(STRIP_CONTROL_SELECTOR)) return;
    if (e.shiftKey) { const acting = _dispatchGesture(strip, setAttention, 'red'); noteEfspGesture('ATTENTION', 'shift-click', acting); return; }
    // S-L15 (§7.3 one-input ceiling): OFFSET and HIGHLIGHT each get a one-input entry point.
    // The ⋯ menu item and the right-click swatches stay for whoever prefers them (2 inputs).
    if (e.altKey) { e.preventDefault(); const acting = _dispatchGesture(strip, toggleOffset); noteEfspGesture('OFFSET', 'alt-click', acting); return; }
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); const acting = _cycleHighlight(strip); noteEfspGesture('HIGHLIGHT', 'ctrl-click', acting); return; }
    _selectStrip(strip.stripId);
  });
  el.addEventListener('dblclick', (e) => {
    if (e.target.closest(STRIP_CONTROL_SELECTOR)) return;
    const acting = _dispatchGesture(strip, toggleFlip); noteEfspGesture('FLIP', 'dblclick', acting);
  });
  el.addEventListener('contextmenu', (e) => {
    if (e.target.closest(STRIP_CONTROL_SELECTOR)) return;
    e.preventDefault();
    _openHighlightPopover(strip, el);
  });
  el.addEventListener('pointerdown', (e) => _onStripPointerDown(e, strip));
  el.addEventListener('keydown', (e) => _onStripKeydown(e, strip));

  return el;
}


/**
 * Space and Enter on a Strip toggle its selection — the keyboard half of the
 * non-drag move path (§7.8.1, WCAG 2.2 SC 2.5.7), which _onRackHeaderClick
 * then acts on.
 *
 * They belong to whatever control the controller is actually IN, though, and
 * this listener sits on the Strip element, so every key pressed inside a Block
 * input, an enum <select> or a popover field used to bubble up to it. That one
 * omission produced four catalogued defects (lane 2's F-201, F-203, F-205, and
 * half of F-202): a Space typed into a Block was preventDefault()ed and
 * toggled selection instead of being typed, and Enter committed a Block AND
 * moved the selection, so the next click on a Rack header moved a Strip nobody
 * had meant to select.
 *
 * Guarding on the event's TARGET rather than patching the four call sites is
 * deliberate: it covers every popover's fields without any of them knowing
 * about this handler, and any control added later. Neither half of the
 * mechanism could simply be deleted — this one is the drag-free move path, and
 * renderBay()'s refocus keeps focus off <body>.
 *
 * It could not reach the MARSA and bind popovers, which were a separate defect
 * rather than a gap here: those two appended their popover INTO the <button>
 * that opens it, so a Space typed in a field bubbled to the button and
 * ACTIVATED it, re-opening the popover with an empty form — no guard on this
 * handler could have helped, since the keypress never reached this handler at
 * all. Fixed where it belonged, in the anchoring: every popover is portalled
 * out of the Strip now (F-001's _mountPopover), and none of them is a
 * descendant of a control that handles its events.
 *
 * Escape collapses the expanded view (F-208) — see _appendExpandedView for
 * why that surface needs more than one way out.
 */
export function _onStripKeydown(e, strip) {
  if (_keyTargetIsStripControl(e)) return;
  if (e.key === 'Escape' && _expandedStripId === strip.stripId) {
    e.preventDefault();
    _setExpandedStripId(null);
    markEfspChanged('bays');
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    _selectStrip(strip.stripId);
  }
}

/**
 * Did this keydown start on a control INSIDE the Strip rather than on the
 * Strip element itself? Anything that handles Space or Enter on its own owns
 * them while it has focus: a text input, a <select>, a <button>, and the
 * click-to-edit Block cell, which is a <span tabindex="0"> with its own
 * Enter/Space handler rather than a native control.
 */
function _keyTargetIsStripControl(e) {
  const t = e.target;
  if (!t || t === e.currentTarget) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button' || tag === 'option') return true;
  return !!(t.classList && t.classList.contains('efsp-block-editable'));
}
