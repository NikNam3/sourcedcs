// ═══════════════════════════════════════════════════════════
// session.js — Client-side session & role management
// ═══════════════════════════════════════════════════════════
//
// Connects presenter ↔ presentee via Socket.io.
//
// Users can join a session either through URL parameters or
// through the Join Room dialog in the UI.
//
// URL parameters (still supported):
//   ?session=<id>                  → join as presentee (default)
//   ?session=<id>&role=presenter   → join as presenter
//   (no ?session)                  → standalone mode (shows dialog option)
//
// Presenter: every UI action (load package, switch tab, change
//   theme / display mode) is broadcast to all presentees.
//
// Presentee: the UI is read-only — file loading is disabled,
//   and all state is received from the presenter in real-time.

'use strict';

const SESSION = {
  socket:    null,
  role:      null,   // 'presenter' | 'presentee' | null (standalone)
  sessionId: null,
  connected: false,
  _syncing:  false,  // true while applying remote state
  synced:    true,   // presentee-only: when false, presenter events are ignored
};

// ── Original function references (captured once) ─────────────
// Saved before the first joinSession() call wraps the globals.
let _origLoadPackage  = null;
let _origShowTab      = null;
let _origSetTheme     = null;
let _origSetTimeMode  = null;
let _origSetCoordMode = null;

// ── Dialog helpers (global, called from onclick in HTML) ─────
function openJoinDialog() {
  const d = document.getElementById('joinDialog');
  if (d) {
    d.style.display = 'flex';
    document.getElementById('joinError').textContent = '';
    document.getElementById('joinRoomId').focus();
  }
}

function closeJoinDialog() {
  const d = document.getElementById('joinDialog');
  if (d) d.style.display = 'none';
}

function selectJoinRole(role) {
  document.querySelectorAll('.dialog-role-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.role === role);
  });
  const pwRow = document.getElementById('joinPasswordRow');
  if (pwRow) pwRow.style.display = role === 'presenter' ? '' : 'none';
}

function submitJoinDialog() {
  const roomId   = (document.getElementById('joinRoomId').value || '').trim();
  const password = (document.getElementById('joinPassword').value || '');
  const roleBtn  = document.querySelector('.dialog-role-btn.active');
  const role     = roleBtn ? roleBtn.dataset.role : 'presentee';
  const errEl    = document.getElementById('joinError');

  if (!roomId) {
    errEl.textContent = 'Enter a Room ID';
    return;
  }

  errEl.textContent = '';
  joinSession(roomId, role, password);
}

