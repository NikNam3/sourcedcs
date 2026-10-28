// ═══════════════════════════════════════════════════════════
// usmtf-api.js — HTTP access to the USMTF ATO export (ADR 0078)
//
//   GET  /api/rooms/:id/ato.usmtf   the briefing room's current package
//   POST /api/usmtf                 stateless: YAML in, USMTF out
//
// Both answer text/plain USMTF (or JSON {text, warnings} with ?report=1)
// and share the same auth, limiter and error shapes. The exporter itself is
// public/js/usmtf-ato.js, the same file the browser uses.
// ═══════════════════════════════════════════════════════════

'use strict';

const crypto    = require('crypto');
const express   = require('express');
const rateLimit = require('express-rate-limit');
const yaml      = require('js-yaml');
const UsmtfAto  = require('./public/js/usmtf-ato.js');

const MAX_ROOM_ID_LEN = 128;

// Copied from sourcedcs-web/releases.js checkReleaseUploadToken (each
// service's Docker build context is its own directory, so copy, don't
// import). Constant-time; never throws; an unset/empty expected token never
// matches anything, including an empty bearer.
function checkServiceToken(providedToken, expectedToken) {
  if (!expectedToken) return false;
  const expected = Buffer.from(expectedToken);
  const actual   = Buffer.from(providedToken || '');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

// Unsigned JWT payload decode, as crc-sync/src/auth.js decodeJWT does.
function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch { return null; }
}

// Accepts `Authorization: Bearer <x>` when
//   1. x equals the service token (ATOBRIEF_USMTF_TOKEN) — the machine path
//      crc-sync uses (it has no interactive Casdoor session), or
//   2. x decodes as a JWT with a non-empty `roles` array and an unexpired
//      `exp` — the same bar as atobrief's own page gate (index.html).
// ⚠ Path 2 is an UNSIGNED decode and therefore forgeable. It adds protection
// and removes none: presentees already receive the whole package YAML over
// the socket with no authentication at all (server.js `join`).
function requireUsmtfReader(serviceToken, now = () => Date.now()) {
  return function (req, res, next) {
    const auth  = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token && checkServiceToken(token, serviceToken)) return next();
    const p = token ? decodeJWT(token) : null;
    const rolesOk = p && Array.isArray(p.roles) && p.roles.length > 0;
    const expOk = p && typeof p.exp === 'number' && p.exp * 1000 > now();
    if (rolesOk && expOk) { req.user = p; return next(); }
    return res.status(401).json({ error: 'Authentication required' });
  };
}

function sendExport(req, res, yamlText, lastModified) {
  let pkg;
  try {
    pkg = yaml.load(yamlText);
  } catch (e) {
    return res.status(422).json({ error: 'YAML parse error', detail: String(e.message).slice(0, 500) });
  }
  const r = UsmtfAto.buildUsmtf(pkg);
  if (r.errors.length) return res.status(422).json({ errors: r.errors, warnings: r.warnings });

  const etag = '"' + crypto.createHash('sha1').update(r.text).digest('hex') + '"';
  res.set('Cache-Control', 'no-store');
  res.set('ETag', etag);
  res.set('X-Usmtf-Warnings', String(r.warnings.length));
  if (lastModified) res.set('Last-Modified', new Date(lastModified).toUTCString());
  if (req.headers['if-none-match'] === etag) return res.status(304).end();

  if (req.query.report === '1') return res.json({ text: r.text, warnings: r.warnings });
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', 'inline; filename="' + UsmtfAto.usmtfFileName(pkg) + '"');
  return res.send(r.text);
}

function mountUsmtfRoutes(app, { sessions, serviceToken, now } = {}) {
  const reader = requireUsmtfReader(serviceToken || '', now);
  const limiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

  app.get('/api/rooms/:id/ato.usmtf', reader, limiter, (req, res) => {
    const id = req.params.id;
    if (!id || id.length > MAX_ROOM_ID_LEN) return res.status(400).json({ error: 'Invalid room id' });
    const session = sessions && sessions.get(id);
    if (!session) return res.status(404).json({ error: 'No such room' });
    if (session.packageYaml == null) return res.status(404).json({ error: 'Room has no package' });
    return sendExport(req, res, session.packageYaml, session.packageUpdatedAt);
  });

  const textBody = express.text({
    type: ['text/yaml', 'application/yaml', 'application/x-yaml', 'text/plain'],
    limit: '1mb',
  });
  app.post('/api/usmtf', reader, limiter, textBody, (req, res) => {
    if (typeof req.body !== 'string' || !req.body.trim()) {
      return res.status(400).json({ error: 'Send the package YAML as text/yaml' });
    }
    return sendExport(req, res, req.body, null);
  });
}

module.exports = { mountUsmtfRoutes, requireUsmtfReader, checkServiceToken, decodeJWT };
