'use strict';
import { missionNow } from '../../mission-clock.js';
import { registerSettingsTab, getSetting } from '../../settings-registry.js';
import { carrierBearingText, carrierHhmm, carrierStateOf, getEfspCarrier } from './carrier-state.js';
import { carrierActingFor, sendCarrier, signedOnCarrierIds } from './carrier-send.js';
import { shipBearingRangeOf } from './carrier-final-distance.js';
import { getAllEfspStrips, getEfspFlightData, getEfspPosition, getEfspPositionLetter, getEfspStrip } from './efsp-state.js';
import { getActingPositions, sendEfspMutation } from './efsp-ws.js';
import { onEfspChanged } from './efsp-change-bus.js';
import { nlaButtonLabel } from './efsp-nla.js';
import {
  buildBoard, clockText, dropSlot, eatMinuteText, fuelBlockOp, fuelText, marksOf, passClearanceOp, setAngelsOp, setDmeOp, setEatOp
} from './marshal-board-model.js';
import { pictureModel, renderMarshalPicture } from './marshal-picture.js';
import { circleModel, renderMarshalCircle } from './marshal-circle.js';

// The MARSHAL panel: the one panel for arriving traffic (crc-sync docs/adr/0156; ADR 0114's board). Every recovery from STACK to
// its drop, in its own Case's table (a flight keeps the Case it was given): Case II/III as SEQ SIDE TYPE FUEL EAT ANG DME beside the
// Case III picture, Case I as SEQ SIDE TYPE FUEL ANG beside the overhead circle. The Marshal and both approach controllers look at
// it; each row's button is its state (COMMENCE, TO APPR, DIRTY UP, FLY BULLS, TO PATTERN, DROP), live only for the Strip's owner.
//
// Dark cockpit (memory feedback_dark_cockpit_ui): grey while the recovery is in order. Amber is "look at this now": a flight past
// its EAT that has not pushed, an angels or EAT changed and not yet passed. There is no fuel rule. Nothing here tells anyone what
// to do; everything is named by the side number.
//
// The Marshal drags a holding row to re-sequence, sends a Delta, closes up a vacancy, and on the rows it owns types the fuel, the
// EAT, the angels and the holding fix DME (an assigned value is underlined until cleared with an empty entry). No arithmetic of the
// recovery is done here: angels, DME and the EATs are the server's (hull view), see marshal-board-model.js.

registerSettingsTab('marshal', [
  { key: 'marshalMarkChanged', type: 'toggle', label: 'Mark changed clearances until passed', default: true, onChange: () => renderMarshal() },
], { label: 'Marshal' });

let _emptyEl = null;
let _bodyEl = null;
let _els = null;
const _tables = { sequenced: [], caseI: [] }; // each table's rows in tbody order: { key, sig, tr }
let _lastBoard = null;
let _dragging = null;
let _timer = null;

function _el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** This controller's setting: show the server's "changed, not yet passed" marks (the marks themselves are shared, ADR 0115). */
function _marksShown() { return getSetting('marshalMarkChanged') !== false; }

function _canSequence() { return !!carrierActingFor('sequencesStack', signedOnCarrierIds()); }

/** The staffed approach lanes, named as the ATC-scope letters name them ("CV-1"). */
function _approachText() {
  const lanes = ['CV_APP1', 'CV_APP2'].filter((id) => { const p = getEfspPosition(id); return !!(p && p.primary); });
  return lanes.map((id) => `CV-${getEfspPositionLetter(id) || id.slice(-1)}`).join(' ');
}

function _sendStackOp(op) { return sendCarrier('sequencesStack', op); }

/** The row's button: its Strip's next step (the server's NLA), live only for the controller who holds the Strip. */
function _advance(row) {
  const strip = row.stripId ? getEfspStrip(row.stripId) : null;
  if (strip && getActingPositions('CARRIER').includes(strip.ownerPositionId)) sendEfspMutation(strip.ownerPositionId, strip, { kind: 'InvokeNla' });
}

