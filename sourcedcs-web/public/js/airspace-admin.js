/* Airspace admin page. Every read and write goes through /api/airspaces*, which
   forwards to crc-sync: the web keeps no copy (docs/adr/0098). getToken, getUser,
   isBookingAdminRole, authHeaders, esc, logout, loginWithCasdoor come from /js/auth.js. */
'use strict';

var AA_TYPES = { AREA: ['MOA', 'RANGE', 'DANGER', 'RESTRICTED', 'PROHIBITED', 'WARNING'], ROUTE: ['IR', 'VR', 'SR', 'LLTR'] };
/* R3-23: while an airspace is not RETURNED, only these fields may change (crc-sync enforces it again) */
var AA_LOCK_OK = ['name', 'workingFrequencyMhz', 'controlFrequencyMhz'];
var AA_PATCHABLE = ['name', 'type', 'controllingFacilityId', 'controllingPositionId', 'usingPositionId', 'usingFacilityId',
  'workingFrequencyMhz', 'controlFrequencyMhz', 'altLowerFt', 'altUpperFt', 'geometry', 'segments', 'defaultWidthNm'];

var aaToken = getToken();
var aa = { theaters: [], theater: '', list: [], ed: null, legacy: [] };

function $(id) { return document.getElementById(id); }
function aaHeaders(json) { var h = authHeaders(aaToken); if (json) h['Content-Type'] = 'application/json'; return h; }
function aaApi(method, url, body) {
  return fetch(url, { method: method, headers: aaHeaders(!!body), body: body ? JSON.stringify(body) : undefined })
    .then(function (r) { return r.json().then(function (j) { return { status: r.status, ok: r.ok, body: j }; }, function () { return { status: r.status, ok: false, body: { error: 'Unreadable answer (HTTP ' + r.status + ')' } }; }); });
}
function aaBanner(msg, kind) {
  $('aaBanner').innerHTML = msg ? '<div class="aa-banner aa-banner--' + (kind || 'err') + '">' + esc(msg) + '</div>' : '';
}
function aaDown(res) {
  if (res.status === 503) { aaBanner('crc-sync unreachable: the registry cannot be read or changed right now. Booking controller positions still works.', 'err'); return true; }
  return false;
}

/* ── init ── */
(function () {
  var user = getUser(), btn = $('loginBtn');
  if (aaToken && user && btn) { btn.textContent = (user.name || 'USER').toUpperCase() + ' ⏻'; btn.classList.add('login-btn--logout'); btn.onclick = logout; }
  if (!aaToken || !isBookingAdminRole(aaToken)) { $('aaDenied').style.display = ''; return; }
  $('aaMain').style.display = '';
  $('aaTheater').addEventListener('change', function () { aa.theater = this.value; aaLoadList(); });
  $('aaUseTheater').addEventListener('click', function () {
    var t = $('aaNewTheater').value.trim();
    if (!t) return;
    if (aa.theaters.indexOf(t) === -1) aa.theaters.push(t);
    aa.theater = t; $('aaNewTheater').value = ''; aaRenderTheaters(); aaLoadList();
  });
  $('aaReload').addEventListener('click', function () { aaLoadList(); aaLoadLegacy(); });
  $('aaCreate').addEventListener('click', function () { aaOpenEditor(null); });
  $('aaTable').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-id]');
    if (tr) aaOpenEditor(tr.getAttribute('data-id'));
  });
  $('aaEditor').addEventListener('click', aaEditorClick);
  $('aaLegacyTable').addEventListener('click', aaLegacyClick);
  $('aaLegacyTable').addEventListener('change', aaLegacyChange);
  aaLoadTheaters();
  aaLoadLegacy();
})();

function aaLoadTheaters() {
  aaApi('GET', '/api/airspaces/theaters').then(function (res) {
    if (aaDown(res)) { aa.theaters = []; aaRenderTheaters(); return; }
    aa.theaters = (res.body.theaters || []).map(function (t) { return t.theater; });
    if (!aa.theater && aa.theaters.length) aa.theater = aa.theaters[0];
    aaRenderTheaters();
    if (aa.theater) aaLoadList();
  });
}
function aaRenderTheaters() {
  $('aaTheater').innerHTML = aa.theaters.map(function (t) {
    return '<option value="' + esc(t) + '"' + (t === aa.theater ? ' selected' : '') + '>' + esc(t) + '</option>';
  }).join('') || '<option value="">(none yet)</option>';
}

