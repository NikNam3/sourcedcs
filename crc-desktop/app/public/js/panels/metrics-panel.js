'use strict';

// The METRICS dock panel — guide §11.5 "instrument from day one", and the
// §11.4 traffic count (docs/adr/0072; the server half is docs/adr/0065).
//
// Read-only. It renders crc-sync's `efsp-metrics` answer and never computes a
// metric itself: every status, rate and percentile is the server's. What this
// file decides is how each one READS:
//
//   - A metric with no source says NOT INSTRUMENTED and a window with nothing
//     in it says NO DATA, in words and in grey. Neither is ever a 0 or a 100%
//     (L5's T13: the correlation rate's "null, never 1.0").
//   - Only NOT MET, and a traffic count that does not reconcile, are coloured
//     (docs/adr/0056: colour means something is wrong; 0058: nothing when
//     nothing is wrong).
//   - Two windows side by side (decisions.md H32, S-R2-4): this mission, and a
//     rolling last hour.
//   - Per-Position numbers are shown, folded behind a toggle (H66). Nothing is
//     ever broken down per person (H35): the server sends nothing keyed by
//     controller, and the view-model is built from named fields only, so a
//     controllerId that reappeared on the wire would still not be shown.
//   - Times are HHMMZ on the mission clock (H11), from the bucket keys.
//
// Polls only while the panel is on screen: on show, then every 30 s.

const METRICS_POLL_MS = 30 * 1000;
const METRICS_VISIBILITY_TICK_MS = 5 * 1000;

// The §11.5 table, in the guide's order.
const METRICS_ROWS = Object.freeze([
  { id: 'searchInvocations', name: 'Search invocations per Position per hour' },
  { id: 'timeToFind', name: 'Time-to-find (selection after Bay entry)' },
  { id: 'gestureInputs', name: 'Inputs per paper gesture' },
  { id: 'correlation', name: 'Strip↔track correlation rate' },
  { id: 'rejectedMutations', name: 'Rejected Mutations, by reason' },
  { id: 'staleness', name: 'Staleness detections' },
  { id: 'transfers', name: 'Transfer failures and causes' },
]);

const METRICS_GESTURES = ['FLIP', 'ATTENTION', 'HIGHLIGHT', 'OFFSET'];

const METRICS_FOOTNOTES = Object.freeze([
  '[SOURCE-DEFINED] Trend: the last three complete hours — ↓ when none rose and at least one fell, → when flat, otherwise the direction of the last step (ADR 0072).',
  '[SOURCE-DEFINED] Time-to-find runs from a Bay coming on screen to the first Strip selected in it; a Bay left, hidden or ignored for 10 min is not counted (ADR 0072).',
  '[SOURCE-DEFINED] Gesture inputs are a declared cost per entry point: double-click 1, Shift+click 1, Alt+click (offset) 1, Ctrl+click (highlight) 1, right-click + swatch 2, ⋯ menu 2 (ADR 0072).',
]);

// ── formatting ─────────────────────────────────────────────────────────────

function _hhmmz(ms) {
  if (!Number.isFinite(ms)) return '—';
  const iso = new Date(ms).toISOString();
  return `${iso.slice(11, 13)}${iso.slice(14, 16)}Z`;
}
function _hourLabel(key) { return typeof key === 'string' && key.length >= 13 ? `${key.slice(11, 13)}00Z` : String(key); }
function _pct(x, digits = 1) { return Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : '—'; }
function _secs(ms) { return Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : '—'; }
function _num(x, digits = 1) { return Number.isFinite(x) ? x.toFixed(digits) : '—'; }
function _plural(n, one, many = `${one}s`) { return `${n} ${n === 1 ? one : many}`; }

function _sessionLabel(s) {
  if (!s) return '—';
  const date = Number.isFinite(s.startedAt) ? new Date(s.startedAt).toISOString().slice(0, 10) : '';
  return `#${s.seq} ${s.theatre || 'unknown theatre'} · ${date} ${_hhmmz(s.startedAt)}${s.current ? ' (current)' : ''}`;
}

