'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const voiceGateway = require('./discord-gateway');
const activityDailyJob = require('./activity-daily-job');
const { parseReleaseManifest } = require('./releases.js');
const store = require('./store');
const auth = require('./auth');
const discordClient = require('./discord-client');
const rateLimiters = require('./rate-limiters');

const app = express();
const PORT = process.env.PORT || 3000;

/* ─── Discord bot config (see discord-client.js) ─────────── */
const DISCORD_BOT_TOKEN = discordClient.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = discordClient.DISCORD_GUILD_ID;
const APPLY_CHANNEL_ID = discordClient.APPLY_CHANNEL_ID;
const GRADING_CHANNEL_ID = discordClient.GRADING_CHANNEL_ID;

/* Live voice-call activity tracking (Wing Admin heatmap/graph) — connects to
   the Discord Gateway when bot credentials are configured; otherwise the
   store still loads (serving whatever history already exists) but no live
   connection is opened. See discord-gateway.js. */
voiceGateway.init({ dataDir: store.DATA_DIR, token: DISCORD_BOT_TOKEN, guildId: DISCORD_GUILD_ID });

/* Flush any in-progress voice calls before the process exits — without this,
   every routine deploy (SIGTERM) would silently drop up to one checkpoint
   interval of in-progress call time, not just crashes. */
function gracefulShutdown() {
  try { voiceGateway.flushAndSave(); }
  catch (err) { console.error('[shutdown] voice-activity flush failed:', err.message); }
  process.exit(0);
}
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

/* Per-member activity score (see ACTIVITY_SCORE.md) — recomputed once per
   squadron-wide day from voice-activity.json, cached in memory for the API
   routes below. */
activityDailyJob.init({
  dataDir: store.DATA_DIR,
  memberIds: () => Object.keys(store.state.members),
  getMemberDays: (id) => voiceGateway.getMemberDays(id),
  getMemberVacations: (id) => store.state.members[id] && store.state.members[id].vacations,
  localDateKey: voiceGateway.localDateKey,
});

/* One-shot migration: fold the legacy sub-keyed squadron overrides (from the
   old skills-admin per-pilot override UI) into the new Discord-id-keyed
   members store. Only runs if members.json hasn't been populated yet, so it
   never re-runs once the new store exists. */
if (Object.keys(store.state.members).length === 0) {
  const legacyOverrides = store.loadJSON(store.PILOT_SQ_OVERRIDES_FILE, {});
  if (legacyOverrides && Object.keys(legacyOverrides).length) {
    (async () => {
      try {
        await discordClient.refreshMembers();
        store.state.membersCacheAt = Date.now();
        let migrated = 0;
        for (const [sub, sqId] of Object.entries(legacyOverrides)) {
          const pilot = store.state.pilotRegistry[sub];
          const entry = pilot ? discordClient.findRosterEntry(pilot) : null;
          if (entry && !entry.squadronOverride) { entry.squadronOverride = String(sqId); migrated++; }
        }
        if (migrated) {
          store.saveJSON(store.MEMBERS_FILE, store.state.members);
          console.log('[members] Migrated ' + migrated + ' legacy squadron override(s) from pilot-squadron-overrides.json');
        }
      } catch (err) {
        console.error('[members] Startup migration failed:', err.message);
      }
    })();
  }
}

/* ─── Rate limiting ─────────────────────────────────────── */
app.use(rateLimiters.limiter);

/* ─── Body parsing ──────────────────────────────────────── */
/* 2mb (not the previous 50kb) so a large, deeply-nested skill tree — many
   modules, each with descriptions and grading items — can round-trip
   through PUT /api/skill-tree without hitting "request entity too large".
   Every individual text field is still separately length-capped via
   sanitizeStr() server-side, so this only widens how much *structure* one
   request can carry, not how much abuse any single field can contain. */
app.use(express.json({ limit: '2mb' }));

/* ─── Dynamic config for client ─────────────────────────── */
/* Serves Casdoor connection settings as a JS file so the client reads
   them from environment variables rather than hardcoded values. */
app.get('/js/config.js', (_req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(
    'var CASDOOR_CLIENT_ID   = ' + JSON.stringify(auth.CASDOOR_CLIENT_ID) + ';\n' +
    'var CASDOOR_ENDPOINT    = ' + JSON.stringify(auth.CASDOOR_ENDPOINT) + ';\n' +
    'var DISCORD_URL         = ' + JSON.stringify(store.DISCORD_URL) + ';\n' +
    'var WIKI_URL            = ' + JSON.stringify(store.WIKI_URL) + ';\n' +
    'var ATO_URL             = ' + JSON.stringify(store.ATO_URL) + ';\n' +
    'var OLYMPUS_URL         = ' + JSON.stringify(store.OLYMPUS_URL) + ';\n' +
    'var ASACS_URL           = ' + JSON.stringify(store.ASACS_URL) + ';\n' +
    'var GITHUB_URL          = ' + JSON.stringify(store.GITHUB_URL) + ';\n' +
    'var SKILL_ADMIN_ROLES   = ' + JSON.stringify(auth.SKILL_ADMIN_ROLES) + ';\n'
  );
});

