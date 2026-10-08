'use strict';
import { carrierBannerParts, carrierBearingText, carrierHhmm, carrierSourceText, carrierStateOf, getEfspCarrier } from './carrier-state.js';
import { carrierActingFor, sendCarrierState, signedOnCarrierIds } from './carrier-send.js';

// The carrier management panel (crc-sync docs/adr/0113; decisions H119; mockup docs/mockups/carrier-map-panel.html, the right-hand
// part). An ordinary dockable panel: the values a recovery is run by, each with where it comes from. PriFly and the Marshal type
// over them; the approach lanes and everyone else only read.
//
// Dark cockpit (memory feedback_dark_cockpit_ui): grey; the one amber is a ship that cannot be found or whose track was lost; it
// never tells the controller their job. Typing a value overrides it (Enter sets, Esc puts the field back), and the button beside an
// overridden value gives the automatic value back: "Use DCS" for what the game knows, "Use default" for what is worked out, "Clear"
// for what nothing supplies.
//
// No arithmetic here (crc-sync computes the default final bearing, the radial, the wind over deck, and converts a typed
// magnetic bearing): this file formats what arrives and sends what was typed. The panel holds no state of its own except its DOM;
// it is drawn from the hull view (`view.state`).
//
// Element references are cached once (dockview detaches an inactive panel's root from the document, so getElementById stops finding
// it while detached; the runway-status panel's rule). A row is built once and updated in place, so a delta that arrives while the
// controller is typing in one field never tears that field out from under them.

let _bodyEl = null;
let _emptyEl = null;
let _statusEl = null;
const _rows = new Map(); // field -> { row, input, value, src, reset }

const COMMON_NOTES = {
  finalBearing: (v) => `BRC − ${v && v.hull ? v.hull.angledDeckDeg : '?'}° (angled deck)`,
  radial: () => 'final bearing + 180',
  firstFix: () => 'angels 6; each fix angels + 15',
  windOverDeck: () => 'DCS wind + ship speed',
  tankerPatternSide: () => 'racetrack, downwind 4 nm abeam (CV NATOPS 6.10.3: 3–5 nm)',
};

const GROUPS = [
  { id: 'ship', title: 'SHIP', rows: [
    { field: 'brc', label: 'BRC', kind: 'bearing', get: (s) => s.brc, reset: 'Use DCS', note: () => "ship's heading from DCS" },
    { field: 'finalBearing', label: 'Final bearing', kind: 'bearing', get: (s) => s.finalBearing, reset: 'Use default' },
    { field: 'case', label: 'Case', kind: 'select', get: (s) => s.case, reset: 'Use default', options: [['I', 'I'], ['II', 'II'], ['III', 'III']], note: () => 'III unless set' },
    { field: 'rampTime', label: 'Ramp time', kind: 'time', get: (s) => s.rampTime, reset: 'Clear', unit: 'Z', note: () => 'the Charlie time EATs are worked back from' },
  ] },
  { id: 'marshal', title: 'MARSHAL', rows: [
    { field: 'radial', label: 'Radial', kind: 'bearing', get: (s) => s.radial, reset: 'Use default' },
    { field: 'firstFix', label: 'First fix', kind: 'num', get: (s) => s.firstFix, reset: 'Use default', unit: 'DME' },
  ] },
  { id: 'weather', title: 'WEATHER AT THE SHIP', rows: [
    { field: 'ceiling', label: 'Ceiling', kind: 'num', get: (s) => s.weather.ceiling, reset: 'Clear', unit: 'ft' },
    { field: 'visibility', label: 'Visibility', kind: 'num', get: (s) => s.weather.visibility, reset: 'Clear', unit: 'nm' },
    { field: 'windOverDeck', label: 'Wind over deck', kind: 'num', get: (s) => s.weather.windOverDeck, reset: 'Use DCS', unit: 'kt' },
    { field: 'altimeter', label: 'Altimeter', kind: 'num', get: (s) => s.weather.altimeter, reset: 'Use DCS', digits: 2 },
  ] },
  { id: 'tanker', title: 'RECOVERY TANKER', rows: [
    { field: 'tankerSide', label: 'Side number', kind: 'text', get: (s) => s.tanker.sideNumber, reset: 'Clear' },
    { field: 'tankerAltitude', label: 'Altitude', kind: 'num', get: (s) => s.tanker.altitude, reset: 'Use default', unit: 'ft', note: () => 'ours; CV NATOPS sets none' },
    { field: 'tankerGive', label: 'Give', kind: 'num', get: (s) => s.tanker.give, reset: 'Clear', unit: 'k lb', digits: 1 },
    { field: 'tankerPatternSide', label: 'Pattern side', kind: 'select', get: (s) => s.tanker.patternSide, reset: 'Use default', options: [['port', 'port'], ['stbd', 'starboard']] },
    { field: 'tankerOnStation', label: 'On station', kind: 'select', get: (s) => s.tanker.onStation, reset: 'Use default', options: [['false', 'no'], ['true', 'yes']] },
  ] },
];

function _el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** What a field shows, as the controller reads it. */
function _shown(def, entry) {
  if (!entry || entry.value == null) return '';
  switch (def.kind) {
    case 'bearing': return carrierBearingText(entry.display).replace(/[A-Z]$/, '');
    case 'time': return carrierHhmm(entry.value);
    case 'num': return def.digits != null ? Number(entry.value).toFixed(def.digits) : String(entry.value);
    case 'select': return String(entry.value);
    default: return String(entry.value);
  }
}

/** The reference letter of a bearing (M, or T / G when it is not magnetic), '' otherwise. */
function _refOf(def, entry) {
  if (def.kind !== 'bearing' || !entry || !entry.display || entry.display.value == null) return '';
  return entry.display.ref || '';
}