const COLUMNS = Object.freeze({
  sequenced: ['SEQ', 'SIDE', 'TYPE', 'FUEL', 'EAT', 'ANG', 'DME', ''],
  caseI: ['SEQ', 'SIDE', 'TYPE', 'FUEL', 'ANG', ''],
});

function _section(name, caption, svgLabel) {
  const main = _el('div', 'mb-main');
  main.dataset.marshalSection = name;
  const tableCol = _el('div', 'mb-tablecol');
  const wrap = _el('div', 'mb-tw');
  tableCol.appendChild(_el('div', 'mb-k mb-caption', caption));
  const table = _el('table', 'mb-table');
  table.dataset.marshal = name === 'caseI' ? 'board-case-i' : 'board';
  const thead = _el('thead');
  const hr = _el('tr');
  for (const h of COLUMNS[name]) hr.appendChild(_el('th', null, h));
  thead.appendChild(hr);
  const tbody = _el('tbody');
  table.append(thead, tbody);
  wrap.appendChild(table);
  tableCol.appendChild(wrap);
  const picCol = _el('div', 'mb-patcol');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'mb-picture');
  svg.setAttribute('viewBox', name === 'caseI' ? '0 0 360 360' : '0 0 360 640');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', svgLabel);
  svg.dataset.marshal = name === 'caseI' ? 'circle' : 'picture';
  picCol.appendChild(svg);
  main.append(tableCol, picCol);
  return { main, tbody, svg, sig: '' };
}

function _build() {
  _bodyEl.textContent = '';
  _tables.sequenced = []; _tables.caseI = [];
  const hdr = _el('div', 'mb-hdr');
  const cell = (k, id) => { const s = _el('span', 'mb-hcell'); s.appendChild(_el('span', 'mb-k', k)); const b = _el('b', null, ''); b.dataset.marshal = id; s.appendChild(b); hdr.appendChild(s); return b; };
  const hull = _el('span', 'mb-hcell');
  const hullK = _el('span', 'mb-k', '');
  const caseB = _el('b', null, '');
  caseB.dataset.marshal = 'case';
  hull.append(hullK, document.createTextNode(' CASE '), caseB);
  hdr.appendChild(hull);
  const approach = cell('APPROACH', 'approach');
  const brc = cell('BRC', 'brc');
  const fb = cell('FB', 'fb');
  const mar = _el('span', 'mb-hcell');
  mar.appendChild(_el('span', 'mb-k', 'MARSHAL '));
  const marPos = _el('b', null, ''); marPos.dataset.marshal = 'marshal-position'; mar.appendChild(marPos);
  mar.appendChild(_el('span', 'mb-k', ' DME'));
  hdr.appendChild(mar);
  const ramp = cell('RAMP', 'ramp');
  const delta = _el('button', 'mb-btn', 'Delta…');
  delta.type = 'button';
  delta.dataset.marshalAction = 'delta-open';
  hdr.appendChild(delta);
  const deltaForm = _el('span', 'mb-delta');
  deltaForm.hidden = true;
  const deltaIn = _el('input', 'mb-input');
  deltaIn.type = 'number'; deltaIn.min = '4'; deltaIn.step = '2'; deltaIn.value = '4';
  deltaIn.setAttribute('aria-label', 'Delta minutes');
  deltaIn.dataset.marshalInput = 'delta';
  const deltaGo = _el('button', 'mb-btn', 'Send');
  deltaGo.type = 'button'; deltaGo.dataset.marshalAction = 'delta-send';
  const deltaErr = _el('span', 'mb-delta-note');
  deltaErr.dataset.marshal = 'delta-note';
  deltaForm.append(_el('span', 'mb-k', 'DELTA '), deltaIn, _el('span', 'mb-k', ' min '), deltaGo, deltaErr);
  hdr.appendChild(deltaForm);
  const right = _el('span', 'mb-right');
  const clock = _el('b', null, ''); clock.dataset.marshal = 'clock';
  right.appendChild(clock);
  hdr.appendChild(right);
  _bodyEl.appendChild(hdr);

  const sections = { sequenced: _section('sequenced', 'CASE II / III', 'Case III picture'), caseI: _section('caseI', 'CASE I', 'Case I stack') };
  const empty = _el('div', 'mb-none', 'No flight in the recovery.');
  empty.dataset.marshal = 'none';
  const togo = _el('div', 'mb-togo');
  togo.append(_el('span', null, 'TO GO'));
  const togoN = _el('b', null, '0'); togoN.dataset.marshal = 'togo';
  togo.appendChild(togoN);
  _bodyEl.append(sections.sequenced.main, sections.caseI.main, empty, togo);

  _els = { hullK, caseB, approach, brc, fb, marPos, ramp, delta, deltaForm, deltaIn, deltaGo, deltaErr, clock, empty, togoN, sections };

  delta.addEventListener('click', () => {
    deltaForm.hidden = !deltaForm.hidden;
    deltaErr.textContent = '';
    if (!deltaForm.hidden) deltaIn.focus();
  });
  const sendDelta = () => {
    const minutes = Number(deltaIn.value);
    if (!Number.isInteger(minutes) || minutes < 4 || minutes % 2 !== 0) {
      deltaErr.textContent = 'even minutes, never less than 4';
      return;
    }
    deltaErr.textContent = '';
    if (_sendStackOp({ kind: 'Delta', minutes })) deltaForm.hidden = true;
  };
  deltaGo.addEventListener('click', sendDelta);
  deltaIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendDelta(); } else if (e.key === 'Escape') { deltaForm.hidden = true; }
  });
}