/* ─── Static files ──────────────────────────────────────── */
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC, {
  index: 'index.html',
  maxAge: '1h',
  etag: true,
  dotfiles: 'ignore',
}));

/* Serve admin-uploaded gallery images from the data volume */
app.use('/gallery-uploads', express.static(store.UPLOADS_DIR, {
  maxAge: '7d',
  etag: true,
  dotfiles: 'ignore',
}));

/* Serve crc-desktop installers + electron-updater manifests (latest.yml,
   latest-linux.yml) — the exact path electron-updater's generic provider
   polls, matching crc-desktop's package.json build.publish.url. Short
   maxAge since latest.yml changes on every release and stale caching would
   make electron-updater miss a new version. */
app.use('/downloads', express.static(store.RELEASES_DIR, {
  maxAge: '5m',
  etag: true,
  dotfiles: 'ignore',
}));

function readReleaseManifest(filename) {
  let raw;
  try { raw = fs.readFileSync(path.join(store.RELEASES_DIR, filename), 'utf8'); }
  catch { return null; }
  return parseReleaseManifest(raw);
}

/* ─── API router ────────────────────────────────────────── */
const api = express.Router();

/* Health check */
api.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

/* ── crc-desktop releases ─────────────────────────────────
   /api/releases/upload is called by the crc-desktop-release GitHub Actions
   workflow (see .github/workflows/crc-desktop-release.yml), one file per
   request (installer, then its latest*.yml). /api/releases/latest backs the
   public download page. */
api.post('/releases/upload', rateLimiters.writeOpsLimiter, auth.requireReleaseUpload, store.uploadRelease.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ ok: true, filename: req.file.filename, size: req.file.size });
});

api.get('/releases/latest', (_req, res) => {
  res.json({
    win: readReleaseManifest('latest.yml'),
    linux: readReleaseManifest('latest-linux.yml'),
  });
});

/* ── Auth: exchange authorization code for access token ── */
const MAX_AUTH_CODE_LEN = 512;
const MAX_REDIRECT_URI_LEN = 512;
api.post('/auth/token', rateLimiters.authLimiter, async (req, res) => {
  const { code, redirectUri } = req.body;
  if (!code || typeof code !== 'string' || code.length > MAX_AUTH_CODE_LEN) {
    return res.status(400).json({ error: 'Missing or invalid code' });
  }
  if (!redirectUri || typeof redirectUri !== 'string' || redirectUri.length > MAX_REDIRECT_URI_LEN) {
    return res.status(400).json({ error: 'Missing or invalid redirectUri' });
  }
  try {
    const tokenData = await auth.casdoorTokenExchange(code, redirectUri);
    if (tokenData.error) {
      console.warn('[auth] Casdoor token exchange error:', tokenData.error, tokenData.error_description);
      return res.status(400).json({ error: tokenData.error_description || tokenData.error });
    }
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      console.warn('[auth] Casdoor response missing access_token:', JSON.stringify(tokenData).slice(0, 200));
      return res.status(502).json({ error: 'No access token returned by auth server' });
    }
    auth.registerPilot(auth.decodeJWT(accessToken));
    res.json({ access_token: accessToken });
  } catch (err) {
    console.error('[auth] Token exchange failed:', err.message);
    res.status(502).json({ error: 'Auth server unreachable or returned an error' });
  }
});

api.use(require('./routes/events'));
api.use(require('./routes/applications'));
api.use(require('./routes/roster'));
api.use(require('./routes/gallery'));
api.use(require('./routes/squadrons'));
api.use(require('./routes/skill-tree'));
api.use(require('./routes/grading-requests'));
api.use(require('./routes/members'));
api.use(require('./routes/flight-plans'));
api.use(require('./routes/fpl1801'));
api.use(require('./routes/bookings'));

app.use('/api', api);

/* ─── JSON error handler ─────────────────────────────── */
/* Catches errors passed via next(err) (e.g. from multer, body-parser,
   or any route handler) and returns a JSON response so the client
   can always call .json() on the response without a parse failure. */
// eslint-disable-next-line no-unused-vars
app.use(function jsonErrorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  console.error('[error]', status, message);
  res.status(status).json({ error: message });
});

/* ─── SPA fallback ──────────────────────────────────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

/* ─── Start ─────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`[sourcedcs-web] listening on http://0.0.0.0:${PORT}`);
  console.log('[sourcedcs-web] Config:');
  console.log('  DISCORD_BOT_TOKEN  :', DISCORD_BOT_TOKEN ? '*** (set)' : 'NOT SET');
  console.log('  DISCORD_GUILD_ID   :', DISCORD_GUILD_ID || 'NOT SET');
  console.log('  APPLY_CHANNEL_ID   :', APPLY_CHANNEL_ID || 'NOT SET (applications will be stored in JSON)');
  console.log('  GRADING_CHANNEL_ID :', GRADING_CHANNEL_ID || 'NOT SET (grading requests will not post to Discord)');
});
