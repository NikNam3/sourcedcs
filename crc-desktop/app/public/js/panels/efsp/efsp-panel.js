'use strict';

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
// _legacyPanelState). Every other panel in this codebase (e.g.
// squawk-panel.js's initCallsPanel) already follows this pattern for
// exactly this reason. This file originally didn't, which meant every
// render after the Strip panel tab lost focus silently no-op'd — the
// "held OPS but panel still says no Position" bug.

let _activePositionTab = null;
let _activeBayId = null;

// Cached once in initEfspPanel() — see the module comment above for why
// this can't be a fresh document.getElementById() per render.
let _positionTabsEl = null;
let _bayTabsEl = null;
let _bayContentEl = null;
let _createStripInputEl = null;
let _createStripBtnEl = null;
let _createStripMsgEl = null;
let _dotCommandInputEl = null;
let _dotCommandPreviewEl = null;
let _mutationErrorEl = null;
let _mutationErrorClearTimer = null;
let _mutationWarningEl = null;
let _mutationWarningClearTimer = null;
let _connectionBannerEl = null;
let _efspPanelRootEl = null; // cached, not document.getElementById() per check — same detached-DOM reasoning as every other element above

// Board staleness (guide §5.6 rule 5) — lastEfspHeartbeatAt is set on every
// efsp-heartbeat (app.js), independent of Bay/Position state, so it keeps
// ticking even while the panel is an inactive dock tab. The interval polls
// it rather than scheduling a fresh timeout per heartbeat — simpler, and
// the check itself is cheap (see isEfspBoardStale in efsp-nla.js).
let _lastEfspHeartbeatAt = null;
let _staleCheckInterval = null;

function noteEfspHeartbeat() {
  _lastEfspHeartbeatAt = Date.now();
}

function _checkEfspStaleness() {
  if (!_connectionBannerEl) return;
  const stale = isEfspBoardStale(_lastEfspHeartbeatAt, Date.now());
  if (_efspPanelRootEl) _efspPanelRootEl.classList.toggle('efsp-board-stale', stale);
  _connectionBannerEl.textContent = stale ? 'Board may be out of date — no update received' : '';
}

// Search Bay (guide §4.3 rule 2, defect D2 — "the longest ground-control
// dwells occurred searching the Pending bay"). A client-local pseudo-Bay,
// not Board state — see efsp-state.js's searchEfspStrips module comment
// for why. _searchQuery is null when no search is active for the current
// Position tab; switching Position tabs implicitly drops it (matches the
// existing "Bay set recomposes on Position change" behavior elsewhere).
let _searchQuery = null;
let _searchInvocationCount = 0; // minimal §4.3 rule 3 / §11.5 instrumentation hook — WP8 builds a real dashboard on this later

function _searchBayId(positionId) { return `${positionId}-search`; }

function _positionsWithBays() {
  const bays = getEfspBays();
  const held = getActingPositions();
  const byPosition = {};
  for (const b of bays) {
    if (!held.includes(b.positionId)) continue;
    (byPosition[b.positionId] = byPosition[b.positionId] || []).push(b);
  }
  if (_searchQuery != null && _activePositionTab && held.includes(_activePositionTab)) {
    const positionId = _activePositionTab;
    (byPosition[positionId] = byPosition[positionId] || []).push({
      bayId: _searchBayId(positionId), positionId, rackIds: ['results'],
    });
  }
  return byPosition;
}

/** Runs (or clears, on an empty query) a search — one input, guide §4.3. Activates the search Bay for the current Position tab. */
function _runEfspSearch(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) {
    _searchQuery = null;
    if (_activeBayId && _activeBayId.endsWith('-search')) _activeBayId = null;
    _renderPositionTabs();
    return;
  }
  _searchInvocationCount += 1;
  console.log('[efsp] search #' + _searchInvocationCount + ':', trimmed);
  _searchQuery = trimmed;
  if (_activePositionTab) _activeBayId = _searchBayId(_activePositionTab);
  _renderPositionTabs();
}

/** Read by bay-view.js's renderBay() when asked to render a search pseudo-Bay — see its `-search` bayId branch. */
function getActiveEfspSearchQuery() { return _searchQuery; }

