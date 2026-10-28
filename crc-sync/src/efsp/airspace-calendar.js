'use strict';

// The airspace booking calendar, information only (docs/adr/0098 §9, DA-6). A booking is real-world time and never
// changes an airspace's state, so this holds a cache of the web's upcoming bookings and builds one message,
// `efsp-airspace-calendar`, for the loaded theater: the next NEXT_PER_AIRSPACE bookings of each airspace. The ticker
// refreshes it; `onChange` fires only when the message would differ from the one last sent.

const { WALL_CLOCK } = require('../mission-clock');
const log = require('../log').logger('efsp:airspace-calendar');

const NEXT_PER_AIRSPACE = 3; // engineering constant (briefing)

class AirspaceCalendar {
  /**
   * @param {object} deps
   * @param {() => Promise<{ok:boolean, bookings?:object[], reason?:string}>} deps.list the booking pull (never throws)
   * @param {() => (string|null)} deps.currentTheater the loaded mission's theater
   * @param {string|null} [deps.bookingUrl] the booking page link (CRCSYNC_SOURCEDCS_WEB_PUBLIC_URL); omitted from the message when unset
   * @param {(msg:object) => void} [deps.onChange]
   * @param {{now:()=>number}} [deps.wallClock] real time: a booking that has ended is not shown
   */
  constructor({ list, currentTheater, bookingUrl = null, onChange = () => {}, wallClock = WALL_CLOCK }) {
    this._list = list;
    this._theater = currentTheater;
    this._bookingUrl = bookingUrl || null;
    this._onChange = onChange;
    this._wall = wallClock;
    this._bookings = [];
    this._lastSent = null;
    this._lastFailure = null;
  }

  /** The message for the loaded theater now (`byAirspace` empty with no mission or no bookings). */
  message() {
    const theater = this._theater();
    const now = this._wall.now();
    const byAirspace = {};
    for (const b of this._bookings) {
      if (b.theater !== theater || Date.parse(b.endUtc) <= now) continue;
      (byAirspace[b.airspaceId] = byAirspace[b.airspaceId] || []).push(b);
    }
    for (const id of Object.keys(byAirspace)) {
      byAirspace[id] = byAirspace[id]
        .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
        .slice(0, NEXT_PER_AIRSPACE)
        .map(({ startUtc, endUtc, by, altitudeFt }) => ({ startUtc, endUtc, by, altitudeFt }));
    }
    const msg = { version: 1, type: 'efsp-airspace-calendar', theater: theater || null, byAirspace };
    if (this._bookingUrl) msg.bookingUrl = this._bookingUrl;
    return msg;
  }

  /** Pull, keep the cache on a failure (logged once per distinct reason), and report a change. @returns {Promise<boolean>} whether it was sent */
  async refresh() {
    const r = await this._list();
    if (r && r.ok) {
      this._bookings = r.bookings;
      this._lastFailure = null;
    } else {
      const reason = (r && r.reason) || 'unknown';
      if (reason !== this._lastFailure) log.warn('booking pull failed; keeping the last bookings', { reason });
      this._lastFailure = reason;
    }
    return this.notify();
  }

  /** Send when the message differs from the last one sent (a theater change or an expiry also counts). */
  notify() {
    const msg = this.message();
    const sig = JSON.stringify(msg);
    if (sig === this._lastSent) return false;
    this._lastSent = sig;
    try { this._onChange(msg); } catch (err) { log.error('calendar onChange failed', { err }); }
    return true;
  }
}

module.exports = { AirspaceCalendar, NEXT_PER_AIRSPACE };