/* ── list ── */
function aaLoadList() {
  if (!aa.theater) { aa.list = []; aaRenderTable(); return; }
  aaApi('GET', '/api/airspaces?theater=' + encodeURIComponent(aa.theater)).then(function (res) {
    if (aaDown(res)) return;
    if (!res.ok) { aaBanner(res.body.error || 'Could not load airspaces.'); return; }
    aaBanner('');
    aa.list = res.body.airspaces || [];
    aaRenderTable();
  });
}
function aaFmtAlt(d) {
  return (d.altLowerFt == null ? 'SFC' : d.altLowerFt) + ' - ' + (d.altUpperFt == null ? 'UNL' : d.altUpperFt) + ' ft';
}
function aaRenderTable() {
  var rows = aa.list.map(function (e) {
    var d = e.definition || {};
    var using = d.usingPositionId ? 'Position ' + d.usingPositionId : (d.usingFacilityId ? 'Facility ' + d.usingFacilityId : '—');
    var freqs = [d.workingFrequencyMhz != null ? 'W ' + d.workingFrequencyMhz : '', d.controlFrequencyMhz != null ? 'C ' + d.controlFrequencyMhz : ''].filter(Boolean).join(' / ') || '—';
    return '<tr class="aa-row" data-id="' + esc(d.airspaceId) + '"><td>' + esc(d.kind) + '</td><td>' + esc(d.type || '—') + '</td><td>' + esc(d.airspaceId) + '</td><td>' + esc(d.name) + '</td>' +
      '<td>' + esc((d.controllingFacilityId || '') + ' / ' + (d.controllingPositionId || '')) + '</td><td>' + esc(using) + '</td><td>' + esc(freqs) + '</td><td>' + esc(aaFmtAlt(d)) + '</td>' +
      '<td><span class="aa-state aa-state--' + esc(e.state) + '">' + esc(e.state || '?') + '</span>' + (e.pendingRequest ? ' <span class="aa-state">REQUEST</span>' : '') + '</td></tr>';
  }).join('');
  $('aaTable').innerHTML = '<thead><tr><th>KIND</th><th>TYPE</th><th>ID</th><th>NAME</th><th>CONTROLLING FACILITY / POSITION</th><th>USING AGENCY</th><th>FREQUENCIES (MHZ)</th><th>LIMITS</th><th>STATE</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="9">No airspaces in ' + esc(aa.theater || 'this theater') + ' yet.</td></tr>') + '</tbody>';
}

/* ── editor ── */
function aaFind(id) { return aa.list.filter(function (e) { return e.definition && e.definition.airspaceId === id; })[0] || null; }
function aaStr(v) { return v == null ? '' : String(v); }