function _targetLabel(target) {
  if (!target) return '—';
  switch (target.kind) {
    case 'TRENDING_DOWN': return 'trending down';
    case 'P95_BELOW_MS': return `p95 < ${_secs(target.value)}`;
    case 'EQUALS': return `= ${target.value} input`;
    case 'AT_LEAST': return `≥ ${_pct(target.value, 0)}`;
    case 'AT_MOST': return `≤ ${_pct(target.value, 1)}`;
    default: return String(target.kind);
  }
}

function _topEntries(obj, n = 3) {
  return Object.entries(obj || {}).filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n)
    .map(([k, v]) => `${k} ${v}`).join(', ');
}

// ── verdicts ───────────────────────────────────────────────────────────────

const _muted = (verdict, value) => ({ verdict, tone: 'muted', value });

/** A cell for a status that says there is nothing to judge, else null. */
function _statusCell(block, notInstrumentedValue = 'not instrumented') {
  if (!block || block.status === 'NOT_INSTRUMENTED') return _muted('NOT INSTRUMENTED', notInstrumentedValue);
  if (block.status === 'NO_DATA') return _muted('NO DATA', 'nothing in this window');
  return null;
}

/**
 * [SOURCE-DEFINED] (Q-L15-8): the last three complete hours with a value.
 * Fewer than two: no trend yet.
 */
function metricsTrend(values) {
  const pts = values.filter(v => Number.isFinite(v)).slice(-3);
  if (pts.length < 2) return null;
  const steps = pts.slice(1).map((v, i) => v - pts[i]);
  if (steps.every(d => d === 0)) return '→';
  if (steps.every(d => d <= 0)) return '↓';
  const last = steps[steps.length - 1];
  return last > 0 ? '↑' : last < 0 ? '↓' : '→';
}

function _trendCell(seriesValues, windowId) {
  if (windowId !== 'mission') return { verdict: '—', tone: 'muted', title: 'A trend needs complete hours — see This mission.' };
  const arrow = metricsTrend(seriesValues);
  if (!arrow) return { verdict: 'NO TREND YET', tone: 'muted', title: 'Needs two complete hours with data.' };
  return { verdict: `TRENDING ${arrow}`, tone: 'plain' };
}

// ── the view-model ─────────────────────────────────────────────────────────

/** Per hour key, the search rate per manned hour across every Position (null where nobody was manned). */
function _searchSeries(block, hours) {
  return hours.map((h) => {
    let count = 0, minutes = 0;
    for (const row of Object.values(block.byPosition || {})) {
      const b = row && row.byHour && row.byHour[h];
      if (!b) continue;
      count += b.count || 0;
      minutes += b.mannedMinutes || 0;
    }
    return minutes > 0 ? count / (minutes / 60) : null;
  });
}

function _seriesOf(byHour, hours, pick) {
  return hours.map(h => (byHour && byHour[h] ? pick(byHour[h]) : null)).map(v => (Number.isFinite(v) ? v : null));
}

