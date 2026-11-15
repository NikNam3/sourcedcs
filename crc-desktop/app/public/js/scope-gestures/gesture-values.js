'use strict';
// The values the scope gestures write (docs/adr/0164): a dragged heading and a wheeled altitude. Pure: no DOM, no
// state, no imports. hdg-drag.js and alt-wheel.js feed it numbers and send what it returns through the Strip's own cell.
//
// The altitude text is the strip's own (crc-sync's flight-data-store.js parseAltitudeFt / formatAltitudeEnd /
// formatAltitudeBlock): a flight level at and above the theater's transition altitude, feet below, a block as
// `low-high`. A leading `<` (at or below) or `>` (at or above) is kept as it is and only the number moves, so the
// altitude-limit syntax (lane U-ALT-LIMITS) slots in with no edit here.

/** Heading step of the drag: the nearest 5° (SG-Q1 a, ours). */
export const HDG_STEP_DEG = 5;
/** Altitude per wheel notch: 1,000 ft, 100 ft with Shift (SG-Q2 a, ours). */
export const ALT_STEP_FT = 1000;
export const ALT_FINE_STEP_FT = 100;
/** The highest altitude a strip can write (FL999). */
export const ALT_MAX_FT = 99900;

/**
 * A magnetic heading (degrees, any range) rounded to the step, as a strip stores it: 1–360, north is 360 never 000.
 * Null for a non-number (the variation is not known yet: a true bearing is never sent as magnetic).
 */
export function roundHeading(magDeg, stepDeg = HDG_STEP_DEG) {
  if (!Number.isFinite(magDeg)) return null;
  const norm = ((magDeg % 360) + 360) % 360;
  const r = (Math.round(norm / stepDeg) * stepDeg) % 360;
  return r === 0 ? 360 : r;
}

/** '005', '360': the heading cell's text. '---' for null. */
export function headingText(deg) {
  return Number.isFinite(deg) ? String(deg).padStart(3, '0') : '---';
}

/** One end in feet, as crc-sync's parseAltitudeFt reads it: FL/F + 1–3 digits, A + 1–3 digits, 1–3 digits are hundreds, 4–5 are feet. */
function parseEndFt(t) {
  let m = /^F(?:L)?(\d{1,3})$/.exec(t);
  if (m) return Number(m[1]) * 100;
  m = /^A(\d{1,3})$/.exec(t);
  if (m) return Number(m[1]) * 100;
  m = /^(\d{1,5})$/.exec(t);
  if (!m) return null;
  return m[1].length <= 3 ? Number(m[1]) * 100 : Number(m[1]);
}

/**
 * An assigned altitude's text as `{prefix, lowFt, highFt}`: a single altitude has lowFt === highFt; a block is two
 * ends joined by `-`, `B` or `TO`, low first. `prefix` is a leading `<` or `>`, else ''. Null when it is not one.
 */
export function parseAssignedAltitude(text) {
  let t = String(text == null ? '' : text).trim().toUpperCase().replace(/\s+/g, '');
  let prefix = '';
  if (t[0] === '<' || t[0] === '>') { prefix = t[0]; t = t.slice(1); }
  if (!t) return null;
  const single = parseEndFt(t);
  if (single != null) return { prefix, lowFt: single, highFt: single };
  for (let i = 1; i < t.length - 1; i += 1) {
    for (const sep of ['-', 'B', 'TO']) {
      if (!t.startsWith(sep, i)) continue;
      const low = parseEndFt(t.slice(0, i));
      const high = parseEndFt(t.slice(i + sep.length));
      if (low != null && high != null && low < high) return { prefix, lowFt: low, highFt: high };
    }
  }
  return null;
}

/** One end as the strip writes it (crc-sync's formatAltitudeEnd): `FL240` at and above the transition altitude, `8000` below. */
export function altitudeEndText(ft, transitionAltFt) {
  return ft >= transitionAltFt && ft % 100 === 0 ? `FL${String(ft / 100).padStart(3, '0')}` : String(ft);
}

/** `{prefix, lowFt, highFt}` as the text the altitude cell is sent: `FL240`, `8000`, `FL220-FL240`, `<FL240`. */
export function formatAssignedAltitude(alt, transitionAltFt) {
  const body = alt.lowFt === alt.highFt
    ? altitudeEndText(alt.lowFt, transitionAltFt)
    : `${altitudeEndText(alt.lowFt, transitionAltFt)}-${altitudeEndText(alt.highFt, transitionAltFt)}`;
  return `${alt.prefix || ''}${body}`;
}

/**
 * The altitude moved by `notches` steps, a block as a whole (its height is kept), the prefix kept. A move that would
 * put the low end at or below 0 ft or the high end above FL999 is not made: the same altitude comes back (ours).
 */
export function shiftAltitude(alt, notches, stepFt) {
  const d = Math.trunc(notches) * stepFt;
  const lowFt = alt.lowFt + d;
  const highFt = alt.highFt + d;
  if (lowFt <= 0 || highFt > ALT_MAX_FT) return alt;
  return { prefix: alt.prefix || '', lowFt, highFt };
}

/**
 * Where the wheel starts (SG-Q4 a): the assigned altitude if there is one (its text first, so a prefix survives; else
 * its stored block or feet), else the contact's current altitude rounded to the step. Null when there is neither.
 * @param {{value?:string, parsed?:number|null, block?:{lowFt:number, highFt:number}|null}|null} entry the ACTIVE clearance entry
 * @param {number|null} currentFt
 */
export function altitudeStart(entry, currentFt, stepFt) {
  if (entry) {
    const fromText = parseAssignedAltitude(entry.value);
    if (fromText) return fromText;
    if (entry.block && Number.isFinite(entry.block.lowFt) && Number.isFinite(entry.block.highFt)) {
      return { prefix: '', lowFt: entry.block.lowFt, highFt: entry.block.highFt };
    }
    if (Number.isFinite(entry.parsed)) return { prefix: '', lowFt: entry.parsed, highFt: entry.parsed };
  }
  if (!Number.isFinite(currentFt)) return null;
  const r = Math.max(0, Math.round(currentFt / stepFt) * stepFt);
  return { prefix: '', lowFt: r, highFt: r };
}

/** A wheel event's delta in pixels (deltaMode 0 px, 1 lines, 2 pages). Shift+wheel arrives as deltaX in Chromium. */
function wheelPx(deltaY, deltaX, deltaMode) {
  const d = deltaY || deltaX || 0;
  return deltaMode === 1 ? d * 33 : deltaMode === 2 ? d * 800 : d;
}

/**
 * Wheel notches from one wheel event: a mouse wheel's event (40 px or more) is one notch whatever its size (Chromium
 * gives 53 px on Linux, 100 or 120 elsewhere); a touchpad's small deltas add up to a notch per 100 px (ours).
 * Up (negative delta) is +1: the altitude climbs.
 * @returns {{notches:number, acc:number}} acc carries the small deltas to the next event
 */
export function wheelNotches(acc, deltaY, deltaX = 0, deltaMode = 0) {
  const px = wheelPx(deltaY, deltaX, deltaMode);
  if (Math.abs(px) >= 40) return { notches: px < 0 ? 1 : -1, acc: 0 };
  const sum = (acc || 0) + px;
  if (Math.abs(sum) >= 100) return { notches: sum < 0 ? 1 : -1, acc: 0 };
  return { notches: 0, acc: sum };
}
