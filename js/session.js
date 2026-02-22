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
  laser:     false,  // presenter-only: true when laser pointer is active
  _laserMoveHandler: null, // mousemove listener ref for cleanup
  _laserThrottle:    0,    // timestamp of last cursor-move emit
  _broadcastTimer:   null, // debounce timer for _broadcastState
  _scrollHandlers:   [],   // scroll listeners added on presenter join
};

// ── Unwrapped function references (module-level, used by _applyState) ─────
// Originals are captured once; unwrapped refs are always the original functions.
let _origLoadPackage  = null;
let _origShowTab      = null;
let _origSetTheme     = null;
let _origSetTimeMode  = null;
let _origSetCoordMode = null;

// Unwrapped refs — set to originals in joinSession; used by _applyState
let _loadPackage  = null;
let _showTab      = null;
let _setTheme     = null;
let _setTimeMode  = null;
let _setCoordMode = null;

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

  // Unwrapped refs — always the original functions; used by _applyState
  _loadPackage  = _origLoadPackage;
  _showTab      = _origShowTab;
  _setTheme     = _origSetTheme;
  _setTimeMode  = _origSetTimeMode;
  _setCoordMode = _origSetCoordMode;

  // ── Wrap global functions for presenter sync ──────────────
  if (SESSION.role === 'presenter') {
    window.loadPackage = function (yamlText) {
      _loadPackage(yamlText);
      _broadcastState();
    };

    window.showTab = function (name) {
      _showTab(name);
      _broadcastState();
    };

    window.setTheme = function (t) {
      _setTheme(t);
      _broadcastState();
    };

    window.setTimeMode = function (m) {
      _setTimeMode(m);
      _broadcastState();
    };

    window.setCoordMode = function (m) {
      _setCoordMode(m);
      _broadcastState();
    };

    // Callbacks — called by view-ato.js and map modules after local state changes
    window._onSelectMission  = _broadcastState;
    window._onMapStateChange = _broadcastState;

    // Scroll listeners — save scroll fraction to STATE.ui.scrolls and broadcast
    ['aco-content', 'spins-content', 'comms-content', 'weather-content'].forEach(id => {
      const scrollEl = document.getElementById(id);
      if (!scrollEl) return;
      const tabId = id.replace('-content', '');
      const handler = () => {
        const max = scrollEl.scrollHeight - scrollEl.clientHeight;
        if (max > 0) STATE.ui.scrolls[tabId] = scrollEl.scrollTop / max;
        _broadcastState();
      };
      scrollEl.addEventListener('scroll', handler, { passive: true });
      SESSION._scrollHandlers.push({ el: scrollEl, handler });
    });
  } else {
    // Presentee: restore originals (don't broadcast)
    window.loadPackage  = _loadPackage;
    window.showTab      = _showTab;
    window.setTheme     = _setTheme;
    window.setTimeMode  = _setTimeMode;
    window.setCoordMode = _setCoordMode;
    window._onSelectMission  = null;
    window._onMapStateChange = null;
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
    window._onSelectMission  = null;
    window._onMapStateChange = null;
  });

  // ── Receive initial session state on join ──────────────────
  SESSION.socket.on('session-state', (uiState) => {
    closeJoinDialog();
    showSessionIndicator(SESSION.sessionId, SESSION.role);

    if (SESSION.role === 'presenter') {
      // Broadcast current client state so the server is up to date
      // (handles reconnection after network blip)
      _broadcastState();
    } else {
      applyPresenteeUI();
      _applyState(uiState);
    }
  });

  // ── Live full-state push from presenter ────────────────────
  // Replaces all individual events (package-loaded, tab-changed, etc.)
  SESSION.socket.on('state-push', (uiState) => {
    if (SESSION.role !== 'presentee' || !SESSION.synced) return;
    _applyState(uiState);
  });

  SESSION.socket.on('presenter-disconnected', () => {
    console.warn('[SESSION] Presenter disconnected');
  });

  // ── Snap-back: server reply to request-sync ────────────────
  SESSION.socket.on('sync-state', (uiState) => {
    if (SESSION.role !== 'presentee') return;
    _applyState(uiState);
    _setPresenteeTabLock(SESSION.synced);
  });

  // ── Presentee: receive laser pointer position ─────────────────
  SESSION.socket.on('cursor-move', (pos) => {
    if (SESSION.role !== 'presentee' || !SESSION.synced) return;
    _updateLaserDot(pos);
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
// ── Full state capture (presenter → server → presentees) ─────
// Returns a serialisable snapshot of everything needed to fully
// reproduce the presenter's current view on a presentee's screen.
function _captureState() {
  return {
    packageYaml: STATE.packageYaml || null,
    currentTab:  STATE.currentTab,
    theme:       STATE.theme,
    display:     { timeMode: STATE.display.timeMode, coordMode: STATE.display.coordMode },
    ui: {
      selectedMission: STATE.selectedIdx,
      scrolls: Object.assign({}, STATE.ui.scrolls),
      map: {
        tx:              STATE.ui.map.tx,
        ty:              STATE.ui.map.ty,
        sc:              STATE.ui.map.sc,
        highlighted:     STATE.ui.map.highlighted,
        engZonesVisible: STATE.ui.map.engZonesVisible,
        airspacesVisible: STATE.ui.map.airspacesVisible,
      },
    },
  };
}

// ── Apply a full state snapshot to the local UI (presentee) ──
// Applies theme/display → package → tab → UI extras in the
// correct dependency order.  Guards against feedback loops with
// SESSION._syncing.
function _applyState(s) {
  if (!s) return;
  SESSION._syncing = true;
  try {
    if (typeof s.theme === 'string')         _setTheme(s.theme);
    if (s.display?.timeMode)                 _setTimeMode(s.display.timeMode);
    if (s.display?.coordMode)                _setCoordMode(s.display.coordMode);
    if (s.packageYaml) {
      _loadPackage(s.packageYaml);
      _setPresenteeTabLock(SESSION.synced);
    }
    if (typeof s.currentTab === 'string')    _showTab(s.currentTab);

    if (s.ui) {
      // Scroll positions — replace entirely to avoid accumulating stale tabs from a prior package
      if (s.ui.scrolls) STATE.ui.scrolls = Object.assign({}, s.ui.scrolls);

      // Map state (only if the map has been rendered)
      if (s.ui.map) {
        if (typeof window._applyMapState === 'function') {
          window._applyMapState(s.ui.map);
        }
        if (typeof window._applyMapFilter === 'function') {
          window._applyMapFilter(
            s.ui.map.highlighted,
            s.ui.map.engZonesVisible,
            s.ui.map.airspacesVisible,
          );
        }
      }

      // Selected ATO mission (use the global directly; _syncing prevents re-broadcast)
      if (typeof s.ui.selectedMission === 'number') {
        if (s.ui.selectedMission >= 0 && STATE.pkg?.ato &&
            typeof window.selectMission === 'function') {
          window.selectMission(s.ui.selectedMission);
        }
        if (s.ui.selectedMission < 0 && typeof window.closeDetail === 'function') {
          window.closeDetail();
        }
      }
    }
  } finally {
    SESSION._syncing = false;
  }
}

// ── Broadcast state (presenter → server, debounced 200 ms) ───
// Debounced so rapid sequences (theme change → re-render → select mission)
// only result in one network round-trip.
function _broadcastState() {
  if (SESSION._syncing || SESSION.role !== 'presenter' || !SESSION.connected) return;
  clearTimeout(SESSION._broadcastTimer);
  SESSION._broadcastTimer = setTimeout(() => {
    if (SESSION.connected && SESSION.role === 'presenter') {
      SESSION.socket.emit('state-push', _captureState());
    }
  }, 200);
}

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

  // Lock tab navigation while synced (presenter controls the tab)
  _setPresenteeTabLock(SESSION.synced);
}

function showSessionIndicator(sessionId, role) {
  // Remove existing indicator and action buttons
  const existing = document.querySelector('.session-indicator');
  if (existing) existing.remove();
  const existingLeave = document.getElementById('leaveRoomBtn');
  if (existingLeave) existingLeave.remove();
  const existingSync = document.getElementById('syncToggleBtn');
  if (existingSync) existingSync.remove();
  const existingLaser = document.getElementById('laserBtn');
  if (existingLaser) existingLaser.remove();

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

  // For presenters, add LASER POINTER button
  if (role === 'presenter') {
    const laserBtn = document.createElement('button');
    laserBtn.className = 'load-btn';
    laserBtn.id = 'laserBtn';
    laserBtn.textContent = 'LASER: OFF';
    laserBtn.onclick = toggleLaser;
    if (headerRight) headerRight.insertBefore(laserBtn, leaveBtn.nextSibling);
  }
}

// ── Leave room ────────────────────────────────────────────────
function leaveRoom() {
  if (!SESSION.socket) return;

  const wasPresentee = SESSION.role === 'presentee';
  const wasPresenter = SESSION.role === 'presenter';

  // Stop laser if active
  if (wasPresenter && SESSION.laser) {
    _setLaser(false);
  }

  // Hide the laser dot if visible
  _updateLaserDot(null);

  // Clear pending broadcast timer
  clearTimeout(SESSION._broadcastTimer);
  SESSION._broadcastTimer = null;

  // Remove scroll listeners added on presenter join
  SESSION._scrollHandlers.forEach(({ el, handler }) => el.removeEventListener('scroll', handler));
  SESSION._scrollHandlers = [];

  // Clear state-change callbacks
  window._onSelectMission  = null;
  window._onMapStateChange = null;

  SESSION.socket.disconnect();
  SESSION.socket = null;
  SESSION.connected = false;
  SESSION.role = null;
  SESSION.sessionId = null;
  SESSION.synced = true;
  SESSION.laser = false;

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
  const laserBtn = document.getElementById('laserBtn');
  if (laserBtn) laserBtn.remove();

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
    // Re-enable tab buttons
    document.querySelectorAll('.tab-btn').forEach(b => { b.disabled = false; });
  }

  // Return to the upload screen regardless of role
  STATE.pkg = null;
  STATE.packageYaml = null;
  STATE.selectedIdx = -1;
  STATE.ui.map     = { tx: 0, ty: 0, sc: 1, highlighted: null, engZonesVisible: true, airspacesVisible: true };
  STATE.ui.scrolls = {};
  const uploadScreen  = document.getElementById('upload-screen');
  const mainContent   = document.getElementById('main-content');
  const headerMeta    = document.getElementById('header-meta');
  if (uploadScreen)  uploadScreen.style.display  = '';
  if (mainContent)   mainContent.style.display   = 'none';
  if (headerMeta)    headerMeta.innerHTML         = '';
}

