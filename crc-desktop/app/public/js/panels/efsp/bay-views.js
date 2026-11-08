'use strict';
import {
  getEfspBays, getEfspFlightData, getEfspRack, getEfspStrip
} from './efsp-state.js';
import { parTerminalOp, parTerminalRecorded, parTerminals } from './par-model.js';
import { carrierFinalDistanceText } from './carrier-final-distance.js';
import { onEfspChanged } from './efsp-change-bus.js';
import { FINAL_HANDOFF_LABEL, FINAL_RECEIVER, finalHandoffOffered, finalHandoffOp, sfaBayOf, sfaRows } from './sfa-state.js';
import { getActingPositions, sendEfspMutation } from './efsp-ws.js';

// Bay descriptor views (crc-sync docs/adr/0075, 0093): a Bay whose descriptor says
// `view: 'sfa-freqs'` mounts a component above its Strip racks (the SFA frequency header).
// (PriFly's pattern leg board, `view: 'pattern'`, is gone: live test U19, docs/adr/0137. The pattern is flown zip-lip.)
// bay-view.js calls `renderBayDescriptorView()` once per render and knows nothing
// else about them.
//
// What each view does:
//   final      an airfield's PAR final (Incirlik's `par-final`) is an ordinary Bay of ordinary Strips (H138 U10): the
//              descriptor's `view: 'final'` only tells crc-sync which Strips get a PAR sample. The carrier's final Bays and
//              their line view went with crc-sync docs/adr/0156.
//   sfa-freqs  a header over AP's frequency racks: each frequency, what it is for, and on the
//              three that rotate who has it selected now (crc-sync docs/adr/0117).
//
// `replacesRacks` says the component IS the Bay's interface and the racks are
// hidden (no shipped Bay honours it since docs/adr/0126 removed the RSU); without it (the carrier's Bays, SFA) the racks stay and the component sits
// above them. The racks are always still built and reconciled, so a hidden rack costs
// nothing and the Strips keep the one render path.
//
// Pure model builders first (unit-tested), DOM second.


/** The Bay's descriptor, from the snapshot's Bay list, or null. */
export function bayDescriptorFor(bayId, bays = getEfspBays()) {
  return (bays || []).find(b => b.bayId === bayId) || null;
}

// ── final ───────────────────────────────────────────────────────────────────

/** True when a Bay mounts a component. An airfield's PAR final does not (H138 U10, the ordinary Strips are its interface), and
 *  the carrier has no final Bay since crc-sync docs/adr/0156 (its approach is on the Marshal panel and the Strips). */
export function bayHasComponentView(bay) {
  return !!(bay && bay.view && bay.view !== 'final');
}

/** True for a FINAL Strip on an airfield's final: the final controller's calls (crc-sync docs/adr/0117) apply to it. */
export function isParFinalStrip(strip) {
  return !!(strip && strip.stripType === 'FINAL' && strip.state === 'ON_FINAL' && strip.facilityId && strip.facilityId !== 'CARRIER');
}

/**
 * The final controller's next once-only call (Begin descent, then Cleared to land), as the button beside the NLA shows it, or
 * null once both are recorded. Landed is the NLA itself; Missed approach is in the ⋯ menu (strip-menu.js).
 */
export function nextParCall(strip) {
  if (!isParFinalStrip(strip)) return null;
  return parTerminals().find(t => t.once && !parTerminalRecorded(strip, t)) || null;
}

// ── DOM ─────────────────────────────────────────────────────────────────────

function _signedOnAt(bay) {
  return getActingPositions(bay.facilityId);
}

function _send(strip, op) {
  if (!strip) return;
  const live = getEfspStrip(strip.stripId) || strip;
  sendEfspMutation(live.ownerPositionId, live, op);
}

const _isViewEl = (el) => !!(el && typeof el.className === 'string' && el.className.split(/\s+/).includes('efsp-bay-view'));

function _mountPoint(container, bayId) {
  let el = [...container.children].find(_isViewEl);
  if (!el) {
    el = document.createElement('div');
    el.className = 'efsp-bay-view';
    if (typeof container.insertBefore === 'function' && container.firstChild) container.insertBefore(el, container.firstChild);
    else container.appendChild(el);
  }
  el.dataset.bayId = bayId;
  return el;
}

function _racksOf(container) {
  return [...container.children].filter(el => typeof el.className === 'string' && el.className.split(/\s+/).includes('efsp-rack'));
}

function _setRacksHidden(container, hidden) {
  for (const el of _racksOf(container)) el.style.display = hidden ? 'none' : '';
}

/** Empties `el` and puts `child` in it (innerHTML = '' is the one clear both a browser and the test stub have). */
function _replace(el, child) {
  el.innerHTML = '';
  if (child) el.appendChild(child);
}

// What a pool frequency is for, as the header shows it (crc-sync sfa.js SFA_USE); a rotating one shows who has it instead.
const SFA_USE_TEXT = Object.freeze({ INITIAL_CONTACT: 'INIT', SPARE: 'SPARE' });

/** The final controller's live Strips at this Bay's Facility: who has a rotating frequency follows them (sfa-state.js). */
function _receiverStrips(bay) {
  const out = [];
  for (const b of getEfspBays()) {
    if (b.positionId !== FINAL_RECEIVER || (bay.facilityId && b.facilityId && b.facilityId !== bay.facilityId)) continue;
    for (const rackId of b.rackIds || []) out.push(...getEfspRack(b.bayId, rackId));
  }
  return out;
}

