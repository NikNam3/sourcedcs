'use strict';

// The recovery board's rows, from what the client already holds (crc-sync docs/adr/0114; mockup docs/mockups/marshal-stack-panel.html).
// A leaf: it imports nothing, so node:test imports it directly and no panel module has to be loaded to test the rules.
//
// No arithmetic of the recovery lives here. Angels, DME, EAT and the push time come from the server's hull view; this module
// only chooses the order they are listed in, names the status, and compares fuel with bingo for the colour. Colour is the
// dark-cockpit rule (memory feedback_dark_cockpit_ui): a row is grey while it is in order; amber means look now (fuel within
// the margin of bingo, a flight past its EAT that has not pushed, a clearance changed and not yet passed, which the server
// marks); red is fuel at or below bingo. Nothing here tells the controller what to do.

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
      // the angels / EAT changed and not yet passed to the pilot, as the server keeps them (docs/adr/0115)
      unpassed: entry && Array.isArray(entry.unpassed) ? entry.unpassed : [],
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
