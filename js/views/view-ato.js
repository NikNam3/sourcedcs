// ═══════════════════════════════════════════════════════════
// view-ato.js — ATO tab: intel strip, mission cards, timeline
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Layout & sizing constants ───────────────────────────────
var TIMELINE_STEP_MINS   = 15;  // minutes between tick marks
var MIN_BAR_WIDTH_PCT    = 2;   // minimum bar width so thin windows stay visible

// ── DOM ID references ───────────────────────────────────────
var DOM_IDS = {
  intelRow:    'intel-row',
  cardsRow:    'cards-row',
  tlCanvas:    'tl-canvas',
  tlRange:     'tl-range',
  tlModeLabel: 'tl-mode-label',
  detailPanel: 'detail-panel',
  detailInner: 'detail-inner',
};

// ═════════════════════════════════════════════════════════════
// Public entry point — called by app.js on load / re-render
// ═════════════════════════════════════════════════════════════
function renderATO(ato) {
  var gc       = ato.global_control || {};
  var missions = ato.missions || [];
  var prevIdx  = STATE.selectedIdx;

  renderIntelStrip(gc, ato);
  renderTankers((STATE.pkg && STATE.pkg.registry && STATE.pkg.registry.tankers) || []);
  renderMissionCards(missions);
  renderTimeline(missions);

  // Restore previously-open detail panel after DOM rebuild
  if (prevIdx >= 0) {
    STATE.selectedIdx = -1;
    selectMission(prevIdx);
  }
}

// ═════════════════════════════════════════════════════════════
// Intel strip — package-level summary bar
// ═════════════════════════════════════════════════════════════

/**
 * Build one intel-section element from [label, value, cssClass?] tuples.
 */
function buildIntelSection(items) {
  var div = el('div', 'intel-section');

  items.forEach(function (tuple) {
    var lbl = tuple[0];
    var val = tuple[1];
    var cls = tuple[2] || '';

    var item = el('div', 'intel-item');
    item.appendChild(el('span', 'intel-lbl', lbl));
    item.appendChild(el('span', 'intel-val' + (cls ? ' ' + cls : ''), val || '—'));
    div.appendChild(item);
  });

  return div;
}

/**
 * Format an IRL Zulu time — always shows as "HHMMZ".
 */
function formatIrlZuluTime(rawValue) {
  if (!rawValue) { return null; }
  return String(rawValue).replace(/[ZL]$/i, '').padStart(4, '0') + 'Z';
}

function renderIntelStrip(gc, ato) {
  var irlTimeFormatted = formatIrlZuluTime(ato.irl_time_zulu);
  var irl    = [ato.irl_date, irlTimeFormatted].filter(Boolean).join(' ') || '—';
  var ingame = ato._ingame_is_zulu
    ? fmtTime(ato.ingame_start_time)
    : fmtTime(localToZuluTime(ato.ingame_start_local)) || '—';

  var sections = [
    buildIntelSection([
      ['IRL START',    irl],
      ['INGAME START', ingame, 'ingame'],
    ]),
  ];

  if (gc.bullseye) {
    var bsParsed = parseCoord(gc.bullseye.coords);
    var bsCoords = bsParsed
      ? fmtCoord(bsParsed.lat, bsParsed.lon)
      : (gc.bullseye.coords || '—');

    sections.push(buildIntelSection([
      ['BULLSEYE', gc.bullseye.name || '—'],
      ['COORDS',   bsCoords, 'coords'],
    ]));
  }

  var row = document.getElementById(DOM_IDS.intelRow);
  row.innerHTML = '';
  sections.forEach(function (s) { row.appendChild(s); });

  // Registry edit button (visible in edit mode)
  var regBtn = el('button', 'editor-btn', '✎ REGISTRY');
  regBtn.addEventListener('click', openRegistryEditor);
  row.appendChild(regBtn);

  // Times edit button (visible in edit mode)
  var timesBtn = el('button', 'editor-btn', '✎ TIMES');
  timesBtn.addEventListener('click', openTimesEditor);
  row.appendChild(timesBtn);
}

// ═════════════════════════════════════════════════════════════
// Tanker strip — horizontal row of compact tanker cards
// ═════════════════════════════════════════════════════════════

/**
 * Render tanker cards from registry.tankers into #tankers-row.
 * Shows: callsign, AR track, altitude, TACAN, orbit info.
 */