function _renderSfaHeader(container, bay) {
  const mount = _mountPoint(container, bay.bayId);
  if (!Array.isArray(bay.sfaPool)) { _replace(mount, null); return; }
  const rowsModel = sfaRows(bay, _receiverStrips(bay), getEfspFlightData);
  const box = document.createElement('div');
  box.className = 'efsp-sfa-header';
  box.dataset.bayView = 'sfa-freqs';
  const rows = document.createElement('div');
  rows.className = 'efsp-sfa-rows';
  for (const row of rowsModel) {
    const cell = document.createElement('div');
    cell.className = 'efsp-sfa-row';
    cell.dataset.rackId = row.rackId;
    cell.dataset.use = row.use;
    const f = document.createElement('span');
    f.className = 'efsp-sfa-freq';
    f.textContent = row.text;
    const who = document.createElement('span');
    who.className = row.positionId ? 'efsp-sfa-on' : 'efsp-sfa-on efsp-sfa-spare';
    who.textContent = row.positionId || SFA_USE_TEXT[row.use] || '';
    cell.append(f, who);
    rows.appendChild(cell);
  }
  box.appendChild(rows);
  _replace(mount, box);
  // The rack headers carry the frequency, not just `freq-3`.
  for (const el of _racksOf(container)) {
    const row = rowsModel.find(r => r.rackId === el.dataset.rackId);
    const head = [...el.children].find(c => typeof c.className === 'string' && c.className.split(/\s+/).includes('efsp-rack-header'));
    if (row && head) head.textContent = `${row.text} · ${row.positionId || SFA_USE_TEXT[row.use] || ''}`;
  }
}

/** Called by bay-view.js's renderBay() after the racks are reconciled. A Bay with no `view` is left exactly as it was. */
export function renderBayDescriptorView(container, bay) {
  if (!container || !bay || typeof document === 'undefined') return;
  const stale = [...container.children].find(_isViewEl);
  if (!bayHasComponentView(bay)) { if (stale) stale.remove(); _setRacksHidden(container, false); return; }
  container.dataset.efspBayView = bay.bayId;
  _setRacksHidden(container, !!bay.replacesRacks);
  if (bay.view === 'sfa-freqs') _renderSfaHeader(container, bay);
}

/**
 * The second button beside the NLA on AP's arrival on a rotating SFA frequency: Hand off to PAR (crc-sync docs/adr/0117), the
 * ordinary strip transfer into PAR's final Bay. The aircraft keeps its frequency (JO 7110.65BB para 5-10-15).
 */
export function finalHandoffButtons(strip) {
  const bays = getEfspBays();
  const flightData = getEfspFlightData(strip.flightDataId);
  if (!finalHandoffOffered(strip, flightData, getActingPositions(strip.facilityId || undefined), sfaBayOf(bays, strip.facilityId))) return [];
  const op = finalHandoffOp(bays, strip.facilityId);
  if (!op) return [];
  const btn = document.createElement('button');
  btn.className = 'efsp-sbtn efsp-nla-btn efsp-final-handoff';
  btn.textContent = FINAL_HANDOFF_LABEL;
  btn.dataset.finalHandoff = FINAL_RECEIVER;
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    _send(strip, op);
    btn.disabled = true;
  });
  return [btn];
}

/**
 * The final controller's next call beside the NLA on an airfield's FINAL Strip (H138 U10, crc-sync docs/adr/0117): Begin
 * descent, then Cleared to land, each recorded once (the Strip's tab then shows the next; the record stays in the ⋯ menu,
 * greyed). Only for the Position that holds the Strip: the server refuses anyone else (`recordsFinalCalls`).
 */
export function parCallButtons(strip) {
  const t = nextParCall(strip);
  if (!t || !getActingPositions(strip.facilityId || undefined).includes(strip.ownerPositionId)) return [];
  const btn = document.createElement('button');
  btn.className = 'efsp-sbtn efsp-nla-btn efsp-par-call';
  btn.textContent = t.label;
  btn.dataset.parCall = t.id;
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    _send(strip, parTerminalOp(t));
    btn.disabled = true;
  });
  return [btn];
}

// The DIST Block (C17) measures between two moving things: the contact (every sweep) and the ship (republished each 0.05 NM).
// A Bay redraws only on a Board change, so the figure is rewritten in place, at most once a second, on every Strip on screen.
let _distAt = -Infinity;
export function refreshDistBlocks(root = typeof document !== 'undefined' ? document : null, nowMs = Date.now()) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  if (nowMs - _distAt < 1000) return;
  _distAt = nowMs;
  for (const el of root.querySelectorAll('.efsp-strip[data-strip-id] .efsp-block-C17')) {
    const stripEl = el.closest('.efsp-strip[data-strip-id]');
    const strip = stripEl ? getEfspStrip(stripEl.dataset.stripId) : null;
    if (!strip) continue;
    const text = carrierFinalDistanceText(strip);
    if (el.textContent !== text) el.textContent = text;
  }
}
onEfspChanged(['scope', 'par'], () => refreshDistBlocks());
