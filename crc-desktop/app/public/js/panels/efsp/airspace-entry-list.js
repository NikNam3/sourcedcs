'use strict';
import { airspaceTrafficFor, airspaceTrafficSignature } from './alerts-state.js';
import { getEfspFlightData, getEfspStrip } from './efsp-state.js';
import { getActingPositions, sendEfspMutation } from './efsp-ws.js';
import { transitRowOffer } from './transit-rules.js';
import { sendTransitOp } from './transit-actions.js';
import { AIRSPACE_ENTRY_POSITIONS } from './bay/authority-mirror.js';
import { _isRejectedCoordinationReplica } from './bay/coordination-rules.js';
import { isUsing } from './airspace-capabilities.js';
import { markEfspChanged, onEfspChanged } from './efsp-change-bus.js';

// The airspace card's flight list (crc-sync docs/adr/0124 §1, H140 LT-AQ1 b): the aircraft inside the airspace or filed
// through it, each with Approve, so the using agency (OPS at Incirlik) can approve a flight it holds no Strip for. The
// server sends the list only to a session that may approve entry (the using agency, the controlling Position); any other
// session gets none and this block is absent (dark cockpit). Grey throughout; amber only while a flight is inside
// unapproved and alerting (the airspace-conflict alert's own condition, ADR 0119). Approve is the ordinary
// ApproveAirspaceEntry on one of the flight's live Strips, sent as the Position this controller may act as on it: the
// Strip's owner when this controller holds it, else the using agency (the server decides, with the same refusals).

/**
 * The Position and Strip to approve this flight's entry on, or null when this controller holds no Position that may.
 * @param {{strips: {facilityId:string, stripId:string, positionId:string}[]}} flight a row of the card list
 * @param {object} definition the airspace's definition
 * @returns {{strip:object, positionId:string}|null}
 */
export function approvePathFor(flight, definition) {
  for (const ref of (flight && flight.strips) || []) {
    const strip = getEfspStrip(ref.stripId);
    if (!strip || strip.state === 'DROPPED' || _isRejectedCoordinationReplica(strip)) continue;
    const held = getActingPositions(strip.facilityId || ref.facilityId);
    if (held.includes(strip.ownerPositionId) && AIRSPACE_ENTRY_POSITIONS.includes(strip.ownerPositionId)) {
      return { strip, positionId: strip.ownerPositionId };
    }
    const agency = held.find(p => isUsing(definition || {}, p));
    if (agency) return { strip, positionId: agency };
  }
  return null;
}

// crc-sync docs/adr/0128: a transit's grey state and the decider's Approve / Decline (with an optional reason, typed inline:
// the card is rebuilt on every list change, so the half-typed reason lives here), and the holder's Request / Cancel.
let _declineDraft = null; // { key, text }
const _declineKey = (airspaceId, flightDataId) => `${airspaceId}|${flightDataId}`;

function _transitButton(label, cls, title, run) {
  const btn = document.createElement('button');
  btn.className = `airspace-action-btn ${cls}`;
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener('click', run);
  return btn;
}

function _appendTransit(row, list, airspace, flight, deciders) {
  const offer = transitRowOffer(flight, airspace, getActingPositions(), deciders, getEfspFlightData(flight.flightDataId));
  const name = (airspace.definition && airspace.definition.name) || airspace.airspaceId;
  if (offer.text) {
    const state = document.createElement('span');
    state.className = 'airspace-entry-transit';
    state.textContent = offer.text;
    row.appendChild(state);
  }
  const send = (positionId, kind, extra) => sendTransitOp(positionId, airspace, kind, flight.flightDataId, extra);
  if (offer.approveAs) row.appendChild(_transitButton('Approve transit', 'airspace-transit-approve-btn', `Approve the transit of ${name} as ${offer.approveAs}`, () => send(offer.approveAs, 'ApproveTransit')));
  if (offer.declineAs) {
    const key = _declineKey(airspace.airspaceId, flight.flightDataId);
    row.appendChild(_transitButton('Decline transit', 'airspace-transit-decline-btn', `Decline the transit of ${name} as ${offer.declineAs}`, () => {
      _declineDraft = _declineDraft && _declineDraft.key === key ? null : { key, text: '' }; // the button toggles
      markEfspChanged('airspace');
    }));
    if (_declineDraft && _declineDraft.key === key) list.appendChild(_declineForm(airspace, flight, offer.declineAs, send));
  }
  if (offer.requestAs) row.appendChild(_transitButton('Request transit', 'airspace-transit-request-btn', `Ask ${(deciders || []).join(' or ') || 'the decider'} for a transit of ${name}, as ${offer.requestAs}`, () => send(offer.requestAs, 'RequestTransit')));
  if (offer.cancelAs) row.appendChild(_transitButton('Cancel request', 'airspace-transit-cancel-btn', `Withdraw the transit request, as ${offer.cancelAs}`, () => send(offer.cancelAs, 'CancelTransit')));
}