function _autoText(def, entry) {
  if (!entry || entry.default == null) return '';
  if (def.kind === 'bearing') return carrierBearingText(entry.defaultDisplay);
  if (def.kind === 'num') return def.digits != null ? Number(entry.default).toFixed(def.digits) : String(entry.default);
  return String(entry.default);
}

function _sourceText(def, entry, view) {
  const note = (def.note || COMMON_NOTES[def.field]);
  const noteText = note ? note(view) : '';
  if (!entry) return '';
  if (entry.source === 'override') {
    const auto = _autoText(def, entry);
    return auto ? `set · automatic ${auto}` : 'set';
  }
  const word = carrierSourceText(entry);
  if (entry.source === 'none') return word;
  return noteText ? `${word} · ${noteText}` : word;
}

function _build() {
  _bodyEl.textContent = '';
  _rows.clear();
  _statusEl = _el('div', 'carrier-mgmt-status');
  _statusEl.dataset.carrierMgmt = 'status';
  _bodyEl.appendChild(_statusEl);
  for (const group of GROUPS) {
    const g = _el('section', 'carrier-mgmt-group');
    g.dataset.carrierGroup = group.id;
    g.appendChild(_el('h3', 'carrier-mgmt-title', group.title));
    for (const def of group.rows) {
      const row = _el('div', 'carrier-mgmt-row');
      row.dataset.carrierRow = def.field;
      const labelId = `carrier-mgmt-${def.field}`;
      const label = _el('label', 'carrier-mgmt-label', def.label);
      label.htmlFor = labelId;
      const val = _el('div', 'carrier-mgmt-val');
      let input;
      if (def.kind === 'select') {
        input = _el('select', 'carrier-mgmt-input');
        for (const [v, text] of def.options) { const o = _el('option', null, text); o.value = v; input.appendChild(o); }
        input.addEventListener('change', () => {
          const raw = input.value;
          const value = def.field === 'tankerOnStation' ? raw === 'true' : raw;
          sendCarrierState(def.field, value);
        });
      } else {
        input = _el('input', 'carrier-mgmt-input');
        input.type = 'text';
        input.autocomplete = 'off';
        input.size = def.kind === 'text' ? 8 : 6;
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            // An empty field and Enter is the same as the reset button.
            sendCarrierState(def.field, input.value.trim() === '' ? null : input.value.trim());
            input.dataset.dirty = '';
            e.preventDefault();
          } else if (e.key === 'Escape') { input.blur(); }
        });
        input.addEventListener('input', () => { input.dataset.dirty = '1'; });
        // No commit on blur (the Strip panel's rule): leaving a field puts back what is in force.
        input.addEventListener('blur', () => { input.dataset.dirty = ''; renderCarrierManagement(); });
      }
      input.id = labelId;
      input.dataset.carrierField = def.field;
      const value = _el('span', 'carrier-mgmt-value');
      value.dataset.carrierValue = def.field;
      const unit = _el('span', 'carrier-mgmt-unit');
      unit.dataset.carrierUnit = def.field;
      const src = _el('span', 'carrier-mgmt-src');
      src.dataset.carrierSource = def.field;
      const reset = _el('button', 'carrier-mgmt-reset', def.reset);
      reset.type = 'button';
      reset.dataset.carrierReset = def.field;
      reset.addEventListener('click', () => sendCarrierState(def.field, null));
      val.append(input, value, unit, src, reset);
      row.append(label, val);
      g.appendChild(row);
      _rows.set(def.field, { def, row, input, value, unit, src, reset });
    }
    _bodyEl.appendChild(g);
  }
}

/** Draws the panel from the hull view. Cheap; called on every carrier frame. */
export function renderCarrierManagement() {
  if (!_bodyEl) return; // not initialised yet
  const view = getEfspCarrier();
  const st = carrierStateOf(view);
  if (_emptyEl) _emptyEl.hidden = !!st;
  _bodyEl.hidden = !st;
  if (!st) return;
  if (_rows.size === 0) _build();
  const canEdit = !!carrierActingFor('editsCarrierState', signedOnCarrierIds());
  _bodyEl.dataset.carrierEditable = canEdit ? '1' : '0';

  const banner = carrierBannerParts(view);
  _statusEl.textContent = [view.hullId, banner.problem].filter(Boolean).join('  ·  ');
  if (banner.problem) _statusEl.classList.add('carrier-mgmt-problem'); else _statusEl.classList.remove('carrier-mgmt-problem');
  _statusEl.dataset.problem = banner.problem ? '1' : '';

  for (const { def, input, value, unit, src, reset } of _rows.values()) {
    const entry = def.get(st);
    const text = _shown(def, entry);
    const ref = _refOf(def, entry);
    const typing = document.activeElement === input && input.tagName === 'INPUT';
    input.hidden = !canEdit;
    value.hidden = canEdit;
    if (!typing && input.dataset.dirty !== '1') input.value = text;
    value.textContent = text === '' ? '—' : text;
    unit.textContent = def.kind === 'bearing' ? (ref ? `°${ref}` : '') : def.kind === 'time' ? 'Z' : (def.unit ? ` ${def.unit}` : '');
    src.textContent = _sourceText(def, entry, view);
    reset.hidden = !(canEdit && entry && entry.source === 'override');
  }
}

export function initCarrierManagementPanel() {
  _bodyEl = document.getElementById('carrier-mgmt-body');
  _emptyEl = document.getElementById('carrier-mgmt-empty');
  _rows.clear();
  renderCarrierManagement();
  return { onShow: () => renderCarrierManagement() };
}
