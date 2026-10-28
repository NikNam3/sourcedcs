'use strict';
// The release forms and the one-click HANDOFF steps (crc-sync docs/adr/0122). Rules: control-release-rules.js.
// The server gates again; a refusal lands in the usual banner.
import { getEfspStrip } from '../../efsp-state.js';
import { sendEfspMutation } from '../../efsp-ws.js';
import { _resolveActingPositionId } from '../dispatch.js';
import { openPopover, _sendFromPopover } from '../popover-portal.js';
import { buildRefuseOp, buildRequestOp, buildStepOp, handoffPositions } from '../../control-release-rules.js';

let _openPopoverHandle = null;

function _close() { if (_openPopoverHandle) _openPopoverHandle.close(); }

function _el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Sends one HANDOFF step as the Position the controller acts as on the Strip (re-read at dispatch, F-107). */
export function _dispatchHandoffOp(strip, op, { onAck } = {}) {
  strip = getEfspStrip(strip.stripId) || strip;
  const acting = _resolveActingPositionId(strip);
  if (!acting) return false;
  sendEfspMutation(acting, strip, op, { onAck });
  return true;
}

/** The one-click steps: Checked in, Release. */
export function _dispatchHandoffStep(strip, key) { return _dispatchHandoffOp(strip, buildStepOp(key)); }

/** `form` is 'request' (the receiver asks for a release, an optional note) or 'refuse' (the handing-off station's Unable). */
export function _openControlReleasePopover(strip, anchorEl, form) {
  _close();
  const p = handoffPositions(strip);
  const popover = _el('div', 'efsp-coordinate-popover efsp-formation-popover efsp-release-popover');
  popover.dataset.release = form;
  const error = _el('div', 'efsp-coordinate-degraded-warning efsp-formation-error');
  error.setAttribute('role', 'alert');
  let build;

  if (form === 'refuse') {
    popover.appendChild(_el('div', 'efsp-formation-heading', `Unable — ${p.receiving}'s release request`));
    const reason = _el('input', 'efsp-coordinate-note efsp-release-reason');
    reason.placeholder = 'reason (optional)';
    reason.setAttribute('aria-label', 'reason');
    popover.appendChild(reason);
    build = () => ({ op: buildRefuseOp(reason.value) });
  } else {
    popover.appendChild(_el('div', 'efsp-formation-heading', `Request release from ${p.transferring}`));
    const note = _el('input', 'efsp-coordinate-note efsp-release-note');
    note.placeholder = 'note (optional)';
    note.setAttribute('aria-label', 'note');
    popover.appendChild(note);
    build = () => buildRequestOp({ note: note.value });
  }
  popover.appendChild(error);

  const send = _el('button', 'efsp-coordinate-send-btn efsp-release-send', form === 'request' ? 'Request' : 'Unable');
  const submit = () => {
    const built = build();
    if (built.error) { error.textContent = built.error; return; }
    error.textContent = '';
    if (!_sendFromPopover(popover, send, (onAck) => _dispatchHandoffOp(strip, built.op, { onAck }))) error.textContent = 'sign on to the Position that holds this Strip first';
  };
  send.addEventListener('click', (e) => { e.stopPropagation(); submit(); });
  popover.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  popover.appendChild(send);

  _openPopoverHandle = openPopover({ el: popover, anchor: anchorEl, strip, onClose: () => { _openPopoverHandle = null; } });
}
