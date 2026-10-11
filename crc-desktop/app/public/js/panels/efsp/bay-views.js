'use strict';
import { missionNow } from '../../mission-clock.js';
import {
  getEfspBays, getEfspFlightData, getEfspRunwayStatus, getEfspRack, getEfspStrip
} from './efsp-state.js';
import { parSampleFor } from './par-samples.js';
import { parTerminalOp, parTerminals } from './par-model.js';
import { leadingFlightName } from './strip-fields.js';
import { carrierFinalDistanceText } from './carrier-final-distance.js';
import { parFlightOf, parShownStripId, showParFlight } from './par-panel.js';
import { onEfspChanged } from './efsp-change-bus.js';
import {
  SFA_ROTATION_LABEL, getEfspSfa, sfaRotatingPosition, sfaRotationOffered, sfaRotationRows
} from './sfa-state.js';
import { getActingPositions, sendEfspMutation, sendEfspSfaMutation } from './efsp-ws.js';
import { patternBoardModel, renderPatternBoard } from './pattern-board.js';

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
//   final      one line per aircraft on the final (§7.10: nothing to type). At an airfield
//              its name picks it for the PAR panel (par-panel.js, which draws the picture
//              from the server's PAR sample, crc-sync docs/adr/0112), its range to
//              touchdown, and Landing assured / Missed approach. On the carrier (no PAR,
//              H125, crc-sync docs/adr/0116) the side number leads (H124), no range (the
//              Strip's DIST Block carries it, H126), and Ball / Waveoff.
//   sfa-freqs  a header over the frequency racks: which controller is on which
//              frequency, editable by the jurisdiction Position only (guide §4.7).
//
// `replacesRacks` says the component IS the Bay's interface (RSU, PAR) and the
// racks are hidden; without it (the carrier's Bays, SFA) the racks stay and the
// component sits above them. The racks are always still built and reconciled, so a
// hidden rack costs nothing and the Strips keep the one render path.
//
// Pure model builders first (unit-tested), DOM second.

const _fin = (v) => typeof v === 'number' && Number.isFinite(v);

/** The Bay's descriptor, from the snapshot's Bay list, or null. */
export function bayDescriptorFor(bayId, bays = getEfspBays()) {
  return (bays || []).find(b => b.bayId === bayId) || null;
}

// ── pattern ─────────────────────────────────────────────────────────────────

/** The Bay's racks as legs, in rack order. */
export function patternLegsFor(bay) {
  return (bay && bay.rackIds ? bay.rackIds : []).map(id => ({ id, label: String(id).toUpperCase() }));
}

/**
 * Strips on the pattern board: one entry per live Strip in the Bay, its leg the Rack it sits in. Time in
 * the pattern runs from when the Strip joined this Position (a handoff's own stamp, else its creation),
 * not from its last Move, so going round again does not reset it.
 * @param {object} bay
 * @param {(bayId:string, rackId:string)=>object[]} rackOf  getEfspRack
 * @param {(flightDataId:string)=>object|null} flightDataOf               getEfspFlightData
 */
export function patternStripsFor(bay, rackOf, flightDataOf) {
  const out = [];
  let order = 0;
  for (const rackId of bay.rackIds || []) {
    for (const s of rackOf(bay.bayId, rackId) || []) {
      const flightData = flightDataOf ? flightDataOf(s.flightDataId) : null;
      const identity = (flightData && flightData.identity) || {};
      const joinedMs = (s.carrierHandoff && s.carrierHandoff.at) || s.createdAt;
      const name = leadingFlightName(s, flightData);
      out.push({
        stripId: s.stripId, name, aka: name !== (identity.callsign || '') ? (identity.callsign || '') : '', type: identity.aircraftType || '',
        legId: s.rackId, enteredPatternS: _fin(joinedMs) ? joinedMs / 1000 : undefined, order: order++,
      });
    }
  }
  return out;
}

/** What a chip action or a Move asks the server for, as a plain op, or null. The Position that acts is the Strip's owner, if held. */
export function patternOpFor(desc) {
  if (!desc) return null;
  if (desc.kind === 'MoveToLeg') return { kind: 'MoveStrip', rackId: desc.rackId };
  if (desc.toState === 'DROPPED') return { kind: 'DropStrip' };
  if (desc.toState) return { kind: 'SetState', toState: desc.toState };
  return null;
}

