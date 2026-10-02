'use strict';
// The Strip menu's "Split…" form and "Join formation…" picker (crc-sync docs/adr/0099).
// Validation is formation-rules.js's; the server gates again and a refusal lands in the usual refusal banner.
import { getAllEfspStrips, getEfspFlightData } from '../../efsp-state.js';
import { sendEfspMutation } from '../../efsp-ws.js';
import { _mountPopover, _unmountPopover } from '../popover-portal.js';
import { _resolveActingPositionId } from '../../bay-view.js';
import {
  ASSIGNMENT_KINDS, ASSIGNMENT_LABELS, buildJoinOp, buildSplitOp, isGroundFormationState, joinLeadCandidates,
  parseAssignmentValue, splitRemainderText,
} from '../../formation-rules.js';

let _openFormationPopoverEl = null;

function _closeFormationPopover() {
  _unmountPopover(_openFormationPopoverEl);
  _openFormationPopoverEl = null;
  document.removeEventListener('pointerdown', _onDocPointerDownCloseFormationPopover, true);
}

// Tests the target, for the reason spelled out on _onDocPointerDownCloseBindPopover (bind.js).
function _onDocPointerDownCloseFormationPopover(e) {
  if (_openFormationPopoverEl && !_openFormationPopoverEl.contains(e.target)) _closeFormationPopover();
}

function _el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function _callsignOf(strip) {
  const fd = getEfspFlightData(strip.flightDataId);
  return (fd && fd.identity && fd.identity.callsign) || strip.flightDataId;
}

/** Sends one formation op on `strip` as its owner; false when no Position is signed on to act. */
export function dispatchFormationOp(strip, op) {
  const acting = _resolveActingPositionId(strip);
  if (!acting) return false;
  sendEfspMutation(acting, strip, op);
  return true;
}

function _mount(popover, strip, anchorEl) {
  _openFormationPopoverEl = popover;
  _mountPopover(popover, anchorEl, strip, _closeFormationPopover);
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseFormationPopover, true), 0);
}

/** The Split form: Leaving [k], Callsign, Assignment (hidden on a ground Strip), Back from MARSA, Split. */
export function _openSplitPopover(strip, anchorEl) {
  _closeFormationPopover();
  const flightData = getEfspFlightData(strip.flightDataId);
  const n = flightData.identity.flightSize;
  const ground = isGroundFormationState(strip);

  const popover = _el('div', 'efsp-coordinate-popover efsp-formation-popover');
  popover.dataset.formation = 'split';
  popover.addEventListener('pointerdown', (e) => e.stopPropagation());

  const leavingRow = _el('div', 'efsp-formation-row');
  leavingRow.appendChild(_el('label', 'efsp-formation-label', 'Leaving'));
  const size = _el('input', 'efsp-coordinate-note efsp-formation-size');
  size.type = 'number'; size.min = '1'; size.max = String(n - 1); size.value = '1';
  size.setAttribute('aria-label', 'aircraft leaving');
  const remainder = _el('span', 'efsp-formation-remainder', splitRemainderText(1, n));
  size.addEventListener('input', () => { remainder.textContent = splitRemainderText(Number(size.value) || 0, n); });
  leavingRow.append(size, remainder);
  popover.appendChild(leavingRow);

  const callsign = _el('input', 'efsp-coordinate-note efsp-formation-callsign');
  callsign.placeholder = 'callsign of the departing part';
  callsign.setAttribute('aria-label', 'callsign');
  callsign.addEventListener('input', () => { callsign.value = callsign.value.toUpperCase(); });
  popover.appendChild(callsign);

  let value = null;
  const kindInputs = [];
  if (!ground) {
    const row = _el('div', 'efsp-formation-row efsp-formation-assignment');
    row.appendChild(_el('span', 'efsp-formation-label', 'Assignment'));
    for (const kind of ASSIGNMENT_KINDS) {
      const label = _el('label', 'efsp-formation-kind');
      const radio = _el('input');
      radio.type = 'radio'; radio.name = 'efsp-formation-kind'; radio.value = kind;
      radio.checked = kind === 'HEADING';
      kindInputs.push(radio);
      label.append(radio, document.createTextNode(` ${ASSIGNMENT_LABELS[kind]}`));
      row.appendChild(label);
    }
    popover.appendChild(row);
    value = _el('input', 'efsp-coordinate-note efsp-formation-value');
    value.placeholder = '270 / 250 or M.80 / FL240';
    value.setAttribute('aria-label', 'assignment value');
    popover.appendChild(value);
  }

  const marsaLabel = _el('label', 'efsp-formation-marsa');
  const marsa = _el('input');
  marsa.type = 'checkbox';
  marsaLabel.append(marsa, document.createTextNode(' Back from MARSA'));
  marsaLabel.title = 'recorded as a return from MARSA; the assignment is still required';
  popover.appendChild(marsaLabel);

  const error = _el('div', 'efsp-coordinate-degraded-warning efsp-formation-error');
  error.setAttribute('role', 'alert');
  popover.appendChild(error);

  const send = _el('button', 'efsp-coordinate-send-btn efsp-formation-send', 'Split');
  const submit = () => {
    let assignment = null;
    if (!ground) {
      const kind = (kindInputs.find(r => r.checked) || {}).value;
      if (value.value.trim() !== '') {
        assignment = parseAssignmentValue(kind, value.value);
        if (!assignment) { error.textContent = `${value.value.trim()} is not a ${ASSIGNMENT_LABELS[kind].toLowerCase()}`; return; }
      }
    }
    const built = buildSplitOp({ size: Number(size.value), callsign: callsign.value, assignment, marsaReturn: marsa.checked },
      { strip, flightData });
    if (!built.ok) { error.textContent = built.error; return; }
    error.textContent = '';
    if (dispatchFormationOp(strip, built.op)) _closeFormationPopover();
    else error.textContent = 'sign on to the Position that holds this Strip first';
  };
  send.addEventListener('click', (e) => { e.stopPropagation(); submit(); });
  popover.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  popover.appendChild(send);

  _mount(popover, strip, anchorEl);
}

/** The Join picker: this Position's other live Strips (callsign, size); one click sends. Undo covers a mistake. */
export function _openJoinPopover(strip, anchorEl) {
  _closeFormationPopover();
  const popover = _el('div', 'efsp-coordinate-popover efsp-formation-popover');
  popover.dataset.formation = 'join';
  popover.addEventListener('pointerdown', (e) => e.stopPropagation());
  popover.appendChild(_el('div', 'efsp-formation-heading', `${_callsignOf(strip)} joins …`));

  const leads = joinLeadCandidates(strip, getAllEfspStrips());
  if (leads.length === 0) popover.appendChild(_el('div', 'efsp-coordinate-degraded-warning', 'no other Strip of yours to join'));
  for (const lead of leads) {
    const fd = getEfspFlightData(lead.flightDataId);
    const size = fd && fd.identity ? fd.identity.flightSize : 1;
    const row = _el('button', 'efsp-coordinate-submit efsp-formation-lead', `${_callsignOf(lead)} (${size})`);
    row.dataset.leadStripId = lead.stripId;
    row.title = `${lead.stripType} ${String(lead.state).replace(/_/g, ' ')}`;
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      _closeFormationPopover();
      dispatchFormationOp(strip, buildJoinOp(lead));
    });
    popover.appendChild(row);
  }
  _mount(popover, strip, anchorEl);
}
