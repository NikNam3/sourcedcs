'use strict';
import { activeMarsaForFdr, getAllEfspStrips, getEfspFdr, marsaForStrip } from '../../efsp-state.js';
import { MARSA_EXPANSION, marsaActionsFor } from '../../marsa-badge.js';
import { _mountPopover, _unmountPopover } from '../popover-portal.js';
import { _dispatchMarsa, selectEfspStripById } from '../../bay-view.js';



let _openMarsaPopoverEl = null;

function _closeMarsaPopover() {
  _unmountPopover(_openMarsaPopoverEl);
  _openMarsaPopoverEl = null;
  document.removeEventListener('pointerdown', _onDocPointerDownCloseMarsaPopover, true);
}

// Tests the target, for the reason spelled out on
// _onDocPointerDownCloseBindPopover above. This popover is the one where it
// hurt most: it is the only one carrying <select>s and a text input, so
// pressing ANY of its own controls dismissed it, and Declare / Rendezvous /
// End / Void could never be clicked at all.
function _onDocPointerDownCloseMarsaPopover(e) {
  if (_openMarsaPopoverEl && !_openMarsaPopoverEl.contains(e.target)) _closeMarsaPopover();
}

/**
 * The relation's actions, and — for a declaration — who is in it.
 *
 * `declaringCallsign` is a required free-text field and that is doctrine, not
 * an oversight: §9.2 rule 1 says "the declaration is the tanker's, and it is
 * verbal — the EFSP records it, it does not decide it." So the form asks who
 * said it rather than guessing from the Strip.
 */
export function _openMarsaPopover(strip, anchorEl) {
  _closeMarsaPopover();
  const popover = document.createElement('div');
  popover.className = 'efsp-coordinate-popover efsp-marsa-popover';
  popover.addEventListener('pointerdown', (e) => e.stopPropagation());

  const relation = typeof marsaForStrip === 'function' ? marsaForStrip(strip) : null;
  const active = relation && relation.state === 'ACTIVE' ? relation : null;

  if (relation) {
    // Rule 5's link, made concrete: naming the other participants, and letting
    // the controller jump to one.
    const heading = document.createElement('div');
    heading.className = 'efsp-marsa-popover-heading';
    heading.textContent = relation.state === 'VOIDED'
      ? `MARSA voided — declared by ${relation.declaringCallsign}`
      : `MARSA — declared by ${relation.declaringCallsign}`;
    heading.title = typeof MARSA_EXPANSION === 'string' ? MARSA_EXPANSION : '';
    popover.appendChild(heading);

    for (const fdrId of relation.participants) {
      if (fdrId === strip.fdrId) continue;
      const peer = getAllEfspStrips().find(s => s.fdrId === fdrId && s.state !== 'DROPPED');
      const fdr = typeof getEfspFdr === 'function' ? getEfspFdr(fdrId) : null;
      const label = (fdr && fdr.identity && fdr.identity.callsign) || fdrId;
      const row = document.createElement('button');
      row.className = 'efsp-marsa-participant-btn';
      row.textContent = label;
      row.title = peer ? 'select this participant' : 'this participant has no live Strip on your board';
      row.disabled = !peer;
      if (peer) {
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          _closeMarsaPopover();
          selectEfspStripById(peer.stripId);
        });
      }
      popover.appendChild(row);
    }
  }

  for (const action of (typeof marsaActionsFor === 'function' ? marsaActionsFor(strip) : [])) {
    if (action.kind === 'DeclareMarsa') {
      popover.appendChild(_buildMarsaDeclareForm(strip));
      continue;
    }
    if (action.kind === 'AddParticipant') {
      popover.appendChild(_buildMarsaAddForm(strip, active));
      continue;
    }
    const btn = document.createElement('button');
    btn.className = 'efsp-coordinate-submit';
    btn.textContent = action.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _closeMarsaPopover();
      const op = action.kind === 'RemoveParticipant'
        ? { kind: 'RemoveParticipant', fdrId: strip.fdrId }
        : { kind: action.kind };
      _dispatchMarsa(strip, action.marsaId, op);
    });
    popover.appendChild(btn);
  }

  _openMarsaPopoverEl = popover;
  // F-110 lived here: `anchorEl.appendChild(popover)`, where anchorEl is the
  // MARSA… <button> whose own click handler opens it. Every click inside the
  // popover — into the declarer field, onto a candidate <select> — bubbled to
  // that button and re-ran this function, so the form was rebuilt empty on
  // every interaction and the declaration could never be completed. The
  // popover is portalled out now (see _mountPopover) and is no longer a
  // descendant of anything that reopens it. It also stops an <input> and two
  // <select>s being nested inside a <button>, which was invalid HTML.
  _mountPopover(popover, anchorEl, strip, _closeMarsaPopover);
  setTimeout(() => document.addEventListener('pointerdown', _onDocPointerDownCloseMarsaPopover, true), 0);
}

