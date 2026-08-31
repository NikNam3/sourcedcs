// ═══════════════════════════════════════════════════════════
// server.js — ATO BRIEF web server with session support
// ═══════════════════════════════════════════════════════════
//
// Usage:
//   npm start                         # starts on port 3000
//   PORT=8080 npm start               # custom port
//
// Roles:
//   Presenter  — loads packages, controls navigation for everyone
//   Presentee  — read-only view, synced with the presenter
//
// URL scheme:
//   http://localhost:3000/                                   → standalone (no sync)
//   http://localhost:3000/?session=<id>&role=presenter       → presenter
//   http://localhost:3000/?session=<id>                      → presentee (default)

'use strict';

const crypto     = require('crypto');
const express    = require('express');
const http       = require('http');
const path       = require('path');
const rateLimit  = require('express-rate-limit');
const { Server } = require('socket.io');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(pw, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ── Casdoor / auth config ────────────────────────────────────
const CASDOOR_CLIENT_ID     = process.env.ATOBRIEF_CLIENT_ID     || '';
const CASDOOR_CLIENT_SECRET = process.env.ATOBRIEF_CLIENT_SECRET || '';
const CASDOOR_ENDPOINT      = process.env.CASDOOR_ENDPOINT       || '';

// ── Rate limiters ────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many auth requests — please wait before trying again.' },
});

app.use(express.json({ limit: '50kb' }));

// ── Dynamic config endpoint (exposes Casdoor settings to client) ─
app.get('/js/config.js', (_req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(
    'var CASDOOR_CLIENT_ID = ' + JSON.stringify(CASDOOR_CLIENT_ID) + ';\n' +
    'var CASDOOR_ENDPOINT  = ' + JSON.stringify(CASDOOR_ENDPOINT)  + ';\n'
  );
});

// ── Casdoor token exchange (server-side; keeps client_secret private) ─
// Duplicated near-verbatim in sourcedcs-web/auth.js and crc-sync/src/auth.js
// — each service's Docker build context is scoped to just its own directory
// (see .github/workflows/*-docker.yml), so a shared module isn't a drop-in
// without also restructuring those build contexts. Accepted duplication for
// now: if you fix a bug here (env var handling, error messages, etc.),
// check whether it applies to the other two copies as well.
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
        catch { reject(new Error('Casdoor returned invalid JSON (HTTP ' + res.statusCode + ')')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Auth token exchange endpoint ──────────────────────────────
const MAX_AUTH_CODE_LEN    = 512;
const MAX_REDIRECT_URI_LEN = 512;
app.post('/api/auth/token', authLimiter, async (req, res) => {
  const { code, redirectUri } = req.body;
  if (!code || typeof code !== 'string' || code.length > MAX_AUTH_CODE_LEN) {
    return res.status(400).json({ error: 'Missing or invalid code' });
  }
  if (!redirectUri || typeof redirectUri !== 'string' || redirectUri.length > MAX_REDIRECT_URI_LEN) {
    return res.status(400).json({ error: 'Missing or invalid redirectUri' });
  }
  try {
    const tokenData = await casdoorTokenExchange(code, redirectUri);
    if (tokenData.error) {
      console.warn('[auth] Casdoor token exchange error:', tokenData.error, tokenData.error_description);
      return res.status(400).json({ error: tokenData.error_description || tokenData.error });
    }
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      console.warn('[auth] Casdoor response missing access_token:', JSON.stringify(tokenData).slice(0, 200));
      return res.status(502).json({ error: 'No access token returned by auth server' });
    }
    res.json({ access_token: accessToken });
  } catch (err) {
    console.error('[auth] Token exchange failed:', err.message);
    res.status(502).json({ error: 'Auth server unreachable or returned an error' });
  }
});

// ── Serve static front-end assets ────────────────────────────
// Only expose the directories the browser actually needs.
const PUBLIC = path.join(__dirname, 'public');
app.use('/css',    express.static(path.join(PUBLIC, 'css')));
app.use('/js',     express.static(path.join(PUBLIC, 'js')));
app.use('/data',   express.static(path.join(__dirname, 'data')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'js-yaml', 'dist')));
/* Serve index.html and auth-callback.html from public root */
app.use(express.static(PUBLIC, { index: 'index.html', dotfiles: 'ignore' }));

// ── Session store ────────────────────────────────────────────
// Each session represents a briefing room that one presenter
// controls and many presentees observe.
//
// Structure:
//   sessions.get(sessionId) → {
//     presenterId:  socket.id | null,
//     packageYaml:  string    | null,   // raw YAML text
//     currentTab:   string,
//     theme:        string,
//     display:      { timeMode, coordMode },
//     members:      Map<socketId, { role }>,  // connected users
//   }
const sessions = new Map();

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      presenterId:     null,
      presenterPassword: null,  // set by the first presenter
      packageYaml:     null,
      currentTab:      'ato',
      theme:           'pro',
      display:         { timeMode: 'Z', coordMode: 'dm' },
      members:         new Map(),
    });
  }
  return sessions.get(sessionId);
}

// Build a presence summary for broadcast
function buildPresence(session) {
  let presenterCount = 0;
  let presenteeCount = 0;
  session.members.forEach(({ role }) => {
    if (role === 'presenter') presenterCount++;
    else presenteeCount++;
  });
  return { presenter: presenterCount, presentee: presenteeCount, total: presenterCount + presenteeCount };
}