// ── Core: connect socket and join a session ──────────────────
function joinSession(sessionId, role, password) {
  // If already in a session, disconnect first
  if (SESSION.socket) {
    SESSION.socket.disconnect();
    SESSION.socket = null;
    SESSION.connected = false;
  }

  SESSION.sessionId = sessionId;
  SESSION.role = role === 'presenter' ? 'presenter' : 'presentee';

  // Capture originals exactly once (before any wrapping)
  if (!_origLoadPackage) {
    _origLoadPackage  = window.loadPackage;
    _origShowTab      = window.showTab;
    _origSetTheme     = window.setTheme;
    _origSetTimeMode  = window.setTimeMode;
    _origSetCoordMode = window.setCoordMode;
  }

  // Always restore originals first, then wrap if presenter
  const _loadPackage  = _origLoadPackage;
  const _showTab      = _origShowTab;
  const _setTheme     = _origSetTheme;
  const _setTimeMode  = _origSetTimeMode;
  const _setCoordMode = _origSetCoordMode;

  // ── Wrap global functions for presenter sync ──────────────
  if (SESSION.role === 'presenter') {
    window.loadPackage = function (yamlText) {
      _loadPackage(yamlText);
      if (SESSION.connected && !SESSION._syncing) {
        SESSION.socket.emit('package-loaded', yamlText);
      }
    };

    window.showTab = function (name) {
      _showTab(name);
      if (SESSION.connected && !SESSION._syncing) {
        SESSION.socket.emit('tab-changed', name);
      }
    };

    window.setTheme = function (t) {
      _setTheme(t);
      if (SESSION.connected && !SESSION._syncing) {
        SESSION.socket.emit('theme-changed', t);
      }
    };

    window.setTimeMode = function (m) {
      _setTimeMode(m);
      if (SESSION.connected && !SESSION._syncing) {
        SESSION.socket.emit('display-changed', { timeMode: m });
      }
    };

    window.setCoordMode = function (m) {
      _setCoordMode(m);
      if (SESSION.connected && !SESSION._syncing) {
        SESSION.socket.emit('display-changed', { coordMode: m });
      }
    };
  } else {
    // Presentee: restore originals (don't broadcast)
    window.loadPackage  = _loadPackage;
    window.showTab      = _showTab;
    window.setTheme     = _setTheme;
    window.setTimeMode  = _setTimeMode;
    window.setCoordMode = _setCoordMode;
  }

  // ── Connect to server ─────────────────────────────────────
  SESSION.socket = io();

  SESSION.socket.on('connect', () => {
    SESSION.connected = true;
    SESSION.socket.emit('join', {
      sessionId: SESSION.sessionId,
      role:      SESSION.role,
      password:  password || '',
    });
  });

  // ── Join error (e.g. wrong password) ──────────────────────
  SESSION.socket.on('join-error', ({ message }) => {
    const errEl = document.getElementById('joinError');
    if (errEl) errEl.textContent = message || 'Failed to join';
    SESSION.socket.disconnect();
    SESSION.socket = null;
    SESSION.connected = false;
    SESSION.role = null;
    SESSION.sessionId = null;
    // Restore originals
    window.loadPackage  = _loadPackage;
    window.showTab      = _showTab;
    window.setTheme     = _setTheme;
    window.setTimeMode  = _setTimeMode;
    window.setCoordMode = _setCoordMode;
  });

  // ── Receive initial session state ──────────────────────────
  SESSION.socket.on('session-state', (state) => {
    // Close dialog on successful join
    closeJoinDialog();
    showSessionIndicator(SESSION.sessionId, SESSION.role);

    if (SESSION.role === 'presentee') {
      applyPresenteeUI();
      SESSION._syncing = true;
      if (state.theme)               _setTheme(state.theme);
      if (state.display?.timeMode)   _setTimeMode(state.display.timeMode);
      if (state.display?.coordMode)  _setCoordMode(state.display.coordMode);
      if (state.packageYaml)         _loadPackage(state.packageYaml);
      if (state.currentTab)          _showTab(state.currentTab);
      SESSION._syncing = false;
    }
  });

  // ── Live updates from presenter ────────────────────────────
  SESSION.socket.on('package-loaded', (yamlText) => {
    if (SESSION.role === 'presentee' && SESSION.synced) {
      SESSION._syncing = true;
      _loadPackage(yamlText);
      SESSION._syncing = false;
    }
  });

  SESSION.socket.on('tab-changed', (tab) => {
    if (SESSION.role === 'presentee' && SESSION.synced) {
      SESSION._syncing = true;
      _showTab(tab);
      SESSION._syncing = false;
    }
  });

  SESSION.socket.on('theme-changed', (theme) => {
    if (SESSION.role === 'presentee' && SESSION.synced) {
      SESSION._syncing = true;
      _setTheme(theme);
      SESSION._syncing = false;
    }
  });

  SESSION.socket.on('display-changed', (display) => {
    if (SESSION.role === 'presentee' && SESSION.synced) {
      SESSION._syncing = true;
      if (display.timeMode)  _setTimeMode(display.timeMode);
      if (display.coordMode) _setCoordMode(display.coordMode);
      SESSION._syncing = false;
    }
  });

  SESSION.socket.on('presenter-disconnected', () => {
    console.warn('[SESSION] Presenter disconnected');
  });

  // ── Snap-back: server reply to request-sync ────────────────
  SESSION.socket.on('sync-state', (state) => {
    if (SESSION.role !== 'presentee') return;
    SESSION._syncing = true;
    // Apply in dependency order: theme/display first (no package needed),
    // then package (required before tab can be meaningfully displayed),
    // then tab last.
    if (state.theme)               _setTheme(state.theme);
    if (state.display?.timeMode)   _setTimeMode(state.display.timeMode);
    if (state.display?.coordMode)  _setCoordMode(state.display.coordMode);
    if (state.packageYaml)         _loadPackage(state.packageYaml);
    if (state.currentTab)          _showTab(state.currentTab);
    SESSION._syncing = false;
  });

  SESSION.socket.on('disconnect', () => {
    SESSION.connected = false;
  });
}

// ── Auto-join from URL parameters (backwards compatible) ─────
(function initFromURL() {
  const params    = new URLSearchParams(window.location.search);
  const sessionId = params.get('session');
  if (sessionId) {
    joinSession(sessionId, params.get('role') || 'presentee', '');
  }
})();

