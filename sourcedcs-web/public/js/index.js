/* ── Theme ── */
function setTheme(t) {
  document.documentElement.classList.toggle('movie', t === 'movie');
  document.querySelectorAll('.theme-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.theme === t); });
  try { localStorage.setItem('sdcs-theme', t); } catch(e) {}
}
(function() { try { if (localStorage.getItem('sdcs-theme') === 'movie') setTheme('movie'); } catch(e) {} })();

/* ── Apply external links from config ── */
(function() {
  function setLink(id, url) { var el = document.getElementById(id); if (el && url) el.href = url; }
  setLink('toolDiscordLink',  typeof DISCORD_URL  !== 'undefined' ? DISCORD_URL  : null);
  setLink('toolWikiLink',     typeof WIKI_URL     !== 'undefined' ? WIKI_URL     : null);
  setLink('toolAtoLink',      typeof ATO_URL      !== 'undefined' ? ATO_URL      : null);
  setLink('toolOlympusLink',  typeof OLYMPUS_URL  !== 'undefined' ? OLYMPUS_URL  : null);
  setLink('toolAsacsLink',    typeof ASACS_URL    !== 'undefined' ? ASACS_URL    : null);
  setLink('footerDiscordLink', typeof DISCORD_URL  !== 'undefined' ? DISCORD_URL  : null);
  setLink('footerWikiLink',   typeof WIKI_URL     !== 'undefined' ? WIKI_URL     : null);
  setLink('footerAtoLink',    typeof ATO_URL      !== 'undefined' ? ATO_URL      : null);
  setLink('footerGithubLink', typeof GITHUB_URL   !== 'undefined' ? GITHUB_URL   : null);
})();

/* getToken, loginWithCasdoor and isAdminRole are provided by /js/auth.js */

function logoutCasdoor() {
  try { localStorage.removeItem('sdcs-token'); localStorage.removeItem('sdcs-user'); } catch(e) {}
  location.reload();
}
(function() {
  var token = getToken();
  var user  = null;
  try { user = JSON.parse(localStorage.getItem('sdcs-user') || 'null'); } catch(e) {}
  if (!token) return;
  var name = (user && user.name) ? user.name.toUpperCase() : 'USER';
  var btn = document.getElementById('loginBtn');
  if (btn) { btn.textContent = name + ' \u23FB'; btn.title = 'Click to log out'; btn.classList.add('login-btn--logout'); btn.onclick = logoutCasdoor; }
  var hero = document.getElementById('heroMemberBtn');
  if (hero) {
    hero.textContent = '\u2192 MEMBER HUB';
    hero.onclick = function() { document.getElementById('memberPortal').scrollIntoView({ behavior: 'smooth' }); };
  }
  var portal = document.getElementById('memberPortal');
  if (portal) {
    portal.style.display = '';
    var wel = document.getElementById('memberWelcome');
    if (wel) wel.textContent = 'WELCOME BACK, ' + name;
  }
})();

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

/* ── Smooth scroll ── */
document.querySelectorAll('a[href^="#"]').forEach(function(link) {
  link.addEventListener('click', function(e) {
    var id = this.getAttribute('href');
    if (id === '#') return;
    var target = document.querySelector(id);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
      history.replaceState(null, '', id);
    }
  });
});

