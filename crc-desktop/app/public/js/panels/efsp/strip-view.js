'use strict';
import { getEfspFlightData } from './efsp-state.js';
import { clearEfspArrival, consumeEfspArrivalFlash, efspArrivalFlashElapsed, efspArrivalFor } from './efsp-arrivals.js';
import { blockLabelFor, blockTitleFor } from './strip-template.js';
import { nlaButtonLabel } from './efsp-nla.js';
import { isMarsaHighlighted, marsaBadgeFor } from './marsa-badge.js';
import { compactBlocksFor, fieldSpanFor, sideNumberLeads } from './strip-fields.js';
import { carrierDecorateNlaButton, carrierExtraNlaButtons } from './carrier-panel.js';
import { finalHandoffButtons, parCallButtons } from './bay-views.js';
import { _invokeNla, _resolveActingPositionId } from './bay/dispatch.js';
import { _buildBlockCell } from './bay/block-edit.js';
import { _buildCoordinationReasonEl } from './bay/popovers/coordination.js';
import { _isRejectedCoordinationReplica } from './bay/coordination-rules.js';
import { _dispatchTofi, _tofiExitPrecondition } from './bay/popovers/tofi.js';
import { _appendAnnotationHistory, _appendExpandedView, CHIP_HISTORY_LIMIT } from './bay/strip-expanded.js';
import { efspVisibleBayId } from './panel/state.js';
import { noteEfspArrivalShown } from './panel/arrivals.js';
import { isArHighlighted } from './ato-strip.js';
import { STRIP_TYPE_ABBR, _addClass, _stripButton, _stripEl } from './strip-dom.js';
import { _coordinationExchange, _marsaExchange, _pairedMissionStrip, _tofiExchange, _tofiExitIsPrimary, _trackExchange } from './strip-exchanges.js';
import { _stripAlerts } from './strip-alerts.js';
import { _buildIndicatorSlots } from './strip-indicators.js';
import { PATTERN_STATE, stateDisplayLabel } from './pattern-rules.js';
import { _buildStripTools } from './strip-menu.js';
import { _buildRemarksRow } from './strip-remarks.js';

// The Strip's face: Layout C (docs/adr/0056).
//
//   ┌──────────── tab ────────────┬──────────── main ─────────────┬ tools ┐
//   │ DEP · HANDED OFF            │ CALLSIGN  TYPE  BEACON  …      │  ⋯     │
//   │ ── one row per exchange ──  │ [TRK] [MARSA] [TOFI] …         │  ▼     │
//   │ HANDOFF ← AP   [Rej][Acc]   │ ▲ reason, a full line          │  ✕     │
//   │ ── next step ──  [ NLA ]    │ (expanded view)                │        │
//   └─────────────────────────────┴───────────────────────────────┴────────┘
//
// Where a control goes is a rule, so the next feature lands without the layout
// changing:
//   tab row     an exchange in progress, with its own answer buttons
//   tab bottom  the one next step (the NLA)
//   ⋯ menu      everything the controller starts
//   indicators  standing state, always drawn, lit or dim, never clickable
//   tools       ⋯ ▼ ✕
//
// Called from bay/strip-element.js's _buildStripEl. The pieces live beside it (DESK-SPLIT): strip-dom.js (element
// builders), strip-exchanges.js (the tab's exchange rows), strip-alerts.js (the alert chips), strip-indicators.js (the
// indicator slots) and strip-menu.js (the tools column and the menu); this file assembles them. The gates
// (_canProposeTofiEntry and friends) stay in bay/popovers/, where efsp-coordination-client.test.mjs's drift checks find them.

