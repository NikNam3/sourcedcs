'use strict';
import { airspaceTrafficFor, airspaceTrafficSignature } from './alerts-state.js';
import { getEfspStrip } from './efsp-state.js';
import { getActingPositions, sendEfspMutation } from './efsp-ws.js';
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
