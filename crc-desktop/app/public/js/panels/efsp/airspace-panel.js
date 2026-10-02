'use strict';
import { missionNow } from '../topbar.js';
import { settings } from '../../app.js';
import { getAllEfspAirspaces, getEfspFlightData, getAllEfspStrips, getEfspAirspaceEdits, stripsInAirspace } from './efsp-state.js';
import { getActingPositions, sendEfspAirspaceMutation } from './efsp-ws.js';
import { registerEfspMessage } from './efsp-message-registry.js';
import { applyEfspAirspaceDelta } from './efsp-state.js';
import { _showMutationError, _showMutationWarning } from './efsp-panel.js';
import { formatZuluHhmm } from './strip-template.js';
import * as caps from './airspace-capabilities.js';
import { altitudeText, openAirspaceEditor } from './airspace-editor.js';
import { openHistoryView, openDeleteView, deleteBlockers } from './airspace-detail-views.js';
import { applyAirspaceCalendar, nextBooking, formatBooking, bookingUrl } from './airspace-calendar.js';

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
let _toolbarEl = null;

// Inline views (the editor, History, Delete) by airspace id; a new airspace's editor lives under NEW_KEY. One view per card.
const NEW_KEY = '\u0000new';
const _views = new Map();
let _menuFor = null;      // the airspace whose ⋯ menu is open
let _delayFor = null;     // the airspace whose Delay note form is open
const FILTER_KEY = 'crc.airspace.filter';
let _filter = _loadFilter(); // 'mine' | 'all'

function _loadFilter() {
  try { return localStorage.getItem(FILTER_KEY) === 'all' ? 'all' : 'mine'; } catch (_) { return 'mine'; }
}
function _saveFilter(value) {
  _filter = value;
  try { localStorage.setItem(FILTER_KEY, value); } catch (_) { /* a per-viewer convenience only */ }
}

/**
 * The actions this controller may take on an airspace right now, given the
 * Positions they are signed on to and where the airspace is in its lifecycle.
 *
 * Mirrors airspace-store.js's authority split (§9.11): the using agency
 * schedules, asks and releases; the controlling agency approves and takes
 * back. An airspace with no using agency of its own — an ordinary MOA — has
 * no second party, so its controlling Position does both, which is the
 * common case rather than a special one. A using Facility (ADR 0098 §3, DA-7) acts through
 * the Positions with the `use` capability (TAC_C2), never through the controlling Position.
 * A ROUTE is confirmed or delayed, never denied (S-R3-80): Approve reads Confirm, there is no Deny,
 * and a request is not required before the controlling Position confirms.
 *
 * Proactive only. The server decides; this exists so a controller is not
 * offered a button that will be refused.
 */
export function airspaceActionsFor(airspace, signedOnPositionIds) {
  const signedOn = signedOnPositionIds || [];
  const definition = (airspace && airspace.definition) || {};
  const isRoute = definition.kind === 'ROUTE';
  const hasUsingAgency = !!(definition.usingPositionId || definition.usingFacilityId);
  const controlling = caps.controllingPositionFor(signedOn, definition);
  const using = caps.usingPositionFor(signedOn, definition);

  const actions = [];
  const as = (positionId, kind, label) => actions.push({ positionId, kind, label });

  if (airspace.state === 'RETURNED' && (using || controlling)) {
    as(using || controlling, 'ScheduleAirspace', 'Schedule');
  }
  if (airspace.state === 'SCHEDULED') {
    if (using && hasUsingAgency && !airspace.pendingRequest) as(using, 'RequestActivation', 'Request activation');
    if (controlling && (isRoute || airspace.pendingRequest || !hasUsingAgency)) {
      as(controlling, 'ApproveActivation', isRoute ? 'Confirm' : 'Approve activation');
    }
    if (controlling && airspace.pendingRequest) {
      if (isRoute) as(controlling, 'DelayActivation', 'Delay');
      else as(controlling, 'DenyActivation', 'Deny');
    }
    if (controlling) as(controlling, 'ReturnAirspace', 'Cancel');
  }
  if (airspace.state === 'ACTIVE' && using) as(using, 'ReleaseAirspace', 'Release');
  if (airspace.state === 'RELEASED' && controlling) as(controlling, 'ReturnAirspace', 'Take back');
  return actions;
}

// ── what a controller may do to the DEFINITION (the ⋯ menu) ────────────────────────────────────

