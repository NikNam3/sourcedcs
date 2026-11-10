'use strict';
import { NM_M, projectPos } from '../../geo.js';
import { getLatestTrack } from '../../picture.js';
import { correlatedTrackIdForStrip, getEfspStrip } from './efsp-state.js';
import { CARRIER_HANDOFFS } from './efsp-nla.js';
import { nlaAlsoActions } from './nla-also.js';
import { isCarrierStrip } from './strip-fields.js';
import { carrierBannerParts, carrierDerivedFor, carrierStateOf, getEfspCarrier } from './carrier-state.js';
import { getActingPositions, sendEfspMutation, settleEfspAck } from './efsp-ws.js';
import { signedOnCarrierIds } from './carrier-send.js';
import { renderCarrierManagement } from './carrier-management-panel.js';
import { registerEfspMessage, registerEfspStoreRedraw } from './efsp-message-registry.js';
import { applyEfspCarrierDelta } from './carrier-state.js';
import { _showMutationError } from './panel/refusal.js';
import { markEfspChanged } from './efsp-change-bus.js';

// The carrier's surfaces on the Strip panel (crc-sync's docs/adr/0074, ADR 0064
// B7; guide §4.1, §9.12): the ship banner, the Case (read-only) and the handoff buttons
// beside the NLA. The Marshal stack board that used to sit above the stack Bay is the MARSHAL
// panel now (marshal-panel.js, crc-sync docs/adr/0114); the Bay keeps the Strips.
//
// What this file does NOT do is arithmetic. Angels, DME, push time, the final
// bearing and every magnetic conversion are computed by crc-sync and arrive in
// the hull view; carrier-state.js formats them. A controller cannot type a
// derived value because no control here accepts one. The Case, the ramp time, the marshal
// radial and the rest of the ship's state are typed in the carrier management panel
// (carrier-management-panel.js), not here: this panel's banner only shows them.

function _cel(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

const _signedOnCarrierIds = signedOnCarrierIds;

// ── The ship banner and the Case ──────────────────────────────────────────

/** Draws the banner into #efsp-carrier-banner when this controller is signed on at a carrier Position; hides it otherwise. */
export function renderCarrierBanner() {
  const root = typeof document !== 'undefined' ? document.getElementById('efsp-carrier-banner') : null;
  if (!root) return;
  const signedOn = _signedOnCarrierIds();
  const view = getEfspCarrier();
  if (signedOn.length === 0 || !view) { root.hidden = true; root.innerHTML = ''; return; }
  root.hidden = false;
  // An open input must not be torn out from under the controller (Enter commits,
  // Esc reverts, no commit on blur: the Strip panel's own rule).
  if (root.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  root.innerHTML = '';

  const banner = carrierBannerParts(view);
  const line = _cel('div', 'carrier-banner-line');
  line.appendChild(_cel('span', 'carrier-banner-hull', view.hullId));
  const text = _cel('span', 'carrier-banner-text', banner.text);
  text.dataset.carrierBanner = 'text';
  line.appendChild(text);
  root.appendChild(line);
  if (banner.problem && !banner.text.includes(banner.problem)) {
    const p = _cel('div', 'carrier-banner-problem', banner.problem);
    p.dataset.carrierBanner = 'problem';
    root.appendChild(p);
  }

  // The Case, read-only here: one setting for the whole ship, set in the carrier management panel by PriFly or the Marshal.
  const caseRow = _cel('div', 'carrier-case-row');
  caseRow.appendChild(_cel('span', 'carrier-case-label', 'CASE'));
  const current = view.recoveryCase ? view.recoveryCase.value : null;
  const ro = _cel('span', 'carrier-case-value', current || '—');
  ro.dataset.carrierCase = 'value';
  ro.title = 'The recovery Case is set in the carrier panel';
  caseRow.appendChild(ro);
  // The weather only ADVISES; it never blocks PriFly (ADR 0064, D11).
  if (view.advisory) {
    const adv = _cel('span', 'carrier-case-advisory', view.advisory.detail);
    adv.dataset.carrierCase = 'advisory';
    caseRow.appendChild(adv);
  }
  root.appendChild(caseRow);
}

// ── Handoff buttons ────────────────────────────────────────────────────

/** Gives the NLA button its handoff's identity: four trigger types, four looks (WP7A bullet 4). */
export function carrierDecorateNlaButton(btn, strip) {
  const key = strip && strip.nla && strip.nla.carrierHandoff;
  const t = key && CARRIER_HANDOFFS[key];
  if (!t) return;
  btn.dataset.carrierHandoff = key;
  btn.dataset.carrierTrigger = t.trigger;
  btn.classList.add('efsp-carrier-handoff', `efsp-carrier-trigger-${t.trigger.toLowerCase().replace(/_/g, '-')}`);
  btn.title = btn.title || `${t.label} — ${t.trigger.replace(/_/g, ' ').toLowerCase()}`;
}

/** What each sibling button does, in its tooltip (crc-sync docs/adr/0157). */
const ALSO_TITLES = {
  LAUNCH_TO_MARSHAL: 'Hands the flight to the Marshal as its recovery: it joins the stack.',
  DEPARTURE_TO_MARSHAL: 'Hands the flight to the Marshal as its recovery: it joins the stack.',
  BOLTER: 'Bolter: the flight stays with you, in the pattern.',
  CASE_I_BOLTER: 'Bolter: the flight stays with you, cleared to land.',
  DROP: 'Drop the Strip.',
};

/**
 * The buttons beside a Strip's NLA (crc-sync docs/adr/0157): the server's `strip.nla.also` (nla-also.js), TO MARSHAL beside
 * a launch's DROP, BOLTER beside TRAPPED, DROP beside LAUNCHED. Live only for the controller holding the Strip; an inhibited
 * one is drawn disabled with its reason.
 */
export function carrierExtraNlaButtons(strip) {
  if (!strip || !getActingPositions('CARRIER').includes(strip.ownerPositionId)) return [];
  const out = [];
  for (const a of nlaAlsoActions(strip)) {
    const t = a.handoff ? CARRIER_HANDOFFS[a.handoff] : null;
    if (t && !t.from.includes(strip.ownerPositionId)) continue;
    const drop = !a.handoff;
    const btn = _cel('button', `efsp-sbtn${drop ? '' : ' efsp-sbtn-go'} efsp-nla-btn${t ? ' efsp-carrier-handoff' : ''}`, a.label);
    if (t) { btn.dataset.carrierHandoff = a.handoff; btn.dataset.carrierTrigger = t.trigger; }
    btn.dataset.nlaAlso = a.key;
    btn.title = a.inhibited || ALSO_TITLES[a.key] || a.label;
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (a.inhibited) {
      btn.disabled = true;
      btn.classList.add('efsp-nla-btn-denied');
    } else {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const live = getEfspStrip(strip.stripId) || strip;
        sendEfspMutation(strip.ownerPositionId, live, a.op);
        btn.disabled = true;
      });
    }
    out.push(btn);
  }
  return out;
}

