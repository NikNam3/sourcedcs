/* ════════════════════════════════════════════════════════════
   form1801.js — DD Form 1801 (ICAO IFR International Flight Plan)
   Depends on: /js/config.js, /js/auth.js
════════════════════════════════════════════════════════════ */

/* ── External links ── */
(function() {
  function setLink(id, url) { var el = document.getElementById(id); if (el && url) el.href = url; }
  setLink('footerDiscordLink', typeof DISCORD_URL !== 'undefined' ? DISCORD_URL : null);
  setLink('footerWikiLink',   typeof WIKI_URL    !== 'undefined' ? WIKI_URL    : null);
  setLink('footerGithubLink', typeof GITHUB_URL  !== 'undefined' ? GITHUB_URL  : null);
})();

/* getToken, loginWithCasdoor, isAdminRole, getUser, logout, esc, setTheme
   provided by /js/auth.js */

/* ── State ── */
var fpl1801ControllerSquadron = '';
var fpl1801AvailableSquadrons = [];
var fpl1801UserIsController   = false;
var fpl1801NotifyChannelId    = '';
var fpl1801AllPlans           = [];
var currentToken = getToken();

/* ════════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════════ */
(function() {
  var user = getUser();
  var btn  = document.getElementById('loginBtn');
  if (btn) {
    if (user && currentToken) {
      btn.textContent = (user.name || 'USER').toUpperCase() + ' \u23FB';
      btn.title       = 'Click to log out';
      btn.classList.add('login-btn--logout');
      btn.onclick = logout;
    }
  }

  if (!currentToken) {
    document.getElementById('fpLoginPrompt').style.display = '';
  } else {
    document.getElementById('fpMain').style.display = '';
    fpl1801AutofillDof();
    fpl1801AttachLivePreview();
    fpl1801UpdatePreview();
    fpl1801LoadConfig();
  }
})();

/* ── Hamburger ── */
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

/* ════════════════════════════════════════════════════════════
   DOF AUTOFILL
════════════════════════════════════════════════════════════ */
function fpl1801AutofillDof() {
  var el = document.getElementById('fpl18');
  if (!el) return;
  var now = new Date();
  var yy  = String(now.getUTCFullYear()).slice(2);
  var mm  = String(now.getUTCMonth() + 1).padStart(2, '0');
  var dd  = String(now.getUTCDate()).padStart(2, '0');
  el.value = el.value.replace('YY-MM-DD', yy + mm + dd);
}

/* ════════════════════════════════════════════════════════════
   FPL MESSAGE BUILDER
════════════════════════════════════════════════════════════ */
function fplVal(id) {
  var el = document.getElementById(id);
  return el ? (el.value || '') : '';
}

function fpl1801BuildMessage() {
  var f7    = fplVal('fpl7').toUpperCase().trim();
  var f8a   = fplVal('fpl8a') || 'I';
  var f8b   = fplVal('fpl8b') || 'M';
  var f9n   = fplVal('fpl9n').trim() || '1';
  var f9t   = fplVal('fpl9t').toUpperCase().trim();
  var f9w   = fplVal('fpl9w') || 'M';
  var f10a  = fplVal('fpl10a').toUpperCase().trim();
  var f10b  = fplVal('fpl10b').toUpperCase().trim();
  var f13a  = fplVal('fpl13a').toUpperCase().trim();
  var f13b  = fplVal('fpl13b').trim();
  var f15su = fplVal('fpl15su') || 'N';
  var f15sv = fplVal('fpl15sv').trim();
  var f15lu = fplVal('fpl15lu') || 'F';
  var f15lv = fplVal('fpl15lv').trim();
  var f15r  = fplVal('fpl15r').toUpperCase().trim();
  var f16a  = fplVal('fpl16a').toUpperCase().trim();
  var f16e  = fplVal('fpl16e').trim() || '0000';
  var f16alt1 = fplVal('fpl16alt1').toUpperCase().trim();
  var f16alt2 = fplVal('fpl16alt2').toUpperCase().trim();
  var f18   = fplVal('fpl18').toUpperCase().trim() || '0';
  var f19e  = fplVal('fpl19e').trim() || '0000';
  var f19p  = fplVal('fpl19p').trim() || '0';
  var f19c  = fplVal('fpl19c').toUpperCase().trim();

  /* Speed: Mach = unit + 3 digits; K/N = unit + 4 digits */
  var speedStr;
  if (f15su === 'M') {
    speedStr = 'M' + (f15sv || '000').padStart(3, '0');
  } else {
    speedStr = f15su + (f15sv || '0000').padStart(4, '0');
  }

  /* Level: unit + 3 digits */
  var levelStr = f15lu + (f15lv || '000').padStart(3, '0');

  /* Field 16 inline: dest + EET [+ altn1 [+ altn2]] */
  var field16 = f16a + f16e;
  if (f16alt1) field16 += ' ' + f16alt1;
  if (f16alt2) field16 += ' ' + f16alt2;

  return [
    '(FPL-' + f7 + '-' + f8a + f8b,
    '-' + f9n + '/' + f9t + '/' + f9w + '-' + (f10a || 'N') + '/' + (f10b || 'N'),
    '-' + f13a + f13b,
    '-' + speedStr + levelStr + ' ' + f15r,
    '-' + field16,
    '-' + f18,
    '-E/' + f19e + ' -P/' + f19p + ' -C/' + f19c + ')',
  ].join('\n');
}

