/* ── External links ── */
(function() {
  function setLink(id, url) { var el = document.getElementById(id); if (el && url) el.href = url; }
  setLink('footerDiscordLink', typeof DISCORD_URL !== 'undefined' ? DISCORD_URL : null);
  setLink('footerWikiLink',   typeof WIKI_URL    !== 'undefined' ? WIKI_URL    : null);
  setLink('footerGithubLink', typeof GITHUB_URL  !== 'undefined' ? GITHUB_URL  : null);
})();

/* getToken, loginWithCasdoor, isAdminRole, isBookingAdminRole, getUser, logout, esc
   provided by /js/auth.js */

/* ════════════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════════════ */
var currentToken   = getToken();
var bkResources    = { ranges: [], controllers: [], notifyChannelId: '' };
var bkBookings     = [];
var bkAdminOpen    = false;
var bkShowPast     = false;
var bkTickTimer    = null;
var bkRefetchTimer = null;

var BK_SOON_THRESHOLD_MS = 60 * 60 * 1000; /* "starting soon" window: 1 hour */
var BK_STATE_RANK = { live: 0, soon: 1, upcoming: 2, past: 3 };

/* ════════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════════ */
(function() {
  var user = getUser();
  var btn  = document.getElementById('loginBtn');
  if (btn) {
    if (user && currentToken) {
      btn.textContent = (user.name || 'USER').toUpperCase() + ' ⏻';
      btn.title       = 'Click to log out';
      btn.classList.add('login-btn--logout');
      btn.onclick = logout;
    }
  }

  if (!currentToken) {
    document.getElementById('bkLoginPrompt').style.display = '';
  } else {
    document.getElementById('bkMain').style.display = '';
    if (isBookingAdminRole(currentToken)) {
      document.getElementById('bkAdminToggleBtn').style.display = '';
    }
    bkPrefillDates();
    bkLoadAll();
    bkTickTimer    = setInterval(bkTick, 30 * 1000);
    bkRefetchTimer = setInterval(bkLoadAll, 60 * 1000);
  }
})();

/* Re-renders time-sensitive parts of the page from already-fetched state
   (no network call) so relative labels, status colors and the clock stay
   current between refetches */
function bkTick() {
  bkRenderStatusBar();
  bkRenderBoard();
}

/* Prefill both date fields with today's date (UTC/Zulu), since same-day
   bookings are the overwhelming majority of entries */
function bkPrefillDates() {
  var today = new Date().toISOString().slice(0, 10);
  document.getElementById('bkFormStartDate').value = today;
  document.getElementById('bkFormEndDate').value   = today;
}

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
   LOAD
════════════════════════════════════════════════════════════ */
function bkAuthHeaders(withJson) {
  var h = authHeaders(currentToken);
  if (withJson) h['Content-Type'] = 'application/json';
  return h;
}

function bkLoadAll() {
  Promise.all([
    fetch('/api/booking-resources', { headers: bkAuthHeaders() }).then(function(r) { return r.json(); }),
    fetch('/api/bookings',          { headers: bkAuthHeaders() }).then(function(r) { return r.json(); }),
  ]).then(function(results) {
    bkResources = results[0] || { ranges: [], controllers: [], notifyChannelId: '' };
    bkBookings  = Array.isArray(results[1]) ? results[1] : [];
    bkPopulateResourceSelect();
    bkRenderStatusBar();
    bkRenderBoard();
    if (bkAdminOpen) bkRenderAdminPanel();
  }).catch(function() {});
}

function bkOnShowPastToggle() {
  bkShowPast = document.getElementById('bkShowPastToggle').checked;
  bkRenderBoard();
}

/* ════════════════════════════════════════════════════════════
   ADMIN PANEL — manage ranges & controller positions
════════════════════════════════════════════════════════════ */
function bkToggleAdminPanel() {
  bkAdminOpen = !bkAdminOpen;
  var panel = document.getElementById('bkAdminPanel');
  panel.style.display = bkAdminOpen ? '' : 'none';
  if (bkAdminOpen) bkRenderAdminPanel();
}

