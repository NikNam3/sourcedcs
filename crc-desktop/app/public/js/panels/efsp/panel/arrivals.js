'use strict';
import { _bayTabsEl, _setActiveBayId, _setActivePositionTab } from './state.js';
import { _renderPositionTabs } from './tabs.js';
import { efspVisibleBayId } from './state.js';
import { efspArrivalLog, forgetEfspArrivals, nextEfspArrivalExpiry, noteEfspArrivals } from '../efsp-arrivals.js';
import { getActingPositions } from '../efsp-ws.js';
import { getEfspFlightData, getEfspPosition } from '../efsp-state.js';
import { selectEfspStripById } from '../bay/selection.js';
import { markEfspChanged } from '../efsp-change-bus.js';

/**
 * The line under the Bay tabs: Strips that landed in a Bay the controller is
 * NOT looking at, and where from. Clicking one opens that Bay and selects the
 * Strip. An arrival in the Bay on screen is never listed — the Strip itself
 * flashes and carries its "from" line.
 */
// Cached, never looked up with document.getElementById: while dockview has the Strip panel
// detached (another tab of its group in front) the lookup fails and a new line was inserted on
// every render, so the arrivals list stacked up (S-L1b finding; the airspace-panel rule).
let _arrivalsLineEl = null;

export function _renderArrivalsLine() {
  if (!_bayTabsEl) return;
  let line = _arrivalsLineEl;
  if (!line) {
    line = document.createElement('div');
    line.id = 'efsp-arrivals-line';
    _arrivalsLineEl = line;
  }
  if (_bayTabsEl.parentNode && line.parentNode !== _bayTabsEl.parentNode && typeof _bayTabsEl.parentNode.insertBefore === 'function') {
    _bayTabsEl.parentNode.insertBefore(line, _bayTabsEl.nextSibling);
  }
  const entries = efspArrivalLog();
  line.innerHTML = '';
  line.hidden = entries.length === 0;
  for (const e of entries) {
    const row = document.createElement('button');
    row.className = 'efsp-arrival-row';
    row.dataset.stripId = e.stripId;
    row.title = `open ${e.bayId} and select ${e.callsign}`;
    for (const [cls, text] of [['efsp-arrival-cs', e.callsign], ['efsp-arrival-bay', `→ ${e.bayId}`], ['efsp-arrival-from', `from ${e.from}`]]) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      row.appendChild(span);
    }
    row.addEventListener('click', () => {
      _setActivePositionTab(e.positionId);
      _setActiveBayId(e.bayId);
      _renderPositionTabs();
      selectEfspStripById(e.stripId);
    });
    line.appendChild(row);
  }
}

let _arrivalExpiryTimer = null;

/** Redraw when the next seen arrival's amber edge runs out, so it fades on time on a quiet Board. */
function _scheduleArrivalExpiry() {
  const next = nextEfspArrivalExpiry(Date.now());
  if (_arrivalExpiryTimer) { clearTimeout(_arrivalExpiryTimer); _arrivalExpiryTimer = null; }
  if (next === null) return;
  _arrivalExpiryTimer = setTimeout(() => {
    _arrivalExpiryTimer = null;
    markEfspChanged('bays');
    _scheduleArrivalExpiry();
  }, Math.max(50, next - Date.now() + 20));
}

/** app.js, after an efsp-board-delta is applied — see efsp-arrivals.js for the rule. */
export function noteEfspBoardArrivals(msg, placementBefore) {
  const signedOn = getActingPositions();
  const mine = new Set();
  for (const positionId of signedOn) {
    const p = getEfspPosition(positionId);
    if (p && p.primary && p.primary.controllerId) mine.add(p.primary.controllerId);
  }
  noteEfspArrivals(placementBefore, (msg.strips && msg.strips.updated) || [], {
    signedOnPositions: signedOn, myControllerIds: mine, visibleBayId: efspVisibleBayId(), now: Date.now(),
    callsignOf: (strip) => {
      const flightData = getEfspFlightData(strip.flightDataId);
      return (flightData && flightData.identity && flightData.identity.callsign) || strip.stripId;
    },
  });
  forgetEfspArrivals(msg.strips && msg.strips.gone);
}

/** strip-view.js, once a new Strip's flash has played: start the fade-out clock. */
export function noteEfspArrivalShown() { _scheduleArrivalExpiry(); }
