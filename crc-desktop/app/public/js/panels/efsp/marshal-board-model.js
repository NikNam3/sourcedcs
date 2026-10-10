'use strict';

// The recovery board's rows, from what the client already holds (crc-sync docs/adr/0114; mockup docs/mockups/marshal-stack-panel.html).
// A leaf: it imports nothing, so node:test imports it directly and no panel module has to be loaded to test the rules.
//
// No arithmetic of the recovery lives here. Angels, DME, EAT and the push time come from the server's hull view; this module
// only chooses the order they are listed in, names the status, and compares fuel with bingo for the colour. Colour is the
// dark-cockpit rule (memory feedback_dark_cockpit_ui): a row is grey while it is in order; amber means look now (fuel within
// the margin of bingo, a flight past its EAT that has not pushed, a clearance changed and not yet passed); red is fuel at or
// below bingo. Nothing here tells the controller what to do.

const LANE_LETTER = Object.freeze({ CV_APP1: 'A', CV_APP2: 'B' });
const KLB = 1000;

/** The kinds, in landing order: the ones on the approach first, then the commenced, then the holding. */
export const KIND_RANK = Object.freeze({ approach: 0, bolter: 0, ball: 0, pattern: 0, comm: 1, hold: 2 });

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
 * How far above bingo a flight is, in thousands of pounds, or null when either figure was not typed.
 * @param {number|null} fuelLb
 * @param {number|null} bingoLb
 */
export function marginKlb(fuelLb, bingoLb) {
  return Number.isFinite(fuelLb) && Number.isFinite(bingoLb) ? (fuelLb - bingoLb) / KLB : null;
}

/** 'danger' (at or below bingo), 'attn' (within the margin of bingo) or '' (in order, or not enough typed to say). */
export function fuelLevel(fuelLb, bingoLb, marginSetting) {
  const m = marginKlb(fuelLb, bingoLb);
  if (m == null) return '';
  if (m <= 0) return 'danger';
  return m <= marginSetting ? 'attn' : '';
}

/** Status and kind from the flight's live carrier Strip (and, failing one, the stack entry). */
export function statusOf(strip, entry) {
  if (strip) {
    const lane = LANE_LETTER[strip.ownerPositionId] || '';
    if (strip.stripType === 'MARSHAL') {
      if (strip.state === 'IN_STACK') return { kind: 'hold', text: 'HOLD', lane };
      if (strip.state === 'COMMENCED') return { kind: 'comm', text: 'COMM', lane };
    }
    if (strip.stripType === 'FINAL') {
      if (strip.state === 'ON_FINAL') return { kind: 'approach', text: lane ? `APP ${lane}` : 'APP', lane };
      if (strip.state === 'BOLTER_WAVEOFF') return { kind: 'bolter', text: 'BOLTER', lane };
      if (strip.state === 'BALL') return { kind: 'ball', text: 'BALL', lane };
    }
    if (strip.stripType === 'PATTERN') return { kind: 'pattern', text: 'PATTERN', lane: '' };
  }
  if (entry) return entry.status === 'PUSHED' ? { kind: 'comm', text: 'COMM', lane: '' } : { kind: 'hold', text: 'HOLD', lane: '' };
  return null;
}

/**
 * The rows of the board, in landing order (next to land at the top).
 *
 * @param {object} a
 * @param {object} a.view          the hull view (carrier-state.js `getEfspCarrier()`)
 * @param {object[]} a.strips      every Strip the client holds (the carrier Strips are picked out here)
 * @param {(id:string)=>object|null} a.flightDataOf
 * @param {(strip:object)=>number|null} a.dmeOf   nautical miles from the ship to the flight's contact, or null
 * @param {number} a.now           the mission clock, ms
 * @param {number} a.marginKlb     the controller's low-state margin
 * @returns {{rows:object[], vacancies:object[], toGo:number}}
 */
