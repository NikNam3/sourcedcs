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
let _createStripRoleEl = null;
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

/**
 * The Position tab strip: every Position this controller holds, plus the
 * other Positions at the same Facilities as DROP TARGETS ONLY.
 *
 * A tab is what carries the drop-position dataset attribute bay-view.js
 * hit-tests during a drag, and only held Positions ever got one — so a
 * controller holding a single Position had nothing to drag a handoff onto.
 * It worked in testing only because test sessions hold several Positions at
 * once and self-coordinate. The server never required the sender to hold the
 * destination (every automatic NLA transfer already hands a Strip to a
 * Position the sender does not hold), so this is purely a client gap, and
 * the snapshot already carries every Facility's Bays.
 *
 * Scoped to Facilities this controller holds something at, because
 * TransferStrip is per-Facility server-side — a cross-Facility drag would
 * fail NO_RECEIVING_POSITION, i.e. a target the controller can aim at and
 * never hit. Crossing a Facility boundary is what HANDOFF is for.
 *
 * Pure so it can be tested without a DOM; the render below is what is not.
 * @param {Array<{bayId:string, positionId:string, facilityId:string}>} bays
 * @param {string[]} heldPositionIds
 * @returns {Array<{positionId:string, facilityId:string, held:boolean, bays:Array}>} held Positions first
 */