// ── final ───────────────────────────────────────────────────────────────────

/** The approach kind of a FINAL Bay: the carrier's lanes or a runway's PAR (the terminal labels and ops differ). */
export function finalKindOf(bay) {
  return bay && bay.facilityId === 'CARRIER' ? 'CARRIER' : 'RUNWAY';
}

// The carrier final's terminal ops (ADR 0064, 0075): "Ball" is the recorded FINAL_TO_LSO handoff, "Waveoff" the state change.
// At an airfield they are the PAR's (par-model.js PAR_TERMINALS).
const CARRIER_FINAL_TERMINALS = Object.freeze([
  Object.freeze({ id: 'BALL', label: 'Ball', toState: 'BALL' }),
  Object.freeze({ id: 'WAVEOFF', label: 'Waveoff', toState: 'BOLTER_WAVEOFF' }),
]);

/** The two terminal actions of a final kind ('RUNWAY' | 'CARRIER'), as plain data. */
export function finalTerminalsFor(kind) {
  return kind === 'CARRIER' ? CARRIER_FINAL_TERMINALS.map(a => ({ ...a })) : parTerminals();
}

/** The op a terminal button sends: FINAL's own state, or the carrier's recorded Ball handoff. */
export function finalTerminalOp(kind, terminal) {
  if (!terminal) return null;
  if (kind === 'CARRIER' && terminal.toState === 'BALL') return { kind: 'CarrierHandoff', transfer: 'FINAL_TO_LSO' };
  return parTerminalOp(terminal);
}

/**
 * One flight line's text. At an airfield: the callsign and the range to touchdown from this controller's PAR sample ('' without
 * one). On the carrier: the side number leading (H124) and no range (H126: the Strip's DIST Block carries it).
 */
export function finalRowModel(strip, kind, par = kind === 'CARRIER' ? null : parSampleFor(strip.stripId), flightDataOf = getEfspFlightData) {
  if (kind === 'CARRIER') {
    return { stripId: strip.stripId, name: leadingFlightName(strip, flightDataOf(strip.flightDataId)) || '—', range: '' };
  }
  const nm = par && par.plot && Number.isFinite(par.plot.rangeNm) ? par.plot.rangeNm : null;
  return { stripId: strip.stripId, name: parFlightOf(strip.stripId).name || '—', range: nm == null ? '' : `${nm.toFixed(1)} NM` };
}

// ── DOM ─────────────────────────────────────────────────────────────────────

const _finalMounts = new Set();   // containers showing a final view, redrawn on every PAR sample

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

/** Never rebuild under a control the controller is using. */
function _busy(el) {
  const a = typeof document !== 'undefined' ? document.activeElement : null;
  return !!(a && el.contains(a) && /^(select|input|textarea)$/i.test(a.tagName || ''));
}

function _renderPattern(container, bay) {
  const mount = _mountPoint(container, bay.bayId);
  const legs = patternLegsFor(bay);
  const strips = patternStripsFor(bay, getEfspRack, getEfspFlightData);
  const fs = getEfspRunwayStatus(bay.facilityId);
  const runway = fs && fs.runways && fs.runways[0];
  const model = patternBoardModel({
    legs, strips, nowS: missionNow() / 1000,
    runwayOpenStatus: runway ? (runway.status === 'OPEN' ? 'OPEN' : (runway.status === 'CLOSED' ? 'CLOSED' : 'SUSPENDED')) : undefined,
  });
  // Only a signed-on Position acts: a read-only board for everyone else.
  const signedOn = _signedOnAt(bay);
  const owner = (stripId) => { const s = getEfspStrip(stripId); return s && signedOn.includes(s.ownerPositionId) ? s : null; };
  const act = (stripId, op) => { const s = owner(stripId); if (s && op) _send(s, { ...op, ...(op.kind === 'MoveStrip' ? { bayId: bay.bayId } : {}) }); };
  const board = renderPatternBoard(model, {
    doc: document, legs,
    onMove: (d) => act(d.stripId, patternOpFor(d)),
    onAction: (a) => act(a.stripId, patternOpFor(a)),
  });
  board.dataset.bayView = 'pattern';
  _replace(mount, board);
}

