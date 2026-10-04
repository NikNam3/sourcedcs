'use strict';

// The one GET crc-sync makes to sourcedcs-web (flight plans, airspace bookings). The mirror of sourcedcs-web's
// crcsync-client.js `call()`: same timeout policy (abort at `timeoutMs`), same never-throws contract, same naming of
// a service-token rejection. Resolves `{ok:true, status, body}` for any 2xx/404 answer's JSON, or `{ok:false, reason}`.

const log = require('../log').logger('efsp:web-call');

const LOOKUP_TIMEOUT_MS = 3000; // engineering constant

/**
 * @param {{fetchImpl?:typeof fetch, url:string, token?:string, timeoutMs?:number, label?:string}} o
 *   `token` set -> sent as a bearer. 401/403 are the service token, never the caller: reported as "service token rejected".
 * @returns {Promise<{ok:true, status:number, body:any}|{ok:false, status?:number, reason:string}>}
 */
async function webCall({ fetchImpl = fetch, url, token, timeoutMs = LOOKUP_TIMEOUT_MS, label = 'sourcedcs-web' }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init = { signal: controller.signal };
    if (token) init.headers = { Authorization: `Bearer ${token}` };
    const res = await fetchImpl(url, init);
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, reason: `${label} rejected the service token (HTTP ${res.status})` };
    if (!res.ok) return { ok: false, status: res.status, reason: `${label} returned ${res.status}` };
    return { ok: true, status: res.status, body: await res.json() };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    log.warn(`${label} ${aborted ? 'timed out' : 'unreachable or errored'}`, { error: err && err.message });
    return { ok: false, reason: aborted ? `${label} timed out` : `${label} unreachable` };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { webCall, LOOKUP_TIMEOUT_MS };
