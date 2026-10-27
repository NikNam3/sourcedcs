'use strict';
import { conflictAlertsForTrack, conflictTag, getEfspFlightData, getEfspStrip, stripIdsForTrackId } from './efsp-state.js';
import { conflictSuppressTargets, suppressConflict } from './conflict-suppress.js';
import { getActingPositions, sendEfspMutation } from './efsp-ws.js';
import { resolveBlockValue } from './strip-template.js';
import { getOpenEfspBayIds } from './bay/open-bays.js';
import { labelAssignOps, labelAssignmentFor } from './label-assign-rules.js';
import {
  acceptVfrHandoff, assignCode, canAssignCode, canRecallVfrHandoff, canTagTrack, canTerminateRadarService, recallVfrHandoff,
  tagTrack, terminateRadarService, initiateVfrHandoff, vfrHandoffAcceptAs, vfrHandoffTargets,
} from './flight-following.js';

// The track-label menu (H164 FT-Q4 a, docs/adr/0140): a click on a contact's data block, by the controller who owns
// its correlated Strip, opens HDG / SPEED / ALT here. Each input is the Strip's own cell: Enter sends the same
// SetBlock the cell sends, so conformance, the control-release attestation (H100 DR-1/DR-10), the Mutation log, the
// refusal banner and the refused-cell reopen (F-207) all behave as if it was typed on the Strip.
// Dark cockpit: grey, no colour of its own; a refusal shows where every refusal shows.
//
// Enter sends every changed cell, one Mutation after the other (each needs the Strip's rev the previous one left).
// A refusal stops the rest: what was refused is on the banner, and what was not sent is simply not sent.
//
// crc-sync docs/adr/0146 (H174, H175): a contact with no strip offers TAG (callsign, type optional) to a controller at a
// Position with a VFR Bay; a VFR handoff offered to this controller offers ACCEPT; the holder of a VFR strip gets, beside
// HDG / SPEED / ALT (its clearance cells, so nothing here is VFR-specific), the handoff (one item per Position), RECALL,
// CODE when it has none and RADAR SERVICE TERMINATED. Grey like the rest.
//
// crc-sync's docs/adr/0145 (H173 VQ-A): a contact in a conflict alert this controller can suppress gets one SUPPRESS item
// per alert, for whoever clicks (owner or not): one click, the menu closes. A suppressed alert offers nothing here; the
// track panel's alert row restores it.

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

/** The conflict alerts on this contact the controller can suppress at one of their Positions (crc-sync's docs/adr/0145). */
export function labelSuppressibleConflicts(trackId) {
  return conflictAlertsForTrack(trackId).filter(c => conflictSuppressTargets(c).length > 0);
}

/**
 * Opens the menu at the click for this contact. False when there is nothing to offer (no Strip, not the owner, no
 * cells, and no conflict alert to suppress): the caller keeps today's click (the track panel, H71 default 7).
 * @param {{onTrackInfo?:() => void}} [opts] the menu's TRACK item: today's click, still one input away
 */
/** The VFR handoff on this contact this controller accepts (crc-sync docs/adr/0146), or null. */
export function labelVfrAcceptFor(trackId) {
  return stripIdsForTrackId(trackId).map(getEfspStrip).find(s => s && vfrHandoffAcceptAs(s)) || null;
}

