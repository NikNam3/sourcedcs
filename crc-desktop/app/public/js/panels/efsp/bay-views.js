'use strict';
import { missionNow } from '../../mission-clock.js';
import {
  getEfspBays, getEfspFlightData, getEfspRunwayStatus, getEfspRack, getEfspStrip
} from './efsp-state.js';
import { parSampleFor } from './par-samples.js';
import { parTerminalOp, parTerminalRecorded, parTerminals } from './par-model.js';
import { leadingFlightName } from './strip-fields.js';
import { carrierFinalDistanceText } from './carrier-final-distance.js';
import { parFlightOf, parShownStripId, showParFlight } from './par-panel.js';
import { onEfspChanged } from './efsp-change-bus.js';
import { FINAL_HANDOFF_LABEL, FINAL_RECEIVER, finalHandoffOffered, finalHandoffOp, sfaBayOf, sfaRows } from './sfa-state.js';
import { getActingPositions, sendEfspMutation } from './efsp-ws.js';
import { openStripMenu } from './strip-menu.js';
import { _appendDropButton } from './bay/strip-expanded.js';
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
//   final      one line per aircraft on the final. At an airfield its name picks it for the
//              PAR panel (par-panel.js, which draws the picture from the server's PAR sample,
//              crc-sync docs/adr/0112), its range to touchdown, the assigned HDG and ALT the
//              final controller may change, Begin descent / Cleared to land / Landed / Missed
//              approach, and the Strip's ⋯ menu and Drop, since the racks are hidden (crc-sync
//              docs/adr/0117, T5, T11). On the carrier (no PAR, H125, crc-sync docs/adr/0116)
//              the side number leads (H124), no range (the Strip's DIST Block carries it,
//              H126), and Ball / Waveoff.
//   sfa-freqs  a header over AP's frequency racks: each frequency, what it is for, and on the
//              three that rotate who has it selected now (crc-sync docs/adr/0117).
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
// At an airfield they are the final controller's (par-model.js PAR_TERMINALS).
const CARRIER_FINAL_TERMINALS = Object.freeze([
  Object.freeze({ id: 'BALL', label: 'Ball', toState: 'BALL' }),
  Object.freeze({ id: 'WAVEOFF', label: 'Waveoff', toState: 'BOLTER_WAVEOFF' }),
]);

/** The terminal actions of a final kind ('RUNWAY' | 'CARRIER'), as plain data. */
export function finalTerminalsFor(kind) {
  return kind === 'CARRIER' ? CARRIER_FINAL_TERMINALS.map(a => ({ ...a })) : parTerminals();
}

/** The op a terminal button sends: FINAL's own state, a final call, or the carrier's recorded Ball handoff. */
export function finalTerminalOp(kind, terminal) {
  if (!terminal) return null;
  if (kind === 'CARRIER' && terminal.toState === 'BALL') return { kind: 'CarrierHandoff', transfer: 'FINAL_TO_LSO' };
  return parTerminalOp(terminal);
}

/** The value of the flight's active assignment (`heading` | `altitude`), '' when none (docs/adr/0058). */
export function activeAssignment(flightData, field) {
  const cell = flightData && flightData.clearance && flightData.clearance[field];
  const e = cell && Array.isArray(cell.entries) ? cell.entries.find(x => x.status === 'ACTIVE') : null;
  return e && e.value ? String(e.value) : '';
}

/**
 * One flight line's model. At an airfield: the callsign, the range to touchdown from this controller's PAR sample ('' without
 * one), and the assigned HDG and ALT (crc-sync docs/adr/0117: the final controller changes them). On the carrier: the side
 * number leading (H124) and no range (H126: the Strip's DIST Block carries it).
 */
export function finalRowModel(strip, kind, par = kind === 'CARRIER' ? null : parSampleFor(strip.stripId), flightDataOf = getEfspFlightData) {
  if (kind === 'CARRIER') {
    return { stripId: strip.stripId, name: leadingFlightName(strip, flightDataOf(strip.flightDataId)) || '—', range: '' };
  }
  const nm = par && par.plot && Number.isFinite(par.plot.rangeNm) ? par.plot.rangeNm : null;
  const fd = flightDataOf(strip.flightDataId);
  return {
    stripId: strip.stripId, name: parFlightOf(strip.stripId).name || '—', range: nm == null ? '' : `${nm.toFixed(1)} NM`,
    hdg: activeAssignment(fd, 'heading'), alt: activeAssignment(fd, 'altitude'),
  };
}