// Laser pointer throttle interval in milliseconds (~33fps)
const LASER_THROTTLE_MS = 30;

// ── Scroll container helper ───────────────────────────────────
// Returns the vertically-scrollable `.doc-scroll` element for the current
// doc tab (ACO, SPINS, COMMS, WX), or null for ATO and MAP which do not use
// a single shared scroll container.  Used by the laser pointer to mirror the
// presenter's scroll position on the presentee.
function _getActiveDocScroll() {
  const idMap = {
    aco:     'aco-content',
    spins:   'spins-content',
    comms:   'comms-content',
    weather: 'weather-content',
  };
  const id = idMap[STATE.currentTab];
  return id ? document.getElementById(id) : null;
}

// ── Presentee sync toggle ─────────────────────────────────────
function toggleSync() {
  SESSION.synced = !SESSION.synced;
  const syncBtn = document.getElementById('syncToggleBtn');
  if (syncBtn) {
    syncBtn.textContent = SESSION.synced ? 'SYNC: ON' : 'SYNC: OFF';
    syncBtn.classList.toggle('sync-off', !SESSION.synced);
  }
  // Lock/unlock tab bar based on new sync state
  _setPresenteeTabLock(SESSION.synced);
  // When re-enabling sync, immediately snap to the current presenter state
  if (SESSION.synced && SESSION.socket && SESSION.connected) {
    SESSION.socket.emit('request-sync');
    // Hide the laser dot: the sync-state reply will re-show it if the
    // presenter currently has the laser active (cursor-move arrives naturally)
    _updateLaserDot(null);
  }
}

