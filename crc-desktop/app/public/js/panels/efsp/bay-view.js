'use strict';
import { isWithinDoubleTapWindow } from './efsp-nla.js';
import {
  conformanceAlertsForFlightData, correlatedTrackIdForStrip, efspLinesWithOthers, getEfspAirspace, getEfspBays,
  getEfspCorrelationForStrip, getEfspFlightData, getEfspMarsa, getEfspObligation, getEfspRack, getEfspStrip,
  isWithOthersBayId, marsaForStrip, otherLiveStripsForFlightData, searchEfspStrips, conflictAlertsForTrack,
  surveillanceHintsForStrip
} from './efsp-state.js';
import { getActingPositions, sendEfspCorrelationMutation, sendEfspMarsaMutation, sendEfspMutation } from './efsp-ws.js';
import { noteEfspStripSelected } from './efsp-metrics-client.js';
import { highlightMarsaParticipants, isMarsaHighlighted } from './marsa-badge.js';
import { arSignatureFor, highlightArParticipants } from './ato-strip.js';
import { highlightCorrelatedTrack } from './correlation-highlight.js';
import { carrierOrderRack, carrierSignatureFor, renderCarrierStackBoard } from './carrier-panel.js';
import { renderBayDescriptorView } from './bay-views.js';
import { stereoRoutesCacheKey } from './efsp-stereo-routes.js';
import { tofiExitSignatureFor } from './strip-view.js';
import { efspArrivalFor } from './efsp-arrivals.js';
import { runwayStatusSignatureFor } from './runway-status-rules.js';
import { trackRef } from '../../track-label.js';
import { getActiveEfspSearchQuery } from './efsp-panel.js';
import { computeRackReconciliation } from './strip-drag.js';
import {
  _isPseudoBayId, _openBayContainers, _stripElById, getOpenEfspBayIds, setOpenEfspBays
} from './bay/open-bays.js';
import {
  CHIP_HISTORY_LIMIT, _appendAnnotationHistory, _appendDropButton, _appendExpandButton, _appendExpandedView,
  _buildStripEl, _expandedStripId, _setExpandedStripId
} from './bay/strip-element.js';
import {
  COORDINATION_PRIMITIVE_LABELS, _buildCoordinationNoteEl, _buildCoordinationReasonEl, _canProposeCoordination,
  _coordinationIsReplica, _coordinationProposerOf, _coordinationStateWord, _dispatchCoordination,
  _isPendingCoordinationReplica, _isRejectedCoordinationReplica, _openCoordinatePopover
} from './bay/popovers/coordination.js';
import { _refreshOpsFiledIfStale, _renderOpsFiledCards } from './bay/ops-cards.js';
import { _efspDrag } from './bay/drag.js';
import { _mountPopover, _stripHasOpenPopover, _unmountPopover } from './bay/popover-portal.js';
import { _buildBlockCell, _refusalForStrip } from './bay/block-edit.js';
import { _openBindPopover } from './bay/popovers/bind.js';
import { _openMarsaPopover } from './bay/popovers/marsa.js';
import {
  AIRSPACE_ENTRY_POSITIONS, CONVERT_TO_ARRIVAL_POSITIONS, COORDINATION_TARGETS, HAND_BACK_TO, TOFI_ANSWERED_BY,
  TOFI_COUNTERPARTS
} from './bay/authority-mirror.js';
import {
  TOFI_ACCEPT_REGIMES, _canProposeTofiEntry, _canProposeTofiExit, _canTransferTofiComms, _dispatchTofi,
  _isPendingTofiReplica, _openTofiEntryPopover, _tofiExitPrecondition, _tofiProposerOf, _tofiRegimeChoice
} from './bay/popovers/tofi.js';
import {
  _canApproveAirspaceEntry, _canConvertToArrival, _openAirspaceEntryPopover, _pendingConvertStripId,
  _setPendingConvertStripId
} from './bay/popovers/airspace-entry.js';

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


