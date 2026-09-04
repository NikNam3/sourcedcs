'use strict';

// Client-side glue for the CreateStrip flight-plan pre-fill — calls
// crc-sync's GET /api/flight-plan-lookup/:callsign (crc-sync/src/efsp/
// flight-plan-lookup.js) via app/server.js's local reverse-proxy, same
// pattern airport-selector.js/aprt-panel.js already use for /api/apt-
// weather and /api/atis-transmit: a relative same-origin path, the bearer
// token attached via sync.js's _syncAuthHeaders(), never crc-sync's URL or
// token handled directly by the renderer.
//
// Never throws and never leaves CreateStrip waiting indefinitely — every
// failure (network error, non-2xx, malformed body, or the bounded client-
// side timeout below) resolves {found:false}, mirroring the server-side
// module's own "never blocks Strip creation" contract exactly.

const FLIGHT_PLAN_LOOKUP_CLIENT_TIMEOUT_MS = 4000;

/**
 * @param {string} callsign
 * @param {{fetchImpl?:typeof fetch, timeoutMs?:number, authHeaders?:()=>object}} [opts] — injectable for tests
 * @returns {Promise<{found:true, seed:object}|{found:false}>} never throws
 */
async function lookupFlightPlanClient(callsign, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? FLIGHT_PLAN_LOOKUP_CLIENT_TIMEOUT_MS;
  const authHeaders = opts.authHeaders || (typeof _syncAuthHeaders === 'function' ? _syncAuthHeaders : () => ({}));

  if (!callsign || typeof callsign !== 'string') return { found: false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`/api/flight-plan-lookup/${encodeURIComponent(callsign)}`, {
      headers: authHeaders(), signal: controller.signal,
    });
    if (!res.ok) return { found: false };
    const data = await res.json();
    if (!data || data.found !== true || !data.seed || typeof data.seed !== 'object') return { found: false };
    return { found: true, seed: data.seed };
  } catch (err) {
    console.warn('[efsp] flight-plan lookup failed or unavailable — proceeding with a blank Strip:', err.message);
    return { found: false };
  } finally {
    clearTimeout(timer);
  }
}

const FLIGHT_PLAN_LIST_CLIENT_TIMEOUT_MS = 4000;

/**
 * Fetches the ops-filed queue — every currently-filed DD1801 plan
 * (crc-sync's GET /api/flight-plan-list, itself gated server-to-server by
 * a service credential against sourcedcs-web — see crc-sync/src/efsp/
 * flight-plan-lookup.js's listFiledFlightPlans()). Same never-throws
 * contract as lookupFlightPlanClient() above; an empty list is exactly
 * what a failure/unavailable backend and "nothing is actually filed"
 * both look like to this function — efsp-panel.js's own rendering decides
 * whether that's worth a distinct message.
 * @param {{fetchImpl?:typeof fetch, timeoutMs?:number, authHeaders?:()=>object}} [opts] — injectable for tests
 * @returns {Promise<Array<{id, callsign, submittedByName, submittedAt, seed}>>} never throws
 */
async function listFiledFlightPlansClient(opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? FLIGHT_PLAN_LIST_CLIENT_TIMEOUT_MS;
  const authHeaders = opts.authHeaders || (typeof _syncAuthHeaders === 'function' ? _syncAuthHeaders : () => ({}));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl('/api/flight-plan-list', { headers: authHeaders(), signal: controller.signal });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || data.ok !== true || !Array.isArray(data.plans)) return [];
    return data.plans;
  } catch (err) {
    console.warn('[efsp] flight-plan list unavailable — ops-filed will just show empty:', err.message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    lookupFlightPlanClient, FLIGHT_PLAN_LOOKUP_CLIENT_TIMEOUT_MS,
    listFiledFlightPlansClient, FLIGHT_PLAN_LIST_CLIENT_TIMEOUT_MS,
  };
}
