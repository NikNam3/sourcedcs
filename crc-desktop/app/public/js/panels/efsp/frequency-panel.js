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

let _freqListEl = null;
let _freqEmptyEl = null;
let _freqEdit = null;    // { key, text, error, fresh }: the one row being typed in, kept across the re-renders a delta causes
let _freqPending = new Set(); // row keys with a request in flight

function _freqEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** The Position this controller acts as for a frequency edit: any Position it is Primary at, or null. */
function _freqActingPosition() {
  return getActingPositions()[0] || null;
}

function _freqSend(row, op) {
  const acting = _freqActingPosition();
  if (!acting) return;
  const key = frequencyRowKey(row);
  _freqPending.add(key);
  sendEfspFrequencyMutation(acting, row.facilityId, op, {
    onAck: (ack) => {
      _freqPending.delete(key);
      if (!ack.ok) {
        // Keep what was typed, and say why it was refused, in the row (the only amber in the panel).
        if (_freqEdit && _freqEdit.key === key) _freqEdit.error = ack.detail || ack.reason;
        else _showMutationError(ack.reason || 'Rejected', ack.detail, { subject: `frequency ${frequencyRowName(row)}` });
      } else if (_freqEdit && _freqEdit.key === key) {
        _freqEdit = null;
      }
      renderFrequencyPanel();
      return true;
    },
  });
  renderFrequencyPanel();
}

function _freqStartEdit(row) {
  _freqEdit = { key: frequencyRowKey(row), text: frequencyText(row.mhz), error: null, fresh: true };
  renderFrequencyPanel();
}

function _freqCommit(row, pool) {
  if (!_freqEdit) return;
  const parsed = parseFrequencyInput(_freqEdit.text, row, pool);
  if (parsed.error) { _freqEdit.error = parsed.error; renderFrequencyPanel(); return; }
  if (parsed.mhz === row.mhz) { _freqEdit = null; renderFrequencyPanel(); return; }
  _freqSend(row, setFrequencyOp(row, parsed.mhz));
}

function _freqValueCell(row, pool, canEdit) {
  const key = frequencyRowKey(row);
  const cell = _freqEl('div', 'freq-value-cell');
  if (_freqEdit && _freqEdit.key === key) {
    const input = _freqEl('input', 'freq-input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = _freqEdit.text;
    input.setAttribute('aria-label', `${row.facilityId} ${row.positionId || 'SFA'} ${frequencyRowName(row)} frequency`);
    input.addEventListener('input', () => { if (_freqEdit) { _freqEdit.text = input.value; _freqEdit.error = null; } });
    input.addEventListener('focus', () => { if (_freqEdit) _freqEdit.focused = true; });
    input.addEventListener('blur', () => { if (_freqEdit) _freqEdit.focused = false; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); _freqCommit(row, pool); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _freqEdit = null; renderFrequencyPanel(); }
    });
    cell.append(input);
    // after the row is attached (the panel builds detached, then appends). A re-render while typing (another
    // controller's change arrived) keeps the focus where it was.
    if (_freqEdit.fresh || _freqEdit.focused) {
      const select = _freqEdit.fresh;
      _freqEdit.fresh = false;
      Promise.resolve().then(() => { if (typeof input.focus === 'function') { input.focus(); if (select) input.select(); } });
    }
    return cell;
  }
  const value = _freqEl(canEdit ? 'button' : 'span', 'freq-value', frequencyText(row.mhz));
  if (canEdit) {
    value.type = 'button';
    value.title = 'Click to set';
    value.disabled = _freqPending.has(key);
    value.addEventListener('click', () => _freqStartEdit(row));
  }
  cell.append(value);
  return cell;
}

function _freqRow(row, pool, canEdit) {
  const set = isFrequencySet(row);
  const line = _freqEl('div', `freq-row${set ? ' freq-row-set' : ''}`);
  line.dataset.key = frequencyRowKey(row);
  line.append(_freqEl('span', 'freq-name', frequencyRowName(row)));
  line.append(_freqValueCell(row, pool, canEdit));
  const tail = _freqEl('div', 'freq-tail');
  if (set) {
    tail.append(_freqEl('span', 'freq-set-mark', 'SET'));
    tail.append(_freqEl('span', 'freq-note', frequencySetNote(row)));
    if (canEdit) {
      const reset = _freqEl('button', 'freq-reset', 'RESET');
      reset.type = 'button';
      reset.title = `Back to ${frequencyText(row.defaultMhz)}`;
      reset.disabled = _freqPending.has(frequencyRowKey(row));
      reset.addEventListener('click', () => { if (_freqEdit && _freqEdit.key === frequencyRowKey(row)) _freqEdit = null; _freqSend(row, resetFrequencyOp(row)); });
      tail.append(reset);
    }
  }
  line.append(tail);
  // A refused value's reason, under the value, across the row (the panel's only amber).
  if (_freqEdit && _freqEdit.key === frequencyRowKey(row) && _freqEdit.error) line.append(_freqEl('div', 'freq-error', _freqEdit.error));
  return line;
}

export function renderFrequencyPanel() {
  if (!_freqListEl) return;
  const sections = frequencySections(getFrequencyRows());
  _freqEmptyEl.hidden = sections.length > 0;
  const canEdit = !!_freqActingPosition();
  const frag = document.createDocumentFragment();
  if (sections.length && !canEdit) frag.append(_freqEl('div', 'freq-readonly', 'Sign on to a Position to set frequencies.'));
  for (const s of sections) {
    const box = _freqEl('div', 'freq-facility');
    box.dataset.facilityId = s.facilityId;
    box.append(_freqEl('div', 'freq-facility-id', s.facilityId));
    for (const p of s.positions) {
      const group = _freqEl('div', 'freq-group');
      group.append(_freqEl('div', 'freq-group-id', p.positionId));
      for (const r of p.rows) group.append(_freqRow(r, [], canEdit));
      box.append(group);
    }
    if (s.sfa.length) {
      const group = _freqEl('div', 'freq-group');
      group.append(_freqEl('div', 'freq-group-id', 'SFA'));
      for (const r of s.sfa) group.append(_freqRow(r, s.sfa, canEdit));
      box.append(group);
    }
    frag.append(box);
  }
  _freqListEl.replaceChildren(frag);
}

export function initFrequencyPanel() {
  _freqListEl = document.getElementById('frequency-list');
  _freqEmptyEl = document.getElementById('frequency-empty');
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
