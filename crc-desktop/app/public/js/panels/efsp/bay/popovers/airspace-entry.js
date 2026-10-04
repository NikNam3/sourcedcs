'use strict';
import { getActingPositions, sendEfspMutation } from '../../efsp-ws.js';
import { getAllEfspAirspaces, getEfspStrip } from '../../efsp-state.js';
import { AIRSPACE_ENTRY_POSITIONS, CONVERT_TO_ARRIVAL_POSITIONS } from '../authority-mirror.js';
import { _isRejectedCoordinationReplica } from '../coordination-rules.js';
import { _resolveActingPositionId } from '../dispatch.js';
import { openPopover } from '../popover-portal.js';


// Only the Positions that hold an airborne flight approve one into an
// airspace — the client mirror of crc-sync's AIRSPACE_ENTRY_OP_KINDS (authority/op-kinds.js)
// grant. A range Position never appears here: it works no Strips at all.
// The Strip awaiting a second press on Convert to Arrival. Module-level
// rather than per-render, since a re-render rebuilds the button.
export let _pendingConvertStripId = null;
// ESM-1: strip-view.js assigns it; an imported binding is read-only.
export function _setPendingConvertStripId(v) { _pendingConvertStripId = v; }

/** Whether this client should offer Convert to Arrival at all (the button may still render disabled for an open link). */
export function _canConvertToArrival(strip) {
  if (strip.stripType !== 'DEPARTURE' || strip.state !== 'HANDED_OFF') return false;
  if (!CONVERT_TO_ARRIVAL_POSITIONS.includes(strip.ownerPositionId)) return false;
  if (!getActingPositions().includes(strip.ownerPositionId)) return false;
  return !_isRejectedCoordinationReplica(strip);
}

// The field lists (COMPACT_BLOCKS_*, compactBlocksFor) live in strip-fields.js,
// loaded before this file. They are per-Position now, not only per-strip-type.

export function _canApproveAirspaceEntry(strip) {
  if (!AIRSPACE_ENTRY_POSITIONS.includes(strip.ownerPositionId)) return false;
  if (_isRejectedCoordinationReplica(strip)) return false;
  return !!_resolveActingPositionId(strip);
}

let _openPopoverHandle = null;

function _closeAirspacePopover() { if (_openPopoverHandle) _openPopoverHandle.close(); }

export function _openAirspaceEntryPopover(strip, anchorEl) {
  _closeAirspacePopover();
  const airspaces = getAllEfspAirspaces();

  const popover = document.createElement('div');
  popover.className = 'efsp-coordinate-popover';

  if (airspaces.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'efsp-coordinate-degraded-warning';
    empty.textContent = 'No airspaces configured';
    popover.appendChild(empty);
    _openPopoverHandle = openPopover({ el: popover, anchor: anchorEl, strip, onClose: () => { _openPopoverHandle = null; } });
    return;
  }

  const select = document.createElement('select');
  select.className = 'efsp-coordinate-primitive-select';
  select.dataset.testid = 'airspace-entry-airspace';
  for (const a of airspaces) {
    const definition = a.definition || {};
    const frequency = definition.controlFrequencyMhz || definition.workingFrequencyMhz;
    const opt = document.createElement('option');
    opt.value = a.airspaceId;
    // The state is in the label because entry into an unactivated airspace
    // is allowed but alerts (§9.11) — worth seeing before clicking, not
    // only afterwards.
    opt.textContent = `${definition.name || a.airspaceId} — ${a.state}${frequency ? ` · ${frequency.toFixed(3)}` : ''}`;
    select.appendChild(opt);
  }
  popover.appendChild(select);

  const sendBtn = document.createElement('button');
  sendBtn.className = 'efsp-coordinate-send-btn';
  sendBtn.textContent = 'Approve entry';
  sendBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const actingPositionId = _resolveActingPositionId(strip);
    if (actingPositionId) {
      // F-107 — the Strip as it is NOW, not as it was when the popover opened.
      // See _dispatchCoordination.
      sendEfspMutation(actingPositionId, getEfspStrip(strip.stripId) || strip, { kind: 'ApproveAirspaceEntry', airspaceId: select.value });
    }
    _closeAirspacePopover();
  });
  popover.appendChild(sendBtn);

  _openPopoverHandle = openPopover({ el: popover, anchor: anchorEl, strip, onClose: () => { _openPopoverHandle = null; } });
}