function _renderPositionTabs() {
  if (!_positionTabsEl) return; // not initialized yet — initEfspPanel() hasn't run
  const byPosition = _positionsWithBays();
  const positionIds = Object.keys(byPosition);
  if (!positionIds.includes(_activePositionTab)) _activePositionTab = positionIds[0] || null;

  _positionTabsEl.innerHTML = '';
  for (const positionId of positionIds) {
    const tab = document.createElement('button');
    tab.className = 'efsp-position-tab' + (positionId === _activePositionTab ? ' active' : '');
    tab.textContent = positionId;
    // Doubles as a drag drop-zone (guide §4.2: "other Bays reachable
    // through header drop zones that double as drag targets") —
    // bay-view.js hit-tests for this attribute during a drag and issues a
    // TransferStrip to this Position's default Bay on drop. NOTE: only
    // Positions this controller currently HOLDS get a tab at all (see
    // _positionsWithBays), so a single-Position controller has no tab to
    // drop a handoff onto for a Position they don't hold themselves — a
    // real gap for the single-controller-per-Position case, not just the
    // combined-Position testing case this covers today.
    tab.dataset.efspDropPosition = positionId;
    tab.addEventListener('click', () => {
      _activePositionTab = positionId;
      _activeBayId = null;
      _renderPositionTabs();
    });
    _positionTabsEl.appendChild(tab);
  }

  if (positionIds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'efsp-empty';
    empty.textContent = 'No Position held — select one in Panels.';
    _positionTabsEl.appendChild(empty);
  }

  _renderBayTabs();
}

function _renderBayTabs() {
  if (!_bayTabsEl || !_bayContentEl) return;
  const bays = _positionsWithBays()[_activePositionTab] || [];
  if (!bays.some(b => b.bayId === _activeBayId)) _activeBayId = bays[0] ? bays[0].bayId : null;

  _bayTabsEl.innerHTML = '';
  for (const bay of bays) {
    const isSearchBay = bay.bayId.endsWith('-search');
    const tab = document.createElement('button');
    tab.className = 'efsp-bay-tab' + (bay.bayId === _activeBayId ? ' active' : '') + (isSearchBay ? ' efsp-bay-tab-search' : '');
    tab.textContent = isSearchBay ? `🔍 ${_searchQuery}` : bay.bayId;
    // A Bay-tab drop target picks the EXACT Bay (rather than the
    // Position's default one) — see bay-view.js's _finishDrag. Search is a
    // client-local pseudo-Bay (guide §4.3), so it deliberately does NOT
    // get a drop-target dataset — it's not a real destination server-side.
    if (!isSearchBay) {
      tab.dataset.efspDropPosition = bay.positionId;
      tab.dataset.efspDropBay = bay.bayId;
    }
    tab.addEventListener('click', () => {
      _activeBayId = bay.bayId;
      _renderBayTabs();
    });
    _bayTabsEl.appendChild(tab);

    if (isSearchBay) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'efsp-bay-tab-search-close';
      closeBtn.textContent = '×';
      closeBtn.title = 'Close search';
      closeBtn.addEventListener('click', (e) => { e.stopPropagation(); _runEfspSearch(''); });
      _bayTabsEl.appendChild(closeBtn);
    }
  }

  if (_activeBayId) {
    setOpenEfspBays([{ containerEl: _bayContentEl, bayId: _activeBayId }]);
    renderBay(_bayContentEl, _activeBayId);
  } else {
    _bayContentEl.innerHTML = '<div class="efsp-empty">No Bay available.</div>';
    setOpenEfspBays([]);
  }
}

// Deliberately NOT window.prompt() — it's the only blocking native dialog
// anywhere in this codebase (grepped: zero other uses of prompt/alert/
// confirm), Electron's support for it is inconsistent across versions/
// webPreferences, and every other input flow here already uses an inline
// form (see squawk-panel.js's sqmap-code-input/sqmap-add for the exact
// pattern this mirrors). A silent no-op from a dialog that doesn't fire is
// indistinguishable from a broken button — this doesn't have that failure
// mode, and every rejection path is now visible instead of silent too.

let _pendingCreateStripMutationId = null;

function _setCreateStripMsg(text, isError) {
  if (!_createStripMsgEl) return;
  _createStripMsgEl.textContent = text || '';
  _createStripMsgEl.classList.toggle('efsp-msg-error', !!isError);
}