export function openLabelMenu(trackId, clientX, clientY, { onTrackInfo } = {}) {
  closeLabelMenu();
  const offer = labelAssignmentForTrack(trackId);
  const conflicts = labelSuppressibleConflicts(trackId);
  const acceptStrip = labelVfrAcceptFor(trackId);
  const tag = !offer && !acceptStrip && canTagTrack(trackId);
  if (!offer && !conflicts.length && !acceptStrip && !tag) return false;
  const { strip = null, actingPositionId = null, cells = [] } = offer || {};
  const flightData = strip ? getEfspFlightData(strip.flightDataId) : null;

  const el = document.createElement('div');
  el.className = 'label-menu';
  if (strip) el.dataset.stripId = strip.stripId;
  el.setAttribute('role', 'dialog');
  if (strip) {
    const callsign = (flightData && flightData.identity && flightData.identity.callsign) || '';
    const head = document.createElement('div');
    head.className = 'label-menu-head';
    head.textContent = `${callsign} ${actingPositionId}`.trim();
    el.append(head);
  }

  for (const c of conflicts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'label-menu-suppress';
    btn.dataset.conflictId = c.id;
    btn.textContent = `SUPPRESS ${conflictTag(c)} ${c.otherCallsign}`;
    btn.title = `Stop this alert flashing at your Position, for this pair only`;
    btn.addEventListener('click', () => { closeLabelMenu(); suppressConflict(c); });
    el.append(btn);
  }

  const _action = (cls, text, title, run) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `label-menu-action ${cls}`;
    btn.textContent = text;
    btn.title = title;
    btn.addEventListener('click', () => { closeLabelMenu(); run(); });
    el.append(btn);
    return btn;
  };
  if (acceptStrip) {
    const fd = getEfspFlightData(acceptStrip.flightDataId);
    _action('label-menu-accept', `ACCEPT ${(fd && fd.identity && fd.identity.callsign) || ''}`.trim(),
      `${acceptStrip.ownerPositionId} hands this VFR to you`, () => acceptVfrHandoff(acceptStrip));
  }

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

  // The VFR strip's own actions, for its holder (crc-sync docs/adr/0146).
  if (strip && strip.stripType === 'VFR') {
    for (const to of vfrHandoffTargets(strip)) {
      _action('label-menu-handoff', `HO ${to}`, `hand off to ${to}: ${to} accepts, then change the pilot's frequency`, () => initiateVfrHandoff(strip, to));
    }
    if (canRecallVfrHandoff(strip)) _action('label-menu-recall', `RECALL ${strip.vfrHandoff.toPositionId}`, 'take the unanswered handoff back', () => recallVfrHandoff(strip));
    if (canAssignCode(strip, flightData)) _action('label-menu-code', 'CODE', 'a discrete beacon code for this flight', () => assignCode(strip));
    if (canTerminateRadarService(strip)) _action('label-menu-terminate', 'RADAR SVC TERM', 'drop the strip: code released, track untagged', () => terminateRadarService(strip));
  }

  // TAG: the contact has no strip (crc-sync docs/adr/0146). Enter sends; the type may stay empty.
  const tagInputs = [];
  if (tag) {
    for (const [field, label, max] of [['tag-callsign', 'ACID', 7], ['tag-type', 'TYPE', 12]]) {
      const row = document.createElement('label');
      row.className = 'label-menu-row';
      const name = document.createElement('span');
      name.className = 'label-menu-name';
      name.textContent = label;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'label-menu-input';
      input.dataset.field = field;
      input.maxLength = max;
      input.autocomplete = 'off';
      input.spellcheck = false;
      row.append(name, input);
      el.append(row);
      tagInputs.push(input);
    }
  }

  const track = document.createElement('button');
  track.type = 'button';
  track.className = 'label-menu-track';
  track.textContent = 'TRACK';
  track.addEventListener('click', () => { closeLabelMenu(); if (onTrackInfo) onTrackInfo(); });
  el.append(track);

  const commit = () => {
    if (tag) {
      const [cs, ty] = tagInputs.map(i => i.value);
      closeLabelMenu();
      if (String(cs || '').trim()) tagTrack(trackId, cs, ty, null, { banner: true });
      return;
    }
    if (!strip) { closeLabelMenu(); return; }
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
  _open = { el, stripId: strip ? strip.stripId : null, trackId: String(trackId), onOutside };
  if (rows.length) { rows[0].input.focus(); rows[0].input.select(); }
  else if (tagInputs.length) tagInputs[0].focus();
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
