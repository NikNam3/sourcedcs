'use strict';

// The booking calendar chip (docs/adr/0098 §9, DA-6: information only). crc-sync pulls upcoming airspace bookings from
// sourcedcs-web and sends `efsp-airspace-calendar { theater, byAirspace: { [airspaceId]: [{ startUtc, endUtc, by,
// altitudeFt }] }, bookingUrl? }` on connect and on change. A booking never changes an airspace's state: it is real-world
// time, while the airspace window is mission time (ADR 0079), so this shows REAL UTC with its date and says nothing else.

let _calendar = { theater: null, byAirspace: {}, bookingUrl: null };

/** Take a calendar frame. Anything malformed leaves an empty calendar rather than throwing. */
export function applyAirspaceCalendar(msg) {
  const by = (msg && msg.byAirspace && typeof msg.byAirspace === 'object' && !Array.isArray(msg.byAirspace)) ? msg.byAirspace : {};
  const byAirspace = {};
  for (const [id, list] of Object.entries(by)) {
    if (!Array.isArray(list)) continue;
    const rows = list.filter(b => b && Number.isFinite(Date.parse(b.startUtc)) && Number.isFinite(Date.parse(b.endUtc)));
    if (rows.length) byAirspace[id] = rows;
  }
  _calendar = {
    theater: (msg && typeof msg.theater === 'string') ? msg.theater : null,
    byAirspace,
    bookingUrl: (msg && typeof msg.bookingUrl === 'string' && msg.bookingUrl) ? msg.bookingUrl : null,
  };
  return _calendar;
}

export function getAirspaceCalendar() { return _calendar; }
export function bookingUrl() { return _calendar.bookingUrl; }
export function _resetAirspaceCalendarForTest() { _calendar = { theater: null, byAirspace: {}, bookingUrl: null }; }

/**
 * The next booking for an airspace in `theater`: the first one that has not ended, by start time. `nowMs` is REAL time (a
 * booking is a real-world slot), so the caller passes the wall clock, never the mission clock.
 */
export function nextBooking(airspaceId, theater, nowMs, calendar = _calendar) {
  if (calendar.theater && theater && calendar.theater !== theater) return null;
  const rows = (calendar.byAirspace[airspaceId] || [])
    .filter(b => Date.parse(b.endUtc) > nowMs)
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  return rows[0] || null;
}

const hhmm = (iso) => new Date(Date.parse(iso)).toISOString().slice(11, 16).replace(':', '') + 'Z';
const ymd = (iso) => new Date(Date.parse(iso)).toISOString().slice(0, 10);

/**
 * `2026-10-03 1400Z–1600Z · RNG1 · FL230`: the date is always shown (it is real time, and may be days ahead), the end carries
 * its own date only when it is another day. `altText` formats the booked altitude (the panel passes its FL/feet writer).
 */
export function formatBooking(booking, altText = (ft) => String(ft)) {
  const sameDay = ymd(booking.startUtc) === ymd(booking.endUtc);
  const when = `${ymd(booking.startUtc)} ${hhmm(booking.startUtc)}–${sameDay ? '' : ymd(booking.endUtc) + ' '}${hhmm(booking.endUtc)}`;
  const bits = [when];
  if (booking.by) bits.push(String(booking.by));
  if (booking.altitudeFt != null && Number.isFinite(Number(booking.altitudeFt))) bits.push(altText(Number(booking.altitudeFt)));
  return bits.join(' · ');
}
