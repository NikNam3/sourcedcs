'use strict';
import { getEfspFlightData, stripsInAirspace } from './efsp-state.js';
import { nextBooking, formatBooking, bookingUrl } from './airspace-calendar.js';
import { markEfspChanged } from './efsp-change-bus.js';
import { _delayFor, _draftInputs, _drafts, _menuFor, _setDelayFor, _setMenuFor, _views } from './airspace-view-state.js';
import { _altText, _flightsOf, _formatFrequency, _formatWindow, airspaceActionsFor, deleteReason, editReason, routeFlightCount } from './airspace-rules.js';
import { _dispatchAirspace, _el, _openDelete, _openEditor, _openHistory } from './airspace-views.js';

// One airspace card: its facts, actions, menu, Delay form and inline view (DESK-SPLIT, split out of airspace-panel.js).

function _buildMenu(airspace, signedOn) {
  const menu = _el('div', 'airspace-menu');
  const flights = _flightsOf(airspace);
  const busy = _views.has(airspace.airspaceId) ? 'Finish or cancel the open form first' : null;
  const item = (label, action, reason, run) => {
    const row = _el('div', 'airspace-menu-row');
    const btn = _el('button', 'airspace-menu-btn', label);
    btn.dataset.action = action;
    const why = busy || reason;
    if (why) { btn.disabled = true; btn.classList.add('airspace-disabled'); row.appendChild(btn); row.appendChild(_el('span', 'airspace-menu-why', why)); }
    else { btn.addEventListener('click', run); row.appendChild(btn); }
    menu.appendChild(row);
  };
  item('Edit…', 'edit', editReason(airspace, signedOn), () => _openEditor(airspace));
  item('History', 'history', null, () => _openHistory(airspace));
  item('Delete…', 'delete', deleteReason(airspace, signedOn, flights), () => _openDelete(airspace));
  return menu;
}

function _buildCalendarChip(airspace) {
  const booking = nextBooking(airspace.airspaceId, airspace.theater, Date.now());
  const url = bookingUrl();
  if (!booking && !url) return null;
  const chip = _el('div', 'airspace-booking');
  chip.appendChild(_el('span', 'airspace-booking-label', booking ? 'NEXT BOOKING ' : 'NO BOOKING '));
  if (booking) chip.appendChild(_el('span', 'airspace-booking-text', formatBooking(booking, _altText)));
  chip.appendChild(document.createTextNode(' '));
  if (url) {
    const a = document.createElement('a');
    a.className = 'airspace-booking-link'; a.textContent = 'Book…'; a.href = url; a.target = '_blank'; a.rel = 'noopener';
    chip.appendChild(a);
  }
  return chip;
}

