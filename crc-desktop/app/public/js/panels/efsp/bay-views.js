'use strict';

// Bay descriptor views (crc-sync docs/adr/0075, 0093): a Bay whose descriptor says
// `view: 'pattern' | 'final' | 'sfa-freqs'` mounts a component, instead of (or
// above) its Strip racks. One mechanism for every Bay that has one: RSU's pattern
// board, PAR's FINAL panel, the carrier's PriFly pattern and FINAL lanes, and the
// SFA frequency header. bay-view.js calls `renderBayDescriptorView()` once per
// render and knows nothing else about them.
//
// What each view does:
//   pattern    pattern-board.js over the Bay's racks (a leg is a Rack): Move between
//              legs, Landed, Drop. Advisories only; the board never refuses.
//   final      final-panel.js for the Bay's one Strip (§7.10: nothing to type). Its
//              sample comes from the Strip's correlated contact and the approach
//              radar; its two terminal buttons are the only gestures.
//   sfa-freqs  a header over the frequency racks: which controller is on which
//              frequency, editable by the jurisdiction Position only (guide §4.7).
//
// `replacesRacks` says the component IS the Bay's interface (RSU, PAR) and the
// racks are hidden; without it (the carrier's Bays, SFA) the racks stay and the
// component sits above them. The racks are always still built and reconciled, so a
// hidden rack costs nothing and the Strips keep the one render path.
//
// Pure model builders first (unit-tested), DOM second.

const FINAL_GLIDEPATH_NOMINAL_DEG = 3.0;  // [SOURCE-DEFINED] nominal glidepath; no runway geometry exists client-side
const FINAL_DECISION_HEIGHT_FT = 200;     // [SOURCE-DEFINED] decision height above the field when the Strip gives none
const FINAL_REFRESH_MS = 1000;            // the cadence bar and the mile calls are read off the clock, not an event
const NM_FT = 6076.12;
const NM_M = 1852;

const _fin = (v) => typeof v === 'number' && Number.isFinite(v);

/** The Bay's descriptor, from the snapshot's Bay list, or null. */
function bayDescriptorFor(bayId, bays = (typeof getEfspBays === 'function' ? getEfspBays() : [])) {
  return (bays || []).find(b => b.bayId === bayId) || null;
}

// ── pattern ─────────────────────────────────────────────────────────────────

/** The Bay's racks as legs, in rack order. */
function patternLegsFor(bay) {
  return (bay && bay.rackIds ? bay.rackIds : []).map(id => ({ id, label: String(id).toUpperCase() }));
}

/**
 * Strips on the pattern board: one entry per live Strip in the Bay, its leg the Rack it sits in. Time in
 * the pattern runs from when the Strip joined this Position (a hand-over's own stamp, else its creation),
 * not from its last Move, so going round again does not reset it.
 * @param {object} bay
 * @param {(bayId:string, rackId:string)=>object[]} rackOf  getEfspRack
 * @param {(fdrId:string)=>object|null} fdrOf               getEfspFdr
 */
function patternStripsFor(bay, rackOf, fdrOf) {
  const out = [];
  let order = 0;
  for (const rackId of bay.rackIds || []) {
    for (const s of rackOf(bay.bayId, rackId) || []) {
      const fdr = fdrOf ? fdrOf(s.fdrId) : null;
      const identity = (fdr && fdr.identity) || {};
      const joinedMs = (s.carrierTransfer && s.carrierTransfer.at) || s.createdAt;
      out.push({
        stripId: s.stripId, callsign: identity.callsign || '', type: identity.aircraftType || '',
        legId: s.rackId, enteredPatternS: _fin(joinedMs) ? joinedMs / 1000 : undefined, order: order++,
      });
    }
  }
  return out;
}

/** What a chip action or a Move asks the server for, as a plain op, or null. The Position that acts is the Strip's owner, if held. */
function patternOpFor(desc) {
  if (!desc) return null;
  if (desc.kind === 'MoveToLeg') return { kind: 'MoveStrip', rackId: desc.rackId };
  if (desc.toState === 'DROPPED') return { kind: 'DropStrip' };
  if (desc.toState) return { kind: 'SetState', toState: desc.toState };
  return null;
}

// ── final ───────────────────────────────────────────────────────────────────

