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

const crypto  = require('crypto');
const express = require('express');
const http    = require('http');
const path    = require('path');
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

// ── Serve static front-end assets ────────────────────────────
// Only expose the directories the browser actually needs.
app.get('/',  (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use('/css',  express.static(path.join(__dirname, 'css')));
app.use('/js',   express.static(path.join(__dirname, 'js')));
app.use('/data', express.static(path.join(__dirname, 'data')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'js-yaml', 'dist')));

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
    });
  }
  return sessions.get(sessionId);
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

    // Send the current session state to the joining client
    socket.emit('session-state', {
      role:        currentRole,
      packageYaml: session.packageYaml,
      currentTab:  session.currentTab,
      theme:       session.theme,
      display:     session.display,
    });
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

  // ── Presenter: cursor move (laser pointer) ───────────────────
  socket.on('cursor-move', (pos) => {
    if (!currentSessionId || currentRole !== 'presenter') return;
    const session = sessions.get(currentSessionId);
    if (!session || session.presenterId !== socket.id) return;
    // pos is {x, y} as viewport percentages, or null to hide the laser dot
    socket.to(currentSessionId).emit('cursor-move', pos);
  });

  // ── Presentee: request current session state (sync snap-back) ─
  socket.on('request-sync', () => {
    if (!currentSessionId || currentRole !== 'presentee') return;
    const session = sessions.get(currentSessionId);
    if (!session) return;
    socket.emit('sync-state', {
      packageYaml: session.packageYaml,
      currentTab:  session.currentTab,
      theme:       session.theme,
      display:     session.display,
    });
  });

  // ── Disconnect ────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (currentSessionId && currentRole === 'presenter') {
      const session = sessions.get(currentSessionId);
      if (session && session.presenterId === socket.id) {
        session.presenterId = null;
        io.to(currentSessionId).emit('presenter-disconnected');
      }
    }
  });
});

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`ATO BRIEF server listening on http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io, PORT };