function _cell(id, block, windowId, ctx) {
  const hours = windowId === 'mission' ? ctx.hours : [];
  const complete = windowId === 'mission' ? ctx.completeHours : [];
  switch (id) {
    case 'searchInvocations': {
      const s = _statusCell(block, 'no client has reported yet');
      if (s) return s;
      let total = 0, mannedHours = 0;
      for (const row of Object.values(block.byPosition || {})) {
        total += Number.isFinite(row.total) ? row.total : 0;
        mannedHours += Number.isFinite(row.mannedHours) ? row.mannedHours : 0;
      }
      const rate = mannedHours > 0 ? total / mannedHours : null;
      const series = _searchSeries(block, hours);
      return {
        value: `${_plural(block.total, 'search', 'searches')} · ${_num(rate)} per manned hour`,
        ..._trendCell(_searchSeries(block, complete), windowId),
        spark: hours.length ? hours.map((h, i) => ({ label: _hourLabel(h), value: series[i] })) : null,
      };
    }
    case 'timeToFind': {
      const s = _statusCell(block, 'no client has reported yet');
      if (s) return s;
      const series = _seriesOf(block.byHour, hours, b => b.p95Ms);
      const dropped = block.droppedSamples ? ` · ${block.droppedSamples} dropped` : '';
      return {
        value: `p95 ${_secs(block.p95Ms)} · p50 ${_secs(block.p50Ms)} · n=${block.samples}${dropped}`,
        ...(block.pass === true ? { verdict: 'MET', tone: 'plain' }
          : block.pass === false ? { verdict: 'NOT MET', tone: 'bad' } : _muted('NO DATA')),
        spark: hours.length ? hours.map((h, i) => ({ label: _hourLabel(h), value: series[i] })) : null,
      };
    }
    case 'gestureInputs': {
      const s = _statusCell(block, 'no client has reported yet');
      if (s) return s;
      const g = block.byGesture || {};
      const made = METRICS_GESTURES.filter(k => g[k] && g[k].count > 0);
      if (!made.length) return _muted('NO DATA', 'no gestures in this window');
      const over = made.filter(k => g[k].overCeiling > 0);
      const flags = block.serverSetFlagMutations || {};
      return {
        value: made.map(k => `${k} ${_num(g[k].meanInputs)} (${g[k].count})`).join(' · '),
        detail: `server SetFlag count: ${METRICS_GESTURES.map(k => `${k} ${flags[k] || 0}`).join(' · ')}`,
        ...(over.length ? { verdict: 'NOT MET', tone: 'bad', title: `Over one input: ${over.join(', ')}` } : { verdict: 'MET', tone: 'plain' }),
      };
    }
    case 'correlation': {
      const s = _statusCell(block);
      if (s) return s;
      const target = block.target && block.target.value;
      const series = _seriesOf(block.byHour, hours, b => b.rate);
      const rate = block.windowRate;
      return {
        value: _pct(rate),
        ...(!Number.isFinite(rate) ? _muted('NO DATA')
          : rate >= target ? { verdict: 'MET', tone: 'plain' } : { verdict: 'NOT MET', tone: 'bad' }),
        spark: hours.length ? hours.map((h, i) => ({ label: _hourLabel(h), value: series[i] })) : null,
      };
    }
    case 'rejectedMutations': {
      const s = _statusCell(block);
      if (s) return s;
      const series = _seriesOf(block.byHour, hours, b => b.total);
      const reasons = _topEntries(block.byReason);
      return {
        value: `${block.total} of ${_plural(block.mutations, 'Mutation')} refused`,
        detail: reasons ? `by reason: ${reasons}` : null,
        ..._trendCell(_seriesOf(block.byHour, complete, b => b.total), windowId),
        spark: hours.length ? hours.map((h, i) => ({ label: _hourLabel(h), value: series[i] })) : null,
      };
    }
    case 'staleness': {
      // Rendered as not instrumented until L19 declares its detector (sources.staleness).
      if (ctx.stalenessSource === null) return _muted('NOT INSTRUMENTED', 'not instrumented (L19)');
      const s = _statusCell(block, 'not instrumented (L19)');
      if (s) return s;
      const series = _seriesOf(block.byHour, hours, b => b.total);
      return {
        value: _plural(block.total, 'detection'),
        detail: _topEntries(block.byState) ? `by state: ${_topEntries(block.byState)}` : null,
        ..._trendCell(_seriesOf(block.byHour, complete, b => b.total), windowId),
        spark: hours.length ? hours.map((h, i) => ({ label: _hourLabel(h), value: series[i] })) : null,
      };
    }
    case 'transfers': {
      const s = _statusCell(block);
      if (s) return s;
      const rate = block.failureRate;
      const target = block.target && block.target.value;
      const causes = _topEntries(block.byCause);
      const extra = [
        causes ? `causes: ${causes}` : null,
        block.routedToCovering ? `${block.routedToCovering} routed to a covering Position` : null,
        block.inhibitedPress ? `${block.inhibitedPress} inhibited ${block.inhibitedPress === 1 ? 'press' : 'presses'} (not attempts)` : null,
      ].filter(Boolean).join(' · ');
      return {
        value: `${_pct(rate)} failed (${block.failed} of ${block.attempts})`,
        detail: extra || null,
        ...(!Number.isFinite(rate) ? _muted('NO DATA')
          : rate <= target ? { verdict: 'MET', tone: 'plain' } : { verdict: 'NOT MET', tone: 'bad' }),
      };
    }
    default: return _muted('NOT INSTRUMENTED', 'not instrumented');
  }
}

