// ═══════════════════════════════════════════════════════════
// main.js — wing-admin bootstrap
//
// Loaded LAST (see wing-admin.html) — its top-level IIFE runs immediately
// on load and calls into every other wing-admin/*.js file (loadAll,
// openSqModal, openDiscordRolesModal, openRoleSortModal, setSort,
// loadActivityOverview, ...), so everything it references must already be
// defined by earlier <script> tags.
// ═══════════════════════════════════════════════════════════

'use strict';

(function () {
  var tok  = getToken();
  var user = getUser();
  var btn  = document.getElementById('loginBtn');

  if (tok && user) {
    if (btn) {
      btn.textContent = (user.name || 'USER').toUpperCase() + ' ⏻';
      btn.title = 'Click to log out';
      btn.classList.add('login-btn--logout');
      btn.onclick = logout;
    }
  } else if (btn) {
    btn.textContent = 'LOGIN'; btn.onclick = loginWithCasdoor;
  }

  if (!tok || !isSkillAdminRole(tok)) {
    document.getElementById('accessDenied').style.display = '';
    return;
  }

  document.getElementById('adminPanel').style.display = '';
  loadAll(tok);

  /* Squadron entity CRUD and Discord role mapping are global config —
     keep them gated to strict admins, same as before this UI moved here. */
  if (isAdminRole(tok)) {
    document.getElementById('sqSection').style.display = '';
    document.getElementById('drSection').style.display = '';
    document.getElementById('rsoSection').style.display = '';
    document.getElementById('sqAddBtn').addEventListener('click', function () { openSqModal(); });
    document.getElementById('drEditBtn').addEventListener('click', function () { openDiscordRolesModal(); });
    document.getElementById('rsoEditBtn').addEventListener('click', function () { openRoleSortModal(); });
  }

  document.getElementById('refreshBtn').addEventListener('click', function () { refreshFromDiscord(tok); });
  document.getElementById('memberSearch').addEventListener('input', function (e) {
    _search = e.target.value.toLowerCase().trim();
    renderTable();
  });
  document.getElementById('squadronFilter').addEventListener('change', function (e) {
    _filter = e.target.value;
    renderTable();
  });

  Array.prototype.forEach.call(document.querySelectorAll('#membersTable th.sortable'), function (th) {
    th.addEventListener('click', function () { setSort(th.dataset.sort); });
  });

  document.getElementById('activityMode').addEventListener('change', loadActivityOverview);
  document.getElementById('activityRange').addEventListener('change', loadActivityOverview);
  loadActivityOverview();
})();
