'use strict';
import { getEfspCorrelationForStrip, getEfspFlightData, getAllEfspStrips, getEfspStrip, otherLiveStripsForFlightData } from './efsp-state.js';
import { toggleOffset } from './efsp-gestures.js';
import { getActingPositions, sendEfspMutation } from './efsp-ws.js';
import { noteEfspGesture } from './efsp-metrics-client.js';
import { correlationBadgeFor, showOnMapTrackFor, showStripOnMap } from './correlation-highlight.js';
import { _dispatchCorrelation, _dispatchGesture, _dispatchHandBack, _handBackBayFor, _resolveActingPositionId } from './bay/dispatch.js';
import { AIRSPACE_ENTRY_POSITIONS, COORDINATION_TARGETS, HAND_BACK_TO, TOFI_COUNTERPARTS } from './bay/authority-mirror.js';
import { openPopover } from './bay/popover-portal.js';
import { _canApproveAirspaceEntry, _canConvertToArrival, _openAirspaceEntryPopover, _pendingConvertStripId } from './bay/popovers/airspace-entry.js';
import { _openBindPopover } from './bay/popovers/bind.js';
import { _openDivertPopover } from './bay/popovers/divert.js';
import { divertOffer } from './divert-rules.js';
import { _canProposeCoordination, _dispatchCoordination, _openCoordinatePopover } from './bay/popovers/coordination.js';
import { _isPendingCoordinationReplica, _isRejectedCoordinationReplica } from './bay/coordination-rules.js';
import { _openMarsaPopover } from './bay/popovers/marsa.js';
import { _canProposeTofiEntry, _canProposeTofiExit, _dispatchTofi, _openTofiEntryPopover } from './bay/popovers/tofi.js';
import { _appendDropButton, _appendExpandButton } from './bay/strip-expanded.js';
import { _setPendingConvertStripId } from './bay/popovers/airspace-entry.js';
import { _openJoinPopover, _openSplitPopover } from './bay/popovers/formation.js';
import { _dispatchHandoffStep, _openControlReleasePopover } from './bay/popovers/control-release.js';
import { handoffSteps } from './control-release-rules.js';
import { holdsFormationGrant, joinOffer, splitOffer } from './formation-rules.js';
import { convertStripToArrival } from './panel/create-strip.js';
import { _stripEl } from './strip-dom.js';

// The Strip's tools column and the ⋯ menu (DESK-SPLIT, split out of strip-view.js): everything a controller starts from a Strip.

/**
 * Everything the controller can START on this Strip, grouped. An item a
 * Position can never use is left out; one it can use but not right now is
 * listed, disabled, with the reason — so the menu teaches what exists.
 * @returns {{group:string, key:string, label:string, cls:string, enabled:boolean, reason?:string, run:(anchor:HTMLElement, item:HTMLElement)=>boolean|void}[]}
 */
