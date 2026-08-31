/* ── Apply external links from config ── */
(function() {
  function setLink(id, url) { var el = document.getElementById(id); if (el && url) el.href = url; }
  setLink('schedDiscordLink', typeof DISCORD_URL !== 'undefined' ? DISCORD_URL : null);
  setLink('footerDiscordLink', typeof DISCORD_URL !== 'undefined' ? DISCORD_URL : null);
  setLink('footerWikiLink',   typeof WIKI_URL    !== 'undefined' ? WIKI_URL    : null);
  setLink('footerGithubLink', typeof GITHUB_URL  !== 'undefined' ? GITHUB_URL  : null);
})();

/* getToken, loginWithCasdoor, isAdminRole, getUser, logout, setTheme
   are provided by /js/auth.js */

var currentToken = getToken();
(function() {
  var user = getUser();
  var name = (user && user.name) ? user.name.toUpperCase() : 'USER';
  var btn = document.getElementById('loginBtn');
  if (btn) { btn.textContent = name + ' \u23FB'; btn.title = 'Click to log out'; btn.classList.add('login-btn--logout'); btn.onclick = logout; }
  /* Only show admin bar if user has the "admin" role */
  if (isAdminRole(currentToken)) {
    var bar = document.getElementById('adminBar');
    if (bar) {
      bar.style.display = '';
      document.getElementById('adminBarLabel').textContent = 'LOGGED IN AS ADMIN';
    }
  }
})();

/* ── Edit mode ── */
var editMode = false;
function toggleEditMode() {
  editMode = !editMode;
  document.body.classList.toggle('edit-mode', editMode);
  var btn    = document.getElementById('editModeBtn');
  var addBtn = document.getElementById('adminAddBtn');
  btn.textContent   = editMode ? '☒ EXIT EDIT MODE' : '✎ ENTER EDIT MODE';
  btn.classList.toggle('active', editMode);
  addBtn.style.display = editMode ? '' : 'none';
  renderOps(currentFilter); /* re-render to show/hide edit controls */
}

/* ── Operations data ── */
var OPS = [];
var currentFilter = 'all';
var MONTH = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
var DAY   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

function typeLabel(t)  { return {campaign:'CAMPAIGN',training:'TRAINING',cap:'CAP',strike:'STRIKE',cas:'CAS'}[t]||t.toUpperCase(); }
function statusLabel(s){ return {planned:'PLANNED',active:'ACTIVE',complete:'COMPLETE',cancelled:'CANCELLED'}[s]||s.toUpperCase(); }
function typeClass(t)  { return 'type-'+t; }
function statusClass(s){ return 'status-'+(s==='complete'?'done':s); }

function renderOps(filter) {
  var now  = new Date();
  var list = OPS.filter(function(op) {
    var d = new Date(op.date);
    if (filter === 'upcoming') return d >= now && op.status !== 'cancelled' && op.status !== 'complete';
    if (filter === 'campaign') return op.type === 'campaign';
    if (filter === 'training') return op.type === 'training';
    return true;
  }).sort(function(a,b) {
    var da = new Date(a.date), db = new Date(b.date), nm = now.getTime();
    var ua = da >= now ? da-nm : nm-da+1e15;
    var ub = db >= now ? db-nm : nm-db+1e15;
    return ua-ub;
  });

  var grid  = document.getElementById('opsGrid');
  var empty = document.getElementById('opsEmpty');
  empty.style.display = 'none';

  grid.innerHTML = list.map(function(op) {
    var d   = new Date(op.date);
    var fp  = op.slots ? Math.round(op.filledSlots/op.slots*100) : 0;
    var past = d < now;
    var adminControls = editMode
      ? '<div class="op-admin-controls"><button class="admin-edit-btn" onclick="openEventModal(' + op.id + ')">&#x270E; EDIT</button><button class="admin-delete-btn" onclick="deleteEvent(' + op.id + ')">&#x2715; DELETE</button></div>'
      : '';
    return '<div class="op-card' + (past?' op-past':'') + '">' +
      '<div class="op-date-col">' +
        '<div class="op-day-name">' + DAY[d.getUTCDay()]  + '</div>' +
        '<div class="op-day-num">' + String(d.getUTCDate()).padStart(2,'0') + '</div>' +
        '<div class="op-month">' + MONTH[d.getUTCMonth()] + '</div>' +
        '<div class="op-time">' + String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0') + 'Z</div>' +
      '</div>' +
      '<div class="op-body">' +
        '<div class="op-badges">' +
          '<span class="op-badge ' + typeClass(op.type)   + '">' + typeLabel(op.type) + '</span>' +
          '<span class="op-badge ' + statusClass(op.status) + '">' + statusLabel(op.status) + '</span>' +
          (op.map ? '<span class="op-badge type-map">' + op.map + '</span>' : '') +
        '</div>' +
        '<div class="op-name">' + op.name + '</div>' +
        '<div class="op-desc">' + (op.description||'')+'</div>' +
        '<div class="op-meta">' +
          (op.airframes && op.airframes.length ? '<span class="op-meta-item">AIRFRAMES: ' + op.airframes.join(' &middot; ') + '</span>' : '') +
          (op.slots ? '<span class="op-meta-item">SLOTS: <span class="op-slots">' + op.filledSlots + '/' + op.slots + '</span></span>' : '') +
        '</div>' +
        (op.slots ? '<div class="op-fill-bar"><div class="op-fill-inner" style="width:'+fp+'%"></div></div>' : '') +
        adminControls +
      '</div>' +
    '</div>';
  }).join('');
}

