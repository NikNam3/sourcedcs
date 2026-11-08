'use strict';

// The recovery board's rows, from what the client already holds (crc-sync docs/adr/0114; mockup docs/mockups/marshal-stack-panel.html).
// A leaf: it imports nothing, so node:test imports it directly and no panel module has to be loaded to test the rules.
//
// No arithmetic of the recovery lives here. Angels, DME and EAT come from the server's hull view; this module only chooses
// the order they are listed in and which table a flight is in. crc-sync docs/adr/0156: every arrival is on this board from
// STACK to its drop, in its own Case's table (a flight keeps the Case it was given); there is no fuel rule. Colour is the
// dark-cockpit rule (memory feedback_dark_cockpit_ui): grey while in order, amber for a flight past its EAT that has not
// pushed and for a clearance changed and not yet passed, which the server marks. Nothing here tells the controller what to do.

const KLB = 1000;

/** The kinds, in landing order: the ones on the approach first, then the commenced, then the holding. */
export const KIND_RANK = Object.freeze({ pattern: 0, approach: 0, comm: 1, hold: 2 });

/** A recovery state's kind (crc-sync authority/strip-types/cv-recovery.js). */
export const KIND_OF_STATE = Object.freeze({
  STACK: 'hold', COMMENCED: 'comm', FINAL_APPROACH: 'approach', DIRTY: 'approach', BULLSEYE: 'approach', CV_PATTERN: 'pattern',
});

/** Fuel in thousands of pounds, one decimal; '' when none was typed. */
export function fuelText(lb) {
  return Number.isFinite(lb) ? (lb / KLB).toFixed(1) : '';
}

/** The EAT minute as the board shows it: the minute of the hour, two digits. '' when there is no EAT. */
export function eatMinuteText(ms) {
  return Number.isFinite(ms) ? String(new Date(ms).getUTCMinutes()).padStart(2, '0') : '';
}

/** `2041:48Z` for an epoch ms (the board's clock). */
export function clockText(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}

/**
 * The rows of the board, in landing order (next to land at the top), split by the flight's Case.
 *
 * @param {object} a
 * @param {object} a.view          the hull view (carrier-state.js `getEfspCarrier()`)
 * @param {object[]} a.strips      every Strip the client holds (the live CV_RECOVERY ones are picked out here)
 * @param {(id:string)=>object|null} a.flightDataOf
 * @param {(strip:object)=>{bearingDeg:number, rangeNm:number}|null} [a.posOf]  true bearing and range from the ship to the
 *   flight's contact, or null (an unbound Case I flight has none)
 * @param {number} a.now           the mission clock, ms
 * @returns {{rows:object[], caseI:object[], sequenced:object[], vacancies:object[], toGo:number, holding:number}}
 */
export function buildBoard({ view, strips, flightDataOf, posOf, now }) {
  const entries = new Map();
  for (const [stackId, list] of Object.entries((view && view.derived) || {})) {
    for (const e of list || []) entries.set(e.flightDataId, { ...e, stackId });
  }
  const rows = [];
  for (const s of strips || []) {
    if (!s || s.state === 'DROPPED' || s.stripType !== 'CV_RECOVERY' || !s.flightDataId) continue;
    const kind = KIND_OF_STATE[s.state];
    if (!kind) continue;
    const entry = entries.get(s.flightDataId) || null;
    const fd = flightDataOf ? flightDataOf(s.flightDataId) : null;
    const identity = (fd && fd.identity) || {};
    const carrier = (fd && fd.military && fd.military.carrier) || {};
    const pos = posOf ? posOf(s) : null;
    const row = {
      flightDataId: s.flightDataId,
      stripId: s.stripId,
      ownerPositionId: s.ownerPositionId,
      state: s.state,
      kind,
      caseValue: entry && entry.caseValue ? entry.caseValue : null,
      side: carrier.sideNumber || identity.callsign || '',
      callsign: identity.callsign || '',
      type: identity.aircraftType || '',
      fuelLb: Number.isFinite(carrier.lowStateLb) ? carrier.lowStateLb : null,
      angels: entry ? entry.angels : null,
      angelsSet: !!(entry && entry.angelsSet),
      marshalDme: entry && entry.marshalDme != null ? entry.marshalDme : null,
      dmeSet: !!(entry && entry.dmeSet),
      slot: entry ? entry.stackIndex : null,
      eatUtc: entry && entry.pushTimeUtc != null ? entry.pushTimeUtc : null,
      eatSet: !!(entry && entry.eatSet),
      pushWindowEndUtc: entry && entry.pushWindowUtc ? entry.pushWindowUtc[1] : null,
      pushedAtUtc: entry && entry.pushedAtUtc != null ? entry.pushedAtUtc : null,
      // the angels / EAT changed and not yet passed to the pilot, as the server keeps them (docs/adr/0115)
      unpassed: entry && Array.isArray(entry.unpassed) ? entry.unpassed : [],
      bearingDeg: pos && Number.isFinite(pos.bearingDeg) ? pos.bearingDeg : null,
      dme: pos && Number.isFinite(pos.rangeNm) ? pos.rangeNm : null, // live range from the ship (the graphic, the order)
      inStack: !!entry,
    };
    row.late = row.kind === 'hold' && row.eatUtc != null && Number.isFinite(now) && now > (row.pushWindowEndUtc ?? row.eatUtc);
    rows.push(row);
  }
  rows.sort(compareLanding);
  const seqOf = (list) => list.forEach((r, i) => { r.seq = i + 1; });
  const caseI = rows.filter((r) => r.caseValue === 'I');
  const sequenced = rows.filter((r) => r.caseValue !== 'I');
  seqOf(caseI); seqOf(sequenced);
  let nextHold = null;
  for (const r of sequenced) if (r.kind === 'hold' && (nextHold === null || r.slot < nextHold.slot)) nextHold = r;
  if (nextHold) nextHold.next = true;
  // Vacant slots below the top of the Case II/III stack (a flight left and nobody closed up, decisions H28).
  const main = (view && view.derived && view.derived.MAIN) || [];
  const taken = new Set(main.map((e) => e.stackIndex));
  const top = Math.max(-1, ...main.map((e) => e.stackIndex));
  const vacancies = [];
  for (const slot of (view && view.slots && view.slots.MAIN) || []) {
    if (slot.stackIndex < top && !taken.has(slot.stackIndex)) vacancies.push({ slot: slot.stackIndex, angels: slot.angels, marshalDme: slot.marshalDme });
  }
  const holding = rows.filter((r) => r.kind === 'hold' || r.kind === 'comm').length;
  return { rows, caseI, sequenced, vacancies, toGo: rows.length, holding };
}

