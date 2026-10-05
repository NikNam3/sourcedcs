'use strict';
import { ORDER, onEfspChanged } from '../efsp-change-bus.js';
import { _activeBayId, _activePositionTab, _bayContentEl, _bayTabsEl, _positionTabsEl, _setActiveBayId, _setActivePositionTab, _isEfspPanelShowing, efspVisibleBayId, _searchQuery, _setSearchQuery } from './state.js';
import { _renderArrivalsLine } from './arrivals.js';
import { efspLinesWithOthers, getAllEfspStrips, getEfspBays, withOthersBayId } from '../efsp-state.js';
import { getActingPositions } from '../efsp-ws.js';
import { markEfspBaySeen, unseenEfspArrivalsForPosition, unseenEfspArrivalsInBay } from '../efsp-arrivals.js';
import { noteEfspBayVisible, noteEfspSearch } from '../efsp-metrics-client.js';
import { renderBay } from '../bay-view.js';
import { setOpenEfspBays } from '../bay/open-bays.js';
import { renderCarrierBanner } from '../carrier-panel.js';
import { getEfspPosition } from '../efsp-state.js';
import { LOCAL_POSITION, NON_LOCAL, formatFrequencies } from '../combination-rules.js';

// Search Bay (guide §4.3 rule 2, defect D2 — "the longest ground-control
// dwells occurred searching the Pending bay"). A client-local pseudo-Bay,
// not Board state — see efsp-state.js's searchEfspStrips module comment
// for why. _searchQuery is null when no search is active for the current
// Position tab; switching Position tabs implicitly drops it (matches the
// existing "Bay set recomposes on Position change" behavior elsewhere).

function _searchBayId(positionId) { return `${positionId}-search`; }

function _positionsWithBays() {
  const bays = getEfspBays();
  const signedOn = getActingPositions();
  const byPosition = {};
  for (const b of bays) {
    if (!signedOn.includes(b.positionId)) continue;
    (byPosition[b.positionId] = byPosition[b.positionId] || []).push(b);
  }
  if (_searchQuery != null && _activePositionTab && signedOn.includes(_activePositionTab)) {
    const positionId = _activePositionTab;
    (byPosition[positionId] = byPosition[positionId] || []).push({
      bayId: _searchBayId(positionId), positionId, rackIds: ['results'],
    });
  }
  // UI-A: the "with AIC/JTAC" pseudo-Bay on a held TAC_C2's tab, only while there is a line in it.
  for (const positionId of Object.keys(byPosition)) {
    if (efspLinesWithOthers(positionId).length === 0) continue;
    byPosition[positionId].push({ bayId: withOthersBayId(positionId), positionId, rackIds: ['results'], withOthers: true });
  }
  return byPosition;
}

/**
 * The Position tab strip: every Position this controller holds, plus the
 * other Positions at the same Facilities as DROP TARGETS ONLY.
 *
 * A tab is what carries the drop-position dataset attribute bay-view.js
 * hit-tests during a drag, and only signed-on Positions ever got one — so a
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
 * @param {string[]} signedOnPositionIds
 * @returns {Array<{positionId:string, facilityId:string, signedOn:boolean, bays:Array}>} signed-on Positions first
 */
// UI-A (S-L23 finding, H59): the JTAC's UI shows only what a JTAC knows, i.e. the lines TAC_C2 has
// handed it. A drop-only tab for TAC_C2, AIC or GCI shows those Positions exist, so a controller
// holding nothing but these Positions at a Facility gets no drop-only tabs there. (A JTAC hands a
// line back from the Strip's menu, which needs no tab.)
const HOLDS_ONLY_NO_DROP_TABS = ['JTAC'];

export function computePositionTabs(bays, signedOnPositionIds) {
  const signedOn = new Set(signedOnPositionIds || []);
  const signedOnFacilities = new Set();
  for (const b of bays || []) {
    if (!signedOn.has(b.positionId)) continue;
    signedOnFacilities.add(b.facilityId);
  }
  // A Facility where every signed-on Position is a "no drop tabs" one offers no other Position's tab.
  for (const facilityId of [...signedOnFacilities]) {
    const signedOnHere = [...new Set((bays || []).filter(b => b.facilityId === facilityId && signedOn.has(b.positionId)).map(b => b.positionId))];
    if (signedOnHere.length > 0 && signedOnHere.every(p => HOLDS_ONLY_NO_DROP_TABS.includes(p))) signedOnFacilities.delete(facilityId);
  }
  const signedOnFacilitiesWithTabs = signedOnFacilities;

  const byPosition = new Map();
  for (const b of bays || []) {
    const isSignedOn = signedOn.has(b.positionId);
    if (!isSignedOn && !signedOnFacilitiesWithTabs.has(b.facilityId)) continue;
    let entry = byPosition.get(b.positionId);
    if (!entry) {
      entry = { positionId: b.positionId, facilityId: b.facilityId, signedOn: isSignedOn, bays: [] };
      byPosition.set(b.positionId, entry);
    }
    if (isSignedOn) entry.bays.push(b);
  }

  const all = [...byPosition.values()];
  return [...all.filter(p => p.signedOn), ...all.filter(p => !p.signedOn)];
}