function _stripMenuItems(strip) {
  if (_isRejectedCoordinationReplica(strip)) return [];
  const items = [];
  const acting = _resolveActingPositionId(strip);
  const pendingIn = _isPendingCoordinationReplica(strip);
  const answerFirst = 'answer the pending proposal first';

  // Start
  // H2 / H40 (docs/adr/0080): an AIC- or JTAC-held line goes back to TAC_C2
  // from here, since a controller holding only that Position has no TAC_C2 tab
  // to drag it to. One item per target.
  for (const to of HAND_BACK_TO[strip.ownerPositionId] || []) {
    const bay = _handBackBayFor(strip, to);
    const holdsOwner = acting === strip.ownerPositionId; // acting as another Position cannot transfer this line
    const ok = holdsOwner && !!bay && !pendingIn;
    items.push({ group: 'Start', key: `hand-back-${to}`, label: `Hand back to ${to}`, cls: 'efsp-hand-back-btn', enabled: ok,
      reason: !holdsOwner ? `you do not hold ${strip.ownerPositionId}` : !bay ? `${to} has no Bay for this line` : pendingIn ? answerFirst : '',
      title: `Transfer this line back to ${to}`,
      run: () => _dispatchHandBack(strip, to) });
  }
  // U7 (docs/adr/0080): the proposer can always leave its own exchange — a link
  // the other side can no longer answer must not strand the Strip.
  if (acting === strip.ownerPositionId && strip.coordination && !strip.coordination.mintedForCoordination
      && (strip.coordination.state === 'INITIATED' || strip.coordination.state === 'ACTIVE')) {
    const open = strip.coordination.state === 'INITIATED';
    items.push({ group: 'Start', key: 'coordination-cancel', label: open ? 'Cancel proposal' : 'End coordination', cls: 'efsp-coordinate-btn', enabled: true,
      title: open ? 'Withdraw the open proposal' : 'Close this exchange on your Strip (the other side keeps its own)',
      run: () => _dispatchCoordination(strip, strip.coordination.primitive, 'CANCEL') });
  }
  // docs/adr/0101: the steps of an accepted HANDOFF are also here, so a Strip whose row is scrolled out still has them.
  for (const step of handoffSteps(strip, acting)) {
    items.push({ group: 'Start', key: `handoff-${step.key.toLowerCase()}`, label: step.label, cls: 'efsp-coordinate-btn', enabled: step.enabled,
      reason: step.reason || '', title: step.title,
      run: (anchor) => (step.form ? _openControlReleasePopover(strip, anchor, step.form) : _dispatchHandoffStep(strip, step.key)) });
  }
  if (COORDINATION_TARGETS[strip.ownerPositionId]) {
    const ok = _canProposeCoordination(strip) && !!acting;
    let reason = '';
    if (!ok) {
      if (pendingIn) reason = answerFirst;
      else if (strip.coordination && strip.coordination.state === 'INITIATED') reason = 'a proposal is already open';
      else if (strip.coordination && strip.coordination.state === 'ACTIVE') reason = 'already coordinated';
      else reason = `not from ${String(strip.state).replace(/_/g, ' ')}`;
    }
    items.push({ group: 'Start', key: 'coordinate', label: 'Coordinate…', cls: 'efsp-coordinate-btn', enabled: ok, reason,
      title: `Propose a cross-Facility coordination to ${COORDINATION_TARGETS[strip.ownerPositionId].positionId}`,
      run: (anchor) => _openCoordinatePopover(strip, anchor) });
  }
  if (TOFI_COUNTERPARTS[strip.ownerPositionId] && strip.stripType !== 'MISSION') {
    if (_canProposeTofiExit(strip)) {
      items.push({ group: 'Start', key: 'tofi-exit', label: 'TOFI Exit…', cls: 'efsp-coordinate-btn', enabled: true,
        title: `Propose returning separation to ${strip.tofiCoordination.peerPositionId}`,
        run: () => _dispatchTofi(strip, 'PROPOSE', 'EXIT') });
    } else {
      const ok = _canProposeTofiEntry(strip);
      const tofi = strip.tofiCoordination;
      const reason = ok ? '' : pendingIn ? answerFirst
        : tofi && tofi.state === 'INITIATED' ? 'a TOFI proposal is already open'
          : `not from ${String(strip.state).replace(/_/g, ' ')}`;
      const counterparts = TOFI_COUNTERPARTS[strip.ownerPositionId];
      items.push({ group: 'Start', key: 'tofi', label: 'TOFI…', cls: 'efsp-coordinate-btn', enabled: ok, reason,
        title: 'Propose a Transfer of Flight Information to a Military Radar Unit',
        run: (anchor) => {
          if (counterparts.length === 1) _dispatchTofi(strip, 'PROPOSE', 'ENTRY', { target: counterparts[0] });
          else _openTofiEntryPopover(strip, anchor, counterparts);
        } });
    }
  }
  if (AIRSPACE_ENTRY_POSITIONS.includes(strip.ownerPositionId)) {
    const ok = _canApproveAirspaceEntry(strip) && !pendingIn;
    if (strip.airspaceEntry) {
      items.push({ group: 'Start', key: 'leave-airspace', label: 'Leave airspace', cls: 'efsp-coordinate-btn', enabled: ok,
        reason: ok ? '' : answerFirst,
        run: () => { if (acting) sendEfspMutation(acting, strip, { kind: 'ClearAirspaceEntry' }); } });
    } else {
      items.push({ group: 'Start', key: 'airspace', label: 'Airspace…', cls: 'efsp-coordinate-btn', enabled: ok,
        reason: ok ? '' : answerFirst, title: 'Approve this flight into an airspace, on its frequency',
        run: (anchor) => _openAirspaceEntryPopover(strip, anchor) });
    }
  }

  // Flight
  if (acting) {
    items.push({ group: 'Flight', key: 'marsa', label: 'MARSA…', cls: 'efsp-marsa-btn', enabled: true,
      title: 'declare, or manage, military authority separating this flight from another',
      run: (anchor) => _openMarsaPopover(strip, anchor) });
  }
  // Formation (crc-sync docs/adr/0099): shown to a Position that holds the grant and owns this Strip.
  if (holdsFormationGrant(strip, getActingPositions())) {
    const flightData = getEfspFlightData(strip.flightDataId);
    const split = splitOffer(strip, flightData);
    if (split.ok || (flightData && flightData.identity && flightData.identity.flightSize >= 2)) {
      items.push({ group: 'Formation', key: 'split', label: 'Split…', cls: 'efsp-formation-btn', enabled: split.ok && !pendingIn,
        reason: split.ok ? answerFirst : split.reason, title: 'send part of this formation off with a new callsign and beacon code',
        run: (anchor) => _openSplitPopover(strip, anchor) });
    }
    const join = joinOffer(strip, getAllEfspStrips(), otherLiveStripsForFlightData(strip.flightDataId, strip.stripId));
    if (join.ok) {
      items.push({ group: 'Formation', key: 'join', label: 'Join formation…', cls: 'efsp-formation-btn', enabled: !pendingIn,
        reason: pendingIn ? answerFirst : '', title: 'this flight joins another of your formations and its Strip ends',
        run: (anchor) => _openJoinPopover(strip, anchor) });
    }
  }
  const record = getEfspCorrelationForStrip(strip);
  const correlation = correlationBadgeFor(strip);
  // H129 (live test T10): the ring is asked for here, not drawn on every selection. Listed while the flight has a
  // contact; disabled when that contact is outside this controller's picture.
  if (record && record.trackId && !(correlation && correlation.ambiguous)) {
    const inPicture = !!showOnMapTrackFor(strip);
    items.push({ group: 'Flight', key: 'show-on-map', label: 'Show on map', cls: 'efsp-show-on-map-btn', enabled: inPicture,
      reason: inPicture ? '' : 'outside your radar coverage', title: 'ring this flight on the map',
      run: () => { showStripOnMap(strip.stripId); } });
  }
  if (record && !(correlation && correlation.ambiguous)) {
    if (record.binding) {
      items.push({ group: 'Flight', key: 'unbind', label: 'Unbind', cls: 'efsp-correlation-btn', enabled: !!acting,
        title: 'give the contact back to the automatic matcher',
        run: () => _dispatchCorrelation(strip, { kind: 'UnbindTrack' }) });
    } else if (record.state === 'UNCORRELATED') {
      items.push({ group: 'Flight', key: 'bind', label: 'Bind…', cls: 'efsp-correlation-btn', enabled: !!acting,
        title: 'pick the contact this flight is',
        run: (anchor) => _openBindPopover(strip, anchor, null) });
    }
  }
  if (_canConvertToArrival(strip)) {
    const blockedBy = (strip.coordination && strip.coordination.state === 'INITIATED') ? 'an open coordination proposal'
      : (strip.tofiCoordination && strip.tofiCoordination.state === 'INITIATED') ? 'an open TOFI proposal'
        : (strip.tofiCoordination && strip.tofiCoordination.state === 'ACTIVE') ? 'active tactical control' : null;
    const annotated = Object.keys(strip.annotations || {}).length > 0;
    const armed = _pendingConvertStripId === strip.stripId;
    items.push({ group: 'Flight', key: 'convert', label: armed ? 'Convert — press again' : 'Convert to Arrival →',
      cls: 'efsp-spawn-return-btn' + (annotated ? ' efsp-confirm-needed' : ''), enabled: !blockedBy,
      reason: blockedBy ? `resolve ${blockedBy} first` : '',
      title: annotated
        ? `Turn this Strip into its return ARRIVAL leg at ${strip.ownerPositionId}. Its ${Object.keys(strip.annotations).length} annotation(s) are archived and cleared from the working Strip — press twice.`
        : `Turn this Strip into its return ARRIVAL leg at ${strip.ownerPositionId} — same Strip, same flight data, no duplicate`,
      // Two presses when it would clear annotations: there is no undo. The
      // first relabels the item in place and keeps the menu open.
      run: (anchor, itemEl) => {
        if (annotated && _pendingConvertStripId !== strip.stripId) {
          _setPendingConvertStripId(strip.stripId);
          itemEl.textContent = 'Convert — press again';
          return false;
        }
        _setPendingConvertStripId(null);
        convertStripToArrival(strip);
      } });
  }

  const divert = divertOffer(strip);
  if (divert) {
    const canAct = !!acting && acting === strip.ownerPositionId;
    items.push({ group: 'Flight', key: 'divert', label: 'Divert…', cls: 'efsp-divert-btn', enabled: divert.enabled && canAct,
      reason: !divert.enabled ? divert.reason : (!canAct ? `you do not hold ${strip.ownerPositionId}` : ''),
      title: 'a new destination and a new clearance for this flight',
      run: (anchor) => _openDivertPopover(strip, anchor) });
  }

  // Strip
  if (acting) {
    items.push({ group: 'Strip', key: 'offset', label: strip.flags.offset ? 'Un-offset ⇤' : 'Offset ⇥', cls: 'efsp-offset-btn',
      enabled: true, title: 'Offset (cock)', run: () => { const acting = _dispatchGesture(strip, toggleOffset); noteEfspGesture('OFFSET', 'menu', acting); } });
  }
  return items;
}

