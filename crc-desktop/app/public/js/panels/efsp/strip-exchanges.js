'use strict';
import { getEfspFlightData, getEfspStrip, marsaForStrip } from './efsp-state.js';
import { tofiExitDueFor } from './efsp-nla.js';
import { correlationBadgeFor } from './correlation-highlight.js';
import { _dispatchMarsa, _resolveActingPositionId } from './bay/dispatch.js';
import { TOFI_COUNTERPARTS } from './bay/authority-mirror.js';
import { _openBindPopover } from './bay/popovers/bind.js';
import { _buildCoordinationNoteEl, _coordinationProposerOf, _coordinationStateWord, _dispatchCoordination, COORDINATION_PRIMITIVE_LABELS } from './bay/popovers/coordination.js';
import { _coordinationIsReplica, _isPendingCoordinationReplica } from './bay/coordination-rules.js';
import { _canMarkTofiEntered, _canProposeTofiExit, _canTransferTofiComms, _dispatchTofi, _isPendingTofiReplica, _tofiExitPrecondition, _tofiProposerOf, _tofiRegimeChoice, TOFI_ACCEPT_REGIMES } from './bay/popovers/tofi.js';
import { _dispatchHandoffStep, _openControlReleasePopover } from './bay/popovers/control-release.js';
import { handoffChips, handoffSteps } from './control-release-rules.js';
import { _addClass, _stateMeta, _stripButton, _stripEl } from './strip-dom.js';

// The exchange rows of a Strip's tab (DESK-SPLIT, split out of strip-view.js): coordination, TOFI, MARSA and track exchanges, each with its answer buttons.

function _exchangeRow({ incoming = false, kind, title = '' }) {
  const row = _stripEl('div', `efsp-x efsp-x-${kind}${incoming ? ' efsp-x-in' : ''}`);
  if (title) row.title = title;
  return row;
}

function _exchangeButtons(buttons) {
  const wrap = _stripEl('div', 'efsp-x-buttons');
  for (const b of buttons) wrap.appendChild(b);
  return wrap;
}

/** The buttons of a HANDOFF's steps (docs/adr/0101): a one-click mark sends at once (Undo covers it), a form opens a popover. */
function _handoffStepButtons(strip, acting) {
  return handoffSteps(strip, acting).map(step => _stripButton(step.label, `efsp-handoff-step efsp-handoff-step-${step.key.toLowerCase().replace(/_/g, '-')}`, {
    title: step.reason || step.title, disabled: !step.enabled, action: `handoff-${step.key.toLowerCase()}`,
    onClick: (e, btn) => (step.form ? _openControlReleasePopover(strip, btn, step.form) : _dispatchHandoffStep(strip, step.key)),
  }));
}