// ESM-2a: the Bay view's features live in bay/*; every name this file used to export is still exported from here.
export {
  AIRSPACE_ENTRY_POSITIONS, CHIP_HISTORY_LIMIT, CONVERT_TO_ARRIVAL_POSITIONS, COORDINATION_PRIMITIVE_LABELS,
  COORDINATION_TARGETS, HAND_BACK_TO, TOFI_ACCEPT_REGIMES, TOFI_ANSWERED_BY, TOFI_COUNTERPARTS,
  _appendAnnotationHistory, _appendDropButton, _appendExpandButton, _appendExpandedView, _buildBlockCell,
  _buildCoordinationNoteEl, _buildCoordinationReasonEl, _buildStripEl, _canApproveAirspaceEntry,
  _canConvertToArrival, _canProposeCoordination, _canProposeTofiEntry, _canProposeTofiExit,
  _canTransferTofiComms, _coordinationIsReplica, _coordinationProposerOf, _coordinationStateWord,
  _dispatchCoordination, _dispatchTofi, _expandedStripId, _isPendingCoordinationReplica, _isPendingTofiReplica,
  _isRejectedCoordinationReplica, _mountPopover, _openAirspaceEntryPopover, _openBindPopover,
  _openCoordinatePopover, _openMarsaPopover, _openTofiEntryPopover, _pendingConvertStripId, _setExpandedStripId,
  _setPendingConvertStripId, _stripHasOpenPopover, _tofiExitPrecondition, _tofiProposerOf, _tofiRegimeChoice,
  _unmountPopover, getOpenEfspBayIds, setOpenEfspBays
};

export let _selectedStripId = null; // click-to-select state for the non-drag move path

export function getSelectedEfspStripId() { return _selectedStripId; }

// The board-wide double-tap guard (guide §3.5 rule 3, lane 1's F-101).
//
// crc-sync has a 400ms guard too, keyed per stripId, and that is the right key
// for the bug it was written for: one controller pressing one Strip's button
// twice. It is structurally incapable of catching this one. The first press
// transfers the Strip away, the Rack reflows, and the NEIGHBOUR's button is
// now exactly where the pointer is — so the second tap is an ordinary first
// click on a different Strip, which no per-Strip guard can see.
//
// Lane 4 measured it on every transfer-shaped step, and the worst case is the
// one to design against: a double-tap on "Hand Off to APP" pressed "Line Up
// and Wait" for the jet that slid up underneath. The Strip that arrives under
// the pointer need not even be in the same state as the one tapped, so this is
// a runway clearance nobody gave.
//
// Hence a board-wide window: any advancing press within DOUBLE_TAP_MS of
// another advancing press is discarded. Silently, and raising no banner —
// §3.5 rule 3 is explicit that a double tap is "success, not an error", and
// the server's own guard was deliberately left as a silent no-op for the same
// reason. The cost is that a controller who genuinely meant two presses inside
// 400ms presses once more.
//
// efsp-nla.js has exported isWithinDoubleTapWindow/DOUBLE_TAP_MS for exactly
// this since Phase 1 ("so the button visibly disables … without waiting on a
// round trip") and nothing in app/public/js had ever called it.
let _lastAdvancingPressAt = null;

/** @returns {boolean} true when this press is the tail of a double tap and must be dropped. */
export function _swallowRepeatAdvance() {
  const now = Date.now();
  if (typeof isWithinDoubleTapWindow === 'function' && isWithinDoubleTapWindow(_lastAdvancingPressAt, now)) return true;
  _lastAdvancingPressAt = now;
  return false;
}

export function _dispatchMarsa(strip, marsaId, op) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  const relation = marsaId && typeof getEfspMarsa === 'function' ? getEfspMarsa(marsaId) : null;
  sendEfspMarsaMutation(actingPositionId, marsaId, relation ? relation.rev : undefined, op);
}

export function _dispatchCorrelation(strip, op) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  const record = typeof getEfspCorrelationForStrip === 'function' ? getEfspCorrelationForStrip(strip) : null;
  sendEfspCorrelationMutation(actingPositionId, strip.fdrId, record ? record.rev : 0, op);
}

export function _selectStrip(stripId) {
  _selectedStripId = _selectedStripId === stripId ? null : stripId;
  if (typeof noteEfspStripSelected === 'function') noteEfspStripSelected(_selectedStripId); // docs/adr/0072
  _afterSelectionChanged();
}

/**
 * Selects a Strip without the toggle. Called when a click on the MAP resolves
 * to this Strip (correlation-highlight.js's selectStripForTrack) — clicking a
 * contact twice must not deselect its Strip, which is what _selectStrip's
 * toggle would do.
 */
export function selectEfspStripById(stripId) {
  if (!getEfspStrip(stripId)) return false;
  _selectedStripId = stripId;
  if (typeof noteEfspStripSelected === 'function') noteEfspStripSelected(_selectedStripId); // docs/adr/0072
  _afterSelectionChanged();
  const el = _stripElById(stripId);
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'nearest' });
  }
  return true;
}

