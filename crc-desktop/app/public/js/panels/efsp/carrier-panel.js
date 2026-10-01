'use strict';

// The carrier's surfaces on the Strip panel (crc-sync's docs/adr/0074, ADR 0064
// B7; guide §4.1, §9.12): the ship banner, the Case selector, the Marshal stack
// board, and the hand-over buttons beside the NLA.
//
// What this file does NOT do is arithmetic. Angels, DME, push time, the final
// bearing and every magnetic conversion are computed by crc-sync and arrive in
// the hull view; carrier-state.js formats them. A controller cannot type a
// derived value because no control here accepts one: the Marshal's only number
// for a flight is its slot, set by dragging the Strip onto a slot (one gesture,
// one `Move`), and the other things the Marshal types (Charlie time, the
// marshal radial, the Case I altitude) are inputs, never results.

// Client mirror of permission.js's CARRIER_CAPABILITIES (drift-tested). A UX
// convenience: the server's predicates are the authority.
const CARRIER_CAPABILITIES = {
  CV_MARSHAL: { setsCase: false, sequencesStack: true,  editsShipInput: true },
  CV_PRIFLY:  { setsCase: true,  sequencesStack: false, editsShipInput: true },
  CV_APP1:    { setsCase: false, sequencesStack: false, editsShipInput: false },
  CV_APP2:    { setsCase: false, sequencesStack: false, editsShipInput: false },
};
const CARRIER_POSITION_IDS = Object.keys(CARRIER_CAPABILITIES);
const CARRIER_CASES = ['I', 'II', 'III'];

/** The held CV Position that has this capability, or null. Pure over `heldIds`. */
function carrierActingFor(capability, heldIds) {
  for (const id of heldIds || []) {
    if (CARRIER_CAPABILITIES[id] && CARRIER_CAPABILITIES[id][capability]) return id;
  }
  return null;
}

function _heldCarrierIds() {
  return (typeof getActingPositions === 'function' ? getActingPositions('CARRIER') : []).filter(id => CARRIER_CAPABILITIES[id]);
}

function _cel(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function _sendCarrier(capability, op) {
  const acting = carrierActingFor(capability, _heldCarrierIds());
  if (!acting) return false;
  const view = getEfspCarrier();
  sendEfspCarrierMutation(acting, view ? view.hullId : undefined, undefined, op);
  return true;
}

// ── The ship banner and the Case selector ─────────────────────────────────

/** Draws the banner into #efsp-carrier-banner when this controller holds a carrier Position; hides it otherwise. */
function renderCarrierBanner() {
  const root = typeof document !== 'undefined' ? document.getElementById('efsp-carrier-banner') : null;
  if (!root) return;
  const held = _heldCarrierIds();
  const view = getEfspCarrier();
  if (held.length === 0 || !view) { root.hidden = true; root.innerHTML = ''; return; }
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

  // Case: one setting for the whole ship, PriFly's alone. Everyone else reads it.
  const caseRow = _cel('div', 'carrier-case-row');
  caseRow.appendChild(_cel('span', 'carrier-case-label', 'CASE'));
  const current = view.recoveryCase ? view.recoveryCase.value : null;
  if (carrierActingFor('setsCase', held)) {
    const sel = _cel('select', 'carrier-case-select');
    sel.dataset.carrierCase = 'select';
    for (const c of CARRIER_CASES) {
      const o = _cel('option', null, c);
      o.value = c;
      if (c === current) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      if (sel.value !== current) _sendCarrier('setsCase', { kind: 'SetCase', to: sel.value });
    });
    caseRow.appendChild(sel);
  } else {
    const ro = _cel('span', 'carrier-case-value', current || '—');
    ro.dataset.carrierCase = 'value';
    ro.title = 'The recovery Case is set by PriFly';
    caseRow.appendChild(ro);
  }
  // The weather only ADVISES; it never blocks PriFly (ADR 0064, D11).
  if (view.advisory) {
    const adv = _cel('span', 'carrier-case-advisory', view.advisory.detail);
    adv.dataset.carrierCase = 'advisory';
    caseRow.appendChild(adv);
  }
  // The one thing a controller may enter on the banner: the altimeter.
  if (carrierActingFor('editsShipInput', held)) {
    const alt = _cel('input', 'carrier-altimeter-input');
    alt.type = 'text';
    alt.placeholder = 'altimeter';
    alt.size = 6;
    alt.title = 'Altimeter setting (inHg), Enter to set; empty to use the theater weather';
    alt.dataset.carrierInput = 'altimeter';
    alt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const raw = alt.value.trim();
        _sendCarrier('editsShipInput', { kind: 'SetShipInput', input: { altimeterInHg: raw === '' ? null : Number(raw) } });
        alt.value = '';
      } else if (e.key === 'Escape') { alt.value = ''; alt.blur(); }
    });
    caseRow.appendChild(alt);
  }
  root.appendChild(caseRow);
}

