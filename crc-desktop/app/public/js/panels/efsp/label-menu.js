'use strict';
import { getEfspFlightData, getEfspStrip, stripIdsForTrackId } from './efsp-state.js';
import { getActingPositions, sendEfspMutation } from './efsp-ws.js';
import { resolveBlockValue } from './strip-template.js';
import { getOpenEfspBayIds } from './bay/open-bays.js';
import { labelAssignOps, labelAssignmentFor } from './label-assign-rules.js';

// The track-label menu (H164 FT-Q4 a, docs/adr/0140): a click on a contact's data block, by the controller who owns
// its correlated Strip, opens HDG / SPEED / ALT here. Each input is the Strip's own cell: Enter sends the same
// SetBlock the cell sends, so conformance, the control-release attestation (H100 DR-1/DR-10), the Mutation log, the
// refusal banner and the refused-cell reopen (F-207) all behave as if it was typed on the Strip.
// Dark cockpit: grey, no colour of its own; a refusal shows where every refusal shows.
//
// Enter sends every changed cell, one Mutation after the other (each needs the Strip's rev the previous one left).
// A refusal stops the rest: what was refused is on the banner, and what was not sent is simply not sent.

let _open = null; // { el, stripId, trackId, onOutside, onKey }

/** The menu's state for a test: which Strip and contact it is open for, or null. */
export function labelMenuState() {
  return _open ? { stripId: _open.stripId, trackId: _open.trackId } : null;
}

/** What a click on this contact's block would offer (labelAssignmentFor over the live records), or null. */
export function labelAssignmentForTrack(trackId) {
  const strips = stripIdsForTrackId(trackId).map(getEfspStrip).filter(Boolean);
  const open = new Set(getOpenEfspBayIds());
  return labelAssignmentFor(strips, getActingPositions, { prefer: s => open.has(s.bayId) });
}

export function closeLabelMenu() {
  const open = _open;
  if (!open) return;
  _open = null;
  document.removeEventListener('mousedown', open.onOutside, true);
  open.el.remove();
}

/**
 * Opens the menu at the click for this contact. False when there is nothing to offer (no Strip, not the owner, no
 * cells): the caller keeps today's click (the track panel, H71 default 7).
 * @param {{onTrackInfo?:() => void}} [opts] the menu's TRACK item: today's click, still one input away
 */
export function openLabelMenu(trackId, clientX, clientY, { onTrackInfo } = {}) {
  closeLabelMenu();
  const offer = labelAssignmentForTrack(trackId);
  if (!offer) return false;
  const { strip, actingPositionId, cells } = offer;
  const flightData = getEfspFlightData(strip.flightDataId);

  const el = document.createElement('div');
  el.className = 'label-menu';
  el.dataset.stripId = strip.stripId;
  el.setAttribute('role', 'dialog');
  const callsign = (flightData && flightData.identity && flightData.identity.callsign) || '';
  const head = document.createElement('div');
  head.className = 'label-menu-head';
  head.textContent = `${callsign} ${actingPositionId}`.trim();
  el.append(head);

  const rows = cells.map(cell => {
    const { value } = resolveBlockValue(cell.blockId, flightData, strip);
    const before = value == null ? '' : String(value);
    const row = document.createElement('label');
    row.className = 'label-menu-row';
    const name = document.createElement('span');
    name.className = 'label-menu-name';
    name.textContent = cell.label;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'label-menu-input';
    input.dataset.field = cell.field;
    input.dataset.blockId = cell.blockId;
    input.value = before;
    input.autocomplete = 'off';
    input.spellcheck = false;
    row.append(name, input);
    el.append(row);
    return { blockId: cell.blockId, before, input };
  });

  const track = document.createElement('button');
  track.type = 'button';
  track.className = 'label-menu-track';
  track.textContent = 'TRACK';
  track.addEventListener('click', () => { closeLabelMenu(); if (onTrackInfo) onTrackInfo(); });
  el.append(track);

  const commit = () => {
    const ops = labelAssignOps(rows.map(r => ({ blockId: r.blockId, before: r.before, typed: r.input.value })));
    closeLabelMenu();
    _sendInTurn(strip.stripId, actingPositionId, ops);
  };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLabelMenu(); }
  });
  // A press anywhere else closes it, sending nothing (as Esc does): a menu is not a draft.
  const onOutside = (e) => { if (!el.contains(e.target)) closeLabelMenu(); };
  document.addEventListener('mousedown', onOutside, true);

  el.style.left = `${Math.round(clientX)}px`;
  el.style.top = `${Math.round(clientY)}px`;
  document.body.append(el);
  _clampIntoViewport(el);
  _open = { el, stripId: strip.stripId, trackId: String(trackId), onOutside };
  if (rows.length) { rows[0].input.focus(); rows[0].input.select(); }
  return true;
}

function _sendInTurn(stripId, actingPositionId, ops) {
  if (!ops.length) return;
  const strip = getEfspStrip(stripId);
  if (!strip) return;
  const [op, ...rest] = ops;
  sendEfspMutation(actingPositionId, strip, op, {
    onAck: (ack, result) => {
      const ok = result ? result.ok : ack.ok;
      if (ok) _sendInTurn(stripId, actingPositionId, rest);
      return false; // the default surfaces stay: the refusal banner, the attestation line
    },
  });
}

function _clampIntoViewport(el) {
  const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
  if (!r || typeof innerWidth !== 'number') return;
  const margin = 4;
  if (r.right > innerWidth - margin) el.style.left = `${Math.max(margin, innerWidth - margin - r.width)}px`;
  if (r.bottom > innerHeight - margin) el.style.top = `${Math.max(margin, innerHeight - margin - r.height)}px`;
}
