'use strict';
const crypto = require('crypto');
const express = require('express');
const auth = require('../auth');
const crcsync = require('../crcsync-client');
const { writeOpsLimiter } = require('../rate-limiters');

/* Airspace registry proxy (docs/adr/0098 section 9). crc-sync owns every
   definition; this router only checks the user's role and forwards. The web
   stores nothing. */
const router = express.Router();

const UNREACHABLE = 'crc-sync unreachable';
const MAX_THEATER_LEN = 64;
const MAX_ID_LEN = 64;

function validTheater(t) { return typeof t === 'string' && t.length > 0 && t.length <= MAX_THEATER_LEN; }

router.get('/airspaces/theaters', auth.requireAuth, async (_req, res) => {
  const r = await crcsync.getClient().listTheaters();
  if (!r.ok) return res.status(503).json({ error: UNREACHABLE, reason: r.reason });
  res.json({ theaters: r.theaters });
});

router.get('/airspaces', auth.requireAuth, async (req, res) => {
  const theater = req.query.theater;
  if (!validTheater(theater)) return res.status(400).json({ error: 'theater is required' });
  const r = await crcsync.getClient().listAirspaces(theater);
  if (!r.ok) return res.status(503).json({ error: UNREACHABLE, reason: r.reason });
  res.json({ theater: r.theater, airspaces: r.airspaces });
});

/* The actor comes from the token, never from the body (a body "actor" is ignored). */
router.post('/airspaces/mutation', writeOpsLimiter, auth.requireAuth, auth.requireBookingAdmin, async (req, res) => {
  const b = req.body || {};
  if (!validTheater(b.theater)) return res.status(400).json({ error: 'theater is required' });
  if (!b.op || typeof b.op !== 'object' || typeof b.op.kind !== 'string') return res.status(400).json({ error: 'op.kind is required' });
  if (b.airspaceId != null && (typeof b.airspaceId !== 'string' || b.airspaceId.length > MAX_ID_LEN)) return res.status(400).json({ error: 'airspaceId must be a string' });
  const clientMutationId = typeof b.clientMutationId === 'string' && b.clientMutationId && b.clientMutationId.length <= 80
    ? b.clientMutationId : 'web-' + crypto.randomUUID();
  const actor = { sub: req.user.sub, name: req.user.name || req.user.preferred_username || req.user.sub };
  const r = await crcsync.getClient().mutateAirspace(b.theater, { clientMutationId, airspaceId: b.airspaceId, op: b.op }, actor);
  if (!r.ok) return res.status(503).json({ error: UNREACHABLE, reason: r.reason });
  /* The ack as it came; an upstream status outside 200..499 is not ours to relay. */
  const status = r.status >= 200 && r.status < 500 ? r.status : 502;
  res.status(status).json(r.ack);
});

module.exports = router;