// ── The Marshal stack board ───────────────────────────────────────────────

let _carrierDragSlot = null;

/** Slot rows for the board: every slot 0..top+2, each either a flight's derived entry or a vacancy with the server's preview of what it WOULD read. */
function carrierStackRows(view = getEfspCarrier(), stackId = 'MAIN') {
  if (!view) return [];
  const byIndex = new Map(((view.derived && view.derived[stackId]) || []).map(e => [e.stackIndex, e]));
  const slots = (view.slots && view.slots[stackId]) || [];
  const top = Math.max(-1, ...[...byIndex.keys()]);
  return slots.map(slot => {
    const entry = byIndex.get(slot.stackIndex) || null;
    return { stackIndex: slot.stackIndex, entry, preview: slot, vacantBelowTop: !entry && slot.stackIndex < top };
  });
}

function _callsignOfFdr(fdrId) {
  const fdr = fdrId && typeof getEfspFdr === 'function' ? getEfspFdr(fdrId) : null;
  return (fdr && fdr.identity && fdr.identity.callsign) || fdrId || '';
}

/** Orders the Strips of the stack Bay by stack slot (the Bay is "ordered by stackIndex"); every other Bay is left alone. */
function carrierOrderRack(bayId, strips) {
  if (bayId !== 'cv-marshal-stack') return strips;
  const idx = new Map(carrierDerivedStack().map(e => [e.fdrId, e.stackIndex]));
  return strips.slice().sort((a, b) => (idx.has(a.fdrId) ? idx.get(a.fdrId) : 1e9) - (idx.has(b.fdrId) ? idx.get(b.fdrId) : 1e9));
}

/** Moves a Strip's flight to a slot: ONE gesture, ONE `Move` (§9.12 rule 2). Called by the drag's drop and by the slot's own hand. */
function carrierMoveToSlot(strip, toIndex) {
  if (!strip || !Number.isInteger(toIndex)) return false;
  return _sendCarrier('sequencesStack', { kind: 'Move', fdrId: strip.fdrId, toIndex });
}

/**
 * Dragging a row of the board to another slot: ONE gesture, ONE `Move`. The board
 * is the whole stack in a few lines, so re-sequencing never needs the Strip below
 * it in view. (Dragging the Strip itself onto a slot works too: bay-view.js's
 * drop-target lookup knows `data-efsp-drop-slot`.)
 */
function _wireSlotDrag(el, row) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('input, button, select')) return;
    e.preventDefault(); // no text selection while dragging
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    let over = null;
    const slotAt = (x, y) => { const t = document.elementFromPoint(x, y); return t ? t.closest('.carrier-slot[data-slot-index]') : null; };
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
      moved = true;
      el.classList.add('carrier-slot-dragging');
      const target = slotAt(ev.clientX, ev.clientY);
      if (target !== over) {
        if (over) over.classList.remove('efsp-drop-target');
        if (target && target !== el) target.classList.add('efsp-drop-target');
        over = target;
      }
    };
    const up = (ev) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      el.classList.remove('carrier-slot-dragging');
      if (over) over.classList.remove('efsp-drop-target');
      const target = moved ? slotAt(ev.clientX, ev.clientY) : null;
      if (target && target !== el) {
        _sendCarrier('sequencesStack', { kind: 'Move', fdrId: row.entry.fdrId, toIndex: Number(target.dataset.slotIndex) });
      }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
}

