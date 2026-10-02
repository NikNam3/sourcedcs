'use strict';
import { TOFI_ELIGIBLE_STATES } from '../../efsp-nla.js';
import { getActingPositions, sendEfspMutation } from '../../efsp-ws.js';
import { getEfspFlightData, getEfspStrip } from '../../efsp-state.js';
import { TOFI_ANSWERED_BY, TOFI_COUNTERPARTS } from '../authority-mirror.js';
import { _isRejectedCoordinationReplica } from './coordination.js';
import { _resolveActingPositionId, _swallowRepeatAdvance } from '../../bay-view.js';
import { _mountPopover, _unmountPopover } from '../popover-portal.js';


// D12 audit note: TAC_C2/AIC/GCI/JTAC must NEVER appear as keys in
// COORDINATION_TARGETS above — that's what structurally prevents a
// HANDOFF/POINT_OUT/TRAFFIC/OPERATIONAL_REQUEST/AIT button from ever
// rendering for them, regardless of Position combination (see
// efsp-coordination-client.test.mjs's permanent regression guard). TOFI's
// OWN button (below) is the only coordination-shaped affordance any of
// those 4 Positions ever get, and it only ever dispatches kind:'TOFI' —
// structurally incapable of offering one of the 5 forbidden primitives.

/** ENTRY may be proposed from a fresh Strip, or retried after a REJECTED one — always from the ATC-side Strip, never the MISSION-side replica. */
export function _canProposeTofiEntry(strip) {
  if (!TOFI_COUNTERPARTS[strip.ownerPositionId]) return false;
  if (strip.stripType === 'MISSION') return false;
  if (_isRejectedCoordinationReplica(strip)) return false;
  // Not while a coordination is still open — a handoff replica CTR has not
  // accepted is a flight APP still works (board/tofi.js's `_applyTofiPropose`).
  if (strip.coordination && strip.coordination.state === 'INITIATED') return false;
  // The (role, state) gate the 5 primitives have had since docs/adr/0022 and
  // TOFI never did — a flight has to actually be airborne and enroute before
  // it can enter tactically controlled airspace. Client mirror of
  // crc-sync's TOFI_ELIGIBLE_STATES (coordination.js, authority/index.js), kept in lockstep by
  // efsp-coordination-client.test.mjs.
  if (TOFI_ELIGIBLE_STATES[strip.stripType] !== strip.state) return false;
  if (!strip.tofiCoordination) return true;
  return strip.tofiCoordination.state === 'REJECTED';
}