/** The five coordination primitives — both sides, every state. F-302's badge, as a row. */
export function _coordinationExchange(strip) {
  const co = strip.coordination;
  if (!co) return null;
  const isReplica = _coordinationIsReplica(strip);
  const pendingIn = _isPendingCoordinationReplica(strip);
  const proposer = _coordinationProposerOf(strip, co);
  const primitiveLabel = (COORDINATION_PRIMITIVE_LABELS[co.primitive] || co.primitive).toUpperCase();

  const row = _exchangeRow({ incoming: pendingIn, kind: 'coordination' });
  const what = _stripEl('div', 'efsp-x-what efsp-coordination-state-badge'
    + (co.state === 'REJECTED' ? ' efsp-coordination-state-rejected' : ''),
  `${primitiveLabel} ${isReplica ? '←' : '→'} ${co.peerPositionId}`);
  what.title = `${proposer} proposed this ${primitiveLabel.toLowerCase()}`;
  row.appendChild(what);

  let meta;
  if (co.state === 'INITIATED') {
    meta = _stateMeta(_coordinationStateWord(co), co.initiatedAt);
    // The requester's own Strip: a still-open request that was answered
    // "stand by" must not read as ignored (docs/adr/0022).
    if (!isReplica && co.primitive === 'OPERATIONAL_REQUEST' && co.lastStandByAt) {
      meta.appendChild(_stripEl('span', 'efsp-coordination-badge-standby', ' · STAND BY'));
    }
  } else if (co.state === 'REJECTED') {
    meta = _stateMeta(isReplica
      ? `Rejected by you. ${co.peerPositionId} still controls this flight.`
      : `${_coordinationStateWord(co)} by ${co.peerPositionId}`);
    _addClass(meta, 'efsp-x-meta-attn');
  } else {
    meta = _stateMeta(_coordinationStateWord(co));
  }
  row.appendChild(meta);

  // §4.6 rule 1: a Point Out's two halves, both always visible.
  if (co.primitive === 'POINT_OUT' && co.state !== 'REJECTED' && co.dataOwnerPositionRef && co.separationResponsibilityRef) {
    const halves = _stripEl('div', 'efsp-coordination-badges');
    halves.appendChild(_stripEl('span', 'efsp-coordination-badge-data', `DATA: ${co.dataOwnerPositionRef.positionId}`));
    halves.appendChild(_stripEl('span', 'efsp-coordination-badge-sep', `SEP: ${co.separationResponsibilityRef.positionId}`));
    row.appendChild(halves);
  }

  if (co.note) row.appendChild(_buildCoordinationNoteEl(co.note, proposer));

  // docs/adr/0101: after ACCEPT a HANDOFF carries who has communications and control, the ControlRelease in effect, and
  // the steps still to take. The row is the place for them: they are the next thing the controller does.
  const chips = handoffChips(strip);
  if (chips.length) {
    const wrap = _stripEl('div', 'efsp-coordination-badges efsp-handoff-chips');
    for (const c of chips) {
      const chip = _stripEl('span', `efsp-handoff-chip efsp-handoff-chip-${c.key} efsp-handoff-tone-${c.tone}${c.mine ? ' efsp-handoff-mine' : ''}`, c.text);
      chip.title = c.title;
      chip.dataset.chip = c.key;
      wrap.appendChild(chip);
    }
    row.appendChild(wrap);
    const stepButtons = _handoffStepButtons(strip, _resolveActingPositionId(strip));
    if (stepButtons.length) row.appendChild(_exchangeButtons(stepButtons));
  }

  if (pendingIn) {
    const isOpsRequest = co.primitive === 'OPERATIONAL_REQUEST';
    const buttons = [
      _stripButton(isOpsRequest ? 'Unable' : 'Reject', 'efsp-coordinate-reject-btn', {
        onClick: () => _dispatchCoordination(strip, co.primitive, 'REJECT'),
      }),
    ];
    if (isOpsRequest) {
      buttons.push(_stripButton('Stand By', 'efsp-coordinate-standby-btn', {
        onClick: () => _dispatchCoordination(strip, co.primitive, 'STAND_BY'),
      }));
    }
    buttons.push(_stripButton(isOpsRequest ? 'Approve' : `Accept ${COORDINATION_PRIMITIVE_LABELS[co.primitive] || co.primitive}`,
      'efsp-coordinate-accept-btn', { go: true, onClick: () => _dispatchCoordination(strip, co.primitive, 'ACCEPT') }));
    row.appendChild(_exchangeButtons(buttons));
  }
  return row;
}

