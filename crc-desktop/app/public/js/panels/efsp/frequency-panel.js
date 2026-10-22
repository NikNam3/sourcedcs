'use strict';
import { registerEfspMessage } from './efsp-message-registry.js';
import { markEfspChanged, onEfspChanged } from './efsp-change-bus.js';
import { applyEfspFrequencyDelta, getAllEfspPositions } from './efsp-state.js';
import { getActingPositions, sendEfspFrequencyMutation, settleEfspAck } from './efsp-ws.js';
import { _showMutationError } from './panel/refusal.js';
import {
  addFrequencyOp, frequencyRowKey, frequencyRowName, frequencySections, frequencySetNote, frequencyText, getFrequencyRows,
  isFrequencyAdded, isFrequencySet, parseFrequencyInput, parseFrequencyLabel, removeFrequencyOp, resetFrequencyOp, setFrequencyOp,
} from './frequency-state.js';

// The FREQUENCIES panel (crc-sync docs/adr/0131, H154): the station frequencies of every Facility, the Position
// frequencies (GND, TWR, ...) and the single frequency approach pool, which the controllers set at run time. Squadron
// data shared by everyone, so its own dock panel rather than a Settings tab (Settings holds a controller's own choices).
//
// Dark cockpit (H115-H119): a grey table. A value a controller set (it differs from the facility file) carries a grey
// SET mark and a note (the default, who, when); nothing is coloured unless a typed value is refused. Edit in place:
// click the value, type, Enter sends, Escape abandons. RESET returns a set row to the default. A Facility's rows are
// edited only from one of its own Positions (crc-sync docs/adr/0138, H156 FQ-Q2 b): another Facility's rows only read,
// with no edit affordance and no text saying why. Signed on nowhere, the values only read.
//
// Rows are added and removed at run time (docs/adr/0138, FQ-Q3 b): ADD on an editable Facility opens one line (where:
// a Position of the Facility or its SFA pool; a label for a Position; the frequency), Enter sends, Escape abandons. An
// added row is marked SET like a set one, its note says `added`, and REMOVE takes it away (a shipped row only resets).
//
// The airspace working and control frequencies stay in the airspace editor (they belong to the airspace record).
//
// Element references are cached in initFrequencyPanel(), never looked up per render: dockview detaches an inactive panel.

let _freqListEl = null;
let _freqEmptyEl = null;
let _freqEdit = null;    // { key, text, error, fresh }: the one row being typed in, kept across the re-renders a delta causes
let _freqPending = new Set(); // row keys with a request in flight
let _freqAdd = null;     // { facilityId, positionId (null: the SFA pool), label, mhz, error, fresh, pending }: the one add line open

function _freqEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** The Position this controller acts as for a frequency edit of `facilityId`: one of that Facility's it is Primary at, or null. */
function _freqActingPosition(facilityId) {
  return getActingPositions(facilityId)[0] || null;
}

function _freqSend(row, op) {
  const acting = _freqActingPosition(row.facilityId);
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
      const added = isFrequencyAdded(row);
      const reset = _freqEl('button', added ? 'freq-reset freq-remove' : 'freq-reset', added ? 'REMOVE' : 'RESET');
      reset.type = 'button';
      reset.title = added ? 'Remove this frequency' : `Back to ${frequencyText(row.defaultMhz)}`;
      reset.disabled = _freqPending.has(frequencyRowKey(row));
      reset.addEventListener('click', () => {
        if (_freqEdit && _freqEdit.key === frequencyRowKey(row)) _freqEdit = null;
        _freqSend(row, added ? removeFrequencyOp(row) : resetFrequencyOp(row));
      });
      tail.append(reset);
    }
  }
  line.append(tail);
  // A refused value's reason, under the value, across the row (the panel's only amber).
  if (_freqEdit && _freqEdit.key === frequencyRowKey(row) && _freqEdit.error) line.append(_freqEl('div', 'freq-error', _freqEdit.error));
  return line;
}

// ── adding a row (docs/adr/0138) ──────────────────────────────────────────────────────────────────────────────

const SFA_TARGET = '';  // the add line's "where" value for the SFA pool

function _freqStartAdd(section, positionIds) {
  _freqEdit = null;
  _freqAdd = { facilityId: section.facilityId, positionId: positionIds[0] || null, label: '', mhz: '', error: null, fresh: true, pending: false };
  renderFrequencyPanel();
}

