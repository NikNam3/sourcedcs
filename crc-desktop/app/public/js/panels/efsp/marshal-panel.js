'use strict';
import { missionNow } from '../../mission-clock.js';
import { registerSettingsTab, getSetting } from '../../settings-registry.js';
import { carrierBearingText, carrierHhmm, carrierStateOf, getEfspCarrier } from './carrier-state.js';
import { carrierActingFor, sendCarrier, signedOnCarrierIds } from './carrier-send.js';
import { carrierDistanceNm } from './carrier-final-distance.js';
import { getAllEfspStrips, getEfspFlightData, getEfspPosition, getEfspPositionLetter, getEfspStrip } from './efsp-state.js';
import { sendEfspMutation } from './efsp-ws.js';
import { onEfspChanged } from './efsp-change-bus.js';
import {
  buildBoard, clockText, dropSlot, eatMinuteText, fuelText, marksOf, passClearanceOp
} from './marshal-board-model.js';
import { pictureModel, renderMarshalPicture } from './marshal-picture.js';

// The MARSHAL panel: the recovery board (crc-sync docs/adr/0114; mockup docs/mockups/marshal-stack-panel.html, revision 7). Every
// recovering aircraft in landing order, next to land at the top, beside the Case III picture. An ordinary dockable panel.
//
// Dark cockpit (memory feedback_dark_cockpit_ui): grey while the recovery is in order. Amber is "look at this now": fuel within the
// margin of bingo, a flight past its EAT that has not pushed, an angels or EAT changed and not yet passed. Red is fuel at or below
// bingo. The one blue button is the action due, Commence on the next flight to push. Nothing here tells the Marshal what to do, there
// is no countdown, no checklist, no required call; everything is named by the side number, never a callsign.
//
// Who can do what: the Marshal (CV_MARSHAL) drags a HOLD row to re-sequence, Commences, sends a commenced flight Back to stack, sends
// a Delta and closes up a vacancy; every other carrier Position reads. The ramp time, the marshal radial and the first fix are the
// ship's and are typed in the carrier panel; here they are shown. No arithmetic of the recovery is done here: angels, DME and the
// EATs are the server's (hull view), see marshal-board-model.js.

registerSettingsTab('marshal', [
  { key: 'marshalLowStateMarginKlb', type: 'number', label: 'Low-state margin above bingo', unit: 'k lb', default: 1.0, min: 0, max: 5, step: 0.1, onChange: () => renderMarshal() },
  { key: 'marshalMarkChanged', type: 'toggle', label: 'Mark changed clearances until passed', default: true, onChange: () => renderMarshal() },
], { label: 'Marshal' });

let _emptyEl = null;
let _bodyEl = null;
let _els = null;
let _tableSig = '';
let _pictureSig = '';
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

function _commence(row) {
  const strip = row.stripId ? getEfspStrip(row.stripId) : null;
  if (strip) sendEfspMutation('CV_MARSHAL', strip, { kind: 'InvokeNla' });
}

function _backToStack(row) {
  const strip = row.stripId ? getEfspStrip(row.stripId) : null;
  if (strip) sendEfspMutation('CV_MARSHAL', strip, { kind: 'CarrierHandoff', transfer: 'COMMENCED_TO_MARSHAL' });
}