/** TOFI (guide §4.6.3): the MRU's pending answer, the ATC side's pending proposal, and the comms-transfer step. */
export function _tofiExchange(strip) {
  const tofi = strip.tofiCoordination;
  if (!tofi || tofi.state === 'REJECTED') return null;
  const awaitingComms = !!tofi.acceptedAt && !tofi.commsTransferred;
  const awaitingEntry = _canMarkTofiEntered(strip);
  if (tofi.state !== 'INITIATED' && !awaitingComms && !awaitingEntry) return null; // active and settled: the TOFI indicator says so

  const pendingIn = _isPendingTofiReplica(strip);
  const blocking = _tofiExitPrecondition(strip, tofi);
  const row = _exchangeRow({ incoming: pendingIn, kind: 'tofi',
    title: blocking || `${_tofiProposerOf(strip, tofi)} proposed this TOFI ${tofi.direction.toLowerCase()}` });
  _addClass(row, 'efsp-tofi-badge');
  if (blocking) _addClass(row, 'efsp-coordination-badge-blocked');
  row.appendChild(_stripEl('div', 'efsp-x-what', `TOFI ${tofi.direction} ${strip.stripType === 'MISSION' ? '←' : '→'} ${tofi.peerPositionId}`));

  let meta;
  if (awaitingComms && tofi.state !== 'INITIATED') {
    meta = _stateMeta('ACCEPTED · comms not moved');
  } else if (awaitingEntry && tofi.state !== 'INITIATED') {
    meta = _stateMeta('ACTIVE · regime waits for entry');
  } else if (blocking) {
    meta = _stateMeta(`${tofi.state} · blocked`);
    _addClass(meta, 'efsp-x-meta-attn');
  } else {
    meta = _stateMeta(tofi.state, tofi.initiatedAt);
  }
  row.appendChild(meta);
  if (tofi.note) row.appendChild(_buildCoordinationNoteEl(tofi.note, _tofiProposerOf(strip, tofi)));

  if (pendingIn) {
    const label = tofi.direction === 'EXIT' ? 'Exit' : 'Entry';
    let regimeSel = null;
    if (!blocking && tofi.direction === 'ENTRY') {
      // docs/adr/0053 — accepting an ENTRY states the regime. See F-008 for why
      // the choice is kept across rebuilds and the click never reaches the Strip.
      const field = _stripEl('label', 'efsp-x-regime', 'SEP REG');
      regimeSel = _stripEl('select', 'efsp-tofi-regime-select');
      regimeSel.dataset.stripAction = 'tofi-regime';
      regimeSel.title = 'under which regime is the MRU taking this aircraft (§4.6.3)';
      for (const value of TOFI_ACCEPT_REGIMES) {
        const opt = _stripEl('option', null, value);
        opt.value = value;
        regimeSel.appendChild(opt);
      }
      const remembered = _tofiRegimeChoice.get(strip.stripId);
      if (remembered && TOFI_ACCEPT_REGIMES.includes(remembered)) regimeSel.value = remembered;
      regimeSel.addEventListener('change', () => _tofiRegimeChoice.set(strip.stripId, regimeSel.value));
      regimeSel.addEventListener('pointerdown', (e) => e.stopPropagation());
      regimeSel.addEventListener('click', (e) => e.stopPropagation());
      field.appendChild(regimeSel);
      row.appendChild(field);
    }
    const accept = _stripButton(`Accept TOFI ${label}`, 'efsp-coordinate-accept-btn', {
      go: true,
      disabled: !!blocking,
      title: blocking || '',
      onClick: () => _dispatchTofi(strip, 'ACCEPT', undefined, regimeSel ? { separationRegime: regimeSel.value } : {}),
    });
    if (blocking) _addClass(accept, 'efsp-nla-btn-denied');
    row.appendChild(_exchangeButtons([
      _stripButton('Reject', 'efsp-coordinate-reject-btn', { onClick: () => _dispatchTofi(strip, 'REJECT') }),
      accept,
    ]));
  } else {
    const steps = [];
    if (_canTransferTofiComms(strip)) {
      steps.push(_stripButton('Transfer Comms', 'efsp-coordinate-btn efsp-tofi-transfer-comms-btn', {
        title: 'Guide §4.6.3 — a separate step from ACCEPT',
        onClick: () => _dispatchTofi(strip, 'TRANSFER_COMMS'),
      }));
    }
    if (awaitingEntry) {
      const pending = getEfspFlightData(strip.flightDataId).tofi.pendingSeparationRegime;
      const waiting = _stripEl('div', 'efsp-x-regime-pending', `SEP REG ATC → ${pending} on entry`);
      waiting.dataset.pendingRegime = pending;
      row.appendChild(waiting);
      steps.push(_stripButton('Entered', 'efsp-coordinate-btn efsp-tofi-entered-btn', {
        title: `Record that the flight is in your airspace: ${pending} becomes the separation regime now`,
        onClick: () => _dispatchTofi(strip, 'MARK_ENTERED'),
      }));
    }
    if (steps.length) row.appendChild(_exchangeButtons(steps));
  }
  return row;
}