function _cleanCell(c) {
  return {
    value: typeof c.value === 'string' ? c.value : '—',
    detail: typeof c.detail === 'string' ? c.detail : null,
    verdict: c.verdict,
    tone: c.tone === 'bad' || c.tone === 'muted' ? c.tone : 'plain',
    title: typeof c.title === 'string' ? c.title : null,
    spark: Array.isArray(c.spark) && c.spark.some(p => Number.isFinite(p.value)) ? c.spark : null,
  };
}

/**
 * The metrics body (`efsp-metrics`' `metrics`, or GET /api/efsp/metrics) →
 * what the panel shows. Pure; tested without a DOM.
 */
function renderMetricsModel(body) {
  if (!body || body.ok === false || !body.metrics) {
    return { ok: false, error: (body && (body.detail || body.reason)) || 'no metrics yet' };
  }
  const session = body.missionSession || null;
  const hours = Array.isArray(body.hours) ? body.hours.filter(h => typeof h === 'string') : [];
  // The current hour is still filling; a past session's hours are all complete.
  const completeHours = session && session.current ? hours.slice(0, -1) : hours;
  const stalenessSource = body.sources && Number.isFinite(body.sources.staleness) ? body.sources.staleness : null;
  const ctx = { hours, completeHours, stalenessSource };
  const lastHour = body.lastHour && body.lastHour.metrics ? body.lastHour : null;

  const rows = METRICS_ROWS.map(({ id, name }) => {
    const block = body.metrics[id];
    return {
      id, name,
      target: _targetLabel(block && block.target),
      cells: {
        mission: _cleanCell(_cell(id, block, 'mission', ctx)),
        lastHour: lastHour ? _cleanCell(_cell(id, lastHour.metrics[id], 'lastHour', ctx)) : { value: '—', detail: null, verdict: '—', tone: 'muted', title: 'No rolling hour for a past mission.', spark: null },
      },
    };
  });

  // H66: shown, folded. Keyed by Position (a role), never by controller (H35).
  const perPosition = { search: [], timeToFind: [] };
  const search = body.metrics.searchInvocations || {};
  const searchLast = lastHour ? (lastHour.metrics.searchInvocations || {}).byPosition || {} : {};
  if (search.status !== 'NOT_INSTRUMENTED') {
    for (const positionId of Object.keys(search.byPosition || {}).sort()) {
      const r = search.byPosition[positionId] || {};
      const l = searchLast[positionId];
      perPosition.search.push({
        positionId, facilityId: typeof r.facilityId === 'string' ? r.facilityId : '',
        total: Number.isFinite(r.total) ? r.total : 0,
        perMannedHour: _num(r.perMannedHour),
        mannedHours: _num(r.mannedHours),
        lastHour: lastHour ? String(l && Number.isFinite(l.total) ? l.total : 0) : '—',
      });
    }
  }
  const ttf = body.metrics.timeToFind || {};
  const ttfLast = lastHour ? (lastHour.metrics.timeToFind || {}).byPosition || {} : {};
  if (ttf.status !== 'NOT_INSTRUMENTED') {
    for (const positionId of Object.keys(ttf.byPosition || {}).sort()) {
      const r = ttf.byPosition[positionId] || {};
      const l = ttfLast[positionId];
      perPosition.timeToFind.push({
        positionId,
        samples: Number.isFinite(r.samples) ? r.samples : 0,
        p95: _secs(r.p95Ms), p50: _secs(r.p50Ms),
        lastHour: lastHour ? (l ? `p95 ${_secs(l.p95Ms)} (n=${l.samples || 0})` : 'no data') : '—',
      });
    }
  }

  const sessions = (Array.isArray(body.missionSessions) ? body.missionSessions : [])
    .filter(s => s && Number.isInteger(s.seq))
    .map(s => ({ seq: s.seq, current: !!s.current, label: _sessionLabel(s), startedAt: s.startedAt, lastAt: s.lastAt ?? null }))
    .sort((a, b) => b.seq - a.seq);

  return {
    ok: true,
    session: session ? { seq: session.seq, current: !!session.current, label: _sessionLabel(session), startedAt: session.startedAt, lastAt: session.lastAt ?? null } : null,
    sessions,
    asOf: _hhmmz(body.generatedAt),
    windows: [
      { id: 'mission', label: 'This mission', range: hours.length ? `${_hourLabel(hours[0])}–${_hhmmz(body.generatedAt)}` : '' },
      { id: 'lastHour', label: 'Last hour', range: lastHour ? `${_hhmmz(lastHour.from)}–${_hhmmz(lastHour.to)}` : '—' },
    ],
    rows,
    perPosition,
    footnotes: [...METRICS_FOOTNOTES],
  };
}