/** Runs (or clears, on an empty query) a search — one input, guide §4.3. Activates the search Bay for the current Position tab. */
export function _runEfspSearch(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) {
    _setSearchQuery(null);
    if (_activeBayId && _activeBayId.endsWith('-search')) _setActiveBayId(null);
    _renderPositionTabs();
    return;
  }
  noteEfspSearch(_activePositionTab, _activeBayId); // §11.5, docs/adr/0072 — before the Bay switches to the results
  _setSearchQuery(trimmed);
  if (_activePositionTab) _setActiveBayId(_searchBayId(_activePositionTab));
  _renderPositionTabs();
}

/** Read by bay-view.js's renderBay() when asked to render a search pseudo-Bay — see its `-search` bayId branch. */

export function _renderPositionTabs() {
  if (!_positionTabsEl) return; // not initialized yet — initEfspPanel() hasn't run
  const byPosition = _positionsWithBays();
  const signedOnPositionIds = Object.keys(byPosition);
  if (!signedOnPositionIds.includes(_activePositionTab)) _setActivePositionTab(signedOnPositionIds[0] || null);

  _positionTabsEl.innerHTML = '';
  for (const { positionId, signedOn } of computePositionTabs(getEfspBays(), getActingPositions())) {
    const tab = document.createElement('button');
    tab.className = 'efsp-position-tab'
      + (positionId === _activePositionTab ? ' active' : '')
      + (signedOn ? '' : ' efsp-position-tab-drop-only');
    tab.dataset.positionId = positionId;
    _fillTabLabel(tab, positionId, signedOn ? _stripCountForPosition(positionId) : null,
      signedOn ? unseenEfspArrivalsForPosition(positionId) : 0, 'dot');
    _decoratePositionTab(tab, positionId, signedOn);
    // Doubles as a drag drop-zone (guide §4.2: "other Bays reachable
    // through header drop zones that double as drag targets") —
    // bay-view.js hit-tests for this attribute during a drag and issues a
    // TransferStrip to this Position's default Bay on drop.
    tab.dataset.efspDropPosition = positionId;
    if (signedOn) {
      tab.addEventListener('click', () => {
        _setActivePositionTab(positionId);
        _setActiveBayId(null);
        _renderPositionTabs();
      });
    } else {
      // Not selectable: this controller has no Bay content to page through
      // at a Position they do not hold. It exists to be dropped on.
      tab.title = `${positionId} — drop a Strip here to hand it off (you are not holding this Position)`;
    }
    _positionTabsEl.appendChild(tab);
  }

  if (signedOnPositionIds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'efsp-empty';
    empty.textContent = 'No Position signed on — select one in Panels.';
    _positionTabsEl.appendChild(empty);
  }

  _renderBayTabs();
  renderCarrierBanner(); // crc-sync docs/adr/0074
}