/** A MARSA relation declared but not yet joined: the interlock is armed, and the two answers are on the Strip. */
export function _marsaExchange(strip) {
  const relation = marsaForStrip(strip);
  if (!relation || relation.state !== 'ACTIVE' || relation.rendezvousAt) return null;
  const others = relation.participants.filter(id => id !== strip.flightDataId).map((flightDataId) => {
    const flightData = getEfspFlightData(flightDataId);
    return (flightData && flightData.identity && flightData.identity.callsign) || flightDataId;
  });
  const row = _exchangeRow({ kind: 'marsa', title: `declared by ${relation.declaringCallsign}` });
  row.appendChild(_stripEl('div', 'efsp-x-what', `MARSA · ${others.join(', ') || relation.declaringCallsign}`));
  row.appendChild(_stripEl('div', 'efsp-x-meta', 'armed, no rendezvous yet'));
  const acting = !!_resolveActingPositionId(strip);
  row.appendChild(_exchangeButtons([
    _stripButton('Void', 'efsp-marsa-void-btn', {
      disabled: !acting, onClick: () => _dispatchMarsa(strip, relation.marsaId, { kind: 'VoidMarsa' }),
    }),
    _stripButton('Rendezvous', 'efsp-marsa-rendezvous-btn', {
      disabled: !acting, onClick: () => _dispatchMarsa(strip, relation.marsaId, { kind: 'MarkRendezvous' }),
    }),
  ]));
  return row;
}

/** The server would not guess between two contacts; the controller picks one. */
export function _trackExchange(strip) {
  const badge = correlationBadgeFor(strip);
  if (!badge || !badge.ambiguous) return null;
  const n = (badge.candidateTrackIds || []).length;
  const row = _exchangeRow({ incoming: true, kind: 'track', title: badge.title });
  row.appendChild(_stripEl('div', 'efsp-x-what', `TRACK · ${n} CANDIDATES`));
  row.appendChild(_stripEl('div', 'efsp-x-meta', 'pick the contact this flight is'));
  const pick = _stripButton('Pick…', 'efsp-correlation-btn efsp-correlation-pick-btn', {
    disabled: !_resolveActingPositionId(strip),
    onClick: (e, btn) => _openBindPopover(strip, btn, badge.candidateTrackIds),
  });
  row.appendChild(_exchangeButtons([pick]));
  return row;
}

/** The mission Strip this ATC-side Strip's TOFI is with (its tofiCoordination.peerStripId), or null. */
export function _pairedMissionStrip(strip) {
  const tofi = strip && strip.tofiCoordination;
  return tofi && tofi.peerStripId ? (getEfspStrip(tofi.peerStripId) || null) : null;
}

/** UI-A U8: should this Strip's NLA slot be TOFI Exit right now? (the mission line is OFF_STATION or RTB.) */
export function _tofiExitIsPrimary(strip) {
  if (!TOFI_COUNTERPARTS[strip.ownerPositionId] || !_canProposeTofiExit(strip)) return false;
  return tofiExitDueFor(strip, _pairedMissionStrip(strip));
}

/** For bay-view.js's render signature: the mission line's state, which this Strip's primary action now depends on (S-L14). */
export function tofiExitSignatureFor(strip) {
  const m = strip && strip.tofiCoordination ? _pairedMissionStrip(strip) : null;
  return m ? m.state : '';
}
