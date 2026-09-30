'use strict';

// A controller types a time of day; the FDR stores an instant.
//
// Strip times are spoken and written as four-digit Zulu clock times with no
// date ("exit at 32" → 1432). Every …Utc field on an FDR is epoch ms, so a
// typed time has to be given a date. That date is the MISSION clock's
// (docs/adr/0079, H11), never the wall clock's: a mission set on 2016-06-21 and
// flown today must not land a 1432 on today's calendar.
//
// Which day: the occurrence of HH:MM nearest to the mission's now — the same
// Zulu date, or the one either side of it when that is closer. Without this, a
// 0010 estimate typed at 2350Z would resolve to almost a day in the past. The
// window is ±12 h, which covers anything a controller posts on a Strip about a
// flight they are working. [SOURCE-DEFINED] — the guide sets no rule; the
// nearest-occurrence reading is ours (docs/adr/0062).
//
// Pure, no clock of its own: callers pass the mission clock's now().

const DAY_MS = 24 * 60 * 60 * 1000;

/** "1432", "14:32", "1432Z", "14:32z" → { hh, mm }, or null when it is not a Zulu time of day. */
function parseZuluHhmm(text) {
  const t = String(text == null ? '' : text).trim().toUpperCase();
  const m = /^(\d{2}):?(\d{2})Z?$/.exec(t);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return { hh, mm };
}

/**
 * A typed Zulu time of day as epoch ms, on the occurrence nearest `nowMs`
 * (the mission clock's now). Null when `text` is not a time of day.
 */
function resolveZuluHhmm(text, nowMs) {
  const t = parseZuluHhmm(text);
  if (!t || !Number.isFinite(nowMs)) return null;
  const now = new Date(nowMs);
  const sameDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), t.hh, t.mm);
  let best = sameDay;
  for (const candidate of [sameDay - DAY_MS, sameDay + DAY_MS]) {
    if (Math.abs(candidate - nowMs) < Math.abs(best - nowMs)) best = candidate;
  }
  return best;
}

/**
 * A typed Zulu time of day as epoch ms, on its FIRST occurrence strictly after
 * `afterMs`. For the end of a window whose start is known (the vul window,
 * S-F4): a 0200 end to a 2200 start is the next morning, and a window may run
 * longer than the ±12 h resolveZuluHhmm reaches. Null when `text` is not a
 * time of day.
 */
function resolveZuluHhmmAfter(text, afterMs) {
  const t = parseZuluHhmm(text);
  if (!t || !Number.isFinite(afterMs)) return null;
  const after = new Date(afterMs);
  let at = Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), t.hh, t.mm);
  while (at <= afterMs) at += DAY_MS;
  return at;
}

/** Epoch ms as the four-digit Zulu time a Strip shows ("1432"), or '' for no time. */
function formatZuluHhmm(ms) {
  if (ms == null || ms === '' || !Number.isFinite(Number(ms))) return '';
  const d = new Date(Number(ms));
  return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0');
}

module.exports = { parseZuluHhmm, resolveZuluHhmm, resolveZuluHhmmAfter, formatZuluHhmm };
