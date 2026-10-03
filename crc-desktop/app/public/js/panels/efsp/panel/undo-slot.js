'use strict';
import { _undoSlotEl, _undoVoidedEl } from './state.js';
import { sendEfspUndo, getActingPositions } from '../efsp-ws.js';
import { getEfspBoardEpoch } from '../efsp-state.js';

// docs/adr/0100 §10 (UNDO-C): the one undo slot per session, the outcome line after an Undo, and the panel
// messages a controller gets when somebody else's Undo voided their change (§6, H100 Q-U2 b: a message only,
// nothing on the Strip). The server says what is undoable (the ack's `undoable`); this keeps no list of ops.
// The window is measured on the client wall clock from the ack's arrival; the server stays authoritative.

export const UNDO_OUTCOME_MS = 3000;
const MAX_VOIDED_MESSAGES = 5;

let _clock = () => Date.now();
/** Tests inject a clock. */
export function _setUndoClockForTest(fn) { _clock = fn || (() => Date.now()); }

let _slot = null;        // { actionId, label, expiresAt, facilityId, stripId, actingPositionId, boardEpoch }
let _outcome = null;     // { text, refused, until }
let _pendingUndoId = null;
let _voidedMessages = []; // { id, text }
let _nextId = 1;
let _timer = null;

/** The live slot, or null (also null once the window has run out). */
export function getUndoSlot() {
  if (_slot && _clock() >= _slot.expiresAt) _slot = null;
  return _slot;
}
export function getUndoOutcome() {
  if (_outcome && _clock() >= _outcome.until) _outcome = null;
  return _outcome;
}
export function getUndoVoidedMessages() { return _voidedMessages.slice(); }

/** The slot line: "Undo · Hand off VIPER1 → APP · 7 s", or null. */
export function undoSlotText() {
  const slot = getUndoSlot();
  if (!slot) return null;
  const left = Math.max(0, Math.ceil((slot.expiresAt - _clock()) / 1000));
  return `Undo · ${slot.label} · ${left} s`;
}

function _positionsOf(voided) {
  return [...new Set((voided || []).map(v => v.actingPositionId).filter(Boolean))];
}

/** "Undone · Hand off VIPER1; voided 1 change by TWR" */
export function undoOutcomeText(undone, voided) {
  const base = `Undone · ${undone && undone.label ? undone.label : 'last action'}`;
  const n = (voided || []).length;
  if (!n) return base;
  const by = _positionsOf(voided);
  return `${base}; voided ${n} change${n === 1 ? '' : 's'}${by.length ? ` by ${by.join(', ')}` : ''}`;
}

/** The panel message for a voided Position: "TWR undid Hand off VIPER1; your annotation on VIPER1 was voided". */
export function undoVoidedMessageText(msg) {
  const items = (msg.voided || []).map(v => v.summary || v.op).filter(Boolean);
  const what = items.length ? items.join(', ') : 'a change of yours';
  const verb = items.length > 1 ? 'were' : 'was';
  return `${msg.undoneBy || 'Another Position'} undid ${msg.undoneLabel || msg.undoneOp || 'an action'}; your ${what} ${verb} voided`;
}

/**
 * An efsp-mutation-ack came in. `pending` is the original request (efsp-state's `result.pending`) when the
 * client sent it. Returns true when the ack was an Undo's own ack (the caller then skips the refusal banner:
 * the slot line is the surface for it).
 */
export function noteUndoAck(msg, pending) {
  if (msg.clientMutationId && msg.clientMutationId === _pendingUndoId) {
    _pendingUndoId = null;
    if (msg.ok) {
      _slot = null;
      _outcome = { text: undoOutcomeText(msg.undone, msg.voided), refused: false, until: _clock() + UNDO_OUTCOME_MS };
    } else {
      // Terminal refusals end the offer; a transient one (not staffed, Bay full) leaves the slot to retry.
      if (['UNDO_UNAVAILABLE', 'UNDO_BLOCKED', 'NOT_FOUND'].includes(msg.reason)) _slot = null;
      _outcome = { text: `Cannot undo: ${msg.detail || msg.reason || 'refused'}`, refused: true, until: _clock() + UNDO_OUTCOME_MS };
    }
    _kick();
    return true;
  }
  if (msg.ok && msg.undoable && msg.undoable.actionId) {
    const facilityId = msg.facilityId || (pending && pending.facilityId) || undefined;
    _slot = {
      actionId: msg.undoable.actionId,
      label: msg.undoable.label || 'last action',
      expiresAt: _clock() + (Number(msg.undoable.windowMs) || 10000),
      facilityId,
      stripId: (pending && pending.stripId) || (msg.strip && msg.strip.stripId) || undefined,
      actingPositionId: (pending && pending.actingPositionId) || undefined,
      boardEpoch: msg.boardEpoch,
    };
    _kick();
  }
  return false;
}

