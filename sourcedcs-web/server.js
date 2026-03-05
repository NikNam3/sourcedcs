'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');
const https     = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ─── Data persistence ──────────────────────────────────── */
const DATA_DIR       = path.join(__dirname, 'data');
const EVENTS_FILE    = path.join(DATA_DIR, 'events.json');
const APPS_FILE      = path.join(DATA_DIR, 'applications.json');
const SQUADRONS_FILE = path.join(DATA_DIR, 'squadrons.json');
const ROLES_FILE     = path.join(DATA_DIR, 'discord-roles.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function sanitizeStr(value, maxLen) {
  return String(value || '').trim().slice(0, maxLen);
}



let events = loadJSON(EVENTS_FILE, []);
let applications = loadJSON(APPS_FILE, []);
let nextEventId = events.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;



let squadrons = loadJSON(SQUADRONS_FILE, []);

/* ─── Discord roster ─────────────────────────────────────── */
const DISCORD_BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN  || '';
const DISCORD_GUILD_ID   = process.env.DISCORD_GUILD_ID   || '';
const ROSTER_CACHE_TTL   = 5 * 60 * 1000; // 5 minutes

let discordRoleMap  = loadJSON(ROLES_FILE, {});
let rosterCache     = null;
let rosterCacheAt   = 0;

/* Parse username format "(foo) bar "CALLSIGN"" → callsign or fallback to bar */
function parseCallsign(displayName) {
  if (!displayName) return '';
  const csMatch = displayName.match(/"([^"]*)"/);
  if (csMatch && csMatch[1].trim()) return csMatch[1].trim();
  // Fall back: strip leading (foo) group, take the text before any quote
  const afterParen = displayName.replace(/^\([^)]*\)\s*/, '');
  return afterParen.replace(/\s*".*"/, '').trim() || displayName.trim();
}

function discordGet(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'discord.com',
      path:     '/api/v10' + apiPath,
      headers:  {
        'Authorization': 'Bot ' + DISCORD_BOT_TOKEN,
        'User-Agent':    'SourceDCS-Website (https://sourcedcs.page, 1.0)',
      },
    };
    https.get(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end',  () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchDiscordRoster() {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
    console.warn('[roster] DISCORD_BOT_TOKEN or DISCORD_GUILD_ID not set — returning empty roster');
    return [];
  }

  // Build role id → name map
  const rolesRes = await discordGet(`/guilds/${DISCORD_GUILD_ID}/roles`);
  if (!Array.isArray(rolesRes.body)) {
    console.error('[roster] Failed to fetch guild roles, status:', rolesRes.status);
    return [];
  }
  const roleIdToName = {};
  rolesRes.body.forEach(r => { roleIdToName[r.id] = r.name; });

  // Fetch all members (paginated, Discord max 1000 per page)
  let members = [];
  let after   = '0';
  for (;;) {
    const res = await discordGet(`/guilds/${DISCORD_GUILD_ID}/members?limit=1000&after=${after}`);
    if (!Array.isArray(res.body) || res.body.length === 0) break;
    members = members.concat(res.body);
    if (res.body.length < 1000) break;
    const lastUser = res.body[res.body.length - 1].user;
    if (!lastUser?.id) break;
    after = lastUser.id;
  }

  const result = [];
  for (const member of members) {
    if (member.user?.bot) continue;

    // Find first matching known role
    let squadron = null, role = null;
    for (const roleId of (member.roles || [])) {
      const roleName = roleIdToName[roleId];
      if (roleName && discordRoleMap[roleName]) {
        squadron = discordRoleMap[roleName].squadron;
        role     = discordRoleMap[roleName].role;
        break;
      }
    }
    if (!squadron) continue; // skip members without a known squadron role

    // Display name priority: server nickname > global display name > username
    const displayName = member.nick || member.user?.global_name || member.user?.username || '';
    const callsign    = parseCallsign(displayName);

    result.push({ callsign, squadron, role });
  }

  result.sort((a, b) =>
    a.squadron.localeCompare(b.squadron) || a.callsign.localeCompare(b.callsign)
  );
  return result;
}