function _refreshCreateStripAvailability() {
  if (!_createStripInputEl || !_createStripBtnEl) return;
  const canCreate = getActingPositions().includes('OPS');
  _createStripInputEl.disabled = !canCreate;
  _createStripBtnEl.disabled = !canCreate;
  if (!canCreate) {
    _setCreateStripMsg('OPS only — select OPS in Panels to create Strips', true);
  } else if (!_pendingCreateStripMutationId) {
    // Clear a stale "OPS only"/validation message once OPS is selected —
    // but never stomp "Creating…" while an attempt is still in flight.
    _setCreateStripMsg('', false);
  }
}

function _submitCreateStrip() {
  if (!_createStripInputEl) return;

  if (!getActingPositions().includes('OPS')) {
    _setCreateStripMsg('OPS only — select OPS in Panels to create Strips', true);
    return;
  }
  const callsign = _createStripInputEl.value.trim().toUpperCase();
  if (!callsign) {
    _setCreateStripMsg('Enter a callsign first', true);
    return;
  }
  if (!/^[A-Z0-9]{1,7}$/.test(callsign)) {
    _setCreateStripMsg('Callsign must be 1-7 alphanumeric characters', true);
    return;
  }

  _pendingCreateStripMutationId = sendEfspCreateStrip('OPS', {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main',
    fdr: {
      callsign, aircraftType: '', wakeCategory: '',
      departureAirport: '', destinationAirport: '', route: '', requestedAltitude: '',
    },
  });
  _createStripInputEl.value = '';
  _setCreateStripMsg('Creating…', false);
}

// Rejections that reach here have no other visible surface — a dragged
// Strip that gets refused (e.g. by board-store.js's bay-implied-state
// validation: "you can't drop this here, it'd skip a doctrine check")
// just silently snaps back to where it was otherwise, indistinguishable
// from the drag not registering at all. Auto-clears after a few seconds
// rather than sitting there forever once the controller's moved on.
function _showMutationError(reason, detail) {
  if (!_mutationErrorEl) return;
  clearTimeout(_mutationErrorClearTimer);
  _mutationErrorEl.textContent = detail ? `${reason}: ${detail}` : reason;
  _mutationErrorClearTimer = setTimeout(() => { _mutationErrorEl.textContent = ''; }, 6000);
}

// A warning is NOT a rejection — the Mutation was accepted (guide §3.10.2
// rule 7: a duplicate beacon code "raise[s] an alert, never a hard block").
// Kept visually distinct from _showMutationError (amber, not red) so a
// controller never mistakes "accepted, but note this" for "refused".
const MUTATION_WARNING_MESSAGES = {
  DUPLICATE_IGNORED_WARNING: 'Duplicate beacon code — assigned anyway, per policy',
};

function _showMutationWarning(warning) {
  if (!_mutationWarningEl) return;
  clearTimeout(_mutationWarningClearTimer);
  _mutationWarningEl.textContent = MUTATION_WARNING_MESSAGES[warning] || warning;
  _mutationWarningClearTimer = setTimeout(() => { _mutationWarningEl.textContent = ''; }, 6000);
}

/**
 * Called from app.js after every efsp-mutation-ack. Two things happen on
 * rejection: (1) the general error banner always shows the reason (so a
 * refused drag/drop is never silent — see _showMutationError above), and
 * (2) if this ack is specifically the CreateStrip we're waiting on,
 * "Creating…" is replaced with the concrete rejection reason too. Without
 * (2), a rejected CreateStrip (e.g. a malformed callsign that slipped past
 * client-side validation) would silently vanish exactly like the old
 * window.prompt() bug did.
 */
/**
 * Called from app.js when replayPendingEfspMutations() (efsp-state.js)
 * finds a pending Mutation whose target Strip no longer exists in the
 * fresh post-reconnect snapshot (guide §5.6.3). This is the orphaned case
 * — surfaced, never silently dropped, per defect D6.
 */
function notifyEfspOrphanedMutation(original) {
  const label = original.op && original.op.kind ? original.op.kind : 'change';
  _showMutationError('Could not resync', `a pending ${label} could not be replayed — its target Strip no longer exists`);
}

