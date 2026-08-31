// ═══════════════════════════════════════════════════════════
// activity-heatmap.js — per-member voice-activity heatmap modal +
// squadron-wide activity overview chart
//
// Two independent bespoke SVG renderers (buildHeatmapSvg, renderActivityChart)
// that happen to share a tooltip implementation (showTooltip/hideTooltip) —
// kept together in one file since nothing outside this file needs either
// renderer. buildStatusBadgeHtml/buildScoreCellHtml (used in the modal
// header) live in roster-table.js since renderTable is their primary
// caller — this file just calls them, same cross-file pattern already used
// elsewhere on this page.
//
// Opened from roster-table.js's per-row "heatmap" button
// (openHeatmapModal(member)).
//
// Public API:
//   openHeatmapModal(member) / closeHeatmapModal()
//   loadActivityOverview()
// ═══════════════════════════════════════════════════════════

'use strict';

var MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function levelForMinutes(minutes) {
  if (!minutes || minutes <= 0) return 0;
  if (minutes <= 30)  return 1;
  if (minutes <= 90)  return 2;
  if (minutes <= 180) return 3;
  return 4;
}

/* Shared tooltip: viewport-fixed positioning near the cursor, so it's never
   clipped by a scrolling ancestor (e.g. the heatmap's overflow-x:auto wrap —
   which per spec also forces overflow-y non-visible). */
function showTooltip(tooltipEl, evt, html) {
  tooltipEl.innerHTML = html;
  tooltipEl.style.display = '';
  tooltipEl.style.left = evt.clientX + 'px';
  tooltipEl.style.top  = evt.clientY + 'px';
}
function hideTooltip(tooltipEl) { tooltipEl.style.display = 'none'; }

/* ── Per-member heatmap modal ───────────────────────────── */
function openHeatmapModal(member) {
  document.getElementById('hmModalTitle').textContent = 'VOICE ACTIVITY — ' + (member.callsign || member.username || member.id).toUpperCase();
  document.getElementById('hmModalSub').textContent = 'Minutes spent in Discord voice channels, last 365 days.';
  document.getElementById('hmModalScore').innerHTML = member.activityScore == null
    ? '<span style="color:var(--text-3)">Status: &mdash; &middot; Activity score: &mdash;</span>'
    : 'Status: ' + buildStatusBadgeHtml(member.status) + ' &middot; Activity score: ' + buildScoreCellHtml(member);
  document.getElementById('hmSvg').innerHTML = '';
  openModal('hmModalOverlay');

  fetch('/api/voice-activity/member/' + encodeURIComponent(member.id), {
    headers: authHeaders(),
  }).then(function (r) { return r.json(); })
    .then(function (body) { buildHeatmapSvg(body.days || {}, member.vacations || []); })
    .catch(function () { showToast('Failed to load activity heatmap', true); });
}
function closeHeatmapModal() {
  closeModal('hmModalOverlay');
}
wireModalOutsideClick('hmModalOverlay', closeHeatmapModal);

/* True if the whole-day window [dateObj, dateObj+24h) overlaps any of the
   member's vacation ranges — same whole-day-granularity overlap check the
   backend uses (activity-score.js's isVacationDay), just done client-side
   against raw ISO from/until since that's all the member object carries. */
function isVacationDayKey(dateObj, vacations) {
  if (!Array.isArray(vacations) || !vacations.length) return false;
  var dayStart = dateObj.getTime();
  var dayEnd = dayStart + 86400000;
  return vacations.some(function (v) {
    var vFrom = new Date(v.from).getTime();
    var vUntil = new Date(v.until).getTime();
    return dayStart < vUntil && dayEnd > vFrom;
  });
}

/* GitHub-contributions-style grid: rows = day-of-week, columns = weeks,
   rolling 365 days ending today. Buckets are minutes-in-voice per day.
   Vacation days render in a distinct color regardless of minutes logged —
   the score is frozen on those days (see activity-score.js), so the
   heatmap should visually say "excused", not "quiet". */