function _afterSelectionChanged() {
  // §9.2 rule 5 — "selecting one participant MUST highlight the others."
  // Resolved BEFORE the re-render below, not after, because the highlight is a
  // class each Strip element reads while it is being built. Doing it the other
  // way round would leave the highlight one selection behind, which is the kind
  // of off-by-one that looks like a race and is not.
  if (typeof highlightMarsaParticipants === 'function') highlightMarsaParticipants(_selectedStripId);
  if (typeof highlightArParticipants === 'function') highlightArParticipants(_selectedStripId); // docs/adr/0071
  renderAllOpenEfspBays();
  // Ring the selected Strip's contact on the map (guide §6.6 rule 4). One Map
  // lookup plus the existing rAF-batched updateMap() — see
  // correlation-highlight.js on why the 1s budget is not a concern here.
  if (typeof highlightCorrelatedTrack === 'function') highlightCorrelatedTrack(_selectedStripId);
}

// Non-drag move path (WCAG 2.2 SC 2.5.7): select a Strip, then click a
// Rack's header to move the selection there — no pointer drag required.
function _onRackHeaderClick(bayId, rackId) {
  if (_isPseudoBayId(bayId)) return; // the search / with-others pseudo-Bay isn't a real destination server-side (guide §4.3) — nothing to move "into"
  if (!_selectedStripId) return;
  const strip = getEfspStrip(_selectedStripId);
  if (!strip) return;
  _moveStrip(strip, bayId, rackId, null, null);
  _selectedStripId = null;
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
    renderAllOpenEfspBays();
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

// The Position a controller acts as for a Mutation on this Strip — its
// current Owner if held, else whichever held Position happens to be first.
// Shared by every dispatch helper below (NLA, move, transfer, gestures).
export function _resolveActingPositionId(strip) {
  const positions = getActingPositions();
  return positions.includes(strip.ownerPositionId) ? strip.ownerPositionId : positions[0];
}

/**
 * @returns {boolean} whether a Mutation was actually sent — the caller uses it
 *   to give the press its <50ms feedback (§7.9) without lying about a press
 *   that went nowhere.
 */
export function _invokeNla(strip) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return false;
  // F-101 — board-wide, because the Strip this press lands on after a reflow
  // is not the Strip the previous press was about. See _swallowRepeatAdvance.
  if (_swallowRepeatAdvance()) return false;
  sendEfspMutation(actingPositionId, strip, { kind: 'InvokeNla' });
  return true;
}

export function _moveStrip(strip, bayId, rackId, afterStripId, beforeStripId) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  sendEfspMutation(actingPositionId, strip, { kind: 'MoveStrip', bayId, rackId, afterStripId, beforeStripId });
}

// Owning Position hand-off (guide §4.5) — distinct from _moveStrip, which
// only ever reorders/relocates a Strip within its CURRENT owner's own Bay
// set. Appends to the end of the destination Bay/Rack; the guide doesn't
// mandate letting the sender pick an exact insertion point mid-transfer,
// and the receiving controller can always reorder locally afterward.
export function _transferStrip(strip, toPositionId, bayId, rackId) {
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  sendEfspMutation(actingPositionId, strip, { kind: 'TransferStrip', toPositionId, bayId, rackId });
}

/**
 * The Bay a hand-back lands in: the receiving Position's Bay implying the
 * Strip's state, else its first Bay implying none — the client mirror of
 * board-store.js's _bayForNewOwner (the server rule is authoritative).
 * @returns {{bayId:string, rackId:string}|null}
 */
export function _handBackBayFor(strip, toPositionId) {
  const bays = getEfspBays().filter(b => b.positionId === toPositionId && (!b.facilityId || b.facilityId === strip.facilityId));
  const bay = bays.find(b => b.impliesState === strip.state) || bays.find(b => !b.impliesState) || null;
  return bay ? { bayId: bay.bayId, rackId: (bay.rackIds && bay.rackIds[0]) || 'main' } : null;
}

export function _dispatchHandBack(strip, toPositionId) {
  strip = getEfspStrip(strip.stripId) || strip; // F-107 — see _dispatchCoordination
  const actingPositionId = _resolveActingPositionId(strip);
  if (actingPositionId !== strip.ownerPositionId) return; // only its owner hands a line on
  const bay = _handBackBayFor(strip, toPositionId);
  if (!bay) return;
  sendEfspMutation(actingPositionId, strip, { kind: 'TransferStrip', toPositionId, bayId: bay.bayId, rackId: bay.rackId });
}