function _collect(view) {
  return buildBoard({ view, strips: getAllEfspStrips(), flightDataOf: getEfspFlightData, posOf: shipBearingRangeOf, now: missionNow() });
}

/** The row's button: its label (the Strip's NLA, the button being the status) and whether this controller may press it. */
function _actionOf(r) {
  const strip = r.stripId ? getEfspStrip(r.stripId) : null;
  const label = strip ? nlaButtonLabel(strip) : null;
  const inhibited = strip && strip.nla && strip.nla.inhibited;
  const mine = !!strip && getActingPositions('CARRIER').includes(strip.ownerPositionId);
  return { label, live: mine && !inhibited, title: inhibited || (mine ? '' : `${strip ? strip.ownerPositionId : '—'} has it`) };
}

/** The Marshal types FUEL, EAT, ANG and DME on the rows the Marshal holds (crc-sync docs/adr/0156); everyone else reads. */
function _marshalEdits(r, canSequence) { return canSequence && r.ownerPositionId === 'CV_MARSHAL' && _ownsStrip(r); }

function _rowSignature(r, m, ctx) {
  const a = _actionOf(r);
  return [r.flightDataId, r.seq, r.state, r.side, r.type, r.fuelLb, r.eatUtc, r.eatSet ? 1 : 0, r.angels, r.angelsSet ? 1 : 0,
    r.marshalDme, r.dmeSet ? 1 : 0, r.slot, r.late ? 1 : 0, m.angels ? 1 : 0, m.eat ? 1 : 0, ctx.canSequence ? 1 : 0, ctx.section,
    a.label, a.live ? 1 : 0, _marshalEdits(r, ctx.canSequence) ? 1 : 0].join('/');
}

/** A figure the Marshal may type over on a holding row it holds; plain text otherwise. `set` underlines an assigned value. */
function _figure(r, part, text, { set = false, chg = false, late = false, edit = null } = {}) {
  const span = _el('span', [chg ? 'mb-chg' : late ? 'mb-late' : '', set ? 'mb-eat-set' : ''].filter(Boolean).join(' '), text || '--');
  span.dataset.part = part;
  if (set) span.title = 'Assigned by the Marshal; clear it to use the slot\'s';
  if (edit) _editable(span, part, edit.value, edit.placeholder, edit.bad, edit.send);
  return span;
}

