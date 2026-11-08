'use strict';
import { openPopover } from '../popover-portal.js';
import { sendEfspMutation } from '../../efsp-ws.js';

// crc-sync docs/adr/0156: a carrier Strip's callsign, typed once it is known (it binds the flight's ATO line). C1 by SetBlock.

let _handle = null;

export function openCarrierCallsignPopover(strip, anchorEl, actingPositionId) {
  if (_handle) _handle.close();
  const popover = document.createElement('div');
  popover.className = 'efsp-coordinate-popover';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 7;
  input.placeholder = 'Callsign';
  input.className = 'efsp-carrier-callsign-input';
  const ok = document.createElement('button');
  ok.className = 'efsp-coordinate-submit';
  ok.textContent = 'Set';
  const send = () => {
    const v = input.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,7}$/.test(v)) { input.classList.add('efsp-input-invalid'); return; }
    sendEfspMutation(actingPositionId, strip, { kind: 'SetBlock', blockId: 'C1', value: v });
    if (_handle) _handle.close();
  };
  ok.addEventListener('click', (e) => { e.stopPropagation(); send(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); if (e.key === 'Escape' && _handle) _handle.close(); });
  popover.append(input, ok);
  _handle = openPopover({ el: popover, anchor: anchorEl, strip, onClose: () => { _handle = null; } });
  input.focus();
}