// The FINAL Blocks the line's two fields write (crc-sync block-map.js FINAL_BLOCK_MAP: the flight's clearance).
export const FINAL_ASSIGNMENT_BLOCKS = Object.freeze({ hdg: '9A-VECTOR', alt: '7A' });

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
  // The list is rebuilt only when its flights, their recorded calls or their assignments change; a PAR sample (twice a
  // second) rewrites the text in place, so a button is never replaced under the controller's click, and nothing is rebuilt
  // while the controller is typing in the line.
  const rowSig = (strip) => {
    if (kind === 'CARRIER') return strip.stripId;
    const m = finalRowModel(strip, kind);
    const recorded = parTerminals().filter(t => parTerminalRecorded(strip, t)).map(t => t.id).join('+');
    return `${strip.stripId}:${m.hdg}:${m.alt}:${recorded}:${strip.rev}`;
  };
  const sig = `${kind}|${live.map(rowSig).join(',')}`;
  const existing = [...mount.children].find(el => el.dataset && el.dataset.bayView === 'final');
  if (existing && (existing.dataset.sig === sig || _busy(existing))) {
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
    none.textContent = 'No aircraft on final.';
    wrap.appendChild(none);
  }
  // the owner must be signed on here when a control is used, not when it was drawn
  const ownerHere = (strip) => {
    const s = getEfspStrip(strip.stripId) || strip;
    return _signedOnAt(bay).includes(s.ownerPositionId) ? s : null;
  };
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
      // HDG and ALT, the flight's assignments (crc-sync docs/adr/0117, H134 LT-RQ8 a): typed, sent on Enter or leaving the field.
      for (const [key, label] of [['hdg', 'HDG'], ['alt', 'ALT']]) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = `efsp-final-assign efsp-final-${key}`;
        input.dataset.assign = key;
        input.value = m[key];
        input.placeholder = label;
        input.size = 4;
        input.title = label === 'HDG' ? 'Assigned heading' : 'Assigned altitude';
        input.setAttribute('aria-label', input.title);
        input.addEventListener('pointerdown', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && typeof input.blur === 'function') input.blur(); });
        input.addEventListener('change', () => {
          const s = ownerHere(strip);
          if (!s || String(input.value).trim() === m[key]) return;
          _send(s, { kind: 'SetBlock', blockId: FINAL_ASSIGNMENT_BLOCKS[key], value: String(input.value).trim() });
        });
        cells.push(input);
      }
    }
    const term = document.createElement('div');
    term.className = 'efsp-final-terminals';
    for (const t of finalTerminalsFor(kind)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'efsp-final-terminal';
      b.dataset.terminal = t.id;
      b.textContent = t.label;
      // a recorded call stays on the line, greyed: it is the record (crc-sync docs/adr/0117)
      if (kind !== 'CARRIER' && parTerminalRecorded(strip, t)) { b.disabled = true; b.dataset.recorded = '1'; }
      b.addEventListener('click', () => {
        const s = ownerHere(strip);
        if (!s) return;
        const op = finalTerminalOp(kind, t);
        if (op) _send(s, op);
      });
      term.appendChild(b);
    }
    row.append(...cells, term);
    if (kind !== 'CARRIER') {
      // The racks are hidden here (`replacesRacks`), so the Strip's own ⋯ menu and Drop ride on its line (T5): a Strip the
      // buttons above cannot move is never out of reach.
      const tools = document.createElement('div');
      tools.className = 'efsp-final-tools';
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'efsp-sbtn efsp-sbtn-icon efsp-strip-menu-btn';
      more.textContent = '⋯';
      more.title = 'More actions';
      more.setAttribute('aria-haspopup', 'menu');
      more.addEventListener('pointerdown', (e) => e.stopPropagation());
      more.addEventListener('click', (e) => { e.stopPropagation(); openStripMenu(getEfspStrip(strip.stripId) || strip, more); });
      tools.appendChild(more);
      _appendDropButton(tools, strip);
      row.appendChild(tools);
    }
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
  if (!bay.view) { if (stale) stale.remove(); _setRacksHidden(container, false); _finalMounts.delete(container); return; }
  container.dataset.efspBayView = bay.bayId;
  _setRacksHidden(container, !!bay.replacesRacks);
  if (bay.view === 'pattern') _renderPattern(container, bay);
  else if (bay.view === 'final') _renderFinal(container, bay);
  else if (bay.view === 'sfa-freqs') _renderSfaHeader(container, bay);
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