function filterOps(btn, filter) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  renderOps(filter);
}

/* ── Load events from API ── */
fetch('/api/events')
  .then(function(r) { return r.json(); })
  .then(function(data) { OPS = data; renderOps('all'); })
  .catch(function() {
    document.getElementById('opsGrid').innerHTML = '<div style="color:var(--text-3);padding:40px;text-align:center">Unable to load operations. Please try again later.</div>';
  });

/* ── Event modal ── */
function openEventModal(id) {
  var overlay = document.getElementById('eventModalOverlay');
  var errEl   = document.getElementById('evFormError');
  var succEl  = document.getElementById('evFormSuccess');
  var title   = document.getElementById('eventModalTitle');
  errEl.style.display  = 'none';
  succEl.style.display = 'none';

  if (id) {
    var op = OPS.find(function(e) { return e.id === id; });
    title.textContent = 'EDIT OPERATION';
    document.getElementById('evId').value        = op.id;
    document.getElementById('evName').value       = op.name;
    document.getElementById('evType').value       = op.type;
    document.getElementById('evStatus').value     = op.status;
    document.getElementById('evMap').value        = op.map || '';
    document.getElementById('evSlots').value      = op.slots || '';
    document.getElementById('evAirframes').value  = (op.airframes||[]).join(', ');
    document.getElementById('evDesc').value       = op.description || '';
    /* Convert ISO date to datetime-local format (YYYY-MM-DDTHH:MM) */
    var d = new Date(op.date);
    var pad = function(n) { return String(n).padStart(2,'0'); };
    document.getElementById('evDate').value = d.getUTCFullYear() + '-' + pad(d.getUTCMonth()+1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  } else {
    title.textContent = 'ADD OPERATION';
    document.getElementById('eventForm').reset();
    document.getElementById('evId').value = '';
  }

  var btn = document.getElementById('evSubmitBtn');
  btn.disabled   = false;
  btn.textContent = 'SAVE OPERATION';
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(function() { document.getElementById('evName').focus(); }, 30);
}

function closeEventModal() {
  document.getElementById('eventModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
}
document.getElementById('eventModalOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeEventModal();
});
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeEventModal(); });

function saveEvent(e) {
  e.preventDefault();
  var errEl = document.getElementById('evFormError');
  var btn   = document.getElementById('evSubmitBtn');
  errEl.style.display = 'none';

  var id   = document.getElementById('evId').value;
  var name = document.getElementById('evName').value.trim();
  var type = document.getElementById('evType').value;
  var date = document.getElementById('evDate').value;

  if (!name || !type || !date) {
    errEl.textContent   = 'Name, type and date are required.';
    errEl.style.display = '';
    return;
  }

  var airframesRaw = document.getElementById('evAirframes').value;
  var airframes = airframesRaw.split(',').map(function(s){return s.trim();}).filter(Boolean);

  var payload = {
    name:        name,
    type:        type,
    status:      document.getElementById('evStatus').value || 'planned',
    date:        new Date(date).toISOString(),
    map:         document.getElementById('evMap').value.trim(),
    airframes:   airframes,
    description: document.getElementById('evDesc').value.trim(),
    slots:       parseInt(document.getElementById('evSlots').value, 10) || 0,
  };

  btn.disabled    = true;
  btn.textContent = 'SAVING...';

  var method = id ? 'PUT' : 'POST';
  var url    = id ? ('/api/events/' + id) : '/api/events';

  fetch(url, {
    method:  method,
    headers: authHeaders(currentToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  .then(function(r) { return r.json().then(function(j) { return { ok:r.ok, body:j }; }); })
  .then(function(res) {
    if (!res.ok) {
      errEl.textContent   = res.body.error || 'Save failed.';
      errEl.style.display = '';
      btn.disabled        = false;
      btn.textContent     = 'SAVE OPERATION';
      return;
    }
    if (id) {
      var idx = OPS.findIndex(function(o) { return o.id === res.body.id; });
      if (idx !== -1) OPS[idx] = res.body; else OPS.push(res.body);
    } else {
      OPS.push(res.body);
    }
    renderOps(currentFilter);
    closeEventModal();
  })
  .catch(function() {
    errEl.textContent   = 'Network error — please try again.';
    errEl.style.display = '';
    btn.disabled        = false;
    btn.textContent     = 'SAVE OPERATION';
  });
}

function deleteEvent(id) {
  fetch('/api/events/' + id, {
    method:  'DELETE',
    headers: authHeaders(currentToken),
  })
  .then(function(r) { return r.json().then(function(j) { return { ok:r.ok, body:j }; }); })
  .then(function(res) {
    OPS = OPS.filter(function(o) { return o.id !== id; });
    renderOps(currentFilter);
  })
  .catch(function() { alert('Failed to delete event. Please check your connection and try again.'); });
}

/* ── Hamburger menu ── */
(function() {
  var hamburger = document.getElementById('hamburgerBtn');
  var nav       = document.getElementById('mainNav');
  if (!hamburger || !nav) return;
  function closeNav() {
    nav.classList.remove('nav-open');
    hamburger.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
  }
  hamburger.addEventListener('click', function() {
    var open = nav.classList.toggle('nav-open');
    hamburger.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.querySelectorAll('.nav-link').forEach(function(link) {
    link.addEventListener('click', closeNav);
  });
})();