function notifyEfspMutationAck(clientMutationId, result) {
  if (!result.ok) _showMutationError(result.reason || 'Rejected', result.detail);
  else if (result.warning) _showMutationWarning(result.warning);
  if (clientMutationId !== _pendingCreateStripMutationId) return;
  _pendingCreateStripMutationId = null;
  _setCreateStripMsg(result.ok ? '' : `Rejected: ${result.reason || 'unknown error'}`, !result.ok);
}

function _wireCreateStrip() {
  if (!_createStripBtnEl || !_createStripInputEl) return;
  _createStripBtnEl.addEventListener('click', _submitCreateStrip);
  _createStripInputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') _submitCreateStrip(); });
  _refreshCreateStripAvailability();
}

// Phase 1's minimal dot-command vocabulary (guide §7.1 rule 5 specifies
// the input surface, not a fixed verb set for DEPARTURE strips) — grows
// here without changing dot-command.js's parser.
function _dispatchDotCommand(parsed) {
  // .find doesn't target a selected Strip at all — handle it before the
  // strip-selection-dependent verbs below need one.
  if (parsed.verb === 'find') {
    _runEfspSearch(parsed.args.join(' '));
    return;
  }

  const stripId = getSelectedEfspStripId();
  const strip = stripId ? getEfspStrip(stripId) : null;
  if (!strip) return;
  const positions = getActingPositions();
  const actingPositionId = positions.includes(strip.ownerPositionId) ? strip.ownerPositionId : positions[0];
  if (!actingPositionId) return;

  if (parsed.verb === 'drop') {
    sendEfspMutation(actingPositionId, strip, { kind: 'DropStrip', reason: parsed.args.join(' ') || 'manual' });
  } else if (parsed.verb === 'undo') {
    sendEfspMutation(actingPositionId, strip, { kind: 'Undo' });
  }
}

function _wireDotCommand() {
  if (!_dotCommandInputEl) return;
  _dotCommandInputEl.addEventListener('input', () => {
    const parsed = parseDotCommand(_dotCommandInputEl.value);
    if (_dotCommandPreviewEl) _dotCommandPreviewEl.textContent = parsed ? `${parsed.verb} ${parsed.args.join(' ')}`.trim() : '';
  });
  _dotCommandInputEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const parsed = parseDotCommand(_dotCommandInputEl.value);
    if (!parsed) return;
    _dispatchDotCommand(parsed);
    _dotCommandInputEl.value = '';
    if (_dotCommandPreviewEl) _dotCommandPreviewEl.textContent = '';
  });
}

/** Called from app.js after any efsp-snapshot/efsp-board-delta/efsp-positions-ack lands — safe to call even when the Strip panel has never been opened yet (every render function no-ops until initEfspPanel() has cached its elements) or is currently the inactive tab (cached element references stay valid while detached — see the module comment). */
function refreshEfspPanel() {
  _renderPositionTabs();
  _refreshCreateStripAvailability();
}

function initEfspPanel() {
  _efspPanelRootEl = document.getElementById('efsp-panel');
  _positionTabsEl = document.getElementById('efsp-position-tabs');
  _bayTabsEl = document.getElementById('efsp-bay-tabs');
  _bayContentEl = document.getElementById('efsp-bay-content');
  _createStripInputEl = document.getElementById('efsp-new-strip-callsign');
  _createStripBtnEl = document.getElementById('efsp-create-strip-btn');
  _createStripMsgEl = document.getElementById('efsp-create-strip-msg');
  _dotCommandInputEl = document.getElementById('efsp-dot-command-input');
  _dotCommandPreviewEl = document.getElementById('efsp-dot-command-preview');
  _mutationErrorEl = document.getElementById('efsp-mutation-error');
  _mutationWarningEl = document.getElementById('efsp-mutation-warning');
  _connectionBannerEl = document.getElementById('efsp-connection-banner');

  _wireCreateStrip();
  _wireDotCommand();
  _renderPositionTabs();
  // One check per second is plenty for a 10s-default threshold — no need to
  // schedule a fresh timeout per heartbeat (§5.6 rule 5's banner). Started
  // once, not per initEfspPanel() call in case dock.js ever re-inits.
  if (!_staleCheckInterval) _staleCheckInterval = setInterval(_checkEfspStaleness, 1000);
  return { onShow: () => { _renderPositionTabs(); _refreshCreateStripAvailability(); } };
}