function buildHeatmapSvg(daysMap, vacations) {
  var CELL = 11, GAP = 3, LEFT_PAD = 26, TOP_PAD = 16;

  var today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  var start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 364);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); /* snap back to Sunday */

  var days = [];
  var cursor = new Date(start);
  while (cursor <= today) {
    var key = cursor.toISOString().slice(0, 10);
    days.push({ date: new Date(cursor), key: key, minutes: daysMap[key] || 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  var weeks  = Math.ceil(days.length / 7);
  var width  = LEFT_PAD + weeks * (CELL + GAP);
  var height = TOP_PAD + 7 * (CELL + GAP);

  var svg = document.getElementById('hmSvg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

  var markup = '';
  var lastMonth = -1;
  days.forEach(function (d, i) {
    var week = Math.floor(i / 7);
    var dow  = i % 7;
    var x = LEFT_PAD + week * (CELL + GAP);
    var y = TOP_PAD + dow * (CELL + GAP);
    var onVacation = isVacationDayKey(d.date, vacations);
    var cls = onVacation ? 'hm-vacation' : 'hm-level-' + levelForMinutes(d.minutes);
    markup += '<rect x="' + x + '" y="' + y + '" width="' + CELL + '" height="' + CELL +
      '" rx="2" class="' + cls + '" data-date="' + d.key + '" data-minutes="' + d.minutes +
      '" data-vacation="' + (onVacation ? '1' : '0') + '"></rect>';
    if (dow === 0 && d.date.getUTCMonth() !== lastMonth) {
      lastMonth = d.date.getUTCMonth();
      markup += '<text x="' + x + '" y="' + (TOP_PAD - 5) + '" class="hm-month-label">' + MONTH_NAMES[lastMonth] + '</text>';
    }
  });
  svg.innerHTML = markup;

  var tooltip = document.getElementById('hmTooltip');
  Array.prototype.forEach.call(svg.querySelectorAll('rect'), function (rect) {
    rect.addEventListener('mousemove', function (e) {
      var minutes = Number(rect.dataset.minutes) || 0;
      var body = rect.dataset.vacation === '1'
        ? 'On vacation &middot; excused from score'
        : minutes + ' min in voice';
      showTooltip(tooltip, e, '<b>' + rect.dataset.date + '</b><br>' + body);
    });
    rect.addEventListener('mouseleave', function () { hideTooltip(tooltip); });
  });
}

/* ── Squadron-wide overview chart ───────────────────────── */
function loadActivityOverview() {
  var mode  = document.getElementById('activityMode').value;
  var range = document.getElementById('activityRange').value;
  fetch('/api/voice-activity/overview?mode=' + encodeURIComponent(mode) + '&range=' + encodeURIComponent(range), {
    headers: authHeaders(),
  }).then(function (r) { return r.json(); })
    .then(function (body) { renderActivityChart(body); })
    .catch(function () { showToast('Failed to load activity overview', true); });
}

function renderActivityChart(data) {
  var svg = document.getElementById('activityChart');
  var VB_W = 900, VB_H = 220;
  var PAD_L = 42, PAD_R = 12, PAD_T = 12, PAD_B = 28;
  var plotW = VB_W - PAD_L - PAD_R;
  var plotH = VB_H - PAD_T - PAD_B;

  var bars; /* [{ label, minutes }] */
  if (data.mode === 'hourly') {
    bars = data.buckets.map(function (minutes, hour) { return { label: String(hour), minutes: minutes }; });
  } else if (data.mode === 'weekly') {
    bars = data.weeks.map(function (w) { return { label: w.weekStart.slice(5), minutes: w.minutes }; });
  } else {
    bars = data.days.map(function (d) { return { label: d.date.slice(5), minutes: d.minutes }; });
  }

  var maxMinutes = bars.reduce(function (m, b) { return Math.max(m, b.minutes); }, 0) || 1;
  var n = bars.length || 1;
  var slot = plotW / n;
  var barW = Math.max(1, Math.min(slot * 0.7, 18));

  var markup = '';
  /* y-axis gridlines + labels (0, half, max — in hours for readability) */
  [0, 0.5, 1].forEach(function (frac) {
    var y = PAD_T + plotH * (1 - frac);
    markup += '<line x1="' + PAD_L + '" y1="' + y + '" x2="' + (VB_W - PAD_R) + '" y2="' + y + '" stroke="var(--border)" stroke-width="1"></line>';
    markup += '<text x="' + (PAD_L - 6) + '" y="' + (y + 3) + '" text-anchor="end" class="hm-axis-label">' + (Math.round(maxMinutes * frac / 6) / 10) + 'h</text>';
  });

  var labelEvery = Math.max(1, Math.ceil(n / 14));
  bars.forEach(function (b, i) {
    var x = PAD_L + i * slot + (slot - barW) / 2;
    var h = maxMinutes > 0 ? (b.minutes / maxMinutes) * plotH : 0;
    var y = PAD_T + plotH - h;
    markup += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + Math.max(h, 0) +
      '" rx="3" class="hm-bar" data-label="' + b.label + '" data-minutes="' + b.minutes + '"></rect>';
    if (i % labelEvery === 0) {
      markup += '<text x="' + (x + barW / 2) + '" y="' + (VB_H - 8) + '" text-anchor="middle" class="hm-axis-label">' + esc(b.label) + '</text>';
    }
  });

  svg.setAttribute('viewBox', '0 0 ' + VB_W + ' ' + VB_H);
  svg.innerHTML = markup;

  var tooltip = document.getElementById('activityTooltip');
  Array.prototype.forEach.call(svg.querySelectorAll('.hm-bar'), function (rect) {
    rect.addEventListener('mousemove', function (e) {
      var minutes = Number(rect.dataset.minutes) || 0;
      var unitLabel = data.mode === 'hourly' ? (rect.dataset.label + ':00') : rect.dataset.label;
      showTooltip(tooltip, e, '<b>' + esc(unitLabel) + '</b><br>' + minutes + ' min');
    });
    rect.addEventListener('mouseleave', function () { hideTooltip(tooltip); });
  });
}