function bkRenderAdminPanel() {
  var panel = document.getElementById('bkAdminPanel');
  if (!panel) return;

  var rangeItems = bkResources.ranges.map(function(r) {
    return '<div class="bk-list-item">' +
      '<div class="bk-list-item-meta"><b>' + esc(r.name) + '</b> &middot; ' + esc(r.frequency) + ' &middot; ' + r.minAltitude + '&ndash;' + r.maxAltitude + 'ft</div>' +
      '<div class="bk-list-item-actions">' +
        '<button class="bk-link-btn" onclick="bkOpenRangeModal(\'' + esc(r.id) + '\')">EDIT</button>' +
        '<button class="bk-link-btn bk-link-btn--danger" onclick="bkDeleteRange(\'' + esc(r.id) + '\')">DELETE</button>' +
      '</div></div>';
  }).join('') || '<div class="bk-empty">No ranges configured yet.</div>';

  var ctrlItems = bkResources.controllers.map(function(c) {
    return '<div class="bk-list-item">' +
      '<div class="bk-list-item-meta"><b>' + esc(c.name) + '</b> &middot; ' + esc(c.frequency) + '</div>' +
      '<div class="bk-list-item-actions">' +
        '<button class="bk-link-btn" onclick="bkOpenCtrlModal(\'' + esc(c.id) + '\')">EDIT</button>' +
        '<button class="bk-link-btn bk-link-btn--danger" onclick="bkDeleteController(\'' + esc(c.id) + '\')">DELETE</button>' +
      '</div></div>';
  }).join('') || '<div class="bk-empty">No controller positions configured yet.</div>';

  panel.innerHTML =
    '<div class="bk-admin-label"><span>MANAGE RANGES &amp; CONTROLLER POSITIONS</span></div>' +
    '<div class="bk-admin-body">' +
      '<div class="bk-admin-sub-label">RANGES</div>' +
      rangeItems +
      '<div style="margin-top:8px"><button class="btn btn-ghost" style="font-size:9px;padding:6px 16px" onclick="bkOpenRangeModal()">+ ADD RANGE</button></div>' +
      '<div class="bk-admin-sub-label">CONTROLLER POSITIONS</div>' +
      ctrlItems +
      '<div style="margin-top:8px"><button class="btn btn-ghost" style="font-size:9px;padding:6px 16px" onclick="bkOpenCtrlModal()">+ ADD CONTROLLER POSITION</button></div>' +
      '<div class="bk-admin-sub-label">DISCORD NOTIFICATIONS</div>' +
      '<div class="form-row">' +
        '<div class="form-group">' +
          '<label class="form-label" for="bkNotifyChInput">DISCORD NOTIFY CHANNEL ID</label>' +
          '<input class="form-input" id="bkNotifyChInput" type="text" maxlength="32" placeholder="e.g. 123456789012345678" value="' + esc(bkResources.notifyChannelId || '') + '" autocomplete="off">' +
        '</div>' +
        '<div style="align-self:flex-end">' +
          '<button class="btn btn-primary" style="font-size:9px;padding:8px 16px" onclick="bkSaveNotifyChannel()">SAVE</button>' +
        '</div>' +
      '</div>' +
      '<div class="form-error"   id="bkNotifyError"   style="display:none"></div>' +
      '<div class="form-success" id="bkNotifySuccess" style="display:none"></div>' +
    '</div>';
}