function _drawRow(r, m, ctx) {
  const { canSequence, section } = ctx;
  const tr = _el('tr', `mb-row mb-${r.kind}`);
  tr.dataset.flight = r.flightDataId;
  tr.dataset.kind = r.kind;
  tr.dataset.state = r.state;
  tr.dataset.seq = String(r.seq);
  tr.appendChild(_el('td', 'mb-seq', String(r.seq)));
  const side = _el('td', 'mb-side', r.side || '—');
  side.dataset.cell = 'side';
  tr.appendChild(side);
  tr.appendChild(_el('td', 'mb-type', r.type));
  const edits = _marshalEdits(r, canSequence) && r.kind === 'hold';
  const cell = (name, child) => { const td = _el('td', `mb-${name}`); td.dataset.cell = name; td.appendChild(child); tr.appendChild(td); };
  cell('fuel', _figure(r, 'fuel', fuelText(r.fuelLb), { edit: _marshalEdits(r, canSequence) ? {
    value: fuelText(r.fuelLb), placeholder: 'k lb', bad: 'the fuel in thousands of pounds (4.8), or empty to clear it', send: (t) => _sendFuel(r, t),
  } : null }));
  if (section === 'sequenced') {
    cell('eat', _figure(r, 'eat', eatMinuteText(r.eatUtc), { set: r.eatSet, chg: m.eat, late: r.late, edit: edits ? {
      value: r.eatUtc != null ? carrierHhmm(r.eatUtc) : '', placeholder: 'HHMM', bad: 'a Zulu time as HHMM, or empty for the slot\'s EAT',
      send: (t) => _sendOp(setEatOp(r, t)),
    } : null }));
  }
  cell('ang', _figure(r, 'angels', r.angels != null ? String(r.angels) : '', { set: r.angelsSet, chg: m.angels, edit: edits ? {
    value: r.angels != null ? String(r.angels) : '', placeholder: 'angels', bad: 'whole angels (6), or empty for the slot\'s',
    send: (t) => _sendOp(setAngelsOp(r, t)),
  } : null }));
  if (section === 'sequenced') {
    cell('dme', _figure(r, 'dme', r.marshalDme != null ? String(r.marshalDme) : '', { set: r.dmeSet, edit: edits ? {
      value: r.marshalDme != null ? String(r.marshalDme) : '', placeholder: 'DME', bad: 'a whole DME (21), or empty for the slot\'s',
      send: (t) => _sendOp(setDmeOp(r, t)),
    } : null }));
  }
  const act = _el('td', 'mb-act');
  const a = _actionOf(r);
  if (a.label) {
    const b = _el('button', a.live && r.next ? 'mb-commence' : 'mb-btn', a.label);
    b.type = 'button'; b.dataset.marshalAction = 'advance';
    b.disabled = !a.live;
    if (a.title) b.title = a.title;
    b.addEventListener('click', (e) => { e.stopPropagation(); _advance(r); });
    act.appendChild(b);
  }
  tr.appendChild(act);

  if (r.kind === 'hold') {
    // A click on a marked row says the new clearance was passed: the server clears the mark for every Marshal (ADR 0115).
    tr.addEventListener('click', (e) => {
      if (e.target.closest('input, button, [data-edit]')) return;
      const op = canSequence ? passClearanceOp(r, { enabled: _marksShown() }) : null;
      if (op) _sendStackOp(op);
    });
    if (canSequence && section === 'sequenced') _wireDrag(tr, r);
  }
  return tr;
}

function _sendOp(op) { return op ? _sendStackOp(op) : false; }

