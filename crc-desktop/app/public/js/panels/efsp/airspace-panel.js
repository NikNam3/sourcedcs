'use strict';
import { missionNow } from '../topbar.js';
import { getAllEfspAirspaces, getEfspFdr, stripsInAirspace } from './efsp-state.js';
import { getActingPositions, sendEfspAirspaceMutation } from './efsp-ws.js';
import { registerEfspMessage } from './efsp-message-registry.js';
import { applyEfspAirspaceDelta } from './efsp-state.js';
import { _showMutationError, _showMutationWarning } from './efsp-panel.js';

// The airspace board — guide §4.2: "Airspace board (not a strip rack)", and
// §4.1 rule 2: the `RANGE` Position "works no Strips. It owns airspace state
// — schedule, activation, release direction."
//
// Its own dock panel rather than a tab inside the Strip panel, because it is
// not a Bay of Strips and nothing about it belongs in that panel's
// Position/Bay tab chrome. A controller running a range alongside an ATC
// Position wants both open at once, which two panels give and one tab does
// not.
//
// Element references are cached once in initAirspacePanel(), never looked up
// per render — dockview detaches an inactive panel's root from the document,
// so document.getElementById stops finding it while detached. Same constraint
// efsp-panel.js's own module comment documents, and the same bug if ignored.

let _airspaceListEl = null;
let _airspaceEmptyEl = null;

/**
 * The actions this controller may take on an airspace right now, given the
 * Positions they hold and where the airspace is in its lifecycle.
 *
 * Mirrors airspace-store.js's authority split (§9.11): the using agency
 * schedules, asks and releases; the controlling agency approves and takes
 * back. An airspace with no using agency of its own — an ordinary MOA — has
 * no second party, so its controlling Position does both, which is the
 * common case rather than a special one.
 *
 * Proactive only. The server decides; this exists so a controller is not
 * offered a button that will be refused.
 */
export function airspaceActionsFor(airspace, signedOnPositionIds) {
  const signedOn = new Set(signedOnPositionIds || []);
  const definition = (airspace && airspace.definition) || {};
  const isControlling = signedOn.has(definition.controllingPositionId);
  const isUsing = definition.usingPositionId
    ? signedOn.has(definition.usingPositionId)
    : isControlling;

  const actions = [];
  const as = (positionId, kind, label) => actions.push({ positionId, kind, label });

  if (airspace.state === 'RETURNED' && (isUsing || isControlling)) {
    as(definition.usingPositionId && isUsing ? definition.usingPositionId : definition.controllingPositionId,
      'ScheduleAirspace', 'Schedule');
  }
  if (airspace.state === 'SCHEDULED') {
    if (isUsing && definition.usingPositionId && !airspace.pendingRequest) {
      as(definition.usingPositionId, 'RequestActivation', 'Request activation');
    }
    if (isControlling && (airspace.pendingRequest || !definition.usingPositionId)) {
      as(definition.controllingPositionId, 'ApproveActivation', 'Approve activation');
    }
    if (isControlling && airspace.pendingRequest) {
      as(definition.controllingPositionId, 'DenyActivation', 'Deny');
    }
    if (isControlling) as(definition.controllingPositionId, 'ReturnAirspace', 'Cancel');
  }
  if (airspace.state === 'ACTIVE' && isUsing) {
    as(definition.usingPositionId || definition.controllingPositionId, 'ReleaseAirspace', 'Release');
  }
  if (airspace.state === 'RELEASED' && isControlling) {
    as(definition.controllingPositionId, 'ReturnAirspace', 'Take back');
  }
  return actions;
}

function _formatWindow(window) {
  if (!window) return '';
  const time = (ms) => new Date(ms).toISOString().slice(11, 16) + 'Z';
  return `${time(window.fromUtc)}–${time(window.toUtc)}`;
}

function _formatFrequency(definition) {
  // A range with a control tower of its own hands the flight to that tower;
  // an ordinary MOA to its working frequency. Showing which is which matters
  // — they are different things to say on the radio.
  if (definition.controlFrequencyMhz) return `${definition.controlFrequencyMhz.toFixed(3)} control`;
  if (definition.workingFrequencyMhz) return `${definition.workingFrequencyMhz.toFixed(3)} working`;
  return '';
}

function _dispatchAirspace(airspace, action) {
  const op = { kind: action.kind };
  if (action.kind === 'ScheduleAirspace') {
    // A default two-hour block from now. The window is a booking, and a
    // controller scheduling one in the moment is the common case; a real
    // date picker is worth having once anyone books ahead. "Now" is mission
    // time (docs/adr/0079): the window is gated and shown against it.
    const now = typeof missionNow === 'function' ? missionNow() : Date.now();
    op.fromUtc = now;
    op.toUtc = now + 2 * 60 * 60 * 1000;
  }
  if (action.kind === 'DenyActivation') {
    const reason = window.prompt(`Deny activation of ${airspace.definition.name} — reason?`);
    if (reason === null) return;
    op.reason = reason || null;
  }
  sendEfspAirspaceMutation(action.positionId, airspace.airspaceId, airspace.rev, op);
}