/**
 * The FINAL sample for one Strip (final-panel.js's input), from what the client already has: the contact
 * the Strip is correlated to and the reference point it is measured from. No runway geometry exists
 * client-side, so distance is to the reference point (the approach radar's site for PAR, the ship for the
 * carrier), and the glidepath deviation is against a nominal 3 degrees from the field elevation. Every
 * missing input leaves its field undefined, which final-panel.js shows as `--` and never prompts on.
 * @param {object} i { kind, strip, callsign, runway, track, ref:{lat,lon,elevM?}, nowS }
 */
function finalSampleFor({ kind, strip, callsign, runway, track, ref, nowS } = {}) {
  const sample = { kind, stripId: strip ? strip.stripId : null, callsign: callsign || '', runway: runway || '--', nowS, decisionAltFt: undefined };
  const elevFt = ref && _fin(ref.elevM) ? ref.elevM * 3.28084 : null;
  if (kind === 'PAR' && elevFt !== null) sample.decisionAltFt = elevFt + FINAL_DECISION_HEIGHT_FT;
  if (!track || !ref || !_fin(track.lat) || !_fin(track.lon) || !_fin(ref.lat) || !_fin(ref.lon)) return sample;
  const haversine = typeof haversineM === 'function' ? haversineM : null;
  if (!haversine) return sample;
  sample.distanceNm = haversine(ref.lat, ref.lon, track.lat, track.lon) / NM_M;
  const altFt = track.altitude && _fin(track.altitude.ft) ? track.altitude.ft : null;
  if (altFt !== null) {
    sample.altitudeFt = altFt;
    if (elevFt !== null && sample.distanceNm >= 0.3) {
      const above = altFt - elevFt;
      sample.glidepathDevDeg = Math.atan2(above, sample.distanceNm * NM_FT) * 180 / Math.PI - FINAL_GLIDEPATH_NOMINAL_DEG;
    }
  }
  return sample;
}

/**
 * The op a terminal button sends. PAR's "Landing assured" and "Missed approach" are FINAL's own states, set
 * by the owner (ADR 0075). The carrier's "Ball" is its recorded FINAL_TO_LSO hand-over, so the trigger type
 * is kept (ADR 0074); its "Waveoff" is the state change.
 */
function finalTerminalOp(kind, terminal) {
  if (kind === 'CARRIER' && terminal && terminal.toState === 'BALL') return { kind: 'CarrierTransfer', transfer: 'FINAL_TO_LSO' };
  return terminal ? { kind: 'SetState', toState: terminal.toState } : null;
}

// ── DOM ─────────────────────────────────────────────────────────────────────

const _finalTrackers = new Map(); // stripId -> final-panel tracker
const _finalMounts = new Set();   // containers showing a final view, refreshed on a timer
let _finalTimer = null;

function _heldAt(bay) {
  return typeof getActingPositions === 'function' ? getActingPositions(bay.facilityId) : [];
}

