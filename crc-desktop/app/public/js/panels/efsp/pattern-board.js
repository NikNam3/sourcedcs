'use strict';

// The pattern board: RSU's Bay (§4.2: "Pattern board (not a strip rack): closed, initial, base,
// final") and PriFly's (initial, break, downwind, groove), docs/adr/0075 on docs/adr/0064.
//
// RSU and CV_PRIFLY are supervisory over a VISUAL pattern, not radar control (§4.1 rule 4), and RSU
// has no separation authority. So the board only ever ADVISES: every advisory is a tag under the
// board, none refuses a move, and none is a Mutation error. A leg is a Rack (ADR 0064: "racks are
// pattern legs, not states"), so moving an aircraft between legs is the ordinary Move gesture; this
// file builds the description of that move and leaves dispatching to the caller.
//
// Pure model first, renderer second. Times come from the injected mission clock (`nowS`), never
// Date.now() (H11).

const RSU_LEGS = [
  { id: 'closed', label: 'CLOSED' },
  { id: 'initial', label: 'INITIAL' },
  { id: 'base', label: 'BASE' },
  { id: 'final', label: 'FINAL' },
];
const PRIFLY_LEGS = [
  { id: 'initial', label: 'INITIAL' },
  { id: 'break', label: 'BREAK' },
  { id: 'downwind', label: 'DOWNWIND' },
  { id: 'groove', label: 'GROOVE' },
];

const PATTERN_LONG_MIN = 10;      // [SOURCE-DEFINED] minutes in the pattern before an advisory
const PATTERN_FINAL_MAX = 1;      // [SOURCE-DEFINED] more than this on the last leg is an advisory
const UNPLACED_LEG = '?';         // a Strip whose rack is not a leg is shown, never hidden

const INTENT_LABELS = { TOUCH_AND_GO: 'T&G', FULL_STOP: 'Full stop', LOW_APPROACH: 'Low app', STOP_AND_GO: 'S&G' };

// PATTERN Role's states (ADR 0064 B2). The two chip actions.
const PATTERN_ACTIONS = [
  { id: 'LANDED', label: 'Landed', toState: 'RECOVERED' },
  { id: 'DROP', label: 'Drop', toState: 'DROPPED' },
];

const _pbFinite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {object} p
 * @param {Array<{id,label}>} p.legs         the Bay's racks, in left-to-right order
 * @param {Array<object>} p.strips           { stripId, callsign, type?, intent?, legId, enteredPatternS?, order? }
 * @param {number} p.nowS                    mission clock, seconds
 * @param {string} [p.runwayStatus]          'OPEN' | 'SUSPENDED' | 'CLOSED'
 * @param {number} [p.longMin]
 * @param {number} [p.finalMax]
 */
function patternBoardModel({ legs, strips, nowS, runwayStatus, longMin, finalMax } = {}) {
  const legList = Array.isArray(legs) && legs.length ? legs : RSU_LEGS;
  const long = _pbFinite(longMin) ? longMin : PATTERN_LONG_MIN;
  const finalCap = _pbFinite(finalMax) ? finalMax : PATTERN_FINAL_MAX;
  const known = new Set(legList.map(l => l.id));

  const columns = legList.map(l => ({ legId: l.id, label: l.label, count: 0, chips: [] }));
  const unplaced = { legId: UNPLACED_LEG, label: 'UNPLACED', count: 0, chips: [] };
  const byLeg = new Map(columns.map(c => [c.legId, c]));

  const ordered = [...(strips || [])].sort((a, b) =>
    (_pbFinite(a.order) ? a.order : Infinity) - (_pbFinite(b.order) ? b.order : Infinity)
    || (_pbFinite(a.enteredPatternS) ? a.enteredPatternS : Infinity) - (_pbFinite(b.enteredPatternS) ? b.enteredPatternS : Infinity)
    || String(a.stripId).localeCompare(String(b.stripId)));

  const longOnes = [];
  for (const s of ordered) {
    const minutes = _pbFinite(s.enteredPatternS) && _pbFinite(nowS) ? Math.max(0, Math.floor((nowS - s.enteredPatternS) / 60)) : null;
    const chip = {
      stripId: s.stripId,
      callsign: s.callsign || '',
      type: s.type || '',
      intent: INTENT_LABELS[s.intent] || (s.intent || ''),
      minutes,
      long: minutes !== null && minutes > long,
      legId: known.has(s.legId) ? s.legId : UNPLACED_LEG,
    };
    const col = byLeg.get(chip.legId) || unplaced;
    col.chips.push(chip);
    col.count += 1;
    if (chip.long) longOnes.push(chip);
  }
  if (unplaced.count) columns.push(unplaced);

  const advisories = [];
  const last = byLeg.get(legList[legList.length - 1].id);
  if (last.count > finalCap) {
    advisories.push({ kind: 'CROWDED_FINAL', text: `${last.count} on ${last.label.toLowerCase()}: advisory`, stripIds: last.chips.map(c => c.stripId) });
  }
  for (const c of longOnes) {
    advisories.push({ kind: 'LONG_IN_PATTERN', text: `${c.callsign} ${c.minutes} min in pattern`, stripIds: [c.stripId] });
  }
  const total = columns.reduce((n, c) => n + c.count, 0);
  if (runwayStatus && runwayStatus !== 'OPEN' && total > 0) {
    advisories.push({ kind: 'RUNWAY_NOT_OPEN', text: `runway ${String(runwayStatus).toLowerCase()} with ${total} in pattern`, stripIds: [] });
  }
  return { columns, advisories, total };
}

