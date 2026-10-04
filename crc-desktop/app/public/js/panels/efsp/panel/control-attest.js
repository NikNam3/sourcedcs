'use strict';
import { _controlAttestEl } from './state.js';
import { getEfspStrip } from '../efsp-state.js';
import { sendEfspMutation } from '../efsp-ws.js';
import { attestationRequest } from '../control-release-rules.js';

// docs/adr/0101 (CR-C): a control instruction (a heading or an altitude) written while the flight is still under the
// other Facility's control comes back from the server refused with a structured `attestation: {with, needs}` asking for "coordinated with". That is an
// attestation, not a hard refusal (H100 DR-1 b): this line asks the controller, says who, and re-sends the same write
// with `coordinatedWith`. Nothing is re-sent without the click.

let _open = null; // { op, stripId, actingPositionId, facilityId, with, needs }

export function getControlAttestation() { return _open; }

/**
 * An efsp-mutation-ack came back refused. True when it was the attestation request (the caller then skips the red
 * banner), false for every other refusal.
 */
export function noteAttestationRefusal(result) {
  const pending = result.pending;
  const op = pending && pending.op;
  const req = attestationRequest(result.attestation, op);
  if (!req) return false;
  _open = { op, stripId: pending.stripId, actingPositionId: pending.actingPositionId, facilityId: pending.facilityId, with: req.with, needs: req.needs };
  _render();
  return true;
}

export function dismissControlAttestation() { _open = null; _render(); }

/** "Coordinated with CTR": re-send the held write with the attestation. */
export function confirmControlAttestation() {
  const held = _open;
  if (!held) return false;
  _open = null;
  _render();
  const strip = getEfspStrip(held.stripId);
  if (!strip) return false;
  sendEfspMutation(held.actingPositionId, strip, { ...held.op, coordinatedWith: held.with });
  return true;
}

function _render() {
  const el = _controlAttestEl;
  if (!el) return;
  el.replaceChildren();
  if (!_open) { el.hidden = true; return; }
  el.hidden = false;
  const text = document.createElement('span');
  text.className = 'efsp-control-attest-text';
  text.textContent = `${_open.needs} is a control instruction and ${_open.with} still has control of this flight. Coordinated with ${_open.with}?`;
  const yes = document.createElement('button');
  yes.className = 'efsp-control-attest-yes';
  yes.textContent = `Coordinated with ${_open.with}`;
  yes.addEventListener('click', () => confirmControlAttestation());
  const no = document.createElement('button');
  no.className = 'efsp-control-attest-no';
  no.textContent = 'Cancel';
  no.addEventListener('click', () => dismissControlAttestation());
  el.append(text, yes, no);
}

export function _resetControlAttestForTest() { _open = null; }