function renderTankers(tankers) {
  var row = document.getElementById('tankers-row');
  if (!row) return;
  row.innerHTML = '';

  var entries = Array.isArray(tankers)
    ? tankers.map(function (t) { return [t.id || t.callsign || '', t]; })
    : Object.entries(tankers || {});

  if (!entries.length) {
    // Hide the strip but keep the add button accessible via edit mode
    row.style.display = 'none';
    // The "+ TANKER" button is injected below and shown by edit-mode CSS
    var addBtn = el('button', 'editor-btn editor-btn-add tanker-add-btn', '+ TANKER');
    addBtn.addEventListener('click', function () { addRegistryItem('tankers'); });
    row.appendChild(addBtn);
    return;
  }
  row.style.display = 'flex';

  entries.forEach(function (entry) {
    var regKey = entry[0];
    var t = entry[1];
    var card = el('div', 'tanker-card');

    // Header: callsign + TACAN badge + edit button (edit mode only)
    var head = el('div', 'tanker-card-head');
    head.appendChild(el('span', 'tanker-callsign', t.callsign || '—'));
    if (t.tacan) {
      var tacanBadge = el('span', 'tanker-tacan', t.tacan);
      if (t.tacan_role) { tacanBadge.title = t.tacan_role; }
      head.appendChild(tacanBadge);
    }
    var editBtn = el('button', 'editor-btn tanker-edit-btn', '✎');
    editBtn.title = 'Edit tanker';
    editBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      editRegistryItem('tankers', regKey);
    });
    head.appendChild(editBtn);
    card.appendChild(head);

    // Body: AR track, altitude, speed, frequency
    var body = el('div', 'tanker-card-body');

    if (t.ar_track) {
      body.appendChild(_tankerRow('TRACK', t.ar_track));
    }
    if (t.altitude) {
      body.appendChild(_tankerRow('ALT', t.altitude));
    }
    if (t.speed_kts) {
      body.appendChild(_tankerRow('SPD', t.speed_kts + 'kt'));
    }
    if (t.freq_mhz != null) {
      body.appendChild(_tankerRow('FREQ', parseFloat(t.freq_mhz).toFixed(1) + ' MHz'));
    }
    if (t.orbit_heading_deg != null) {
      var hdgStr = String(t.orbit_heading_deg).padStart(3, '0') + '°';
      if (t.orbit_leg_nm != null) { hdgStr += ' / ' + t.orbit_leg_nm + 'NM'; }
      body.appendChild(_tankerRow('HDG/LEG', hdgStr));
    }

    card.appendChild(body);
    row.appendChild(card);
  });

  // Add Tanker button (edit mode)
  var addBtn = el('button', 'editor-btn editor-btn-add tanker-add-btn', '+ TANKER');
  addBtn.addEventListener('click', function () { addRegistryItem('tankers'); });
  row.appendChild(addBtn);
}

function _tankerRow(key, value) {
  var r = el('div', 'tanker-row');
  r.appendChild(el('span', 'tk', key));
  r.appendChild(el('span', 'tv', value));
  return r;
}

// ═════════════════════════════════════════════════════════════
// Mission cards — scrollable row of compact mission summaries
// ═════════════════════════════════════════════════════════════

/**
 * Determine the primary timing window label and values for a mission.
 * Returns { label, start, end, hasTOT, hasTOS }.
 */
function getMissionWindow(target) {
  var hasTOT = target && (target.tot_net || target.tot_nlt);
  var hasTOS = target && (target.tos || target.toffs);

  if (hasTOT) {
    return { label: 'TOT', start: target.tot_net, end: target.tot_nlt, hasTOT: true, hasTOS: hasTOS };
  }
  if (hasTOS) {
    return { label: 'TOS', start: target.tos, end: target.toffs, hasTOT: false, hasTOS: true };
  }
  return {
    label: 'WINDOW',
    start: target ? target.not_earlier_than : undefined,
    end:   target ? target.not_later_than   : undefined,
    hasTOT: false,
    hasTOS: false,
  };
}

/**
 * Build a single card-row element: label on the left, value on the right.
 */
function buildCardRow(label, value, valueCls) {
  var cardRow = el('div', 'card-row');
  cardRow.appendChild(el('span', 'ck', label));
  cardRow.appendChild(el('span', 'cv' + (valueCls ? ' ' + valueCls : ''), value));
  return cardRow;
}