// ── UI helpers ───────────────────────────────────────────────
function applyPresenteeUI() {
  // Hide LOAD PACKAGE button (presentee cannot load their own package)
  const loadPkgBtn = document.getElementById('loadPackageBtn');
  if (loadPkgBtn) loadPkgBtn.style.display = 'none';

  // Hide EDIT button (presentees cannot edit)
  const editBtn = document.getElementById('editModeBtn');
  if (editBtn) editBtn.style.display = 'none';

  // Disable file input
  const fileInput = document.getElementById('fileInput');
  if (fileInput) fileInput.disabled = true;

  // Replace drop-zone content with a waiting message
  const dropZone = document.getElementById('dropZone');
  if (dropZone) {
    dropZone.innerHTML =
      '<div class="drop-icon">\u23F3</div>' +
      '<div class="drop-label">WAITING FOR PRESENTER</div>' +
      '<div class="drop-sub">The presenter will load the briefing package.</div>';
    dropZone.style.pointerEvents = 'none';
  }
}

function showSessionIndicator(sessionId, role) {
  // Remove existing indicator and action buttons
  const existing = document.querySelector('.session-indicator');
  if (existing) existing.remove();
  const existingLeave = document.getElementById('leaveRoomBtn');
  if (existingLeave) existingLeave.remove();
  const existingSync = document.getElementById('syncToggleBtn');
  if (existingSync) existingSync.remove();

  const indicator = document.createElement('div');
  indicator.className = 'session-indicator role-' + role;
  indicator.textContent = role.toUpperCase() + ' \u2022 ' + sessionId;
  const headerRight = document.querySelector('.header-right');
  if (headerRight) headerRight.prepend(indicator);

  // Hide JOIN ROOM button (already in a session)
  const joinRoomBtn = document.getElementById('joinRoomBtn');
  if (joinRoomBtn) joinRoomBtn.style.display = 'none';

  // Add LEAVE ROOM button
  const leaveBtn = document.createElement('button');
  leaveBtn.className = 'load-btn';
  leaveBtn.id = 'leaveRoomBtn';
  leaveBtn.textContent = 'LEAVE ROOM';
  leaveBtn.onclick = leaveRoom;
  if (headerRight) headerRight.insertBefore(leaveBtn, indicator.nextSibling);

  // For presentees, add SYNC toggle button
  if (role === 'presentee') {
    const syncBtn = document.createElement('button');
    syncBtn.className = 'load-btn';
    syncBtn.id = 'syncToggleBtn';
    syncBtn.textContent = 'SYNC: ON';
    syncBtn.onclick = toggleSync;
    if (headerRight) headerRight.insertBefore(syncBtn, leaveBtn.nextSibling);
  }
}

// ── Leave room ────────────────────────────────────────────────
function leaveRoom() {
  if (!SESSION.socket) return;

  const wasPresentee = SESSION.role === 'presentee';

  SESSION.socket.disconnect();
  SESSION.socket = null;
  SESSION.connected = false;
  SESSION.role = null;
  SESSION.sessionId = null;
  SESSION.synced = true;

  // Restore original function wrappers
  if (_origLoadPackage)  window.loadPackage  = _origLoadPackage;
  if (_origShowTab)      window.showTab      = _origShowTab;
  if (_origSetTheme)     window.setTheme     = _origSetTheme;
  if (_origSetTimeMode)  window.setTimeMode  = _origSetTimeMode;
  if (_origSetCoordMode) window.setCoordMode = _origSetCoordMode;

  // Remove session UI elements
  const indicator = document.querySelector('.session-indicator');
  if (indicator) indicator.remove();
  const leaveBtn = document.getElementById('leaveRoomBtn');
  if (leaveBtn) leaveBtn.remove();
  const syncBtn = document.getElementById('syncToggleBtn');
  if (syncBtn) syncBtn.remove();

  // Restore JOIN ROOM button
  const joinRoomBtn = document.getElementById('joinRoomBtn');
  if (joinRoomBtn) joinRoomBtn.style.display = '';

  if (wasPresentee) {
    // Restore LOAD PACKAGE and EDIT buttons
    const loadPkgBtn = document.getElementById('loadPackageBtn');
    if (loadPkgBtn) loadPkgBtn.style.display = '';
    const editBtn = document.getElementById('editModeBtn');
    if (editBtn) editBtn.style.display = '';
    const fileInput = document.getElementById('fileInput');
    if (fileInput) fileInput.disabled = false;
  }
}

// ── Presentee sync toggle ─────────────────────────────────────
function toggleSync() {
  SESSION.synced = !SESSION.synced;
  const syncBtn = document.getElementById('syncToggleBtn');
  if (syncBtn) {
    syncBtn.textContent = SESSION.synced ? 'SYNC: ON' : 'SYNC: OFF';
    syncBtn.classList.toggle('sync-off', !SESSION.synced);
  }
  // When re-enabling sync, immediately snap to the current presenter state
  if (SESSION.synced && SESSION.socket && SESSION.connected) {
    SESSION.socket.emit('request-sync');
  }
}