/** Which other live flights this one could be put into a relation with. */
function _marsaCandidates(strip) {
  return getAllEfspStrips().filter((s) => {
    if (s.state === 'DROPPED' || s.fdrId === strip.fdrId) return false;
    // A flight already under MARSA cannot be in a second relation — crc-sync
    // refuses it, and offering it here would be a control that always fails.
    return !(typeof activeMarsaForFdr === 'function' && activeMarsaForFdr(s.fdrId));
  });
}

function _marsaCandidateSelect(strip) {
  const select = document.createElement('select');
  select.className = 'efsp-coordinate-primitive-select';
  for (const s of _marsaCandidates(strip)) {
    const fdr = typeof getEfspFdr === 'function' ? getEfspFdr(s.fdrId) : null;
    const option = document.createElement('option');
    option.value = s.fdrId;
    option.textContent = (fdr && fdr.identity && fdr.identity.callsign) || s.fdrId;
    select.appendChild(option);
  }
  return select;
}

function _buildMarsaDeclareForm(strip) {
  const wrap = document.createElement('div');
  const candidates = _marsaCandidates(strip);
  if (candidates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'efsp-coordinate-degraded-warning';
    empty.textContent = 'no other live flight is available to declare MARSA with';
    wrap.appendChild(empty);
    return wrap;
  }

  const other = _marsaCandidateSelect(strip);
  wrap.appendChild(other);

  const startEvent = document.createElement('select');
  startEvent.className = 'efsp-coordinate-primitive-select';
  for (const [value, label] of [
    ['TANKER_ACCEPTED', 'tanker accepted MARSA'],
    ['MTR_ENTRY', 'MTR entry'],
    ['LOCAL_DECLARATION', 'local declaration'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    startEvent.appendChild(option);
  }
  wrap.appendChild(startEvent);

  const endCondition = document.createElement('select');
  endCondition.className = 'efsp-coordinate-primitive-select';
  for (const [value, label] of [
    ['VERTICALLY_POSITIONED', 'until vertically positioned'],
    ['MTR_COMPLETE', 'until MTR complete'],
    ['ATC_SEPARATION_ESTABLISHED', 'until ATC separation is re-established'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    endCondition.appendChild(option);
  }
  wrap.appendChild(endCondition);

  const declaring = document.createElement('input');
  declaring.className = 'efsp-coordinate-note';
  declaring.placeholder = 'who declared it (heard on frequency)';
  wrap.appendChild(declaring);

  const send = document.createElement('button');
  send.className = 'efsp-coordinate-send-btn';
  send.textContent = 'Declare';
  send.addEventListener('click', (e) => {
    e.stopPropagation();
    _closeMarsaPopover();
    _dispatchMarsa(strip, undefined, {
      kind: 'DeclareMarsa',
      participants: [strip.fdrId, other.value],
      startEvent: startEvent.value,
      endCondition: endCondition.value,
      declaringCallsign: (declaring.value || '').trim(),
    });
  });
  wrap.appendChild(send);
  return wrap;
}

function _buildMarsaAddForm(strip, active) {
  const wrap = document.createElement('div');
  const candidates = _marsaCandidates(strip);
  if (candidates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'efsp-coordinate-degraded-warning';
    empty.textContent = 'no other live flight is available to join this relation';
    wrap.appendChild(empty);
    return wrap;
  }
  const other = _marsaCandidateSelect(strip);
  wrap.appendChild(other);
  const add = document.createElement('button');
  add.className = 'efsp-coordinate-send-btn';
  add.textContent = 'Add to MARSA';
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    _closeMarsaPopover();
    _dispatchMarsa(strip, active && active.marsaId, { kind: 'AddParticipant', fdrId: other.value });
  });
  wrap.appendChild(add);
  return wrap;
}