/* ── Range CRUD ── */
function bkOpenRangeModal(id) {
  var overlay = document.getElementById('bkRangeModalOverlay');
  var title   = document.getElementById('bkRangeModalTitle');
  var errEl   = document.getElementById('bkRangeModalError');
  errEl.style.display = 'none';
  var range = id ? bkResources.ranges.find(function(r) { return r.id === id; }) : null;

  document.getElementById('bkRangeEditId').value = id || '';
  document.getElementById('bkRangeId').value      = range ? range.id : '';
  document.getElementById('bkRangeId').disabled   = Boolean(range);
  document.getElementById('bkRangeName').value    = range ? range.name : '';
  document.getElementById('bkRangeFreq').value    = range ? range.frequency : '';
  document.getElementById('bkRangeMin').value     = range ? range.minAltitude : '';
  document.getElementById('bkRangeMax').value     = range ? range.maxAltitude : '';
  title.textContent = range ? 'EDIT RANGE' : 'ADD RANGE';
  overlay.style.display = '';
}

function bkCloseRangeModal() {
  document.getElementById('bkRangeModalOverlay').style.display = 'none';
}

function bkSubmitRange() {
  var editId = document.getElementById('bkRangeEditId').value;
  var errEl  = document.getElementById('bkRangeModalError');
  errEl.style.display = 'none';

  var data = {
    id:          document.getElementById('bkRangeId').value.trim(),
    name:        document.getElementById('bkRangeName').value.trim(),
    frequency:   document.getElementById('bkRangeFreq').value.trim(),
    minAltitude: Number(document.getElementById('bkRangeMin').value),
    maxAltitude: Number(document.getElementById('bkRangeMax').value),
  };
  if (!data.id || !data.name || !data.frequency) {
    errEl.textContent = 'ID, name and frequency are required.';
    errEl.style.display = '';
    return;
  }

  var url    = editId ? '/api/booking-resources/ranges/' + encodeURIComponent(editId) : '/api/booking-resources/ranges';
  var method = editId ? 'PUT' : 'POST';
  fetch(url, { method: method, headers: bkAuthHeaders(true), body: JSON.stringify(data) })
    .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
    .then(function(res) {
      if (!res.ok) { errEl.textContent = res.body.error || 'Save failed.'; errEl.style.display = ''; return; }
      bkCloseRangeModal();
      bkLoadAll();
    })
    .catch(function() { errEl.textContent = 'Network error — please try again.'; errEl.style.display = ''; });
}

function bkDeleteRange(id) {
  if (!confirm('Delete range "' + id + '"? Any bookings on it will also be removed.')) return;
  fetch('/api/booking-resources/ranges/' + encodeURIComponent(id), { method: 'DELETE', headers: bkAuthHeaders() })
    .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
    .then(function(res) { if (!res.ok) { alert(res.body.error || 'Delete failed.'); return; } bkLoadAll(); })
    .catch(function() { alert('Network error — please try again.'); });
}

/* ── Controller position CRUD ── */
function bkOpenCtrlModal(id) {
  var overlay = document.getElementById('bkCtrlModalOverlay');
  var title   = document.getElementById('bkCtrlModalTitle');
  var errEl   = document.getElementById('bkCtrlModalError');
  errEl.style.display = 'none';
  var ctrl = id ? bkResources.controllers.find(function(c) { return c.id === id; }) : null;

  document.getElementById('bkCtrlEditId').value = id || '';
  document.getElementById('bkCtrlId').value      = ctrl ? ctrl.id : '';
  document.getElementById('bkCtrlId').disabled   = Boolean(ctrl);
  document.getElementById('bkCtrlName').value    = ctrl ? ctrl.name : '';
  document.getElementById('bkCtrlFreq').value    = ctrl ? ctrl.frequency : '';
  title.textContent = ctrl ? 'EDIT CONTROLLER POSITION' : 'ADD CONTROLLER POSITION';
  overlay.style.display = '';
}

function bkCloseCtrlModal() {
  document.getElementById('bkCtrlModalOverlay').style.display = 'none';
}

