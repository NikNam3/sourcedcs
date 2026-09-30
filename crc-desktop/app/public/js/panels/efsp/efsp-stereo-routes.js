'use strict';

// Client-side glue for §9.10's stereo route table — calls crc-sync's
// GET /api/stereo-routes (crc-sync/src/efsp/stereo-routes.js) via
// app/server.js's local reverse-proxy, the same relative same-origin path
// with the bearer token attached by sync.js's _syncAuthHeaders() that
// efsp-flight-plan-lookup.js already uses. The renderer never handles
// crc-sync's URL or token directly.
//
// Never throws and never leaves the create-strip form waiting: every
// failure (network error, non-2xx, malformed body, or the bounded timeout
// below) resolves to an empty list. An empty list and "no routes are
// configured" are deliberately indistinguishable here, because the
// consequence is identical — the picker stays hidden and filing by hand
// works exactly as it did before this existed. The shipped table IS empty
// (crc-sync/config/efsp-stereo-routes.json), so that is the common case,
// not an error case.
//
// This list is the picker's option source only, never the authority. The
// server resolves the short name again at CreateStrip and refuses one it
// does not know, so a stale client list can cause a visible rejection but
// never a wrong FDR.

const STEREO_ROUTES_CLIENT_TIMEOUT_MS = 4000;

// The last list a fetch actually returned (docs/adr/0073). Block 9F's picker
// (strip-template.js's enumSelectOptionsFor) renders synchronously and cannot
// wait on a fetch, so it reads this. An ok response replaces it, including
// with an empty list (the table was emptied on the server); a FAILED fetch
// leaves it alone, because "crc-sync did not answer" says nothing about the
// table and blanking the picker on a network blip would take a working
// control away. efsp-panel.js already re-fetches on every snapshot, so this
// follows a restarted crc-sync with no code of its own.
let _stereoRoutesCache = [];

/** The routes the last successful fetch returned, in table order. Never throws; [] before any fetch. */
function cachedStereoRoutesClient() {
  return _stereoRoutesCache;
}

/**
 * @param {{fetchImpl?:typeof fetch, timeoutMs?:number, authHeaders?:()=>object}} [opts] — injectable for tests
 * @returns {Promise<Array<{name:string, description?:string, departureAirport?:string, destinationAirport?:string, route:string, requestedAltitude?:string, remarks?:string}>>} never throws
 */
async function listStereoRoutesClient(opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? STEREO_ROUTES_CLIENT_TIMEOUT_MS;
  const authHeaders = opts.authHeaders || (typeof _syncAuthHeaders === 'function' ? _syncAuthHeaders : () => ({}));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl('/api/stereo-routes', { headers: authHeaders(), signal: controller.signal });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || data.ok !== true || !Array.isArray(data.routes)) return [];
    // A record with no name can't be picked and a record with no route can't
    // seed anything — drop rather than render an option that would only ever
    // be refused. The server validates both, so this is belt-and-braces
    // against a hand-edited table reaching an older client.
    const routes = data.routes.filter(r => r && r.name && r.route);
    _stereoRoutesCache = routes;
    return routes;
  } catch (err) {
    console.warn('[efsp] stereo route list unavailable — filing by short name will just be unavailable:', err.message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The lookup key for a stereo name: uppercase, whitespace and hyphens
 * stripped, so "PACK 1", "pack1" and "PACK-1" are one route.
 *
 * A literal duplicate of crc-sync's stereo-routes.js normalizeStereoName —
 * same reasoning docs/adr/0001 gives for keeping the two Block Maps as
 * duplicates rather than a shared import: crc-sync and crc-desktop are
 * separately deployed packages with separate Docker build contexts. Only
 * used to resolve what a controller typed at `.stereo` against the fetched
 * list before sending; the server normalises again and is the authority.
 */
function normalizeStereoNameClient(name) {
  return String(name == null ? '' : name).toUpperCase().replace(/[\s-]+/g, '');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    listStereoRoutesClient, cachedStereoRoutesClient, normalizeStereoNameClient, STEREO_ROUTES_CLIENT_TIMEOUT_MS,
  };
}