/** A frame carrying a Facility's Board epoch arrived (ack, delta, snapshot): a new lifetime means no undo. */
export function noteUndoBoardEpoch(facilityId, epoch) {
  if (!_slot || epoch === undefined || epoch === null) return;
  if ((!_slot.facilityId || _slot.facilityId === facilityId) && _slot.boardEpoch !== undefined && _slot.boardEpoch !== epoch) {
    _slot = null;
    _render();
  }
}

/** After a snapshot: compare the slot's epoch with the Board epoch the client now holds. */
export function reconcileUndoSlotEpoch() {
  if (_slot && _slot.facilityId) noteUndoBoardEpoch(_slot.facilityId, getEfspBoardEpoch(_slot.facilityId));
}

/** `efsp-undo-voided`: someone else's Undo voided this Position's change. */
export function noteUndoVoided(msg) {
  _voidedMessages.push({ id: _nextId++, text: undoVoidedMessageText(msg) });
  if (_voidedMessages.length > MAX_VOIDED_MESSAGES) _voidedMessages.shift();
  _render();
}
export function dismissUndoVoided(id) {
  _voidedMessages = _voidedMessages.filter(m => m.id !== id);
  _render();
}

/** `.undo` and Ctrl+Z: send the slot's actionId. Returns false (and says why in the outcome) with nothing to undo. */
export function requestUndo() {
  const slot = getUndoSlot();
  if (!slot) {
    _outcome = { text: 'Nothing to undo (the 10 s window has passed)', refused: true, until: _clock() + UNDO_OUTCOME_MS };
    _kick();
    return false;
  }
  const positions = getActingPositions();
  const actingPositionId = positions.includes(slot.actingPositionId) ? slot.actingPositionId : (slot.actingPositionId || positions[0]);
  _pendingUndoId = sendEfspUndo(actingPositionId, slot);
  return true;
}

export function _resetUndoForTest() {
  _slot = null; _outcome = null; _pendingUndoId = null; _voidedMessages = []; _nextId = 1;
  clearTimeout(_timer); _timer = null;
}

function _kick() {
  _render();
  clearTimeout(_timer);
  _timer = null;
  if (getUndoSlot() || getUndoOutcome()) _timer = setTimeout(_kick, 250);
}

/** Draws the slot line and the voided messages. A no-op until initEfspPanel() has cached the elements. */
export function renderUndoSlot() { _render(); }

function _render() {
  if (_undoSlotEl) {
    const outcome = getUndoOutcome();
    const text = undoSlotText();
    _undoSlotEl.classList.toggle('efsp-undo-refused', !!(outcome && outcome.refused));
    if (outcome) {
      _undoSlotEl.replaceChildren();
      _undoSlotEl.textContent = outcome.text;
      _undoSlotEl.hidden = false;
    } else if (text) {
      // The countdown ticks every 250 ms. The button is kept and only its text changes: a button rebuilt under the
      // pointer between mousedown and mouseup loses the click (B9, docs/wip/ARCH-C.md §3.1).
      let btn = _undoSlotEl.querySelector('.efsp-undo-btn');
      if (!btn) {
        _undoSlotEl.replaceChildren();
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'efsp-undo-btn';
        btn.title = 'Undo this action (Ctrl+Z or .undo)';
        btn.addEventListener('click', requestUndo);
        _undoSlotEl.appendChild(btn);
      }
      if (btn.textContent !== text) btn.textContent = text;
      _undoSlotEl.hidden = false;
    } else {
      _undoSlotEl.replaceChildren();
      _undoSlotEl.hidden = true;
    }
  }
  if (_undoVoidedEl) {
    _undoVoidedEl.replaceChildren();
    for (const m of _voidedMessages) {
      const row = document.createElement('div');
      row.className = 'efsp-undo-voided-msg';
      row.textContent = m.text;
      row.title = 'click to dismiss';
      row.addEventListener('click', () => dismissUndoVoided(m.id));
      _undoVoidedEl.appendChild(row);
    }
    _undoVoidedEl.hidden = _voidedMessages.length === 0;
  }
}

// Ctrl+Z (Cmd+Z) undoes the slot's action while the controller is working in the EFSP panel: the last pointer
// press was inside it, or focus is. Text entry keeps its own Ctrl+Z (the dot-command input, a Block editor).
let _panelHot = false;
let _keysWired = false;
export function isUndoKey(e) {
  return !!(e && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'z');
}
export function isTextEntryTarget(el) {
  if (!el) return false;
  const tag = String(el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}
export function wireUndoKeys(root) {
  if (_keysWired || !root) return;
  _keysWired = true;
  document.addEventListener('pointerdown', (e) => { _panelHot = root.contains(e.target); }, true);
  document.addEventListener('keydown', (e) => {
    if (!isUndoKey(e)) return;
    const active = document.activeElement;
    if (!(_panelHot || (active && root.contains(active)))) return;
    if (isTextEntryTarget(e.target)) return;
    e.preventDefault();
    requestUndo();
  });
}