/** The leg after `legId`, for the touch "next leg" button; the last leg has none. */
function nextLeg(legs, legId) {
  const list = Array.isArray(legs) ? legs : [];
  const i = list.findIndex(l => l.id === legId);
  return i >= 0 && i < list.length - 1 ? list[i + 1].id : null;
}

/** What dragging (or the next-leg button) asks for. A description only: the caller sends the Move. */
function moveToLeg(stripId, legId) {
  return { kind: 'MoveToLeg', stripId, rackId: legId };
}

function _pbEl(doc, tag, cls, text) {
  const el = doc.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * @param {object} model   from patternBoardModel
 * @param {object} [o]     { doc, legs, onMove(desc), onAction({stripId,id,toState}) }
 */
function renderPatternBoard(model, { doc, legs, onMove, onAction } = {}) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const root = _pbEl(d, 'div', 'efsp-pattern');
  const row = _pbEl(d, 'div', 'efsp-pattern-legs');
  const legList = legs || model.columns.filter(c => c.legId !== UNPLACED_LEG).map(c => ({ id: c.legId, label: c.label }));

  for (const col of model.columns) {
    const colEl = _pbEl(d, 'div', 'efsp-pattern-leg');
    colEl.dataset.leg = col.legId;
    const h = _pbEl(d, 'div', 'efsp-pattern-leg-head');
    h.appendChild(_pbEl(d, 'span', '', col.label));
    h.appendChild(_pbEl(d, 'span', 'efsp-pattern-count', String(col.count)));
    colEl.appendChild(h);
    if (col.legId !== UNPLACED_LEG) {
      colEl.addEventListener('dragover', (e) => { if (e && e.preventDefault) e.preventDefault(); });
      colEl.addEventListener('drop', (e) => {
        if (e && e.preventDefault) e.preventDefault();
        const id = e && e.dataTransfer && e.dataTransfer.getData ? e.dataTransfer.getData('text/plain') : null;
        if (id && onMove) onMove(moveToLeg(id, col.legId));
      });
    }
    for (const chip of col.chips) {
      const c = _pbEl(d, 'div', chip.long ? 'efsp-pattern-chip efsp-pattern-chip-long' : 'efsp-pattern-chip');
      c.dataset.stripId = chip.stripId;
      c.draggable = true;
      c.addEventListener('dragstart', (e) => { if (e && e.dataTransfer && e.dataTransfer.setData) e.dataTransfer.setData('text/plain', chip.stripId); });
      c.appendChild(_pbEl(d, 'div', 'efsp-pattern-cs', chip.callsign));
      c.appendChild(_pbEl(d, 'div', 'efsp-pattern-meta',
        [chip.type, chip.intent, chip.minutes === null ? '' : `${chip.minutes} min`].filter(Boolean).join(' · ')));
      const acts = _pbEl(d, 'div', 'efsp-pattern-actions');
      const nxt = nextLeg(legList, chip.legId);
      if (nxt) {
        const b = _pbEl(d, 'button', 'efsp-pattern-next', 'Next leg');
        b.addEventListener('click', () => { if (onMove) onMove(moveToLeg(chip.stripId, nxt)); });
        acts.appendChild(b);
      }
      for (const a of PATTERN_ACTIONS) {
        const b = _pbEl(d, 'button', 'efsp-pattern-action', a.label);
        b.dataset.action = a.id;
        b.addEventListener('click', () => { if (onAction) onAction({ stripId: chip.stripId, id: a.id, toState: a.toState }); });
        acts.appendChild(b);
      }
      c.appendChild(acts);
      colEl.appendChild(c);
    }
    row.appendChild(colEl);
  }
  root.appendChild(row);

  const adv = _pbEl(d, 'div', 'efsp-pattern-advisories');
  for (const a of model.advisories) adv.appendChild(_pbEl(d, 'span', 'efsp-pattern-advisory', a.text));
  root.appendChild(adv);
  return root;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    RSU_LEGS, PRIFLY_LEGS, PATTERN_LONG_MIN, PATTERN_FINAL_MAX, UNPLACED_LEG, INTENT_LABELS, PATTERN_ACTIONS,
    patternBoardModel, nextLeg, moveToLeg, renderPatternBoard,
  };
}