/** The traffic body → the §11.4 section. `facilityId` picks one Facility of those in the body. */
function renderTrafficModel(body, facilityId) {
  if (!body || body.ok === false || !body.facilities) {
    return { ok: false, error: (body && (body.detail || body.reason)) || 'no traffic count yet' };
  }
  const facilities = Object.keys(body.facilities).sort();
  const id = facilities.includes(facilityId) ? facilityId : (facilities.includes('INCIRLIK') ? 'INCIRLIK' : facilities[0]);
  const f = body.facilities[id] || {};
  const t = f.totals || {};
  const n = (x) => (Number.isFinite(x) ? x : 0);
  const partitionOk = n(t.local) + n(t.transient) + n(t.unknown) === n(t.flights);

  let reconciliation;
  const r = body.reconciliation;
  if (!r) reconciliation = { text: 'not reconciled yet', tone: 'muted' };
  else if (r.ok) reconciliation = { text: `reconciles with the Mutation log ✓ (checked ${_hhmmz(r.checkedAt)})`, tone: 'plain' };
  else {
    reconciliation = {
      text: `does not reconcile with the Mutation log: ${n(r.missing)} missing, ${n(r.extra)} extra${r.mismatched ? `, ${r.mismatched} mismatched` : ''} (checked ${_hhmmz(r.checkedAt)})`,
      tone: 'bad',
    };
  }

  return {
    ok: true,
    facilities,
    facilityId: id,
    window: `${_hhmmz(body.from)}–${_hhmmz(body.to)}`,
    homeAirports: Array.isArray(f.homeAirports) ? f.homeAirports.filter(a => typeof a === 'string') : [],
    // The partition: every counted flight is exactly one of these.
    partition: {
      text: `local ${n(t.local)} + transient ${n(t.transient)} + unknown ${n(t.unknown)} = ${_plural(n(t.flights), 'flight')}`,
      ok: partitionOk,
      tone: partitionOk ? 'plain' : 'bad',
    },
    aircraft: `${_plural(n(t.aircraft), 'aircraft', 'aircraft')}`,
    // Overlapping subsets — never shares of the total (T12).
    subsets: `of which: formation ${n(t.formation)} (${n(t.formationAircraft)} aircraft), SUA traversal ${n(t.suaTraversal)}, alert scramble ${n(t.alertScramble)}`,
    byHour: (Array.isArray(f.byHour) ? f.byHour : []).map(h => ({ hour: _hourLabel(h.hourUtc), flights: n(h.flights), aircraft: n(h.aircraft), excluded: n(h.excluded) })),
    byType: Object.entries(f.byAircraftType || {})
      .map(([type, v]) => ({ type, flights: n(v && v.flights), aircraft: n(v && v.aircraft) }))
      .sort((a, b) => b.flights - a.flights || (a.type < b.type ? -1 : 1)),
    excluded: Object.entries(t.excludedByReason || {}).map(([reason, count]) => ({ reason, count: n(count) })).sort((a, b) => b.count - a.count),
    policy: typeof body.policy === 'string' ? body.policy : '',
    reconciliation,
  };
}

// ── the panel (DOM) ────────────────────────────────────────────────────────

