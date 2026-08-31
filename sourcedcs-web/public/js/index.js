/* ── Apply external links from config ── */
(function() {
  function setLink(id, url) { var el = document.getElementById(id); if (el && url) el.href = url; }
  setLink('socialDiscordLink', typeof DISCORD_URL  !== 'undefined' ? DISCORD_URL  : null);
  setLink('toolWikiLink',     typeof WIKI_URL     !== 'undefined' ? WIKI_URL     : null);
  setLink('toolAtoLink',      typeof ATO_URL      !== 'undefined' ? ATO_URL      : null);
  setLink('toolOlympusLink',  typeof OLYMPUS_URL  !== 'undefined' ? OLYMPUS_URL  : null);
  setLink('footerDiscordLink', typeof DISCORD_URL  !== 'undefined' ? DISCORD_URL  : null);
  setLink('footerWikiLink',   typeof WIKI_URL     !== 'undefined' ? WIKI_URL     : null);
  setLink('footerAtoLink',    typeof ATO_URL      !== 'undefined' ? ATO_URL      : null);
  setLink('footerGithubLink', typeof GITHUB_URL   !== 'undefined' ? GITHUB_URL   : null);
})();

/* getToken, loginWithCasdoor, isAdminRole, getUser, logout, setTheme
   are provided by /js/auth.js */