function fpl1801UpdatePreview() {
  var pre = document.getElementById('fplPreview');
  if (!pre) return;
  pre.textContent = fpl1801BuildMessage();
}

function fpl1801AttachLivePreview() {
  var section = document.getElementById('fpl1801FormSection');
  if (!section) return;
  section.addEventListener('input',  fpl1801UpdatePreview);
  section.addEventListener('change', fpl1801UpdatePreview);

  /* Update speed/level placeholders and maxlength when unit changes */
  var speedUnitSel = document.getElementById('fpl15su');
  var levelUnitSel = document.getElementById('fpl15lu');
  if (speedUnitSel) speedUnitSel.addEventListener('change', fpl1801UpdateSpeedHint);
  if (levelUnitSel) levelUnitSel.addEventListener('change', fpl1801UpdateLevelHint);
}

function fpl1801UpdateSpeedHint() {
  var unit = fplVal('fpl15su');
  var inp  = document.getElementById('fpl15sv');
  if (!inp) return;
  if (unit === 'M') {
    inp.placeholder = '082';
    inp.maxLength   = 3;
  } else {
    inp.placeholder = '0450';
    inp.maxLength   = 4;
  }
}

function fpl1801UpdateLevelHint() {
  var unit = fplVal('fpl15lu');
  var inp  = document.getElementById('fpl15lv');
  if (!inp) return;
  var hints = { F: '350', A: '080', S: '1130', M: '0820' };
  var lens  = { F: 3, A: 3, S: 4, M: 4 };
  inp.placeholder = hints[unit] || '350';
  inp.maxLength   = lens[unit]  || 3;
}

/* ════════════════════════════════════════════════════════════
   SQUADRON CONFIG (reuses /api/flight-plans/config)
════════════════════════════════════════════════════════════ */
function fpl1801LoadConfig() {
  fetch('/api/flight-plans/config', {
    headers: currentToken ? authHeaders(currentToken) : {},
  })
  .then(function(r) { return r.json(); })
  .then(function(cfg) {
    fpl1801ControllerSquadron = cfg.controllerSquadron || '';
    fpl1801AvailableSquadrons = cfg.availableSquadrons || [];
    fpl1801UserIsController   = Boolean(cfg.isController);
    fpl1801NotifyChannelId    = cfg.notifyChannelId    || '';
    fpl1801RenderAdminPanel();
    fpl1801LoadPlans();
  })
  .catch(function() {
    fpl1801LoadPlans();
  });
}

