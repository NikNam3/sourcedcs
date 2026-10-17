'use strict';
import { registerEfspMessage } from './efsp-message-registry.js';
import { markEfspChanged, onEfspChanged } from './efsp-change-bus.js';
import { applyEfspFrequencyDelta } from './efsp-state.js';
import { getActingPositions, sendEfspFrequencyMutation, settleEfspAck } from './efsp-ws.js';
import { _showMutationError } from './panel/refusal.js';
import {
  frequencyRowKey, frequencyRowName, frequencySections, frequencySetNote, frequencyText, getFrequencyRows,
  isFrequencySet, parseFrequencyInput, resetFrequencyOp, setFrequencyOp,
} from './frequency-state.js';

// The FREQUENCIES panel (crc-sync docs/adr/0131, H154): the station frequencies of every Facility, the Position
// frequencies (GND, TWR, ...) and the single frequency approach pool, which the controllers set at run time. Squadron
// data shared by everyone, so its own dock panel rather than a Settings tab (Settings holds a controller's own choices).
//
// Dark cockpit (H115-H119): a grey table. A value a controller set (it differs from the facility file) carries a grey
// SET mark and a note (the default, who, when); nothing is coloured unless a typed value is refused. Edit in place:
// click the value, type, Enter sends, Escape abandons. RESET returns a set row to the default. Any Position this
// controller is Primary at may edit (the server's gate); signed on nowhere, the values only read.
//
// The airspace working and control frequencies stay in the airspace editor (they belong to the airspace record).
//
// Element references are cached in initFrequencyPanel(), never looked up per render: dockview detaches an inactive panel.

let _listEl = null;
let _emptyEl = null;
let _edit = null;    // { key, text, error, fresh }: the one row being typed in, kept across the re-renders a delta causes
let _pending = new Set(); // row keys with a request in flight

function _el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** The Position this controller acts as for a frequency edit: any Position it is Primary at, or null. */
function _actingPosition() {
  return getActingPositions()[0] || null;
}

function _send(row, op) {
  const acting = _actingPosition();
  if (!acting) return;
  const key = frequencyRowKey(row);
  _pending.add(key);
  sendEfspFrequencyMutation(acting, row.facilityId, op, {
    onAck: (ack) => {
      _pending.delete(key);
      if (!ack.ok) {
        // Keep what was typed, and say why it was refused, in the row (the only amber in the panel).
        if (_edit && _edit.key === key) _edit.error = ack.detail || ack.reason;
        else _showMutationError(ack.reason || 'Rejected', ack.detail, { subject: `frequency ${frequencyRowName(row)}` });
      } else if (_edit && _edit.key === key) {
        _edit = null;
      }
      renderFrequencyPanel();
      return true;
    },
  });
  renderFrequencyPanel();
}

function _startEdit(row) {
  _edit = { key: frequencyRowKey(row), text: frequencyText(row.mhz), error: null, fresh: true };
  renderFrequencyPanel();
}

function _commit(row, pool) {
  if (!_edit) return;
  const parsed = parseFrequencyInput(_edit.text, row, pool);
  if (parsed.error) { _edit.error = parsed.error; renderFrequencyPanel(); return; }
  if (parsed.mhz === row.mhz) { _edit = null; renderFrequencyPanel(); return; }
  _send(row, setFrequencyOp(row, parsed.mhz));
}