/** The inline reason form under a row: Enter or Send declines (an empty reason is allowed), Escape or Cancel abandons. */
function _declineForm(airspace, flight, positionId, send) {
  const form = document.createElement('div');
  form.className = 'airspace-entry-decline';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'airspace-input airspace-entry-decline-input';
  input.placeholder = 'Reason (optional)';
  input.value = _declineDraft.text;
  input.addEventListener('input', () => { if (_declineDraft) _declineDraft.text = input.value; });
  const go = () => { const reason = input.value.trim(); _declineDraft = null; send(positionId, 'DeclineTransit', reason ? { reason } : {}); markEfspChanged('airspace'); };
  const stop = () => { _declineDraft = null; markEfspChanged('airspace'); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') stop(); });
  const ok = document.createElement('button');
  ok.className = 'airspace-save-btn airspace-entry-decline-send';
  ok.textContent = 'Send decline';
  ok.addEventListener('click', go);
  const cancel = document.createElement('button');
  cancel.className = 'airspace-action-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', stop);
  form.append(input, ok, cancel);
  return form;
}

/** "inside", "filed" or "inside · filed": why the flight is on this card. */
export function entryRowWhy(flight) {
  return [flight.inside ? 'inside' : null, flight.filed ? 'filed' : null].filter(Boolean).join(' · ');
}

/**
 * The card's flight-list block, or null when the server sent this session no list for the airspace (it may not approve
 * entry there) or the list is empty.
 */
export function buildAirspaceEntryList(airspace) {
  const traffic = airspaceTrafficFor(airspace.airspaceId);
  if (!traffic || !traffic.flights || traffic.flights.length === 0) return null;
  const definition = airspace.definition || {};
  const list = document.createElement('div');
  list.className = 'airspace-entry-list';
  list.dataset.airspaceId = airspace.airspaceId;
  for (const flight of traffic.flights) {
    const row = document.createElement('div');
    row.className = `airspace-entry-row${flight.approved ? ' airspace-entry-approved' : ''}${flight.alerting && !flight.approved ? ' airspace-entry-alerting' : ''}`;
    row.dataset.flightDataId = flight.flightDataId;
    const callsign = document.createElement('span');
    callsign.className = 'airspace-entry-callsign';
    callsign.textContent = flight.callsign || flight.flightDataId;
    const why = document.createElement('span');
    why.className = 'airspace-entry-why';
    why.textContent = entryRowWhy(flight);
    row.append(callsign, why);
    if (flight.approved) {
      const done = document.createElement('span');
      done.className = 'airspace-entry-state';
      done.textContent = 'approved';
      row.appendChild(done);
    } else {
      const path = approvePathFor(flight, definition);
      if (path) {
        const btn = document.createElement('button');
        btn.className = 'airspace-action-btn airspace-entry-approve-btn';
        btn.textContent = 'Approve';
        btn.title = `Approve entry into ${definition.name || airspace.airspaceId} as ${path.positionId}`;
        btn.addEventListener('click', () => {
          // The Strip as it is now (F-107), not as it was when the card was built.
          const strip = getEfspStrip(path.strip.stripId) || path.strip;
          sendEfspMutation(path.positionId, strip, { kind: 'ApproveAirspaceEntry', airspaceId: airspace.airspaceId });
        });
        row.appendChild(btn);
      }
    }
    list.appendChild(row);
    _appendTransit(row, list, airspace, flight, traffic.transitDeciders);
  }
  return list;
}

// The cards redraw when the list changed, not on every efsp-alerts (conformance and CA move far more often).
let _lastSignature = '[]';
onEfspChanged(['alerts'], () => {
  const signature = airspaceTrafficSignature();
  if (signature === _lastSignature) return;
  _lastSignature = signature;
  markEfspChanged('airspace');
});