function aaOpenEditor(id) {
  var entry = id ? aaFind(id) : null;
  var d = entry ? JSON.parse(JSON.stringify(entry.definition)) : { kind: 'AREA', geometry: null };
  aa.ed = { mode: entry ? 'edit' : 'create', entry: entry, orig: JSON.parse(JSON.stringify(d)), kind: d.kind || 'AREA',
    points: (d.geometry && d.geometry.points ? d.geometry.points : []).map(function (p) { return [String(p[0]), String(p[1])]; }),
    segments: (d.segments || []).map(function (s) { return { name: s.fix.name, lat: String(s.fix.lat), lon: String(s.fix.lon), lo: aaStr(s.altLowerFt), hi: aaStr(s.altUpperFt), w: aaStr(s.widthNm) }; }),
    result: '' };
  aaRenderEditor();
  $('aaEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function aaLocked() {
  var e = aa.ed.entry;
  return !!(e && (e.state !== 'RETURNED' || e.pendingRequest));
}
function aaField(label, id, value, opts) {
  opts = opts || {};
  var dis = opts.disabled ? ' disabled' : '';
  return '<div class="form-group"><label class="form-label" for="' + id + '">' + label + '</label>' +
    '<input class="form-input" id="' + id + '" type="text" value="' + esc(value) + '"' + (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') + dis + ' autocomplete="off"></div>';
}

function aaRenderEditor() {
  var ed = aa.ed, d = ed.draft || ed.orig, lock = aaLocked(), isCreate = ed.mode === 'create';
  var nl = function (f) { return lock && AA_LOCK_OK.indexOf(f) === -1; };   /* locked field */
  var kind = ed.kind;
  var typeOpts = ['<option value="">(none)</option>'].concat(AA_TYPES[kind].map(function (t) { return '<option' + (d.type === t ? ' selected' : '') + '>' + t + '</option>'; })).join('');
  var h = '<div class="aa-panel-head"><span>' + (isCreate ? 'NEW AIRSPACE IN ' + esc(aa.theater.toUpperCase()) : 'EDIT ' + esc(d.airspaceId) + ' (revision ' + esc(ed.entry.defRev) + ', ' + esc(ed.entry.state) + ')') + '</span><button class="bk-link-btn" data-act="close">CLOSE</button></div><div class="aa-panel-body">';
  if (lock) h += '<div class="aa-lock">This airspace is ' + esc(ed.entry.state) + (ed.entry.pendingRequest ? ' with a pending request' : '') + ': only the name and the frequencies can be edited until it is RETURNED. crc-sync enforces the same rule.</div>';
  h += '<div class="aa-grid">';
  h += aaField('AIRSPACE ID', 'aaId', d.airspaceId, { disabled: !isCreate, ph: 'MOA-ALPHA' });
  h += aaField('NAME', 'aaName', d.name, { ph: 'up to 40 characters' });
  h += '<div class="form-group"><label class="form-label" for="aaKind">KIND</label><select class="form-select" id="aaKind"' + (isCreate ? '' : ' disabled') + '><option' + (kind === 'AREA' ? ' selected' : '') + '>AREA</option><option' + (kind === 'ROUTE' ? ' selected' : '') + '>ROUTE</option></select></div>';
  h += '<div class="form-group"><label class="form-label" for="aaType">TYPE (DESCRIPTIVE ONLY)</label><select class="form-select" id="aaType"' + (nl('type') ? ' disabled' : '') + '>' + typeOpts + '</select></div>';
  h += aaField('CONTROLLING FACILITY', 'aaCFac', d.controllingFacilityId, { disabled: nl('controllingFacilityId'), ph: 'e.g. CENTER' });
  h += aaField('CONTROLLING POSITION', 'aaCPos', d.controllingPositionId, { disabled: nl('controllingPositionId'), ph: 'e.g. CTR' });
  h += aaField('USING AGENCY: POSITION (A RANGES POSITION)', 'aaUPos', d.usingPositionId, { disabled: nl('usingPositionId') });
  h += aaField('USING AGENCY: FACILITY (AS A WHOLE)', 'aaUFac', d.usingFacilityId, { disabled: nl('usingFacilityId'), ph: 'e.g. TACTICAL' });
  h += aaField('WORKING FREQUENCY (MHZ)', 'aaWF', aaStr(d.workingFrequencyMhz), { ph: '30 to 400' });
  h += aaField('CONTROL FREQUENCY (MHZ)', 'aaCF', aaStr(d.controlFrequencyMhz));
  if (kind === 'AREA') {
    h += aaField('LOWER LIMIT (FT, BLANK = SURFACE)', 'aaLo', aaStr(d.altLowerFt), { disabled: nl('altLowerFt') });
    h += aaField('UPPER LIMIT (FT, BLANK = UNBOUNDED)', 'aaHi', aaStr(d.altUpperFt), { disabled: nl('altUpperFt') });
  } else {
    h += aaField('DEFAULT WIDTH (NM)', 'aaDW', aaStr(d.defaultWidthNm), { disabled: nl('defaultWidthNm') });
  }
  h += '</div><div class="bk-hint">Altitudes are indicated feet: below the transition altitude on QNH, at and above it pressure altitude (FL230 is 23000).</div>';
  h += kind === 'AREA' ? aaGeometryHtml(d, nl('geometry')) : aaSegmentsHtml(nl('segments'));
  h += '<div id="aaEditResult">' + ed.result + '</div>';
  h += '<div class="aa-actions"><button class="btn btn-primary" data-act="save">' + (isCreate ? 'CREATE' : 'SAVE CHANGES') + '</button>' +
    (isCreate ? '' : '<button class="btn btn-ghost" data-act="delete">DELETE</button>') + '</div></div>';
  $('aaEditor').innerHTML = h;
  $('aaEditor').style.display = '';
  var k = $('aaKind');
  if (k && isCreate) k.addEventListener('change', function () { aaSyncDom(); aa.ed.draft = aaDraft(); aa.ed.kind = k.value; aaRenderEditor(); });
}

function aaGeometryHtml(d, locked) {
  var ed = aa.ed, g = d.geometry;
  if (g && g.source === 'DCS_DRAWING') {
    var ref = g.drawingRef || {};
    return '<div class="aa-sub">GEOMETRY</div><div class="aa-geo"><div><div class="bk-hint">From DCS drawing ' + esc((ref.layerName || '?') + '/' + (ref.objectName || '?')) + ' (read-only; the panel can refresh it from the mission).</div>' +
      '<table class="aa-table aa-coords"><tbody>' + (g.points || []).map(function (p, i) { return '<tr><td>' + (i + 1) + '</td><td>' + esc(p[0]) + '</td><td>' + esc(p[1]) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      AirspaceCoords.outlineSvg(g.points || [], true) + '</div>';
  }
  var dis = locked ? ' disabled' : '';
  var rows = ed.points.map(function (p, i) {
    return '<tr><td>' + (i + 1) + '</td><td><input class="form-input" data-pt="' + i + '" data-ax="0" value="' + esc(p[0]) + '"' + dis + '></td><td><input class="form-input" data-pt="' + i + '" data-ax="1" value="' + esc(p[1]) + '"' + dis + '></td>' +
      '<td>' + (locked ? '' : '<button class="bk-link-btn bk-link-btn--danger" data-act="rmpt" data-i="' + i + '">&times;</button>') + '</td></tr>';
  }).join('');
  var parsed = aaParseRows(ed.points);
  return '<div class="aa-sub">GEOMETRY: POLYGON (OPTIONAL; NO OUTLINE MEANS CONTAINMENT IS UNKNOWN)</div><div class="aa-geo"><div>' +
    '<table class="aa-table aa-coords"><thead><tr><th>#</th><th>LATITUDE</th><th>LONGITUDE</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
    (locked ? '' : '<button class="btn btn-ghost" style="font-size:9px;padding:6px 12px" data-act="addpt">+ POINT</button>') +
    '<div class="bk-hint">Decimal degrees or DMS (N36°12\'30" E036°45\'00"). 3 to 200 points, the first point not repeated at the end.</div>' +
    (locked ? '' : '<textarea class="form-input" id="aaPaste" rows="4" placeholder="Paste one point per line"></textarea><button class="btn btn-ghost" style="font-size:9px;padding:6px 12px" data-act="paste">REPLACE FROM PASTE</button>') +
    '</div>' + AirspaceCoords.outlineSvg(parsed.points, true) + '</div>';
}

function aaSegmentsHtml(locked) {
  var ed = aa.ed, dis = locked ? ' disabled' : '';
  var last = ed.segments.length - 1;
  var rows = ed.segments.map(function (s, i) {
    var exit = i === last;
    var cell = function (k, v, d) { return '<td><input class="form-input" data-seg="' + i + '" data-k="' + k + '" value="' + esc(v) + '"' + (d || dis) + '></td>'; };
    return '<tr><td>' + (i + 1) + '</td>' + cell('name', s.name) + cell('lat', s.lat) + cell('lon', s.lon) + cell('lo', s.lo, exit ? ' disabled' : dis) + cell('hi', s.hi, exit ? ' disabled' : dis) + cell('w', s.w, exit ? ' disabled' : dis) +
      '<td>' + (locked ? '' : '<button class="bk-link-btn bk-link-btn--danger" data-act="rmseg" data-i="' + i + '">&times;</button>') + '</td></tr>';
  }).join('');
  var pts = aaParseRows(ed.segments.map(function (s) { return [s.lat, s.lon]; })).points;
  return '<div class="aa-sub">ROUTE FIXES (THE LAST FIX IS THE EXIT: NO ALTITUDES OR WIDTH)</div><div class="aa-geo"><div><div class="aa-scroll">' +
    '<table class="aa-table aa-coords"><thead><tr><th>#</th><th>FIX</th><th>LATITUDE</th><th>LONGITUDE</th><th>LOWER FT</th><th>UPPER FT</th><th>WIDTH NM</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    (locked ? '' : '<button class="btn btn-ghost" style="font-size:9px;padding:6px 12px" data-act="addseg">+ FIX</button>') +
    '<div class="bk-hint">At least 2 fixes. The leg from fix N to fix N+1 uses fix N\'s altitudes and width. A blank width uses the default width.</div></div>' +
    AirspaceCoords.outlineSvg(pts, false) + '</div>';
}

/* strings -> numbers; rows with an unparsable cell are skipped for the preview, reported on save */
function aaParseRows(rows) {
  var points = [], bad = [];
  rows.forEach(function (r, i) {
    var la = AirspaceCoords.parseCoord(r[0], 'lat'), lo = AirspaceCoords.parseCoord(r[1], 'lon');
    if (la === null || lo === null) bad.push(i + 1); else points.push([la, lo]);
  });
  return { points: points, bad: bad };
}

/* copy what is typed in the table back into aa.ed so a re-render keeps it */
function aaSyncDom() {
  var ed = aa.ed;
  Array.prototype.forEach.call($('aaEditor').querySelectorAll('input[data-pt]'), function (el) { ed.points[+el.getAttribute('data-pt')][+el.getAttribute('data-ax')] = el.value; });
  Array.prototype.forEach.call($('aaEditor').querySelectorAll('input[data-seg]'), function (el) { ed.segments[+el.getAttribute('data-seg')][el.getAttribute('data-k')] = el.value; });
}
/* What is typed in the form right now, shaped like a definition with raw strings, so a re-render
   (add a point, change kind) keeps it. ed.orig stays untouched: it is the base the patch is diffed against. */
function aaDraft() {
  var o = JSON.parse(JSON.stringify(aa.ed.draft || aa.ed.orig));
  var v = function (id) { var el = $(id); return el ? el.value.trim() : undefined; };
  var set = function (k, id) { var x = v(id); if (x !== undefined) o[k] = x === '' ? undefined : x; };
  set('airspaceId', 'aaId'); set('name', 'aaName'); set('controllingFacilityId', 'aaCFac'); set('controllingPositionId', 'aaCPos');
  set('usingPositionId', 'aaUPos'); set('usingFacilityId', 'aaUFac'); set('type', 'aaType');
  set('workingFrequencyMhz', 'aaWF'); set('controlFrequencyMhz', 'aaCF'); set('altLowerFt', 'aaLo'); set('altUpperFt', 'aaHi'); set('defaultWidthNm', 'aaDW');
  return o;
}

function aaEditorClick(e) {
  var b = e.target.closest('[data-act]');
  if (!b) return;
  var act = b.getAttribute('data-act'), ed = aa.ed;
  if (act === 'close') { $('aaEditor').style.display = 'none'; aa.ed = null; return; }
  aaSyncDom();
  if (act === 'addpt') { ed.points.push(['', '']); keep(); }
  else if (act === 'rmpt') { ed.points.splice(+b.getAttribute('data-i'), 1); keep(); }
  else if (act === 'addseg') { ed.segments.push({ name: '', lat: '', lon: '', lo: '', hi: '', w: '' }); keep(); }
  else if (act === 'rmseg') { ed.segments.splice(+b.getAttribute('data-i'), 1); keep(); }
  else if (act === 'paste') {
    var r = AirspaceCoords.parsePoints($('aaPaste').value);
    if (r.badLines.length) { ed.result = '<div class="form-error">Could not read line(s): ' + esc(r.badLines.join(', ')) + '.</div>'; keep(); return; }
    ed.points = r.points.map(function (p) { return [String(p[0]), String(p[1])]; }); ed.result = ''; keep();
  }
  else if (act === 'save') aaSave();
  else if (act === 'delete') aaDelete();
  function keep() { ed.draft = aaDraft(); aaRenderEditor(); }
}

/* Build the form's values as a definition. Returns { def } or { errors: [...] } */
function aaReadForm() {
  var ed = aa.ed, errs = [], d = {};
  var txt = function (id) { var el = $(id); return el ? el.value.trim() : ''; };
  var optStr = function (id) { return txt(id) === '' ? null : txt(id); };
  var optNum = function (id, label, int) {
    var s = txt(id); if (s === '') return null;
    var n = Number(s);
    if (!isFinite(n) || (int && Math.floor(n) !== n)) { errs.push(label + ' must be a number' + (int ? ' (whole feet)' : '') + '.'); return null; }
    return n;
  };
  d.airspaceId = ed.mode === 'create' ? txt('aaId') : ed.orig.airspaceId;
  d.name = txt('aaName');
  d.kind = ed.kind;
  d.type = optStr('aaType');
  d.controllingFacilityId = txt('aaCFac'); d.controllingPositionId = txt('aaCPos');
  d.usingPositionId = optStr('aaUPos'); d.usingFacilityId = optStr('aaUFac');
  d.workingFrequencyMhz = optNum('aaWF', 'Working frequency');
  d.controlFrequencyMhz = optNum('aaCF', 'Control frequency');
  if (d.usingPositionId && d.usingFacilityId) errs.push('Set at most one using agency: a Position or a Facility.');
  if (ed.mode === 'create' && !/^[A-Z0-9][A-Z0-9-]{1,23}$/.test(d.airspaceId)) errs.push('Airspace ID: 2 to 24 characters, capitals, digits and dashes, starting with a capital or digit.');
  if (!d.name || d.name.length > 40) errs.push('Name: 1 to 40 characters.');
  if (!d.controllingFacilityId || !d.controllingPositionId) errs.push('Controlling Facility and Position are required.');
  if (ed.kind === 'AREA') {
    d.altLowerFt = optNum('aaLo', 'Lower limit', true); d.altUpperFt = optNum('aaHi', 'Upper limit', true);
    if (d.altLowerFt != null && d.altUpperFt != null && d.altLowerFt > d.altUpperFt) errs.push('Lower limit is above the upper limit.');
    var g = ed.orig.geometry;
    if (g && g.source === 'DCS_DRAWING') d.geometry = g;
    else if (!ed.points.length) d.geometry = null;
    else {
      var pr = aaParseRows(ed.points);
      if (pr.bad.length) errs.push('Polygon point(s) not readable: ' + pr.bad.join(', ') + '.');
      if (ed.points.length < 3 || ed.points.length > 200) errs.push('A polygon needs 3 to 200 points (or none).');
      d.geometry = { source: 'POLYGON', points: pr.points };
    }
  } else {
    d.defaultWidthNm = optNum('aaDW', 'Default width');
    if (!(d.defaultWidthNm > 0)) errs.push('A route needs a default width greater than 0.');
    if (ed.segments.length < 2) errs.push('A route needs at least 2 fixes.');
    d.segments = ed.segments.map(function (s, i) {
      var la = AirspaceCoords.parseCoord(s.lat, 'lat'), lo = AirspaceCoords.parseCoord(s.lon, 'lon');
      if (!s.name.trim() || la === null || lo === null) errs.push('Fix ' + (i + 1) + ': a name and a readable latitude and longitude are needed.');
      var exit = i === ed.segments.length - 1;
      var num = function (v) { return v === '' || exit ? null : Number(v); };
      var seg = { fix: { name: s.name.trim(), lat: la, lon: lo }, altLowerFt: num(s.lo), altUpperFt: num(s.hi), widthNm: num(s.w) };
      [seg.altLowerFt, seg.altUpperFt, seg.widthNm].forEach(function (x) { if (x !== null && !isFinite(x)) errs.push('Fix ' + (i + 1) + ': altitudes and width must be numbers.'); });
      return seg;
    });
  }
  return errs.length ? { errors: errs } : { def: d };
}
function aaClean(def) {   /* drop undefined/blank optionals for a create */
  var o = {};
  Object.keys(def).forEach(function (k) { if (def[k] !== undefined && def[k] !== null) o[k] = def[k]; });
  return o;
}
function aaEq(a, b) { return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b); }

function aaShowErrors(list) { $('aaEditResult').innerHTML = '<div class="form-error"><ul class="aa-list">' + list.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></div>'; }

function aaSave(overrideBase) {
  aaSyncDom();
  var ed = aa.ed, r = aaReadForm();
  if (r.errors) { aaShowErrors(r.errors); return; }
  var msg;
  if (ed.mode === 'create') {
    msg = { theater: aa.theater, airspaceId: r.def.airspaceId, op: { kind: 'CreateAirspace', definition: aaClean(r.def) } };
  } else {
    var patch = {}, orig = ed.orig, n = 0;
    AA_PATCHABLE.forEach(function (f) {
      if (r.def[f] === undefined && orig[f] === undefined) return;
      if (ed.kind === 'AREA' && (f === 'segments' || f === 'defaultWidthNm')) return;
      if (ed.kind === 'ROUTE' && (f === 'geometry' || f === 'altLowerFt' || f === 'altUpperFt')) return;
      var mine = r.def[f] === undefined ? null : r.def[f];
      if (!aaEq(mine, orig[f])) { patch[f] = mine; n++; }
    });
    if (!n) { $('aaEditResult').innerHTML = '<div class="bk-hint">Nothing changed.</div>'; return; }
    ed.lastPatch = patch;
    msg = { theater: aa.theater, airspaceId: orig.airspaceId, baseDefRev: overrideBase != null ? overrideBase : ed.entry.defRev, op: { kind: 'EditAirspace', patch: patch } };
  }
  aaSend(msg, function (ack) {
    aaLoadList(); aaLoadTheaters();
    var extra = aaWarning(ack);
    $('aaEditor').innerHTML = '<div class="aa-panel-head"><span>SAVED</span><button class="bk-link-btn" data-act="close">CLOSE</button></div><div class="aa-panel-body"><div class="form-success">' + (ed.mode === 'create' ? 'Airspace created.' : 'Changes saved.') + '</div>' + extra + '</div>';
    aa.ed = { mode: 'closed' };
  });
}

function aaWarning(ack) {
  if (!ack || !ack.warning) return '';
  var occ = Array.isArray(ack.occupied) ? ack.occupied : [];
  return '<div class="aa-banner aa-banner--warn">' + (ack.warning === 'AIRSPACE_EDITED_OCCUPIED' ? 'This airspace is occupied: flights are working in it.' : esc(ack.warning)) +
    (occ.length ? '<ul class="aa-list">' + occ.map(function (o) { return '<li>' + esc(typeof o === 'string' ? o : (o.callsign || o.stripId || JSON.stringify(o))) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
}

function aaSend(msg, onOk) {
  aaApi('POST', '/api/airspaces/mutation', msg).then(function (res) {
    if (aaDown(res)) { $('aaEditResult').innerHTML = '<div class="form-error">crc-sync unreachable: nothing was changed.</div>'; return; }
    var ack = res.body || {};
    if (res.ok && !ack.reason && ack.ok !== false) { aaBanner(''); onOk(ack); return; }
    aaShowRefusal(ack, res);
  });
}

function aaShowRefusal(ack, res) {
  var ed = aa.ed, h = '';
  if (ack.reason === 'STALE_REV' && Array.isArray(ack.conflicts) && ack.conflicts.length) {
    var mine = ed && ed.lastPatch || {};
    h = '<div class="aa-banner aa-banner--warn">Someone else changed these fields since you opened the airspace.</div>' +
      '<table class="aa-conflict"><thead><tr><th>FIELD</th><th>YOURS</th><th>THEIRS</th><th>BASE (WHAT YOU OPENED)</th></tr></thead><tbody>' +
      ack.conflicts.map(function (c) { return '<tr><td>' + esc(c.field) + '</td><td class="aa-pre">' + esc(aaShow(mine[c.field])) + '</td><td class="aa-pre">' + esc(aaShow(c.theirs)) + '</td><td class="aa-pre">' + esc(aaShow(c.base)) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<div class="aa-actions"><button class="btn btn-ghost" data-act="reload">TAKE THEIRS (RELOAD)</button><button class="btn btn-primary" data-act="keepmine">KEEP MINE (RESUBMIT)</button></div>';
  } else {
    h = '<div class="form-error">Refused' + (ack.reason ? ': ' + esc(ack.reason) : '') + (ack.detail ? '. ' + esc(typeof ack.detail === 'string' ? ack.detail : JSON.stringify(ack.detail)) : (ack.error ? '. ' + esc(ack.error) : '')) + '</div>';
    var bl = ack.blockers || ack.occupied;
    if (Array.isArray(bl) && bl.length) h += '<ul class="aa-list">' + bl.map(function (o) { return '<li>' + esc(typeof o === 'string' ? o : (o.callsign || o.stripId || JSON.stringify(o))) + '</li>'; }).join('') + '</ul>';
  }
  $('aaEditResult').innerHTML = h;
  var rb = $('aaEditResult').querySelector('[data-act="reload"]');
  if (rb) { /* handled by the delegated click below */ }
}
function aaShow(v) { return v === undefined || v === null ? '(none)' : (typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v)); }

/* conflict resolution buttons live inside #aaEditResult, which the delegated editor handler covers */
$('aaEditor') && $('aaEditor').addEventListener('click', function (e) {
  var b = e.target.closest('[data-act]'); if (!b) return;
  var act = b.getAttribute('data-act');
  if (act !== 'reload' && act !== 'keepmine') return;
  var id = aa.ed.orig.airspaceId;
  aaApi('GET', '/api/airspaces?theater=' + encodeURIComponent(aa.theater)).then(function (res) {
    if (!res.ok) { aaDown(res); return; }
    aa.list = res.body.airspaces || []; aaRenderTable();
    var fresh = aaFind(id);
    if (!fresh) { $('aaEditResult').innerHTML = '<div class="form-error">The airspace no longer exists.</div>'; return; }
    if (act === 'reload') { aaOpenEditor(id); return; }
    aa.ed.entry = fresh;
    aaSave(fresh.defRev);
  });
});

function aaDelete() {
  var ed = aa.ed;
  if (!confirm('Delete airspace ' + ed.orig.airspaceId + ' from ' + aa.theater + '? This is a hard delete.')) return;
  aaSend({ theater: aa.theater, airspaceId: ed.orig.airspaceId, baseDefRev: ed.entry.defRev, op: { kind: 'DeleteAirspace' } }, function () {
    aaLoadList(); aaLoadTheaters();
    $('aaEditor').style.display = 'none'; aa.ed = null;
  });
}

/* ── legacy range migration (H100 DA-5 b) ── */
function aaLoadLegacy() {
  aaApi('GET', '/api/booking-resources/ranges/legacy').then(function (res) {
    aa.legacy = res.ok ? (res.body.ranges || []) : [];
    $('aaMigration').style.display = aa.legacy.length ? '' : 'none';   /* hides itself once none remain */
    if (!aa.legacy.length) return;
    aa.legacyAirspaces = aa.legacyAirspaces || {};
    $('aaLegacyTable').innerHTML = '<thead><tr><th>ID</th><th>NAME</th><th>BOOKINGS</th><th>FUTURE</th><th>THEATER</th><th>AIRSPACE</th><th></th></tr></thead><tbody>' +
      aa.legacy.map(function (r) {
        return '<tr data-range="' + esc(r.id) + '"><td>' + esc(r.id) + '</td><td>' + esc(r.name) + '</td><td>' + r.bookingCount + '</td><td>' + r.futureBookingCount + '</td>' +
          '<td><select class="form-select" data-role="theater">' + aa.theaters.map(function (t) { return '<option' + (t === aa.theater ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></td>' +
          '<td><select class="form-select" data-role="airspace"><option value="">(pick a theater)</option></select></td>' +
          '<td><button class="btn btn-primary" style="font-size:9px;padding:6px 12px" data-role="migrate">MIGRATE</button></td></tr>';
      }).join('') + '</tbody>';
    Array.prototype.forEach.call($('aaLegacyTable').querySelectorAll('tr[data-range]'), aaFillAirspaces);
  });
}
function aaFillAirspaces(tr) {
  var theater = tr.querySelector('[data-role=theater]').value, sel = tr.querySelector('[data-role=airspace]');
  if (!theater) return;
  aaApi('GET', '/api/airspaces?theater=' + encodeURIComponent(theater)).then(function (res) {
    if (!res.ok) { sel.innerHTML = '<option value="">' + (res.status === 503 ? 'crc-sync unreachable' : 'unavailable') + '</option>'; return; }
    sel.innerHTML = '<option value="">(choose)</option>' + (res.body.airspaces || []).map(function (e) {
      var d = e.definition; return '<option value="' + esc(d.airspaceId) + '">' + esc(d.airspaceId + ' - ' + d.name + ' (' + aaFmtAlt(d) + ')') + '</option>';
    }).join('');
  });
}
function aaLegacyChange(e) { var tr = e.target.closest('tr[data-range]'); if (tr && e.target.getAttribute('data-role') === 'theater') aaFillAirspaces(tr); }
function aaLegacyClick(e) {
  var btn = e.target.closest('[data-role=migrate]'); if (!btn) return;
  var tr = btn.closest('tr'), id = tr.getAttribute('data-range');
  aaMigrate(id, tr.querySelector('[data-role=theater]').value, tr.querySelector('[data-role=airspace]').value, false);
}
function aaMigrate(id, theater, airspaceId, allowOutOfBand) {
  var out = $('aaMigrateResult');
  if (!theater || !airspaceId) { out.innerHTML = '<div class="form-error">Pick a theater and an airspace.</div>'; return; }
  aaApi('POST', '/api/booking-resources/ranges/' + encodeURIComponent(id) + '/migrate', { theater: theater, airspaceId: airspaceId, allowOutOfBand: allowOutOfBand }).then(function (res) {
    if (res.status === 503) { out.innerHTML = '<div class="form-error">crc-sync unreachable: nothing was changed.</div>'; return; }
    if (res.ok) {
      out.innerHTML = '<div class="form-success">Range ' + esc(id) + (res.body.alreadyMigrated ? ' was already migrated' : ' migrated') + ': ' + res.body.moved + ' booking(s) now on ' + esc(theater + ' / ' + airspaceId) + '.</div>';
      aaLoadLegacy(); return;
    }
    var ref = res.body.refusals || [];
    var allBand = ref.length && ref.every(function (r) { return r.kind === 'OUT_OF_BAND'; });
    out.innerHTML = '<div class="form-error">' + esc(res.body.error || 'Migration refused') + '</div><ul class="aa-list">' + ref.map(function (r) {
      if (r.kind === 'OUT_OF_BAND') return '<li>Booking ' + r.bookingId + ' (' + esc(r.by || '') + ', ' + esc(r.startTime) + '): ' + r.altitude + ' ft is outside ' + esc(r.band) + '</li>';
      if (r.kind === 'DECONFLICTION') return '<li>Booking ' + r.bookingId + ' at ' + r.altitude + ' ft overlaps booking ' + r.otherBookingId + ' at ' + r.otherAltitude + ' ft (less than 999 ft apart). Edit or cancel one of them first.</li>';
      return '<li>' + esc(r.detail || r.kind) + '</li>';
    }).join('') + '</ul>' + (allBand ? '<button class="btn btn-ghost" id="aaForceMigrate">MOVE ANYWAY (ALLOW OUT OF BAND)</button>' : '');
    var f = $('aaForceMigrate'); if (f) f.addEventListener('click', function () { aaMigrate(id, theater, airspaceId, true); });
  });
}