function _valueCell(row, pool, canEdit) {
  const key = frequencyRowKey(row);
  const cell = _el('div', 'freq-value-cell');
  if (_edit && _edit.key === key) {
    const input = _el('input', 'freq-input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = _edit.text;
    input.setAttribute('aria-label', `${row.facilityId} ${row.positionId || 'SFA'} ${frequencyRowName(row)} frequency`);
    input.addEventListener('input', () => { if (_edit) { _edit.text = input.value; _edit.error = null; } });
    input.addEventListener('focus', () => { if (_edit) _edit.focused = true; });
    input.addEventListener('blur', () => { if (_edit) _edit.focused = false; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); _commit(row, pool); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _edit = null; renderFrequencyPanel(); }
    });
    cell.append(input);
    if (_edit.error) cell.append(_el('div', 'freq-error', _edit.error));
    // after the row is attached (the panel builds detached, then appends). A re-render while typing (another
    // controller's change arrived) keeps the focus where it was.
    if (_edit.fresh || _edit.focused) {
      const select = _edit.fresh;
      _edit.fresh = false;
      Promise.resolve().then(() => { if (typeof input.focus === 'function') { input.focus(); if (select) input.select(); } });
    }
    return cell;
  }
  const value = _el(canEdit ? 'button' : 'span', 'freq-value', frequencyText(row.mhz));
  if (canEdit) {
    value.type = 'button';
    value.title = 'Click to set';
    value.disabled = _pending.has(key);
    value.addEventListener('click', () => _startEdit(row));
  }
  cell.append(value);
  return cell;
}

function _row(row, pool, canEdit) {
  const set = isFrequencySet(row);
  const line = _el('div', `freq-row${set ? ' freq-row-set' : ''}`);
  line.dataset.key = frequencyRowKey(row);
  line.append(_el('span', 'freq-name', frequencyRowName(row)));
  line.append(_valueCell(row, pool, canEdit));
  const tail = _el('div', 'freq-tail');
  if (set) {
    tail.append(_el('span', 'freq-set-mark', 'SET'));
    tail.append(_el('span', 'freq-note', frequencySetNote(row)));
    if (canEdit) {
      const reset = _el('button', 'freq-reset', 'RESET');
      reset.type = 'button';
      reset.title = `Back to ${frequencyText(row.defaultMhz)}`;
      reset.disabled = _pending.has(frequencyRowKey(row));
      reset.addEventListener('click', () => { if (_edit && _edit.key === frequencyRowKey(row)) _edit = null; _send(row, resetFrequencyOp(row)); });
      tail.append(reset);
    }
  }
  line.append(tail);
  return line;
}

export function renderFrequencyPanel() {
  if (!_listEl) return;
  const sections = frequencySections(getFrequencyRows());
  _emptyEl.hidden = sections.length > 0;
  const canEdit = !!_actingPosition();
  const frag = document.createDocumentFragment();
  if (sections.length && !canEdit) frag.append(_el('div', 'freq-readonly', 'Sign on to a Position to set frequencies.'));
  for (const s of sections) {
    const box = _el('div', 'freq-facility');
    box.dataset.facilityId = s.facilityId;
    box.append(_el('div', 'freq-facility-id', s.facilityId));
    for (const p of s.positions) {
      const group = _el('div', 'freq-group');
      group.append(_el('div', 'freq-group-id', p.positionId));
      for (const r of p.rows) group.append(_row(r, [], canEdit));
      box.append(group);
    }
    if (s.sfa.length) {
      const group = _el('div', 'freq-group');
      group.append(_el('div', 'freq-group-id', 'SFA'));
      for (const r of s.sfa) group.append(_row(r, s.sfa, canEdit));
      box.append(group);
    }
    frag.append(box);
  }
  _listEl.replaceChildren(frag);
}

export function initFrequencyPanel() {
  _listEl = document.getElementById('frequency-list');
  _emptyEl = document.getElementById('frequency-empty');
  renderFrequencyPanel();
  return { onShow: () => renderFrequencyPanel() };
}

// The family's wire handlers. A delta also moves the Positions' frequencies and the SFA Bay's pool (efsp-state.js), so
// the Bays and the Position controls redraw.
registerEfspMessage('efsp-frequency-delta', (msg) => {
  applyEfspFrequencyDelta(msg);
  renderFrequencyPanel();
  markEfspChanged('positions');
  markEfspChanged('bays');
});

registerEfspMessage('efsp-frequency-ack', (msg) => {
  if (settleEfspAck(msg)) return;
  if (!msg.ok) _showMutationError(msg.reason || 'Rejected', msg.detail, { subject: 'frequency' });
});

onEfspChanged(['snapshot', 'positions'], renderFrequencyPanel);