function _renderBayTabs() {
  if (!_bayTabsEl || !_bayContentEl) return;
  const bays = _positionsWithBays()[_activePositionTab] || [];
  if (!bays.some(b => b.bayId === _activeBayId)) _setActiveBayId(bays[0] ? bays[0].bayId : null);

  noteEfspBayVisible(efspVisibleBayId(), _activePositionTab); // time-to-find, docs/adr/0072
  // The Bay in front of the controller has been seen, before its tab is drawn,
  // so it never shows "+N" for what is on screen.
  if (_activeBayId && _isEfspPanelShowing()) {
    markEfspBaySeen(_activeBayId);
    // Opening a Bay is a Bay-tab click, which redraws only the Bay tabs; the
    // Position tab's dot has to follow or it stays lit for arrivals just seen.
    _refreshPositionTabMarks();
  }

  _bayTabsEl.innerHTML = '';
  for (const bay of bays) {
    const isSearchBay = bay.bayId.endsWith('-search');
    const isOpsFiledBay = bay.bayId === 'ops-filed';
    const isWithBay = !!bay.withOthers;
    const tab = document.createElement('button');
    const unseen = !isSearchBay ? unseenEfspArrivalsInBay(bay.bayId) : 0;
    tab.className = 'efsp-bay-tab' + (bay.bayId === _activeBayId ? ' active' : '') + (isSearchBay ? ' efsp-bay-tab-search' : '')
      + (unseen ? ' efsp-tab-has-arrival' : '');
    tab.dataset.bayId = bay.bayId;
    _fillTabLabel(tab, isSearchBay ? `🔍 ${_searchQuery}` : isWithBay ? 'with AIC/JTAC' : bay.bayId,
      isSearchBay || isOpsFiledBay ? null : isWithBay ? efspLinesWithOthers(bay.positionId).length : _stripCountForBay(bay.bayId), unseen, 'pill');
    if (isWithBay) tab.title = 'Lines you have handed to AIC or JTAC. You answer CTR\'s TOFI exit for them here.';
    // A Bay-tab drop target picks the EXACT Bay (rather than the
    // Position's default one) — see bay-view.js's _finishDrag. Search is a
    // client-local pseudo-Bay (guide §4.3), so it deliberately does NOT
    // get a drop-target dataset — it's not a real destination server-side.
    // ops-filed is a real server Bay but its CONTENT is now a client-local
    // filed-plan queue, not a Rack of Strips (bay-view.js's renderBay
    // special-case) — a Strip dropped here would render nowhere, so this
    // tab must never accept drops either (facility-config.js's OPS bay
    // order was also fixed so it's never anyone's *default* Bay either).
    if (!isSearchBay && !isOpsFiledBay && !isWithBay) {
      tab.dataset.efspDropPosition = bay.positionId;
      tab.dataset.efspDropBay = bay.bayId;
    }
    tab.addEventListener('click', () => {
      _setActiveBayId(bay.bayId);
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

  _renderArrivalsLine();

  if (_activeBayId) {
    setOpenEfspBays([{ containerEl: _bayContentEl, bayId: _activeBayId }]);
    renderBay(_bayContentEl, _activeBayId);
  } else {
    _bayContentEl.innerHTML = '<div class="efsp-empty">No Bay available.</div>';
    setOpenEfspBays([]);
  }
}

// ── Tab counts and arrivals (docs/adr/0057) ───────────────────────────────

/** A tab's text as spans, so a count or "+N" can sit beside the name without becoming part of it. */
function _fillTabLabel(tab, name, count, unseen, unseenStyle) {
  tab.textContent = '';
  const nameEl = document.createElement('span');
  nameEl.className = 'efsp-tab-name';
  nameEl.textContent = name;
  tab.appendChild(nameEl);
  if (count !== null && count !== undefined) {
    const c = document.createElement('span');
    c.className = 'efsp-tab-count';
    c.textContent = String(count);
    c.title = `${count} Strip${count === 1 ? '' : 's'}`;
    tab.appendChild(c);
  }
  if (unseen > 0) {
    const mark = document.createElement('span');
    mark.className = unseenStyle === 'pill' ? 'efsp-tab-new' : 'efsp-tab-new-dot';
    if (unseenStyle === 'pill') mark.textContent = `+${unseen}`;
    mark.title = `${unseen} Strip${unseen === 1 ? '' : 's'} arrived that you have not looked at yet`;
    tab.appendChild(mark);
  }
}

function _liveStrips() {
  return getAllEfspStrips().filter(s => s.state !== 'DROPPED');
}

function _stripCountForBay(bayId) {
  return _liveStrips().filter(s => s.bayId === bayId).length;
}

function _stripCountForPosition(positionId) {
  return _liveStrips().filter(s => s.ownerPositionId === positionId && !String(s.bayId).endsWith('-search') && s.bayId !== 'ops-filed').length;
}

/** crc-sync docs/adr/0105: a Position's frequencies where the Position is named, and a combined one says so. Runs after every _fillTabLabel of a Position tab, which rebuilds the label. */
function _decoratePositionTab(tab, positionId, signedOn) {
  const entry = getEfspPosition(positionId);
  const freqText = entry ? formatFrequencies(entry.frequencies) : '';
  tab.removeAttribute('title');
  if (freqText) {
    const freq = document.createElement('span');
    freq.className = 'efsp-tab-freq';
    freq.textContent = freqText;
    tab.appendChild(freq);
    tab.title = `${positionId} ${freqText}`;
  }
  const combinedHere = signedOn && entry && entry.combinedWith ? entry.combinedWith.filter(id => getActingPositions().includes(id)) : [];
  if (combinedHere.length) {
    tab.title = `${tab.title ? `${tab.title} — ` : ''}combined with ${entry.combinedWith.join(', ')}`;
    // Colour only for the combination that carries a warning (LC with a non-local Position, crc-sync docs/adr/0105,
    // 0110): any other combination is just how the work is split, and an amber mark on every tab of a controller who
    // holds several Positions says nothing (human, 2026-10-05).
    const warns = positionId === LOCAL_POSITION ? combinedHere.some(id => NON_LOCAL.includes(id))
      : NON_LOCAL.includes(positionId) && combinedHere.includes(LOCAL_POSITION);
    if (warns) tab.classList.add('efsp-position-tab-combined');
  }
}

function _refreshPositionTabMarks() {
  if (!_positionTabsEl || !_positionTabsEl.children) return;
  for (const tab of _positionTabsEl.children) {
    const positionId = tab.dataset && tab.dataset.positionId;
    if (!positionId) continue;
    const signedOn = !String(tab.className).includes('efsp-position-tab-drop-only');
    _fillTabLabel(tab, positionId, signedOn ? _stripCountForPosition(positionId) : null,
      signedOn ? unseenEfspArrivalsForPosition(positionId) : 0, 'dot');
    _decoratePositionTab(tab, positionId, signedOn);
  }
}

/** Whether the Strip panel is actually on screen (a docked tab behind another is not). */

// A tab switch from outside this module (the arrivals line, a scramble row) marks 'tabs' (efsp-change-bus.js).
onEfspChanged(['tabs'], () => _renderPositionTabs(), { order: ORDER.PANEL });
