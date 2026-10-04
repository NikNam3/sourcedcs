'use strict';
// The ControlRelease forms and the one-click HANDOFF steps (crc-sync docs/adr/0101). Rules: control-release-rules.js.
// The server gates again; a refusal lands in the usual banner.
import { getEfspStrip } from '../../efsp-state.js';
import { sendEfspMutation } from '../../efsp-ws.js';
import { _resolveActingPositionId } from '../../bay-view.js';
import { openPopover, _sendFromPopover } from '../popover-portal.js';
import { missionNow } from '../../../topbar.js';
import {
  RELEASE_SCOPES, RELEASE_SCOPE_LABELS, buildGrantOp, buildRefuseOp, buildRequestOp, buildStepOp, handoffPositions,
} from '../../control-release-rules.js';

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

/** The one-click steps: Comms to X, Control to X, Withdraw release. */
export function _dispatchHandoffStep(strip, key) { return _dispatchHandoffOp(strip, buildStepOp(key)); }

function _scopeBoxes(popover, form) {
  const row = _el('div', 'efsp-formation-row efsp-release-scopes');
  const boxes = {};
  for (const scope of RELEASE_SCOPES) {
    const label = _el('label', 'efsp-formation-kind');
    const box = _el('input');
    box.type = 'checkbox'; box.value = scope; box.dataset.scope = scope;
    boxes[scope] = box;
    label.append(box, document.createTextNode(` ${RELEASE_SCOPE_LABELS[scope]}`));
    row.appendChild(label);
  }
  // FULL says everything: the others go quiet while it is ticked.
  const sync = () => {
    const full = boxes.FULL.checked;
    for (const s of ['TURNS', 'CLIMB', 'DESCENT']) { boxes[s].disabled = full; if (full) boxes[s].checked = false; }
    if (form.onScopes) form.onScopes(full, boxes);
  };
  for (const s of RELEASE_SCOPES) boxes[s].addEventListener('change', sync);
  popover.appendChild(row);
  return { boxes, sync, selected: () => RELEASE_SCOPES.filter(s => boxes[s].checked) };
}

/** `form` is 'release' (GRANT), 'request' or 'refuse'. */
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
    popover.appendChild(_el('div', 'efsp-formation-heading',
      form === 'release' ? `ControlRelease to ${p.receiving}` : `Request ControlRelease from ${p.transferring}`));
    const climb = _el('input', 'efsp-coordinate-note efsp-release-climb');
    climb.placeholder = 'climb up to (ft)'; climb.setAttribute('aria-label', 'climb limit');
    const descent = _el('input', 'efsp-coordinate-note efsp-release-descent');
    descent.placeholder = 'descend down to (ft)'; descent.setAttribute('aria-label', 'descent limit');
    const scopes = _scopeBoxes(popover, {
      onScopes: (full, boxes) => {
        climb.hidden = full || !boxes.CLIMB.checked || form !== 'release';
        descent.hidden = full || !boxes.DESCENT.checked || form !== 'release';
      },
    });
    popover.append(climb, descent);
    scopes.sync();
    let condition = null; let effective = null; let note = null;
    if (form === 'release') {
      condition = _el('input', 'efsp-coordinate-note efsp-release-condition');
      condition.placeholder = 'condition (optional), e.g. after passing the DME';
      condition.setAttribute('aria-label', 'condition');
      effective = _el('input', 'efsp-coordinate-note efsp-release-effective');
      effective.placeholder = 'effective at HHMM Z (optional)';
      effective.setAttribute('aria-label', 'effective at');
      popover.append(condition, effective);
    } else {
      note = _el('input', 'efsp-coordinate-note efsp-release-note');
      note.placeholder = 'note (optional)';
      note.setAttribute('aria-label', 'note');
      popover.appendChild(note);
    }
    build = () => (form === 'release'
      ? buildGrantOp({ scopes: scopes.selected(), climbLimit: climb.value, descentLimit: descent.value, condition: condition.value, effectiveAt: effective.value }, missionNow())
      : buildRequestOp({ scopes: scopes.selected(), note: note.value }));
  }
  popover.appendChild(error);

  const send = _el('button', 'efsp-coordinate-send-btn efsp-release-send', form === 'release' ? 'Release' : form === 'request' ? 'Request' : 'Unable');
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