function _freqCommitAdd(section) {
  const a = _freqAdd;
  if (!a || a.pending) return;
  const acting = _freqActingPosition(a.facilityId);
  if (!acting) return;
  let label = null;
  if (a.positionId) {
    const taken = (section.positions.find(p => p.positionId === a.positionId) || { rows: [] }).rows.map(r => r.label);
    const parsed = parseFrequencyLabel(a.label, taken);
    if (parsed.error) { a.error = parsed.error; renderFrequencyPanel(); return; }
    label = parsed.label;
  }
  const parsed = parseFrequencyInput(a.mhz, a.positionId ? { kind: 'POSITION' } : { kind: 'SFA' }, section.sfa);
  if (parsed.error) { a.error = parsed.error; renderFrequencyPanel(); return; }
  a.pending = true;
  sendEfspFrequencyMutation(acting, a.facilityId, addFrequencyOp(a.positionId, label, parsed.mhz), {
    onAck: (ack) => {
      if (_freqAdd === a) {
        a.pending = false;
        if (ack.ok) _freqAdd = null; else a.error = ack.detail || ack.reason;
      }
      renderFrequencyPanel();
      return true;
    },
  });
  renderFrequencyPanel();
}

function _freqAddLine(section, positionIds) {
  const a = _freqAdd;
  const line = _freqEl('div', 'freq-add-line');
  const where = _freqEl('select', 'freq-add-where');
  where.setAttribute('aria-label', `${section.facilityId} new frequency for`);
  for (const id of positionIds) where.append(Object.assign(_freqEl('option', null, id), { value: id }));
  if (section.sfa.length) where.append(Object.assign(_freqEl('option', null, 'SFA'), { value: SFA_TARGET }));
  where.value = a.positionId || SFA_TARGET;
  where.addEventListener('change', () => { a.positionId = where.value || null; a.error = null; renderFrequencyPanel(); });
  const label = _freqEl('input', 'freq-input freq-add-label');
  label.type = 'text';
  label.placeholder = 'LABEL';
  label.value = a.label;
  label.hidden = !a.positionId;
  label.setAttribute('aria-label', `${section.facilityId} new frequency label`);
  label.addEventListener('input', () => { a.label = label.value; a.error = null; });
  const mhz = _freqEl('input', 'freq-input freq-add-mhz');
  mhz.type = 'text';
  mhz.inputMode = 'decimal';
  mhz.placeholder = 'MHz';
  mhz.value = a.mhz;
  mhz.setAttribute('aria-label', `${section.facilityId} new frequency`);
  mhz.addEventListener('input', () => { a.mhz = mhz.value; a.error = null; });
  for (const input of [where, label, mhz]) {
    input.disabled = a.pending;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); _freqCommitAdd(section); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _freqAdd = null; renderFrequencyPanel(); }
    });
    input.addEventListener('focus', () => { a.focus = input; });
  }
  line.append(where, label, mhz);
  if (a.error) line.append(_freqEl('div', 'freq-error', a.error));
  // Focus the first field once, and keep it on the field it was on across a re-render (the panel builds detached).
  const was = a.focus && a.focus.classList ? [...a.focus.classList].find(c => c.startsWith('freq-add-')) : null;
  const target = a.fresh ? (a.positionId ? label : mhz) : [where, label, mhz].find(i => was && i.classList.contains(was));
  a.fresh = false;
  if (target) Promise.resolve().then(() => { if (typeof target.focus === 'function') target.focus(); });
  return line;
}

export function renderFrequencyPanel() {
  if (!_freqListEl) return;
  const sections = frequencySections(getFrequencyRows());
  // A Facility this controller may edit shows even with no frequencies yet, so one can be added (docs/adr/0138).
  for (const facilityId of new Set(getAllEfspPositions().map(p => p.facilityId))) {
    if (facilityId && !sections.some(s => s.facilityId === facilityId) && _freqActingPosition(facilityId)) sections.push({ facilityId, positions: [], sfa: [] });
  }
  _freqEmptyEl.hidden = sections.length > 0;
  const frag = document.createDocumentFragment();
  if (sections.length && !sections.some(s => _freqActingPosition(s.facilityId))) frag.append(_freqEl('div', 'freq-readonly', 'Sign on to a Position to set frequencies.'));
  if (_freqAdd && !_freqActingPosition(_freqAdd.facilityId)) _freqAdd = null; // signed off meanwhile
  for (const s of sections) {
    const canEdit = !!_freqActingPosition(s.facilityId);
    const box = _freqEl('div', 'freq-facility');
    box.dataset.facilityId = s.facilityId;
    const head = _freqEl('div', 'freq-facility-head');
    head.append(_freqEl('div', 'freq-facility-id', s.facilityId));
    // The Positions a frequency may be added to: the Facility's, as the server lists them.
    const positionIds = getAllEfspPositions().filter(p => p.facilityId === s.facilityId).map(p => p.positionId);
    if (canEdit && (positionIds.length || s.sfa.length)) {
      const add = _freqEl('button', 'freq-add', 'ADD');
      add.type = 'button';
      add.title = 'Add a frequency';
      add.disabled = !!(_freqAdd && _freqAdd.facilityId === s.facilityId);
      add.addEventListener('click', () => _freqStartAdd(s, positionIds));
      head.append(add);
    }
    box.append(head);
    if (canEdit && _freqAdd && _freqAdd.facilityId === s.facilityId) box.append(_freqAddLine(s, positionIds));
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