// ── WebSocket handling ───────────────────────────────────────
io.on('connection', (socket) => {
  let currentSessionId = null;
  let currentRole      = null;

  // ── Join a session ─────────────────────────────────────────
  socket.on('join', ({ sessionId, role, password }) => {
    if (!sessionId || typeof sessionId !== 'string') return;

    const session = getOrCreateSession(sessionId);
    const wantedRole = role === 'presenter' ? 'presenter' : 'presentee';

    // ── Presenter password gate ─────────────────────────────
    if (wantedRole === 'presenter') {
      // Only one presenter at a time
      if (session.presenterId !== null) {
        const presenterSocket = io.sockets.sockets.get(session.presenterId);
        if (presenterSocket && presenterSocket.connected) {
          socket.emit('join-error', { message: 'Room already has an active presenter' });
          return;
        }
        // Previous presenter disconnected without cleanup — clear stale id
        session.presenterId = null;
      }

      const pw = typeof password === 'string' ? password : '';
      if (session.presenterPassword === null) {
        // First presenter sets the room password (stored hashed)
        session.presenterPassword = hashPassword(pw);
      } else if (!verifyPassword(pw, session.presenterPassword)) {
        socket.emit('join-error', { message: 'Wrong presenter password' });
        return;
      }
    }

    currentSessionId = sessionId;
    currentRole = wantedRole;
    socket.join(sessionId);

    if (currentRole === 'presenter') {
      session.presenterId = socket.id;
    }

    // Track this member in the session
    session.members.set(socket.id, { role: currentRole });

    // Send the current session state to the joining client
    socket.emit('session-state', {
      role:        currentRole,
      packageYaml: session.packageYaml,
      currentTab:  session.currentTab,
      theme:       session.theme,
      display:     session.display,
    });

    // Broadcast updated presence to all room members
    io.to(sessionId).emit('room-presence', buildPresence(session));
  });

  // ── Presenter: package loaded ──────────────────────────────
  socket.on('package-loaded', (yamlText) => {
    if (!currentSessionId || currentRole !== 'presenter') return;
    if (typeof yamlText !== 'string') return;

    const session = sessions.get(currentSessionId);
    if (!session || session.presenterId !== socket.id) return;

    session.packageYaml = yamlText;
    socket.to(currentSessionId).emit('package-loaded', yamlText);
  });

  // ── Presenter: tab changed ────────────────────────────────
  socket.on('tab-changed', (tab) => {
    if (!currentSessionId || currentRole !== 'presenter') return;
    if (typeof tab !== 'string') return;

    const session = sessions.get(currentSessionId);
    if (!session || session.presenterId !== socket.id) return;

    session.currentTab = tab;
    socket.to(currentSessionId).emit('tab-changed', tab);
  });

  // ── Presenter: theme changed ──────────────────────────────
  socket.on('theme-changed', (theme) => {
    if (!currentSessionId || currentRole !== 'presenter') return;
    if (typeof theme !== 'string') return;

    const session = sessions.get(currentSessionId);
    if (!session || session.presenterId !== socket.id) return;

    session.theme = theme;
    socket.to(currentSessionId).emit('theme-changed', theme);
  });

  // ── Presenter: display settings changed ───────────────────
  socket.on('display-changed', (display) => {
    if (!currentSessionId || currentRole !== 'presenter') return;
    if (!display || typeof display !== 'object') return;

    const session = sessions.get(currentSessionId);
    if (!session || session.presenterId !== socket.id) return;

    if (typeof display.timeMode  === 'string') session.display.timeMode  = display.timeMode;
    if (typeof display.coordMode === 'string') session.display.coordMode = display.coordMode;

    socket.to(currentSessionId).emit('display-changed', display);
  });

  // ── Presenter: close room ─────────────────────────────────
  socket.on('close-room', () => {
    if (!currentSessionId || currentRole !== 'presenter') return;
    const session = sessions.get(currentSessionId);
    if (!session || session.presenterId !== socket.id) return;

    io.to(currentSessionId).emit('room-closed');
    sessions.delete(currentSessionId);
  });

  // ── Disconnect ────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (currentSessionId) {
      const session = sessions.get(currentSessionId);
      if (session) {
        // Remove from member list
        session.members.delete(socket.id);

        if (currentRole === 'presenter' && session.presenterId === socket.id) {
          session.presenterId = null;
          io.to(currentSessionId).emit('presenter-disconnected');
        }

        // Broadcast updated presence to remaining members
        io.to(currentSessionId).emit('room-presence', buildPresence(session));
      }
    }
  });
});

// ── Active rooms list ────────────────────────────────────────
app.get('/api/rooms', (_req, res) => {
  const rooms = [];
  sessions.forEach((session, id) => {
    if (session.members.size === 0 && session.packageYaml === null) return;
    rooms.push({
      id,
      hasPackage:      session.packageYaml !== null,
      presenterActive: session.presenterId !== null &&
                       !!(io.sockets.sockets.get(session.presenterId)?.connected),
      members:         buildPresence(session),
    });
  });
  res.json({ rooms });
});

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`ATO BRIEF server listening on http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io, PORT };
