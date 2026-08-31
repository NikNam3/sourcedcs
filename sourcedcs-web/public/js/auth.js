/* ── Shared auth utilities ──────────────────────────────── */

function getToken() { try { return localStorage.getItem('sdcs-token'); } catch(e) { return null; } }

function getUser() { try { return JSON.parse(localStorage.getItem('sdcs-user') || 'null'); } catch(e) { return null; } }

function logout() {
  try { localStorage.removeItem('sdcs-token'); localStorage.removeItem('sdcs-user'); } catch(e) {}
  location.reload();
}

/* Builds a fetch() headers object with a Bearer token attached. Pass an
   explicit token (e.g. a locally cached one), including a falsy one if that's
   what the caller has, or omit the argument entirely to use getToken().
   `extra` merges in additional headers (e.g. Content-Type). */
function authHeaders(token, extra) {
  var h = {};
  for (var k in (extra || {})) { h[k] = extra[k]; }
  var t = arguments.length > 0 ? token : getToken();
  h['Authorization'] = 'Bearer ' + (t || '');
  return h;
}

/* ── Theme ── */
function setTheme(t) {
  document.documentElement.classList.toggle('movie', t === 'movie');
  document.querySelectorAll('.theme-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.theme === t); });
  try { localStorage.setItem('sdcs-theme', t); } catch(e) {}
}
(function() { try { if (localStorage.getItem('sdcs-theme') === 'movie') setTheme('movie'); } catch(e) {} })();

/* ── HTML escaping ── */
function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ── Toast notifications (used by admin pages) ── */
var _toastTimer = null;
function showToast(msg, isErr) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'skills-toast visible' + (isErr ? ' err' : '');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { el.className = 'skills-toast'; }, 3000);
}

function loginWithCasdoor() {
  try { localStorage.setItem('sdcs-return-url', window.location.href); } catch(e) {}
  var ru = encodeURIComponent(window.location.origin + '/auth-callback.html');
  var st = Math.random().toString(36).slice(2);
  try { sessionStorage.setItem('sdcs-oauth-state', st); } catch(e) {}
  window.location.href = CASDOOR_ENDPOINT + '/login/oauth/authorize?client_id=' + CASDOOR_CLIENT_ID + '&redirect_uri=' + ru + '&response_type=code&scope=openid+profile&state=' + st;
}

/* Redirect to Casdoor signup page. Accepts an optional custom return URL so
   callers can direct the user to a specific page (e.g. with ?apply=1) after
   they complete registration. Falls back to the current page. */
function signupWithCasdoor(customReturnUrl) {
  try { localStorage.setItem('sdcs-return-url', customReturnUrl || window.location.href); } catch(e) {}
  var ru = encodeURIComponent(window.location.origin + '/auth-callback.html');
  var st = Math.random().toString(36).slice(2);
  try { sessionStorage.setItem('sdcs-oauth-state', st); } catch(e) {}
  window.location.href = CASDOOR_ENDPOINT + '/signup/oauth/authorize?client_id=' + CASDOOR_CLIENT_ID + '&redirect_uri=' + ru + '&response_type=code&scope=openid+profile&state=' + st;
}

/* Returns true if the given JWT contains an "admin" role in its roles claim.
   Casdoor encodes roles as an array of objects ({ name: '...' }) or strings. */
function isAdminRole(token) {
  if (!token) return false;
  try {
    var parts = token.split('.');
    if (parts.length !== 3) return false;
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    var roles = payload.roles || [];
    return Array.isArray(roles) && roles.some(function(r) {
      return (typeof r === 'string' ? r : (r && r.name) || '') === 'admin';
    });
  } catch(e) { return false; }
}

/* Returns true if the token grants skill-admin access.
   Allowed roles are configured in config.json and exposed to the client
   as window.SKILL_ADMIN_ROLES via /js/config.js. */
function isSkillAdminRole(token) {
  if (!token) return false;
  try {
    var parts = token.split('.');
    if (parts.length !== 3) return false;
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    var userRoles = payload.roles || [];
    var allowed = (typeof SKILL_ADMIN_ROLES !== 'undefined') ? SKILL_ADMIN_ROLES : ['admin'];
    return Array.isArray(userRoles) && userRoles.some(function(r) {
      return allowed.indexOf(typeof r === 'string' ? r : (r && r.name) || '') !== -1;
    });
  } catch(e) { return false; }
}

/* Returns true if the token grants booking-admin access (manage ranges &
   controller positions). Fixed allowlist, mirrors the server's
   BOOKING_ADMIN_ROLES in server.js. */
function isBookingAdminRole(token) {
  if (!token) return false;
  try {
    var parts = token.split('.');
    if (parts.length !== 3) return false;
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    var userRoles = payload.roles || [];
    var allowed = ['admin', 'squadronlead'];
    return Array.isArray(userRoles) && userRoles.some(function(r) {
      return allowed.indexOf(typeof r === 'string' ? r : (r && r.name) || '') !== -1;
    });
  } catch(e) { return false; }
}

/* Returns true if the given JWT contains at least one role in its roles claim. */
function hasAnyRole(token) {
  if (!token) return false;
  try {
    var parts = token.split('.');
    if (parts.length !== 3) return false;
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    var roles = payload.roles || [];
    return Array.isArray(roles) && roles.length > 0;
  } catch(e) { return false; }
}