const _metricsPanel = {
  root: null, content: null,
  latestRequestId: null, missionSession: null, facilityId: null, showPerPosition: false,
  body: null, traffic: null, error: null, lastRequestAt: null, wasVisible: false, timer: null,
};

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function _sparkSvg(points) {
  if (!points || typeof document.createElementNS !== 'function') return null;
  const vals = points.map(p => p.value).filter(Number.isFinite);
  if (!vals.length) return null;
  const W = 64, H = 16, max = Math.max(...vals), min = Math.min(...vals, 0);
  const span = max - min || 1;
  const step = points.length > 1 ? W / (points.length - 1) : 0;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'metrics-spark');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  const title = document.createElementNS(ns, 'title');
  title.textContent = points.map(p => `${p.label} ${Number.isFinite(p.value) ? (Math.round(p.value * 100) / 100) : '—'}`).join(' · ');
  svg.appendChild(title);
  // One polyline per run of values: a gap in the data is a gap in the line.
  let run = [];
  const flush = () => {
    if (run.length === 1) {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', run[0][0]); c.setAttribute('cy', run[0][1]); c.setAttribute('r', '1.5');
      svg.appendChild(c);
    } else if (run.length > 1) {
      const pl = document.createElementNS(ns, 'polyline');
      pl.setAttribute('points', run.map(p => p.join(',')).join(' '));
      svg.appendChild(pl);
    }
    run = [];
  };
  points.forEach((p, i) => {
    if (!Number.isFinite(p.value)) { flush(); return; }
    run.push([(i * step).toFixed(1), (H - 1 - ((p.value - min) / span) * (H - 2)).toFixed(1)]);
  });
  flush();
  return svg;
}

function _renderCell(c) {
  const cell = _el('div', `metrics-cell metrics-tone-${c.tone}`);
  cell.appendChild(_el('div', 'metrics-value', c.value));
  const verdict = _el('div', 'metrics-verdict', c.verdict);
  if (c.title) verdict.title = c.title;
  cell.appendChild(verdict);
  if (c.detail) cell.appendChild(_el('div', 'metrics-detail', c.detail));
  const spark = _sparkSvg(c.spark);
  if (spark) cell.appendChild(spark);
  return cell;
}

function _renderTable(headers, rows) {
  const table = _el('table', 'metrics-subtable');
  const thead = _el('tr');
  for (const h of headers) thead.appendChild(_el('th', null, h));
  table.appendChild(thead);
  for (const r of rows) {
    const tr = _el('tr');
    for (const v of r) tr.appendChild(_el('td', null, String(v)));
    table.appendChild(tr);
  }
  return table;
}

