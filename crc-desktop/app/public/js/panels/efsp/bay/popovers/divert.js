'use strict';
// The Strip menu's "Divert…" form (crc-sync docs/adr/0111). The fields are divert-rules.js's; the server gates again and a
// refusal lands in the usual refusal banner. The 10 s Undo is the usual one.
import { sendEfspMutation } from '../../efsp-ws.js';
import { openPopover, _sendFromPopover } from '../popover-portal.js';
import { _resolveActingPositionId } from '../dispatch.js';
import { DIVERT_FIELDS, buildDivertOp } from '../../divert-rules.js';

let _openPopoverHandle = null;

function _el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Sends one Divert on `strip` as its owner; false when no Position is signed on to act. */
export function dispatchDivert(strip, op, { onAck } = {}) {
  const acting = _resolveActingPositionId(strip);
  if (!acting) return false;
  sendEfspMutation(acting, strip, op, { onAck });
  return true;
}

/** The Divert form: one input per clearance field, then Divert. */
export function _openDivertPopover(strip, anchorEl) {
  if (_openPopoverHandle) _openPopoverHandle.close();
  const popover = _el('div', 'efsp-coordinate-popover efsp-divert-popover');
  popover.dataset.divert = 'form';

  const inputs = {};
  for (const f of DIVERT_FIELDS) {
    const row = _el('label', 'efsp-divert-row');
    row.appendChild(_el('span', 'efsp-divert-label', f.label));
    const input = _el('input', 'efsp-coordinate-note efsp-divert-input');
    input.placeholder = f.placeholder;
    input.dataset.divertField = f.key;
    input.setAttribute('aria-label', f.label);
    input.addEventListener('input', () => { input.value = input.value.toUpperCase(); });
    inputs[f.key] = input;
    row.appendChild(input);
    popover.appendChild(row);
  }

  const error = _el('div', 'efsp-coordinate-degraded-warning efsp-divert-error');
  error.setAttribute('role', 'alert');
  popover.appendChild(error);

  const send = _el('button', 'efsp-coordinate-send-btn efsp-divert-send', 'Divert');
  const submit = () => {
    const values = {};
    for (const f of DIVERT_FIELDS) values[f.key] = inputs[f.key].value;
    const built = buildDivertOp(values);
    if (!built.ok) { error.textContent = built.error; return; }
    error.textContent = '';
    if (!_sendFromPopover(popover, send, (onAck) => dispatchDivert(strip, built.op, { onAck }))) error.textContent = 'sign on to the Position that holds this Strip first';
  };
  send.addEventListener('click', (e) => { e.stopPropagation(); submit(); });
  popover.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  popover.appendChild(send);

  _openPopoverHandle = openPopover({ el: popover, anchor: anchorEl, strip, onClose: () => { _openPopoverHandle = null; } });
  inputs.destination.focus();
}