async function getCachedRoster() {
  const now = Date.now();
  if (rosterCache && (now - rosterCacheAt) < ROSTER_CACHE_TTL) return rosterCache;
  try {
    rosterCache  = await fetchDiscordRoster();
    rosterCacheAt = now;
  } catch (err) {
    console.error('[roster] Discord fetch failed:', err.message);
    if (!rosterCache) rosterCache = [];
  }
  return rosterCache;
}

/* ─── Rate limiting ─────────────────────────────────────── */
const limiter = rateLimit({
  windowMs:        60 * 1000,
  max:             300,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
});
app.use(limiter);

const writeOpsLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             40,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
});

const applyLimiter = rateLimit({
  windowMs:        10 * 60 * 1000, // 10 min window
  max:             3,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Too many applications — please wait before trying again.' }
});

/* ─── Body parsing ──────────────────────────────────────── */
app.use(express.json({ limit: '50kb' }));

/* ─── Casdoor config (read from env) ────────────────────── */
const CASDOOR_CLIENT_ID = process.env.CASDOOR_CLIENT_ID;
const CASDOOR_ENDPOINT  = process.env.CASDOOR_ENDPOINT;

/* ─── External link config (read from env) ──────────────── */
const DISCORD_URL = process.env.DISCORD_URL  || 'https://discord.gg/sourcedcs';
const WIKI_URL    = process.env.WIKI_URL     || 'https://wiki.sourcedcs.page';
const ATO_URL     = process.env.ATO_URL      || 'https://ato.sourcedcs.page';
const OLYMPUS_URL = process.env.OLYMPUS_URL  || 'https://olympus.sourcedcs.page';
const ASACS_URL   = process.env.ASACS_URL    || 'https://asacs.sourcedcs.page';
const GITHUB_URL  = process.env.GITHUB_URL   || 'https://github.com/NikNam3/sourcedcs';

/* ─── Auth helpers ──────────────────────────────────────── */
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

function requireAdmin(req, res, next) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const isAdmin = roles.some(r =>
    (typeof r === 'string' ? r : (r?.name || '')) === 'admin'
  );
  if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

/* ─── Dynamic config for client ─────────────────────────── */
/* Serves Casdoor connection settings as a JS file so the client reads
   them from environment variables rather than hardcoded values. */
app.get('/js/config.js', (_req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(
    'var CASDOOR_CLIENT_ID = ' + JSON.stringify(CASDOOR_CLIENT_ID) + ';\n' +
    'var CASDOOR_ENDPOINT  = ' + JSON.stringify(CASDOOR_ENDPOINT)  + ';\n' +
    'var DISCORD_URL = '       + JSON.stringify(DISCORD_URL)        + ';\n' +
    'var WIKI_URL    = '       + JSON.stringify(WIKI_URL)           + ';\n' +
    'var ATO_URL     = '       + JSON.stringify(ATO_URL)            + ';\n' +
    'var OLYMPUS_URL = '       + JSON.stringify(OLYMPUS_URL)        + ';\n' +
    'var ASACS_URL   = '       + JSON.stringify(ASACS_URL)          + ';\n' +
    'var GITHUB_URL  = '       + JSON.stringify(GITHUB_URL)         + ';\n'
  );
});

/* ─── Static files ──────────────────────────────────────── */
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC, {
  index:    'index.html',
  maxAge:   '1h',
  etag:     true,
  dotfiles: 'ignore',
}));

/* ─── API router ────────────────────────────────────────── */
const api = express.Router();

/* Health check */
api.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

/* ── Events (public read, admin write) ── */
api.get('/events', (_req, res) => {
  res.json(events);
});

api.post('/events', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const { name, type, status, date, map, airframes, description, slots } = req.body;
  if (!name || !type || !date) {
    return res.status(400).json({ error: 'name, type and date are required' });
  }
  const ev = {
    id:          nextEventId++,
    name:        String(name).trim(),
    type,
    status:      status || 'planned',
    date,
    map:         map || '',
    airframes:   Array.isArray(airframes) ? airframes : [String(airframes || 'Any')],
    description: String(description || '').trim(),
    slots:       Number(slots) || 0,
    filledSlots: 0,
  };
  events.push(ev);
  saveJSON(EVENTS_FILE, events);
  res.status(201).json(ev);
});

api.put('/events/:id', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const id  = Number(req.params.id);
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Event not found' });
  events[idx] = { ...events[idx], ...req.body, id };
  saveJSON(EVENTS_FILE, events);
  res.json(events[idx]);
});