function renderMissionCards(missions) {
  var container = document.getElementById(DOM_IDS.cardsRow);
  container.innerHTML = '';

  missions.forEach(function (m, i) {
    var tk  = typeKey(m.mission_type);
    var win = getMissionWindow(m.targets && m.targets[0]);

    var card = el('div', 'mission-card card-' + tk);

    // Card header (callsign + type badge)
    var top     = el('div', 'card-top');
    var leftCol = el('div');
    leftCol.appendChild(el('div', 'card-callsign', m.callsign || '—'));
    leftCol.appendChild(el('div', 'card-msn', m.mission_number || ''));
    top.appendChild(leftCol);

    var topRight = el('div', 'card-top-right');
    topRight.appendChild(el('div', 'card-type-badge type-' + tk, m.mission_type || '?'));

    // Edit/delete buttons (visible in edit mode)
    var editBtn = el('button', 'editor-btn', '✎');
    editBtn.title = 'Edit mission';
    editBtn.addEventListener('click', function(e) { e.stopPropagation(); editMission(i); });
    topRight.appendChild(editBtn);

    var delBtn = el('button', 'editor-btn', '✕');
    delBtn.title = 'Delete mission';
    delBtn.addEventListener('click', function(e) { e.stopPropagation(); deleteMission(i); });
    topRight.appendChild(delBtn);

    top.appendChild(topRight);
    card.appendChild(top);

    // Card body rows
    var body = el('div', 'card-body');
    body.appendChild(buildCardRow(
      'ACFT',
      m.aircraft ? m.aircraft.count + '× ' + m.aircraft.type : '?',
      'acft'
    ));
    var firstTgt = m.targets && m.targets[0];
    var tgtLabel = m.targets && m.targets.length > 1
      ? m.targets.length + ' TARGETS'
      : (firstTgt ? firstTgt.location || '—' : '—');
    body.appendChild(buildCardRow('TARGET', tgtLabel));
    body.appendChild(buildCardRow(
      win.label,
      fmtTime(win.start) + ' → ' + fmtTime(win.end),
      'time'
    ));

    if (win.hasTOS && win.hasTOT) {
      body.appendChild(buildCardRow(
        'TOS',
        fmtTime(firstTgt && firstTgt.tos) + ' → ' + fmtTime(firstTgt && firstTgt.toffs),
        'time'
      ));
    }
    if (m.takeoff_time) {
      body.appendChild(buildCardRow('T/O', fmtTime(m.takeoff_time), 'time'));
    }
    if (m.control && m.control.primary_freq_mhz) {
      body.appendChild(buildCardRow('PFREQ', m.control.primary_freq_mhz + ' MHz', 'freq'));
    }
    if (m.refuel) {
      body.appendChild(buildCardRow(
        'TANKER',
        (m.refuel.tanker_callsign || '—') + (m.refuel.altitude ? ' ' + m.refuel.altitude : ''),
        'tanker'
      ));
    }

    card.appendChild(body);
    card.addEventListener('click', function () { selectMission(i); });
    container.appendChild(card);
  });

  // Add Mission button (visible in edit mode)
  var addCard = el('button', 'editor-btn editor-btn-add', '+ ADD MISSION');
  addCard.addEventListener('click', addMission);
  container.appendChild(addCard);
}

// ═════════════════════════════════════════════════════════════
// Timeline — Gantt-style time display
// ═════════════════════════════════════════════════════════════

/**
 * Collect all time values from a mission for range calculation.
 */
function collectMissionTimes(m) {
  var t0 = m.targets && m.targets[0];
  return [
    toMins(t0 ? t0.not_earlier_than : null),
    toMins(t0 ? t0.not_later_than   : null),
    toMins(t0 ? t0.tot_net : null),
    toMins(t0 ? t0.tot_nlt : null),
    toMins(t0 ? t0.tos     : null),
    toMins(t0 ? t0.toffs   : null),
    toMins(m.refuel ? m.refuel.not_earlier_than : null),
    toMins(m.refuel ? m.refuel.not_later_than   : null),
    toMins(m.takeoff_time),
    toMins(m.recovery_time),
    toMins(m.vul_start),
    toMins(m.vul_end),
  ];
}

