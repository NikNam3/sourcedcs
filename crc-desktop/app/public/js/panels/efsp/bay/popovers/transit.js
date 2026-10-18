'use strict';
import { openPopover } from '../popover-portal.js';
import { requestTransit } from '../../transit-actions.js';

// crc-sync docs/adr/0128: "Transit…" on a Strip with more than one airspace to ask about: pick it, then Request transit.

let _handle = null;

/** @param {{airspace:object, positionId:string, deciderPositionId:string|null}[]} choices transit-rules.js `requestTransitChoices` */
export function openTransitPopover(strip, anchorEl, choices) {
  if (_handle) _handle.close();
  const popover = document.createElement('div');
  popover.className = 'efsp-coordinate-popover efsp-transit-popover';
  const select = document.createElement('select');
  select.className = 'efsp-coordinate-primitive-select';
  select.dataset.testid = 'transit-airspace';
  for (const c of choices) {
    const def = c.airspace.definition || {};
    const opt = document.createElement('option');
    opt.value = c.airspace.airspaceId;
    opt.textContent = `${def.name || c.airspace.airspaceId} — ${def.type}`;
    select.appendChild(opt);
  }
  const send = document.createElement('button');
  send.className = 'efsp-coordinate-send-btn';
  send.textContent = 'Request transit';
  send.addEventListener('click', (e) => {
    e.stopPropagation();
    const choice = choices.find(c => c.airspace.airspaceId === select.value);
    if (choice) requestTransit(choice, strip.flightDataId);
    if (_handle) _handle.close();
  });
  popover.append(select, send);
  _handle = openPopover({ el: popover, anchor: anchorEl, strip, onClose: () => { _handle = null; } });
}
