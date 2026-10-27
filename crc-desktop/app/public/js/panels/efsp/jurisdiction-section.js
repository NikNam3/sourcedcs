'use strict';

// The airspaces panel's JURISDICTION section (crc-sync docs/adr/0125): whose airspace it is, listed in its own block under
// the airspace cards, and edited inline (class, VFR service, vertical limits, geometry). The class is optional and an
// unclassified area names its VFR service (crc-sync docs/adr/0143, H166: the Adana MTMA). A jurisdiction area comes from the theater
// configuration: nobody creates or deletes one here, its owners and owning Facility are not edited here, and a carrier
// circle's anchor (the hull it follows) is shown read-only. Its controlling Position edits it (AP the RAPCON area, LC the
// tower's control zone), a carrier circle also CV_PRIFLY and CV_MARSHAL (airspace-capabilities.js, crc-sync's
// authority/airspace.js); crc-sync checks everything again, including that no two static areas share volume, and its
// refusal is shown in the form.
//
// The model (`jurisdictionAreas`, `geometryText`, `draftOf`, `patchFrom`) is pure (tests/jurisdiction-section.test.mjs);
// `buildJurisdictionSection` is the DOM half. Grey throughout (dark cockpit); orange-red only on an error.

import * as caps from './airspace-capabilities.js';
import { AIRSPACE_CLASSES, CLASS_VFR_SERVICE, MAX_RADIUS_NM, VFR_SERVICES, vfrServiceOf } from './airspace-validate.js';
import { altitudeText, parseAltitudeText } from './airspace-draft.js';
import { getEfspAirspace } from './efsp-state.js';
import { sendEfspAirspaceMutation } from './efsp-ws.js';
import { markEfspChanged } from './efsp-change-bus.js';
import { isHullAnchored } from './jurisdiction-geometry.js';

// ── the model ───────────────────────────────────────────────────────────────────────────────────

/** The JURISDICTION records among `airspaces`, by Facility then name. */
export function jurisdictionAreas(airspaces) {
  const order = caps.facilityIds();
  const rank = (f) => (order.indexOf(f) < 0 ? 99 : order.indexOf(f));
  return (airspaces || []).filter(a => a.definition && a.definition.kind === 'JURISDICTION')
    .sort((p, q) => rank(p.definition.controllingFacilityId) - rank(q.definition.controllingFacilityId)
      || String(p.definition.name).localeCompare(String(q.definition.name)));
}

const deg = (v, pos, neg) => `${Math.abs(v).toFixed(4)}${v >= 0 ? pos : neg}`;
const pointText = (p) => `${deg(p[0], 'N', 'S')} ${deg(p[1], 'E', 'W')}`;

/** One line for the shape: "Circle 5 nm on 37.0033N 35.4250E, cut by a line", "Circle 50 nm on the hull CVN-72 (follows the ship)". */
export function geometryText(geometry) {
  const g = geometry || {};
  if (g.source === 'CIRCLE') {
    const c = g.centre || {};
    const on = typeof c.hullId === 'string' ? `on the hull ${c.hullId} (follows the ship)` : `on ${pointText([c.lat, c.lon])}`;
    return `Circle ${g.radiusNm} nm ${on}${g.cut ? `, the part left of ${pointText(g.cut.from)} → ${pointText(g.cut.to)} cut off` : ''}`;
  }
  if (g.source === 'POLYGON') return `Polygon, ${(g.points || []).length} points`;
  return 'No shape';
}

/** What a VFR service means, in the controller's words (crc-sync docs/adr/0143; JO 7110.65BB para 7-9-4, 7-8-2, 7-6-1). */
export const VFR_SERVICE_TEXT = {
  ALL_SEPARATED: 'VFR separated from IFR and VFR',
  IFR_SEPARATED: 'IFR separated from VFR; VFR to VFR traffic advisories',
  ADVISORY: 'VFR: traffic advisories, no separation',
};