function fpl1801RenderAdminPanel() {
  var panel = document.getElementById('fpl1801AdminPanel');
  if (!panel) return;

  var isAdm = isAdminRole(currentToken);
  if (!isAdm) { panel.style.display = 'none'; return; }

  panel.style.display = '';

  var opts = ['<option value="">— NONE (ADMIN ONLY) —</option>'];
  fpl1801AvailableSquadrons.forEach(function(sq) {
    opts.push('<option value="' + esc(sq) + '"' + (sq === fpl1801ControllerSquadron ? ' selected' : '') + '>' + esc(sq) + '</option>');
  });
  if (!fpl1801AvailableSquadrons.length) {
    opts.push('<option value="" disabled>No squadrons configured in discord-roles.json</option>');
  }

  panel.innerHTML =
    '<div class="fp-admin-label">ADMIN — FLIGHT PLAN SETTINGS</div>' +
    '<div class="fp-admin-body">' +
      '<div class="fp-admin-desc">Configure which squadron can view all submitted flight plans and which Discord channel receives notifications.</div>' +
      '<div class="fp-admin-row">' +
        '<div class="fp-field" style="flex:2;min-width:200px">' +
          '<label class="fp-label" for="fpl1801CtrlSqSelect">CONTROLLER SQUADRON</label>' +
          '<select class="fp-input" id="fpl1801CtrlSqSelect">' + opts.join('') + '</select>' +
        '</div>' +
        '<div class="fp-field" style="flex:1;min-width:160px">' +
          '<label class="fp-label" for="fpl1801NotifyChannel">DISCORD NOTIFY CHANNEL ID</label>' +
          '<input class="fp-input" id="fpl1801NotifyChannel" type="text" maxlength="32" placeholder="000000000000000000" autocomplete="off" value="' + esc(fpl1801NotifyChannelId) + '">' +
        '</div>' +
        '<div style="align-self:flex-end">' +
          '<button class="btn btn-primary" style="font-size:9px;padding:6px 16px" onclick="fpl1801SaveConfig()">SAVE</button>' +
        '</div>' +
      '</div>' +
      '<div class="fp-msg fp-error"   id="fpl1801AdminError"   style="display:none;margin-top:8px"></div>' +
      '<div class="fp-msg fp-success" id="fpl1801AdminSuccess" style="display:none;margin-top:8px"></div>' +
    '</div>';
}

function fpl1801SaveConfig() {
  var sel   = document.getElementById('fpl1801CtrlSqSelect');
  var chEl  = document.getElementById('fpl1801NotifyChannel');
  var errEl = document.getElementById('fpl1801AdminError');
  var okEl  = document.getElementById('fpl1801AdminSuccess');
  if (!sel) return;
  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  fetch('/api/flight-plans/config', {
    method:  'PUT',
    headers: authHeaders(currentToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      controllerSquadron: sel.value,
      notifyChannelId:    chEl ? chEl.value.trim() : '',
    }),
  })
  .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
  .then(function(res) {
    if (!res.ok) {
      errEl.textContent   = res.body.error || 'Save failed.';
      errEl.style.display = '';
      return;
    }
    fpl1801ControllerSquadron = res.body.controllerSquadron || '';
    fpl1801NotifyChannelId    = res.body.notifyChannelId    || '';
    okEl.textContent   = 'Config saved.';
    okEl.style.display = '';
  })
  .catch(function() {
    errEl.textContent   = 'Network error — please try again.';
    errEl.style.display = '';
  });
}

/* ════════════════════════════════════════════════════════════
   COLLECT + VALIDATE
════════════════════════════════════════════════════════════ */
/* Parse HHMM string to total minutes; returns NaN if invalid */
function fpl1801ParseHHMM(s) {
  if (!s || !/^\d{3,4}$/.test(s.replace(/[^0-9]/g, ''))) return NaN;
  var clean = s.replace(/[^0-9]/g, '').padStart(4, '0');
  return parseInt(clean.slice(0, -2), 10) * 60 + parseInt(clean.slice(-2), 10);
}