/**
 * Compute the visible time range for the timeline (in minutes).
 * Returns { min, max, pivot } or null if no time data exists.
 * pivot > 0 means some times crossed midnight and were shifted +1440 to
 * keep them chronological; normMins() must be used when placing bars.
 */
function computeTimeRange(missions) {
  var allTimes = [];

  missions.forEach(function (m) {
    collectMissionTimes(m).forEach(function (t) {
      if (t != null) allTimes.push(t);
    });
  });

  if (!allTimes.length) { return null; }

  var minT = Math.min.apply(null, allTimes);
  var maxT = Math.max.apply(null, allTimes);

  // Handle day-boundary crossing: if the raw span > 12 hours, times may
  // wrap across midnight (e.g. missions running from 2300Z to 0100Z).
  // Shift any time below (minT + 720) forward by 1440 so bars stay
  // chronological.  Store the crossover point as `pivot` so normMins()
  // can apply the same adjustment when computing bar positions.
  var pivot = 0;
  if (maxT - minT > 720) {
    var crossPoint = minT + 720;
    var adjTimes = allTimes.map(function (t) { return t < crossPoint ? t + 1440 : t; });
    var adjMin = Math.min.apply(null, adjTimes);
    var adjMax = Math.max.apply(null, adjTimes);
    // Only use the adjusted range if it is actually tighter
    if (adjMax - adjMin < maxT - minT) {
      minT  = adjMin;
      maxT  = adjMax;
      pivot = crossPoint;
    }
  }

  var step = TIMELINE_STEP_MINS;
  return {
    min:   Math.floor((minT - step) / step) * step,
    max:   Math.ceil ((maxT + step) / step) * step,
    pivot: pivot,
  };
}

/**
 * Normalize a raw HHMM minute value relative to the timeline range,
 * adding 1440 when the range crosses midnight (pivot > 0) and the
 * time falls before the pivot point.
 */
function normMins(v, range) {
  var m = toMins(v);
  if (m == null) { return null; }
  if (range.pivot > 0 && m < range.pivot) { return m + 1440; }
  return m;
}

/**
 * Convert raw minutes to display minutes (applying local offset in L mode).
 */
function displayMinutes(rawMins) {
  if (STATE.display.timeMode === 'L') {
    var ato        = (STATE.pkg && STATE.pkg.ato) ? STATE.pkg.ato : null;
    var offsetHrs  = ato ? (ato.local_offset_hours || 0) : 0;
    var offsetMins = offsetHrs * 60;
    return wrapMins(rawMins + offsetMins);
  }
  return rawMins;
}

/**
 * Format minutes as "HHMMx" where x is the current time suffix (Z or L).
 * Wraps values that exceed 1440 (midnight crossing in shifted timeline).
 */
function formatTickLabel(minutes) {
  var dm     = wrapMins(displayMinutes(minutes));
  var hh     = String(Math.floor(dm / 60)).padStart(2, '0');
  var mm     = String(dm % 60).padStart(2, '0');
  return hh + mm + STATE.display.timeMode;
}

/**
 * Calculate CSS left-% for a time value within the timeline span.
 */
function timeToLeftPct(minutes, rangeMin, span) {
  return ((minutes - rangeMin) / span * 100).toFixed(3);
}

/**
 * Calculate CSS width-% for a time window, enforcing a minimum.
 */
function timeSpanToWidthPct(startMins, endMins, span) {
  var pct = (endMins - startMins) / span * 100;
  return Math.max(MIN_BAR_WIDTH_PCT, pct).toFixed(3);
}

/**
 * Build the tick labels row above the timeline tracks.
 */
function buildTicksRow(range) {
  var step      = TIMELINE_STEP_MINS;
  var span      = range.max - range.min;
  var intervals = Math.round(span / step);
  var ticksRow  = el('div', 'tl-ticks');

  for (var idx = 0; idx < intervals; idx++) {
    var t    = range.min + idx * step;
    var tick = el('div', 'tl-tick', formatTickLabel(t));
    tick.style.flex = '1 0 0%';
    ticksRow.appendChild(tick);
  }

  // Final tick label — zero-width, overflows to the right
  var lastT    = range.min + intervals * step;
  var lastTick = el('div', 'tl-tick', formatTickLabel(lastT));
  lastTick.style.flex       = '0 0 0';
  lastTick.style.overflow   = 'visible';
  lastTick.style.whiteSpace = 'nowrap';
  ticksRow.appendChild(lastTick);

  return ticksRow;
}

