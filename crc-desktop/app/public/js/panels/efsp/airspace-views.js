'use strict';
import { missionNow } from '../../mission-clock.js';
import { getAllEfspAirspaces, getEfspAirspaceEdits } from './efsp-state.js';
import { getActingPositions, sendEfspAirspaceMutation } from './efsp-ws.js';
import { _showMutationWarning } from './panel/refusal.js';
import * as caps from './airspace-capabilities.js';
import { openAirspaceEditor } from './airspace-editor.js';
import { openHistoryView, openDeleteView } from './airspace-detail-views.js';
import { markEfspChanged } from './efsp-change-bus.js';
import { NEW_KEY, _setMenuFor, _views } from './airspace-view-state.js';
import { _flightsOf, _transitionAlt, _zulu } from './airspace-rules.js';

// The airspace dispatch and the inline views (editor, History, Delete) of a card (DESK-SPLIT, split out of airspace-panel.js).

export function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function _dispatchAirspace(airspace, action, extra) {
  const op = { kind: action.kind };
  if (action.kind === 'ScheduleAirspace') {
    // A default two-hour block from now. The window is a booking, and a
    // controller scheduling one in the moment is the common case; a real
    // date picker is worth having once anyone books ahead. "Now" is mission
    // time (docs/adr/0079): the window is gated and shown against it.
    const now = missionNow();
    op.fromUtc = now;
    op.toUtc = now + 2 * 60 * 60 * 1000;
  }
  if (action.kind === 'DenyActivation') {
    const reason = window.prompt(`Deny activation of ${airspace.definition.name} — reason?`);
    if (reason === null) return;
    op.reason = reason || null;
  }
  if (action.kind === 'DelayActivation') op.note = (extra && extra.note) || null;
  sendEfspAirspaceMutation(action.positionId, airspace.airspaceId, airspace.rev, op);
}

// ── views: open, close, route acks ─────────────────────────────────────────────────────────────

export function _closeView(key) {
  const v = _views.get(key);
  if (v) { v.destroy(); _views.delete(key); }
}

function _setView(key, view) {
  _closeView(key);
  _views.set(key, view);
  _setMenuFor(null);
}

function _othersOf(airspaceId) {
  return getAllEfspAirspaces().filter(a => a.airspaceId !== airspaceId).map(a => a.definition);
}

// An ack for a form this window has open is answered in that form (the one ack path, efsp-ws.js): the form hands its
// handleAck as `onAck`, and it is only called while that form is still open, otherwise the ack falls to the banner.
const _sendDefinitionOp = (positionId, airspaceId, baseRev, op, extra, { onAck } = {}) => sendEfspAirspaceMutation(
  positionId, airspaceId, baseRev, op, extra,
  { onAck: onAck && ((ack) => [..._views.values()].some(v => v.handleAck === onAck) && onAck(ack)) });

export function _openEditor(airspace) {
  const signedOn = getActingPositions();
  const authority = caps.authorityFor(signedOn, 'edit', airspace.definition);
  if (!authority) return;
  const key = airspace.airspaceId;
  _setView(key, openAirspaceEditor({
    record: airspace, authority, signedOn, others: _othersOf(key), flights: _flightsOf(airspace), transitionAltFt: _transitionAlt(),
    send: _sendDefinitionOp, zulu: _zulu, now: missionNow, onClose: (r) => _viewClosed(key, r),
  }));
  markEfspChanged('airspace');
}

export function _openCreate() {
  const signedOn = getActingPositions();
  if (!caps.createPositionsFor(signedOn).length) return;
  _setView(NEW_KEY, openAirspaceEditor({
    record: null, authority: null, signedOn, others: _othersOf(null), flights: [], transitionAltFt: _transitionAlt(),
    send: _sendDefinitionOp, zulu: _zulu, now: missionNow, onClose: (r) => _viewClosed(NEW_KEY, r),
  }));
  markEfspChanged('airspace');
}

export function _openHistory(airspace) {
  const key = airspace.airspaceId;
  _setView(key, openHistoryView({ record: airspace, edits: getEfspAirspaceEdits(key), zulu: _zulu, transitionAltFt: _transitionAlt(), onClose: (r) => _viewClosed(key, r) }));
  markEfspChanged('airspace');
}

export function _openDelete(airspace) {
  const signedOn = getActingPositions();
  const authority = caps.authorityFor(signedOn, 'delete', airspace.definition);
  if (!authority) return;
  const key = airspace.airspaceId;
  _setView(key, openDeleteView({ record: airspace, flights: _flightsOf(airspace), authority, zulu: _zulu, send: _sendDefinitionOp, onClose: (r) => _viewClosed(key, r) }));
  markEfspChanged('airspace');
}

function _viewClosed(key, result) {
  const v = _views.get(key);
  if (v) _views.delete(key); // the view already removed its own element
  _noteSaved(result);
  markEfspChanged('airspace');
}

function _noteSaved(result) {
  if (!result || !result.saved || !result.ack) return;
  const ack = result.ack;
  if (ack.warning === 'AIRSPACE_EDITED_OCCUPIED' && Array.isArray(ack.occupied)) {
    const n = ack.occupied.length;
    const stale = Array.isArray(ack.staleEntries) && ack.staleEntries.length
      ? ` ${ack.staleEntries.map(e => `${e.callsign || e.stripId} (on ${Number(e.frequencyMhz).toFixed(3)})`).join(', ')} keep${ack.staleEntries.length === 1 ? 's' : ''} the old frequency: re-approve from the Strip.`
      : '';
    _showMutationWarning(`Saved with ${n} flight${n === 1 ? '' : 's'} working it: ${ack.occupied.map(o => o.callsign || o.stripId).join(', ')}.${stale}`);
  }
  if (ack.effectiveAtRestart) _showMutationWarning('Saved. The using Position takes effect after the next crc-sync restart.');
}

// ── the card ────────────────────────────────────────────────────────────────────────────────────