// ── Tab lock for synced presentees ────────────────────────────
function _setPresenteeTabLock(locked) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    if (locked) {
      b.dataset.origDisabled = b.disabled ? '1' : '0';
      b.disabled = true;
      b.title = 'Tab navigation locked — presenter controls the view';
    } else {
      // Restore to the natural disabled state (i.e. tab unavailable if no data)
      if (b.dataset.origDisabled === '0') b.disabled = false;
      b.title = '';
    }
  });
}

// ── Laser pointer (presenter) ─────────────────────────────────
function toggleLaser() {
  _setLaser(!SESSION.laser);
}

function _setLaser(on) {
  SESSION.laser = on;
  const btn = document.getElementById('laserBtn');
  if (btn) {
    btn.textContent = on ? 'LASER: ON' : 'LASER: OFF';
    btn.classList.toggle('laser-active', on);
  }

  if (on) {
    // Add mousemove listener
    SESSION._laserMoveHandler = function (e) {
      const now = Date.now();
      if (now - SESSION._laserThrottle < LASER_THROTTLE_MS) return;
      SESSION._laserThrottle = now;
      if (SESSION.socket && SESSION.connected) {
        const payload = {
          x: (e.clientX / window.innerWidth)  * 100,
          y: (e.clientY / window.innerHeight) * 100,
        };

        // Include scroll fraction for doc pages so presentee can mirror scroll
        const scrollEl = _getActiveDocScroll();
        if (scrollEl) {
          const max = scrollEl.scrollHeight - scrollEl.clientHeight;
          payload.scroll = max > 0 ? scrollEl.scrollTop / max : 0;
        }

        // Include map transform so presentee sees the same view
        if (STATE.currentTab === 'map' && window._mapState) {
          payload.mapState = {
            tx: window._mapState.tx,
            ty: window._mapState.ty,
            sc: window._mapState.sc,
          };
        }

        SESSION.socket.emit('cursor-move', payload);
      }
    };
    window.addEventListener('mousemove', SESSION._laserMoveHandler);
    document.documentElement.classList.add('laser-mode');
  } else {
    // Remove mousemove listener and hide dot on all presentees
    if (SESSION._laserMoveHandler) {
      window.removeEventListener('mousemove', SESSION._laserMoveHandler);
      SESSION._laserMoveHandler = null;
    }
    if (SESSION.socket && SESSION.connected) {
      SESSION.socket.emit('cursor-move', null); // tell presentees to hide dot
    }
    document.documentElement.classList.remove('laser-mode');
  }
}

// ── Laser dot renderer (presentee) ───────────────────────────
function _updateLaserDot(pos) {
  let dot = document.getElementById('laserDot');
  if (!pos) {
    if (dot) dot.style.display = 'none';
    return;
  }

  // Mirror the presenter's scroll position so the dot points at the same content
  const scrollEl = _getActiveDocScroll();
  if (scrollEl && pos.scroll !== undefined) {
    const max = scrollEl.scrollHeight - scrollEl.clientHeight;
    if (max > 0) scrollEl.scrollTop = pos.scroll * max;
  }

  // Mirror the presenter's map transform so the dot overlays the same map area
  if (STATE.currentTab === 'map' && pos.mapState && typeof window._applyMapState === 'function') {
    window._applyMapState(pos.mapState);
  }

  if (!dot) {
    dot = document.createElement('div');
    dot.id = 'laserDot';
    dot.className = 'laser-dot';
    document.body.appendChild(dot);
  }
  dot.style.left    = pos.x + '%';
  dot.style.top     = pos.y + '%';
  dot.style.display = '';
}