/**
 * An input in the board (crc-sync docs/adr/0137). Enter sends and leaves it; a figure `send` refuses (it returns false) stays,
 * marked, with what it takes in the tooltip. Escape, or leaving without a send, puts the shown figure back. Nothing here redraws
 * the table: leaving an input must not take the element the next click lands on, nor the input the focus is moving to.
 * `onLeave(input, sent)` runs when the focus goes.
 */
function _panelInput({ part, value, placeholder, className, label, size, bad, send, onLeave }) {
  const inp = _el('input', `mb-input ${className}`.trim());
  inp.type = 'text'; inp.size = size; inp.placeholder = placeholder; inp.value = value;
  if (label) inp.setAttribute('aria-label', label);
  inp.dataset.marshalInput = part;
  let sent = false;
  const unmark = () => { inp.classList.remove('mb-input-bad'); inp.removeAttribute('title'); };
  inp.addEventListener('click', (ev) => ev.stopPropagation());
  inp.addEventListener('input', () => { sent = false; unmark(); });
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (!send(inp.value)) { inp.classList.add('mb-input-bad'); inp.title = `Not sent: ${bad}`; return; }
      sent = true;
      inp.blur();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      sent = false;
      inp.blur();
    }
  });
  inp.addEventListener('blur', () => {
    if (!sent) inp.value = value;
    unmark();
    if (onLeave) onLeave(inp, sent);
  });
  return inp;
}

/** An EAT figure the Marshal may type over (crc-sync docs/adr/0137): a click turns it into an input, leaving it puts the figure back. */
function _editable(span, part, value, placeholder, bad, send) {
  span.classList.add('mb-edit');
  span.dataset.edit = part;
  span.addEventListener('click', (e) => {
    e.stopPropagation();
    const inp = _panelInput({
      part, value, placeholder, className: 'mb-fe-input', size: 4, bad, send,
      onLeave: (el, sent) => { if (el.isConnected) el.replaceWith(span); if (sent) _redrawRowOf(span); },
    });
    span.replaceWith(inp);
    inp.focus();
    inp.select();
  });
}

function _ownsStrip(row) {
  const strip = row.stripId ? getEfspStrip(row.stripId) : null;
  return !!strip && signedOnCarrierIds().includes(strip.ownerPositionId);
}

/** The fuel as the Strip's FUEL Block (C12), sent as the Strip's owner when this controller holds it. */
function _sendFuel(row, text) {
  const op = fuelBlockOp(text);
  const strip = row.stripId ? getEfspStrip(row.stripId) : null;
  if (!op || !strip || !_ownsStrip(row)) return false;
  sendEfspMutation(strip.ownerPositionId, strip, op);
  return true;
}

function _wireDrag(tr, r) {
  tr.draggable = true;
  tr.title = 'Drag onto another holding flight to re-sequence';
  // a press in one of the row's inputs selects text there; the row is dragged from anywhere else
  tr.addEventListener('mousedown', (e) => { tr.draggable = !e.target.closest('input'); });
  tr.addEventListener('dragstart', (e) => {
    _dragging = r.flightDataId;
    tr.classList.add('mb-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', r.flightDataId);
  });
  tr.addEventListener('dragend', () => { _dragging = null; tr.classList.remove('mb-dragging'); renderMarshal(); });
  tr.addEventListener('dragover', (e) => { if (_dragging && _dragging !== r.flightDataId) { e.preventDefault(); tr.classList.add('mb-over'); } });
  tr.addEventListener('dragleave', () => tr.classList.remove('mb-over'));
  tr.addEventListener('drop', (e) => {
    e.preventDefault();
    tr.classList.remove('mb-over');
    const dragged = _dragging;
    _dragging = null;
    if (!dragged || !_lastBoard) return;
    const toIndex = dropSlot(_lastBoard.sequenced, dragged, r.flightDataId);
    if (toIndex != null) _sendStackOp({ kind: 'Move', flightDataId: dragged, toIndex });
  });
}

