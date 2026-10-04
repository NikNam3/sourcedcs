'use strict';

/* Shared-secret bearer gate for server-to-server routes (release CI, flight-plan
   service, airspace service). A HAND COPY lives at crc-sync/src/service-token.js;
   infra/tests/service-token-parity.test.js keeps the two files and the shared
   test table (tests/fixtures/service-token-table.json) byte-identical.

   Status policy: no token configured -> 503 "not configured" (an operator
   problem, never mistaken for a bad caller); missing or wrong -> 401.
   The expected token is read per request (getToken), never at require time.
   Both sides are hashed first, so the comparison is constant-time and
   length-blind. */

const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

function tokenMatches(given, expected) {
  return crypto.timingSafeEqual(sha(given), sha(expected));
}

/**
 * @param {string} name human name of the token, used in the error bodies ("release upload token")
 * @param {() => string|undefined} getToken the expected token, read on every request
 */
function requireServiceToken(name, getToken) {
  return (req, res, next) => {
    const expected = getToken();
    if (!expected) return res.status(503).json({ error: `${name} not configured` });
    const h = (req.headers && req.headers.authorization) || '';
    const given = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!given || !tokenMatches(given, expected)) return res.status(401).json({ error: `Invalid or missing ${name}` });
    next();
  };
}

module.exports = { requireServiceToken, tokenMatches };