let _stripMenuHandle = null;

function _closeStripMenu() { if (_stripMenuHandle) _stripMenuHandle.close(); }

function _openStripMenu(strip, anchor) {
  const wasOpenHere = _stripMenuHandle && _stripMenuHandle.el.dataset.stripId === strip.stripId;
  _closeStripMenu();
  if (wasOpenHere) return; // the ⋯ button toggles
  strip = getEfspStrip(strip.stripId) || strip; // F-107: act on the live record
  const items = _stripMenuItems(strip);
  if (items.length === 0) return;

  const menu = _stripEl('div', 'efsp-strip-menu efsp-strip-menu-popover');
  menu.dataset.stripId = strip.stripId;
  menu.setAttribute('role', 'menu');
  let group = null;
  const buttons = [];
  for (const item of items) {
    if (item.group !== group) {
      group = item.group;
      menu.appendChild(_stripEl('div', 'efsp-strip-menu-group', group));
    }
    const btn = _stripEl('button', `efsp-strip-menu-item ${item.cls || ''}`, item.label);
    btn.setAttribute('role', 'menuitem');
    btn.dataset.stripAction = item.key;
    if (item.title) btn.title = item.title;
    if (!item.enabled) {
      btn.disabled = true;
      if (item.reason) {
        btn.title = item.reason;
        btn.appendChild(_stripEl('span', 'efsp-strip-menu-reason', item.reason));
      }
    } else {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Items that change the menu in place (Convert's first press) return false.
        const keepOpen = item.run(anchor, btn) === false;
        if (!keepOpen && _stripMenuHandle && _stripMenuHandle.el === menu) _closeStripMenu();
      });
      buttons.push(btn);
    }
    menu.appendChild(btn);
  }
  // Arrow keys move between the items that can be pressed; Esc is the panel's
  // own popover handler.
  menu.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = buttons.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length;
    if (buttons[next]) buttons[next].focus();
  });

  _stripMenuHandle = openPopover({
    el: menu, anchor, strip, focus: buttons[0] || null, onClose: () => { _stripMenuHandle = null; },
  });
}

export function _buildStripTools(strip) {
  const tools = _stripEl('div', 'efsp-strip-tools');
  if (_stripMenuItems(strip).length > 0) {
    const more = _stripEl('button', 'efsp-sbtn efsp-sbtn-icon efsp-strip-menu-btn', '⋯');
    more.title = 'More actions';
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', (e) => { e.stopPropagation(); _openStripMenu(strip, more); });
    more.addEventListener('pointerdown', (e) => e.stopPropagation());
    tools.appendChild(more);
  }
  _appendExpandButton(tools, strip);
  _appendDropButton(tools, strip);
  return tools;
}

// ── Assembly ───────────────────────────────────────────────────────────────