export function buildBoard({ view, strips, flightDataOf, dmeOf, now, marginKlb: margin = 1.0 }) {
  const derived = (view && view.derived && view.derived.MAIN) || [];
  const byFd = new Map(derived.map((e) => [e.flightDataId, e]));
  // One live carrier Strip per flight: the one furthest along its landing (FINAL before MARSHAL before PATTERN is not an order
  // anyone relies on: a flight has one live carrier Strip at a time, because a handoff changes the Strip in place).
  const stripByFd = new Map();
  for (const s of strips || []) {
    if (!s || s.state === 'DROPPED' || !['MARSHAL', 'FINAL', 'PATTERN'].includes(s.stripType) || !s.flightDataId) continue;
    // PATTERN is also an airfield's Strip type (Incirlik's TWR): only the carrier's Strips are in the recovery.
    if (s.facilityId && s.facilityId !== 'CARRIER') continue;
    if (!stripByFd.has(s.flightDataId)) stripByFd.set(s.flightDataId, s);
  }
  const ids = new Set([...byFd.keys(), ...stripByFd.keys()]);
  const rows = [];
  let nextHold = null;
  for (const id of ids) {
    const entry = byFd.get(id) || null;
    const strip = stripByFd.get(id) || null;
    const st = statusOf(strip, entry);
    if (!st) continue;
    // A MARSHAL launch Strip (state LAUNCH) is not recovering: it is not on this board.
    if (strip && strip.stripType === 'MARSHAL' && strip.state === 'LAUNCH' && !entry) continue;
    const fd = flightDataOf ? flightDataOf(id) : null;
    const identity = (fd && fd.identity) || {};
    const carrier = (fd && fd.military && fd.military.carrier) || {};
    const dme = strip && st.kind !== 'hold' && dmeOf ? dmeOf(strip) : null;
    const fuelLb = Number.isFinite(carrier.lowStateLb) ? carrier.lowStateLb : null;
    const bingoLb = Number.isFinite(carrier.bingoFuelLb) ? carrier.bingoFuelLb : null;
    const row = {
      flightDataId: id,
      stripId: strip ? strip.stripId : null,
      kind: st.kind,
      status: st.text,
      lane: st.lane,
      side: carrier.sideNumber || '',
      // A flight with no side number typed yet is listed by its callsign, marked, so a row is never anonymous.
      sideMissing: !carrier.sideNumber,
      callsign: identity.callsign || '',
      type: identity.aircraftType || '',
      fuelLb, bingoLb,
      fuelLevel: fuelLevel(fuelLb, bingoLb, margin),
      angels: entry ? entry.angels : null,
      marshalDme: entry && entry.marshalDme != null ? entry.marshalDme : null,
      slot: entry ? entry.stackIndex : null,
      eatUtc: entry && entry.pushTimeUtc != null ? entry.pushTimeUtc : null,
      pushWindowEndUtc: entry && entry.pushWindowUtc ? entry.pushWindowUtc[1] : null,
      pushedAtUtc: entry && entry.pushedAtUtc != null ? entry.pushedAtUtc : null,
      turnNm: [4, 6, 8].includes(carrier.approachTurnNm) ? carrier.approachTurnNm : null,
      dme: Number.isFinite(dme) ? dme : null,
      inStack: !!entry,
    };
    row.late = row.kind === 'hold' && row.eatUtc != null && Number.isFinite(now) && now > (row.pushWindowEndUtc ?? row.eatUtc);
    rows.push(row);
  }
  rows.sort(compareLanding);
  for (const r of rows) if (r.kind === 'hold' && (nextHold === null || r.slot < nextHold.slot)) nextHold = r;
  if (nextHold) nextHold.next = true;
  rows.forEach((r, i) => { r.seq = i + 1; });
  // Vacant slots below the top of the stack (a flight left and nobody closed up, decisions H28): the Marshal closes them up.
  const holding = rows.filter((r) => r.kind === 'hold' || r.kind === 'comm');
  const taken = new Set((derived || []).map((e) => e.stackIndex));
  const top = Math.max(-1, ...derived.map((e) => e.stackIndex));
  const vacancies = [];
  for (const slot of (view && view.slots && view.slots.MAIN) || []) {
    if (slot.stackIndex < top && !taken.has(slot.stackIndex)) vacancies.push({ slot: slot.stackIndex, angels: slot.angels, marshalDme: slot.marshalDme });
  }
  return { rows, vacancies, toGo: rows.length, holding: holding.length };
}