/**
 * Add grid lines to a track element (one vertical line per tick).
 */
function addGridLines(track, range) {
  var step = TIMELINE_STEP_MINS;
  var span = range.max - range.min;

  for (var t = range.min; t <= range.max; t += step) {
    var line = el('div', 'tl-grid-line');
    line.style.left = timeToLeftPct(t, range.min, span) + '%';
    track.appendChild(line);
  }
}

/**
 * Add a single bar to the track if start/end are both valid.
 */
function addBarIfValid(track, missionIdx, opts) {
  var startMins = normMins(opts.startTime, opts.range);
  var endMins   = normMins(opts.endTime,   opts.range);
  if (startMins == null || endMins == null) { return; }

  var leftPct  = timeToLeftPct(startMins, opts.range.min, opts.span);
  var widthPct = timeSpanToWidthPct(startMins, endMins, opts.span);

  var bar = el('div', 'tl-bar' + (opts.cssClass ? ' ' + opts.cssClass : ''));
  bar.style.background = opts.color;
  bar.style.left       = leftPct + '%';
  bar.style.width      = widthPct + '%';
  bar.title            = opts.title;
  if (opts.label) { bar.textContent = opts.label; }
  bar.addEventListener('click', function () { selectMission(missionIdx); });
  track.appendChild(bar);
}

/**
 * Add the vulnerability window bar (semi-transparent hatched overlay).
 */
function addVulnerabilityBar(track, m, range) {
  var vulStart = normMins(m.vul_start, range);
  var vulEnd   = normMins(m.vul_end,   range);
  if (vulStart == null || vulEnd == null) { return; }

  var span     = range.max - range.min;
  var leftPct  = timeToLeftPct(vulStart, range.min, span);
  var widthPct = timeSpanToWidthPct(vulStart, vulEnd, span);
  var title    = m.callsign + ' VUL · '
               + fmtTime(m.vul_start) + ' – ' + fmtTime(m.vul_end);

  var bar = el('div', 'tl-bar vul');
  bar.style.left  = leftPct + '%';
  bar.style.width = widthPct + '%';
  bar.title       = title;
  track.appendChild(bar);
}

/**
 * Add TOT / TOS / legacy mission window bars.
 */
function addMissionBars(track, m, missionIdx, range) {
  var target = m.targets && m.targets[0];
  var hasTOT = target && (target.tot_net || target.tot_nlt);
  var hasTOS = target && (target.tos || target.toffs);
  var color  = typeColor(m.mission_type);
  var span   = range.max - range.min;

  if (hasTOT || hasTOS) {
    if (hasTOS) {
      addBarIfValid(track, missionIdx, {
        startTime: target.tos,
        endTime:   target.toffs,
        cssClass:  'tos',
        color:     color,
        title:     m.callsign + ' TOS · ' + fmtTime(target.tos)
                 + ' – TOFFS ' + fmtTime(target.toffs),
        label:     m.callsign || '',
        range:     range,
        span:      span,
      });
    }
    if (hasTOT) {
      addBarIfValid(track, missionIdx, {
        startTime: target.tot_net,
        endTime:   target.tot_nlt,
        cssClass:  'tot',
        color:     color,
        title:     m.callsign + ' TOT · ' + fmtTime(target.tot_net)
                 + ' – ' + fmtTime(target.tot_nlt),
        label:     hasTOS ? '' : (m.callsign || ''),
        range:     range,
        span:      span,
      });
    }
  } else if (target) {
    addBarIfValid(track, missionIdx, {
      startTime: target.not_earlier_than,
      endTime:   target.not_later_than,
      cssClass:  '',
      color:     color,
      title:     m.callsign + ' · ' + fmtTime(target.not_earlier_than)
               + ' – ' + fmtTime(target.not_later_than),
      label:     m.callsign || '',
      range:     range,
      span:      span,
    });
  }
}

/**
 * Add the AAR / refuel hatched bar.
 */