/** Why Edit is unavailable (ADR 0056: disabled with the reason), or null when it is offered. */
export function editReason(airspace, signedOnPositionIds) {
  const def = airspace.definition;
  if (!signedOnPositionIds.length) return 'Sign on to a Position to edit';
  return caps.authorityFor(signedOnPositionIds, 'edit', def) ? null : `Owned by ${def.controllingPositionId}`;
}
/** Why Delete is unavailable, or null. Authority first; then the first thing blocking it. */
export function deleteReason(airspace, signedOnPositionIds, flights) {
  const def = airspace.definition;
  if (!signedOnPositionIds.length) return 'Sign on to a Position to delete';
  if (!caps.authorityFor(signedOnPositionIds, 'delete', def)) return `Owned by ${def.controllingPositionId}`;
  const blockers = deleteBlockers(airspace, flights);
  return blockers.length ? blockers[0].blocking : null;
}

/** Which airspaces "Mine" shows: the ones a signed-on Position controls or acts for. With nothing signed on, everything. */
export function visibleAirspaces(airspaces, signedOnPositionIds, filter) {
  if (filter === 'all' || !signedOnPositionIds.length) return airspaces;
  return airspaces.filter(a => caps.controllingPositionFor(signedOnPositionIds, a.definition)
    || (a.definition.usingPositionId || a.definition.usingFacilityId ? caps.usingPositionFor(signedOnPositionIds, a.definition) : null));
}

/** Group by controlling Facility: shipped Facilities in their table order, then any other; airspaces by name inside. */
export function groupByFacility(airspaces) {
  const order = caps.facilityIds();
  const groups = new Map();
  for (const a of airspaces) {
    const f = a.definition.controllingFacilityId || '?';
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(a);
  }
  return [...groups.entries()]
    .sort(([x], [y]) => (order.indexOf(x) < 0 ? 99 : order.indexOf(x)) - (order.indexOf(y) < 0 ? 99 : order.indexOf(y)) || x.localeCompare(y))
    .map(([facilityId, list]) => ({ facilityId, airspaces: list.sort((p, q) => String(p.definition.name).localeCompare(String(q.definition.name))) }));
}

function _zulu(ms) {
  const t = formatZuluHhmm(ms);
  return t ? `${t}Z` : '--';
}

function _formatWindow(window) {
  if (!window) return '';
  return `${_zulu(window.fromUtc)}–${_zulu(window.toUtc)}`;
}

function _transitionAlt() { return (settings && settings.transitionAltFt) || 18000; }
function _altText(ft) { return altitudeText(ft, _transitionAlt()); }

function _formatFrequency(definition) {
  // A range with a control tower of its own hands the flight to that tower;
  // an ordinary MOA to its working frequency. Showing which is which matters
  // — they are different things to say on the radio.
  if (definition.controlFrequencyMhz) return `${definition.controlFrequencyMhz.toFixed(3)} control`;
  if (definition.workingFrequencyMhz) return `${definition.workingFrequencyMhz.toFixed(3)} working`;
  return '';
}

/** The flights working an AREA: [{stripId, callsign, frequencyMhz}] for the editor's impact note and Delete's blockers. */
function _flightsOf(airspace) {
  if (airspace.definition.kind === 'ROUTE') return [];
  return stripsInAirspace(airspace.airspaceId).map((s) => {
    const fd = getEfspFlightData(s.flightDataId);
    return { stripId: s.stripId, callsign: (fd && fd.identity && fd.identity.callsign) || s.cid || s.stripId, frequencyMhz: (s.airspaceEntry && s.airspaceEntry.frequencyMhz) ?? null };
  });
}