function bkSubmitController() {
  var editId = document.getElementById('bkCtrlEditId').value;
  var errEl  = document.getElementById('bkCtrlModalError');
  errEl.style.display = 'none';

  var data = {
    id:        document.getElementById('bkCtrlId').value.trim(),
    name:      document.getElementById('bkCtrlName').value.trim(),
    frequency: document.getElementById('bkCtrlFreq').value.trim(),
  };
  if (!data.id || !data.name || !data.frequency) {
    errEl.textContent = 'ID, name and frequency are required.';
    errEl.style.display = '';
    return;
  }

  var url    = editId ? '/api/booking-resources/controllers/' + encodeURIComponent(editId) : '/api/booking-resources/controllers';
  var method = editId ? 'PUT' : 'POST';
  fetch(url, { method: method, headers: bkAuthHeaders(true), body: JSON.stringify(data) })
    .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
    .then(function(res) {
      if (!res.ok) { errEl.textContent = res.body.error || 'Save failed.'; errEl.style.display = ''; return; }
      bkCloseCtrlModal();
      bkLoadAll();
    })
    .catch(function() { errEl.textContent = 'Network error — please try again.'; errEl.style.display = ''; });
}

function bkDeleteController(id) {
  if (!confirm('Delete controller position "' + id + '"? Any bookings on it will also be removed.')) return;
  fetch('/api/booking-resources/controllers/' + encodeURIComponent(id), { method: 'DELETE', headers: bkAuthHeaders() })
    .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
    .then(function(res) { if (!res.ok) { alert(res.body.error || 'Delete failed.'); return; } bkLoadAll(); })
    .catch(function() { alert('Network error — please try again.'); });
}

function bkSaveNotifyChannel() {
  var input = document.getElementById('bkNotifyChInput');
  var errEl = document.getElementById('bkNotifyError');
  var okEl  = document.getElementById('bkNotifySuccess');
  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  fetch('/api/booking-resources/config', { method: 'PUT', headers: bkAuthHeaders(true), body: JSON.stringify({ notifyChannelId: input.value.trim() }) })
    .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
    .then(function(res) {
      if (!res.ok) { errEl.textContent = res.body.error || 'Save failed.'; errEl.style.display = ''; return; }
      bkResources.notifyChannelId = res.body.notifyChannelId || '';
      okEl.textContent = 'Saved.';
      okEl.style.display = '';
    })
    .catch(function() { errEl.textContent = 'Network error — please try again.'; errEl.style.display = ''; });
}

/* ════════════════════════════════════════════════════════════
   NEW BOOKING FORM
════════════════════════════════════════════════════════════ */
function bkPopulateResourceSelect() {
  bkOnFormTypeChange();
}

function bkOnFormTypeChange() {
  var type = document.getElementById('bkFormType').value;
  var sel  = document.getElementById('bkFormResource');
  var list = type === 'range' ? bkResources.ranges : bkResources.controllers;
  sel.innerHTML = list.map(function(r) {
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + ' (' + esc(r.frequency) + ')</option>';
  }).join('') || '<option value="">— none configured —</option>';
  document.getElementById('bkFormAltitudeRow').style.display = type === 'range' ? '' : 'none';
  bkOnFormResourceChange();
}

function bkOnFormResourceChange() {
  var type  = document.getElementById('bkFormType').value;
  if (type !== 'range') return;
  var id    = document.getElementById('bkFormResource').value;
  var range = bkResources.ranges.find(function(r) { return r.id === id; });
  var hint  = document.getElementById('bkFormAltitudeHint');
  hint.textContent = range
    ? 'Between ' + range.minAltitude + ' and ' + range.maxAltitude + 'ft, and at least 999ft from any other overlapping booking on this range.'
    : 'Must be at least 999ft from any other overlapping booking on this range.';
}

/* Composes an ISO 8601 UTC timestamp from a date input value (YYYY-MM-DD)
   and a 4-digit Zulu time (ZZZZ, e.g. "1900"). Returns null if the time
   isn't a valid 4-digit HHMM. */