function _slotRowEl(row, caseValue, sequenced, canSequence) {
  const el = _cel('div', 'carrier-slot' + (row.entry ? ' carrier-slot-occupied' : ' carrier-slot-vacant'));
  el.dataset.slotIndex = String(row.stackIndex);
  if (row.entry && canSequence) { el.classList.add('carrier-slot-draggable'); el.title = 'Drag to another slot to re-sequence'; _wireSlotDrag(el, row); }
  // Same attribute the Position/Bay tabs carry: the Strip drag hit-tests for it.
  if (canSequence) el.dataset.efspDropSlot = String(row.stackIndex);
  el.appendChild(_cel('span', 'carrier-slot-index', String(row.stackIndex)));
  const entry = row.entry;
  const shown = entry || row.preview;
  el.appendChild(_cel('span', 'carrier-slot-call', entry ? _callsignOfFdr(entry.fdrId) : '—'));
  el.appendChild(_cel('span', 'carrier-slot-angels', shown.angels != null ? `A${shown.angels}` : (entry ? 'assign' : '')));
  if (sequenced) {
    el.appendChild(_cel('span', 'carrier-slot-dme', shown.marshalDme != null ? `${shown.marshalDme} DME` : ''));
    el.appendChild(_cel('span', 'carrier-slot-push', shown.pushTimeUtc != null ? `${carrierHhmm(shown.pushTimeUtc)}Z` : ''));
  }
  if (entry) {
    const st = _cel('span', 'carrier-slot-status carrier-slot-' + String(entry.status || '').toLowerCase(), entry.status === 'PUSHED' ? 'pushed' : 'holding');
    el.appendChild(st);
    if (caseValue === 'I' && canSequence) {
      // Case I: the stack is a list of squadron-assigned altitudes, not a timed stack (§9.12 rule 3).
      const inp = _cel('input', 'carrier-slot-angels-input');
      inp.type = 'text'; inp.size = 3; inp.placeholder = 'angels';
      inp.dataset.carrierInput = 'angels';
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const raw = inp.value.trim();
          _sendCarrier('sequencesStack', { kind: 'SetCaseIAngels', fdrId: entry.fdrId, caseIAngels: raw === '' ? null : Number(raw) });
          inp.value = '';
        } else if (e.key === 'Escape') { inp.value = ''; inp.blur(); }
      });
      el.appendChild(inp);
    }
  } else if (row.vacantBelowTop && canSequence) {
    const close = _cel('button', 'carrier-slot-closeup', 'Close up');
    close.title = 'Everyone above this gap moves down one slot';
    close.dataset.carrierAction = 'closeup';
    close.addEventListener('click', (e) => { e.stopPropagation(); _sendCarrier('sequencesStack', { kind: 'CloseUp', fromIndex: row.stackIndex }); });
    el.appendChild(close);
  }
  return el;
}

/**
 * Draws the stack board into a container (renderBay's `cv-marshal-stack` branch),
 * above the ordinary Rack of Strips: vacancies as empty slots, the derived
 * fields per slot, Charlie time and marshal radial for the Marshal.
 */
function renderCarrierStackBoard(container) {
  if (!container) return;
  let board = container.querySelector(':scope > .carrier-stack-board');
  const view = getEfspCarrier();
  const canSequence = !!carrierActingFor('sequencesStack', _heldCarrierIds());
  if (!view) { if (board) board.remove(); return; }
  // Never rebuild under an input being typed in.
  if (board && board.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  if (board) board.remove();
  board = _cel('div', 'carrier-stack-board');
  const caseValue = view.recoveryCase ? view.recoveryCase.value : null;
  const sequenced = caseValue === 'II' || caseValue === 'III';
  const stack = (view.stacks && view.stacks.MAIN) || {};

  const head = _cel('div', 'carrier-stack-head');
  head.appendChild(_cel('span', 'carrier-stack-title', `MARSHAL STACK · CASE ${caseValue || '—'}${sequenced ? '' : ' · altitude list'}`));
  if (sequenced && canSequence) {
    const charlie = _cel('input', 'carrier-charlie-input');
    charlie.type = 'text'; charlie.size = 5; charlie.maxLength = 4;
    charlie.placeholder = stack.charlieTimeUtc != null ? `C ${carrierHhmm(stack.charlieTimeUtc)}Z` : 'Charlie HHMM';
    charlie.title = 'Charlie time (Zulu HHMM): when slot 0 is due to push. Enter to set.';
    charlie.dataset.carrierInput = 'charlie';
    charlie.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { _sendCarrier('sequencesStack', { kind: 'SetCharlieTime', hhmm: charlie.value.trim() }); charlie.value = ''; }
      else if (e.key === 'Escape') { charlie.value = ''; charlie.blur(); }
    });
    head.appendChild(charlie);
    const radial = _cel('input', 'carrier-radial-input');
    radial.type = 'text'; radial.size = 5; radial.maxLength = 3;
    const defaultRadial = stack.marshalRadialDeg == null;
    radial.placeholder = defaultRadial ? 'radial (default)' : 'radial set';
    radial.title = 'Marshal radial, magnetic. Empty and Enter returns to the default (final bearing + 180).';
    radial.dataset.carrierInput = 'radial';
    radial.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const raw = radial.value.trim();
        _sendCarrier('sequencesStack', { kind: 'SetMarshalRadial', marshalRadialMagDeg: raw === '' ? null : Number(raw) });
        radial.value = '';
      } else if (e.key === 'Escape') { radial.value = ''; radial.blur(); }
    });
    head.appendChild(radial);
  }
  board.appendChild(head);

  const rows = carrierStackRows(view);
  if (rows.length === 0) board.appendChild(_cel('div', 'carrier-stack-empty', 'No flight in the stack.'));
  for (const row of rows) board.appendChild(_slotRowEl(row, caseValue, sequenced, canSequence));
  if (view.consistency && view.consistency.MAIN && view.consistency.MAIN.length) {
    board.appendChild(_cel('div', 'carrier-stack-warning', view.consistency.MAIN.map(c => c.detail).join(' · ')));
  }
  container.insertBefore(board, container.firstChild);
}

