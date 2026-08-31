/* ── Apply external links from config ── */
(function() {
  function setLink(id, url) { var el = document.getElementById(id); if (el && url) el.href = url; }
  setLink('footerDiscordLink', typeof DISCORD_URL !== 'undefined' ? DISCORD_URL : null);
  setLink('footerWikiLink',   typeof WIKI_URL    !== 'undefined' ? WIKI_URL    : null);
  setLink('footerGithubLink', typeof GITHUB_URL  !== 'undefined' ? GITHUB_URL  : null);
})();

/* getToken, loginWithCasdoor, getUser, logout, setTheme are provided by /js/auth.js */
(function() {
  var token = getToken();
  var user = getUser();
  if (!token) return;
  var name = (user && user.name) ? user.name.toUpperCase() : 'USER';
  var btn = document.getElementById('loginBtn');
  if (btn) {
    btn.textContent = name + ' ⏻';
    btn.title = 'Click to log out';
    btn.classList.add('login-btn--logout');
    btn.onclick = logout;
  }
})();

/* ── Hamburger menu ── */
(function() {
  var hamburger = document.getElementById('hamburgerBtn');
  var nav       = document.getElementById('mainNav');
  if (!hamburger || !nav) return;
  function closeNav() { nav.classList.remove('nav-open'); hamburger.classList.remove('open'); hamburger.setAttribute('aria-expanded','false'); }
  hamburger.addEventListener('click', function() {
    var open = nav.classList.toggle('nav-open');
    hamburger.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.querySelectorAll('.nav-link').forEach(function(link) { link.addEventListener('click', closeNav); });
})();

function escH(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

/* Shared role→color palette (kept in sync with index.js ROSTER_COLORS) */
var ROSTER_COLORS = ['#1a3a6b','#1a5c2e','#7c5000','#9b1c1c','#4a2075','#1a5a5a'];
function roleColor(role) {
  var h = 0;
  for (var i = 0; i < (role||'').length; i++) h = (h * 31 + role.charCodeAt(i)) & 0x7fffffff;
  return ROSTER_COLORS[h % ROSTER_COLORS.length];
}

/* ── Load squadron data ── */
(function() {
  var params = new URLSearchParams(window.location.search);
  var squadronId = params.get('id');
  if (!squadronId) { document.getElementById('squadronHero').innerHTML = '<div style="color:var(--red)">No squadron ID specified. <a href="/#subsquadrons" style="color:var(--text);text-decoration:underline">Back to squadrons</a></div>'; return; }

  Promise.all([
    fetch('/api/squadrons/' + encodeURIComponent(squadronId)).then(function(r){return r.ok ? r.json() : null;}),
    fetch('/api/roster').then(function(r){return r.json();})
  ]).then(function(results) {
    var sq = results[0];
    var roster = results[1];
    if (!sq) {
      document.getElementById('squadronHero').innerHTML = '<div style="color:var(--red)">Squadron not found. <a href="/#subsquadrons" style="color:var(--text);text-decoration:underline">Back to squadrons</a></div>';
      return;
    }

    document.title = sq.designator + ' ' + sq.name + ' — SOURCE DCS';

    /* Hero */
    var tags = (sq.tags || []).map(function(t){return '<span class="subsq-tag">'+escH(t)+'</span>';}).join('');
    var logoHtml = sq.image ? '<img class="squadron-hero-logo" src="' + escH(sq.image) + '" alt="" onerror="this.style.display=\'none\'">' : '';
    document.getElementById('squadronHero').innerHTML =
      logoHtml +
      '<div class="subsq-designator" style="font-size:clamp(36px,8vw,72px);margin-bottom:8px">' + escH(sq.designator) + '</div>' +
      '<div class="subsq-name" style="font-size:clamp(14px,3vw,20px);margin-bottom:4px">' + escH(sq.name) + '</div>' +
      '<div class="subsq-airframe" style="margin-bottom:12px">' + escH(sq.airframe) + '</div>' +
      '<div class="subsq-role-tags" style="justify-content:center">' + tags + '</div>' +
      '<div style="margin-top:24px"><a class="btn btn-primary" href="https://sourcedcs.page/#join"><span class="btn-icon">&#x2295;</span> APPLY TO ' + escH(sq.designator) + '</a></div>';

    /* Detail */
    document.getElementById('squadronDetail').innerHTML =
      '<p class="section-desc" style="margin-bottom:16px">' + escH(sq.fullDesc || sq.shortDesc) + '</p>' +
      '<a class="btn btn-secondary" href="/#subsquadrons">&larr; ALL SQUADRONS</a>';

    /* Squadron roster */
    var squadronPilots = roster.filter(function(p) { return p.squadron === sq.id; });
    var tbody = document.getElementById('squadronRosterBody');
    if (!squadronPilots.length) {
      tbody.innerHTML = '<tr class="roster-open-row"><td colspan="2" class="roster-open-cell">NO PILOTS ASSIGNED YET — <a href="/#join">APPLY NOW →</a></td></tr>';
    } else {
      tbody.innerHTML = squadronPilots.map(function(p) {
        var c = roleColor(p.role || '');
        var roleHtml = p.role ? '<span class="role-badge" style="color:' + c + ';border-color:' + c + '">' + escH(p.role) + '</span>' : '';
        return '<tr><td><span class="callsign">' + escH(p.callsign) + '</span></td><td>' + roleHtml + '</td></tr>';
      }).join('') + '<tr class="roster-open-row"><td colspan="2" class="roster-open-cell">PILOT SLOTS OPEN — <a href="/#join">APPLY NOW →</a></td></tr>';
    }
  }).catch(function() {
    document.getElementById('squadronHero').innerHTML = '<div style="color:var(--red)">Error loading squadron data.</div>';
  });
})();