function fpl1801Collect() {
  var errors = [];

  var f7    = fplVal('fpl7').trim().toUpperCase();
  var f8a   = fplVal('fpl8a') || 'I';
  var f8b   = fplVal('fpl8b') || 'M';
  var f9n   = parseInt(fplVal('fpl9n').trim(), 10) || 1;
  var f9t   = fplVal('fpl9t').trim().toUpperCase();
  var f9w   = fplVal('fpl9w') || 'M';
  var f10a  = fplVal('fpl10a').trim().toUpperCase();
  var f10b  = fplVal('fpl10b').trim().toUpperCase();
  var f13a  = fplVal('fpl13a').trim().toUpperCase();
  var f13b  = fplVal('fpl13b').trim();
  var f15su = fplVal('fpl15su') || 'N';
  var f15sv = fplVal('fpl15sv').trim();
  var f15lu = fplVal('fpl15lu') || 'F';
  var f15lv = fplVal('fpl15lv').trim();
  var f15r  = fplVal('fpl15r').trim().toUpperCase();
  var f16a  = fplVal('fpl16a').trim().toUpperCase();
  var f16e  = fplVal('fpl16e').trim() || '0000';
  var f16alt1 = fplVal('fpl16alt1').trim().toUpperCase();
  var f16alt2 = fplVal('fpl16alt2').trim().toUpperCase();
  var f18   = fplVal('fpl18').trim().toUpperCase() || '0';
  var f19e  = fplVal('fpl19e').trim();
  var f19p  = fplVal('fpl19p').trim() || '0';
  var f19c  = fplVal('fpl19c').trim().toUpperCase();

  if (!f7)    errors.push('Field 7 (Aircraft Identification) is required.');
  if (!f9t)   errors.push('Field 9 (Type of Aircraft) is required.');
  if (!f10a)  errors.push('Field 10 (Equipment) is required. Use N for nil.');
  if (!f10b)  errors.push('Field 10 (Transponder) is required. Use N for nil.');
  if (!f13a)  errors.push('Field 13 (Departure Aerodrome) is required.');
  if (!f13b)  errors.push('Field 13 (Departure Time) is required.');
  if (!f15sv) errors.push('Field 15 (Cruising Speed value) is required.');
  if (!f15lv) errors.push('Field 15 (Level value) is required.');
  if (!f15r)  errors.push('Field 15 (Route) is required — use DCT for direct.');
  if (!f16a)  errors.push('Field 16 (Destination Aerodrome) is required.');
  if (!f19c)  errors.push('Supplementary Field 19 (Pilot in Command) is required.');

  /* EET must not exceed fuel endurance */
  var eetMins = fpl1801ParseHHMM(f16e);
  var endMins = fpl1801ParseHHMM(f19e);
  if (!isNaN(eetMins) && !isNaN(endMins) && eetMins > endMins) {
    errors.push('Total EET (' + f16e + ') exceeds fuel endurance (' + f19e + ') — check Fields 16 and 19.');
  }

  var data = {
    aircraftId:    f7,
    flightRules:   f8a,
    typeOfFlight:  f8b,
    numAircraft:   Math.max(1, Math.min(99, f9n)),
    aircraftType:  f9t,
    wtc:           f9w,
    equipment:     f10a,
    transponder:   f10b,
    depAerodrome:  f13a,
    depTime:       f13b,
    speedUnit:     f15su,
    speedValue:    f15sv,
    levelUnit:     f15lu,
    levelValue:    f15lv,
    route:         f15r,
    destAerodrome: f16a,
    eet:           f16e,
    altn1:         f16alt1,
    altn2:         f16alt2,
    otherInfo:     f18,
    endurance:     f19e || '0000',
    pob:           f19p,
    pic:           f19c,
    fplMessage:    fpl1801BuildMessage(),
  };

  return { data: data, errors: errors };
}

