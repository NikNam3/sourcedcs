'use strict';

/* Casdoor OAuth token exchange, JWT decoding, and the requireAuth/
   requireAdmin/... Express middleware — pulled out of server.js.

   NOTE: this is the server-side auth module, unrelated to the browser-side
   public/js/auth.js (Casdoor login redirect + client-side role checks). */

const https = require('https');
const http = require('http');
const path = require('path');
const store = require('./store');
const { checkReleaseUploadToken } = require('./releases.js');

/* ─── App config (config.json) ──────────────────────────── */
const appConfig = store.loadJSON(path.join(__dirname, 'config.json'), {});
const SKILL_ADMIN_ROLES = Array.isArray(appConfig.skillAdminRoles) ? appConfig.skillAdminRoles : ['admin'];
const BOOKING_ADMIN_ROLES = ['admin', 'squadronlead'];

/* ─── Casdoor config (read from env) ────────────────────── */
const CASDOOR_CLIENT_ID = process.env.CASDOOR_CLIENT_ID;
const CASDOOR_CLIENT_SECRET = process.env.CASDOOR_CLIENT_SECRET;
const CASDOOR_ENDPOINT = process.env.CASDOOR_ENDPOINT;

/* casdoorTokenExchange below is duplicated near-verbatim in
   atobrief/server.js and crc-sync/src/auth.js — each service's Docker build
   context is scoped to just its own directory (see
   .github/workflows/*-docker.yml), so a shared module isn't a drop-in
   without also restructuring those build contexts. Accepted duplication for
   now: if you fix a bug here, check whether it applies to the other two
   copies as well. */

/* ─── Release uploads (CI, not Casdoor) ─────────────────── */
/* crc-desktop's release CI has no interactive Casdoor session, so uploading
   installers/manifests is gated by a separate shared-secret bearer token
   instead of requireAuth/requireAdmin. */
const RELEASE_UPLOAD_TOKEN = process.env.RELEASE_UPLOAD_TOKEN || '';

/* Low-level "make the request, collect the body" helper shared by every
   hand-rolled REST caller in this codebase (Casdoor here, Discord in
   discord-client.js) — replaces 5 near-identical https.request wrappers
   that each duplicated this exact buffering boilerplate. Callers keep their
   own status-code interpretation and JSON-parsing/error-message logic. */
function rawRequest(options, payload) {
  return new Promise((resolve, reject) => {
    const mod = options.protocol === 'http:' ? http : https;
    const req = mod.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, raw }));
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/* ─── Casdoor token exchange helper ────────────────────── */
/* Exchanges an authorization code for an access token by calling Casdoor's
   token endpoint server-side. The client_secret never leaves the server. */
function casdoorTokenExchange(code, redirectUri) {
  return new Promise((resolve, reject) => {
    if (!CASDOOR_ENDPOINT || !CASDOOR_CLIENT_ID || !CASDOOR_CLIENT_SECRET) {
      return reject(new Error('Casdoor is not configured (missing env vars)'));
    }
    const payload = JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CASDOOR_CLIENT_ID,
      client_secret: CASDOOR_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    });
    let parsed;
    try { parsed = new URL(CASDOOR_ENDPOINT); } catch {
      return reject(new Error('CASDOOR_ENDPOINT is not a valid URL'));
    }
    const isHttps = parsed.protocol === 'https:';
    const options = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: '/api/login/oauth/access_token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    rawRequest(options, payload).then(({ statusCode, raw }) => {
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('Casdoor returned invalid JSON (HTTP ' + statusCode + '): ' + raw.slice(0, 200))); }
    }, reject);
  });
}

/* ─── Auth helpers ──────────────────────────────────────── */
function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch { return null; }
}

/* Records a Casdoor identity in the pilot registry the first time it's seen,
   so wing admins can manually link a roster member to it even before that
   pilot has touched any pilot-specific feature (skill grades, etc). No-ops
   for identities already on file. */
function registerPilot(user) {
  const sub = user && user.sub;
  if (!sub || store.state.pilotRegistry[sub]) return;
  const rawName = user.name || user.preferred_username || sub || '';
  const callsign = store.parseCallsign(rawName) || rawName;
  store.state.pilotRegistry[sub] = { sub, name: rawName, callsign, registered_at: new Date().toISOString() };
  store.saveJSON(store.PILOT_REGISTRY_FILE, store.state.pilotRegistry);
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const payload = decodeJWT(token);
  if (!payload) return res.status(401).json({ error: 'Invalid token' });
  req.user = payload;
  registerPilot(payload);
  next();
}

function requireAdmin(req, res, next) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const isAdmin = roles.some(r =>
    (typeof r === 'string' ? r : (r?.name || '')) === 'admin'
  );
  if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

function requireSkillAdmin(req, res, next) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const ok = roles.some(r => SKILL_ADMIN_ROLES.includes(typeof r === 'string' ? r : (r?.name || '')));
  if (!ok) return res.status(403).json({ error: 'Skill admin access required' });
  next();
}

function isBookingAdminUser(req) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  return roles.some(r => BOOKING_ADMIN_ROLES.includes(typeof r === 'string' ? r : (r?.name || '')));
}

function requireBookingAdmin(req, res, next) {
  if (!isBookingAdminUser(req)) return res.status(403).json({ error: 'Booking admin access required' });
  next();
}

function requireReleaseUpload(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!checkReleaseUploadToken(token, RELEASE_UPLOAD_TOKEN)) {
    return res.status(401).json({ error: 'Invalid or missing release upload token' });
  }
  next();
}

module.exports = {
  SKILL_ADMIN_ROLES, BOOKING_ADMIN_ROLES,
  CASDOOR_CLIENT_ID, CASDOOR_ENDPOINT,
  rawRequest, casdoorTokenExchange, decodeJWT, registerPilot,
  requireAuth, requireAdmin, requireSkillAdmin, isBookingAdminUser,
  requireBookingAdmin, requireReleaseUpload,
};
