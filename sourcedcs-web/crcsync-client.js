'use strict';

/* Server-to-server client for crc-sync's airspace registry
   (/api/airspace-registry/*, docs/adr/0098 section 9). crc-sync owns the
   definitions; the web keeps no copy (DA-1), only a short read cache so the
   booking form does not hit crc-sync on every keystroke.

   Never throws: every method resolves to { ok: true, ... } or
   { ok: false, reason } (timeout, network failure, non-JSON body, a service-
   token rejection). Same discipline as crc-sync's flight-plan-lookup.js. */

const REQUEST_TIMEOUT_MS = 5000;   /* engineering constant */
const READ_CACHE_MS = 30 * 1000;   /* engineering constant (briefing) */

function createClient(opts) {
  const o = opts || {};
  const fetchImpl = o.fetch || globalThis.fetch;
  const baseUrl = String(o.baseUrl || 'http://localhost:3000').replace(/\/+$/, '');
  const token = o.token || '';
  const now = o.now || Date.now;           /* wall clock: a cache TTL, not an EFSP time */
  const timeoutMs = o.timeoutMs || REQUEST_TIMEOUT_MS;
  const cacheMs = o.cacheMs == null ? READ_CACHE_MS : o.cacheMs;
  const cache = new Map();                 /* theater -> { at, value } */

  async function call(method, pathAndQuery, body) {
    let timer;
    try {
      const ctl = new AbortController();
      timer = setTimeout(() => ctl.abort(), timeoutMs);
      const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
      const init = { method, headers, signal: ctl.signal };
      if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
      const res = await fetchImpl(baseUrl + pathAndQuery, init);
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { return { ok: false, reason: 'crc-sync returned a non-JSON body (HTTP ' + res.status + ')' }; }
      if (json === null || typeof json !== 'object') return { ok: false, reason: 'crc-sync returned an unexpected body' };
      /* 401/403 is the service token, never a user problem: report it as crc-sync unavailable to us */
      if (res.status === 401 || res.status === 403) return { ok: false, reason: 'crc-sync rejected the service token (HTTP ' + res.status + ')' };
      return { ok: true, status: res.status, body: json };
    } catch (err) {
      const aborted = err && err.name === 'AbortError';
      return { ok: false, reason: aborted ? 'crc-sync timed out' : 'crc-sync unreachable: ' + ((err && err.message) || err) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function listTheaters() {
    const r = await call('GET', '/api/airspace-registry/theaters');
    if (!r.ok) return r;
    if (r.status >= 500 || !Array.isArray(r.body.theaters || r.body)) return { ok: false, reason: 'crc-sync answered HTTP ' + r.status };
    return { ok: true, theaters: r.body.theaters || r.body };
  }

  /* opts.fresh bypasses the cache (the migration does one fresh read) */
  async function listAirspaces(theater, lopts) {
    const t = String(theater || '');
    const hit = cache.get(t);
    if (!(lopts && lopts.fresh) && hit && now() - hit.at < cacheMs) return hit.value;
    const r = await call('GET', '/api/airspace-registry?theater=' + encodeURIComponent(t));
    if (!r.ok) return r;
    if (r.status !== 200 || !Array.isArray(r.body.airspaces)) {
      return { ok: false, reason: (typeof r.body.error === 'string' && r.body.error) || 'crc-sync answered HTTP ' + r.status };
    }
    const value = { ok: true, theater: r.body.theater || t, airspaces: r.body.airspaces };
    cache.set(t, { at: now(), value });
    return value;
  }

  /* msg: { clientMutationId, airspaceId, op, baseDefRev? (Edit/Delete: an integer), baseRev? }. baseDefRev sits beside op, as in crc-sync's contract. The ack is returned as it came
     (refusal reasons, conflicts, warnings): { ok: true, status, ack }. */
  async function mutateAirspace(theater, msg, actor) {
    const m = msg || {};
    const r = await call('POST', '/api/airspace-registry/mutation', {
      theater, clientMutationId: m.clientMutationId, airspaceId: m.airspaceId, baseDefRev: m.baseDefRev, baseRev: m.baseRev, op: m.op,
      actor: { sub: actor && actor.sub, name: actor && actor.name },
    });
    cache.delete(String(theater || ''));   /* any outcome: the next read is fresh */
    if (!r.ok) return r;
    if (r.status >= 500) return { ok: false, reason: 'crc-sync answered HTTP ' + r.status };
    return { ok: true, status: r.status, ack: r.body };
  }

  function clearCache() { cache.clear(); }

  return { listTheaters, listAirspaces, mutateAirspace, clearCache };
}

/* The process-wide client the routes use; tests swap it with setClient(). */
let current = null;
function getClient() {
  if (!current) {
    current = createClient({
      baseUrl: process.env.SOURCEDCS_CRCSYNC_URL || 'http://localhost:3000',
      token: process.env.AIRSPACE_SERVICE_TOKEN || '',
    });
  }
  return current;
}
function setClient(c) { current = c; }

module.exports = { createClient, getClient, setClient, REQUEST_TIMEOUT_MS, READ_CACHE_MS };