function _buildAirspaceCard(airspace, signedOnPositionIds) {
  const definition = airspace.definition || {};
  const card = document.createElement('div');
  card.className = `airspace-card airspace-state-${airspace.state.toLowerCase()}`;

  const header = document.createElement('div');
  header.className = 'airspace-card-header';

  const name = document.createElement('span');
  name.className = 'airspace-name';
  name.textContent = definition.name || airspace.airspaceId;
  header.appendChild(name);

  const state = document.createElement('span');
  state.className = 'airspace-state';
  // The guide's own four names (§4.6.4) — never "hot"/"cold", which it says
  // are display sugar with no doctrinal meaning.
  state.textContent = airspace.state;
  header.appendChild(state);
  card.appendChild(header);

  const meta = document.createElement('div');
  meta.className = 'airspace-meta';
  const bits = [definition.type, definition.controllingPositionId];
  if (definition.usingPositionId) bits.push(`used by ${definition.usingPositionId}`);
  const frequency = _formatFrequency(definition);
  if (frequency) bits.push(frequency);
  if (airspace.window) bits.push(_formatWindow(airspace.window));
  meta.textContent = bits.filter(Boolean).join(' · ');
  card.appendChild(meta);

  if (airspace.pendingRequest) {
    const pending = document.createElement('div');
    pending.className = 'airspace-pending';
    pending.textContent = `activation requested by ${airspace.pendingRequest.requestedPositionId}`;
    card.appendChild(pending);
  }

  // The flights in this block. A range controller needs to know who is in
  // their airspace, but works no Strips — guide §4.1 — so this is a list,
  // never a rack, and carries no action of any kind.
  const flights = stripsInAirspace(airspace.airspaceId);
  if (flights.length > 0) {
    const list = document.createElement('div');
    list.className = 'airspace-flights';
    list.textContent = flights.map((s) => {
      const flightData = getEfspFdr(s.flightDataId);
      const callsign = (flightData && flightData.identity && flightData.identity.callsign) || s.cid;
      const entry = s.airspaceEntry || {};
      const bits = [];
      if (entry.frequencyMhz) bits.push(entry.frequencyMhz.toFixed(3));
      // The altitude block this flight is held to inside the airspace — the
      // ordinary way two aircraft share one block, so it belongs on the
      // board rather than only on the Strip.
      if (entry.altitudeBlock) bits.push(`${entry.altitudeBlock.lowerFt}–${entry.altitudeBlock.upperFt} ft`);
      return bits.length ? `${callsign} (${bits.join(', ')})` : callsign;
    }).join(', ');
    card.appendChild(list);
  }

  const actions = airspaceActionsFor(airspace, signedOnPositionIds);
  if (actions.length > 0) {
    const row = document.createElement('div');
    row.className = 'airspace-actions';
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.className = 'airspace-action-btn';
      btn.textContent = action.label;
      btn.title = `as ${action.positionId}`;
      btn.addEventListener('click', () => _dispatchAirspace(airspace, action));
      row.appendChild(btn);
    }
    card.appendChild(row);
  }

  return card;
}

export function renderAirspacePanel() {
  if (!_airspaceListEl) return; // not initialized yet
  const airspaces = getAllEfspAirspaces();
  const signedOn = getActingPositions();

  _airspaceListEl.innerHTML = '';
  for (const airspace of airspaces) {
    _airspaceListEl.appendChild(_buildAirspaceCard(airspace, signedOn));
  }

  if (_airspaceEmptyEl) {
    // Shipping with no airspaces configured is the expected state until the
    // squadron's real MOAs and ranges are filled in — say so plainly rather
    // than rendering a blank panel that looks broken.
    _airspaceEmptyEl.hidden = airspaces.length > 0;
  }
}

export function initAirspacePanel() {
  _airspaceListEl = document.getElementById('airspace-list');
  _airspaceEmptyEl = document.getElementById('airspace-empty');
  renderAirspacePanel();
  return { onShow: () => renderAirspacePanel() };
}

// The airspace family's wire handlers (CMSG; moved out of app.js's ws.onmessage).
// The RANGE slice — an airspace is not a Strip and rides no Board's
// seq, so it gets its own delta rather than a section of
// efsp-board-delta.
registerEfspMessage('efsp-airspace-delta', (msg) => {
  if (typeof applyEfspAirspaceDelta === 'function') applyEfspAirspaceDelta(msg);
  if (typeof renderAirspacePanel === 'function') renderAirspacePanel();
});

registerEfspMessage('efsp-airspace-ack', (msg) => {
  if (!msg.ok) {
    console.warn('[efsp] airspace op rejected:', msg.reason, msg);
    // An airspace op targets no Strip, so it is named by the block it
    // was about rather than by a callsign (F-103's attribution rule,
    // applied to the thing that actually was refused).
    if (typeof _showMutationError === 'function') {
      _showMutationError(msg.reason || 'Rejected', msg.detail,
        msg.airspace ? { subject: (msg.airspace.definition && msg.airspace.definition.name) || msg.airspace.airspaceId } : null);
    }
  } else if (msg.warning === 'AIRSPACE_STILL_OCCUPIED') {
    // Released with flights still in it. Allowed — the controller may
    // know they are clear — but they are on the block's frequency and
    // the panel now treats them as being in airspace nobody holds.
    if (typeof _showMutationWarning === 'function') {
      _showMutationWarning(`Released with ${msg.occupied} flight${msg.occupied === 1 ? '' : 's'} still in the block`);
    }
  }
  if (typeof renderAirspacePanel === 'function') renderAirspacePanel();
});