function bkComposeISO(dateVal, timeVal) {
  if (!dateVal) return null;
  var t = String(timeVal || '').trim();
  if (!/^\d{4}$/.test(t)) return null;
  var hh = t.slice(0, 2), mm = t.slice(2, 4);
  if (Number(hh) > 23 || Number(mm) > 59) return null;
  return dateVal + 'T' + hh + ':' + mm + ':00Z';
}

function bkSubmitBooking() {
  var errEl = document.getElementById('bkFormError');
  var okEl  = document.getElementById('bkFormSuccess');
  var btn   = document.getElementById('bkFormSubmitBtn');
  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  var type       = document.getElementById('bkFormType').value;
  var resourceId = document.getElementById('bkFormResource').value;

  if (!resourceId) { errEl.textContent = 'Select a resource.'; errEl.style.display = ''; return; }

  var startISO = bkComposeISO(document.getElementById('bkFormStartDate').value, document.getElementById('bkFormStartTime').value);
  var endISO   = bkComposeISO(document.getElementById('bkFormEndDate').value,   document.getElementById('bkFormEndTime').value);
  if (!startISO || !endISO) {
    errEl.textContent = 'Enter a date and a 4-digit Zulu time (ZZZZ, e.g. 1900) for both start and end.';
    errEl.style.display = '';
    return;
  }

  var data = {
    resourceType: type,
    resourceId:   resourceId,
    startTime:    startISO,
    endTime:      endISO,
  };
  if (type === 'range') {
    var altEl = document.getElementById('bkFormAltitude');
    if (!altEl.value) { errEl.textContent = 'Deconfliction altitude is required.'; errEl.style.display = ''; return; }
    data.altitude = Number(altEl.value);
  }

  btn.disabled    = true;
  btn.textContent = 'BOOKING...';

  fetch('/api/bookings', { method: 'POST', headers: bkAuthHeaders(true), body: JSON.stringify(data) })
    .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
    .then(function(res) {
      btn.disabled    = false;
      btn.textContent = 'BOOK';
      if (!res.ok) { errEl.textContent = res.body.error || 'Booking failed.'; errEl.style.display = ''; return; }
      okEl.textContent = 'Booking confirmed.';
      okEl.style.display = '';
      document.getElementById('bkFormAltitude').value = '';
      bkLoadAll();
    })
    .catch(function() {
      btn.disabled    = false;
      btn.textContent = 'BOOK';
      errEl.textContent = 'Network error — please try again.';
      errEl.style.display = '';
    });
}

/* ════════════════════════════════════════════════════════════
   STATUS BAR — live clock + at-a-glance counts across all bookings
════════════════════════════════════════════════════════════ */
function bkRenderStatusBar() {
  var el = document.getElementById('bkStatusBar');
  if (!el) return;

  var now = new Date();
  var today = now.toISOString().slice(0, 10);
  var activeNow = 0, todayCount = 0, upcomingCount = 0;
  bkBookings.forEach(function(b) {
    var state = bkBookingState(b);
    if (state === 'live') activeNow++;
    if (state !== 'past' && b.startTime.slice(0, 10) === today) todayCount++;
    if (state === 'soon' || state === 'upcoming') upcomingCount++;
  });

  var clock = now.toISOString().slice(11, 16).replace(':', '') + 'Z';
  el.innerHTML =
    '<span class="bk-statusbar-clock">CURRENT: ' + clock + '</span>' +
    '<span class="bk-statusbar-sep">&middot;</span>' +
    '<span class="bk-statusbar-stat' + (activeNow > 0 ? ' bk-statusbar-stat--live' : '') + '">' + activeNow + ' ACTIVE NOW</span>' +
    '<span class="bk-statusbar-sep">&middot;</span>' +
    '<span class="bk-statusbar-stat">' + todayCount + ' TODAY</span>' +
    '<span class="bk-statusbar-sep">&middot;</span>' +
    '<span class="bk-statusbar-stat">' + upcomingCount + ' UPCOMING</span>';
}