// ── Hand-over buttons ────────────────────────────────────────────────────

/** Gives the NLA button its hand-over's identity: four trigger types, four looks (WP7A bullet 4). */
function carrierDecorateNlaButton(btn, strip) {
  const key = strip && strip.nla && strip.nla.carrierTransfer;
  const t = key && CARRIER_TRANSFERS[key];
  if (!t) return;
  btn.dataset.carrierTransfer = key;
  btn.dataset.carrierTrigger = t.trigger;
  btn.classList.add('efsp-carrier-handover', `efsp-carrier-trigger-${t.trigger.toLowerCase().replace(/_/g, '-')}`);
  btn.title = btn.title || `${t.label} — ${t.trigger.replace(/_/g, ' ').toLowerCase()}`;
}

/** The second hand-over button a Strip may carry: "See you" beside Commence, Case II only (a Strip has one NLA, §3.5 rule 1). */
function carrierExtraNlaButtons(strip) {
  if (!strip || strip.role !== 'MARSHAL' || strip.state !== 'IN_STACK' || carrierCaseValue() !== 'II') return [];
  if (!getActingPositions('CARRIER').includes(strip.ownerPositionId)) return [];
  const t = CARRIER_TRANSFERS.MARSHAL_TO_PRIFLY;
  if (!t.from.includes(strip.ownerPositionId)) return [];
  const btn = _cel('button', `efsp-sbtn efsp-nla-btn efsp-carrier-handover efsp-carrier-trigger-${t.trigger.toLowerCase().replace(/_/g, '-')}`, t.label);
  btn.dataset.carrierTransfer = 'MARSHAL_TO_PRIFLY';
  btn.dataset.carrierTrigger = t.trigger;
  btn.title = 'See you: the pilot has the ship visual. Hands the flight to PriFly, leaving a gap in the stack.';
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const live = (typeof getEfspStrip === 'function' && getEfspStrip(strip.stripId)) || strip;
    sendEfspMutation(strip.ownerPositionId, live, { kind: 'CarrierTransfer', transfer: 'MARSHAL_TO_PRIFLY' });
    btn.disabled = true;
  });
  return [btn];
}

/** A signature of everything derived that a carrier Strip draws, for the keyed reconciler (bay-view.js's _stripRenderSignature). */
function carrierSignatureFor(strip) {
  if (!strip || !['MARSHAL', 'FINAL', 'PATTERN'].includes(strip.role)) return '';
  const view = getEfspCarrier();
  if (!view) return '';
  const d = carrierDerivedFor(strip.fdrId);
  const s = view.shipState || {};
  return [view.recoveryCase && view.recoveryCase.value, d ? `${d.stackIndex}/${d.angels}/${d.marshalDme}/${d.pushTimeUtc}/${d.status}/${(d.marshalRadialDisplay || {}).value}/${(d.expectedFinalBearingDisplay || {}).value}` : '',
    s.finalBearingDeg, s.found ? 1 : 0].join('|');
}

// ── FINAL's distance, from the ship and the contact ──────────────────────

/** Nautical miles from the ship to the flight's correlated contact; '' when either is unknown. The two positions are the server's; this only measures between them for display. */
function carrierFinalDistanceText(strip) {
  const view = getEfspCarrier();
  const s = view && view.shipState;
  if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon) || !strip) return '';
  const trackId = typeof correlatedTrackIdForStrip === 'function' ? correlatedTrackIdForStrip(strip) : null;
  const track = trackId && typeof window !== 'undefined' && typeof window.getLatestTrack === 'function' ? window.getLatestTrack(trackId) : null;
  if (!track || !Number.isFinite(track.lat) || !Number.isFinite(track.lon)) return '';
  const R = 3440.065; // earth radius, NM
  const rad = Math.PI / 180;
  const dLat = (track.lat - s.lat) * rad;
  const dLon = (track.lon - s.lon) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(s.lat * rad) * Math.cos(track.lat * rad) * Math.sin(dLon / 2) ** 2;
  return `${(2 * R * Math.asin(Math.sqrt(a))).toFixed(1)} NM`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CARRIER_CAPABILITIES, CARRIER_POSITION_IDS, carrierActingFor, carrierStackRows, carrierOrderRack };
}