function _drawVacancy(v, canSequence) {
  const tr = _el('tr', 'mb-row mb-vacant');
  tr.dataset.kind = 'vacant';
  tr.dataset.slot = String(v.slot);
  tr.appendChild(_el('td', 'mb-seq', ''));
  tr.appendChild(_el('td', 'mb-side', '—'));
  tr.appendChild(_el('td', 'mb-type', ''));
  tr.appendChild(_el('td', 'mb-fuel', ''));
  tr.appendChild(_el('td', 'mb-eat', 'vacant'));
  tr.appendChild(_el('td', 'mb-ang', v.angels != null ? String(v.angels) : ''));
  tr.appendChild(_el('td', 'mb-dme', v.marshalDme != null ? String(v.marshalDme) : ''));
  const act = _el('td', 'mb-act');
  if (canSequence) {
    const b = _el('button', 'mb-btn', 'Close up');
    b.type = 'button'; b.dataset.marshalAction = 'close-up';
    b.title = 'Everyone above this gap moves down one slot';
    b.addEventListener('click', () => _sendStackOp({ kind: 'CloseUp', fromIndex: v.slot }));
    act.appendChild(b);
  }
  tr.appendChild(act);
  return tr;
}

/** Marks the row holding `node` for a redraw on the next render (a sent figure is replaced by the server's, or put back). */
function _redrawRowOf(node) {
  for (const rows of Object.values(_tables)) {
    const row = rows.find((x) => x.tr.contains(node));
    if (row) row.sig = '';
  }
}

/**
 * The table, row by row: a row is redrawn only when something it shows changed, so a click is never lost to a redraw. A row that
 * holds the focused input, and the order while one does or a drag is on, wait for the next render once the input is left; every
 * other row stays live.
 */
function _syncTable(section, list, vacancies, shown, ctx) {
  const tbody = _els.sections[section].tbody;
  const current = _tables[section];
  const want = [];
  // a vacancy (a flight left and nobody closed up, decisions H28) is listed above the first holding row that sits over it
  const placed = new Set();
  for (const r of list) {
    if (r.kind === 'hold') {
      for (const v of vacancies) {
        if (!placed.has(v.slot) && v.slot < r.slot) {
          placed.add(v.slot);
          want.push({ key: `v:${v.slot}`, sig: ['v', v.slot, v.angels, ctx.canSequence ? 1 : 0].join('/'), draw: () => _drawVacancy(v, ctx.canSequence) });
        }
      }
    }
    const m = marksOf(r, shown);
    want.push({ key: `f:${r.flightDataId}`, sig: _rowSignature(r, m, ctx), draw: () => _drawRow(r, m, ctx) });
  }
  const active = document.activeElement;
  const typingIn = (tr) => !!active && active.tagName === 'INPUT' && tr.contains(active);
  const sameOrder = want.length === current.length && want.every((w, i) => w.key === current[i].key);
  if (!sameOrder) {
    if (_dragging || current.some((x) => typingIn(x.tr))) return;
    tbody.textContent = '';
    _tables[section] = want.map((w) => { const tr = w.draw(); tbody.appendChild(tr); return { key: w.key, sig: w.sig, tr }; });
    return;
  }
  if (_dragging) return;
  want.forEach((w, i) => {
    const cur = current[i];
    if (w.sig === cur.sig || typingIn(cur.tr)) return;
    const tr = w.draw();
    cur.tr.replaceWith(tr);
    current[i] = { key: w.key, sig: w.sig, tr };
  });
}