/* ════════════════════════════════════════════════════════════
   TEMPORAL HELPERS
════════════════════════════════════════════════════════════ */
function bkBookingState(b) {
  var now   = new Date();
  var start = new Date(b.startTime);
  var end   = new Date(b.endTime);
  if (now >= start && now < end) return 'live';
  if (now < start) return (start - now) <= BK_SOON_THRESHOLD_MS ? 'soon' : 'upcoming';
  return 'past';
}

function bkCompareBookings(a, b) {
  var pa = BK_STATE_RANK[bkBookingState(a)];
  var pb = BK_STATE_RANK[bkBookingState(b)];
  if (pa !== pb) return pa - pb;
  if (pa === BK_STATE_RANK.past) return new Date(b.endTime) - new Date(a.endTime); /* most recently ended first */
  return new Date(a.startTime) - new Date(b.startTime);
}

function bkDurationStr(ms) {
  var totalMin = Math.max(0, Math.round(ms / 60000));
  var days  = Math.floor(totalMin / 1440);
  var hours = Math.floor((totalMin % 1440) / 60);
  var mins  = totalMin % 60;
  if (days  > 0) return days + 'd ' + hours + 'h';
  if (hours > 0) return mins > 0 ? (hours + 'h ' + mins + 'm') : (hours + 'h');
  return mins + 'm';
}

function bkRelativeLabel(b, state) {
  var now   = new Date();
  var start = new Date(b.startTime);
  var end   = new Date(b.endTime);
  if (state === 'live') return 'NOW &middot; ends in ' + bkDurationStr(end - now);
  if (state === 'past') return 'ended ' + bkDurationStr(now - end) + ' ago';
  return 'in ' + bkDurationStr(start - now);
}

var BK_MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

/* dateStr is a "YYYY-MM-DD" (UTC) date; returns TODAY/TOMORROW/YESTERDAY or
   a short "MON DD" label, relative to the current UTC date */
function bkDayLabel(dateStr) {
  var today     = new Date().toISOString().slice(0, 10);
  var todayDate = new Date(today   + 'T00:00:00Z');
  var thisDate  = new Date(dateStr + 'T00:00:00Z');
  var diffDays  = Math.round((thisDate - todayDate) / 86400000);
  if (diffDays === 0)  return 'TODAY';
  if (diffDays === 1)  return 'TOMORROW';
  if (diffDays === -1) return 'YESTERDAY';
  var d = thisDate.getUTCDate();
  return BK_MONTHS[thisDate.getUTCMonth()] + ' ' + (d < 10 ? '0' + d : d);
}

/* Day-collapsed Zulu window display: "TODAY · 1900–2030Z" for the common
   same-day case, falling back to two full day-labeled times otherwise */
function bkFmtWindow(startIso, endIso) {
  var startDate = startIso.slice(0, 10);
  var endDate   = endIso.slice(0, 10);
  var startHHMM = startIso.slice(11, 16).replace(':', '');
  var endHHMM   = endIso.slice(11, 16).replace(':', '');
  if (startDate === endDate) {
    return bkDayLabel(startDate) + ' &middot; ' + startHHMM + '&ndash;' + endHHMM + 'Z';
  }
  return bkDayLabel(startDate) + ' ' + startHHMM + 'Z &rarr; ' + bkDayLabel(endDate) + ' ' + endHHMM + 'Z';
}

/* ════════════════════════════════════════════════════════════
   BOARD
════════════════════════════════════════════════════════════ */
function bkRenderBoard() {
  bkRenderResourceList('bkRangesBoard', bkResources.ranges, 'range');
  bkRenderResourceList('bkControllersBoard', bkResources.controllers, 'controller');
}