(function() {
  var token = getToken();
  var user  = getUser();
  if (!token) return;
  var name = (user && user.name) ? user.name.toUpperCase() : 'USER';
  var btn = document.getElementById('loginBtn');
  if (btn) { btn.textContent = name + ' \u23FB'; btn.title = 'Click to log out'; btn.classList.add('login-btn--logout'); btn.onclick = logout; }
  /* Only show member portal and hub button if user has at least one role */
  if (!hasAnyRole(token)) return;
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
  if (isAdminRole(token)) {
    var adminCard = document.getElementById('toolSkillsAdminLink');
    if (adminCard) adminCard.style.display = '';
  }
  if (isSkillAdminRole(token)) {
    var wingAdminCard = document.getElementById('toolWingAdminLink');
    if (wingAdminCard) wingAdminCard.style.display = '';
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
function openApplyModal(squadron) {
  document.getElementById('applyModalOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  if (squadron) {
    document.getElementById('applyModalOverlay').dataset.pendingSquadron = squadron;
  } else {
    delete document.getElementById('applyModalOverlay').dataset.pendingSquadron;
  }
  var token = getToken();
  if (!token) {
    /* Not logged in — show account-creation prompt (step 1) */
    document.getElementById('applyStep1').style.display = '';
    document.getElementById('applyStep2').style.display = 'none';
  } else {
    /* Already logged in — skip straight to the application form (step 2) */
    document.getElementById('applyStep1').style.display = 'none';
    document.getElementById('applyStep2').style.display = '';
    if (squadron) {
      var sel = document.getElementById('fSquadron');
      if (sel) sel.value = squadron;
    }
    setTimeout(function() { document.getElementById('fCallsign').focus(); }, 30);
  }
}
/* Redirect to Casdoor signup, returning to this page with ?apply=1 so the
   application form opens automatically after the user has registered. */
function applyCreateAccount() {
  var overlay = document.getElementById('applyModalOverlay');
  var pendingSquadron = (overlay && overlay.dataset.pendingSquadron) || '';
  var qs = new URLSearchParams({ apply: '1' });
  if (pendingSquadron) qs.set('squadron', pendingSquadron);
  var returnUrl = window.location.origin + window.location.pathname + '?' + qs.toString();
  signupWithCasdoor(returnUrl);
}
function showApplyStep2() {
  document.getElementById('applyStep1').style.display = 'none';
  document.getElementById('applyStep2').style.display = '';
  var pendingSquadron = document.getElementById('applyModalOverlay').dataset.pendingSquadron;
  if (pendingSquadron) {
    var sel = document.getElementById('fSquadron');
    if (sel) sel.value = pendingSquadron;
  }
  setTimeout(function() { document.getElementById('fCallsign').focus(); }, 30);
}
function closeApplyModal() {
  document.getElementById('applyModalOverlay').style.display = 'none';
  document.body.style.overflow = '';
  document.getElementById('applyFormError').style.display   = 'none';
  document.getElementById('applyFormSuccess').style.display = 'none';
  document.getElementById('applyDiscordCta').style.display  = 'none';
  document.getElementById('applyFormActions').style.display = '';
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
  if (!form.subSquadron.value)         missing.push('preferred squadron');
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
    succEl.textContent = res.body.message || 'Application received!';
    succEl.style.display = '';
    if (res.body.discord) {
      var cta = document.getElementById('applyDiscordCta');
      cta.innerHTML = '';
      var dLink = document.createElement('a');
      dLink.href = res.body.discord;
      dLink.target = '_blank';
      dLink.rel = 'noopener';
      dLink.className = 'btn btn-primary apply-discord-btn';
      dLink.innerHTML = '<span class="btn-icon">&#x2295;</span> JOIN THE DISCORD SERVER';
      cta.appendChild(dLink);
      cta.style.display = '';
    }
    document.getElementById('applyFormActions').style.display = 'none';
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

/* ── Data-driven squadrons ── */
var SQUADRONS = [];
(function() {
  var grid = document.getElementById('subsqGrid');
  fetch('/api/squadrons').then(function(r){return r.json();}).then(function(sqs) {
    SQUADRONS = sqs;
    renderSquadrons(sqs);
    populateSquadronSelects(sqs);
    if (isAdmin) {
      document.getElementById('subsqAdminBar').style.display = '';
    }
    /* Re-render roster now that squadron names are available */
    if (ROSTER.length) renderRoster(ROSTER);
  }).catch(function() { grid.innerHTML = '<div class="ops-preview-empty">Unable to load squadrons.</div>'; });
})();

function renderSquadrons(sqs) {
  var grid = document.getElementById('subsqGrid');
  if (!sqs.length) { grid.innerHTML = '<div class="ops-preview-empty">No squadrons configured.</div>'; return; }
  grid.innerHTML = sqs.map(function(sq) {
    var tags = (sq.tags || []).map(function(t) { return '<span class="subsq-tag">' + escH(t) + '</span>'; }).join('');
    var logoHtml = sq.image ? '<img class="subsq-logo" src="' + escH(sq.image) + '" alt="" onerror="this.style.display=\'none\'">' : '';
    return '<div class="subsq-card">' +
      logoHtml +
      '<div class="subsq-designator">' + escH(sq.designator) + '</div>' +
      '<div class="subsq-name">' + escH(sq.name) + '</div>' +
      '<div class="subsq-airframe">' + escH(sq.airframe) + '</div>' +
      '<div class="subsq-role-tags">' + tags + '</div>' +
      '<p class="subsq-desc">' + escH(sq.shortDesc) + '</p>' +
      '<div class="subsq-card-actions">' +
        '<a class="btn btn-secondary subsq-apply-btn" href="squadron.html?id=' + encodeURIComponent(sq.id) + '">VIEW DETAILS &rarr;</a>' +
        '<button class="btn btn-secondary subsq-apply-btn" onclick="openApplyModal(\'' + escH(sq.id) + '\')">APPLY &rarr;</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function populateSquadronSelects(sqs) {
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

/* ── Data-driven roster (live from Discord via server cache) ── */
var ROSTER = [];
(function() {
  fetch('/api/roster').then(function(r){return r.json();}).then(function(list) {
    ROSTER = list;
    renderRoster(list);
    if (isAdmin) {
      document.getElementById('rosterAdminBar').style.display = '';
    }
  }).catch(function() {
    document.getElementById('rosterBody').innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-3)">Unable to load roster.</td></tr>';
  });
})();

function squadronDisplayName(id) {
  var sq = SQUADRONS.find(function(s) { return s.id === id; });
  return sq ? sq.designator + ' ' + sq.name : id;
}

/* ── Roster tab palette (cycles per squadron index) ── */
var ROSTER_COLORS = ['#1a3a6b','#1a5c2e','#7c5000','#9b1c1c','#4a2075','#1a5a5a'];

function roleColor(role) {
  var h = 0;
  for (var i = 0; i < (role||'').length; i++) h = (h * 31 + role.charCodeAt(i)) & 0x7fffffff;
  return ROSTER_COLORS[h % ROSTER_COLORS.length];
}

/* Roster is auto-sorted by role seniority, most senior first; roles not in
   this list sort last. Order is configured on the wing-admin page (see
   /api/role-sort-order) rather than hardcoded here. */
var ROSTER_ROLE_SORT_ORDER = [];
(function() {
  fetch('/api/role-sort-order').then(function(r){return r.json();}).then(function(order) {
    ROSTER_ROLE_SORT_ORDER = Array.isArray(order) ? order.map(function(r){return r.trim().toLowerCase();}) : [];
    /* Re-render roster now that the sort order is available */
    if (ROSTER.length) renderRoster(ROSTER);
  }).catch(function() {});
})();
function roleSortIndex(role) {
  var idx = ROSTER_ROLE_SORT_ORDER.indexOf((role || '').trim().toLowerCase());
  return idx === -1 ? ROSTER_ROLE_SORT_ORDER.length : idx;
}

var activeRosterTab = 'ALL';

function setRosterTab(tabId) {
  activeRosterTab = tabId;
  renderRoster(ROSTER);
}

function renderRoster(list) {
  /* Build ordered list of unique squadron IDs present in the roster */
  var sqIds = [];
  list.forEach(function(p) {
    if (p.squadron && sqIds.indexOf(p.squadron) === -1) sqIds.push(p.squadron);
  });

  /* Render tab strip */
  var tabsEl = document.getElementById('rosterTabs');
  if (tabsEl) {
    var tabsHtml = '<button class="roster-tab-btn' + (activeRosterTab === 'ALL' ? ' tab-active' : '') +
      '" onclick="setRosterTab(\'ALL\')">ALL (' + list.length + ')</button>';
    sqIds.forEach(function(id, i) {
      var color = ROSTER_COLORS[i % ROSTER_COLORS.length];
      var name  = squadronDisplayName(id);
      var count = list.filter(function(p) { return p.squadron === id; }).length;
      var isActive = activeRosterTab === id;
      tabsHtml += '<button class="roster-tab-btn' + (isActive ? ' tab-active' : '') +
        '" onclick="setRosterTab(\'' + escH(id) + '\')"' +
        ' style="--tab-color:' + color + '">' +
        escH(name) + ' (' + count + ')</button>';
    });
    tabsEl.innerHTML = tabsHtml;
  }

  /* Filter by active tab, then sort by role seniority */
  var filtered = activeRosterTab === 'ALL' ? list : list.filter(function(p) { return p.squadron === activeRosterTab; });
  filtered = filtered.slice().sort(function(a, b) {
    var d = roleSortIndex(a.role) - roleSortIndex(b.role);
    return d !== 0 ? d : (a.callsign || '').localeCompare(b.callsign || '');
  });

  var tbody = document.getElementById('rosterBody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr class="roster-open-row"><td colspan="3" class="roster-open-cell">PILOT SLOTS OPEN \u2014 <a href="#join">APPLY NOW \u2192</a></td></tr>';
    return;
  }
  var html = filtered.map(function(p) {
    var color = roleColor(p.role || '');
    var roleHtml = p.role
      ? '<span class="role-badge" style="color:' + color + ';border-color:' + color + '">' + escH(p.role) + '</span>'
      : '';
    return '<tr>' +
      '<td><span class="callsign">' + escH(p.callsign) + '</span></td>' +
      '<td>' + roleHtml + '</td>' +
      '<td>' + escH(squadronDisplayName(p.squadron)) + '</td>' +
    '</tr>';
  }).join('');
  html += '<tr class="roster-open-row"><td colspan="3" class="roster-open-cell">PILOT SLOTS OPEN \u2014 <a href="#join">APPLY NOW \u2192</a></td></tr>';
  tbody.innerHTML = html;
}

/* Admin: force-refresh the roster from Discord */
function refreshRoster() {
  fetch('/api/roster/refresh', {
    method: 'POST',
    headers: authHeaders()
  }).then(function(r){return r.json();}).then(function() {
    return fetch('/api/roster').then(function(r){return r.json();});
  }).then(function(list) {
    ROSTER = list;
    renderRoster(list);
  }).catch(function() {
    alert('Failed to refresh roster.');
  });
}

/* ── Auto-open apply form when ?apply=1 is in the URL ── */
/* When the user returns from Casdoor registration with ?apply=1 in the URL,
   or arrives from the squadron detail page, open the application form. */
(function() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('apply') === '1') {
    var squadron = params.get('squadron') || '';
    /* Clean the URL so a page refresh doesn't reopen the modal */
    history.replaceState(null, '', window.location.pathname + window.location.hash);
    openApplyModal(squadron || undefined);
  }
})();

/* ── Hero gallery preview — pick two random shots from the gallery ── */
(function() {
  var img1 = document.getElementById('heroGalleryImg1');
  var img2 = document.getElementById('heroGalleryImg2');
  var cap1 = document.getElementById('heroGalleryCaption1');
  var cap2 = document.getElementById('heroGalleryCaption2');
  if (!img1 || !img2) return;

  fetch('/api/gallery')
    .then(function(r) { return r.json(); })
    .then(function(shots) {
      if (!Array.isArray(shots) || shots.length === 0) return;
      /* Fisher-Yates shuffle then pick first two */
      var arr = shots.slice();
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      var pick1 = arr[0];
      var pick2 = arr.length > 1 ? arr[1] : arr[0];
      img1.src = pick1.src || '';
      img1.alt = pick1.alt || '';
      if (cap1) cap1.textContent = pick1.caption || '';
      img2.src = pick2.src || '';
      img2.alt = pick2.alt || '';
      if (cap2) cap2.textContent = pick2.caption || '';
    })
    .catch(function(err) { console.warn('[hero-gallery] Failed to load gallery:', err.message); });
})();