function renderMetricsPanel() {
  const content = _metricsPanel.content;
  if (!content) return;
  content.innerHTML = '';
  const model = renderMetricsModel(_metricsPanel.body);

  const head = _el('div', 'metrics-head');
  const sessionSel = _el('select', 'metrics-session-select');
  sessionSel.title = 'Mission (a metrics session is one mission load to the next)';
  const cur = _el('option', null, 'Current mission');
  cur.value = '';
  sessionSel.appendChild(cur);
  for (const s of model.ok ? model.sessions : []) {
    if (s.current) continue;
    const o = _el('option', null, s.label);
    o.value = String(s.seq);
    sessionSel.appendChild(o);
  }
  sessionSel.value = _metricsPanel.missionSession === null ? '' : String(_metricsPanel.missionSession);
  sessionSel.addEventListener('change', () => {
    _metricsPanel.missionSession = sessionSel.value === '' ? null : Number(sessionSel.value);
    requestEfspMetrics();
  });
  head.appendChild(sessionSel);
  head.appendChild(_el('span', 'metrics-asof', model.ok ? `${model.session ? model.session.label : ''} · as of ${model.asOf}` : ''));
  content.appendChild(head);

  if (_metricsPanel.error) content.appendChild(_el('div', 'metrics-error', _metricsPanel.error));
  if (!model.ok) {
    content.appendChild(_el('div', 'efsp-empty', model.error));
    return;
  }

  const grid = _el('div', 'metrics-grid');
  const hdr = _el('div', 'metrics-row metrics-row-head');
  hdr.appendChild(_el('div', 'metrics-name', 'Metric · target'));
  for (const w of model.windows) {
    const h = _el('div', 'metrics-window', w.label);
    if (w.range) h.title = w.range;
    hdr.appendChild(h);
  }
  grid.appendChild(hdr);
  for (const row of model.rows) {
    const r = _el('div', 'metrics-row');
    r.dataset.metric = row.id;
    const name = _el('div', 'metrics-name');
    name.appendChild(_el('div', 'metrics-metric', row.name));
    name.appendChild(_el('div', 'metrics-target', `target ${row.target}`));
    r.appendChild(name);
    r.appendChild(_renderCell(row.cells.mission));
    r.appendChild(_renderCell(row.cells.lastHour));
    grid.appendChild(r);
  }
  content.appendChild(grid);

  const toggle = _el('button', 'metrics-toggle', `${_metricsPanel.showPerPosition ? '▾' : '▸'} Per Position`);
  toggle.addEventListener('click', () => { _metricsPanel.showPerPosition = !_metricsPanel.showPerPosition; renderMetricsPanel(); });
  content.appendChild(toggle);
  if (_metricsPanel.showPerPosition) {
    const pp = _el('div', 'metrics-per-position');
    pp.appendChild(_el('div', 'metrics-section-title', 'Search invocations'));
    pp.appendChild(model.perPosition.search.length
      ? _renderTable(['Position', 'Facility', 'Searches', 'Per manned hour', 'Manned hours', 'Last hour'],
        model.perPosition.search.map(r => [r.positionId, r.facilityId, r.total, r.perMannedHour, r.mannedHours, r.lastHour]))
      : _el('div', 'efsp-empty', 'no data'));
    pp.appendChild(_el('div', 'metrics-section-title', 'Time-to-find'));
    pp.appendChild(model.perPosition.timeToFind.length
      ? _renderTable(['Position', 'Samples', 'p95', 'p50', 'Last hour'],
        model.perPosition.timeToFind.map(r => [r.positionId, r.samples, r.p95, r.p50, r.lastHour]))
      : _el('div', 'efsp-empty', 'no data'));
    content.appendChild(pp);
  }

  _renderTrafficSection(content);

  const notes = _el('div', 'metrics-footnotes');
  for (const f of model.footnotes) notes.appendChild(_el('div', null, f));
  content.appendChild(notes);
}

function _defaultTrafficFacility() {
  if (typeof getActingPositions !== 'function' || typeof getEfspBays !== 'function') return 'INCIRLIK';
  const facilities = [...new Set((getEfspBays() || []).map(b => b.facilityId).filter(Boolean))];
  return facilities.find(f => getActingPositions(f).length > 0) || 'INCIRLIK';
}

function _renderTrafficSection(content) {
  const section = _el('div', 'metrics-traffic');
  section.appendChild(_el('div', 'metrics-section-title', 'Traffic count (§11.4)'));
  const t = renderTrafficModel(_metricsPanel.traffic, _metricsPanel.facilityId || _defaultTrafficFacility());
  if (!t.ok) {
    section.appendChild(_el('div', 'efsp-empty', t.error));
    content.appendChild(section);
    return;
  }
  const sel = _el('select', 'metrics-facility-select');
  for (const f of t.facilities) { const o = _el('option', null, f); o.value = f; sel.appendChild(o); }
  sel.value = t.facilityId;
  sel.addEventListener('change', () => { _metricsPanel.facilityId = sel.value; renderMetricsPanel(); });
  const line = _el('div', 'metrics-traffic-head');
  line.appendChild(sel);
  line.appendChild(_el('span', 'metrics-asof', `${t.window}${t.homeAirports.length ? ` · home ${t.homeAirports.join(', ')}` : ''}`));
  section.appendChild(line);
  section.appendChild(_el('div', `metrics-partition metrics-tone-${t.partition.tone}`, `${t.partition.text} · ${t.aircraft}`));
  section.appendChild(_el('div', 'metrics-detail', t.subsets));
  section.appendChild(_el('div', `metrics-reconciliation metrics-tone-${t.reconciliation.tone}`, t.reconciliation.text));
  if (t.byHour.length) section.appendChild(_renderTable(['Hour', 'Flights', 'Aircraft', 'Excluded'], t.byHour.map(h => [h.hour, h.flights, h.aircraft, h.excluded])));
  if (t.byType.length) section.appendChild(_renderTable(['Aircraft type', 'Flights', 'Aircraft'], t.byType.map(r => [r.type, r.flights, r.aircraft])));
  if (t.excluded.length) section.appendChild(_renderTable(['Not counted, because', 'Strips'], t.excluded.map(r => [r.reason, r.count])));
  section.appendChild(_el('div', 'metrics-footnote', t.policy));
  content.appendChild(section);
}

