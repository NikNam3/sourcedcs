'use strict';
import { COORDINATION_ELIGIBLE_STATES } from '../../efsp-nla.js';
import { getEfspFlightData, getEfspStrip, isAitAuthorizedFor } from '../../efsp-state.js';
import { sendEfspMutation } from '../../efsp-ws.js';
import { COORDINATION_TARGETS } from '../authority-mirror.js';
import { _resolveActingPositionId, _swallowRepeatAdvance } from '../../bay-view.js';
import { _mountPopover, _unmountPopover } from '../popover-portal.js';


/**
 * A cross-Facility coordination replica lands in the receiving Position's
 * Coordination Bay (bayId ends '-coordination') with coordination.state
 * PROPOSED — that combination is what actually distinguishes "this Strip
 * IS the pending proposal awaiting my response" from the SENDER's own
 * Strip, which also carries coordination.state:'INITIATED' but stays in
 * its normal working Bay. Accepting/rejecting your own just-sent proposal
 * makes no sense, so this check is load-bearing, not decorative.
 */
export function _isPendingCoordinationReplica(strip) {
  return !!(strip.coordination && strip.coordination.state === 'INITIATED' && strip.bayId.endsWith('-coordination'));
}

// COORDINATION_ELIGIBLE_STATES (docs/adr/0022) lives in efsp-nla.js, imported
// here — the established pattern for small rule tables
// that need a server/client drift test (see that module's own comment).
// Was previously hardcoded to ARRIVAL-only here, which is what made the
// Coordinate button unreachable for any DEPARTURE Strip — this fix closes
// both the missing AP->CTR handoff AND the other 4 primitives' same
// ARRIVAL-only gate.

/**
 * A Strip may open a NEW coordination proposal only while it has no
 * already-open one (server-enforced too — crc-sync's
 * `_applyCoordinationPropose`, board/coordination.js). REJECTED can be retried — but ONLY from the
 * SENDER's own Strip, which stays in its normal working Bay the whole time
 * (guide's real flight record). A Strip sitting in a Coordination Bay is
 * always the RECEIVER-side replica/proposal artifact — jurisdiction never
 * actually transferred there even once accepted (accept relocates it OUT
 * of the Coordination Bay, board/coordination.js's `_applyCoordinationAccept`), so
 * one still sitting there (PROPOSED awaiting response, or REJECTED and
 * left inert) is never a legitimate flight record to propose FROM. Bug
 * found in live testing: without this, a rejected receiver-side replica
 * offered Coordinate again — letting a controller "hand off" CTR's own
 * dead copy of a flight back to the very Position that sent it in the
 * first place, an entirely spurious third replica.
 */
export function _canProposeCoordination(strip) {
  if (!COORDINATION_TARGETS[strip.ownerPositionId]) return false;
  if (COORDINATION_ELIGIBLE_STATES[strip.stripType] !== strip.state) return false;
  if (strip.bayId.endsWith('-coordination')) return false;
  if (!strip.coordination) return true;
  return strip.coordination.state === 'REJECTED'; // ACTIVE/PROPOSED are open links; REJECTED can be retried
}

/**
 * F-107 applies to this function and to _dispatchTofi/_dispatchGesture below,
 * and to the airspace popover's "Approve entry".
 *
 * The `strip` these four are handed is the object captured when the popover
 * OPENED, and its `rev` is what sendEfspMutation sends as the optimistic-
 * concurrency base. _isProtectedStripEl deliberately stops the Strip being
 * rebuilt while a popover is open — so that captured object is *guaranteed*
 * stale the moment anyone else touches the same Strip, and pressing Send
 * returned a bare STALE_REV with the typed note gone. Exactly the case the
 * popover protection exists for, ending in a refusal.
 *
 * Re-reading the Strip at dispatch time is what the Block editor already does
 * (`getEfspStrip(strip.stripId) || strip`). Deliberately NOT applied to
 * _dispatchMarsa/_dispatchCorrelation: those two send their own relation's or
 * correlation record's current rev, not the Strip's.
 */
export function _dispatchCoordination(strip, primitive, action, note) {
  strip = getEfspStrip(strip.stripId) || strip;
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  // Answering a proposal resolves the replica — ACCEPT relocates it out of the
  // Coordination Bay, REJECT takes its answer buttons away — so both reflow
  // the Rack and both are in F-101's class (lane 3 measured a double-tap on
  // Accept Hand Off accepting a second replica). PROPOSE and STAND_BY are not:
  // neither moves the Strip and neither removes a control from it.
  if ((action === 'ACCEPT' || action === 'REJECT') && _swallowRepeatAdvance()) return;
  if (action === 'PROPOSE') {
    const target = COORDINATION_TARGETS[strip.ownerPositionId];
    if (!target) return;
    sendEfspMutation(actingPositionId, strip, { kind: primitive, action: 'PROPOSE', toFacilityId: target.facilityId, toPositionId: target.positionId, note: note || undefined });
  } else {
    sendEfspMutation(actingPositionId, strip, { kind: primitive, action });
  }
}

export const COORDINATION_PRIMITIVE_LABELS = {
  HANDOFF: 'Hand Off', POINT_OUT: 'Point Out', TRAFFIC: 'Traffic',
  OPERATIONAL_REQUEST: 'Operational Request', AIT: 'AIT',
};

// ── F-302/F-304 display helpers ─────────────────────────────────────────

/**
 * Is this Strip the RECEIVER's replica of the exchange, rather than the
 * sender's own flight record?
 *
 * `mintedForCoordination` is the server's authoritative answer and is
 * stamped by board/coordination.js's `receiveCoordinationProposal`. The Bay
 * check is the same fallback the server keeps (`isRejectedReplica`, board/strip-ops.js) for a replica minted before the field
 * existed and restored from a persisted Board.
 */
