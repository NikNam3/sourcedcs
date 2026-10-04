'use strict';

// Pulls the upcoming airspace bookings from sourcedcs-web (docs/adr/0098 §9, DA-6): `GET /api/bookings/service/upcoming`,
// behind the same shared secret that guards crc-sync's own registry router (AIRSPACE_SERVICE_TOKEN). Same never-throws
// contract as listFiledFlightPlans(): sourcedcs-web down, slow, unconfigured or answering garbage is `{ok:false, reason}`.

const { webCall, LOOKUP_TIMEOUT_MS } = require('./web-call');

/**
 * @param {{fetchImpl?:typeof fetch, baseUrl?:string, timeoutMs?:number, serviceToken?:string}} [opts] injectable; defaults read the environment per call
 * @returns {Promise<{ok:true, bookings:Array<{theater:string, airspaceId:string, startUtc:string, endUtc:string, by:string, altitudeFt:number|null}>}|{ok:false, reason:string}>}
 */
async function listUpcomingAirspaceBookings(opts = {}) {
  const baseUrl = String(opts.baseUrl || process.env.CRCSYNC_SOURCEDCS_WEB_URL || 'http://localhost:7000').replace(/\/+$/, '');
  const serviceToken = opts.serviceToken ?? (process.env.AIRSPACE_SERVICE_TOKEN || '');
  if (!serviceToken) return { ok: false, reason: 'AIRSPACE_SERVICE_TOKEN is not configured' };

  const r = await webCall({ fetchImpl: opts.fetchImpl, url: `${baseUrl}/api/bookings/service/upcoming`, token: serviceToken, timeoutMs: opts.timeoutMs });
  if (!r.ok) return r;
  const raw = r.body;
  if (!Array.isArray(raw)) return { ok: false, reason: 'malformed response from sourcedcs-web' };
  const bookings = [];
  for (const b of raw) {
    const ref = b && b.airspaceRef;
    if (!ref || typeof ref.theater !== 'string' || typeof ref.airspaceId !== 'string') continue;
    if (!Number.isFinite(Date.parse(b.startUtc)) || !Number.isFinite(Date.parse(b.endUtc))) continue;
    bookings.push({
      theater: ref.theater,
      airspaceId: ref.airspaceId,
      startUtc: new Date(b.startUtc).toISOString(),
      endUtc: new Date(b.endUtc).toISOString(),
      by: typeof b.by === 'string' ? b.by : '',
      altitudeFt: Number.isFinite(b.altitudeFt) ? b.altitudeFt : null,
    });
  }
  return { ok: true, bookings };
}

module.exports = { listUpcomingAirspaceBookings, LOOKUP_TIMEOUT_MS };