/** A signature of everything derived that a carrier Strip draws, for the keyed reconciler (bay-view.js's _stripRenderSignature). */
export function carrierSignatureFor(strip) {
  if (!isCarrierStrip(strip)) return '';
  const view = getEfspCarrier();
  if (!view) return '';
  const d = carrierDerivedFor(strip.flightDataId);
  const s = view.shipState || {};
  const fb = carrierStateOf(view) ? carrierStateOf(view).finalBearing.value : null;
  return [view.recoveryCase && view.recoveryCase.value, d ? `${d.caseValue}/${d.stackIndex}/${d.angels}/${d.marshalDme}/${d.pushTimeUtc}/${d.status}/${(d.marshalRadialDisplay || {}).value}/${(d.expectedFinalBearingDisplay || {}).value}` : '',
    fb, s.found ? 1 : 0].join('|');
}

// ── The final-bearing line on the map ───────────────────────────────────

const CARRIER_FINAL_LINE_NM = 15;

/**
 * The line aircraft fly in on: from the ship out along the RECIPROCAL of the
 * final bearing, with a crossbar every 5 NM. It mirrors geojson.js's extended
 * airport centreline but is keyed by hull, not by radar-id prefix (the `app:` /
 * `cvapp:` lesson, crc-sync docs/adr/0042). Drawn only for a controller holding a
 * carrier Position, and only from a TRUE bearing on a ship that is being tracked:
 * a grid or stale bearing would put the line in the wrong place, and a line in
 * the wrong place on a scope is worse than none.
 */
export function buildCarrierFinalLine() {
  const empty = { type: 'FeatureCollection', features: [] };
  if (!getActingPositions('CARRIER').length) return empty;
  const view = getEfspCarrier();
  const s = view && view.shipState;
  const fb = carrierStateOf(view) ? carrierStateOf(view).finalBearing : null;
  if (!s || !s.found || s.stale || !fb || fb.ref !== 'TRUE' || !Number.isFinite(fb.value)
      || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return empty;
  const out = (fb.value + 180) % 360;
  const [endLat, endLon] = projectPos(s.lat, s.lon, out, CARRIER_FINAL_LINE_NM * NM_M);
  const features = [{
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[s.lon, s.lat], [endLon, endLat]] },
    properties: { kind: 'carrier-final', color: '#9ad1ff' },
  }];
  for (let nm = 5; nm < CARRIER_FINAL_LINE_NM; nm += 5) {
    const [tLat, tLon] = projectPos(s.lat, s.lon, out, nm * NM_M);
    const [aLat, aLon] = projectPos(tLat, tLon, (out + 90) % 360, 600);
    const [bLat, bLon] = projectPos(tLat, tLon, (out + 270) % 360, 600);
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[aLon, aLat], [bLon, bLat]] }, properties: { kind: 'carrier-final-tick', color: '#9ad1ff' } });
  }
  return { type: 'FeatureCollection', features };
}

// The carrier family's wire handlers (CMSG; moved out of app.js's ws.onmessage).
// crc-sync's docs/adr/0074 — the carrier's hull record (Case, Marshal
// stack with its derived fields, ship banner), sent whole on every change.
// A Case change is ONE of these and every carrier Strip re-renders from it.
function _redrawCarriers() {
  renderCarrierBanner();
  renderCarrierManagement();
  markEfspChanged('bays');
}
registerEfspMessage('efsp-carrier-delta', (msg) => {
  applyEfspCarrierDelta(msg);
  _redrawCarriers();
});
registerEfspStoreRedraw('carriers', _redrawCarriers);

registerEfspMessage('efsp-carrier-ack', (msg) => {
  settleEfspAck(msg);
  if (!msg.ok) _showMutationError(msg.reason || 'Rejected', msg.detail, { subject: 'carrier' });
  if (msg.carrier) applyEfspCarrierDelta({ carriers: { updated: [msg.carrier] } });
  renderCarrierBanner();
  renderCarrierManagement();
  markEfspChanged('bays');
});