function _build() {
  _bodyEl.textContent = '';
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

  const main = _el('div', 'mb-main');
  const tableCol = _el('div', 'mb-tablecol');
  const wrap = _el('div', 'mb-tw');
  const table = _el('table', 'mb-table');
  table.dataset.marshal = 'board';
  const thead = _el('thead');
  const hr = _el('tr');
  for (const h of ['SEQ', 'SIDE', 'TYPE', 'FUEL:EAT', 'ANG', 'STATUS', '']) hr.appendChild(_el('th', null, h));
  thead.appendChild(hr);
  const tbody = _el('tbody');
  table.append(thead, tbody);
  wrap.appendChild(table);
  const empty = _el('div', 'mb-none', 'No flight in the recovery.');
  empty.dataset.marshal = 'none';
  tableCol.append(wrap, empty);
  const togo = _el('div', 'mb-togo');
  togo.append(_el('span', null, 'TO GO'));
  const togoN = _el('b', null, '0'); togoN.dataset.marshal = 'togo';
  togo.appendChild(togoN);
  tableCol.appendChild(togo);
  const picCol = _el('div', 'mb-patcol');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'mb-picture');
  svg.setAttribute('viewBox', '0 0 360 640');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Case III picture');
  svg.dataset.marshal = 'picture';
  picCol.appendChild(svg);
  main.append(tableCol, picCol);
  _bodyEl.appendChild(main);

  _els = { hullK, caseB, approach, brc, fb, marPos, ramp, delta, deltaForm, deltaIn, deltaGo, deltaErr, clock, tbody, empty, togoN, svg, picCol };

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
  const now = missionNow();
  const margin = getSetting('marshalLowStateMarginKlb');
  return buildBoard({
    view, strips: getAllEfspStrips(), flightDataOf: getEfspFlightData, dmeOf: carrierDistanceNm, now,
    marginKlb: Number.isFinite(margin) ? margin : 1.0,
  });
}

function _rowSignature(r, m, canSequence) {
  return [r.flightDataId, r.seq, r.kind, r.status, r.side, r.callsign, r.type, r.fuelLb, r.fuelLevel, r.eatUtc, r.angels, r.slot,
    r.late ? 1 : 0, r.next ? 1 : 0, m.angels ? 1 : 0, m.eat ? 1 : 0, canSequence ? 1 : 0].join('/');
}

function _drawRow(r, m, { canSequence, caseValue, sequenced }) {
  const tr = _el('tr', `mb-row mb-${r.kind}`);
  tr.dataset.flight = r.flightDataId;
  tr.dataset.kind = r.kind;
  tr.dataset.seq = String(r.seq);
  tr.appendChild(_el('td', 'mb-seq', String(r.seq)));
  const side = _el('td', `mb-side${r.sideMissing ? ' mb-side-missing' : ''}`, r.side || r.callsign || '—');
  if (r.sideMissing) side.title = 'No side number typed yet; the callsign is shown';
  side.dataset.cell = 'side';
  tr.appendChild(side);
  tr.appendChild(_el('td', 'mb-type', r.type));
  const fe = _el('td', 'mb-fe');
  fe.dataset.cell = 'fuel-eat';
  const fuel = _el('span', r.fuelLevel ? `mb-fuel-${r.fuelLevel}` : '', fuelText(r.fuelLb) || '--');
  fuel.dataset.part = 'fuel';
  const eat = _el('span', m.eat ? 'mb-chg' : r.late ? 'mb-late' : '', eatMinuteText(r.eatUtc) || '--');
  eat.dataset.part = 'eat';
  fe.append(fuel, document.createTextNode(':'), eat);
  tr.appendChild(fe);
  const ang = _el('td', `mb-ang${m.angels ? ' mb-chg' : ''}`);
  ang.dataset.cell = 'ang';
  if (!sequenced && r.inStack && canSequence) {
    // Case I: the stack is a list of squadron-assigned altitudes, not a timed stack (guide 9.12 rule 3); the Marshal types the angels.
    const inp = _el('input', 'mb-input mb-ang-input');
    inp.type = 'text'; inp.size = 3; inp.placeholder = r.angels != null ? String(r.angels) : 'angels';
    inp.value = r.angels != null ? String(r.angels) : '';
    inp.dataset.marshalInput = 'angels';
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const raw = inp.value.trim();
        _sendStackOp({ kind: 'SetCaseIAngels', flightDataId: r.flightDataId, caseIAngels: raw === '' ? null : Number(raw) });
      }
    });
    ang.appendChild(inp);
  } else {
    ang.textContent = r.angels != null ? String(r.angels) : '';
  }
  tr.appendChild(ang);
  const st = _el('td', 'mb-st', r.status);
  st.dataset.cell = 'status';
  tr.appendChild(st);
  const act = _el('td', 'mb-act');
  if (canSequence && sequenced) {
    if (r.next && r.kind === 'hold') {
      const b = _el('button', 'mb-commence', 'Commence');
      b.type = 'button'; b.dataset.marshalAction = 'commence';
      b.addEventListener('click', (e) => { e.stopPropagation(); _commence(r); });
      act.appendChild(b);
    }
    if (r.kind === 'comm') {
      const b = _el('button', 'mb-btn', 'Back to stack');
      b.type = 'button'; b.dataset.marshalAction = 'back-to-stack';
      b.addEventListener('click', (e) => { e.stopPropagation(); _backToStack(r); });
      act.appendChild(b);
    }
  }
  tr.appendChild(act);

  if (r.kind === 'hold') {
    // A click on a marked row says the new clearance was passed: the server clears the mark for every Marshal (ADR 0115).
    tr.addEventListener('click', (e) => {
      if (e.target.closest('input, button')) return;
      const op = canSequence ? passClearanceOp(r, { enabled: _marksShown() }) : null;
      if (op) _sendStackOp(op);
    });
    if (canSequence) _wireDrag(tr, r);
  }
  return tr;
}

