'use strict';

// Looks up a pilot-submitted DD Form 1801 (ICAO IFR) flight plan from
// sourcedcs-web by callsign, to pre-fill EFSP's CreateStrip form (guide
// §10.1 "Auto-population — do it aggressively," §10.5 "Provenance fallback
// chains" — pre-population must always degrade gracefully to full manual
// entry, never block Strip creation).
//
// This is the first live cross-service HTTP dependency anywhere in this
// repo. Every other shared need between services (e.g. the Casdoor token-
// exchange logic) is accepted code duplication instead, precisely because
// each service has an isolated Docker build context (see atobrief/
// server.js's own comment on that) — this is a genuinely different shape
// of dependency (a live network call, not shared code), so it needs its
// own failure discipline: sourcedcs-web being down, slow, or returning
// garbage MUST NEVER crash, hang, or reject unhandled in crc-sync. Every
// failure path below resolves to {found:false}, never a throw.
//
// DD Form 175 (crc-sync's other option, sourcedcs-web's routes/
// flight-plans.js) has no equivalent public by-callsign endpoint — only an
// auth-gated full-list route, squadron-scoped — so it isn't reachable this
// way without also forwarding a controller's Casdoor token. Only DD1801
// is wired up; if DD175 lookup is wanted later, it needs a real design
// decision about token forwarding, not just a second URL here.

const SOURCEDCS_WEB_URL = process.env.CRCSYNC_SOURCEDCS_WEB_URL || 'http://localhost:7000';
const LOOKUP_TIMEOUT_MS = 3000;
const FLIGHT_PLAN_SERVICE_TOKEN = process.env.FLIGHT_PLAN_SERVICE_TOKEN || '';

/**
 * @param {string} callsign
 * @param {{fetchImpl?:typeof fetch, baseUrl?:string, timeoutMs?:number}} [opts] — injectable for tests; production callers use the defaults.
 * @returns {Promise<{found:true, plan:object}|{found:false, reason:string}>} never throws, never rejects
 */
async function lookupFlightPlan(callsign, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const baseUrl = opts.baseUrl || SOURCEDCS_WEB_URL;
  const timeoutMs = opts.timeoutMs ?? LOOKUP_TIMEOUT_MS;

  if (!callsign || typeof callsign !== 'string') return { found: false, reason: 'no callsign given' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/api/fpl1801/by-callsign/${encodeURIComponent(callsign)}`, {
      signal: controller.signal,
    });
    if (res.status === 404) return { found: false, reason: 'no active flight plan for this callsign' };
    if (!res.ok) return { found: false, reason: `sourcedcs-web returned ${res.status}` };

    const plan = await res.json();
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return { found: false, reason: 'malformed response from sourcedcs-web' };
    return { found: true, plan };
  } catch (err) {
    // Network error, DNS failure, connection refused, timeout/abort, or a
    // JSON parse failure on a non-JSON body — all land here. Logged once,
    // never thrown further, never left as an unhandled rejection.
    console.warn('[flight-plan-lookup] sourcedcs-web unreachable or errored:', err.message);
    return { found: false, reason: 'sourcedcs-web unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Maps sourcedcs-web's DD1801 field names onto EFSP's FDR.filed shape
 * (fdr-store.js's createFdr() seed) — [SOURCE-DEFINED] mapping, since
 * sourcedcs-web's schema predates and is independent of EFSP's, and the
 * two use different field names for the same concepts. Only carries over
 * what EFSP actually models; DD1801-specific fields with no FDR
 * equivalent (fplMessage, worldTour, liveStreaming, endurance, pob, pic,
 * altn1/altn2, ...) are dropped, not stashed anywhere — nothing reads them.
 * Never throws — a missing/malformed field on the plan just yields an
 * empty string for that seed field, same as an ordinary blank CreateStrip.
 */
function toFdrFiledSeed(plan) {
  if (!plan || typeof plan !== 'object') return {};
  return {
    route: plan.route || '',
    requestedAltitude: plan.levelValue || '',
    departureAirport: plan.depAerodrome || '',
    destinationAirport: plan.destAerodrome || '',
    remarks: plan.otherInfo || '',
  };
}

/**
 * Lists every currently-filed DD1801 plan, for EFSP's "filed but not yet
 * worked as an active Strip" queue (OPS's ops-filed Bay). Unlike
 * lookupFlightPlan() above (public, single-record), this needs
 * sourcedcs-web's GET /api/fpl1801/service/all, which returns EVERY
 * pilot's filed plan and is gated accordingly — by a dedicated shared-
 * secret bearer token (FLIGHT_PLAN_SERVICE_TOKEN), not a Casdoor session
 * crc-sync doesn't have. Deliberately NOT implemented by fabricating a
 * token that claims an admin/controller role: sourcedcs-web's requireAuth
 * only ever base64-decodes the JWT payload with no signature check, so
 * that would technically work, but it would mean impersonating a real
 * person's authority via a known-weak check instead of using a real,
 * provisioned credential — see sourcedcs-web/auth.js's own comment on the
 * same decision, made together with this one.
 *
 * Same never-throws contract as lookupFlightPlan() — sourcedcs-web being
 * down, slow, or unconfigured (no token set) always resolves {ok:false},
 * never a throw. Each returned entry is a lightweight display/seed pair,
 * not the raw sourcedcs-web record — callers never see plan-specific
 * fields EFSP doesn't model (see toFdrFiledSeed's own doc for what's
 * dropped and why).
 *
 * @param {{fetchImpl?:typeof fetch, baseUrl?:string, timeoutMs?:number, serviceToken?:string}} [opts]
 * @returns {Promise<{ok:true, plans:Array<{id, callsign, submittedByName, submittedAt, seed}>}|{ok:false, reason:string}>}
 */
async function listFiledFlightPlans(opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const baseUrl = opts.baseUrl || SOURCEDCS_WEB_URL;
  const timeoutMs = opts.timeoutMs ?? LOOKUP_TIMEOUT_MS;
  const serviceToken = opts.serviceToken ?? FLIGHT_PLAN_SERVICE_TOKEN;

  if (!serviceToken) return { ok: false, reason: 'FLIGHT_PLAN_SERVICE_TOKEN is not configured' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/api/fpl1801/service/all`, {
      headers: { Authorization: `Bearer ${serviceToken}` },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: `sourcedcs-web returned ${res.status}` };

    const raw = await res.json();
    if (!Array.isArray(raw)) return { ok: false, reason: 'malformed response from sourcedcs-web' };

    const plans = raw.map((plan) => ({
      id: plan && plan.id != null ? plan.id : null,
      callsign: (plan && plan.aircraftId) || '',
      submittedByName: (plan && plan.submittedBy && plan.submittedBy.name) || null,
      submittedAt: (plan && plan.submittedAt) || null,
      seed: toFdrFiledSeed(plan),
    })).filter((p) => p.callsign); // a plan with no aircraftId at all can't seed a CreateStrip — drop it rather than surface an unusable card

    return { ok: true, plans };
  } catch (err) {
    console.warn('[flight-plan-lookup] sourcedcs-web unreachable or errored (list):', err.message);
    return { ok: false, reason: 'sourcedcs-web unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  lookupFlightPlan, toFdrFiledSeed, listFiledFlightPlans,
  SOURCEDCS_WEB_URL, LOOKUP_TIMEOUT_MS,
};