/* ── Scroll-spy ── */
(function() {
  var sections = document.querySelectorAll('section[id]');
  var navLinks = document.querySelectorAll('.header-nav .nav-link[href^="#"]');
  if (!sections.length || !navLinks.length) return;
  /* Cache href→id mapping to avoid repeated DOM reads during scroll */
  var linkHrefs = [];
  navLinks.forEach(function(link) { linkHrefs.push(link.getAttribute('href')); });
  var HEADER_HEIGHT = 80; /* sticky header height (48px) + scroll padding */
  function onScroll() {
    var scrollY = window.scrollY + HEADER_HEIGHT;
    var current = '';
    sections.forEach(function(sec) {
      if (sec.offsetTop <= scrollY) current = sec.id;
    });
    var target = '#' + current;
    navLinks.forEach(function(link, i) {
      link.classList.toggle('active-nav', linkHrefs[i] === target);
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* ── Upcoming ops preview ── */
(function() {
  var grid = document.getElementById('opsPreviewGrid');
  var MON  = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  function typeClass(t) { return 'type-' + t; }
  function typeLabel(t) { return {campaign:'CAMPAIGN',training:'TRAINING',cap:'CAP',strike:'STRIKE',cas:'CAS'}[t] || t.toUpperCase(); }
  fetch('/api/events').then(function(r){return r.json();}).then(function(evs) {
    var now = new Date();
    var list = evs.filter(function(e) { return new Date(e.date) >= now && e.status !== 'cancelled' && e.status !== 'complete'; })
                  .sort(function(a,b) { return new Date(a.date)-new Date(b.date); }).slice(0,3);
    if (!list.length) { grid.innerHTML = '<div class="ops-preview-empty">No upcoming operations scheduled. Check back soon.</div>'; return; }
    grid.innerHTML = list.map(function(op) {
      var d = new Date(op.date);
      var fp = op.slots ? Math.round(op.filledSlots/op.slots*100) : 0;
      return '<div class="ops-preview-card">' +
        '<div class="opc-date"><span class="opc-day">' + String(d.getUTCDate()).padStart(2,'0') + '</span><span class="opc-month">' + MON[d.getUTCMonth()] + '</span><span class="opc-time">' + String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0') + 'Z</span></div>' +
        '<div class="opc-body"><span class="op-badge ' + typeClass(op.type) + ' opc-badge">' + typeLabel(op.type) + '</span><div class="opc-name">' + op.name + '</div><div class="opc-map">' + op.map + (op.airframes && op.airframes.length ? ' &middot; ' + op.airframes.join(', ') : '') + '</div>' +
        (op.slots ? '<div class="opc-slots">SLOTS ' + op.filledSlots + '/' + op.slots + '<div class="opc-fill-bar"><div class="opc-fill-inner" style="width:' + fp + '%"></div></div></div>' : '') + '</div></div>';
    }).join('');
  }).catch(function() { grid.innerHTML = '<div class="ops-preview-empty">Unable to load operations.</div>'; });
})();

/* ── Apply modal ── */
function openApplyModal(wing) {
  document.getElementById('applyModalOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  if (wing) {
    setTimeout(function() {
      var sel = document.getElementById('fSquadron');
      if (sel) sel.value = wing;
    }, 30);
  }
  setTimeout(function() { document.getElementById('fCallsign').focus(); }, 30);
}
function closeApplyModal() {
  document.getElementById('applyModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
  document.getElementById('applyFormError').style.display   = 'none';
  document.getElementById('applyFormSuccess').style.display = 'none';
  var btn = document.getElementById('applySubmitBtn');
  btn.disabled = false; btn.innerHTML = '<span class="btn-icon">&#x2295;</span> SUBMIT APPLICATION';
}
document.getElementById('applyModalOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeApplyModal();
});
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeApplyModal(); });

function submitApplication(e) {
  e.preventDefault();
  var form    = document.getElementById('applyForm');
  var errEl   = document.getElementById('applyFormError');
  var succEl  = document.getElementById('applyFormSuccess');
  var btn     = document.getElementById('applySubmitBtn');

  /* Basic validation */
  var missing = [];
  if (!form.callsign.value.trim())     missing.push('callsign');
  if (!form.discordHandle.value.trim()) missing.push('Discord username');
  if (!form.age.value)                 missing.push('age group');
  if (!form.timezone.value)            missing.push('timezone');
  if (!form.subSquadron.value)         missing.push('preferred wing');
  if (missing.length) {
    errEl.textContent   = 'Please fill in: ' + missing.join(', ') + '.';
    errEl.style.display = '';
    return;
  }

  errEl.style.display  = 'none';
  succEl.style.display = 'none';
  btn.disabled         = true;
  btn.textContent      = 'SUBMITTING...';

  fetch('/api/apply', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      callsign:     form.callsign.value.trim(),
      discordHandle:form.discordHandle.value.trim(),
      age:          form.age.value,
      timezone:     form.timezone.value,
      subSquadron:  form.subSquadron.value,
      experience:   form.experience.value,
      modules:      form.modules.value.trim(),
    }),
  })
  .then(function(r) { return r.json().then(function(j) { return { ok:r.ok, body:j }; }); })
  .then(function(res) {
    if (!res.ok) {
      errEl.textContent   = res.body.error || 'Submission failed — please try again.';
      errEl.style.display = '';
      btn.disabled        = false;
      btn.innerHTML       = '<span class="btn-icon">&#x2295;</span> SUBMIT APPLICATION';
      return;
    }
    form.reset();
    succEl.textContent = '';
    succEl.appendChild(document.createTextNode(res.body.message || 'Application received!'));
    if (res.body.discord) {
      var dLink = document.createElement('a');
      dLink.href = res.body.discord;
      dLink.target = '_blank';
      dLink.rel = 'noopener';
      dLink.style.cssText = 'color:var(--green);text-decoration:underline;margin-left:4px';
      dLink.textContent = 'JOIN DISCORD \u2192';
      succEl.appendChild(document.createTextNode(' '));
      succEl.appendChild(dLink);
    }
    succEl.style.display = '';
    btn.innerHTML        = '&#x2713; SUBMITTED';
  })
  .catch(function() {
    errEl.textContent   = 'Network error — please check your connection and try again.';
    errEl.style.display = '';
    btn.disabled        = false;
    btn.innerHTML       = '<span class="btn-icon">&#x2295;</span> SUBMIT APPLICATION';
  });
}