function _wireDrag(tr, r) {
  tr.draggable = true;
  tr.title = 'Drag onto another holding flight to re-sequence';
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
    const toIndex = dropSlot(_lastBoard.rows, dragged, r.flightDataId);
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
  tr.appendChild(_el('td', 'mb-fe', ''));
  tr.appendChild(_el('td', 'mb-ang', v.angels != null ? String(v.angels) : ''));
  tr.appendChild(_el('td', 'mb-st', 'vacant'));
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
  const sequenced = caseValue === 'II' || caseValue === 'III';
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
  const holdFixes = board.rows.filter((r) => r.kind === 'hold' && r.marshalDme != null).map((r) => r.marshalDme);
  const first = st.firstFix && st.firstFix.value != null ? st.firstFix.value : null;
  const top = Math.max(first ?? 0, ...holdFixes);
  _els.marPos.textContent = st.radial.value != null
    ? `${carrierBearingText(st.radial.display)} ${first == null ? '—' : (top > first ? `${first}–${top}` : String(first))}`
    : '—';
  _els.ramp.textContent = st.rampTime.value != null ? `${carrierHhmm(st.rampTime.value)}Z` : '—';
  _els.clock.textContent = clockText(missionNow());
  _els.delta.hidden = !(canSequence && sequenced);
  if (!(canSequence && sequenced)) _els.deltaForm.hidden = true;
  _els.togoN.textContent = String(board.toGo);
  _els.empty.hidden = board.rows.length > 0;

  // the table: rebuilt only when something it shows changed, so a click is never lost to a redraw
  const ctx = { canSequence, caseValue, sequenced };
  const sig = [caseValue, canSequence ? 1 : 0, board.rows.map((r) => _rowSignature(r, marksOf(r, shown), canSequence)).join('|'),
    board.vacancies.map((v) => v.slot).join(',')].join('#');
  const typing = _els.tbody.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
  if (sig !== _tableSig && !_dragging && !typing) {
    _tableSig = sig;
    _els.tbody.textContent = '';
    // a vacancy (a flight left and nobody closed up, decisions H28) is listed above the first holding row that sits over it
    const placed = new Set();
    for (const r of board.rows) {
      if (r.kind === 'hold') {
        for (const v of board.vacancies) {
          if (!placed.has(v.slot) && v.slot < r.slot) { placed.add(v.slot); _els.tbody.appendChild(_drawVacancy(v, canSequence)); }
        }
      }
      _els.tbody.appendChild(_drawRow(r, marksOf(r, shown), ctx));
    }
  }

  // the picture
  _els.picCol.hidden = !sequenced;
  if (sequenced) {
    const model = pictureModel(board.rows, {
      firstFix: first == null ? 21 : first,
      radialText: st.radial.value != null ? carrierBearingText(st.radial.display) : '',
    });
    const psig = JSON.stringify(model);
    if (psig !== _pictureSig) { _pictureSig = psig; renderMarshalPicture(_els.svg, model); }
  }
}

export function initMarshalPanel() {
  _emptyEl = document.getElementById('marshal-empty');
  _bodyEl = document.getElementById('marshal-body');
  _els = null;
  _tableSig = '';
  _pictureSig = '';
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