function _send(strip, op) {
  if (!strip || typeof sendEfspMutation !== 'function') return;
  const live = (typeof getEfspStrip === 'function' && getEfspStrip(strip.stripId)) || strip;
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

/** Never rebuild under a control the controller is using. */
function _busy(el) {
  const a = typeof document !== 'undefined' ? document.activeElement : null;
  return !!(a && el.contains(a) && /^(select|input|textarea)$/i.test(a.tagName || ''));
}

function _renderPattern(container, bay) {
  const mount = _mountPoint(container, bay.bayId);
  const legs = patternLegsFor(bay);
  const strips = patternStripsFor(bay, getEfspRack, getEfspFdr);
  const fs = typeof getEfspFieldState === 'function' ? getEfspFieldState(bay.facilityId) : null;
  const runway = fs && fs.runways && fs.runways[0];
  const model = patternBoardModel({
    legs, strips, nowS: (typeof missionNow === 'function' ? missionNow() : Date.now()) / 1000,
    runwayStatus: runway ? (runway.status === 'OPEN' ? 'OPEN' : (runway.status === 'CLOSED' ? 'CLOSED' : 'SUSPENDED')) : undefined,
  });
  // Only a held Position acts: a read-only board for everyone else.
  const held = _heldAt(bay);
  const owner = (stripId) => { const s = getEfspStrip(stripId); return s && held.includes(s.ownerPositionId) ? s : null; };
  const act = (stripId, op) => { const s = owner(stripId); if (s && op) _send(s, { ...op, ...(op.kind === 'MoveStrip' ? { bayId: bay.bayId } : {}) }); };
  const board = renderPatternBoard(model, {
    doc: document, legs,
    onMove: (d) => act(d.stripId, patternOpFor(d)),
    onAction: (a) => act(a.stripId, patternOpFor(a)),
  });
  board.dataset.bayView = 'pattern';
  _replace(mount, board);
}

function _approachReference() {
  const radars = typeof getActiveRadars === 'function' ? getActiveRadars() : [];
  const r = radars.find(x => x.type === 'approach') || null;
  return r ? { lat: r.lat, lon: r.lon, elevM: r.elevM } : null;
}

function _carrierReference() {
  const view = typeof getEfspCarrier === 'function' ? getEfspCarrier() : null;
  const s = view && view.shipState;
  return s && _fin(s.lat) && _fin(s.lon) ? { lat: s.lat, lon: s.lon } : null;
}

function _renderFinal(container, bay) {
  const mount = _mountPoint(container, bay.bayId);
  const kind = bay.facilityId === 'CARRIER' ? 'CARRIER' : 'PAR';
  const live = [];
  for (const rackId of bay.rackIds || []) live.push(...getEfspRack(bay.bayId, rackId));
  const held = _heldAt(bay);
  const gone = new Set([..._finalTrackers.keys()]);
  const wrap = document.createElement('div');
  wrap.dataset.bayView = 'final';
  if (live.length === 0) {
    const none = document.createElement('div');
    none.className = 'efsp-final-none';
    none.textContent = kind === 'CARRIER' ? 'No aircraft on final.' : 'No aircraft on final. Rotate an aircraft in from SFA or APP.';
    wrap.appendChild(none);
  }
  for (const strip of live) {
    gone.delete(strip.stripId);
    if (!_finalTrackers.has(strip.stripId)) _finalTrackers.set(strip.stripId, createFinalTracker());
    const fdr = getEfspFdr(strip.fdrId);
    const trackId = typeof correlatedTrackIdForStrip === 'function' ? correlatedTrackIdForStrip(strip) : null;
    const track = trackId && typeof window !== 'undefined' && typeof window.getLatestTrack === 'function' ? window.getLatestTrack(trackId) : null;
    let runwayText = '--';
    if (typeof runwayForStrip === 'function' && typeof getEfspFieldState === 'function') {
      const r = runwayForStrip({ ...strip, role: 'ARRIVAL' }, fdr, getEfspFieldState(bay.facilityId));
      if (r) runwayText = r.end || r.runwayId;
    }
    const sample = finalSampleFor({
      kind, strip, callsign: fdr && fdr.identity ? fdr.identity.callsign : '', runway: runwayText, track,
      ref: kind === 'CARRIER' ? _carrierReference() : _approachReference(),
      nowS: (typeof missionNow === 'function' ? missionNow() : Date.now()) / 1000,
    });
    const vm = _finalTrackers.get(strip.stripId).update(sample);
    const panel = renderFinalPanel(vm, {
      doc: document,
      onTerminal: ({ id, toState }) => {
        if (!held.includes(strip.ownerPositionId)) return;
        const op = finalTerminalOp(kind, { id, toState });
        if (op) _send(strip, op);
      },
    });
    wrap.appendChild(panel);
  }
  for (const id of gone) _finalTrackers.delete(id); // a Strip that left final starts fresh if it returns
  _replace(mount, wrap);
  _finalMounts.add(container);
  if (!_finalTimer && typeof setInterval === 'function') {
    _finalTimer = setInterval(() => {
      for (const c of [..._finalMounts]) {
        if (!c.isConnected) { _finalMounts.delete(c); continue; }
        const bay = bayDescriptorFor(c.dataset.efspBayView);
        if (bay && !_busy(c)) _renderFinal(c, bay);
      }
    }, FINAL_REFRESH_MS);
    if (_finalTimer && typeof _finalTimer.unref === 'function') _finalTimer.unref(); // node (tests): never hold the process open
  }
}

function _renderSfaHeader(container, bay) {
  const view = getEfspSfa();
  const mount = _mountPoint(container, bay.bayId);
  if (!view) { _replace(mount, null); return; }
  if (_busy(mount)) return;
  const held = _heldAt(bay);
  const rotating = sfaRotatingPosition(held, view);
  const box = document.createElement('div');
  box.className = 'efsp-sfa-header';
  box.dataset.bayView = 'sfa-freqs';
  const title = document.createElement('div');
  title.className = 'efsp-sfa-title';
  title.textContent = `SFA ROTATION · ${view.jurisdiction} holds it · ${view.rotationSize} of ${view.pool.length} frequencies`;
  box.appendChild(title);
  const rows = document.createElement('div');
  rows.className = 'efsp-sfa-rows';
  for (const row of sfaRotationRows(view)) {
    const cell = document.createElement('div');
    cell.className = 'efsp-sfa-row';
    cell.dataset.rackId = row.rackId;
    const f = document.createElement('span');
    f.className = 'efsp-sfa-freq';
    f.textContent = row.text;
    cell.appendChild(f);
    if (rotating) {
      const sel = document.createElement('select');
      sel.className = 'efsp-sfa-select';
      sel.dataset.rackId = row.rackId;
      sel.title = `Who is on ${row.text}`;
      for (const [value, label] of [['', 'spare'], ...(view.controllers || []).map(p => [p, p])]) {
        const opt = document.createElement('option');
        opt.value = value; opt.textContent = label;
        if ((row.positionId || '') === value) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => {
        if (typeof sendEfspSfaMutation === 'function') {
          sendEfspSfaMutation(rotating, view.rev, { kind: 'SetSfaRotation', rackId: row.rackId, positionId: sel.value || null });
        }
      });
      cell.appendChild(sel);
    } else {
      const who = document.createElement('span');
      who.className = row.positionId ? 'efsp-sfa-on' : 'efsp-sfa-on efsp-sfa-spare';
      who.textContent = row.positionId || 'spare';
      cell.appendChild(who);
    }
    rows.appendChild(cell);
  }
  box.appendChild(rows);
  _replace(mount, box);
  // The rack headers carry the frequency, not just `freq-3`.
  for (const el of _racksOf(container)) {
    const row = sfaRotationRows(view).find(r => r.rackId === el.dataset.rackId);
    const head = [...el.children].find(c => typeof c.className === 'string' && c.className.split(/\s+/).includes('efsp-rack-header'));
    if (row && head) head.textContent = `${row.rackId} · ${row.text}${row.positionId ? ` · ${row.positionId}` : ''}`;
  }
}

/** Called by bay-view.js's renderBay() after the racks are reconciled. A Bay with no `view` is left exactly as it was. */
function renderBayDescriptorView(container, bay) {
  if (!container || !bay || typeof document === 'undefined') return;
  const stale = [...container.children].find(_isViewEl);
  if (!bay.view) { if (stale) stale.remove(); _setRacksHidden(container, false); _finalMounts.delete(container); return; }
  container.dataset.efspBayView = bay.bayId;
  _setRacksHidden(container, !!bay.replacesRacks);
  if (bay.view === 'pattern') _renderPattern(container, bay);
  else if (bay.view === 'final') _renderFinal(container, bay);
  else if (bay.view === 'sfa-freqs') _renderSfaHeader(container, bay);
}

/** The second button beside the NLA on a Strip on an SFA frequency: Rotate to PAR (ADR 0075). */
function sfaExtraNlaButtons(strip) {
  if (typeof getEfspSfa !== 'function' || typeof getActingPositions !== 'function') return [];
  const fdr = typeof getEfspFdr === 'function' ? getEfspFdr(strip.fdrId) : null;
  if (!sfaRotationOffered(strip, fdr, getActingPositions(strip.facilityId || undefined))) return [];
  const btn = document.createElement('button');
  btn.className = 'efsp-sbtn efsp-nla-btn efsp-sfa-rotate';
  btn.textContent = SFA_ROTATION_LABEL;
  btn.dataset.sfaTransfer = 'SFA_ROTATION';
  btn.title = 'Rotate to PAR: the controller changes, the aircraft keeps its frequency (guide 4.7)';
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    _send(strip, { kind: 'SfaRotation' });
    btn.disabled = true;
  });
  return [btn];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FINAL_GLIDEPATH_NOMINAL_DEG, FINAL_DECISION_HEIGHT_FT,
    bayDescriptorFor, patternLegsFor, patternStripsFor, patternOpFor, finalSampleFor, finalTerminalOp,
    renderBayDescriptorView, sfaExtraNlaButtons,
  };
}