/** The card's VFR line: the area's service, and "(Class D)" when the class gives it; null when there is none (A, G). */
export function vfrServiceLine(def) {
  const svc = vfrServiceOf(def);
  if (!svc) return null;
  return `${VFR_SERVICE_TEXT[svc]}${def.vfrService ? '' : ` (Class ${def.airspaceClass})`}`;
}

/** "SFC–3000", "SFC–FL280", "SFC–UNL". */
export function limitsLine(def, transitionAltFt = 18000) {
  return `${def.altLowerFt == null ? 'SFC' : altitudeText(def.altLowerFt, transitionAltFt)}–${def.altUpperFt == null ? 'UNL' : altitudeText(def.altUpperFt, transitionAltFt)}`;
}

const latLonText = (p) => (p ? `${p[0]}, ${p[1]}` : '');
function parseLatLon(text) {
  const t = String(text ?? '').trim();
  if (t === '') return null;
  const m = /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return NaN;
  const lat = Number(m[1]); const lon = Number(m[2]);
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? [lat, lon] : NaN;
}

/** The form buffer: text for every editable value. */
export function draftOf(def, transitionAltFt = 18000) {
  const g = def.geometry || {};
  const d = {
    airspaceClass: def.airspaceClass || '',
    vfrService: def.vfrService || '',
    altLowerFt: altitudeText(def.altLowerFt ?? null, transitionAltFt),
    altUpperFt: altitudeText(def.altUpperFt ?? null, transitionAltFt),
  };
  if (g.source === 'CIRCLE') {
    d.radiusNm = String(g.radiusNm ?? '');
    if (!isHullAnchored(def)) {
      d.centre = latLonText([g.centre.lat, g.centre.lon]);
      d.cutFrom = latLonText(g.cut && g.cut.from);
      d.cutTo = latLonText(g.cut && g.cut.to);
    }
  } else if (g.source === 'POLYGON') {
    d.points = (g.points || []).map(latLonText).join('\n');
  }
  return d;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The EditAirspace patch a draft makes against `def` (changed fields only), or the errors that stop it. The server checks
 * the shape again (and the overlap, which only it can see whole); this catches what a controller mistypes.
 * @returns {{patch:object, errors:object}}
 */
export function patchFrom(def, draft) {
  const errors = {}; const patch = {};
  // crc-sync docs/adr/0143: '' is unclassified (null on the wire), and an unclassified area names its VFR service.
  const cls = draft.airspaceClass || null; const svc = draft.vfrService || null;
  if (cls !== null && !AIRSPACE_CLASSES.includes(cls)) errors.airspaceClass = `One of ${AIRSPACE_CLASSES.join(', ')}, or unclassified`;
  else if (cls === 'G' && (def.ownerPositionIds || []).length) errors.airspaceClass = 'Class G belongs to nobody: an owned area cannot be Class G';
  else if (!same(cls, def.airspaceClass)) patch.airspaceClass = cls;
  if (svc !== null && !VFR_SERVICES.includes(svc)) errors.vfrService = `One of ${VFR_SERVICES.join(', ')}`;
  else if (svc !== null && (cls === 'A' || cls === 'G')) errors.vfrService = `Class ${cls} has no VFR service`;
  else if (svc === null && cls === null) errors.vfrService = 'An unclassified area needs its VFR service';
  else if (!same(svc, def.vfrService)) patch.vfrService = svc;
  const lo = parseAltitudeText(draft.altLowerFt); const hi = parseAltitudeText(draft.altUpperFt);
  if (Number.isNaN(lo)) errors.altLowerFt = 'Feet (3000) or a flight level (FL280); empty is the surface';
  if (Number.isNaN(hi)) errors.altUpperFt = 'Feet (3000) or a flight level (FL280); empty is unlimited';
  if (!errors.altLowerFt && !errors.altUpperFt && lo != null && hi != null && lo >= hi) errors.altUpperFt = 'The upper limit must be above the lower';
  if (!errors.altLowerFt && !same(lo, def.altLowerFt)) patch.altLowerFt = lo;
  if (!errors.altUpperFt && !same(hi, def.altUpperFt)) patch.altUpperFt = hi;

  const g = def.geometry || {};
  let next = null;
  if (g.source === 'CIRCLE') {
    const r = Number(String(draft.radiusNm ?? '').trim());
    if (!(String(draft.radiusNm ?? '').trim() !== '' && Number.isFinite(r) && r > 0 && r <= MAX_RADIUS_NM)) errors.radiusNm = `Nautical miles, above 0 and at most ${MAX_RADIUS_NM}`;
    if (isHullAnchored(def)) {
      if (!errors.radiusNm) next = { source: 'CIRCLE', centre: { hullId: g.centre.hullId }, radiusNm: r, cut: null };
    } else {
      const c = parseLatLon(draft.centre); const from = parseLatLon(draft.cutFrom); const to = parseLatLon(draft.cutTo);
      if (!Array.isArray(c)) errors.centre = 'lat, lon in decimal degrees';
      if (Number.isNaN(from)) errors.cutFrom = 'lat, lon in decimal degrees, or empty for no cut';
      if (Number.isNaN(to)) errors.cutTo = 'lat, lon in decimal degrees, or empty for no cut';
      if (!errors.cutFrom && !errors.cutTo && (from === null) !== (to === null)) errors.cutTo = 'A cut needs both points (or neither)';
      if (!Object.keys(errors).some(k => ['radiusNm', 'centre', 'cutFrom', 'cutTo'].includes(k))) {
        next = { source: 'CIRCLE', centre: { lat: c[0], lon: c[1] }, radiusNm: r, cut: from ? { from, to } : null };
      }
    }
  } else if (g.source === 'POLYGON') {
    const rows = String(draft.points ?? '').split('\n').map(s => s.trim()).filter(Boolean).map(parseLatLon);
    if (rows.length < 3 || rows.some(p => !Array.isArray(p))) errors.points = 'At least three points, one "lat, lon" per line';
    else next = { ...g, points: rows };
  }
  if (next) {
    const was = g.source === 'CIRCLE' ? { source: 'CIRCLE', centre: g.centre, radiusNm: g.radiusNm, cut: g.cut || null } : g;
    if (!same(next, was)) patch.geometry = next;
  }
  return { patch: Object.keys(errors).length ? {} : patch, errors };
}

// ── the DOM half ────────────────────────────────────────────────────────────────────────────────

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const _open = new Map(); // airspaceId -> the open form view { el, close }

/** Is a jurisdiction form open (the e2e specs and the panel's own checks)? */
export function openJurisdictionForms() { return [..._open.keys()]; }

const FIELD_LABELS = {
  airspaceClass: 'CLASS', vfrService: 'VFR SERVICE', altLowerFt: 'LOWER', altUpperFt: 'UPPER', radiusNm: 'RADIUS NM',
  centre: 'CENTRE', cutFrom: 'CUT FROM', cutTo: 'CUT TO', points: 'POINTS',
};

function _openForm(record, authority, transitionAltFt) {
  const def = record.definition;
  const id = record.airspaceId;
  const draft = draftOf(def, transitionAltFt);
  const el = _el('div', 'airspace-editor jurisdiction-editor');
  el.dataset.jurisdictionForm = id;
  el.appendChild(_el('div', 'airspace-editor-head', `Editing as ${authority.positionId} · definition rev ${record.defRev}`));
  const form = _el('div', 'airspace-editor-form');
  const errEls = {};
  const row = (field, control) => {
    const r = _el('div', 'airspace-field');
    r.appendChild(_el('label', 'airspace-field-label', FIELD_LABELS[field]));
    control.dataset.field = field;
    r.appendChild(control);
    const err = _el('div', 'airspace-field-error'); err.hidden = true; errEls[field] = err; r.appendChild(err);
    form.appendChild(r);
  };
  const text = (field, placeholder, area = false) => {
    const i = document.createElement(area ? 'textarea' : 'input');
    if (!area) i.type = 'text';
    i.className = 'airspace-input'; i.value = draft[field] ?? ''; if (placeholder) i.placeholder = placeholder;
    i.addEventListener('input', () => { draft[field] = i.value; refresh(); });
    return i;
  };
  const cls = document.createElement('select'); cls.className = 'airspace-input';
  cls.appendChild(new Option('none (unclassified)', ''));
  for (const c of AIRSPACE_CLASSES) cls.appendChild(new Option(c, c));
  cls.value = draft.airspaceClass;
  // The VFR service: '' follows the class (its name says which), else the area's own (crc-sync docs/adr/0143).
  const svc = document.createElement('select'); svc.className = 'airspace-input';
  const byClass = new Option('', '');
  svc.appendChild(byClass);
  for (const v of VFR_SERVICES) svc.appendChild(new Option(VFR_SERVICE_TEXT[v], v));
  svc.value = draft.vfrService;
  const syncByClass = () => {
    const given = CLASS_VFR_SERVICE[draft.airspaceClass];
    byClass.textContent = given ? `by the class: ${VFR_SERVICE_TEXT[given]}` : draft.airspaceClass ? 'none' : 'pick one';
  };
  syncByClass();
  cls.addEventListener('change', () => { draft.airspaceClass = cls.value; syncByClass(); refresh(); });
  svc.addEventListener('change', () => { draft.vfrService = svc.value; refresh(); });
  row('airspaceClass', cls);
  row('vfrService', svc);
  row('altLowerFt', text('altLowerFt', 'empty = surface'));
  row('altUpperFt', text('altUpperFt', 'empty = unlimited'));
  if ('radiusNm' in draft) row('radiusNm', text('radiusNm', 'nm'));
  if (isHullAnchored(def)) {
    const anchor = _el('div', 'airspace-readonly', `the hull ${def.geometry.centre.hullId} (follows the ship; set by the theater configuration)`);
    const r = _el('div', 'airspace-field');
    r.append(_el('label', 'airspace-field-label', 'ANCHOR'), anchor);
    r.dataset.field = 'anchor';
    form.appendChild(r);
  }
  if ('centre' in draft) {
    row('centre', text('centre', '37.003333, 35.425'));
    row('cutFrom', text('cutFrom', 'empty = no cut'));
    row('cutTo', text('cutTo', 'empty = no cut'));
    form.appendChild(_el('div', 'airspace-field-why', 'The cut removes the part of the circle left of the line from CUT FROM to CUT TO.'));
  }
  if ('points' in draft) row('points', text('points', 'lat, lon per line', true));
  el.appendChild(form);

  const actions = _el('div', 'airspace-editor-actions');
  const save = _el('button', 'airspace-save-btn', 'Save');
  const cancel = _el('button', 'airspace-action-btn', 'Cancel');
  const status = _el('span', 'airspace-editor-status');
  actions.append(save, cancel, status);
  el.appendChild(actions);

  let pending = null; let serverMessage = null; let latest = { patch: {}, errors: {} };
  function refresh() {
    latest = patchFrom(def, draft);
    for (const [f, e] of Object.entries(errEls)) { const m = latest.errors[f]; e.hidden = !m; e.textContent = m || ''; }
    const n = Object.keys(latest.patch).length;
    save.disabled = !!pending || !n || Object.keys(latest.errors).length > 0;
    status.classList.toggle('airspace-status-bad', !!serverMessage);
    status.textContent = serverMessage || (pending ? 'Sending...' : Object.keys(latest.errors).length ? 'Fix the problems first.' : n ? `${n} field${n === 1 ? '' : 's'} changed. Applies at once, for everyone.` : 'Nothing changed.');
  }
  const close = () => { _open.delete(id); el.remove(); markEfspChanged('airspace'); };
  const onAck = (ack) => {
    if (!_open.has(id) || !pending) return false;
    pending = null;
    if (ack.ok) { close(); return true; }
    serverMessage = ack.reason === 'STALE_REV' ? 'Someone changed this area while you were editing. Cancel and open it again.' : (ack.detail || ack.reason || 'Refused.');
    refresh();
    return true;
  };
  save.addEventListener('click', () => {
    if (save.disabled) return;
    serverMessage = null;
    pending = sendEfspAirspaceMutation(authority.positionId, id, record.rev, { kind: 'EditAirspace', patch: latest.patch }, { baseDefRev: record.defRev }, { onAck }) ?? '?';
    refresh();
  });
  cancel.addEventListener('click', close);
  refresh();
  return { el, close };
}

/**
 * The section, or null when the theater has no jurisdiction area. Rebuilt on every panel render; an open form is the same
 * element across renders (so a field being typed in keeps its text).
 * @param {object[]} airspaces every airspace record of the theater
 * @param {string[]} signedOn the Positions this session acts as
 * @param {{transitionAltFt?:number}} [o]
 */
export function buildJurisdictionSection(airspaces, signedOn, { transitionAltFt = 18000 } = {}) {
  const areas = jurisdictionAreas(airspaces);
  for (const key of [..._open.keys()]) if (!areas.some(a => a.airspaceId === key)) { const v = _open.get(key); _open.delete(key); v.el.remove(); }
  if (!areas.length) return null;
  const section = _el('div', 'jurisdiction-section');
  section.dataset.testid = 'jurisdiction-section';
  section.appendChild(_el('div', 'airspace-group', `JURISDICTION · ${areas.length}`));
  section.appendChild(_el('div', 'airspace-field-why', 'Whose airspace an aircraft is in, and what VFR gets there. Outside every area it is CENTER\'s, unclassified, VFR advisories; a carrier area wins wherever it is.'));
  for (const rec of areas) {
    const d = rec.definition;
    const card = _el('div', 'airspace-card jurisdiction-card');
    card.dataset.jurisdictionId = rec.airspaceId;
    const head = _el('div', 'airspace-card-header');
    head.appendChild(_el('span', 'airspace-name', d.name || rec.airspaceId));
    if (d.airspaceClass) head.appendChild(_el('span', 'airspace-state', `Class ${d.airspaceClass}`));
    card.appendChild(head);
    const facts = [
      `${d.controllingFacilityId} · ${(d.ownerPositionIds || []).join(', ') || 'nobody'}`,
      limitsLine(d, transitionAltFt),
      ...(vfrServiceLine(d) ? [vfrServiceLine(d)] : []),
      geometryText(d.geometry),
      ...(d.excludes && d.excludes.length ? [`Excludes ${d.excludes.join(', ')}`] : []),
    ];
    for (const f of facts) card.appendChild(_el('div', 'airspace-fact jurisdiction-fact', f));
    if (d.sourceText) { const s = _el('div', 'airspace-field-why jurisdiction-source', d.sourceText); card.appendChild(s); }
    const view = _open.get(rec.airspaceId);
    if (view) card.appendChild(view.el);
    else {
      const authority = signedOn.length ? caps.authorityFor(signedOn, 'edit', d) : null;
      const btn = _el('button', 'airspace-action-btn jurisdiction-edit-btn', 'Edit…');
      if (authority) {
        btn.addEventListener('click', () => {
          const live = getEfspAirspace(rec.airspaceId) || rec;
          _open.set(rec.airspaceId, _openForm(live, authority, transitionAltFt));
          markEfspChanged('airspace');
        });
        card.appendChild(btn);
      } else {
        btn.disabled = true;
        const row = _el('div', 'airspace-menu-row');
        row.append(btn, _el('span', 'airspace-menu-why', signedOn.length ? `Edited by ${d.controllingPositionId}` : 'Sign on to a Position to edit'));
        card.appendChild(row);
      }
    }
    section.appendChild(card);
  }
  return section;
}