api.delete('/events/:id', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const id  = Number(req.params.id);
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Event not found' });
  events.splice(idx, 1);
  saveJSON(EVENTS_FILE, events);
  res.json({ ok: true });
});

/* ── Applications ── */
api.post('/apply', applyLimiter, (req, res) => {
  const { callsign, discordHandle, age, timezone, subSquadron, experience, modules } = req.body;
  if (!callsign || !discordHandle || !age || !timezone || !subSquadron) {
    return res.status(400).json({ error: 'Required fields are missing' });
  }
  if (typeof callsign !== 'string' || callsign.length > 32 || callsign.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid callsign' });
  }
  if (typeof discordHandle !== 'string' || discordHandle.length > 64) {
    return res.status(400).json({ error: 'Invalid Discord handle' });
  }

  const application = {
    id:            Date.now(),
    callsign:      callsign.trim(),
    discordHandle: discordHandle.trim(),
    age,
    timezone:      String(timezone).trim(),
    subSquadron,
    experience:    experience || '',
    modules:       typeof modules === 'string' ? modules.slice(0, 500) : '',
    submittedAt:   new Date().toISOString(),
    status:        'pending',
  };

  applications.push(application);
  saveJSON(APPS_FILE, applications);
  res.status(201).json({
    ok:      true,
    message: 'Application received! Join our Discord to get started:',
    discord: DISCORD_URL
  });
});

/* Admin: list applications */
api.get('/applications', requireAuth, requireAdmin, (_req, res) => {
  res.json(applications);
});

/* ── Roster (public read, admin cache-bust) ── */
api.get('/roster', (_req, res) => {
  getCachedRoster().then(list => res.json(list)).catch(() => res.json([]));
});

api.post('/roster/refresh', writeOpsLimiter, requireAuth, requireAdmin, (_req, res) => {
  rosterCache  = null;
  rosterCacheAt = 0;
  getCachedRoster()
    .then(list => res.json({ ok: true, count: list.length }))
    .catch(err  => res.status(502).json({ error: 'Discord fetch failed: ' + err.message }));
});

/* ── Squadrons (public read, admin write) ── */
api.get('/squadrons', (_req, res) => {
  res.json(squadrons);
});

api.get('/squadrons/:id', (req, res) => {
  const sq = squadrons.find(s => s.id === req.params.id);
  if (!sq) return res.status(404).json({ error: 'Squadron not found' });
  res.json(sq);
});

api.put('/squadrons/:id', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const idx = squadrons.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Squadron not found' });
  const allowed = ['designator', 'name', 'airframe', 'tags', 'shortDesc', 'fullDesc', 'image'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) squadrons[idx][key] = req.body[key];
  }
  saveJSON(SQUADRONS_FILE, squadrons);
  res.json(squadrons[idx]);
});

api.post('/squadrons', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const { id, designator, name, airframe, tags, shortDesc, fullDesc, image } = req.body;
  if (!id || !designator || !name) return res.status(400).json({ error: 'id, designator and name are required' });
  if (squadrons.find(s => s.id === id)) return res.status(409).json({ error: 'Squadron ID already exists' });
  const sq = {
    id:         sanitizeStr(id, 16),
    designator: sanitizeStr(designator, 16),
    name:       sanitizeStr(name, 32),
    airframe:   sanitizeStr(airframe, 64),
    tags:       Array.isArray(tags) ? tags.map(t => sanitizeStr(t, 16)) : [],
    shortDesc:  sanitizeStr(shortDesc, 500),
    fullDesc:   sanitizeStr(fullDesc, 2000),
    image:      sanitizeStr(image, 256),
  };
  squadrons.push(sq);
  saveJSON(SQUADRONS_FILE, squadrons);
  res.status(201).json(sq);
});

api.delete('/squadrons/:id', writeOpsLimiter, requireAuth, requireAdmin, (req, res) => {
  const idx = squadrons.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Squadron not found' });
  squadrons.splice(idx, 1);
  saveJSON(SQUADRONS_FILE, squadrons);
  res.json({ ok: true });
});

app.use('/api', api);

/* ─── SPA fallback ──────────────────────────────────────── */
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

/* ─── Start ─────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`[sourcedcs-web] listening on http://0.0.0.0:${PORT}`);
});