/** Draws the panel from the hull view and the Strips. Cheap; called on every carrier or Board change and once a second. */
export function renderMarshal() {
  if (!_bodyEl) return;
  const view = getEfspCarrier();
  const st = carrierStateOf(view);
  _emptyEl.hidden = !!st;
  _bodyEl.hidden = !st;
  if (!st) return;
  if (!_els) _build();

  const caseValue = view.recoveryCase ? view.recoveryCase.value : null;
  const canSequence = _canSequence();
  const board = _collect(view);
  _lastBoard = board;
  const shown = { enabled: _marksShown() };

  // header (cheap text, set every time)
  _els.hullK.textContent = view.hullId;
  _els.caseB.textContent = caseValue || '—';
  _els.approach.textContent = _approachText() || '—';
  _els.brc.textContent = st.brc.value != null ? carrierBearingText(st.brc.display) : '—';
  _els.fb.textContent = st.finalBearing.value != null ? carrierBearingText(st.finalBearing.display) : '—';
  const holdFixes = board.sequenced.filter((r) => r.kind === 'hold' && r.marshalDme != null).map((r) => r.marshalDme);
  const first = st.firstFix && st.firstFix.value != null ? st.firstFix.value : null;
  const top = Math.max(first ?? 0, ...holdFixes);
  _els.marPos.textContent = st.radial.value != null
    ? `${carrierBearingText(st.radial.display)} ${first == null ? '—' : (top > first ? `${first}–${top}` : String(first))}`
    : '—';
  _els.ramp.textContent = st.rampTime.value != null ? `${carrierHhmm(st.rampTime.value)}Z` : '—';
  _els.clock.textContent = clockText(missionNow());
  const hasSequenced = board.sequenced.length > 0;
  const showSequenced = hasSequenced || caseValue !== 'I'; // the Case II/III section is shown while it has flights or is the ship's Case
  _els.delta.hidden = !(canSequence && showSequenced);
  if (!(canSequence && showSequenced)) _els.deltaForm.hidden = true;
  _els.togoN.textContent = String(board.toGo);
  _els.empty.hidden = board.rows.length > 0;

  // A section is shown while it has flights, and the one of the ship's Case always (a flight keeps the Case it was given,
  // so a Case I flight finishes in its own table after the ship goes to Case III).
  const S = _els.sections;
  S.sequenced.main.hidden = !showSequenced;
  S.caseI.main.hidden = !(board.caseI.length > 0 || caseValue === 'I');
  _syncTable('sequenced', board.sequenced, board.vacancies, shown, { canSequence, section: 'sequenced' });
  _syncTable('caseI', board.caseI, [], shown, { canSequence, section: 'caseI' });

  if (!S.sequenced.main.hidden) {
    const model = pictureModel(board.sequenced, {
      firstFix: first == null ? 21 : first,
      radialText: st.radial.value != null ? carrierBearingText(st.radial.display) : '',
    });
    const psig = JSON.stringify(model);
    if (psig !== S.sequenced.sig) { S.sequenced.sig = psig; renderMarshalPicture(S.sequenced.svg, model); }
  }
  if (!S.caseI.main.hidden) {
    const model = circleModel(board.caseI, { brcDeg: st.brc && st.brc.ref !== 'GRID' && Number.isFinite(st.brc.value) ? st.brc.value : null });
    const csig = JSON.stringify(model);
    if (csig !== S.caseI.sig) { S.caseI.sig = csig; renderMarshalCircle(S.caseI.svg, model); }
  }
}

export function initMarshalPanel() {
  _emptyEl = document.getElementById('marshal-empty');
  _bodyEl = document.getElementById('marshal-body');
  _els = null;
  _tables.sequenced = [];
  _tables.caseI = [];
  renderMarshal();
  if (!_timer) {
    // the clock and "past EAT" move without any frame: a light redraw once a second, only while the panel is in the document
    _timer = setInterval(() => { if (_bodyEl && _bodyEl.isConnected) renderMarshal(); }, 1000);
  }
  return { onShow: () => renderMarshal() };
}

onEfspChanged(['snapshot', 'board', 'bays', 'positions', 'ack'], () => renderMarshal());
// the scope redraws as tracks move (a flight's DME changes the order and the picture): at most four times a second
let _scopeAt = 0;
onEfspChanged('scope', () => {
  const t = Date.now();
  if (t - _scopeAt < 250) return;
  _scopeAt = t;
  renderMarshal();
});