/* ── Admin detection (via Casdoor roles claim in JWT) ── */
/* isAdminRole is provided by /js/auth.js */
var isAdmin = isAdminRole(getToken());

/* ── Data-driven sub-squadrons ── */
var SQUADRONS = [];
(function() {
  var grid = document.getElementById('subsqGrid');
  fetch('/api/squadrons').then(function(r){return r.json();}).then(function(sqs) {
    SQUADRONS = sqs;
    renderSquadrons(sqs);
    populateWingSelects(sqs);
    if (isAdmin) {
      document.getElementById('subsqAdminBar').style.display = '';
    }
  }).catch(function() { grid.innerHTML = '<div class="ops-preview-empty">Unable to load wings.</div>'; });
})();

function renderSquadrons(sqs) {
  var grid = document.getElementById('subsqGrid');
  if (!sqs.length) { grid.innerHTML = '<div class="ops-preview-empty">No wings configured.</div>'; return; }
  grid.innerHTML = sqs.map(function(sq) {
    var tags = (sq.tags || []).map(function(t) { return '<span class="subsq-tag">' + escH(t) + '</span>'; }).join('');
    return '<div class="subsq-card">' +
      '<div class="subsq-designator">' + escH(sq.designator) + '</div>' +
      '<div class="subsq-name">' + escH(sq.name) + '</div>' +
      '<div class="subsq-airframe">' + escH(sq.airframe) + '</div>' +
      '<div class="subsq-role-tags">' + tags + '</div>' +
      '<p class="subsq-desc">' + escH(sq.shortDesc) + '</p>' +
      '<div class="subsq-card-actions">' +
        '<a class="btn btn-secondary subsq-apply-btn" href="wing.html?id=' + encodeURIComponent(sq.id) + '">VIEW DETAILS &rarr;</a>' +
        '<button class="btn btn-secondary subsq-apply-btn" onclick="openApplyModal(\'' + escH(sq.id) + '\')">APPLY &rarr;</button>' +
        (isAdmin ? '<button class="btn btn-ghost admin-edit-btn" onclick="editSquadron(\'' + escH(sq.id) + '\')">&#x270E; EDIT</button>' +
                   '<button class="btn btn-ghost admin-delete-btn" onclick="deleteSquadron(\'' + escH(sq.id) + '\')">&#x2715; DELETE</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function populateWingSelects(sqs) {
  var selectors = [document.getElementById('fSquadron'), document.getElementById('rSquadron')];
  selectors.forEach(function(sel) {
    if (!sel) return;
    var keep = sel.id === 'fSquadron' ? 'undecided' : '';
    var opts = Array.from(sel.options).filter(function(o) { return o.value === '' || o.value === keep; });
    sel.innerHTML = '';
    opts.forEach(function(o) { sel.appendChild(o); });
    sqs.forEach(function(sq) {
      var o = document.createElement('option');
      o.value = sq.id;
      o.textContent = sq.designator + ' ' + sq.name + ' \u2014 ' + sq.airframe;
      /* Insert before the "undecided" option if it exists */
      var undecided = sel.querySelector('option[value="undecided"]');
      if (undecided) sel.insertBefore(o, undecided);
      else sel.appendChild(o);
    });
  });
}

function escH(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

/* ── Squadron modal ── */
function openSquadronModal(id) {
  var overlay = document.getElementById('sqModalOverlay');
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  document.getElementById('sqFormError').style.display = 'none';
  if (id) {
    var sq = SQUADRONS.find(function(s){return s.id===id;});
    if (sq) {
      document.getElementById('sqModalTitle').textContent = '\u270E EDIT WING';
      document.getElementById('sqEditId').value = sq.id;
      document.getElementById('sqId').value = sq.id;
      document.getElementById('sqId').disabled = true;
      document.getElementById('sqDesignator').value = sq.designator;
      document.getElementById('sqName').value = sq.name;
      document.getElementById('sqAirframe').value = sq.airframe || '';
      document.getElementById('sqTags').value = (sq.tags||[]).join(', ');
      document.getElementById('sqShortDesc').value = sq.shortDesc || '';
      document.getElementById('sqFullDesc').value = sq.fullDesc || '';
    }
  } else {
    document.getElementById('sqModalTitle').textContent = '\u2295 ADD WING';
    document.getElementById('sqEditId').value = '';
    document.getElementById('sqId').disabled = false;
    document.getElementById('sqForm').reset();
  }
}
function closeSqModal() {
  document.getElementById('sqModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
}
function editSquadron(id) { openSquadronModal(id); }
function deleteSquadron(id) {
  if (!confirm('Delete this wing? This cannot be undone.')) return;
  fetch('/api/squadrons/' + id, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + (getToken()||'') }
  }).then(function(r){return r.json();}).then(function() {
    SQUADRONS = SQUADRONS.filter(function(s){return s.id!==id;});
    renderSquadrons(SQUADRONS);
    populateWingSelects(SQUADRONS);
  });
}
function submitSquadron(e) {
  e.preventDefault();
  var editId = document.getElementById('sqEditId').value;
  var data = {
    id:         document.getElementById('sqId').value.trim(),
    designator: document.getElementById('sqDesignator').value.trim(),
    name:       document.getElementById('sqName').value.trim(),
    airframe:   document.getElementById('sqAirframe').value.trim(),
    tags:       document.getElementById('sqTags').value.split(',').map(function(t){return t.trim();}).filter(Boolean),
    shortDesc:  document.getElementById('sqShortDesc').value.trim(),
    fullDesc:   document.getElementById('sqFullDesc').value.trim(),
  };
  if (!data.id || !data.designator || !data.name) {
    document.getElementById('sqFormError').textContent = 'ID, designator and name are required.';
    document.getElementById('sqFormError').style.display = '';
    return;
  }
  var url    = editId ? '/api/squadrons/' + editId : '/api/squadrons';
  var method = editId ? 'PUT' : 'POST';
  fetch(url, {
    method: method,
    headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+(getToken()||'') },
    body: JSON.stringify(data)
  }).then(function(r){return r.json().then(function(j){return {ok:r.ok,body:j};});})
  .then(function(res) {
    if (!res.ok) { document.getElementById('sqFormError').textContent = res.body.error; document.getElementById('sqFormError').style.display = ''; return; }
    if (editId) { var idx = SQUADRONS.findIndex(function(s){return s.id===editId;}); if (idx!==-1) SQUADRONS[idx]=res.body; }
    else SQUADRONS.push(res.body);
    renderSquadrons(SQUADRONS);
    populateWingSelects(SQUADRONS);
    closeSqModal();
  });
}
document.getElementById('sqModalOverlay').addEventListener('click', function(e) { if (e.target === this) closeSqModal(); });

/* ── Data-driven roster (sourced from Discord) ── */
var ROSTER = [];
(function() {
  fetch('/api/roster').then(function(r){return r.json();}).then(function(list) {
    ROSTER = list;
    renderRoster(list);
  }).catch(function() {
    document.getElementById('rosterBody').innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-3)">Unable to load roster.</td></tr>';
  });
})();

function renderRoster(list) {
  var tbody = document.getElementById('rosterBody');
  if (!list.length) {
    tbody.innerHTML = '<tr class="roster-open-row"><td colspan="3" class="roster-open-cell">PILOT SLOTS OPEN \u2014 <a href="#join">APPLY NOW \u2192</a></td></tr>';
    return;
  }
  var html = list.map(function(p) {
    return '<tr>' +
      '<td><span class="callsign">' + escH(p.callsign) + '</span></td>' +
      '<td>' + escH(p.squadron) + '</td>' +
      '<td>' + escH(p.role) + '</td>' +
    '</tr>';
  }).join('');
  html += '<tr class="roster-open-row"><td colspan="3" class="roster-open-cell">PILOT SLOTS OPEN \u2014 <a href="#join">APPLY NOW \u2192</a></td></tr>';
  tbody.innerHTML = html;
}