// Anything on a Strip that is a control of its own. A click, double-click or
// right-click that lands on one of these belongs to the control, never to the
// Strip's select / flip / highlight gestures underneath it.
export const STRIP_CONTROL_SELECTOR = '.efsp-block-editable, .efsp-block-input, button, select, option, label, input, textarea';

// The four paper gestures (guide §7.3, defect D4) — efsp-gestures.js's
// toggleOffset/toggleFlip/setHighlight/setAttention are pure and each
// already dispatch exactly one Mutation; this is the one shared plumbing
// point that resolves actingPositionId and hands them a bound
// sendMutation(strip, op), matching _invokeNla/_moveStrip/_transferStrip's
// own pattern. `extraArgs` covers setHighlight/setAttention's `color` param.
export function _dispatchGesture(strip, gestureFn, ...extraArgs) {
  // F-107 — see _dispatchCoordination. Highlight is dispatched from a popover,
  // and setHighlight reads strip.flags to decide whether this colour clears or
  // replaces, so a stale capture gets that wrong as well as the rev.
  strip = getEfspStrip(strip.stripId) || strip;
  // A dead replica refuses every Flag write (F-303) — say nothing rather than
  // raise a refusal banner for a double-click.
  if (_isRejectedCoordinationReplica(strip)) return;
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  gestureFn(strip, ...extraArgs, (s, op) => sendEfspMutation(actingPositionId, s, op));
  return actingPositionId; // truthy only when dispatched — what the gesture metric counts (docs/adr/0072)
}

/** The first configured Bay for a Position — used as the transfer landing spot when the drop target is a Position tab rather than a specific Bay tab. Facility-config.js's Bay ordering intentionally puts each Position's "entry" Bay first (e.g. CD's Pending Clearance, GND's Pushback). */
export function _defaultBayFor(positionId) {
  return getEfspBays().find(b => b.positionId === positionId) || null;
}

export function _defaultRackFor(bayId) {
  const bay = getEfspBays().find(b => b.bayId === bayId);
  return bay ? bay.rackIds[0] : 'main';
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
  if (bayId === 'cv-marshal-stack' && typeof renderCarrierStackBoard === 'function') renderCarrierStackBoard(container);
  // The Bay's descriptor view (crc-sync docs/adr/0093): the pattern board, the FINAL panel or the SFA rotation header.
  if (typeof renderBayDescriptorView === 'function') renderBayDescriptorView(container, bay);

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
  // six. efsp-ui-reachability.test.js opens each popover in turn and asserts
  // its Strip is protected, which is what holds this to the class.
  if (_stripHasOpenPopover(el.dataset.stripId)) return true;
  return false;
}

/**
 * Everything a Strip RENDERS that does not live on the Strip record, as one
 * short string the reconciler can compare.
 *
 * `rev` is the Strip's own optimistic-concurrency counter and it moves only
 * when a Mutation changes THAT Strip. _buildStripEl reads a great deal more
 * than that, all of it keyed somewhere else and all of it able to change while
 * `rev` stands still (lane 3's F-305, measured on six separate surfaces):
 *
 *   strip.nla      what pressing the NLA would do right now. crc-sync moves it
 *                  when Position occupancy or a clock deadline changes, and
 *                  deliberately does NOT bump `rev` to say so — `rev` is
 *                  concurrency control, and bumping it outside a Mutation
 *                  would invalidate every controller's in-flight edit.
 *   the FDR        every Block value, and fdr.tofi.separationRegime, which is
 *                  what the TOFI exit gate reads. A regime set on the ATC-side
 *                  Strip left the MRU's "Accept TOFI Exit" disabled forever.
 *   siblings       the +N shared-FDR badge is computed from OTHER Strips.
 *   obligation     §4.6.1's alerts live in their own store. An OVERDUE
 *                  obligation that only appears once the controller happens to
 *                  touch that Strip is not an alarm.
 *   MARSA          the relation and rule 5's participant highlight.
 *   correlation    §6.6's badge, and the Bind… button that comes with it — so
 *                  on a fresh Strip the bind popover could not be opened at all.
 *   airspace       a range controller activates and returns an airspace
 *                  without touching any Strip.
 *   the refusal    F-103's Strip-level marker is panel chrome (efsp-panel.js's
 *                  getCurrentEfspRefusal) and moves on its own.
 *
 * The answer for client-local state was already established — selection and
 * expansion are stamped on the element so the reconciler can see them. This is
 * that answer generalized rather than a sixth special case, and it is a
 * signature rather than a full rebuild because guide §7.5.4 and defect D6
 * require keyed reconciliation: a rebuild destroys in-progress work.
 *
 * Cheap on purpose — it runs for every Strip on every board delta. Every line
 * is a field read or a Map lookup bar the sibling walk, which _buildStripEl
 * already does once per Strip anyway.
 */