/** The NLA (§3.5), and the reason it is refused, from the server's own `strip.nla` (F-408). */
function _buildLifeBlock(strip) {
  const life = _stripEl('div', 'efsp-strip-life');
  // UI-A U8: the mission line is leaving, so the next step on CTR's Strip is the TOFI Exit, not the NLA.
  if (_tofiExitIsPrimary(strip)) {
    const mission = _pairedMissionStrip(strip);
    life.appendChild(_stripButton('TOFI Exit', 'efsp-tofi-exit-btn', {
      go: true, action: 'tofi-exit-primary',
      disabled: !_resolveActingPositionId(strip),
      title: `The mission line is ${String(mission.state).replace(/_/g, ' ')}: propose returning separation to ${strip.tofiCoordination.peerPositionId}`,
      onClick: (e, btn) => { btn.disabled = true; _dispatchTofi(strip, 'PROPOSE', 'EXIT'); },
    }));
    return { life, inhibited: null };
  }
  const nlaStatus = strip.nla;
  const nlaLabel = nlaStatus === null ? null : nlaButtonLabel(strip); // a carrier handoff is labelled by its own name (docs/adr/0074)
  let inhibited = null;
  if (nlaLabel) {
    // Drop is the terminal step, not the one filled "go" button.
    const btn = _stripEl('button', `efsp-sbtn${nlaLabel === 'Drop' ? '' : ' efsp-sbtn-go'} efsp-nla-btn`, nlaLabel);
    inhibited = (nlaStatus && nlaStatus.inhibited) || null;
    if (inhibited) {
      btn.disabled = true;
      _addClass(btn, 'efsp-nla-btn-denied');
      btn.title = inhibited;
      btn.dataset.nlaReason = nlaStatus.reason || '';
    } else {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // §7.9: the button goes dead on the press rather than on the ack.
        if (_invokeNla(strip)) btn.disabled = true;
      });
    }
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    carrierDecorateNlaButton(btn, strip);
    life.appendChild(btn);
  }
  // The carrier's second handoff, beside the NLA (crc-sync docs/adr/0074): "See you" in Case II.
  for (const extra of carrierExtraNlaButtons(strip)) life.appendChild(extra);
  // The single frequency approach (crc-sync docs/adr/0117): "Hand off to PAR" beside the NLA on AP's arrival on a rotating frequency.
  for (const extra of finalHandoffButtons(strip)) life.appendChild(extra);
  // The airfield final controller's next call (H138 U10, crc-sync docs/adr/0117): Begin descent, then Cleared to land.
  for (const extra of parCallButtons(strip)) life.appendChild(extra);
  return { life, inhibited };
}

function _buildStripTab(strip, arrival) {
  const tab = _stripEl('div', 'efsp-strip-tab');
  tab.appendChild(_stripEl('div', 'efsp-strip-tab-type',
    `${STRIP_TYPE_ABBR[strip.stripType] || strip.stripType} · ${stateDisplayLabel(strip.state)}`)); // IN PATTERN: crc-sync docs/adr/0126
  // Just arrived from another controller (docs/adr/0057): who from, in amber,
  // until the controller touches the Strip or 30 s after they first saw it.
  if (arrival) tab.appendChild(_stripEl('div', 'efsp-strip-from', `from ${arrival.from}`));
  const rows = [_coordinationExchange(strip), _tofiExchange(strip), _marsaExchange(strip), _trackExchange(strip)]
    .filter(Boolean);
  for (const row of rows) tab.appendChild(row);
  const { life, inhibited } = _buildLifeBlock(strip);
  tab.appendChild(life);
  return { tab, rows, inhibited };
}

// ── Fields ─────────────────────────────────────────────────────────────────

function _buildStripFields(strip) {
  const grid = _stripEl('div', 'efsp-strip-fields');
  const flightData = getEfspFlightData(strip.flightDataId);
  const sideLeads = sideNumberLeads(strip.stripType, strip.ownerPositionId, flightData); // H122: on a carrier Strip the side number has the callsign's slot
  for (const id of compactBlocksFor(strip.stripType, strip.ownerPositionId, flightData)) {
    const span = fieldSpanFor(id, sideLeads);
    const chip = _stripEl('span', `efsp-block-chip efsp-field${span > 1 ? ' efsp-field-w' + span : ''}`);
    const label = blockLabelFor(id, strip.stripType);
    const labelEl = _stripEl('span', 'efsp-block-label', label || '');
    const title = blockTitleFor(id, getEfspFlightData(strip.flightDataId), null, strip.stripType); if (title) labelEl.title = title; // docs/adr/0062, T8
    // §3.7 rule 2's "in the same Block": the current value keeps the field; the
    // latest superseded value sits small and struck beside the label, with a
    // count of the rest. The whole chain is in the expanded view.
    _appendAnnotationHistory(labelEl, strip, id, CHIP_HISTORY_LIMIT);
    chip.appendChild(labelEl);
    chip.appendChild(_buildBlockCell(strip, id));
    grid.appendChild(chip);
  }
  return grid;
}

// ── Indicators ─────────────────────────────────────────────────────────────

/** Every sentence the Strip owes the controller, each a full line (F-006). */
function _buildReasonLines(strip, inhibited, alerts = []) {
  const lines = [];
  // Conflicts and conformance first: the most urgent thing on the Strip.
  for (const a of alerts) {
    lines.push(_stripEl('div', `efsp-strip-reason${a.tone === 'bad' ? ' efsp-strip-reason-bad' : ''} efsp-alert-reason`, a.reason));
  }
  if (inhibited) {
    const why = _stripEl('div', 'efsp-strip-reason efsp-nla-inhibit-reason', inhibited);
    why.title = inhibited;
    lines.push(why);
  }
  const tofi = strip.tofiCoordination;
  if (tofi && tofi.state !== 'REJECTED') {
    const blocking = _tofiExitPrecondition(strip, tofi);
    if (blocking) {
      const why = _buildCoordinationReasonEl(blocking);
      _addClass(why, 'efsp-strip-reason');
      lines.push(why);
    }
  }
  const marsa = marsaBadgeFor(strip);
  if (marsa && marsa.voidReason) {
    lines.push(_stripEl('div', 'efsp-strip-reason efsp-strip-reason-bad efsp-marsa-void-reason', marsa.voidReason));
  } else if (marsa && marsa.armed) {
    lines.push(_stripEl('div', 'efsp-strip-reason efsp-marsa-armed-reason',
      'MARSA is armed. Assigning a heading or altitude before rendezvous will void it.'));
  }
  return lines;
}

