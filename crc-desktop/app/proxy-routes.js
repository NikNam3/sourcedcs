'use strict';
// The crc-sync reverse-proxy routes of server.js as a table (QAC D-11), in
// the order the old if-chain tested them. First match wins. `path` is the
// upstream path on crc-sync: the fixed string, or the request URL as sent
// (query string included) when the route forwards it unchanged.
const exact  = (p) => (url) => url === p;
const prefix = (p) => (url) => url.startsWith(p);
const exactOrQuery = (p) => (url) => url === p || url.startsWith(p + '?');

const PROXY_ROUTES = [
  { match: exact('/api/ws-ticket'),                method: 'POST', path: '/api/ws-ticket' },
  // The MapTiler key, handed over after login (crc-sync GET /api/client-config; public/js/maptiler-key.js).
  { match: exact('/api/client-config'),            method: 'GET',  path: '/api/client-config' },
  { match: exact('/api/atis-transmit'),            method: 'POST', path: '/api/atis-transmit' },
  { match: exact('/api/srs-clients'),                             path: '/api/srs-clients' },
  { match: prefix('/api/apt-weather'),                            path: null },
  // A typed magnetic heading to true (crc-sync docs/adr/0085): the client
  // never converts a typed magnetic value itself.
  { match: prefix('/api/magnetic/to-true'),                       path: null },
  // EFSP CreateStrip pre-fill (crc-sync/src/efsp/flight-plan-lookup.js).
  { match: prefix('/api/flight-plan-lookup/'),                    path: null },
  { match: exact('/api/flight-plan-list'),                        path: null },
  // The stereo route table (crc-sync/src/efsp/stereo-routes.js).
  { match: exact('/api/stereo-routes'),                           path: null },
  // WP8's metrics and traffic count (crc-sync docs/adr/0065), for curl and scripts.
  { match: exactOrQuery('/api/efsp/metrics'),                     path: null },
  { match: exactOrQuery('/api/efsp/traffic-count'),               path: null },
  // The theater's DCS height grid and its status (crc-sync docs/adr/0133; public/js/terrain-grid.js).
  { match: exact('/api/terrain/grid'),             method: 'GET',  path: '/api/terrain/grid' },
  { match: exact('/api/terrain/status'),           method: 'GET',  path: '/api/terrain/status' },
];

// Returns the upstream path for a request, or null when it is not a proxy route.
function resolveProxyPath(url, method) {
  for (const r of PROXY_ROUTES) {
    if (r.method && r.method !== method) continue;
    if (r.match(url)) return r.path === null ? url : r.path;
  }
  return null;
}

module.exports = { PROXY_ROUTES, resolveProxyPath };