export function _stripRenderSignature(strip) {
  const parts = [];

  // `undefined` (a record from a server that does not compute it) and `null`
  // (this State has no NLA at all) are different answers and must compare
  // differently.
  parts.push('nla:' + (strip.nla === undefined ? '?' : JSON.stringify(strip.nla)));
  // Which Position the controller is acting as decides which controls render.
  parts.push('act:' + (_resolveActingPositionId(strip) || ''));

  const fdr = typeof getEfspFlightData === 'function' ? getEfspFlightData(strip.fdrId) : null;
  parts.push('fdr:' + (fdr ? fdr.rev : ''));
  parts.push('stereo:' + (typeof stereoRoutesCacheKey === 'function' ? stereoRoutesCacheKey() : '')); // Block 9F's options (docs/adr/0073)

  const siblings = typeof otherLiveStripsForFlightData === 'function' ? otherLiveStripsForFlightData(strip.fdrId, strip.stripId) : [];
  // Not just the count: the badge's title names each sibling's Facility,
  // Position and Role, and a sibling that moves desk changes it.
  parts.push('sib:' + siblings.map(s => `${s.stripId}/${s.facilityId || '?'}/${s.ownerPositionId}/${s.role}`).sort().join(','));

  const obligation = typeof getEfspObligation === 'function' ? getEfspObligation(strip.stripId) : null;
  parts.push('obl:' + (obligation ? `${obligation.obligationType}/${obligation.severity}` : ''));

  const relation = typeof marsaForStrip === 'function' ? marsaForStrip(strip) : null;
  parts.push('mrs:' + (relation
    ? `${relation.marsaId}/${relation.rev}/${relation.state}/${relation.rendezvousAt ? 1 : 0}/${relation.voidedBy || ''}`
    : ''));
  parts.push('mhl:' + (typeof isMarsaHighlighted === 'function' && isMarsaHighlighted(strip.stripId) ? 1 : 0));
  parts.push('car:' + (typeof carrierSignatureFor === 'function' ? carrierSignatureFor(strip) : '')); // crc-sync docs/adr/0074 — a Case change moves every carrier Strip's derived fields
  parts.push('tx:' + (typeof tofiExitSignatureFor === 'function' ? tofiExitSignatureFor(strip) : '')); // UI-A U8 — the mission line's state decides CTR's primary action
  parts.push('ar:' + (typeof arSignatureFor === 'function' ? arSignatureFor(strip) : '')); // docs/adr/0071 — the AR join lives on OTHER flights' Strips

  const correlation = typeof getEfspCorrelationForStrip === 'function' ? getEfspCorrelationForStrip(strip) : null;
  if (!correlation) {
    parts.push('cor:');
  } else {
    // Whether the bound contact is inside THIS controller's coverage is part
    // of what the badge says (`TRK ··`), and coverage is per-controller
    // (crc-sync's docs/adr/0042) — so the track has to be looked at, not just
    // the record. A Map lookup, and Strips are not re-rendered on radar
    // sweeps, so this costs nothing per sweep.
    const track = correlation.trackId && typeof window !== 'undefined' && typeof window.getLatestTrack === 'function'
      ? window.getLatestTrack(correlation.trackId) : null;
    parts.push('cor:' + [
      correlation.rev, correlation.state, correlation.trackId || '', correlation.matchedBy || '',
      correlation.binding ? 1 : 0,
      (correlation.warning && correlation.warning.kind) || '',
      ((correlation.warning && correlation.warning.candidateTrackIds) || []).join('+'),
      track ? trackRef(track) : '·',
    ].join('/'));
  }

  const entry = strip.airspaceEntry;
  const airspace = entry && typeof getEfspAirspace === 'function' ? getEfspAirspace(entry.airspaceId) : null;
  parts.push('asp:' + (airspace ? `${airspace.rev}/${airspace.state}` : ''));

  const refusal = _refusalForStrip(strip);
  parts.push('ref:' + (refusal ? `${refusal.at}/${refusal.blockId || ''}` : ''));

  // Whether it carries the just-arrived edge (docs/adr/0057). Only the fact,
  // never the flash: marking the flash played must not itself rebuild the
  // Strip, or the next render would replay it.
  parts.push('arr:' + (typeof efspArrivalFor === 'function' && efspArrivalFor(strip.stripId) ? 1 : 0));

  // Conformance and conflict alerts (docs/adr/0058). A conflict's countdown is
  // part of what the Strip says, so it rebuilds each second while one lasts —
  // only the Strips actually in a conflict.
  const conf = typeof conformanceAlertsForFlightData === 'function' ? conformanceAlertsForFlightData(strip.fdrId) : [];
  const trackId = typeof correlatedTrackIdForStrip === 'function' ? correlatedTrackIdForStrip(strip) : null;
  const stca = typeof conflictAlertsForTrack === 'function' ? conflictAlertsForTrack(trackId) : [];
  parts.push('alr:' + conf.map(a => `${a.kind}/${a.assigned}/${a.actual ?? ''}/${a.deviationFt ?? ''}/${a.fpm ?? ''}`).join(',')
    + ';' + stca.map(c => `${c.id}/${c.timeToCpaSec}/${c.minNm}/${c.vertFt}`).join(','));
  // Field state (docs/adr/0068): the RWY/HOOK chips read the Facility's runway record, not the Strip.
  parts.push('fld:' + (typeof runwayStatusSignatureFor === 'function' ? runwayStatusSignatureFor(strip) : ''));
  // Surveillance hints (docs/adr/0076) are stated by the server about this Strip, not part of its own
  // record; whether the chip can be accepted also depends on which Position the controller holds (S-L14).
  parts.push('sur:' + (typeof surveillanceHintsForStrip === 'function'
    ? surveillanceHintsForStrip(strip).map(h => `${h.kind}/${h.contactPhase}/${h.since}`).join(',') : '')
    + (typeof getActingPositions === 'function' && getActingPositions().includes(strip.ownerPositionId) ? '/m' : ''));

  return parts.join('|');
}

