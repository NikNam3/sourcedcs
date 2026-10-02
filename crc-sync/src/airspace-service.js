'use strict';

// The server-to-server API of the airspace registry, for sourcedcs-web only (docs/adr/0098 §9):
//   GET  /api/airspace-registry/theaters        -> [{theater, count}]
//   GET  /api/airspace-registry?theater=T       -> {theater, airspaces: [{definition, defRev, state, window, pendingRequest, ...}]}
//   POST /api/airspace-registry/mutation        -> the efsp-airspace-ack body (HTTP 200 on success, 409/404/400/422 on a refusal)
// Behind the shared bearer AIRSPACE_SERVICE_TOKEN, compared in constant time. With none configured every route is 503
// and nothing is open. The web has already checked the user's role; the actor is `body.actor {sub, name}`, and the op
// runs as the SQUADRON_ADMIN service principal through the same skeleton pass a panel Mutation takes
// (`efsp.applyAsService`), so persistence, replay and the broadcast to connected panels happen once, there.
// nginx never exposes this path (infra's crc-sync vhost denies /api/airspace-registry).

const crypto = require('crypto');
const express = require('express');
const log = require('./log').logger('airspace-service');

const MAX_THEATER_LEN = 64;
const MAX_ID_LEN = 64;
const MAX_MUTATION_ID_LEN = 80;
const MAX_ACTOR_LEN = 200;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
function tokenMatches(given, expected) {
  return crypto.timingSafeEqual(sha(given), sha(expected)); // hashed first: equal length, no length leak
}

const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isInt = (v) => Number.isInteger(v);

const STATUS_BY_REASON = Object.freeze({ STALE_REV: 409, NOT_FOUND: 404, VALIDATION_ERROR: 400 });
// Never 401/403 for a refusal: the web reads those as a bad service token.
const statusOf = (ack) => (ack && ack.ok ? 200 : STATUS_BY_REASON[ack && ack.reason] || 422);

/**
 * @param {{efsp:object, token?:string, broadcast?:(frames:object[])=>void}} deps
 *   `efsp` the EFSP composition (`airspaceStore`, `applyAsService`); `broadcast` hands a result's frames to the hub
 */
function createAirspaceService({ efsp, token = '', broadcast = () => {} }) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!token) return res.status(503).json({ error: 'airspace service not configured' });
    const h = req.headers.authorization || '';
    const given = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!given || !tokenMatches(given, token)) return res.status(401).json({ error: 'Invalid or missing airspace service token' });
    next();
  });

  router.get('/theaters', (_req, res) => {
    res.json(efsp.airspaceStore.listTheaters());
  });

  router.get('/', (req, res) => {
    const theater = req.query.theater;
    if (!isStr(theater, MAX_THEATER_LEN)) return res.status(400).json({ error: 'theater is required' });
    res.json({ theater, airspaces: efsp.airspaceStore.getAllFor(theater) });
  });

  router.post('/mutation', (req, res) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return res.status(400).json({ error: 'a JSON object body is required' });
    if (!isStr(b.theater, MAX_THEATER_LEN)) return res.status(400).json({ error: 'theater is required' });
    if (!isStr(b.clientMutationId, MAX_MUTATION_ID_LEN)) return res.status(400).json({ error: 'clientMutationId is required' });
    if (!b.op || typeof b.op !== 'object' || Array.isArray(b.op) || typeof b.op.kind !== 'string') return res.status(400).json({ error: 'op.kind is required' });
    if (b.airspaceId !== undefined && b.airspaceId !== null && !isStr(b.airspaceId, MAX_ID_LEN)) return res.status(400).json({ error: 'airspaceId must be a string' });
    for (const k of ['baseRev', 'baseDefRev']) {
      if (b[k] !== undefined && b[k] !== null && !isInt(b[k])) return res.status(400).json({ error: `${k} must be an integer` });
    }
    const a = b.actor;
    if (!a || !isStr(a.sub, MAX_ACTOR_LEN) || !isStr(a.name, MAX_ACTOR_LEN)) return res.status(400).json({ error: 'actor {sub, name} (strings) is required' });

    try {
      const msg = { clientMutationId: b.clientMutationId, theater: b.theater, op: b.op };
      for (const k of ['airspaceId', 'baseRev', 'baseDefRev']) if (b[k] !== undefined && b[k] !== null) msg[k] = b[k];
      const { ack, broadcasts } = efsp.applyAsService({ service: 'SQUADRON_ADMIN', sub: a.sub, name: a.name }, msg);
      if (broadcasts && broadcasts.length) broadcast(broadcasts);
      res.status(statusOf(ack)).json(ack);
    } catch (err) {
      log.error('mutation failed unexpectedly', { err });
      res.status(500).json({ error: 'internal error' });
    }
  });

  return router;
}

module.exports = { createAirspaceService, statusOf };
