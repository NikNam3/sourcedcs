'use strict';
import { createStripFromFiledPlan } from '../efsp-panel.js';
import { listFiledFlightPlansClient } from '../efsp-flight-plan-lookup.js';
import { renderAllOpenEfspBays } from '../bay-view.js';


// ── Bay/Rack rendering ───────────────────────────────────────────────────
// renderBay() takes an ELEMENT reference, not an id string — no
// document.getElementById() here on purpose. The container element is
// cached once by efsp-panel.js's initEfspPanel() and passed through; a
// fresh id lookup would fail whenever the panel isn't the active tab in
// its dockview group (dockview detaches inactive tabs' DOM from
// `document` — see efsp-panel.js's module comment for the full story of
// the bug this caused).
//
// Keyed reconciliation, not destroy-and-rebuild (§7.5.4, §4.8.5 rule 3,
// defect D6) — this fires on every incoming Board delta from ANY connected
// client (via renderAllOpenEfspBays()'s rAF batching below), not just on a
// local action, so a naive full rebuild here would silently discard an
// in-progress drag or an open annotation/Block edit belonging to THIS
// controller every time any OTHER controller's Mutation broadcasts.
// computeRackReconciliation() (strip-drag.js) makes the remove/rebuild
// decision; this function walks it and does the actual DOM surgery.

// ── ops-filed: the "filed but not yet an active Strip" queue ────────────
// A real server-defined Bay (unlike the search pseudo-Bay below), but its
// CONTENT is deliberately NOT Board state — mirrors the search Bay's own
// "client-local view, not a server concept" precedent exactly. A filed
// DD1801 plan isn't a Strip (no stripId/ownerPositionId/lifecycle state at
// all) until a controller actually presses "Create Strip" on it, so
// inventing a server-side pseudo-Strip type for it would be a bigger,
// unnecessary model change — see docs/efsp-usage-guide.md §4.

let _opsFiledPlans = [];
let _opsFiledFetchedAt = 0;
let _opsFiledFetching = false;
let _opsFiledUsedPlanIds = new Set(); // this-session-only, cleared on reload — see the card's "already created" note below
const OPS_FILED_REFRESH_MS = 10000;

export function _renderOpsFiledCards(container) {
  container.innerHTML = '';
  if (_opsFiledFetching && _opsFiledFetchedAt === 0) {
    const loading = document.createElement('div');
    loading.className = 'efsp-empty';
    loading.textContent = 'Loading filed flight plans…';
    container.appendChild(loading);
    return;
  }
  if (_opsFiledPlans.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'efsp-empty';
    empty.textContent = 'No filed flight plans waiting.';
    container.appendChild(empty);
    return;
  }
  for (const plan of _opsFiledPlans) {
    const card = document.createElement('div');
    card.className = 'efsp-filed-plan-card';

    const callsignEl = document.createElement('div');
    callsignEl.className = 'efsp-filed-plan-callsign';
    callsignEl.textContent = plan.callsign;
    card.appendChild(callsignEl);

    const summaryEl = document.createElement('div');
    summaryEl.className = 'efsp-filed-plan-summary';
    const seed = plan.seed || {};
    summaryEl.textContent = [seed.departureAirport, seed.destinationAirport, seed.route].filter(Boolean).join(' → ') || 'No route filed';
    card.appendChild(summaryEl);

    if (plan.submittedByName) {
      const byEl = document.createElement('div');
      byEl.className = 'efsp-filed-plan-by';
      byEl.textContent = 'Filed by ' + plan.submittedByName;
      card.appendChild(byEl);
    }

    const used = _opsFiledUsedPlanIds.has(plan.id);
    if (used) {
      const usedEl = document.createElement('div');
      usedEl.className = 'efsp-filed-plan-used';
      usedEl.textContent = 'Strip already created this session';
      card.appendChild(usedEl);
    }

    const btn = document.createElement('button');
    btn.className = 'efsp-filed-plan-create-btn';
    btn.textContent = used ? 'Create Again' : 'Create Strip';
    btn.addEventListener('click', () => {
      _opsFiledUsedPlanIds.add(plan.id);
      createStripFromFiledPlan(plan);
      _renderOpsFiledCards(container);
    });
    card.appendChild(btn);

    container.appendChild(card);
  }
}

/** Called from renderBay() whenever ops-filed is the Bay actually being shown — fetches (throttled) and (re)renders. Never blocks renderBay() itself; the fetch is fire-and-forget, re-rendering once it lands. */
export function _refreshOpsFiledIfStale(container) {
  const stale = Date.now() - _opsFiledFetchedAt > OPS_FILED_REFRESH_MS;
  if (_opsFiledFetching || !stale) return;
  _opsFiledFetching = true;
  listFiledFlightPlansClient().then((plans) => {
    _opsFiledPlans = plans;
    _opsFiledFetchedAt = Date.now();
  }).finally(() => {
    _opsFiledFetching = false;
    renderAllOpenEfspBays(); // picks up the fresh list if ops-filed is still the open Bay; a no-op otherwise
  });
}