/**
 * Does this already-rendered Strip element differ from what it should be?
 *
 * Every input is an argument rather than read from module state, so the rule
 * can be tested directly — the reconciler that calls it needs a Rack, a Bay
 * and a populated store, and a rule buried inside it is a rule nothing checks.
 *
 * Four ways a Strip goes stale, and only the first is the Strip's own record:
 *  - `rev` moved — somebody changed the Strip.
 *  - selection changed — client-local, does not move `rev`.
 *  - expansion changed — client-local, does not move `rev` either. This one
 *    was missing, so the expand toggle set its state, asked for a re-render,
 *    and the reconciler reused every element unchanged. The button did
 *    nothing visible at all.
 *  - something the Strip RENDERS but does not own changed — the FDR, a
 *    sibling, an obligation, a MARSA relation, a correlation, the airspace,
 *    a refusal, or `strip.nla`. See _stripRenderSignature; this was the same
 *    omission as expansion, six more times over (F-305).
 */
export function _stripElNeedsRebuild(el, wanted, selectedStripId, expandedStripId) {
  const id = el.dataset.stripId;
  if (el.dataset.rev !== String(wanted.rev)) return true;
  if (el.classList.contains('efsp-strip-selected') !== (id === selectedStripId)) return true;
  if ((el.dataset.expanded === '1') !== (id === expandedStripId)) return true;
  if (el.dataset.sig !== _stripRenderSignature(wanted)) return true;
  return false;
}

function _reconcileRackStrips(rackEl, bayId, rackId) {
  const wanted = bayId.endsWith('-search') ? searchEfspStrips(getActiveEfspSearchQuery())
    : isWithOthersBayId(bayId) ? efspLinesWithOthers(bayId.slice(0, -'-with'.length))
      : (typeof carrierOrderRack === 'function' ? carrierOrderRack(bayId, getEfspRack(bayId, rackId)) : getEfspRack(bayId, rackId)); // the Marshal stack Bay is ordered by slot (docs/adr/0074)
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
export function _setSelectEfspStripByIdForTest(fn) { selectEfspStripById = fn; }
export function _setSelectedStripIdForTest(id) { _selectedStripId = id; }
export function _setRenderBayForTest(fn) { renderBay = fn; }