/* ════════════════════════════════════════════════════════════
   SUBMIT
════════════════════════════════════════════════════════════ */
function fpl1801Submit() {
  var errEl = document.getElementById('fpl1801Error');
  var okEl  = document.getElementById('fpl1801Success');
  var btn   = document.getElementById('fpl1801SubmitBtn');

  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  var result = fpl1801Collect();
  if (result.errors.length) {
    errEl.textContent   = result.errors.join(' ');
    errEl.style.display = '';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'SUBMITTING...';

  fetch('/api/fpl1801', {
    method:  'POST',
    headers: authHeaders(currentToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(result.data),
  })
  .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
  .then(function(res) {
    btn.disabled    = false;
    btn.textContent = 'SUBMIT FLIGHT PLAN';
    if (!res.ok) {
      errEl.textContent   = res.body.error || 'Submission failed.';
      errEl.style.display = '';
      return;
    }
    okEl.textContent   = 'Flight plan FPL-' + res.body.id + ' submitted successfully.';
    okEl.style.display = '';
    fpl1801LoadPlans();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  })
  .catch(function() {
    btn.disabled    = false;
    btn.textContent = 'SUBMIT FLIGHT PLAN';
    errEl.textContent   = 'Network error — please try again.';
    errEl.style.display = '';
  });
}

/* ════════════════════════════════════════════════════════════
   LOAD & RENDER PLANS
════════════════════════════════════════════════════════════ */
function fpl1801LoadPlans() {
  fetch('/api/fpl1801', {
    headers: authHeaders(currentToken),
  })
  .then(function(r) { return r.json(); })
  .then(function(plans) {
    fpl1801AllPlans = Array.isArray(plans) ? plans : [];
    fpl1801RenderPlans();
  })
  .catch(function() {});
}

function fpl1801RenderPlans() {
  var el = document.getElementById('fpl1801PlansList');
  if (!el) return;

  var lbl = document.getElementById('fpl1801PlansLabel');
  if (lbl) {
    var isAdm = isAdminRole(currentToken);
    lbl.textContent = (isAdm || fpl1801UserIsController)
      ? 'ALL SUBMITTED FLIGHT PLANS'
      : 'YOUR SUBMITTED FLIGHT PLANS';
  }

  if (!fpl1801AllPlans.length) {
    el.innerHTML = '<div class="fp-plans-empty">No flight plans submitted yet.</div>';
    return;
  }

  var sorted = fpl1801AllPlans.slice().sort(function(a, b) {
    return new Date(b.submittedAt) - new Date(a.submittedAt);
  });

  el.innerHTML = sorted.map(function(p) {
    var route   = esc(p.depAerodrome || '----') + ' &rarr; ' + esc(p.destAerodrome || '----');
    var status  = p.status || 'submitted';
    var dt      = p.submittedAt ? new Date(p.submittedAt) : null;
    var dateStr = dt ? dt.toISOString().slice(0, 10) : '&mdash;';
    var byStr   = (p.submittedBy && p.submittedBy.name) ? ' &middot; ' + esc(p.submittedBy.name) : '';
    var speed   = (p.speedUnit || '') + (p.speedValue || '') + (p.levelUnit || '') + (p.levelValue || '');
    return '<div class="fp-plan-card" onclick="fpl1801OpenPlan(' + p.id + ')">' +
      '<div class="fp-plan-meta">' +
        '<div class="fp-plan-id">FPL-' + p.id + ' &middot; ' + dateStr + 'Z' + byStr + '</div>' +
        '<div class="fp-plan-callsign">' + esc(p.aircraftId || '&mdash;') + '</div>' +
        '<div class="fp-plan-route">' + route + (speed ? ' &middot; ' + esc(speed) : '') + '</div>' +
      '</div>' +
      '<span class="fp-plan-status fp-plan-status--' + esc(status) + '">' + esc(status.toUpperCase()) + '</span>' +
    '</div>';
  }).join('');
}

/* ════════════════════════════════════════════════════════════
   PLAN DETAIL OVERLAY
════════════════════════════════════════════════════════════ */
function fpl1801OpenPlan(id) {
  var plan = fpl1801AllPlans.find(function(p) { return p.id === id; });
  if (!plan) return;
  fpl1801ShowDetailOverlay(plan);
}

function fpl1801ShowDetailOverlay(plan) {
  var overlay = document.createElement('div');
  overlay.className = 'fp-detail-overlay';
  overlay.id = 'fpl1801DetailOverlay';

  var user      = getUser();
  var isOwner   = user && plan.submittedBy && plan.submittedBy.sub === user.sub;
  var canDelete = isAdminRole(currentToken) || fpl1801UserIsController || isOwner;
  overlay.innerHTML =
    '<div class="fp-detail-box">' +
      '<div class="fp-detail-header">' +
        '<div class="fp-detail-title">FPL-' + plan.id + ' &mdash; ' + esc(plan.aircraftId || '&mdash;') + '</div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<button class="btn btn-ghost" style="font-size:9px;padding:4px 10px" onclick="fpl1801PrintPlan(' + plan.id + ')">PRINT</button>' +
          (canDelete ? '<button class="btn btn-ghost fp-delete-btn" style="font-size:9px;padding:4px 10px" onclick="fpl1801DeletePlan(' + plan.id + ')">DELETE</button>' : '') +
          '<button class="fp-detail-close" onclick="fpl1801CloseDetail()">&times;</button>' +
        '</div>' +
      '</div>' +
      '<div class="fp-detail-body">' +
        fpl1801BuildDetailHTML(plan) +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) fpl1801CloseDetail();
  });
}

function fpl1801CloseDetail() {
  var el = document.getElementById('fpl1801DetailOverlay');
  if (el) el.remove();
}