// ── The ⋯ menu ─────────────────────────────────────────────────────────────

export function _buildStripLayout(el, strip, obligation) {
  el.classList.add('efsp-strip-c');
  if (strip.state === PATTERN_STATE) el.classList.add('efsp-strip-in-pattern'); // crc-sync docs/adr/0126: grey, no colour
  if (_isRejectedCoordinationReplica(strip)) el.classList.add('efsp-strip-inert');
  if (isMarsaHighlighted(strip.stripId)) {
    el.classList.add('efsp-strip-marsa-participant');
  }
  if (isArHighlighted(strip.stripId)) el.classList.add('efsp-strip-ar-participant');

  const arrival = efspArrivalFor(strip.stripId);
  if (arrival) {
    el.classList.add('efsp-strip-arrived');
    // The flash plays on the first build the controller can SEE, and never
    // again: rebuilding for any other reason shows the steady amber edge.
    const onScreen = efspVisibleBayId() === strip.bayId;
    if (onScreen && consumeEfspArrivalFlash(strip.stripId)) {
      el.classList.add('efsp-strip-arrived-flash');
      noteEfspArrivalShown();
    } else if (onScreen) {
      // Rebuilt while the flash is still playing: carry it on from where it was (a negative delay).
      const elapsed = efspArrivalFlashElapsed(strip.stripId);
      if (elapsed !== null) {
        el.classList.add('efsp-strip-arrived-flash');
        if (el.style && el.style.setProperty) el.style.setProperty('--efsp-arrived-flash-delay', `-${elapsed}ms`);
      }
    }
    // Touching the Strip is noticing it. Cleared in place rather than by a
    // re-render: this is also how a drag starts, and rebuilding the element
    // under a starting drag would drop it.
    const noticed = () => {
      if (!efspArrivalFor(strip.stripId)) return;
      clearEfspArrival(strip.stripId);
      el.classList.remove('efsp-strip-arrived', 'efsp-strip-arrived-flash');
      const from = el.querySelector && el.querySelector('.efsp-strip-from');
      if (from && from.remove) from.remove();
    };
    // A pointer press is noticed when it ENDS, never at pointerdown (MARSHAL-FIX). Taking the "from" line out
    // moves everything below it in the tab, the step buttons included, and a press whose pointerup lands on a
    // different button than its pointerdown is no click at all: the first press of "Comms to CV_MARSHAL" on a
    // just-accepted Strip did nothing (its pointerup hit "Control to …", which had moved up under the pointer).
    // Also clearing the arrival at pointerdown changed the render signature (`arr:`), so any render during
    // the press rebuilt the Strip under the button. The keyboard path is unchanged: a key press moves no pointer.
    const noticeOnRelease = () => {
      const done = () => {
        document.removeEventListener('pointerup', done, true);
        document.removeEventListener('pointercancel', done, true);
        noticed();
      };
      document.addEventListener('pointerup', done, true);
      document.addEventListener('pointercancel', done, true);
    };
    el.addEventListener('pointerdown', noticeOnRelease, true);
    el.addEventListener('keydown', noticed, true);
  }

  const { tab, rows, inhibited } = _buildStripTab(strip, arrival);
  if (rows.some(r => r.classList.contains('efsp-x-in'))) el.classList.add('efsp-strip-needs');

  const alerts = _stripAlerts(strip);
  if (alerts.some(a => a.tone === 'bad')) el.classList.add('efsp-strip-alert');
  else if (alerts.length) el.classList.add('efsp-strip-alert-attn');

  const main = _stripEl('div', 'efsp-strip-main');
  main.appendChild(_buildStripFields(strip));
  const slots = _buildIndicatorSlots(strip, el, obligation, alerts);
  if (slots) main.appendChild(slots);
  for (const line of _buildReasonLines(strip, inhibited, alerts)) main.appendChild(line);
  const remarks = _buildRemarksRow(strip); // H138 U2: the bottom row, only when there are remarks
  if (remarks) main.appendChild(remarks);
  _appendExpandedView(main, strip);

  // The grid is one level down because the Strip itself is the size container
  // (efsp-panel.css), and a container query cannot restyle its own container.
  const grid = _stripEl('div', 'efsp-strip-grid');
  grid.appendChild(tab);
  grid.appendChild(main);
  grid.appendChild(_buildStripTools(strip));
  el.appendChild(grid);
}
