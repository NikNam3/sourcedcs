'use strict';
import { refreshAirspaceLayers } from '../../airspace-layer.js';
import { getAllEfspAirspaces } from './efsp-state.js';
import { getActingPositions, settleEfspAck } from './efsp-ws.js';
import { registerEfspMessage, registerEfspStoreRedraw } from './efsp-message-registry.js';
import { applyEfspAirspaceDelta } from './efsp-state.js';
import { _showMutationError, _showMutationWarning } from './panel/refusal.js';
import * as caps from './airspace-capabilities.js';
import { applyAirspaceCalendar, bookingUrl } from './airspace-calendar.js';
import { onEfspChanged } from './efsp-change-bus.js';
import { NEW_KEY, _draftInputs, _filter, _saveFilter, _views } from './airspace-view-state.js';
import { groupByFacility, visibleAirspaces } from './airspace-rules.js';
import { _closeView, _el, _openCreate } from './airspace-views.js';
import { _buildAirspaceCard } from './airspace-card.js';
import { buildJurisdictionSection } from './jurisdiction-section.js';
import { _transitionAlt } from './airspace-rules.js';

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
  refreshAirspaceLayers(); // the map's outlines follow the registry, whether or not this panel is built
  if (!_airspaceListEl) return; // not initialized yet
  const everything = getAllEfspAirspaces();
  // Jurisdiction areas (crc-sync ADR 0125) are not cards: they have their own section (_appendJurisdiction).
  const airspaces = everything.filter(a => !a.definition || a.definition.kind !== 'JURISDICTION');
  const signedOn = getActingPositions();

  // The render rebuilds the list, which would drop the focus of a field being typed in: remember it and put it back.
  const active = document.activeElement;
  const focused = active && active.closest && active.closest('.airspace-editor') ? { el: active, start: active.selectionStart, end: active.selectionEnd } : null;

  // The same for a draft field: its input is a new element after the rebuild, so focus and caret are put back by key.
  const draftKey = active && active.dataset && active.dataset.draftKey;
  const draftFocus = draftKey ? { key: draftKey, start: active.selectionStart, end: active.selectionEnd } : null;
  _draftInputs.clear();

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

  const jurisdiction = _appendJurisdiction(everything, signedOn);

  if (_airspaceEmptyEl) {
    // Shipping with no airspaces configured is the expected state until the
    // squadron's real MOAs and ranges are filled in — say so plainly rather
    // than rendering a blank panel that looks broken.
    _airspaceEmptyEl.hidden = shown.length > 0 || !!newView || (jurisdiction && airspaces.length === 0);
    _airspaceEmptyEl.textContent = airspaces.length > 0 && shown.length === 0
      ? 'None of the airspaces here is yours. Switch to ALL to see them.' : 'No airspaces configured.';
  }
  if (draftFocus) {
    const el = _draftInputs.get(draftFocus.key);
    if (el) {
      try { el.focus(); if (draftFocus.start != null) el.setSelectionRange(draftFocus.start, draftFocus.end); } catch (_) { /* no selection range */ }
    }
  }
  if (focused && focused.el.isConnected !== false) {
    try { focused.el.focus(); if (focused.start != null) focused.el.setSelectionRange(focused.start, focused.end); } catch (_) { /* a select has no selection range */ }
  }
}

/** The JURISDICTION section (crc-sync ADR 0125, jurisdiction-section.js), under the cards. True when it was drawn. */
function _appendJurisdiction(everything, signedOn) {
  const section = buildJurisdictionSection(everything, signedOn, { transitionAltFt: _transitionAlt() });
  if (section) _airspaceListEl.appendChild(section);
  return !!section;
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
registerEfspStoreRedraw('airspaces', renderAirspacePanel);

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
  const handled = settleEfspAck(msg);
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

onEfspChanged(['snapshot', 'airspace'], () => renderAirspacePanel()); // a new Board lifetime, or a form or menu opened or closed (efsp-change-bus.js)