export function _buildAirspaceCard(airspace, signedOnPositionIds) {
  const definition = airspace.definition || {};
  const card = document.createElement('div');
  card.className = `airspace-card airspace-state-${airspace.state.toLowerCase()}`;
  card.dataset.airspaceId = airspace.airspaceId;

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
  const more = _el('button', 'airspace-more-btn', '⋯');
  more.title = 'Edit, history, delete';
  more.setAttribute('aria-haspopup', 'menu');
  more.addEventListener('click', () => { _setMenuFor(_menuFor === airspace.airspaceId ? null : airspace.airspaceId); markEfspChanged('airspace'); });
  header.appendChild(more);
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

  const limits = [definition.airspaceId];
  if (definition.altLowerFt != null || definition.altUpperFt != null) limits.push(`${_altText(definition.altLowerFt) || 'GND'}–${_altText(definition.altUpperFt) || 'UNL'}`);
  const detail = _el('div', 'airspace-meta airspace-ids', limits.join(' · '));
  card.appendChild(detail);
  if (definition.usingFacilityId) card.appendChild(_el('div', 'airspace-meta airspace-using', `Using: ${definition.usingFacilityId}`));

  if (airspace.pendingRequest) {
    const pending = document.createElement('div');
    pending.className = 'airspace-pending';
    const delay = airspace.pendingRequest.delay;
    pending.textContent = `activation requested by ${airspace.pendingRequest.requestedPositionId}`
      + (delay ? ` · delayed${delay.note ? `: ${delay.note}` : ''}` : '');
    card.appendChild(pending);
  }

  if (definition.kind === 'ROUTE') {
    // A route's occupancy is a count: nobody is "in" it the way a flight is in an area, so no list and never a warning.
    const n = routeFlightCount(airspace.airspaceId);
    card.appendChild(_el('div', 'airspace-meta airspace-route-count', `${n} flight${n === 1 ? '' : 's'} filed on this route`));
  } else {
    // The flights in this block. A range controller needs to know who is in
    // their airspace, but works no Strips — guide §4.1 — so this is a list,
    // never a rack, and carries no action of any kind.
    const flights = stripsInAirspace(airspace.airspaceId);
    if (flights.length > 0) {
      const list = document.createElement('div');
      list.className = 'airspace-flights';
      list.textContent = flights.map((s) => {
        const flightData = getEfspFlightData(s.flightDataId);
        const callsign = (flightData && flightData.identity && flightData.identity.callsign) || s.cid;
        const entry = s.airspaceEntry || {};
        const entryBits = [];
        if (entry.frequencyMhz) entryBits.push(entry.frequencyMhz.toFixed(3));
        // The altitude block this flight is held to inside the airspace — the
        // ordinary way two aircraft share one block, so it belongs on the
        // board rather than only on the Strip.
        if (entry.altitudeBlock) entryBits.push(`${entry.altitudeBlock.lowerFt}–${entry.altitudeBlock.upperFt} ft`);
        return entryBits.length ? `${callsign} (${entryBits.join(', ')})` : callsign;
      }).join(', ');
      card.appendChild(list);
    }
  }

  const chip = _buildCalendarChip(airspace);
  if (chip) card.appendChild(chip);

  const actions = airspaceActionsFor(airspace, signedOnPositionIds);
  if (actions.length > 0) {
    const row = document.createElement('div');
    row.className = 'airspace-actions';
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.className = 'airspace-action-btn';
      btn.textContent = action.label;
      btn.title = `as ${action.positionId}`;
      btn.addEventListener('click', () => {
        if (action.kind === 'DelayActivation') { _setDelayFor(airspace.airspaceId); markEfspChanged('airspace'); return; }
        _dispatchAirspace(airspace, action);
      });
      row.appendChild(btn);
    }
    card.appendChild(row);
  }
  if (_delayFor === airspace.airspaceId) {
    const form = _el('div', 'airspace-delay');
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'airspace-input'; input.placeholder = 'Delay note (for example: after 1500Z)';
    _keepDraft(`delay:${airspace.airspaceId}`, input);
    const send = _el('button', 'airspace-save-btn', 'Send delay');
    const cancel = _el('button', 'airspace-action-btn', 'Cancel');
    const act = actions.find(a => a.kind === 'DelayActivation');
    send.addEventListener('click', () => { _setDelayFor(null); _drafts.delete(`delay:${airspace.airspaceId}`); if (act) _dispatchAirspace(airspace, act, { note: input.value.trim() }); markEfspChanged('airspace'); });
    cancel.addEventListener('click', () => { _setDelayFor(null); _drafts.delete(`delay:${airspace.airspaceId}`); markEfspChanged('airspace'); });
    form.append(input, send, cancel);
    card.appendChild(form);
  }

  if (_menuFor === airspace.airspaceId) card.appendChild(_buildMenu(airspace, signedOnPositionIds));
  const view = _views.get(airspace.airspaceId);
  if (view) card.appendChild(view.el);
  return card;
}

/** Makes `input` a draft field: it starts with the text typed so far under `key` and records every keystroke. */
function _keepDraft(key, input) {
  input.dataset.draftKey = key;
  if (_drafts.has(key)) input.value = _drafts.get(key);
  input.addEventListener('input', () => { _drafts.set(key, input.value); });
  _draftInputs.set(key, input);
}