function addRefuelBar(track, m, range) {
  if (!m.refuel) { return; }
  var rStart = normMins(m.refuel.not_earlier_than, range);
  var rEnd   = normMins(m.refuel.not_later_than,   range);
  if (rStart == null || rEnd == null) { return; }

  var span     = range.max - range.min;
  var leftPct  = timeToLeftPct(rStart, range.min, span);
  var widthPct = timeSpanToWidthPct(rStart, rEnd, span);
  var title    = (m.refuel.tanker_callsign || '') + ' ' + (m.refuel.altitude || '')
               + ' · ' + fmtTime(m.refuel.not_earlier_than)
               + ' – ' + fmtTime(m.refuel.not_later_than);

  var bar = el('div', 'tl-bar refuel');
  bar.style.left  = leftPct + '%';
  bar.style.width = widthPct + '%';
  bar.title       = title;
  track.appendChild(bar);
}

/**
 * Add a vertical marker (takeoff or recovery).
 */
function addTimeMarker(track, timeValue, cssClass, tooltipPrefix, range) {
  var mins = normMins(timeValue, range);
  if (mins == null) { return; }

  var span   = range.max - range.min;
  var marker = el('div', 'tl-marker ' + cssClass);
  marker.style.left = timeToLeftPct(mins, range.min, span) + '%';
  marker.title      = tooltipPrefix + ' ' + fmtTime(timeValue);
  track.appendChild(marker);
}

/**
 * Build one mission row for the timeline (label + track with bars).
 */
function buildMissionRow(m, missionIdx, range) {
  var color = typeColor(m.mission_type);
  var row   = el('div', 'tl-row');

  // Callsign label
  var label   = el('div', 'tl-label');
  var csLabel = el('div', 'tl-label-callsign', m.callsign || '—');
  csLabel.style.color = color;
  label.appendChild(csLabel);
  label.appendChild(el('div', 'tl-label-type',
    (m.mission_type || '') + ' · ' + (m.mission_number || '')));
  row.appendChild(label);

  // Track area with all bars and markers
  var track = el('div', 'tl-track');
  addGridLines(track, range);
  addVulnerabilityBar(track, m, range);
  addMissionBars(track, m, missionIdx, range);
  addRefuelBar(track, m, range);
  addTimeMarker(track, m.takeoff_time,  'takeoff',  'T/O', range);
  addTimeMarker(track, m.recovery_time, 'recovery', 'REC', range);
  row.appendChild(track);

  return row;
}

/**
 * Update the header bar above the timeline (mode label + time range).
 */
function updateTimelineHeader(range) {
  var suffix = STATE.display.timeMode;

  document.getElementById(DOM_IDS.tlRange).textContent =
    formatTickLabel(range.min) + ' – ' + formatTickLabel(range.max);

  // The mode prefix text; colored legend swatches are in the HTML/CSS
  var modeLabel = document.getElementById(DOM_IDS.tlModeLabel);
  if (modeLabel) {
    modeLabel.textContent = 'TIMELINE — ' + (suffix === 'L' ? 'LOCAL' : 'ZULU');
  }
}

function renderTimeline(missions) {
  var canvas = document.getElementById(DOM_IDS.tlCanvas);
  canvas.innerHTML = '';

  var range = computeTimeRange(missions);
  if (!range) {
    canvas.appendChild(el('div', 'empty-state', 'NO TIME DATA'));
    return;
  }

  updateTimelineHeader(range);
  canvas.appendChild(buildTicksRow(range));

  missions.forEach(function (m, i) {
    canvas.appendChild(buildMissionRow(m, i, range));
  });
}

// ═════════════════════════════════════════════════════════════
// Mission detail panel — expanded view on card/bar click
// ═════════════════════════════════════════════════════════════

/**
 * Build a detail column with a section title and builder callback.
 */
function buildDetailColumn(title, buildFn) {
  var col     = el('div', 'detail-col');
  var titleEl = el('div', 'detail-section-title', title);

  if (title === 'IDENTIFICATION') {
    var closeBtn = el('button', 'close-detail', '✕ CLOSE');
    closeBtn.onclick = closeDetail;
    titleEl.appendChild(closeBtn);
  }

  col.appendChild(titleEl);
  buildFn(col);
  return col;
}

/**
 * Append a key / value detail field to a parent element.
 */
function detailField(parent, key, value, valueCls) {
  var field = el('div', 'detail-field');
  field.appendChild(el('div', 'dk', key));
  field.appendChild(el('div', 'dv' + (valueCls ? ' ' + valueCls : ''), value));
  parent.appendChild(field);
}