/** EXIT is only ever proposed from the ATC-side Strip, and only while tactical control is genuinely ACTIVE. */
export function _canProposeTofiExit(strip) {
  if (strip.stripType === 'MISSION') return false;
  if (_isRejectedCoordinationReplica(strip)) return false;
  return !!(strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE');
}

/** Accept/Reject always render on the MISSION-side Strip — the receiving MRU controller's own record — for BOTH ENTRY and EXIT (mirrors crc-sync's own side-split in board/tofi.js exactly). */
export function _isPendingTofiReplica(strip) {
  return strip.stripType === 'MISSION' && !!strip.tofiCoordination && strip.tofiCoordination.state === 'INITIATED';
}

/** Transfer Comms is invocable on EITHER side of an accepted exchange that hasn't transferred comms yet. */
export function _canTransferTofiComms(strip) {
  return !!(strip.tofiCoordination && strip.tofiCoordination.acceptedAt && !strip.tofiCoordination.commsTransferred);
}

// The regimes offered when accepting tactical control (docs/adr/0053).
// Mirrors flight-data-store.js's SEPARATION_REGIMES; the server validates, this is
// the picker so nobody types one of five exact strings by hand. MARSA is
// first because it is the common military case — but it is a default nobody
// can accept without seeing, which is the point.
export const TOFI_ACCEPT_REGIMES = ['MARSA', 'ATC', 'USING_AGENCY', 'DUE_REGARD', 'SEE_AND_AVOID'];

// stripId -> the regime picked in that Strip's accept select, so a rebuild
// shows what the controller chose rather than the default. Cleared when the
// exchange is answered.
export const _tofiRegimeChoice = new Map();

/** The Position a TOFI answer is sent as: the owner's TOFI answerer when this controller holds it, else the usual resolution. */
function _tofiActingPositionId(strip) {
  const answerer = strip.stripType === 'MISSION' ? TOFI_ANSWERED_BY[strip.ownerPositionId] : null;
  if (answerer && getActingPositions().includes(answerer)) return answerer;
  return _resolveActingPositionId(strip);
}

export function _dispatchTofi(strip, action, direction, overrides = {}) {
  strip = getEfspStrip(strip.stripId) || strip; // F-107 — see _dispatchCoordination
  const actingPositionId = action === 'PROPOSE' ? _resolveActingPositionId(strip) : _tofiActingPositionId(strip);
  if (!actingPositionId) return;
  // Same class as the coordination responses above (F-101) — accepting or
  // rejecting a TOFI takes the answer buttons off the Strip and reflows the
  // Rack under the pointer. PROPOSE and TRANSFER_COMMS leave the Strip where
  // it is and take no control off it.
  if ((action === 'ACCEPT' || action === 'REJECT') && _swallowRepeatAdvance()) return;
  if (action === 'ACCEPT' || action === 'REJECT') _tofiRegimeChoice.delete(strip.stripId);
  if (action === 'PROPOSE') {
    const op = { kind: 'TOFI', action: 'PROPOSE', direction, note: overrides.note || undefined };
    if (direction === 'ENTRY') {
      const target = overrides.target;
      if (!target) return;
      op.toFacilityId = target.facilityId;
      op.toPositionId = target.positionId;
    }
    sendEfspMutation(actingPositionId, strip, op);
  } else {
    const op = { kind: 'TOFI', action };
    // docs/adr/0053 — accepting an ENTRY means saying under which regime the
    // MRU is taking the aircraft. The server refuses an accept without one,
    // deliberately: §4.6.3 rule 1 and defect D14 put the regime in the
    // governing agreement, so it is asked for rather than derived.
    if (overrides.separationRegime) op.separationRegime = overrides.separationRegime;
    sendEfspMutation(actingPositionId, strip, op);
  }
}

let _openTofiPopoverEl = null;

function _closeTofiPopover() {
  if (!_openTofiPopoverEl) return;
  _unmountPopover(_openTofiPopoverEl);
  _openTofiPopoverEl = null;
  document.removeEventListener('pointerdown', _onDocPointerDownCloseTofiPopover, true);
}

function _onDocPointerDownCloseTofiPopover(e) {
  if (_openTofiPopoverEl && !_openTofiPopoverEl.contains(e.target)) _closeTofiPopover();
}

/**
 * TOFI ENTRY's popover — structurally simpler than _openCoordinatePopover:
 * no primitive choice (TOFI is the only thing this button ever sends), a
 * target picker ONLY when more than one counterpart exists (CTR's case —
 * TAC_C2/GCI's single-candidate case skips this popover entirely, see the
 * click handler below). Reuses the same degraded-track warning/required-
 * note pattern as the Coordinate popover (guide §4.6 rule 5 applies to
 * TOFI too — crc-sync's board/tofi.js enforces this identically for both).
 */
export function _openTofiEntryPopover(strip, anchorEl, counterparts) {
  _closeTofiPopover();
  const flightData = getEfspFlightData(strip.flightDataId);
  const degraded = !!(flightData && flightData.identity && flightData.identity.trackDegradationFlag && flightData.identity.trackDegradationFlag !== 'NONE');

  const popover = document.createElement('div');
  popover.className = 'efsp-coordinate-popover efsp-tofi-popover';
  popover.addEventListener('pointerdown', (e) => e.stopPropagation());

  if (degraded) {
    const warn = document.createElement('div');
    warn.className = 'efsp-coordinate-degraded-warning';
    warn.textContent = `Track degraded (${flightData.identity.trackDegradationFlag}) — verbal coordination required, note mandatory`;
    popover.appendChild(warn);
  }

  const select = document.createElement('select');
  select.className = 'efsp-coordinate-primitive-select';
  for (const c of counterparts) {
    const opt = document.createElement('option');
    opt.value = JSON.stringify(c);
    opt.textContent = `${c.positionId} (${c.facilityId})`;
    select.appendChild(opt);
  }
  popover.appendChild(select);

  const note = document.createElement('textarea');
  note.className = 'efsp-coordinate-note';
  note.placeholder = degraded ? 'Verbal coordination note (required)' : 'Note (optional)';
  popover.appendChild(note);

  const sendBtn = document.createElement('button');
  sendBtn.className = 'efsp-coordinate-send-btn';
  sendBtn.textContent = 'Send TOFI';
  sendBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (degraded && !note.value.trim()) {
      note.classList.add('efsp-coordinate-note-required');
      return;
    }
    _dispatchTofi(strip, 'PROPOSE', 'ENTRY', { target: JSON.parse(select.value), note: note.value.trim() });
    _closeTofiPopover();
  });
  popover.appendChild(sendBtn);

  _openTofiPopoverEl = popover;
  _mountPopover(popover, anchorEl, strip, _closeTofiPopover);
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseTofiPopover, true), 0);
}

/** Which Position proposed a TOFI. The MISSION-side Strip is always the receiving MRU's record, for both directions — _isPendingTofiReplica's own split. */
export function _tofiProposerOf(strip, tofi) {
  return strip.stripType === 'MISSION' ? tofi.peerPositionId : strip.ownerPositionId;
}

/**
 * What is stopping a proposed TOFI EXIT from being accepted, worded for the
 * side that is reading it (lane 3's F-307).
 *
 * Guide §4.6.3 rule 3 — the server refuses ACCEPT until separation_regime is
 * back to ATC. Only the ATC-side controller can do that (SREG exists on their
 * Strip alone), and until now only the MRU side was told, in the `title` of a
 * disabled button they could do nothing about.
 */
export function _tofiExitPrecondition(strip, tofi) {
  if (!tofi || tofi.direction !== 'EXIT' || tofi.state !== 'INITIATED') return null;
  const flightData = typeof getEfspFlightData === 'function' ? getEfspFlightData(strip.flightDataId) : null;
  const regime = (flightData && flightData.tofi && flightData.tofi.separationRegime) || null;
  if (regime === 'ATC') return null;
  const shown = regime || 'unset';
  return strip.stripType === 'MISSION'
    ? `SEP REG is ${shown} — ${tofi.peerPositionId} must set it back to ATC before this exit can be accepted`
    : `SEP REG is ${shown} — set it back to ATC before ${tofi.peerPositionId} can accept this exit`;
}