export function _coordinationIsReplica(strip) {
  const co = strip.coordination;
  if (!co) return false;
  if (co.mintedForCoordination) return true;
  return strip.bayId.endsWith('-coordination');
}

/**
 * F-303: the receiver's copy of a coordination it rejected. It is inert — the
 * sender still works the flight — so it offers nothing but Drop and moving it
 * aside. board/strip-ops.js's `rejectedReplicaOpRefusal` refuses the rest; this
 * keeps the controls that would only be refused off the Strip in the first
 * place. MARSA and correlation are flight-level on the server, so for those
 * two this is the only guard there is.
 */
export function _isRejectedCoordinationReplica(strip) {
  return !!strip.coordination && strip.coordination.state === 'REJECTED' && _coordinationIsReplica(strip);
}

/** Which Position asked. The replica's `peerPositionId` IS the proposer; on the sender's own Strip the proposer is its owner. */
export function _coordinationProposerOf(strip, co) {
  return _coordinationIsReplica(strip) ? co.peerPositionId : strip.ownerPositionId;
}

/**
 * The state in the words the primitive is actually answered in.
 *
 * OPERATIONAL_REQUEST alone is approved/unable rather than accepted/rejected
 * (coordination.js's acceptPhrase, and the Approve/Unable buttons this file
 * already renders) — a status chip that said REJECTED next to a button that
 * said Unable would be two names for one outcome.
 */
export function _coordinationStateWord(co) {
  if (co.primitive !== 'OPERATIONAL_REQUEST') return co.state;
  if (co.state === 'ACTIVE') return 'APPROVED';
  if (co.state === 'REJECTED') return 'UNABLE';
  return co.state;
}

/** A coordination note, attributed. Rendered rather than hidden in a `title`: with a degraded track it is the mandatory record of the verbal coordination. */
export function _buildCoordinationNoteEl(note, proposer) {
  const el = document.createElement('span');
  el.className = 'efsp-coordination-note';
  el.textContent = `${proposer}: “${note}”`;
  el.title = `note from ${proposer}`;
  return el;
}

/** A blocking precondition, on the Strip rather than only on a hover `title` — a tooltip has no touch equivalent (F-307). */
export function _buildCoordinationReasonEl(text) {
  const el = document.createElement('span');
  el.className = 'efsp-coordination-blocked-reason';
  el.textContent = text;
  el.title = text;
  return el;
}

let _openCoordinatePopoverEl = null;

function _closeCoordinatePopover() {
  if (!_openCoordinatePopoverEl) return;
  _unmountPopover(_openCoordinatePopoverEl);
  _openCoordinatePopoverEl = null;
  document.removeEventListener('pointerdown', _onDocPointerDownCloseCoordinatePopover, true);
}

function _onDocPointerDownCloseCoordinatePopover(e) {
  if (_openCoordinatePopoverEl && !_openCoordinatePopoverEl.contains(e.target)) _closeCoordinatePopover();
}

/** Opens the primitive-choice popover — mirrors _openHighlightPopover's exact pattern (anchor, outside-click close, deferred listener). */
export function _openCoordinatePopover(strip, anchorEl) {
  _closeCoordinatePopover();
  const flightData = getEfspFlightData(strip.flightDataId);
  const degraded = !!(flightData && flightData.identity && flightData.identity.trackDegradationFlag && flightData.identity.trackDegradationFlag !== 'NONE');

  const popover = document.createElement('div');
  popover.className = 'efsp-coordinate-popover';
  popover.addEventListener('pointerdown', (e) => e.stopPropagation());

  if (degraded) {
    const warn = document.createElement('div');
    warn.className = 'efsp-coordinate-degraded-warning';
    warn.textContent = `Track degraded (${flightData.identity.trackDegradationFlag}) — verbal coordination required, note mandatory`;
    popover.appendChild(warn);
  }

  // AIT is configuration, not a default (guide §4.6 rule 7, docs/adr/0022)
  // — disabled here rather than letting a PROPOSE submit-and-silently-fail
  // against the authoritative server-side check in board/coordination.js.
  const aitAuthorized = isAitAuthorizedFor(strip.facilityId);

  const select = document.createElement('select');
  select.className = 'efsp-coordinate-primitive-select';
  for (const primitive of ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT']) {
    const opt = document.createElement('option');
    opt.value = primitive;
    opt.textContent = COORDINATION_PRIMITIVE_LABELS[primitive];
    if (primitive === 'AIT' && !aitAuthorized) {
      opt.disabled = true;
      opt.textContent += ' (no written directive)';
    }
    select.appendChild(opt);
  }
  popover.appendChild(select);

  const note = document.createElement('textarea');
  note.className = 'efsp-coordinate-note';
  note.placeholder = degraded ? 'Verbal coordination note (required)' : 'Note (optional)';
  popover.appendChild(note);

  const sendBtn = document.createElement('button');
  sendBtn.className = 'efsp-coordinate-send-btn';
  sendBtn.textContent = 'Send';
  sendBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (degraded && !note.value.trim()) {
      note.classList.add('efsp-coordinate-note-required');
      return;
    }
    _dispatchCoordination(strip, select.value, 'PROPOSE', note.value.trim());
    _closeCoordinatePopover();
  });
  popover.appendChild(sendBtn);

  _openCoordinatePopoverEl = popover;
  _mountPopover(popover, anchorEl, strip, _closeCoordinatePopover);
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseCoordinatePopover, true), 0);
}