// ── polling ────────────────────────────────────────────────────────────────

function _metricsPanelShowing() {
  const root = _metricsPanel.root;
  if (!root || root.isConnected === false) return false;
  return root.offsetParent !== null;
}

function _metricsSelectedSession() {
  const b = _metricsPanel.body;
  if (!b || !Array.isArray(b.missionSessions)) return null;
  const seq = _metricsPanel.missionSession;
  return b.missionSessions.find(s => (seq === null ? s.current : s.seq === seq)) || null;
}

/** Asks crc-sync for the metrics and the traffic count. The answer arrives as `efsp-metrics` (onEfspMetrics). */
function requestEfspMetrics() {
  if (typeof isSyncOpen === 'function' && !isSyncOpen()) {
    _metricsPanel.error = 'Not connected to crc-sync — showing the last answer.';
    renderMetricsPanel();
    return null;
  }
  const requestId = crypto.randomUUID();
  _metricsPanel.latestRequestId = requestId;
  _metricsPanel.lastRequestAt = typeof performance !== 'undefined' ? performance.now() : null;
  const s = _metricsSelectedSession();
  const trafficCount = { missionSession: s ? s.seq : null };
  if (s && Number.isFinite(s.startedAt)) trafficCount.from = Math.floor(s.startedAt);
  if (s && !s.current && Number.isFinite(s.lastAt)) trafficCount.to = Math.floor(s.lastAt) + 1;
  sendToSync({
    version: 1, type: 'efsp-metrics-request', requestId,
    missionSession: _metricsPanel.missionSession, hours: null, trafficCount,
  });
  return requestId;
}

/** app.js: `efsp-metrics`. Only the latest request's answer is shown. */
function onEfspMetrics(msg) {
  if (!msg || msg.requestId !== _metricsPanel.latestRequestId) return;
  if (msg.ok === false) {
    if (msg.reason === 'NOT_FOUND' && _metricsPanel.missionSession !== null) {
      _metricsPanel.missionSession = null; // that mission is no longer kept
      _metricsPanel.error = 'That mission is no longer kept; showing the current one.';
      requestEfspMetrics();
      return;
    }
    _metricsPanel.error = `crc-sync refused the request: ${msg.reason}${msg.detail ? ` (${msg.detail})` : ''}`;
  } else {
    _metricsPanel.error = null;
    _metricsPanel.body = msg.metrics || null;
    _metricsPanel.traffic = msg.trafficCount || null;
  }
  renderMetricsPanel();
}

function _metricsPollTick() {
  const showing = _metricsPanelShowing();
  const now = typeof performance !== 'undefined' ? performance.now() : null;
  const due = _metricsPanel.lastRequestAt === null || now === null || now - _metricsPanel.lastRequestAt >= METRICS_POLL_MS;
  if (showing && (!_metricsPanel.wasVisible || due)) requestEfspMetrics();
  _metricsPanel.wasVisible = showing;
}

function initMetricsPanel() {
  _metricsPanel.root = document.getElementById('metrics-panel');
  _metricsPanel.content = document.getElementById('metrics-content');
  renderMetricsPanel();
  if (!_metricsPanel.timer) _metricsPanel.timer = setInterval(_metricsPollTick, METRICS_VISIBILITY_TICK_MS);
  requestEfspMetrics();
  return {
    onShow: () => { _metricsPanel.wasVisible = true; requestEfspMetrics(); },
    onClose: () => { _metricsPanel.wasVisible = false; },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderMetricsModel, renderTrafficModel, metricsTrend, METRICS_ROWS, METRICS_POLL_MS };
}