function _renderFinal(container, bay) {
  const mount = _mountPoint(container, bay.bayId);
  const kind = finalKindOf(bay);
  const live = [];
  for (const rackId of bay.rackIds || []) live.push(...getEfspRack(bay.bayId, rackId));
  _finalMounts.add(container);
  const shown = parShownStripId();
  // The list is rebuilt only when its flights change; a PAR sample (twice a second) rewrites the text in place, so a button
  // is never replaced under the controller's click.
  const sig = `${kind}|${live.map(s => s.stripId).join(',')}`;
  const existing = [...mount.children].find(el => el.dataset && el.dataset.bayView === 'final');
  if (existing && existing.dataset.sig === sig) {
    for (const strip of live) {
      const row = [...existing.children].find(el => el.dataset.stripId === strip.stripId);
      if (!row) continue;
      const m = finalRowModel(strip, kind);
      row.dataset.shown = strip.stripId === shown ? '1' : '';
      const [name, range] = row.children;
      if (name.textContent !== m.name) name.textContent = m.name;
      if (kind !== 'CARRIER' && range.textContent !== m.range) range.textContent = m.range;
    }
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'efsp-final-list';
  wrap.dataset.bayView = 'final';
  wrap.dataset.sig = sig;
  if (live.length === 0) {
    const none = document.createElement('div');
    none.className = 'efsp-final-none';
    none.textContent = kind === 'CARRIER' ? 'No aircraft on final.' : 'No aircraft on final. Rotate an aircraft in from SFA or AP.';
    wrap.appendChild(none);
  }
  for (const strip of live) {
    const m = finalRowModel(strip, kind);
    const row = document.createElement('div');
    row.className = 'efsp-final-row';
    row.dataset.stripId = strip.stripId;
    row.dataset.shown = strip.stripId === shown ? '1' : '';
    const cells = [];
    if (kind === 'CARRIER') {
      // No PAR on the carrier (H125): the name is a label, not a link to a panel.
      cells.push(Object.assign(document.createElement('span'), { className: 'efsp-final-name', textContent: m.name }));
    } else {
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'efsp-final-name';
      name.textContent = m.name;
      name.title = 'Show in the PAR panel';
      name.addEventListener('click', () => showParFlight(strip.stripId));
      const range = document.createElement('span');
      range.className = 'efsp-final-range';
      range.textContent = m.range;
      cells.push(name, range);
    }
    const term = document.createElement('div');
    term.className = 'efsp-final-terminals';
    for (const t of finalTerminalsFor(kind)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'efsp-final-terminal';
      b.dataset.terminal = t.id;
      b.textContent = t.label;
      b.addEventListener('click', () => {
        // the owner must be signed on here when the button is pressed, not when it was drawn
        const s = getEfspStrip(strip.stripId) || strip;
        if (!_signedOnAt(bay).includes(s.ownerPositionId)) return;
        const op = finalTerminalOp(kind, t);
        if (op) _send(s, op);
      });
      term.appendChild(b);
    }
    row.append(...cells, term);
    wrap.appendChild(row);
  }
  _replace(mount, wrap);
}

// A PAR sample moves the ranges (twice a second while a final is worked): redraw the final lists on screen.
onEfspChanged('par', () => {
  for (const c of [..._finalMounts]) {
    if (c.isConnected === false) { _finalMounts.delete(c); continue; }
    const bay = bayDescriptorFor(c.dataset.efspBayView);
    if (bay && bay.view === 'final' && !_busy(c)) _renderFinal(c, bay);
  }
});

function _renderSfaHeader(container, bay) {
  const view = getEfspSfa();
  const mount = _mountPoint(container, bay.bayId);
  if (!view) { _replace(mount, null); return; }
  if (_busy(mount)) return;
  const signedOn = _signedOnAt(bay);
  const rotating = sfaRotatingPosition(signedOn, view);
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
        sendEfspSfaMutation(rotating, view.rev, { kind: 'SetSfaRotation', rackId: row.rackId, positionId: sel.value || null });
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
export function renderBayDescriptorView(container, bay) {
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
export function sfaExtraNlaButtons(strip) {
  const flightData = getEfspFlightData(strip.flightDataId);
  if (!sfaRotationOffered(strip, flightData, getActingPositions(strip.facilityId || undefined))) return [];
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
