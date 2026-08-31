'use strict';

// Casdoor OAuth helpers — ported verbatim from the convention used by
// sourcedcs-web/auth.js and atobrief/server.js (server-side code exchange,
// client_secret never reaches the browser; "verification" is an unsigned
// JWT payload decode, matching the existing repo-wide convention).
//
// This duplication is accepted, not accidental: each service's Docker build
// context is scoped to just its own directory (see
// .github/workflows/*-docker.yml), so a shared module isn't a drop-in
// without also restructuring those build contexts. If you fix a bug in
// casdoorTokenExchange/decodeJWT here, check the other two copies too.
//
// Adds one thing neither of those services needed: single-use, short-TTL WS
// connect tickets (mintTicket/consumeTicket), so the long-lived bearer JWT
// never has to ride in a WebSocket URL (query strings end up in proxy/access
// logs). This mirrors the old asacs_link `pendingTokens` pattern almost
// exactly — asacs_link solved this same problem with the same shape.

const crypto = require('crypto');

const CASDOOR_ENDPOINT      = process.env.CASDOOR_ENDPOINT || '';
const CASDOOR_CLIENT_ID     = process.env.CRCSYNC_CLIENT_ID || '';
const CASDOOR_CLIENT_SECRET = process.env.CRCSYNC_CLIENT_SECRET || '';

const TICKET_TTL_MS = 30000;

function casdoorTokenExchange(code, redirectUri) {
  return new Promise((resolve, reject) => {
    if (!CASDOOR_ENDPOINT || !CASDOOR_CLIENT_ID || !CASDOOR_CLIENT_SECRET) {
      return reject(new Error('Casdoor is not configured (missing env vars)'));
    }
    const payload = JSON.stringify({
      grant_type:    'authorization_code',
      client_id:     CASDOOR_CLIENT_ID,
      client_secret: CASDOOR_CLIENT_SECRET,
      code,
      redirect_uri:  redirectUri,
    });
    let parsed;
    try { parsed = new URL(CASDOOR_ENDPOINT); } catch {
      return reject(new Error('CASDOOR_ENDPOINT is not a valid URL'));
    }
    const isHttps = parsed.protocol === 'https:';
    const mod     = isHttps ? require('https') : require('http');
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     '/api/login/oauth/access_token',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = mod.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Casdoor returned invalid JSON (HTTP ' + res.statusCode + '): ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch { return null; }
}

function requireAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const payload = decodeJWT(token);
  if (!payload) return res.status(401).json({ error: 'Invalid token' });
  req.user = payload;
  next();
}

// ── WS connect tickets ──────────────────────────────────────────────────────
// Single-use, 30s TTL. Minted from a valid bearer token, consumed once at
// the /feed WS handshake instead of the raw JWT ever appearing in a URL.

const pendingTickets = new Map(); // ticket -> { user, expiresAt }

function mintTicket(user) {
  const ticket = crypto.randomUUID();
  pendingTickets.set(ticket, { user, expiresAt: Date.now() + TICKET_TTL_MS });
  return ticket;
}

function consumeTicket(ticket) {
  const entry = pendingTickets.get(ticket);
  if (!entry) return null;
  pendingTickets.delete(ticket);
  if (Date.now() > entry.expiresAt) return null;
  return entry.user;
}

setInterval(() => {
  const now = Date.now();
  for (const [ticket, entry] of pendingTickets) {
    if (now > entry.expiresAt) pendingTickets.delete(ticket);
  }
}, 60000).unref();

module.exports = {
  casdoorTokenExchange,
  decodeJWT,
  requireAuth,
  mintTicket,
  consumeTicket,
  CASDOOR_ENDPOINT,
  CASDOOR_CLIENT_ID,
};
