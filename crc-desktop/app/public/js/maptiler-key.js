// The MapTiler key (MAPKEY, H82 R3-39). The client ships with none: after the first working login
// crc-sync hands it over (GET /api/client-config, proxied by the local server), and every MapTiler
// request carries it from then on. Rotating the key is an env change on crc-sync, no client release.
// Held in memory only: it is fetched again at each login, never stored.

let key = null;
const listeners = [];

export function maptilerKey() { return key; }

/** Runs `fn(key)` each time a different, non-empty key arrives (the map and the contours refresh then). */
export function onMaptilerKey(fn) { listeners.push(fn); }

/** Fetches the key with the bearer token. Never throws: null on any failure, one console warning. */
export async function loadMaptilerKey(token, fetchFn = fetch) {
  try {
    const res = await fetchFn('/api/client-config', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const next = typeof data.maptilerKey === 'string' && data.maptilerKey ? data.maptilerKey : null;
    const changed = next !== null && next !== key;
    key = next;
    if (changed) for (const fn of listeners) { try { fn(key); } catch (e) { console.warn('[maptiler-key] listener failed', e); } }
    return key;
  } catch (e) {
    console.warn('[maptiler-key] map key unavailable from crc-sync:', e.message);
    return null;
  }
}

/** maplibre `transformRequest`: puts the key on MapTiler URLs (replacing any), leaves every other URL alone. */
export function transformMaptilerRequest(url) {
  if (!key || !/^https:\/\/api\.maptiler\.com\//.test(url)) return { url };
  const bare = url.replace(/([?&])key=[^&]*&?/, '$1').replace(/[?&]$/, '');
  return { url: bare + (bare.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key) };
}

export function _resetMaptilerKeyForTest() { key = null; listeners.length = 0; }