function fpl1801DeletePlan(id) {
  if (!confirm('Delete flight plan FPL-' + id + '? This cannot be undone.')) return;

  fetch('/api/fpl1801/' + id, {
    method:  'DELETE',
    headers: authHeaders(currentToken),
  })
  .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
  .then(function(res) {
    if (!res.ok) { alert(res.body.error || 'Delete failed.'); return; }
    fpl1801AllPlans = fpl1801AllPlans.filter(function(p) { return p.id !== id; });
    fpl1801CloseDetail();
    fpl1801RenderPlans();
  })
  .catch(function() { alert('Network error — please try again.'); });
}

function fpl1801BuildDetailHTML(plan) {
  var html = '';

  /* Raw FPL message */
  var msg = plan.fplMessage || fpl1801BuildMessageFromPlan(plan);
  html +=
    '<div class="fp-detail-section">' +
    '<div class="fp-detail-section-label">FPL MESSAGE</div>' +
    '<pre class="fpl-msg-pre fpl-msg-pre--detail">' + esc(msg) + '</pre>' +
    '</div>';

  /* Flight details */
  html +=
    '<div class="fp-detail-section">' +
    '<div class="fp-detail-section-label">FLIGHT DETAILS</div>' +
    '<div class="fp-detail-grid">' +
      fpl1801DvField('7 — AIRCRAFT ID', plan.aircraftId) +
      fpl1801DvField('8 — RULES / TYPE', (plan.flightRules || '') + ' / ' + (plan.typeOfFlight || '')) +
      fpl1801DvField('9 — NUM / TYPE / WTC', (plan.numAircraft || 1) + ' / ' + (plan.aircraftType || '') + ' / ' + (plan.wtc || '')) +
      fpl1801DvField('10 — EQPT / XPDR', (plan.equipment || '') + ' / ' + (plan.transponder || '')) +
      fpl1801DvField('13 — DEPARTURE / TIME', (plan.depAerodrome || '') + ' &nbsp; ' + (plan.depTime || '') + 'Z') +
      fpl1801DvField('15 — SPEED / LEVEL', (plan.speedUnit || '') + (plan.speedValue || '') + ' &nbsp; ' + (plan.levelUnit || '') + (plan.levelValue || '')) +
      fpl1801DvField('16 — DESTINATION / EET', (plan.destAerodrome || '') + ' &nbsp; ' + (plan.eet || '')) +
      fpl1801DvField('16 — ALTN / 2ND ALTN', (plan.altn1 || '&mdash;') + ' &nbsp; ' + (plan.altn2 || '&mdash;')) +
    '</div>';

  if (plan.route) {
    html += '<div class="fp-dv-field" style="margin-top:8px">' +
      '<div class="fp-dv-label">15 — ROUTE</div>' +
      '<div class="fp-dv-val" style="white-space:pre-wrap;font-size:11px">' + esc(plan.route) + '</div></div>';
  }

  if (plan.otherInfo && plan.otherInfo !== '0') {
    html += '<div class="fp-dv-field" style="margin-top:8px">' +
      '<div class="fp-dv-label">18 — OTHER INFORMATION</div>' +
      '<div class="fp-dv-val" style="white-space:pre-wrap">' + esc(plan.otherInfo) + '</div></div>';
  }

  html += '</div>';

  /* Supplementary */
  html +=
    '<div class="fp-detail-section">' +
    '<div class="fp-detail-section-label">SUPPLEMENTARY — FIELD 19</div>' +
    '<div class="fp-detail-grid">' +
      fpl1801DvField('E/ &mdash; ENDURANCE', plan.endurance) +
      fpl1801DvField('P/ &mdash; PEOPLE ON BOARD', plan.pob) +
      fpl1801DvField('C/ &mdash; PILOT IN COMMAND', plan.pic) +
    '</div></div>';

  /* DoD flags — only show if at least one is set */
  if (plan.worldTour || plan.liveStreaming) {
    html +=
      '<div class="fp-detail-section">' +
      '<div class="fp-detail-section-label">DOD FLAGS</div>' +
      '<div class="fp-detail-grid">' +
        fpl1801DvField('WORLD TOUR',     plan.worldTour    ? '&#x2713; YES' : '&#x25A1; NO') +
        fpl1801DvField('LIVE STREAMING', plan.liveStreaming ? '&#x2713; YES' : '&#x25A1; NO') +
      '</div></div>';
  }

  return html;
}