/** A ROUTE's occupancy: the distinct flights with a live Strip whose MTR designator (trimmed, upper case) is the route's id. A count, never a warning (S-R3-80). */
export function routeFlightCount(airspaceId) {
  const flights = new Set();
  for (const s of getAllEfspStrips()) {
    if (s.state === 'DROPPED') continue;
    const fd = getEfspFlightData(s.flightDataId);
    const d = fd && fd.military && fd.military.mtr && fd.military.mtr.designator;
    if (typeof d === 'string' && d.trim().toUpperCase() === airspaceId) flights.add(s.flightDataId);
  }
  return flights.size;
}

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function _dispatchAirspace(airspace, action, extra) {
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

function _closeView(key) {
  const v = _views.get(key);
  if (v) { v.destroy(); _views.delete(key); }
}
function _setView(key, view) {
  _closeView(key);
  _views.set(key, view);
  _menuFor = null;
}
function _othersOf(airspaceId) {
  return getAllEfspAirspaces().filter(a => a.airspaceId !== airspaceId).map(a => a.definition);
}
const _sendDefinitionOp = (...args) => sendEfspAirspaceMutation(...args);

function _openEditor(airspace) {
  const signedOn = getActingPositions();
  const authority = caps.authorityFor(signedOn, 'edit', airspace.definition);
  if (!authority) return;
  const key = airspace.airspaceId;
  _setView(key, openAirspaceEditor({
    record: airspace, authority, signedOn, others: _othersOf(key), flights: _flightsOf(airspace), transitionAltFt: _transitionAlt(),
    send: _sendDefinitionOp, zulu: _zulu, now: missionNow, onClose: (r) => _viewClosed(key, r),
  }));
  renderAirspacePanel();
}
function _openCreate() {
  const signedOn = getActingPositions();
  if (!caps.createPositionsFor(signedOn).length) return;
  _setView(NEW_KEY, openAirspaceEditor({
    record: null, authority: null, signedOn, others: _othersOf(null), flights: [], transitionAltFt: _transitionAlt(),
    send: _sendDefinitionOp, zulu: _zulu, now: missionNow, onClose: (r) => _viewClosed(NEW_KEY, r),
  }));
  renderAirspacePanel();
}
function _openHistory(airspace) {
  const key = airspace.airspaceId;
  _setView(key, openHistoryView({ record: airspace, edits: getEfspAirspaceEdits(key), zulu: _zulu, transitionAltFt: _transitionAlt(), onClose: (r) => _viewClosed(key, r) }));
  renderAirspacePanel();
}
function _openDelete(airspace) {
  const signedOn = getActingPositions();
  const authority = caps.authorityFor(signedOn, 'delete', airspace.definition);
  if (!authority) return;
  const key = airspace.airspaceId;
  _setView(key, openDeleteView({ record: airspace, flights: _flightsOf(airspace), authority, zulu: _zulu, send: _sendDefinitionOp, onClose: (r) => _viewClosed(key, r) }));
  renderAirspacePanel();
}
function _viewClosed(key, result) {
  const v = _views.get(key);
  if (v) _views.delete(key); // the view already removed its own element
  _noteSaved(result);
  renderAirspacePanel();
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

function _buildAirspaceCard(airspace, signedOnPositionIds) {
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
  more.addEventListener('click', () => { _menuFor = _menuFor === airspace.airspaceId ? null : airspace.airspaceId; renderAirspacePanel(); });
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
        if (action.kind === 'DelayActivation') { _delayFor = airspace.airspaceId; renderAirspacePanel(); return; }
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
    const send = _el('button', 'airspace-save-btn', 'Send delay');
    const cancel = _el('button', 'airspace-action-btn', 'Cancel');
    const act = actions.find(a => a.kind === 'DelayActivation');
    send.addEventListener('click', () => { _delayFor = null; if (act) _dispatchAirspace(airspace, act, { note: input.value.trim() }); renderAirspacePanel(); });
    cancel.addEventListener('click', () => { _delayFor = null; renderAirspacePanel(); });
    form.append(input, send, cancel);
    card.appendChild(form);
  }

  if (_menuFor === airspace.airspaceId) card.appendChild(_buildMenu(airspace, signedOnPositionIds));
  const view = _views.get(airspace.airspaceId);
  if (view) card.appendChild(view.el);
  return card;
}

function _buildToolbar(signedOn) {
  _toolbarEl.innerHTML = '';
  const seg = _el('div', 'airspace-seg');
  const nothing = !signedOn.length;
  for (const [value, label] of [['mine', 'MINE'], ['all', 'ALL']]) {
    const b = _el('button', 'airspace-seg-btn', label);
    b.dataset.filter = value;
    const on = nothing ? value === 'all' : _filter === value;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (nothing) b.disabled = true;
    b.addEventListener('click', () => { _saveFilter(value); renderAirspacePanel(); });
    seg.appendChild(b);
  }
  _toolbarEl.appendChild(seg);
  _toolbarEl.appendChild(_el('span', 'airspace-as', nothing ? 'Signed on to nothing: read only' : `Acting as ${signedOn.join(', ')}`));
  if (caps.createPositionsFor(signedOn).length) {
    const add = _el('button', 'airspace-action-btn airspace-new-btn', '+ New airspace');
    add.addEventListener('click', _openCreate);
    _toolbarEl.appendChild(add);
  }
}

export function renderAirspacePanel() {
  if (!_airspaceListEl) return; // not initialized yet
  const airspaces = getAllEfspAirspaces();
  const signedOn = getActingPositions();

  // The render rebuilds the list, which would drop the focus of a field being typed in: remember it and put it back.
  const active = document.activeElement;
  const focused = active && active.closest && active.closest('.airspace-editor') ? { el: active, start: active.selectionStart, end: active.selectionEnd } : null;

  // An open view whose airspace is gone (deleted by someone else) closes with it.
  for (const key of [..._views.keys()]) if (key !== NEW_KEY && !airspaces.some(a => a.airspaceId === key)) _closeView(key);

  if (_toolbarEl) _buildToolbar(signedOn);
  _airspaceListEl.innerHTML = '';
  const newView = _views.get(NEW_KEY);
  if (newView) {
    const card = _el('div', 'airspace-card airspace-card-new');
    card.appendChild(_el('div', 'airspace-name', 'New airspace'));
    card.appendChild(newView.el);
    _airspaceListEl.appendChild(card);
  }
  const shown = visibleAirspaces(airspaces, signedOn, _filter);
  for (const group of groupByFacility(shown)) {
    _airspaceListEl.appendChild(_el('div', 'airspace-group', `${group.facilityId} · ${group.airspaces.length}`));
    for (const airspace of group.airspaces) _airspaceListEl.appendChild(_buildAirspaceCard(airspace, signedOn));
  }

  if (_airspaceEmptyEl) {
    // Shipping with no airspaces configured is the expected state until the
    // squadron's real MOAs and ranges are filled in — say so plainly rather
    // than rendering a blank panel that looks broken.
    _airspaceEmptyEl.hidden = shown.length > 0 || !!newView;
    _airspaceEmptyEl.textContent = airspaces.length > 0 && shown.length === 0
      ? 'None of the airspaces here is yours. Switch to ALL to see them.' : 'No airspaces configured.';
  }
  if (focused && focused.el.isConnected !== false) {
    try { focused.el.focus(); if (focused.start != null) focused.el.setSelectionRange(focused.start, focused.end); } catch (_) { /* a select has no selection range */ }
  }
}

export function initAirspacePanel() {
  _airspaceListEl = document.getElementById('airspace-list');
  _airspaceEmptyEl = document.getElementById('airspace-empty');
  if (_airspaceListEl && _airspaceListEl.parentNode) {
    _toolbarEl = _airspaceListEl.parentNode.querySelector('.airspace-toolbar');
    if (!_toolbarEl) {
      _toolbarEl = _el('div', 'airspace-toolbar');
      _airspaceListEl.parentNode.insertBefore(_toolbarEl, _airspaceListEl.parentNode.firstChild);
    }
  }
  renderAirspacePanel();
  return { onShow: () => renderAirspacePanel() };
}

// The airspace family's wire handlers (CMSG; moved out of app.js's ws.onmessage).
// The RANGE slice — an airspace is not a Strip and rides no Board's
// seq, so it gets its own delta rather than a section of
// efsp-board-delta.
registerEfspMessage('efsp-airspace-delta', (msg) => {
  applyEfspAirspaceDelta(msg);
  renderAirspacePanel();
});

// The booking calendar (crc-sync's airspace-calendar.js, ADR 0098 §9): information only, it changes no state. The
// booking page's URL is also reported to the app's main process, which opens a link to that origin and no other (S-2PA0).
registerEfspMessage('efsp-airspace-calendar', (msg) => {
  applyAirspaceCalendar(msg);
  const url = bookingUrl();
  if (window.crcLinks && window.crcLinks.allowBookingUrl) window.crcLinks.allowBookingUrl(url || '');
  renderAirspacePanel();
});

registerEfspMessage('efsp-airspace-ack', (msg) => {
  // An ack for a form this window has open is shown in that form (inline, on the field or beside Save), not as a banner.
  let handled = false;
  for (const view of [..._views.values()]) {
    if (view.handleAck(msg)) { handled = true; break; }
  }
  if (!msg.ok) {
    if (!handled) {
      console.warn('[efsp] airspace op rejected:', msg.reason, msg);
      // An airspace op targets no Strip, so it is named by the block it
      // was about rather than by a callsign (F-103's attribution rule,
      // applied to the thing that actually was refused).
      _showMutationError(msg.reason || 'Rejected', msg.detail,
        msg.airspace ? { subject: (msg.airspace.definition && msg.airspace.definition.name) || msg.airspace.airspaceId } : null);
    }
  } else if (msg.warning === 'AIRSPACE_STILL_OCCUPIED') {
    // Released with flights still in it. Allowed — the controller may
    // know they are clear — but they are on the block's frequency and
    // the panel now treats them as being in airspace nobody holds.
    _showMutationWarning(`Released with ${msg.occupied} flight${msg.occupied === 1 ? '' : 's'} still in the block`);
  }
  renderAirspacePanel();
});