/** Landing order: on the approach by DME (nearest first), then the commenced by when they left, then the holding by slot. */
export function compareLanding(a, b) {
  const ra = KIND_RANK[a.kind];
  const rb = KIND_RANK[b.kind];
  if (ra !== rb) return ra - rb;
  if (ra === 0) return (a.dme ?? 99) - (b.dme ?? 99) || (a.side < b.side ? -1 : 1);
  if (ra === 1) return (a.pushedAtUtc ?? 0) - (b.pushedAtUtc ?? 0) || (a.slot ?? 0) - (b.slot ?? 0);
  return (a.slot ?? 0) - (b.slot ?? 0);
}

// ── the clearance marks (amber until passed) ─────────────────────────────

/**
 * Which of a row's angels / EAT show amber. The marks are the server's (crc-sync docs/adr/0115): the stack entry's `unpassed`,
 * shared by every Marshal controller and kept across a reload. The server decides what counts as a change; this only reads it.
 * `enabled` is this controller's setting (`marshalMarkChanged`): off, nothing shows amber here, and the marks stay on the server.
 */
export function marksOf(row, { enabled = true } = {}) {
  const u = enabled && row && row.kind === 'hold' && Array.isArray(row.unpassed) ? row.unpassed : [];
  return { angels: u.includes('angels'), eat: u.includes('eat') };
}

/**
 * The stack op for "the new clearance was passed" (the Marshal clicked the row), or null when this controller sees nothing to
 * pass. It names the angels and EAT as shown, so the server refuses it if they changed again before the click.
 */
export function passClearanceOp(row, { enabled = true } = {}) {
  const m = marksOf(row, { enabled });
  if (!m.angels && !m.eat) return null;
  return { kind: 'PassClearance', flightDataId: row.flightDataId, angels: row.angels, eatUtc: row.eatUtc };
}

// ── typed in the panel (crc-sync docs/adr/0137, live test U22) ────────────

/**
 * The fuel typed in the FUEL cell as the Strip's LOW ST Block (C12, `lowStateLb`), or null when it is not a figure. Fuel is spoken
 * in thousands of pounds ("4.8", CV NATOPS 6.4.13.2), so a figure under 100 is thousands; a larger one is pounds. Empty clears it.
 */
export function fuelBlockOp(text) {
  const t = String(text == null ? '' : text).trim();
  if (t === '') return { kind: 'SetBlock', blockId: 'C12', value: '' };
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return { kind: 'SetBlock', blockId: 'C12', value: String(Math.round(v < 100 ? v * KLB : v)) };
}

/** The stack op for angels typed in the ANG cell (crc-sync docs/adr/0156): a whole number, or empty to use the slot's. */
export function setAngelsOp(row, text) {
  const t = String(text == null ? '' : text).trim();
  if (t !== '' && !/^\d{1,2}$/.test(t)) return null;
  return { kind: 'SetAngels', flightDataId: row.flightDataId, angels: t === '' ? null : Number(t) };
}

/** The stack op for the holding fix DME typed in the DME cell (Case II/III): a whole number, or empty to use the slot's. */
export function setDmeOp(row, text) {
  const t = String(text == null ? '' : text).trim();
  if (t !== '' && !/^\d{1,2}$/.test(t)) return null;
  return { kind: 'SetDme', flightDataId: row.flightDataId, dme: t === '' ? null : Number(t) };
}

/** The stack op for an EAT typed in the EAT cell: a Zulu HHMM the server dates on the mission clock, or empty to use the slot's. */
export function setEatOp(row, text) {
  const t = String(text == null ? '' : text).trim();
  if (t !== '' && !/^\d{4}$/.test(t)) return null;
  return { kind: 'SetEat', flightDataId: row.flightDataId, eat: t === '' ? null : t };
}

// ── drag to re-sequence ───────────────────────────────────────────────────

/**
 * The slot to Move a dragged HOLD row to when it is dropped on another HOLD row: the target's slot, so the dragged flight takes
 * it and the target (and everyone up to the first vacancy) moves up one (the server's `Move`). Dropping on itself, on a row that
 * is not holding, or anywhere else is no move. Dropping below the last holding row is the next free slot at the top.
 */
export function dropSlot(rows, draggedId, targetId) {
  const dragged = rows.find((r) => r.flightDataId === draggedId);
  if (!dragged || dragged.kind !== 'hold' || draggedId === targetId) return null;
  if (targetId === null) {
    const top = Math.max(...rows.filter((r) => r.slot != null).map((r) => r.slot));
    return dragged.slot === top ? null : top + 1;
  }
  const target = rows.find((r) => r.flightDataId === targetId);
  if (!target || target.kind !== 'hold') return null;
  return target.slot;
}