function fpl1801DvField(label, value) {
  return '<div class="fp-dv-field">' +
    '<div class="fp-dv-label">' + label + '</div>' +
    '<div class="fp-dv-val">'   + (value || '&mdash;') + '</div>' +
  '</div>';
}

/* ════════════════════════════════════════════════════════════
   PRINT
════════════════════════════════════════════════════════════ */
function fpl1801Print() {
  var result = fpl1801Collect();
  var plan   = Object.assign({ id: 'DRAFT', submittedAt: new Date().toISOString(), status: 'draft' }, result.data);
  fpl1801RenderPrintView(plan);
  window.print();
}

function fpl1801PrintPlan(id) {
  var plan = fpl1801AllPlans.find(function(p) { return p.id === id; });
  if (!plan) return;
  fpl1801CloseDetail();
  fpl1801RenderPrintView(plan);
  window.print();
}

function fpl1801RenderPrintView(plan) {
  var el = document.getElementById('fpl1801PrintView');
  if (el) el.innerHTML = fpl1801BuildPrintHTML(plan);
}

function fpl1801BuildMessageFromPlan(plan) {
  var f9n    = String(plan.numAircraft || 1);
  var speedStr = plan.speedUnit === 'M'
    ? 'M' + String(plan.speedValue || '000').padStart(3, '0')
    : (plan.speedUnit || 'N') + String(plan.speedValue || '0000').padStart(4, '0');
  var levelStr = (plan.levelUnit || 'F') + String(plan.levelValue || '000').padStart(3, '0');
  var field16  = (plan.destAerodrome || '') + (plan.eet || '0000');
  if (plan.altn1) field16 += ' ' + plan.altn1;
  if (plan.altn2) field16 += ' ' + plan.altn2;

  return [
    '(FPL-' + (plan.aircraftId || '') + '-' + (plan.flightRules || 'I') + (plan.typeOfFlight || 'M'),
    '-' + f9n + '/' + (plan.aircraftType || '') + '/' + (plan.wtc || 'M') + '-' + (plan.equipment || 'N') + '/' + (plan.transponder || 'N'),
    '-' + (plan.depAerodrome || 'ZZZZ') + (plan.depTime || '0000'),
    '-' + speedStr + levelStr + ' ' + (plan.route || 'DCT'),
    '-' + field16,
    '-' + ((plan.otherInfo && plan.otherInfo !== '') ? plan.otherInfo : '0'),
    '-E/' + (plan.endurance || '0000') + ' -P/' + (plan.pob || '0') + ' -C/' + (plan.pic || '') + ')',
  ].join('\n');
}

