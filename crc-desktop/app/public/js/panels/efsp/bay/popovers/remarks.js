'use strict';
// The remarks text-box window (decisions.md H139): the whole of a flight's remarks, shown and edited in a small popover
// anchored to the Strip. Multi-line, scrollable; Save sends the ordinary SetBlock on the strip type's remarks Block
// (strip-template.js remarksBlockFor), Cancel or Esc (the portal's own handler) closes it, Ctrl+Enter saves. Same rights
// as every Block edit: the Position that holds the Strip edits it; anyone else reads it, and a refusal lands in the usual
// banner with the window left open (DESK-ACKS, _sendFromPopover).
import { getEfspFlightData, getEfspStrip } from '../../efsp-state.js';
import { getActingPositions, sendEfspMutation } from '../../efsp-ws.js';
import { blockLabelFor, isBlockEditable, remarksBlockFor } from '../../strip-template.js';
import { openPopover, _sendFromPopover } from '../popover-portal.js';
import { _resolveActingPositionId } from '../dispatch.js';

// crc-sync flight-data-store.js MAX_FREE_TEXT: the server refuses more, so the box does not take more.
export const REMARKS_MAX_LENGTH = 2000;

let _handle = null;

function _el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** May the controller edit this Strip's remarks? The holder of the Strip may (StripOps's NOT_OWNER gate); no one else. */
export function remarksEditable(strip) {
  const blockId = remarksBlockFor(strip && strip.stripType);
  if (!blockId || !isBlockEditable(blockId, strip.stripType, strip.facilityId)) return false;
  return getActingPositions().includes(strip.ownerPositionId);
}

/** Opens the remarks window for `strip` at `anchorEl`. @returns {{el:HTMLElement, close:()=>void}|null} */
export function openRemarksPopover(strip, anchorEl) {
  if (_handle) _handle.close();
  strip = getEfspStrip(strip.stripId) || strip;
  const blockId = remarksBlockFor(strip.stripType);
  if (!blockId) return null;
  const flightData = getEfspFlightData(strip.flightDataId);
  const current = (flightData && flightData.filed && typeof flightData.filed.remarks === 'string') ? flightData.filed.remarks : '';
  const editable = remarksEditable(strip);
  const callsign = (flightData && flightData.identity && flightData.identity.callsign) || '';

  const popover = _el('div', 'efsp-coordinate-popover efsp-remarks-popover');
  popover.dataset.remarks = editable ? 'edit' : 'read';
  popover.dataset.stripId = strip.stripId;
  const head = _el('div', 'efsp-remarks-head');
  head.appendChild(_el('span', 'efsp-remarks-title', `${blockLabelFor(blockId, strip.stripType) || 'RMKS'} ${callsign}`.trim()));
  if (!editable) head.appendChild(_el('span', 'efsp-remarks-readonly', `read only: ${strip.ownerPositionId} holds this Strip`));
  popover.appendChild(head);

  const box = _el('textarea', 'efsp-remarks-textarea');
  box.value = current;
  box.rows = 6;
  box.maxLength = REMARKS_MAX_LENGTH;
  box.spellcheck = false;
  box.setAttribute('aria-label', 'Remarks');
  if (!editable) box.readOnly = true;
  popover.appendChild(box);

  const foot = _el('div', 'efsp-remarks-foot');
  let handle = null;
  if (editable) {
    foot.appendChild(_el('span', 'efsp-remarks-hint', 'Ctrl+Enter saves · Esc cancels'));
    const cancel = _el('button', 'efsp-coordinate-send-btn efsp-remarks-cancel', 'Cancel');
    const save = _el('button', 'efsp-coordinate-send-btn efsp-remarks-save', 'Save');
    const submit = () => {
      const value = box.value.trim();
      if (value === current.trim()) { handle.close(); return; } // nothing changed: no Mutation for nothing
      _sendFromPopover(popover, save, (onAck) => {
        const live = getEfspStrip(strip.stripId) || strip; // its current rev (the stale-baseRev rule every Block edit follows)
        const acting = _resolveActingPositionId(live);
        if (!acting) return false;
        sendEfspMutation(acting, live, { kind: 'SetBlock', blockId, value }, { onAck });
        return true;
      });
    };
    cancel.addEventListener('click', (e) => { e.stopPropagation(); handle.close(); });
    save.addEventListener('click', (e) => { e.stopPropagation(); submit(); });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    });
    foot.appendChild(cancel);
    foot.appendChild(save);
  } else {
    const close = _el('button', 'efsp-coordinate-send-btn efsp-remarks-close', 'Close');
    close.addEventListener('click', (e) => { e.stopPropagation(); handle.close(); });
    foot.appendChild(close);
  }
  popover.appendChild(foot);

  handle = openPopover({ el: popover, anchor: anchorEl, strip, focus: box, onClose: () => { if (_handle === handle) _handle = null; } });
  _handle = handle;
  return handle;
}
