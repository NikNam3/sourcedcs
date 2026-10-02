'use strict';
import { _cachePanelElements, _efspPanelRootEl, _mutationErrorEl } from './panel/state.js';
import { _loadStereoRoutes, _refreshCreateStripAvailability, _wireCreateStrip } from './panel/create-strip.js';
import { _renderPositionTabs } from './panel/tabs.js';
import { _wireDotCommand } from './panel/dot-commands.js';
import { dismissEfspRefusal } from './panel/refusal.js';
import { getEfspCorrelationStats } from './efsp-state.js';
import { initAtoImport } from './ato-import.js';
import { renderEfspScrambleLine } from './scramble.js';
import { renderUndoSlot, wireUndoKeys } from './panel/undo-slot.js';
import { startEfspStalenessCheck } from './panel/staleness.js';

// The feature modules live in panel/ (ESM-2b): state.js (shared state), staleness.js, tabs.js (Position and Bay
// tabs, search), arrivals.js, create-strip.js, refusal.js (refusal banner, warning, mutation acks) and
// dot-commands.js. This file keeps init and the refresh entry point, and re-exports every name it exported before.
export { _activePositionTab, _activeBayId, _setActivePositionTab, _setActiveBayId, _setBayContentElForTest } from './panel/state.js';
export { noteEfspHeartbeat } from './panel/staleness.js';
export { computePositionTabs, _runEfspSearch, getActiveEfspSearchQuery, _renderPositionTabs, efspVisibleBayId } from './panel/tabs.js';
export { noteEfspBoardArrivals, noteEfspArrivalShown } from './panel/arrivals.js';
export { reloadEfspStereoRoutes, convertStripToArrival, createStripFromFiledPlan } from './panel/create-strip.js';
export {
  MUTATION_ERROR_VISIBLE_MS, MUTATION_ERROR_MESSAGES, _callsignOfFlightData, _showMutationError, getCurrentEfspRefusal,
  _showMutationWarning, notifyEfspOrphanedMutation, notifyEfspMutationAck, _setCurrentRefusalForTest
} from './panel/refusal.js';
export { _dispatchDotCommand } from './panel/dot-commands.js';

// Top-level EFSP panel — mounted via dock.js's mountExistingPanel('efsp-
// panel', initEfspPanel). Owns the position-tab / Bay-tab chrome (guide
// §4.2/§4.8.5: "Bays MUST stay grouped by Position, never merged into one
// undifferentiated pile... one Bay in view, the rest reachable through
// header drop zones" — vStrips' model) and the dot-command input; actual
// Strip/Rack rendering is bay-view.js's job. DOM-only, not unit tested —
// same reasoning as bay-view.js's own header comment.
//
// Element references are cached ONCE in initEfspPanel(), not re-looked-up
// via document.getElementById() on every render. This isn't a style
// preference — it's required: dockview's mountExistingPanel (dock.js)
// DETACHES a panel's root element from `document` whenever it isn't the
// active tab in its group (the element stays alive in memory — dockview
// re-attaches the exact same reference later — but document.getElementById
// stops finding it while detached, per dock.js's own comment on
// _legacyPanelState). Every other panel in this codebase already
// follows this pattern for exactly this reason. This file originally didn't, which meant every
// render after the Strip panel tab lost focus silently no-op'd — the
// "held OPS but panel still says no Position" bug.

/** Called from app.js after any efsp-snapshot/efsp-board-delta/efsp-positions-ack lands — safe to call even when the Strip panel has never been opened yet (every render function no-ops until initEfspPanel() has cached its elements) or is currently the inactive tab (cached element references stay valid while detached — see the module comment). */
export function refreshEfspPanel() {
  _renderPositionTabs();
  _refreshCreateStripAvailability();
  _renderCorrelationRate();
  renderEfspScrambleLine();
}

/**
 * One line: how many eligible flights are matched to a surveillance contact
 * (guide §6.6 rule 6 — "If it drops below 95% in operation, that is a defect,
 * not a fact of life"), red below the target.
 *
 * Hidden when the server reports null, which it does for an empty board — a
 * board with nothing on it is not 100% correlated, and saying so would make
 * the number meaningless exactly when a controller first looks at it.
 */
function _renderCorrelationRate() {
  const el = document.getElementById('efsp-correlation-rate');
  if (!el) return;
  const stats = getEfspCorrelationStats();
  if (!stats || stats.rate == null) { el.textContent = ''; el.className = ''; return; }
  const matched = Math.round(stats.rate * stats.eligible);
  el.textContent = `TRK ${Math.round(stats.rate * 100)}% (${matched}/${stats.eligible})`;
  el.className = stats.rate < (stats.target ?? 0.95) ? 'efsp-correlation-rate-low' : '';
  el.title = 'flights matched to a surveillance contact'
    + (stats.sessionRate != null ? ` \u00b7 session ${Math.round(stats.sessionRate * 100)}%` : '');
}

export function initEfspPanel() {
  _cachePanelElements();
  if (_mutationErrorEl) {
    // Dismissible (F-103). The banner is its own dismiss target rather than
    // growing a ✕ child, because everything that reads it — the e2e helpers,
    // the Strip-level marker — reads its textContent, and a control inside it
    // would end up in that text.
    _mutationErrorEl.style.cursor = 'pointer';
    _mutationErrorEl.addEventListener('click', dismissEfspRefusal);
  }

  _wireCreateStrip();
  _wireDotCommand();
  wireUndoKeys(_efspPanelRootEl); // docs/adr/0100 §10: Ctrl+Z
  renderUndoSlot();
  initAtoImport(_efspPanelRootEl); // docs/adr/0071
  _loadStereoRoutes();
  _renderPositionTabs();
  startEfspStalenessCheck();
  return { onShow: () => { _renderPositionTabs(); _refreshCreateStripAvailability(); } };
}