/**
 * Append a time-pair widget (two labeled time boxes with an arrow).
 */
function detailTimePair(parent, label, startVal, endVal, startLabel, endLabel) {
  var lbl1 = startLabel || 'NET';
  var lbl2 = endLabel   || 'NLT';

  var field = el('div', 'detail-field');
  field.appendChild(el('div', 'dk', label));

  var pair = el('div', 'time-pair');

  var box1 = el('div', 'time-box');
  box1.appendChild(el('div', 'time-box-lbl', lbl1));
  box1.appendChild(el('div', 'time-box-val', fmtTime(startVal)));
  pair.appendChild(box1);

  pair.appendChild(el('div', 'time-arr', '→'));

  var box2 = el('div', 'time-box');
  box2.appendChild(el('div', 'time-box-lbl', lbl2));
  box2.appendChild(el('div', 'time-box-val', fmtTime(endVal)));
  pair.appendChild(box2);

  field.appendChild(pair);
  parent.appendChild(field);
}

/**
 * Build a single aim-point entry element.
 */
function buildAimPointEntry(point) {
  if (!point || typeof point !== 'object') {
    return el('div', 'dmpi-entry', String(point));
  }

  var ref      = point._resolved_target;
  var parsed   = parseCoord(point.coords);
  var coordStr = parsed ? fmtCoord(parsed.lat, parsed.lon) : (point.coords || '');
  var text     = [point.name, coordStr].filter(Boolean).join(' — ');
  if (point.elevation) { text += ' · ' + point.elevation; }

  var entry = el('div', 'dmpi-entry', text);

  if (ref) {
    entry.prepend(el('span', 'target-type-badge', ref.type));

    if (ref.type === 'SAM' || ref.type === 'EWR') {
      var samParts = [];
      if (ref.engagement_range_nm) { samParts.push('ER: ' + ref.engagement_range_nm + 'nm'); }
      if (ref.max_alt_ft)          { samParts.push('Max Alt: ' + ref.max_alt_ft + 'ft'); }
      if (samParts.length) {
        entry.appendChild(el('div', 'sam-info', samParts.join(' · ')));
      }
    }
  }

  return entry;
}

