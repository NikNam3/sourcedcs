'use strict';

// USMTF date-time groups (DTGs) → epoch milliseconds (docs/adr/0063).
//
// Forms (docs/parallel/research/usmtf-ato.md §1.4): `DDHHMMZ`, `DDHHMMZMON`,
// `DDHHMMZMONYYYY`. The zone letter is expected to be `Z`. Every DTG in an
// ATO is **in-game** Zulu (decision H11): nothing here reads the wall clock.
// A DTG that lacks its month or year is resolved against the ATO's own
// TIMEFRAM, or against an explicit `referenceUtc` the caller passes (L14
// would pass MissionClock.now()); with neither it resolves to null with a
// warning. `Date.now()` is deliberately never a silent default — output that
// depends on the day the code runs is a flaky test and a wrong Strip.
//
// Pure: no I/O, no requires. Always Date.UTC, never local time.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// DD HH MM [zone] [MON [YYYY]]. The zone is optional only so that the
// zone-less typo [AMVI] shows can be read with a warning. No nested quantifiers.
const DTG_RE = /^(\d{2})(\d{2})(\d{2})([A-Z])?(?:(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})?)?$/;

/**
 * @returns {{day,hour,minute,zone,month,year}|null} month is 0-based or null; zone null when absent
 */
function parseDtg(raw) {
  if (typeof raw !== 'string') return null;
  const m = DTG_RE.exec(raw.trim().toUpperCase());
  if (!m) return null;
  const day = Number(m[1]); const hour = Number(m[2]); const minute = Number(m[3]);
  if (day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return {
    day, hour, minute,
    zone: m[4] || null,
    month: m[5] ? MONTHS.indexOf(m[5]) : null,
    year: m[6] ? Number(m[6]) : null,
  };
}

function isDtgShaped(raw) { return parseDtg(raw) !== null; }

function daysInMonth(year, month) { return new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); }

function utcOf(year, month, d) {
  if (d.day > daysInMonth(year, month)) return null;
  return Date.UTC(year, month, d.day, d.hour, d.minute);
}

/**
 * @param {{fromUtc?:number|null,toUtc?:number|null,referenceUtc?:number|null}} basis
 * @returns {(raw:string|null) => {utc:number|null, raw:string|null, warnings:Array<{code,severity,message}>}}
 */
function makeResolver(basis = {}) {
  const from = Number.isFinite(basis.fromUtc) ? basis.fromUtc : null;
  const to = Number.isFinite(basis.toUtc) ? basis.toUtc : null;
  const ref = Number.isFinite(basis.referenceUtc) ? basis.referenceUtc : null;
  let anchor = null;
  if (from !== null && to !== null) anchor = from + (to - from) / 2;
  else if (from !== null) anchor = from;
  else if (to !== null) anchor = to;
  else if (ref !== null) anchor = ref;

  const inside = (t) => from !== null && to !== null && t >= from && t <= to;
  const pick = (cands) => {
    const ok = cands.filter((t) => t !== null);
    if (ok.length === 0) return null;
    const within = ok.filter(inside);
    const pool = within.length ? within : ok;
    return pool.reduce((best, t) => (Math.abs(t - anchor) < Math.abs(best - anchor) ? t : best));
  };

  return function resolve(raw) {
    if (raw == null || raw === '') return { utc: null, raw: null, warnings: [] };
    const d = parseDtg(raw);
    if (!d) {
      return { utc: null, raw, warnings: [{ code: 'TIME_UNPARSEABLE', severity: 'warning', message: `"${raw}" is not a date-time group (DDHHMMZ[MON[YYYY]]).` }] };
    }
    const warnings = [];
    if (d.zone === null) {
      warnings.push({ code: 'ZULU_ASSUMED', severity: 'info', message: `"${raw}" has no zone letter; read as Zulu.` });
    } else if (d.zone !== 'Z') {
      // Military zone letters are deliberately NOT converted: nothing here
      // needs them, and a wrong offset is worse than none.
      return { utc: null, raw, warnings: [{ code: 'NON_ZULU_TIME', severity: 'warning', message: `"${raw}" is not in Zulu (zone ${d.zone}); it was not converted.` }] };
    }
    let utc = null;
    if (d.month !== null && d.year !== null) {
      utc = utcOf(d.year, d.month, d);
      if (utc === null) return { utc: null, raw, warnings: [{ code: 'TIME_UNPARSEABLE', severity: 'warning', message: `"${raw}" names a day its month does not have.` }] };
      return { utc, raw, warnings };
    }
    if (anchor === null) {
      warnings.push({ code: 'TIME_UNRESOLVED', severity: 'warning', message: `"${raw}" has no ${d.month === null ? 'month' : 'year'}, and the ATO has no TIMEFRAM to take it from.` });
      return { utc: null, raw, warnings };
    }
    const a = new Date(anchor);
    const ay = a.getUTCFullYear(); const am = a.getUTCMonth();
    const cands = [];
    if (d.month !== null) {
      for (const y of [ay - 1, ay, ay + 1]) cands.push(utcOf(y, d.month, d));
    } else {
      for (const off of [-1, 0, 1]) {
        const mm = am + off;
        const y = ay + Math.floor(mm / 12);
        cands.push(utcOf(y, ((mm % 12) + 12) % 12, d));
      }
    }
    utc = pick(cands);
    if (utc === null) {
      warnings.push({ code: 'TIME_UNRESOLVED', severity: 'warning', message: `"${raw}" could not be placed near the ATO period.` });
    }
    return { utc, raw, warnings };
  };
}

module.exports = { parseDtg, isDtgShaped, makeResolver, MONTHS };
