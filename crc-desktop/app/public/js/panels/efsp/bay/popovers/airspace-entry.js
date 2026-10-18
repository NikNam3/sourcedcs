'use strict';
import { getActingPositions, sendEfspMutation } from '../../efsp-ws.js';
import { getAllEfspAirspaces, getEfspStrip } from '../../efsp-state.js';
import { AIRSPACE_ENTRY_POSITIONS, CONVERT_TO_ARRIVAL_POSITIONS } from '../authority-mirror.js';
import { _isRejectedCoordinationReplica } from '../coordination-rules.js';
import { _resolveActingPositionId } from '../dispatch.js';
import { openPopover } from '../popover-portal.js';
import { isUsing } from '../../airspace-capabilities.js';
import { entryBlockTexts, parseEntryBlock } from '../../entry-block.js';


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

/**
 * crc-sync docs/adr/0119 (H136 VQ5 a): the airspaces whose using agency this controller holds at the Strip's Facility, while
 * not holding the Strip itself (the using agency approves entry on a Strip it does not work, 14 CFR 73.15 (c)(2)), each with
 * the Position that acts for it. Empty when the controller holds the owner: then the Strip's own path applies.
 * @returns {{airspace:object, positionId:string}[]}
 */
export function _usingAgencyEntryChoices(strip) {
  if (!strip || strip.state === 'DROPPED' || _isRejectedCoordinationReplica(strip)) return [];
  const held = getActingPositions(strip.facilityId || undefined);
  if (held.includes(strip.ownerPositionId)) return [];
  const out = [];
  for (const a of getAllEfspAirspaces()) {
    const positionId = held.find(p => isUsing(a.definition || {}, p));
    if (positionId) out.push({ airspace: a, positionId });
  }
  return out;
}

let _openPopoverHandle = null;

function _closeAirspacePopover() { if (_openPopoverHandle) _openPopoverHandle.close(); }

/** @param {{airspace:object, positionId:string}[]} [agencyChoices] the using agency's airspaces (`_usingAgencyEntryChoices`): only those, sent as that Position */
export function _openAirspaceEntryPopover(strip, anchorEl, agencyChoices) {
  _closeAirspacePopover();
  // A jurisdiction area (crc-sync ADR 0125) is whose airspace it is, never a block a flight is cleared into.
  const airspaces = (agencyChoices ? agencyChoices.map(c => c.airspace) : getAllEfspAirspaces()).filter(a => !a.definition || a.definition.kind !== 'JURISDICTION');

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
  const block = _blockInputs(null);
  popover.appendChild(block.el);

  const sendBtn = document.createElement('button');
  sendBtn.className = 'efsp-coordinate-send-btn';
  sendBtn.textContent = 'Approve entry';
  sendBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const choice = agencyChoices ? agencyChoices.find(c => c.airspace.airspaceId === select.value) : null;
    const actingPositionId = choice ? choice.positionId : _resolveActingPositionId(strip);
    const airspace = airspaces.find(a => a.airspaceId === select.value);
    const parsed = block.read(airspace && airspace.definition);
    if (!parsed.ok) return;
    if (actingPositionId) {
      // F-107 — the Strip as it is NOW, not as it was when the popover opened.
      // See _dispatchCoordination.
      const op = { kind: 'ApproveAirspaceEntry', airspaceId: select.value };
      if (parsed.block) op.altitudeBlock = parsed.block;
      sendEfspMutation(actingPositionId, getEfspStrip(strip.stripId) || strip, op);
    }
    _closeAirspacePopover();
  });
  popover.appendChild(sendBtn);

  _openPopoverHandle = openPopover({ el: popover, anchor: anchorEl, strip, onClose: () => { _openPopoverHandle = null; } });
}

/**
 * The two block fields (crc-sync docs/adr/0128 §3): lower and upper altitude, both empty for the whole airspace. `read`
 * parses them against an airspace's limits and shows the reason in place when they do not make a block.
 * @param {{lowerFt:number, upperFt:number}|null} current
 */
function _blockInputs(current) {
  const el = document.createElement('div');
  el.className = 'efsp-entry-block';
  const texts = entryBlockTexts(current);
  const field = (cls, placeholder, value) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = `efsp-entry-block-input ${cls}`;
    input.placeholder = placeholder;
    input.value = value;
    input.addEventListener('click', (e) => e.stopPropagation());
    return input;
  };
  const lower = field('efsp-entry-block-lower', 'block from', texts.lower);
  const upper = field('efsp-entry-block-upper', 'to', texts.upper);
  const why = document.createElement('div');
  why.className = 'efsp-entry-block-why';
  el.append(lower, upper, why);
  return {
    el,
    read: (definition) => {
      const parsed = parseEntryBlock(lower.value, upper.value, definition || {});
      why.textContent = parsed.ok ? '' : parsed.detail;
      return parsed;
    },
  };
}

/**
 * Amend (or lift) the altitude block of a flight already working an airspace: ApproveAirspaceEntry re-issued on the same
 * airspace and frequency, as `positionId` (the Strip's owner, or the using agency acting beside it).
 */
export function _openEntryBlockPopover(strip, anchorEl, positionId) {
  _closeAirspacePopover();
  const entry = strip.airspaceEntry;
  if (!entry) return;
  const airspace = getAllEfspAirspaces().find(a => a.airspaceId === entry.airspaceId);
  const popover = document.createElement('div');
  popover.className = 'efsp-coordinate-popover efsp-entry-block-popover';
  const title = document.createElement('div');
  title.className = 'efsp-entry-block-title';
  title.textContent = `Block in ${(airspace && airspace.definition && airspace.definition.name) || entry.airspaceId}`;
  const block = _blockInputs(entry.altitudeBlock || null);
  const sendBtn = document.createElement('button');
  sendBtn.className = 'efsp-coordinate-send-btn';
  sendBtn.textContent = 'Set block';
  sendBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const parsed = block.read(airspace && airspace.definition);
    if (!parsed.ok) return;
    const live = getEfspStrip(strip.stripId) || strip;
    const now = live.airspaceEntry || entry;
    sendEfspMutation(positionId, live, { kind: 'ApproveAirspaceEntry', airspaceId: now.airspaceId, frequencyMhz: now.frequencyMhz ?? null, altitudeBlock: parsed.block });
    _closeAirspacePopover();
  });
  popover.append(title, block.el, sendBtn);
  _openPopoverHandle = openPopover({ el: popover, anchor: anchorEl, strip, onClose: () => { _openPopoverHandle = null; } });
}