/** Landing order: on the approach by DME (nearest first), then the commenced by when they left, then the holding by slot. */
export function compareLanding(a, b) {
  const ra = KIND_RANK[a.kind];
  const rb = KIND_RANK[b.kind];
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    // a bolter is on the downwind: it comes after the flights still inbound on final
    const da = a.kind === 'bolter' ? 6 : (a.dme ?? 99);
    const db = b.kind === 'bolter' ? 6 : (b.dme ?? 99);
    return da - db || (a.callsign < b.callsign ? -1 : 1);
  }
  if (ra === 1) return (a.pushedAtUtc ?? 0) - (b.pushedAtUtc ?? 0) || (a.slot ?? 0) - (b.slot ?? 0);
  return (a.slot ?? 0) - (b.slot ?? 0);
}

// ── the clearance marks (amber until passed) ─────────────────────────────

/**
 * Keeps, per flight, the angels and EAT the pilot was last told, and whether either has changed since. A mark is this
 * controller's: it lives in the panel, not on the server (a second Marshal controller sees the marks they have not cleared
 * themselves; the setting is per-controller too). The first time a flight is seen holding, what is shown is what it was told.
 * An EAT that appears from nothing (the ramp time was just set) is not a change. A flight that was commenced and is holding again
 * (Back to stack) comes back with both marked.
 */
export function createMarks() {
  return { flights: new Map() };
}

export function updateMarks(marks, rows, { enabled = true } = {}) {
  const live = new Set(rows.map((r) => r.flightDataId));
  for (const id of [...marks.flights.keys()]) if (!live.has(id)) marks.flights.delete(id);
  for (const r of rows) {
    let m = marks.flights.get(r.flightDataId);
    if (!m) { m = { told: null, angels: false, eat: false, wasCommenced: false }; marks.flights.set(r.flightDataId, m); }
    if (r.kind !== 'hold') {
      m.wasCommenced = true;
      m.told = null;
      m.angels = false;
      m.eat = false;
      continue;
    }
    const cur = { angels: r.angels, eat: r.eatUtc };
    if (!enabled) { m.told = cur; m.angels = false; m.eat = false; m.wasCommenced = false; continue; }
    if (!m.told) m.told = { ...cur };
    // a value that appears from nothing (the ramp time was just set) was never told, so it is not a change
    if (m.told.angels == null && cur.angels != null) m.told.angels = cur.angels;
    if (m.told.eat == null && cur.eat != null) m.told.eat = cur.eat;
    if (m.wasCommenced) {
      m.angels = true;
      m.eat = true;
      m.wasCommenced = false;
    } else {
      if (cur.angels != null && m.told.angels !== cur.angels) m.angels = true;
      if (cur.eat != null && m.told.eat !== cur.eat) m.eat = true;
    }
  }
  return marks;
}

/** The marker for a row: which of its angels / EAT show amber. */
export function marksOf(marks, flightDataId) {
  const m = marks.flights.get(flightDataId);
  return { angels: !!(m && m.angels), eat: !!(m && m.eat) };
}

/** The controller clicked the row: the new clearance was passed. */
export function passMarks(marks, row) {
  const m = marks.flights.get(row.flightDataId);
  if (!m) return false;
  const had = m.angels || m.eat;
  m.angels = false;
  m.eat = false;
  m.told = { angels: row.angels, eat: row.eatUtc };
  m.wasCommenced = false;
  return had;
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
