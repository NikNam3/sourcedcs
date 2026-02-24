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
// Presenter: loads packages and broadcasts them to presentees.
//   Tab navigation, theme and display-mode changes are local only.
//
// Presentee: the UI is read-only — file loading and editing are
//   disabled. Navigation, theme and display mode are fully
//   independent from the presenter.

'use strict';

const SESSION = {
  socket:    null,
  role:      null,   // 'presenter' | 'presentee' | null (standalone)
  sessionId: null,
  connected: false,
  _syncing:  false,  // true while applying remote state
};

// ── Original loadPackage reference (captured once) ───────────
// Only loadPackage is wrapped for presenter broadcasting; all other
// UI functions (showTab, setTheme, etc.) remain unwrapped so that
// each user navigates independently.
let _origLoadPackage = null;

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

  // Capture the original loadPackage exactly once
  if (!_origLoadPackage) {
    _origLoadPackage = window.loadPackage;
  }
  const _loadPackage = _origLoadPackage;

  // ── Wrap loadPackage for presenter so edits/loads are broadcast ──
  if (SESSION.role === 'presenter') {
    window.loadPackage = function (yamlText) {
      _loadPackage(yamlText);
      if (SESSION.connected && !SESSION._syncing) {
        SESSION.socket.emit('package-loaded', yamlText);
      }
    };
  } else {
    // Presentee: ensure the unwrapped original is active
    window.loadPackage = _loadPackage;
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
    // Restore unwrapped loadPackage
    window.loadPackage = _loadPackage;
  });

  // ── Receive initial session state ──────────────────────────
  SESSION.socket.on('session-state', (state) => {
    // Successful join — close dialog and update UI chrome
    closeJoinDialog();
    showSessionIndicator(SESSION.sessionId, SESSION.role);
    _showRoomButtons(true);

    // Always unload the local package so the room package takes over.
    // If the room has no package yet, the upload screen is shown and
    // the presenter can load one; presentees see the waiting message.
    unloadPackage();

    if (SESSION.role === 'presentee') {
      applyPresenteeUI();
    }

    // Load room package if one already exists
    if (state.packageYaml) {
      SESSION._syncing = true;
      _loadPackage(state.packageYaml);
      SESSION._syncing = false;
    }
  });

  // ── Live package updates from presenter ───────────────────
  SESSION.socket.on('package-loaded', (yamlText) => {
    if (SESSION.role === 'presentee') {
      SESSION._syncing = true;
      _loadPackage(yamlText);
      SESSION._syncing = false;
    }
  });

  SESSION.socket.on('presenter-disconnected', () => {
    console.warn('[SESSION] Presenter disconnected');
  });

  SESSION.socket.on('disconnect', () => {
    SESSION.connected = false;
  });
}

// ── Leave a session ──────────────────────────────────────────
function leaveSession() {
  if (SESSION.socket) {
    SESSION.socket.disconnect();
    SESSION.socket = null;
  }
  SESSION.connected = false;
  SESSION.role      = null;
  SESSION.sessionId = null;

  // Restore unwrapped loadPackage
  if (_origLoadPackage) window.loadPackage = _origLoadPackage;

  // Remove the session indicator badge
  const existing = document.querySelector('.session-indicator');
  if (existing) existing.remove();

  // Restore full UI and unload the room package
  _restoreDefaultUI();
  _showRoomButtons(false);
  unloadPackage();
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

// Toggle JOIN ROOM / LEAVE ROOM button visibility.
function _showRoomButtons(inRoom) {
  const joinBtn   = document.getElementById('joinRoomBtn');
  const leaveBtn  = document.getElementById('leaveRoomBtn');
  if (joinBtn)   joinBtn.style.display   = inRoom ? 'none' : '';
  if (leaveBtn)  leaveBtn.style.display  = inRoom ? ''     : 'none';
}

// Apply presentee restrictions: hide LOAD PACKAGE + EDIT buttons,
// disable file input, replace drop zone with a waiting message.
function applyPresenteeUI() {
  const loadPkgBtn = document.getElementById('loadPackageBtn');
  if (loadPkgBtn) loadPkgBtn.style.display = 'none';

  const editBtn = document.getElementById('editModeBtn');
  if (editBtn) editBtn.style.display = 'none';

  const fileInput = document.getElementById('fileInput');
  if (fileInput) fileInput.disabled = true;

  const dropZone = document.getElementById('dropZone');
  if (dropZone) {
    dropZone.innerHTML =
      '<div class="drop-icon">\u23F3</div>' +
      '<div class="drop-label">WAITING FOR PRESENTER</div>' +
      '<div class="drop-sub">The presenter will load the briefing package.</div>';
    dropZone.style.pointerEvents = 'none';
  }
}

// Restore the default (standalone) UI after leaving a session.
function _restoreDefaultUI() {
  const loadPkgBtn = document.getElementById('loadPackageBtn');
  if (loadPkgBtn) loadPkgBtn.style.display = '';

  const editBtn = document.getElementById('editModeBtn');
  if (editBtn) editBtn.style.display = '';

  const fileInput = document.getElementById('fileInput');
  if (fileInput) fileInput.disabled = false;

  const dropZone = document.getElementById('dropZone');
  if (dropZone) {
    dropZone.innerHTML =
      '<div class="drop-icon">\u2295</div>' +
      '<div class="drop-label">LOAD ATO PACKAGE</div>' +
      '<div class="drop-sub">Drop a <strong>package.yaml</strong> here, or click to browse.<br>' +
      'Top-level keys: <code>ato</code>, <code>aco</code>, <code>spins</code>, <code>comms</code>, <code>weather</code></div>' +
      '<div class="drop-hint">Try: <code>demo-package.yaml</code></div>';
    dropZone.style.pointerEvents = '';
  }
}

function showSessionIndicator(sessionId, role) {
  // Remove existing indicator
  const existing = document.querySelector('.session-indicator');
  if (existing) existing.remove();

  const indicator = document.createElement('div');
  indicator.className = 'session-indicator role-' + role;
  indicator.textContent = role.toUpperCase() + ' \u2022 ' + sessionId;
  const headerRight = document.querySelector('.header-right');
  if (headerRight) headerRight.prepend(indicator);
}

