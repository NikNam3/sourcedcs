'use strict';
import { COORDINATION_ELIGIBLE_STATES } from '../../efsp-nla.js';
import { getEfspFlightData, getEfspStrip, isAitAuthorizedFor } from '../../efsp-state.js';
import { sendEfspMutation } from '../../efsp-ws.js';
import { CARRIER_HANDOFF_TARGET, COORDINATION_TARGETS, canHandOffToCarrier } from '../authority-mirror.js';
import { _resolveActingPositionId, _swallowRepeatAdvance } from '../dispatch.js';
import { openPopover, _sendFromPopover } from '../popover-portal.js';
import { _coordinationIsReplica } from '../coordination-rules.js';


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
export function _dispatchCoordination(strip, primitive, action, note, targetOverride, { onAck } = {}) {
  strip = getEfspStrip(strip.stripId) || strip;
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return false;
  // Answering a proposal resolves the replica — ACCEPT relocates it out of the
  // Coordination Bay, REJECT takes its answer buttons away — so both reflow
  // the Rack and both are in F-101's class (lane 3 measured a double-tap on
  // Accept Hand Off accepting a second replica). PROPOSE and STAND_BY are not:
  // neither moves the Strip and neither removes a control from it.
  if ((action === 'ACCEPT' || action === 'REJECT') && _swallowRepeatAdvance()) return false;
  if (action === 'PROPOSE') {
    const target = targetOverride || COORDINATION_TARGETS[strip.ownerPositionId];
    if (!target) return false;
    sendEfspMutation(actingPositionId, strip, { kind: primitive, action: 'PROPOSE', toFacilityId: target.facilityId, toPositionId: target.positionId, note: note || undefined }, { onAck });
  } else {
    sendEfspMutation(actingPositionId, strip, { kind: primitive, action }, { onAck });
  }
  return true;
}

export const COORDINATION_PRIMITIVE_LABELS = {
  HANDOFF: 'Hand Off', POINT_OUT: 'Point Out', TRAFFIC: 'Traffic',
  OPERATIONAL_REQUEST: 'Operational Request', AIT: 'AIT',
};

// ── F-302/F-304 display helpers ─────────────────────────────────────────

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

let _openPopoverHandle = null;

function _closeCoordinatePopover() { if (_openPopoverHandle) _openPopoverHandle.close(); }

/** Opens the primitive-choice popover — mirrors _openHighlightPopover's exact pattern (anchor, outside-click close, deferred listener). */
export function _openCoordinatePopover(strip, anchorEl) {
  _closeCoordinatePopover();
  const flightData = getEfspFlightData(strip.flightDataId);
  const degraded = !!(flightData && flightData.identity && flightData.identity.trackDegradationFlag && flightData.identity.trackDegradationFlag !== 'NONE');

  const popover = document.createElement('div');
  popover.className = 'efsp-coordinate-popover';

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
  select.dataset.testid = 'coordination-primitive';
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

  // docs/adr/0101 (DR-3): an ARRIVAL in its coordination-eligible state may be handed to the carrier's Marshal instead of the counterpart.
  // Only a HANDOFF goes there, so the choice shows with HANDOFF and falls back to the counterpart otherwise.
  let toSelect = null;
  if (canHandOffToCarrier(strip)) {
    const counterpart = COORDINATION_TARGETS[strip.ownerPositionId];
    toSelect = document.createElement('select');
    toSelect.className = 'efsp-coordinate-target-select';
    toSelect.setAttribute('aria-label', 'hand off to');
    for (const t of [counterpart, CARRIER_HANDOFF_TARGET]) {
      const opt = document.createElement('option');
      opt.value = t.positionId;
      opt.textContent = `to ${t.positionId}`;
      toSelect.appendChild(opt);
    }
    const sync = () => { toSelect.hidden = select.value !== 'HANDOFF'; };
    select.addEventListener('change', sync);
    sync();
    popover.appendChild(toSelect);
  }

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
    const toCarrier = toSelect && select.value === 'HANDOFF' && toSelect.value === CARRIER_HANDOFF_TARGET.positionId;
    _sendFromPopover(popover, sendBtn, (onAck) => _dispatchCoordination(strip, select.value, 'PROPOSE', note.value.trim(), toCarrier ? CARRIER_HANDOFF_TARGET : undefined, { onAck }));
  });
  popover.appendChild(sendBtn);

  _openPopoverHandle = openPopover({ el: popover, anchor: anchorEl, strip, onClose: () => { _openPopoverHandle = null; } });
}