function fpl1801BuildPrintHTML(plan) {
  var msg = plan.fplMessage || fpl1801BuildMessageFromPlan(plan);
  return (
    '<div class="fpl1801-print">' +
    '<div class="fpl1801-print-form">' +

      '<div class="fpl1801-print-title-row">DD FORM 1801 &mdash; DOD INTERNATIONAL FLIGHT PLAN</div>' +
      '<div class="fpl1801-print-sub-row">ICAO DOC 4444 FORMAT &nbsp;&middot;&nbsp; ALL TIMES UTC (ZULU) &nbsp;&middot;&nbsp; REF: FPL-' + esc(String(plan.id)) + '</div>' +

      /* FPL message block */
      '<div class="fpl1801-print-msg-wrap">' +
        '<div class="fpl1801-print-msg-lbl">FPL MESSAGE</div>' +
        '<pre class="fpl1801-print-msg">' + esc(msg) + '</pre>' +
      '</div>' +

      /* Field grid */
      '<div class="fpl1801-print-grid">' +

        /* Row 1 */
        '<div class="fpl1801-print-cell">' +
          '<span class="fpl1801-print-lbl">7 &mdash; AIRCRAFT IDENTIFICATION</span>' +
          '<span class="fpl1801-print-val">' + esc(plan.aircraftId || '') + '</span>' +
        '</div>' +
        '<div class="fpl1801-print-cell">' +
          '<span class="fpl1801-print-lbl">8 &mdash; FLIGHT RULES / TYPE</span>' +
          '<span class="fpl1801-print-val">' + esc((plan.flightRules || '') + ' / ' + (plan.typeOfFlight || '')) + '</span>' +
        '</div>' +
        '<div class="fpl1801-print-cell">' +
          '<span class="fpl1801-print-lbl">9 &mdash; NUM / TYPE / WTC</span>' +
          '<span class="fpl1801-print-val">' + esc(String(plan.numAircraft || 1) + ' / ' + (plan.aircraftType || '') + ' / ' + (plan.wtc || '')) + '</span>' +
        '</div>' +
        '<div class="fpl1801-print-cell">' +
          '<span class="fpl1801-print-lbl">10 &mdash; EQPT / XPDR</span>' +
          '<span class="fpl1801-print-val">' + esc((plan.equipment || '') + ' / ' + (plan.transponder || '')) + '</span>' +
        '</div>' +

        /* Row 2 */
        '<div class="fpl1801-print-cell">' +
          '<span class="fpl1801-print-lbl">13 &mdash; DEP AERODROME</span>' +
          '<span class="fpl1801-print-val">' + esc(plan.depAerodrome || '') + '</span>' +
        '</div>' +
        '<div class="fpl1801-print-cell">' +
          '<span class="fpl1801-print-lbl">DEPARTURE TIME (Z)</span>' +
          '<span class="fpl1801-print-val">' + esc(plan.depTime || '') + '</span>' +
        '</div>' +
        '<div class="fpl1801-print-cell">' +
          '<span class="fpl1801-print-lbl">15 &mdash; CRUISING SPEED</span>' +
          '<span class="fpl1801-print-val">' + esc((plan.speedUnit || '') + (plan.speedValue || '')) + '</span>' +
        '</div>' +
        '<div class="fpl1801-print-cell">' +
          '<span class="fpl1801-print-lbl">LEVEL</span>' +
          '<span class="fpl1801-print-val">' + esc((plan.levelUnit || '') + (plan.levelValue || '')) + '</span>' +
        '</div>' +

        /* Route — full width */
        '<div class="fpl1801-print-cell fpl1801-print-cell--full">' +
          '<span class="fpl1801-print-lbl">ROUTE</span>' +
          '<span class="fpl1801-print-val">' + esc(plan.route || '') + '</span>' +
        '</div>' +

        /* Row 3 */
        '<div class="fpl1801-print-cell">' +
          '<span class="fpl1801-print-lbl">16 &mdash; DESTINATION</span>' +
          '<span class="fpl1801-print-val">' + esc(plan.destAerodrome || '') + '</span>' +
        '</div>' +
        '<div class="fpl1801-print-cell">' +
          '<span class="fpl1801-print-lbl">TOTAL EET (HHMM)</span>' +
          '<span class="fpl1801-print-val">' + esc(plan.eet || '') + '</span>' +
        '</div>' +
        '<div class="fpl1801-print-cell">' +
          '<span class="fpl1801-print-lbl">ALTN AERODROME</span>' +
          '<span class="fpl1801-print-val">' + esc(plan.altn1 || '') + '</span>' +
        '</div>' +
        '<div class="fpl1801-print-cell">' +
          '<span class="fpl1801-print-lbl">2ND ALTN AERODROME</span>' +
          '<span class="fpl1801-print-val">' + esc(plan.altn2 || '') + '</span>' +
        '</div>' +

        /* Field 18 + supplementary */
        '<div class="fpl1801-print-cell fpl1801-print-cell--full">' +
          '<span class="fpl1801-print-lbl">18 &mdash; OTHER INFORMATION</span>' +
          '<span class="fpl1801-print-val">' + esc(plan.otherInfo || '0') + '</span>' +
        '</div>' +
        '<div class="fpl1801-print-cell">' +
          '<span class="fpl1801-print-lbl">E/ &mdash; ENDURANCE (HHMM)</span>' +
          '<span class="fpl1801-print-val">' + esc(plan.endurance || '') + '</span>' +
        '</div>' +
        '<div class="fpl1801-print-cell">' +
          '<span class="fpl1801-print-lbl">P/ &mdash; PERSONS ON BOARD</span>' +
          '<span class="fpl1801-print-val">' + esc(plan.pob || '') + '</span>' +
        '</div>' +
        '<div class="fpl1801-print-cell fpl1801-print-cell--half">' +
          '<span class="fpl1801-print-lbl">C/ &mdash; PILOT IN COMMAND</span>' +
          '<span class="fpl1801-print-val">' + esc(plan.pic || '') + '</span>' +
        '</div>' +

      '</div>' + /* /grid */

    '</div></div>'
  );
}