function computePositionTabs(bays, heldPositionIds) {
  const held = new Set(heldPositionIds || []);
  const heldFacilities = new Set();
  for (const b of bays || []) if (held.has(b.positionId)) heldFacilities.add(b.facilityId);

  const byPosition = new Map();
  for (const b of bays || []) {
    const isHeld = held.has(b.positionId);
    if (!isHeld && !heldFacilities.has(b.facilityId)) continue;
    let entry = byPosition.get(b.positionId);
    if (!entry) {
      entry = { positionId: b.positionId, facilityId: b.facilityId, held: isHeld, bays: [] };
      byPosition.set(b.positionId, entry);
    }
    if (isHeld) entry.bays.push(b);
  }

  const all = [...byPosition.values()];
  return [...all.filter(p => p.held), ...all.filter(p => !p.held)];
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
  const heldPositionIds = Object.keys(byPosition);
  if (!heldPositionIds.includes(_activePositionTab)) _activePositionTab = heldPositionIds[0] || null;

  _positionTabsEl.innerHTML = '';
  for (const { positionId, held } of computePositionTabs(getEfspBays(), getActingPositions())) {
    const tab = document.createElement('button');
    tab.className = 'efsp-position-tab'
      + (positionId === _activePositionTab ? ' active' : '')
      + (held ? '' : ' efsp-position-tab-drop-only');
    tab.textContent = positionId;
    // Doubles as a drag drop-zone (guide §4.2: "other Bays reachable
    // through header drop zones that double as drag targets") —
    // bay-view.js hit-tests for this attribute during a drag and issues a
    // TransferStrip to this Position's default Bay on drop.
    tab.dataset.efspDropPosition = positionId;
    if (held) {
      tab.addEventListener('click', () => {
        _activePositionTab = positionId;
        _activeBayId = null;
        _renderPositionTabs();
      });
    } else {
      // Not selectable: this controller has no Bay content to page through
      // at a Position they do not hold. It exists to be dropped on.
      tab.title = `${positionId} — drop a Strip here to hand it off (you are not holding this Position)`;
    }
    _positionTabsEl.appendChild(tab);
  }

  if (heldPositionIds.length === 0) {
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
    const isOpsFiledBay = bay.bayId === 'ops-filed';
    const tab = document.createElement('button');
    tab.className = 'efsp-bay-tab' + (bay.bayId === _activeBayId ? ' active' : '') + (isSearchBay ? ' efsp-bay-tab-search' : '');
    tab.textContent = isSearchBay ? `🔍 ${_searchQuery}` : bay.bayId;
    // A Bay-tab drop target picks the EXACT Bay (rather than the
    // Position's default one) — see bay-view.js's _finishDrag. Search is a
    // client-local pseudo-Bay (guide §4.3), so it deliberately does NOT
    // get a drop-target dataset — it's not a real destination server-side.
    // ops-filed is a real server Bay but its CONTENT is now a client-local
    // filed-plan queue, not a Rack of Strips (bay-view.js's renderBay
    // special-case) — a Strip dropped here would render nowhere, so this
    // tab must never accept drops either (facility-config.js's OPS bay
    // order was also fixed so it's never anyone's *default* Bay either).
    if (!isSearchBay && !isOpsFiledBay) {
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
// Guards the flight-plan lookup in _submitCreateStrip() against a double-
// submit while it's in flight (up to a few seconds — a real window a
// second Enter/click could land in, unlike the near-instant validation
// that runs before it).
let _createStripLookupInFlight = false;
// Callsign the duplicate-origination warning has already been shown for, so
// a second press goes through. Cleared on any successful create.
let _pendingDuplicateCallsign = null;

function _setCreateStripMsg(text, isError) {
  if (!_createStripMsgEl) return;
  _createStripMsgEl.textContent = text || '';
  _createStripMsgEl.classList.toggle('efsp-msg-error', !!isError);
}

// WP4A (docs/adr/0014) started this as CTR self-originating ARRIVAL Strips
// — the same "no Facility further upstream is built yet" terminus stub
// OPS/DEPARTURE always had. docs/adr/0023 opens the same right to APP (for
// ARRIVAL, matching guide §4.1's "all" Strip Roles for APP) and adds
// OVERFLIGHT for both — real pop-up ATC scenarios (a VFR aircraft picking
// up an IFR clearance airborne, an aircraft transiting Center's airspace
// without landing at Incirlik) have no sending Facility to HANDOFF from,
// so whichever Position takes the call originates the Strip directly.
//
// Every (Position, Role) origin this app can ever originate a Strip from —
// a flat, exhaustive list rather than a priority order. An earlier version
// of this picked OPS unconditionally whenever it was held, silently
// ignoring APP/CTR even if ALSO held — wrong per guide §4.8.1's own
// framing: "under low manning the combined case is the NORMAL case," not
// an edge case to deprioritize. A controller holding OPS+APP+CTR at once
// (entirely plausible under low manning) must be able to originate any of
// the three, not just whichever this list happened to check first.
const CREATE_STRIP_ORIGINS = [
  { actingPositionId: 'OPS', facilityId: 'INCIRLIK', bayId: 'ops-proposed',    role: undefined,     label: 'OPS · Departure' },
  { actingPositionId: 'APP', facilityId: 'INCIRLIK', bayId: 'app-inbound',     role: 'ARRIVAL',     label: 'APP · Arrival' },
  { actingPositionId: 'APP', facilityId: 'INCIRLIK', bayId: 'app-overflight',  role: 'OVERFLIGHT',  label: 'APP · Overflight' },
  { actingPositionId: 'CTR', facilityId: 'CENTER',   bayId: 'ctr-enroute',     role: 'ARRIVAL',     label: 'CTR · Arrival' },
  { actingPositionId: 'CTR', facilityId: 'CENTER',   bayId: 'ctr-overflight',  role: 'OVERFLIGHT',  label: 'CTR · Overflight' },
  // WP4A second slice — TAC_C2/GCI self-originate a standalone MISSION
  // Strip (guide §9.8), for a mission that never needs to touch ATC-
  // controlled airspace at all. Distinct from a MISSION Strip minted as a
  // TOFI ENTRY exchange's byproduct (crc-sync's board-store.js
  // receiveTofiProposal), which shares its FDR with the ATC-side Strip
  // instead — both paths coexist, same "origin OR replica" duality
  // DEPARTURE/ARRIVAL Strips already have. GCI has no Tasked/Airborne Bay
  // of its own (guide §4.2 only gives those to TAC_C2 — AIC/GCI get the
  // narrower On Station/Committed/Coordination set), so its origin starts
  // already ON_STATION rather than at MISSION's default TASKED, matching
  // the one Bay it actually has to land in.
  { actingPositionId: 'TAC_C2', facilityId: 'TACTICAL', bayId: 'tac-c2-tasked', role: 'MISSION', label: 'TAC_C2 · Mission' },
  { actingPositionId: 'GCI', facilityId: 'TACTICAL',   bayId: 'gci-on-station', role: 'MISSION', label: 'GCI · Mission', initialState: 'ON_STATION' },
];

function _createStripOriginKey(o) { return `${o.actingPositionId}:${o.role || 'DEPARTURE'}`; }

/** Every origin CURRENTLY reachable, given the Positions actually held right now — not a fixed list, since held Positions change live during a session (guide §4.1: "the set changes live during a session"). */
function _availableCreateStripOrigins() {
  const held = getActingPositions();
  return CREATE_STRIP_ORIGINS.filter(o => held.includes(o.actingPositionId));
}

function _createStripOrigin() {
  const available = _availableCreateStripOrigins();
  if (available.length === 0) return null;
  if (available.length === 1) return available[0]; // the common single-Position case — no picker was shown, nothing to read
  const selectedKey = _createStripRoleEl && _createStripRoleEl.value;
  return available.find(o => _createStripOriginKey(o) === selectedKey) || available[0];
}

function _refreshCreateStripAvailability() {
  if (!_createStripInputEl || !_createStripBtnEl) return;
  if (_createStripLookupInFlight) return; // don't fight the "Looking up flight plan…" message or re-enable mid-lookup — _submitCreateStrip owns this window
  const available = _availableCreateStripOrigins();
  if (_createStripRoleEl) {
    // Only actually a CHOICE when 2+ origins are simultaneously reachable
    // (a combined-Position controller) — the common single-Position case
    // keeps today's minimal toolbar, nothing to pick.
    _createStripRoleEl.hidden = available.length <= 1;
    if (!_createStripRoleEl.hidden) {
      const prevKey = _createStripRoleEl.value;
      _createStripRoleEl.innerHTML = '';
      for (const o of available) {
        const opt = document.createElement('option');
        opt.value = _createStripOriginKey(o);
        opt.textContent = o.label;
        _createStripRoleEl.appendChild(opt);
      }
      // Preserve the operator's prior choice across a Position-set change
      // (e.g. picking up a third Position) when it's still valid; default
      // to the first option otherwise — never silently reset a deliberate
      // choice out from under them.
      if (available.some(o => _createStripOriginKey(o) === prevKey)) _createStripRoleEl.value = prevKey;
    }
  }
  const origin = _createStripOrigin();
  _createStripInputEl.disabled = !origin;
  _createStripBtnEl.disabled = !origin;
  if (!origin) {
    _setCreateStripMsg('OPS, APP or CTR only — select one in Panels to create Strips', true);
  } else if (!_pendingCreateStripMutationId) {
    // Clear a stale "OPS/APP/CTR only"/validation message once one is
    // selected — but never stomp "Creating…" while an attempt is still in
    // flight.
    _setCreateStripMsg('', false);
  }
}

/**
 * docs/adr/0023 — converts this DEPARTURE Strip into its return-leg
 * ARRIVAL Strip IN PLACE: one Mutation (`ConvertToArrival`), same stripId,
 * same fdrId, throughout. Two earlier versions of this feature spawned a
 * SECOND Strip/FDR instead (per guide §3.6's turnaround rule) — abandoned
 * after live testing found that approach left a stale departure Strip
 * behind and needed every field copied by hand, including a beacon code
 * that can't even be copied cleanly (fdr-store.js's createFdr always
 * auto-allocates a fresh one). Reusing the same FDR makes both problems
 * structurally impossible — there's nothing to copy, because nothing new
 * is created. `board-store.js`'s `_applyConvertToArrival` is authoritative
 * for the state/role/Bay/permission rules; this just sends the Mutation.
 */
function convertStripToArrival(strip) {
  // _resolveActingPositionId (bay-view.js), like every other dispatch helper
  // — not strip.ownerPositionId unconditionally. The server now requires the
  // acting Position to be one this session is actually Primary at, so naming
  // the owner regardless of whether this controller holds it is a guaranteed
  // rejection rather than the silent pass it used to get.
  const actingPositionId = _resolveActingPositionId(strip);
  if (!actingPositionId) return;
  sendEfspMutation(actingPositionId, strip, { kind: 'ConvertToArrival' });
}

async function _submitCreateStrip() {
  if (!_createStripInputEl || _createStripLookupInFlight) return;

  const origin = _createStripOrigin();
  if (!origin) {
    _setCreateStripMsg('OPS, APP or CTR only — select one in Panels to create Strips', true);
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

  // Duplicate-origination warning (§3.6). A flight handed off across a
  // Facility boundary is meant to be picked up by ACCEPTing the replica that
  // already exists for it — but nothing stopped a controller originating a
  // fresh, unlinked Strip for the same callsign instead, which then carries
  // its own beacon code and its own lifecycle for an aircraft that already
  // had both. Two presses, not a block: genuinely distinct flights do reuse
  // a callsign across a session, so this is the controller's call.
  const existing = liveStripsForCallsign(callsign);
  if (existing.length > 0 && _pendingDuplicateCallsign !== callsign) {
    _pendingDuplicateCallsign = callsign;
    const where = existing.map(s => `${s.facilityId || '?'}/${s.ownerPositionId}`).join(', ');
    _setCreateStripMsg(`${callsign} already has a live Strip at ${where} — press again to create another anyway`, true);
    return;
  }
  _pendingDuplicateCallsign = null;

  // Flight-plan pre-fill (guide §10.1 "auto-population — do it
  // aggressively", §10.5 provenance fallback chains) — DEPARTURE-role
  // only: the DD1801 lookup maps onto route/altitude/departure+destination
  // airport/remarks (crc-sync's toFdrFiledSeed), which line up with
  // DEPARTURE's filed shape, not ARRIVAL's (originAirport/arrivalFix/
  // estimatedArrivalTimeUtc — a genuinely different set of fields),
  // OVERFLIGHT's (docs/adr/0023 — the fields it reuses mean the flight's
  // real origin/destination, not a plan filed FROM Incirlik, so a lookup
  // keyed on "departed Incirlik" would be actively wrong here), or
  // MISSION's (WP4A second slice — a mission line has no DD1801 flight
  // plan at all; its fields are mission number/package/controlling agency,
  // nothing a civil flight-plan lookup could ever populate). Bounded by
  // the lookup's own client-side timeout; ANY failure (unreachable, no
  // plan on file, malformed response) just leaves every field blank,
  // exactly like today's behavior — Strip creation is never blocked on
  // this succeeding, only delayed by a few seconds while it's tried.
  let seed = {};
  if (origin.role !== 'ARRIVAL' && origin.role !== 'OVERFLIGHT' && origin.role !== 'MISSION' && typeof lookupFlightPlanClient === 'function') {
    _createStripLookupInFlight = true;
    if (_createStripInputEl) _createStripInputEl.disabled = true;
    if (_createStripBtnEl) _createStripBtnEl.disabled = true;
    _setCreateStripMsg('Looking up flight plan…', false);
    try {
      const result = await lookupFlightPlanClient(callsign);
      if (result.found) seed = result.seed;
    } finally {
      // lookupFlightPlanClient is designed to never throw (see its own
      // header comment) — this finally is a defense-in-depth backstop, not
      // an expected path, so the form can never get stuck disabled.
      _createStripLookupInFlight = false;
      if (_createStripInputEl) _createStripInputEl.disabled = false;
      if (_createStripBtnEl) _createStripBtnEl.disabled = false;
    }
  }

  const fdr = origin.role === 'ARRIVAL'
    ? { callsign, aircraftType: '', wakeCategory: '', originAirport: '', estimatedArrivalTimeUtc: null }
    : origin.role === 'MISSION'
      ? { callsign, missionNumber: '', packageId: '', controllingAgency: '', vulWindowStartUtc: null, vulWindowEndUtc: null }
      : {
          callsign, aircraftType: '', wakeCategory: '',
          departureAirport: '', destinationAirport: '', route: '', requestedAltitude: '',
          ...seed, // overrides only the blanks above when the lookup actually found something
        };

  _pendingCreateStripMutationId = sendEfspCreateStrip(origin.actingPositionId, {
    kind: 'CreateStrip', bayId: origin.bayId, rackId: 'main', role: origin.role, fdr,
    initialState: origin.initialState || undefined,
  }, origin.facilityId);
  _createStripInputEl.value = '';
  _pendingDuplicateCallsign = null;
  _setCreateStripMsg(seed.route ? 'Creating (flight plan found)…' : 'Creating…', false);
}

/**
 * Called from bay-view.js's ops-filed card "Create Strip" button — the
 * plan's data is already in hand (it came from the same list fetch that
 * rendered the card), so this skips lookupFlightPlanClient's network round
 * trip entirely and goes straight to CreateStrip. DEPARTURE/OPS only, same
 * scope restriction _submitCreateStrip's own lookup has — see
 * docs/efsp-usage-guide.md §4 for why ARRIVAL/CTR is out of scope for this
 * seed shape.
 * @param {{callsign:string, seed:object}} plan
 */
function createStripFromFiledPlan(plan) {
  if (!plan || !plan.callsign) return;
  if (!getActingPositions().includes('OPS')) {
    _setCreateStripMsg('OPS only — select OPS in Panels to create Strips', true);
    return;
  }
  const fdr = {
    callsign: plan.callsign, aircraftType: '', wakeCategory: '',
    departureAirport: '', destinationAirport: '', route: '', requestedAltitude: '',
    ...(plan.seed || {}),
  };
  _pendingCreateStripMutationId = sendEfspCreateStrip('OPS', {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', fdr,
  }, 'INCIRLIK');
  _setCreateStripMsg('Creating ' + plan.callsign + ' (flight plan found)…', false);
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
  } else if (parsed.verb === 'bind' || parsed.verb === 'unbind') {
    // WP5 (guide §6.6 rule 1's top rung). The badge's picker is a pointer
    // affordance; this is the keyboard path §7.1 rule 4 asks for at the
    // positions that do the data entry, and §7.1 rule 5 is explicit that the
    // dot-command surface is "a primary feature, not a power-user extra".
    const record = typeof getEfspCorrelationForStrip === 'function' ? getEfspCorrelationForStrip(strip) : null;
    const baseRev = record ? record.rev : 0;
    if (parsed.verb === 'unbind') {
      sendEfspCorrelationMutation(actingPositionId, strip.fdrId, baseRev, { kind: 'UnbindTrack' });
      return;
    }
    const trackId = parsed.args[0];
    if (!trackId) {
      // Nothing to guess at: a bind names a specific contact, and picking one
      // on the controller's behalf is exactly what the server refuses to do.
      _showDotCommandError('.bind needs a track id — click the TRK badge to pick from the candidates');
      return;
    }
    sendEfspCorrelationMutation(actingPositionId, strip.fdrId, baseRev, { kind: 'BindTrack', trackId: String(trackId) });
  }
}

/** Surfaces a dot-command problem where the preview already draws the eye. */
function _showDotCommandError(message) {
  if (!_dotCommandPreviewEl) return;
  _dotCommandPreviewEl.textContent = message;
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
  _renderCorrelationRate();
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
  const stats = typeof getEfspCorrelationStats === 'function' ? getEfspCorrelationStats() : null;
  if (!stats || stats.rate == null) { el.textContent = ''; el.className = ''; return; }
  const matched = Math.round(stats.rate * stats.eligible);
  el.textContent = `TRK ${Math.round(stats.rate * 100)}% (${matched}/${stats.eligible})`;
  el.className = stats.rate < (stats.target ?? 0.95) ? 'efsp-correlation-rate-low' : '';
  el.title = 'flights matched to a surveillance contact'
    + (stats.sessionRate != null ? ` \u00b7 session ${Math.round(stats.sessionRate * 100)}%` : '');
}

function initEfspPanel() {
  _efspPanelRootEl = document.getElementById('efsp-panel');
  _positionTabsEl = document.getElementById('efsp-position-tabs');
  _bayTabsEl = document.getElementById('efsp-bay-tabs');
  _bayContentEl = document.getElementById('efsp-bay-content');
  _createStripInputEl = document.getElementById('efsp-new-strip-callsign');
  _createStripBtnEl = document.getElementById('efsp-create-strip-btn');
  _createStripMsgEl = document.getElementById('efsp-create-strip-msg');
  _createStripRoleEl = document.getElementById('efsp-create-strip-role');
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

// Node-only export for the pure helpers above (the repo's dual-use pattern —
// see efsp-nla.js). Everything else in this file touches the DOM directly and
// stays browser-only.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computePositionTabs };
}