function bkRenderResourceList(elId, resources, type) {
  var el = document.getElementById(elId);
  if (!el) return;
  if (!resources.length) {
    el.innerHTML = '<div class="bk-empty">None configured yet.</div>';
    return;
  }
  var user    = getUser();
  var isAdmin = isBookingAdminRole(currentToken);
  var today   = new Date().toISOString().slice(0, 10);

  el.innerHTML = resources.map(function(resource) {
    var allBookings = bkBookings.filter(function(b) { return b.resourceType === type && b.resourceId === resource.id; });

    var liveCount  = 0;
    var todayCount = 0;
    var liveOccupant = null;
    allBookings.forEach(function(b) {
      var state = bkBookingState(b);
      if (state === 'live') { liveCount++; liveOccupant = b; }
      if (state !== 'past' && b.startTime.slice(0, 10) === today) todayCount++;
    });

    var chip = type === 'controller'
      ? (liveCount > 0
          ? '<span class="bk-resource-chip bk-resource-chip--occupied">OCCUPIED &middot; ' + esc(liveOccupant.bookedBy.name || '—') + '</span>'
          : '<span class="bk-resource-chip bk-resource-chip--free">FREE NOW</span>')
      : (liveCount > 0
          ? '<span class="bk-resource-chip bk-resource-chip--occupied">' + liveCount + ' ACTIVE NOW</span>'
          : '<span class="bk-resource-chip bk-resource-chip--free">FREE NOW</span>');
    chip += '<span class="bk-badge">' + todayCount + ' today</span>';

    var badges = chip + '<span class="bk-badge">' + esc(resource.frequency) + '</span>';
    if (type === 'range') badges += '<span class="bk-badge">' + resource.minAltitude + '&ndash;' + resource.maxAltitude + 'ft</span>';

    var visible = allBookings.filter(function(b) { return bkShowPast || bkBookingState(b) !== 'past'; })
      .slice().sort(bkCompareBookings);

    var rows = visible.map(function(b) {
      var state     = bkBookingState(b);
      var isOwner   = user && b.bookedBy && user.sub === b.bookedBy.sub;
      var canCancel = isOwner || isAdmin;
      return '<div class="bk-booking-row bk-booking-row--' + state + '">' +
        '<div>' +
          '<div class="bk-booking-window">' + bkFmtWindow(b.startTime, b.endTime) +
            ' <span class="bk-status-badge bk-status-badge--' + state + '">' + bkRelativeLabel(b, state) + '</span>' +
          '</div>' +
          '<div class="bk-booking-meta">' + esc(b.bookedBy.name || '—') + (type === 'range' ? ' &middot; <span class="bk-booking-alt">' + b.altitude + 'ft</span>' : '') + '</div>' +
        '</div>' +
        (canCancel ? '<button class="bk-link-btn bk-link-btn--danger" onclick="bkCancelBooking(' + b.id + ')">CANCEL</button>' : '') +
      '</div>';
    }).join('') || '<div class="bk-booking-empty">No bookings yet.</div>';

    return '<div class="bk-resource-card">' +
      '<div class="bk-resource-header">' +
        '<div class="bk-resource-name">' + esc(resource.name) + '</div>' +
        '<div class="bk-resource-badges">' + badges + '</div>' +
      '</div>' +
      '<div class="bk-resource-body">' + rows + '</div>' +
    '</div>';
  }).join('');
}

function bkCancelBooking(id) {
  if (!confirm('Cancel this booking?')) return;
  fetch('/api/bookings/' + id, { method: 'DELETE', headers: bkAuthHeaders() })
    .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
    .then(function(res) { if (!res.ok) { alert(res.body.error || 'Cancel failed.'); return; } bkLoadAll(); })
    .catch(function() { alert('Network error — please try again.'); });
}

/* ════════════════════════════════════════════════════════════
   UTILITY
════════════════════════════════════════════════════════════ */
function bkFmtZ(iso) {
  if (!iso) return '—';
  return iso.slice(0, 16).replace('T', ' ') + 'Z';
}