function selectMission(idx) {
  if (STATE.selectedIdx === idx) {
    closeDetail();
    return;
  }
  STATE.selectedIdx = idx;

  document.querySelectorAll('.mission-card').forEach(function (card, i) {
    card.classList.toggle('selected', i === idx);
  });

  var m = STATE.pkg.ato.missions[idx];
  if (!m) { return; }

  var panel = document.getElementById(DOM_IDS.detailPanel);
  var inner = document.getElementById(DOM_IDS.detailInner);
  panel.classList.add('open');
  inner.innerHTML = '';

  var color = typeColor(m.mission_type);

  // COL 1 — Identification
  inner.appendChild(buildDetailColumn('IDENTIFICATION', function (col) {
    var csField = el('div', 'detail-field');
    csField.appendChild(el('div', 'dk', 'CALLSIGN'));
    var csVal = el('div', 'dv big', m.callsign || '—');
    csVal.style.color = color;
    csField.appendChild(csVal);
    col.appendChild(csField);

    detailField(col, 'MISSION NO', m.mission_number || '—');

    var typeStr = m.mission_type || '—';
    var firstTgt0 = m.targets && m.targets[0];
    if (firstTgt0 && firstTgt0.mission_type_override) {
      typeStr += ' / ' + firstTgt0.mission_type_override;
    }
    detailField(col, 'TYPE', typeStr);
    detailField(col, 'UNIT', m.unit || '—');
    detailField(col, 'BASE → DEPLOY',
      (m.home_base_icao || '?') + ' → ' + (m.deploy_location_icao || '?'), 'sm');
    detailField(col, 'AIRCRAFT',
      m.aircraft ? m.aircraft.count + '× ' + m.aircraft.type : '—');

    if (m.takeoff_time)  { detailField(col, 'TAKEOFF',  fmtTime(m.takeoff_time), 'time'); }
    if (m.recovery_time) { detailField(col, 'RECOVERY', fmtTime(m.recovery_time), 'time'); }

    if (m.vul_start || m.vul_end) {
      detailTimePair(col, 'VULNERABILITY WINDOW', m.vul_start, m.vul_end, 'START', 'END');
    }

    if (m.coordination && m.coordination.length) {
      var coordField = el('div', 'detail-field');
      coordField.appendChild(el('div', 'dk', 'COORDINATION'));
      m.coordination.forEach(function (c) {
        var line = el('div', 'dmpi-entry',
          (c.mission || '—') + ' — ' + (c.type || '') +
          (c.notes ? ' · ' + c.notes : ''));
        coordField.appendChild(line);
      });
      col.appendChild(coordField);
    }
  }));

  // COL 2 — Loadout
  inner.appendChild(buildDetailColumn('LOADOUT', function (col) {
    if (m.aircraft && m.aircraft.loadout) {
      var lf = el('div', 'detail-field');
      lf.appendChild(loadoutWidget(m.aircraft.loadout));
      col.appendChild(lf);
    } else {
      detailField(col, 'LOADOUT', '—', 'sm');
    }
  }));

  // COL 3 — Target
  inner.appendChild(buildDetailColumn('TARGET', function (col) {
    var targets = m.targets || [];
    if (!targets.length) {
      detailField(col, 'LOCATION', '—');
    } else {
      targets.forEach(function (target, ti) {
        if (targets.length > 1) {
          col.appendChild(el('div', 'dk', 'TARGET ' + (ti + 1)));
        }
        detailField(col, 'LOCATION', target.location || '—');
        detailField(col, 'ALTITUDE', target.altitude || '—');

        var hasTOT = target.tot_net || target.tot_nlt;
        var hasTOS = target.tos || target.toffs;

        if (hasTOT || hasTOS) {
          if (hasTOT) {
            detailTimePair(col, 'TIME ON TARGET (TOT)', target.tot_net, target.tot_nlt);
          }
          if (hasTOS) {
            detailTimePair(col, 'TIME ON STATION (TOS)', target.tos, target.toffs, 'TOS', 'TOFFS');
          }
        } else {
          detailTimePair(col, 'TIME ON TARGET', target.not_earlier_than, target.not_later_than);
        }

        var aimPoints = target.aim_points;
        if (aimPoints && aimPoints.length) {
          var apField = el('div', 'detail-field');
          apField.appendChild(el('div', 'dk', 'AIM POINTS (' + aimPoints.length + ')'));
          aimPoints.forEach(function (p) {
            apField.appendChild(buildAimPointEntry(p));
          });
          col.appendChild(apField);
        }
      });
    }
  }));

  // COL 4 — AAR / Refuel
  inner.appendChild(buildDetailColumn('AAR / REFUEL', function (col) {
    if (!m.refuel) {
      detailField(col, 'STATUS', 'No AAR planned', 'sm');
      return;
    }
    detailField(col, 'TANKER',   m.refuel.tanker_callsign || '—');
    detailField(col, 'AR TRACK', m.refuel.ar_track || '—');
    detailField(col, 'ALTITUDE', m.refuel.altitude || '—');
    detailTimePair(col, 'AAR WINDOW', m.refuel.not_earlier_than, m.refuel.not_later_than);
  }));

  // COL 5 — Comms
  inner.appendChild(buildDetailColumn('COMMS', function (col) {
    var agency = m.control ? m.control._agency : null;
    if (agency) {
      detailField(col, 'CONTROL AGENCY', (agency.type || '') + ' — ' + (agency.callsign || '—'));
    }

    var primaryFreq   = m.control && m.control.primary_freq_mhz
      ? m.control.primary_freq_mhz + ' MHz' : '—';
    var secondaryFreq = m.control && m.control.secondary_freq_mhz
      ? m.control.secondary_freq_mhz + ' MHz' : '—';

    detailField(col, 'PRIMARY FREQ',   primaryFreq,   'freq');
    detailField(col, 'SECONDARY FREQ', secondaryFreq, 'freq');
    detailField(col, 'NET',            m.control ? m.control.net_name || '—' : '—');
    detailField(col, 'AAR LOCATION',   m.aar_location_icao || '—');
  }));
}

function closeDetail() {
  STATE.selectedIdx = -1;
  document.getElementById(DOM_IDS.detailPanel).classList.remove('open');
  document.querySelectorAll('.mission-card').forEach(function (c) {
    c.classList.remove('selected');
  });
}