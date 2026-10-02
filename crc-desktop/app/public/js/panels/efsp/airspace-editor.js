'use strict';

// The inline airspace editor (docs/adr/0098 §4; mockup scenes 2-4, docs/wip/AIRSP-mockup.html): create and edit one
// definition in the card, the R3-23 lock, dirty tracking, errors on the field and summarised beside Save, the impact note,
// and the per-field conflict view. The form buffer is the draft (AIRSP-3: no drafts on the server, no scheduled edits).
//
// Two halves. The MODEL is pure (no DOM, no sockets) and is what tests/airspace-editor.test.mjs exercises: which fields
// are editable, what a draft changes, what is wrong with it, how a STALE_REV answer turns into a conflict table and how
// the choices turn back into a patch. `openAirspaceEditor` is the DOM half; the panel hands it a `send` function.
//
// Colour (ADR 0056/0058): everything is grey; orange-red (--efsp-bad) marks only an error or the one clashing row.

import {
  AREA_TYPES, ROUTE_TYPES, LIVE_EDITABLE_FIELDS, MAX_NAME_LENGTH, ID_PATTERN, MIN_FREQUENCY_MHZ, MAX_FREQUENCY_MHZ,
  MAX_ALTITUDE_FT, validateAirspaceDefinition, checkAirspaceReferences,
} from './airspace-validate.js';
import * as caps from './airspace-capabilities.js';
import { mountGeometryEditor } from './airspace-geometry-editor.js';

export const FIELD_LABELS = {
  airspaceId: 'ID', name: 'NAME', type: 'TYPE', controllingFacilityId: 'CTRL FACILITY', controllingPositionId: 'CTRL POSITION',
  usingFacilityId: 'USING FACILITY', usingPositionId: 'USING POSITION', workingFrequencyMhz: 'WORK FREQ MHz',
  controlFrequencyMhz: 'RANGE FREQ MHz', altLowerFt: 'ALT LOWER ft', altUpperFt: 'ALT UPPER ft',
  geometry: 'OUTLINE', segments: 'ROUTE FIXES', defaultWidthNm: 'DEFAULT WIDTH NM',
};
/** The scalar fields, in the order the form shows them. */
export const SCALAR_FIELDS = ['name', 'type', 'controllingFacilityId', 'controllingPositionId', 'usingFacilityId', 'usingPositionId',
  'workingFrequencyMhz', 'controlFrequencyMhz', 'altLowerFt', 'altUpperFt'];
/** Edited by 2P-B's geometry section, not by a text input here. */
export const GEOMETRY_FIELDS = ['geometry', 'segments', 'defaultWidthNm'];
const FREQUENCY_FIELDS = ['workingFrequencyMhz', 'controlFrequencyMhz'];
const ALTITUDE_FIELDS = ['altLowerFt', 'altUpperFt'];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const fmtFreq = (v) => (v == null ? '' : Number(v).toFixed(3));

// ── values: how a number is written and read back ──────────────────────────────────────────────

/** An altitude as a controller writes it: FL at and above the transition altitude, feet below; null is `none`. */
export function altitudeText(ft, transitionAltFt = 18000) {
  if (ft == null) return '';
  return ft >= transitionAltFt ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : String(ft);
}

/** Read an altitude field: '' is none (null), `FL230` is 23000, `5000` is 5000; anything else is NaN (a parse error). */
export function parseAltitudeText(text) {
  const t = String(text ?? '').trim();
  if (t === '') return null;
  const fl = /^FL\s*(\d{1,3})$/i.exec(t);
  if (fl) return Number(fl[1]) * 100;
  if (/^\d+$/.test(t)) return Number(t);
  return NaN;
}

/** Read a frequency field: '' is none (null), a decimal number is MHz; anything else is NaN. */
export function parseFrequencyText(text) {
  const t = String(text ?? '').trim();
  if (t === '') return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

// ── the draft ───────────────────────────────────────────────────────────────────────────────────

/** The form buffer for a definition: text for every scalar field, the structures as they are. `definition` null = a new AREA. */
export function draftFromDefinition(definition, transitionAltFt = 18000) {
  const d = definition || { kind: 'AREA', type: 'MOA' };
  return {
    airspaceId: d.airspaceId || '',
    name: d.name || '', type: d.type || '',
    controllingFacilityId: d.controllingFacilityId || '', controllingPositionId: d.controllingPositionId || '',
    usingFacilityId: d.usingFacilityId || '', usingPositionId: d.usingPositionId || '',
    workingFrequencyMhz: fmtFreq(d.workingFrequencyMhz), controlFrequencyMhz: fmtFreq(d.controlFrequencyMhz),
    altLowerFt: altitudeText(d.altLowerFt, transitionAltFt), altUpperFt: altitudeText(d.altUpperFt, transitionAltFt),
    geometry: d.geometry ?? null, segments: d.segments ?? null, defaultWidthNm: d.defaultWidthNm ?? null,
  };
}

/**
 * The definition a draft says, over `base` (the fields the form cannot touch stay as they are). Text that does not parse
 * is reported in `parseErrors` (field -> message) and left as the base value.
 */
export function definitionFromDraft(base, draft) {
  const out = { ...base };
  const parseErrors = {};
  out.airspaceId = base.airspaceId || String(draft.airspaceId || '').trim();
  out.kind = base.kind || 'AREA';
  out.name = String(draft.name ?? '').trim();
  out.type = draft.type || '';
  out.controllingFacilityId = draft.controllingFacilityId || '';
  out.controllingPositionId = draft.controllingPositionId || '';
  out.usingFacilityId = String(draft.usingFacilityId || '').trim() || null;
  out.usingPositionId = String(draft.usingPositionId || '').trim() || null;
  for (const f of FREQUENCY_FIELDS) {
    const v = parseFrequencyText(draft[f]);
    if (Number.isNaN(v)) parseErrors[f] = 'Enter MHz, for example 139.250.'; else out[f] = v;
  }
  if (out.kind === 'AREA') {
    for (const f of ALTITUDE_FIELDS) {
      const v = parseAltitudeText(draft[f]);
      if (Number.isNaN(v)) parseErrors[f] = 'Whole feet, or FL and three digits.'; else out[f] = v;
    }
    out.geometry = draft.geometry ?? null;
  } else {
    out.segments = draft.segments ?? base.segments;
    out.defaultWidthNm = draft.defaultWidthNm ?? base.defaultWidthNm;
  }
  return { definition: out, parseErrors };
}

// ── which fields may change, and why not ────────────────────────────────────────────────────────

/** R3-23: the reason the definition is locked, or null while the airspace is RETURNED with no request. */
export function lockReason(record) {
  if (!record) return null;
  if (record.state !== 'RETURNED') return `airspace is ${record.state}: only name and frequencies can change`;
  if (record.pendingRequest) return 'airspace has an activation request outstanding: only name and frequencies can change';
  return null;
}

/**
 * The fields the form lets this session change, and for every field it does not, the reason (shown under the field).
 * @param {{record:object|null, creating:boolean, authority:{scope:'ALL'|'FREQUENCY'}|null, kind?:string}} ctx
 * @returns {{editable:Set<string>, reasons:Object<string,string>}}
 */
export function editableFields({ record, creating, authority, kind }) {
  const k = (record && record.definition.kind) || kind || 'AREA';
  const all = [...SCALAR_FIELDS, ...GEOMETRY_FIELDS].filter(f => (k === 'ROUTE'
    ? !['altLowerFt', 'altUpperFt', 'geometry'].includes(f) : !['segments', 'defaultWidthNm'].includes(f)));
  const reasons = {};
  let editable = new Set(creating ? all : []);
  if (!creating) {
    if (authority && authority.scope === 'ALL') editable = new Set(all);
    else if (authority && authority.scope === 'FREQUENCY') editable = new Set(['controlFrequencyMhz']);
    const lock = lockReason(record);
    if (lock) {
      for (const f of [...editable]) if (!LIVE_EDITABLE_FIELDS.includes(f)) { editable.delete(f); reasons[f] = lock; }
    }
    if (authority && authority.scope === 'FREQUENCY') {
      for (const f of all) if (!editable.has(f)) reasons[f] = 'a range may change only its own control frequency';
    }
    for (const f of all) if (!editable.has(f) && !reasons[f]) reasons[f] = 'you may not change this airspace';
  }
  reasons.airspaceId = 'fixed after create';
  if (k === 'ROUTE') { reasons.altLowerFt = 'derived from the route legs'; reasons.altUpperFt = 'derived from the route legs'; }
  return { editable, reasons };
}

// ── what the draft changes, and what is wrong with it ───────────────────────────────────────────

/** The fields of `base` the draft changes (text that does not parse counts as changed when it differs from the original text). */
export function dirtyFields(base, draft, transitionAltFt = 18000) {
  const original = draftFromDefinition(base, transitionAltFt);
  const { definition } = definitionFromDraft(base, draft);
  return [...SCALAR_FIELDS, ...GEOMETRY_FIELDS].filter((f) => {
    if (same(original[f], draft[f])) return false; // the text is as it was opened
    if (GEOMETRY_FIELDS.includes(f)) return true;
    // 139.25 written for 139.250 is the same value; text that does not read as a number is a change that cannot be sent
    return !_parses(f, draft[f]) || !same(base[f], definition[f]);
  });
}
function _parses(field, text) {
  if (FREQUENCY_FIELDS.includes(field)) return !Number.isNaN(parseFrequencyText(text));
  if (ALTITUDE_FIELDS.includes(field)) return !Number.isNaN(parseAltitudeText(text));
  return true;
}

/** The patch an EditAirspace carries: the changed, editable fields only, with `null` clearing an optional one. */
export function buildPatch(base, draft, editable, transitionAltFt = 18000) {
  const { definition } = definitionFromDraft(base, draft);
  const patch = {};
  for (const f of dirtyFields(base, draft, transitionAltFt)) {
    if (editable && !editable.has(f)) continue;
    patch[f] = definition[f] ?? null;
  }
  return patch;
}

/** The "was ..." text under a changed field. */
export function wasText(field, base, transitionAltFt = 18000) {
  const v = base[field];
  if (ALTITUDE_FIELDS.includes(field)) return v == null ? 'none' : (v >= transitionAltFt ? `${v} · ${altitudeText(v, transitionAltFt)}` : String(v));
  if (FREQUENCY_FIELDS.includes(field)) return v == null ? 'none' : fmtFreq(v);
  if (GEOMETRY_FIELDS.includes(field)) return field === 'geometry' ? (v && v.points ? `${v.points.length} points` : 'none') : String(Array.isArray(v) ? `${v.length} fixes` : v ?? 'none');
  return v == null || v === '' ? 'none' : String(v);
}

/**
 * Everything wrong with the draft, by field, and the grey notes that are not errors.
 * @param {object} base the definition the form opened on ({kind, ...}; for a create, {kind:'AREA'})
 * @param {object} draft
 * @param {{creating:boolean, editable:Set<string>, others:Array<object>, theaterAirspaceIds?:string[]}} ctx `others` = the other
 *   airspaces' definitions of this theater (name and frequency checks)
 * @returns {{fieldErrors:Object<string,string>, notes:string[], valid:boolean, problems:string[], summary:string, definition:object}}
 */
export function validateDraft(base, draft, { creating, editable, others = [] }) {
  const { definition, parseErrors } = definitionFromDraft(base, draft);
  const errors = {};
  const set = (f, msg) => { if (!errors[f]) errors[f] = msg; };
  Object.entries(parseErrors).forEach(([f, m]) => set(f, m));

  if (creating) {
    const id = String(draft.airspaceId || '').trim();
    if (!ID_PATTERN.test(id)) set('airspaceId', 'IDs are 2-24 characters of A-Z, 0-9 and "-".');
    else if (others.some(o => o.airspaceId === id)) set('airspaceId', 'This ID is already used in this theater.');
  }
  if (!definition.name) set('name', 'A name is required.');
  else if (definition.name.length > MAX_NAME_LENGTH) set('name', `At most ${MAX_NAME_LENGTH} characters.`);
  else if (others.some(o => String(o.name).toLowerCase() === definition.name.toLowerCase() && o.airspaceId !== definition.airspaceId)) {
    set('name', 'Another airspace here already has this name.');
  }
  if (!(definition.kind === 'ROUTE' ? ROUTE_TYPES : AREA_TYPES).includes(definition.type)) set('type', 'Pick a type.');
  if (!definition.controllingFacilityId) set('controllingFacilityId', 'Pick a Facility.');
  if (!definition.controllingPositionId) set('controllingPositionId', 'Pick a Position.');
  else if (definition.controllingFacilityId && !caps.positionsOf(definition.controllingFacilityId).includes(definition.controllingPositionId)) {
    set('controllingPositionId', `${definition.controllingPositionId} is not a Position at ${definition.controllingFacilityId}.`);
  }
  if (definition.usingFacilityId && definition.usingPositionId) set('usingFacilityId', 'Name at most one using agency.');
  if (definition.usingFacilityId && !errors.usingFacilityId) {
    const ref = checkAirspaceReferences({ ...definition, usingPositionId: null }, _lookup());
    if (ref && /using Facility|usingFacilityId/.test(ref.detail)) set('usingFacilityId', ref.detail.replace(`${definition.airspaceId}: `, '').replace(/^./, c => c.toUpperCase()));
  }
  if (definition.usingPositionId && !errors.usingPositionId) {
    const home = caps.facilityOfPosition(definition.usingPositionId);
    if (home !== 'RANGES') set('usingPositionId', `${definition.usingPositionId} is already a Position of ${home}; a range-control Position needs an id of its own.`);
  }
  for (const f of FREQUENCY_FIELDS) {
    if (!errors[f] && definition[f] != null && (definition[f] < MIN_FREQUENCY_MHZ || definition[f] > MAX_FREQUENCY_MHZ)) set(f, `${MIN_FREQUENCY_MHZ} to ${MAX_FREQUENCY_MHZ} MHz.`);
    else if (!errors[f] && definition[f] != null && Math.round(definition[f] * 1000) / 1000 !== definition[f]) set(f, 'At most 3 decimals.');
  }
  if (definition.kind === 'AREA') {
    for (const f of ALTITUDE_FIELDS) {
      if (!errors[f] && definition[f] != null && (!Number.isInteger(definition[f]) || definition[f] < 0 || definition[f] > MAX_ALTITUDE_FT)) set(f, `Whole feet, 0 to ${MAX_ALTITUDE_FT}.`);
    }
    if (!errors.altUpperFt && definition.altLowerFt != null && definition.altUpperFt != null && definition.altUpperFt <= definition.altLowerFt) {
      set('altUpperFt', `Must be above the lower limit (${definition.altLowerFt}).`);
    }
  }
  // Whatever the field checks did not catch (geometry, route legs, ...) comes from the copy of the server's own validator.
  if (!Object.keys(errors).length) {
    const checked = validateAirspaceDefinition(_forValidator(definition), { derived: 'recompute' });
    if (!checked.ok) {
      const d = checked.detail.replace(`${definition.airspaceId}: `, '');
      set(/segment|ROUTE|route/.test(d) ? 'segments' : (/geometry/.test(d) ? 'geometry' : '_general'), d);
    }
  }
  // Only what the session may change is its problem: a locked field that is unchanged is never reported.
  const reported = {};
  for (const [f, m] of Object.entries(errors)) {
    if (f === '_general' || f === 'airspaceId' || !editable || editable.has(f) || f === 'altUpperFt' && editable.has('altLowerFt')) reported[f] = m;
  }
  const notes = [];
  for (const f of FREQUENCY_FIELDS) {
    const v = definition[f];
    if (v == null || reported[f]) continue;
    for (const o of others) {
      if (o.workingFrequencyMhz === v || o.controlFrequencyMhz === v) {
        notes.push(`${fmtFreq(v)} is also the ${o.workingFrequencyMhz === v ? 'working' : 'control'} frequency of ${o.name}. Saving is still allowed.`);
        break;
      }
    }
  }
  const problems = Object.keys(reported);
  const summary = problems.length
    ? `${problems.length} problem${problems.length === 1 ? '' : 's'} to fix before Save: ${problems.map(f => (FIELD_LABELS[f] || f).replace(/ (MHz|ft|NM)$/, '')).join(', ')}.`
    : '';
  return { fieldErrors: reported, notes, valid: problems.length === 0, problems, summary, definition };
}

function _lookup() {
  return { hasFacility: (id) => caps.facilityIds().includes(id) || id === 'RANGES', positionsOf: (id) => caps.positionsOf(id), facilityOfPosition: caps.facilityOfPosition };
}
/** A definition as the validator takes it: no fields it does not know, a ROUTE without its derived altitudes. */
function _forValidator(def) {
  const out = { ...def };
  if (out.kind === 'ROUTE') { delete out.altLowerFt; delete out.altUpperFt; delete out.geometry; }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  delete out.theater;
  return out;
}

/** What the form says beside Save about the effect on flights already working an AREA (AIRSP-4), before anything is sent. */
export function impactNote({ flights, patch, definition }) {
  const lines = [];
  const next = { ...definition, ...patch };
  const count = flights.length;
  if (!count) return lines;
  lines.push(`Saving this changes a block with ${count} flight${count === 1 ? '' : 's'} approved into it. They keep the frequency and block they were given; nothing is retuned for them.`);
  const freqChanged = FREQUENCY_FIELDS.some(f => f in patch);
  if (freqChanged) {
    const current = [next.workingFrequencyMhz, next.controlFrequencyMhz].filter(v => v != null);
    const stale = flights.filter(f => f.frequencyMhz != null && !current.includes(f.frequencyMhz));
    if (stale.length) {
      lines.push(`${stale.map(f => f.callsign).join(' and ')} ${stale.length === 1 ? 'is' : 'are'} on ${[...new Set(stale.map(f => fmtFreq(f.frequencyMhz)))].join(', ')}. Re-approve ${stale.length === 1 ? 'it' : 'them'} on ${current.map(fmtFreq).join(' or ')} from the Strip${stale.length === 1 ? '' : 's'}.`);
    }
  }
  return lines;
}

/** The note under USING POSITION (R3-24): it derives a RANGES Position, which exists only after a restart. */
export const RESTART_NOTE = 'takes effect after the next crc-sync restart';

// ── conflicts (mockup scene 4) ──────────────────────────────────────────────────────────────────

/**
 * The conflict table after a STALE_REV answer.
 * @param {{ack:object, original:object, patch:object}} args `ack.conflicts` [{field, base, theirs}], `ack.airspace` the record now
 * @returns {{rows:Array<{field:string,label:string,base:*,theirs:*,yours:*,status:'conflict'|'clean'|'already'}>, currentDefRev:number, theirsRev:number, by:string|null, at:number|null}}
 */
export function conflictModel({ ack, original, patch }) {
  const conflicts = Array.isArray(ack.conflicts) ? ack.conflicts : [];
  const current = (ack.airspace && ack.airspace.definition) || {};
  const rows = Object.keys(patch).map((field) => {
    const c = conflicts.find(x => x.field === field);
    const theirs = c ? c.theirs : (field in current ? current[field] : original[field]);
    const status = c ? 'conflict' : (same(theirs, patch[field]) && !same(original[field], patch[field]) ? 'already' : 'clean');
    return { field, label: FIELD_LABELS[field] || field, base: c ? c.base : original[field], theirs, yours: patch[field], status };
  });
  // A "conflict" where they ended on exactly what we want is no conflict (both agree), so it needs no choice.
  for (const r of rows) if (r.status === 'conflict' && same(r.theirs, r.yours)) r.status = 'already';
  return {
    rows, currentDefRev: ack.airspace ? ack.airspace.defRev : null,
    by: ack.airspace ? ack.airspace.updatedBy || null : null, at: ack.airspace ? ack.airspace.updatedAt ?? null : null,
  };
}

/**
 * Turn the choices (field -> 'mine'|'theirs') into the patch to send against the current definition revision. A clashing
 * field needs a choice; Theirs drops the field; a field the other edit already set to the same value is dropped.
 * @returns {{ok:true, patch:object, baseDefRev:number|null, empty:boolean}|{ok:false, unresolved:string[]}}
 */
export function resolveConflicts(model, choices) {
  const unresolved = model.rows.filter(r => r.status === 'conflict' && !choices[r.field]).map(r => r.field);
  if (unresolved.length) return { ok: false, unresolved };
  const patch = {};
  for (const r of model.rows) {
    if (r.status === 'already') continue;
    if (r.status === 'conflict' && choices[r.field] === 'theirs') continue;
    patch[r.field] = r.yours;
  }
  return { ok: true, patch, baseDefRev: model.currentDefRev, empty: Object.keys(patch).length === 0 };
}

/** A value as the conflict table and the History view show it. */
export function valueText(field, value, transitionAltFt = 18000) {
  if (value == null) return 'none';
  if (ALTITUDE_FIELDS.includes(field)) return value >= transitionAltFt ? `${value} · ${altitudeText(value, transitionAltFt)}` : String(value);
  if (FREQUENCY_FIELDS.includes(field)) return fmtFreq(value);
  if (field === 'geometry') return value.points ? `${value.points.length} points` : 'none';
  if (field === 'segments') return `${value.length} fixes`;
  return String(value);
}

// ── the DOM half ────────────────────────────────────────────────────────────────────────────────

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * Open the editor. The returned view lives in `view.el`; the panel puts it in the card and keeps it across re-renders.
 * @param {object} o
 * @param {object|null} o.record the airspace record being edited; null to create
 * @param {{positionId:string, scope:'ALL'|'FREQUENCY'}|null} o.authority edit authority (ignored on create)
 * @param {string[]} o.signedOn the Positions this session is signed on to
 * @param {object[]} o.others the other airspaces' definitions of this theater
 * @param {Array<{stripId:string, callsign:string, frequencyMhz:number|null}>} o.flights the flights working it (AREA)
 * @param {number} o.transitionAltFt
 * @param {(positionId:string, airspaceId:string, baseRev:number, op:object, extra:object)=>string|undefined} o.send
 * @param {(zulu:number|null)=>string} o.zulu mission time as `1352Z` text
 * @param {()=>number} o.now mission time, ms
 * @param {(result:{saved:boolean, ack?:object})=>void} o.onClose
 */
export function openAirspaceEditor(o) {
  const creating = !o.record;
  const base = creating ? { kind: 'AREA' } : o.record.definition;
  const openedRev = creating ? null : o.record.defRev;
  const { editable, reasons } = editableFields({ record: o.record, creating, authority: o.authority, kind: base.kind });
  const state = { draft: draftFromDefinition(creating ? null : base, o.transitionAltFt), pending: null, phase: 'form', conflict: null, choices: {}, serverMessage: null, geo: null };
  if (creating) {
    const choices = caps.controllingChoicesFor(o.signedOn);
    if (choices.length) { state.draft.controllingFacilityId = choices[0].facilityId; state.draft.controllingPositionId = choices[0].positionId; }
    state.draft.type = AREA_TYPES[0];
  }

  const el = _el('div', 'airspace-editor');
  const head = _el('div', 'airspace-editor-head');
  el.appendChild(head);
  const body = _el('div', 'airspace-editor-body');
  el.appendChild(body);
  const inputs = {}; const rowEls = {}; const dots = {}; const wasEls = {}; const errEls = {};

  const asPosition = creating ? (caps.createPositionsFor(o.signedOn)[0] || {}).positionId : (o.authority && o.authority.positionId);
  head.appendChild(_el('span', 'airspace-editor-as', `${creating ? 'Creating' : 'Editing'} as `));
  head.appendChild(_el('strong', '', asPosition || '?'));
  if (!creating) {
    head.appendChild(_el('span', 'airspace-editor-meta', `definition rev ${openedRev}`));
    head.appendChild(_el('span', 'airspace-editor-meta', `opened ${o.zulu(o.now())}`));
  }

  // ── the form ──
  const form = _el('div', 'airspace-editor-form');
  const addRow = (field, control, extraNote) => {
    const row = _el('div', 'airspace-field');
    const label = _el('label', 'airspace-field-label');
    const dot = _el('span', 'airspace-dot', '•'); dot.hidden = true; dots[field] = dot;
    label.append(dot, document.createTextNode(FIELD_LABELS[field]));
    row.appendChild(label);
    row.appendChild(control);
    const was = _el('div', 'airspace-field-was'); was.hidden = true; wasEls[field] = was; row.appendChild(was);
    const err = _el('div', 'airspace-field-error'); err.hidden = true; errEls[field] = err; row.appendChild(err);
    const why = reasons[field];
    if (why && (field !== 'airspaceId' || !creating)) row.appendChild(_el('div', 'airspace-field-why', why));
    if (extraNote) row.appendChild(_el('div', 'airspace-field-why', extraNote));
    rowEls[field] = row;
    form.appendChild(row);
  };
  const input = (field, attrs = {}) => {
    const i = document.createElement('input');
    i.type = 'text'; i.value = state.draft[field] ?? ''; i.className = 'airspace-input';
    for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
    i.addEventListener('input', () => { state.draft[field] = i.value; refresh(); });
    inputs[field] = i; return i;
  };
  const select = (field, options, blank) => {
    const s = document.createElement('select'); s.className = 'airspace-input';
    if (blank != null) s.appendChild(new Option(blank, ''));
    for (const opt of options) s.appendChild(new Option(opt.label ?? opt, opt.value ?? opt));
    s.value = state.draft[field] ?? '';
    s.addEventListener('change', () => { state.draft[field] = s.value; onSelect(field); refresh(); });
    inputs[field] = s; return s;
  };
  const choicesFor = () => (creating ? caps.controllingChoicesFor(o.signedOn) : null);
  const facilityOptions = () => {
    if (creating) return [...new Set(choicesFor().map(c => c.facilityId))];
    return caps.facilityIds();
  };
  const positionOptions = () => {
    const f = state.draft.controllingFacilityId;
    if (creating) return choicesFor().filter(c => c.facilityId === f).map(c => c.positionId);
    return caps.positionsOf(f);
  };
  const fillPositions = () => {
    const s = inputs.controllingPositionId; if (!s) return;
    const keep = state.draft.controllingPositionId;
    s.innerHTML = '';
    for (const p of positionOptions()) s.appendChild(new Option(p, p));
    if (!positionOptions().includes(keep)) state.draft.controllingPositionId = positionOptions()[0] || '';
    s.value = state.draft.controllingPositionId;
  };
  const onSelect = (field) => {
    if (field === 'controllingFacilityId') fillPositions();
    // At most one using agency: choosing one clears the other (the server refuses both).
    if (field === 'usingFacilityId' && state.draft.usingFacilityId) { state.draft.usingPositionId = ''; if (inputs.usingPositionId) inputs.usingPositionId.value = ''; }
  };

  if (creating) addRow('airspaceId', input('airspaceId', { maxlength: 24, placeholder: 'MOA-ADS', autocapitalize: 'characters' }));
  else addRow('airspaceId', _el('div', 'airspace-readonly', base.airspaceId));
  addRow('name', input('name', { maxlength: MAX_NAME_LENGTH + 10 }));
  addRow('type', select('type', base.kind === 'ROUTE' ? ROUTE_TYPES : AREA_TYPES));
  addRow('controllingFacilityId', select('controllingFacilityId', facilityOptions()));
  addRow('controllingPositionId', select('controllingPositionId', positionOptions()));
  fillPositions();
  addRow('usingFacilityId', select('usingFacilityId', caps.facilityIds().filter(f => f !== 'RANGES'), 'none'));
  addRow('usingPositionId', input('usingPositionId', { placeholder: 'none' }), `config: ${RESTART_NOTE}`);
  addRow('workingFrequencyMhz', input('workingFrequencyMhz', { inputmode: 'decimal', placeholder: '139.250' }));
  addRow('controlFrequencyMhz', input('controlFrequencyMhz', { inputmode: 'decimal', placeholder: '251.500' }));
  if (base.kind !== 'ROUTE') {
    addRow('altLowerFt', input('altLowerFt', { placeholder: 'none = surface' }));
    addRow('altUpperFt', input('altUpperFt', { placeholder: 'none = unbounded' }));
  } else {
    addRow('altLowerFt', _el('div', 'airspace-readonly', altitudeText(base.altLowerFt, o.transitionAltFt) || 'surface'));
    addRow('altUpperFt', _el('div', 'airspace-readonly', altitudeText(base.altUpperFt, o.transitionAltFt) || 'unbounded'));
  }
  const geoHost = _el('div', 'airspace-geometry');
  form.appendChild(geoHost);
  const noteEl = _el('div', 'airspace-editor-notes');
  const impactEl = _el('div', 'airspace-editor-impact');
  const actions = _el('div', 'airspace-editor-actions');
  const saveBtn = _el('button', 'airspace-save-btn', 'Save');
  const cancelBtn = _el('button', 'airspace-action-btn', 'Cancel');
  const status = _el('span', 'airspace-editor-status');
  actions.append(saveBtn, cancelBtn, status);

  // Fields the session may not change are read-only (and say why under the field, above).
  for (const f of SCALAR_FIELDS) {
    if (inputs[f] && !editable.has(f)) inputs[f].disabled = true;
    if (rowEls[f] && !editable.has(f)) rowEls[f].classList.add('airspace-field-locked');
  }

  const geoDefinition = () => ({ ...base, ...(base.kind === 'ROUTE' ? { segments: state.draft.segments, defaultWidthNm: state.draft.defaultWidthNm } : { geometry: state.draft.geometry }) });
  const geoEditable = [...GEOMETRY_FIELDS].some(f => editable.has(f));
  state.geo = mountGeometryEditor(geoHost, geoDefinition(), (patch) => { Object.assign(state.draft, patch); refresh(); });
  if (!geoEditable && state.geo && state.geo.setReadOnly) state.geo.setReadOnly(reasons.geometry || reasons.segments || 'read-only');

  body.append(form, noteEl, impactEl, actions);

  // ── refresh: dirty marks, was-text, errors, Save ──
  let latest = null;
  function refresh() {
    const dirty = creating ? [] : dirtyFields(base, state.draft, o.transitionAltFt);
    latest = validateDraft(base, state.draft, { creating, editable, others: o.others });
    for (const f of SCALAR_FIELDS) {
      if (!rowEls[f]) continue;
      const isDirty = dirty.includes(f);
      dots[f].hidden = !isDirty;
      wasEls[f].hidden = !isDirty;
      if (isDirty) wasEls[f].textContent = `was ${wasText(f, base, o.transitionAltFt)}`;
      const msg = latest.fieldErrors[f];
      errEls[f].hidden = !msg; errEls[f].textContent = msg || '';
      rowEls[f].classList.toggle('airspace-field-bad', !!msg);
    }
    const geoErr = latest.fieldErrors.geometry || latest.fieldErrors.segments || latest.fieldErrors._general;
    state.geoError = geoErr || null;
    noteEl.innerHTML = '';
    for (const n of latest.notes) noteEl.appendChild(_el('div', 'airspace-note', `Not an error, for information: ${n}`));
    if (geoErr) noteEl.appendChild(_el('div', 'airspace-note airspace-note-bad', geoErr));
    const patch = creating ? null : buildPatch(base, state.draft, editable, o.transitionAltFt);
    state.patch = patch;
    impactEl.innerHTML = '';
    if (!creating && patch && Object.keys(patch).length) {
      for (const line of impactNote({ flights: o.flights || [], patch, definition: base })) impactEl.appendChild(_el('div', 'airspace-note', line));
      if ('usingPositionId' in patch) impactEl.appendChild(_el('div', 'airspace-note', `USING POSITION ${RESTART_NOTE}.`));
    }
    const changed = creating ? true : Object.keys(patch).length > 0;
    let why = '';
    if (state.pending) why = 'Sending...';
    else if (!latest.valid) why = latest.summary || (geoErr || 'Fix the problems first.');
    else if (!changed) why = 'Nothing changed.';
    saveBtn.disabled = !!state.pending || !latest.valid || !changed;
    if (state.serverMessage) { status.textContent = state.serverMessage; status.classList.add('airspace-status-bad'); }
    else {
      status.classList.remove('airspace-status-bad');
      status.textContent = saveBtn.disabled ? why : (creating ? 'Applies at once for everyone.' : `${Object.keys(patch).length} field${Object.keys(patch).length === 1 ? '' : 's'} changed. Applies at once, stamped ${o.zulu(o.now())}, for everyone.`);
    }
    saveBtn.title = saveBtn.disabled ? why : '';
  }

  function send(patch, defRev) {
    state.serverMessage = null;
    const op = creating
      ? { kind: 'CreateAirspace', definition: _createDefinition() }
      : { kind: 'EditAirspace', patch };
    const id = creating ? op.definition.airspaceId : base.airspaceId;
    state.sent = { patch, creating };
    state.pending = o.send(asPosition, id, creating ? 0 : o.record.rev, op, creating ? {} : { baseDefRev: defRev });
    if (state.pending == null) state.pending = '?';
    refresh();
  }
  function _createDefinition() {
    const { definition } = definitionFromDraft({ kind: 'AREA' }, state.draft);
    const out = {};
    for (const k of ['airspaceId', 'name', 'kind', 'type', 'controllingFacilityId', 'controllingPositionId', 'usingFacilityId', 'usingPositionId',
      'workingFrequencyMhz', 'controlFrequencyMhz', 'altLowerFt', 'altUpperFt', 'geometry']) {
      if (definition[k] !== null && definition[k] !== undefined) out[k] = definition[k];
    }
    return out;
  }

  saveBtn.addEventListener('click', () => { if (!saveBtn.disabled) send(creating ? null : state.patch, openedRev); });
  cancelBtn.addEventListener('click', () => { destroy(); o.onClose({ saved: false }); });

  // ── the conflict view ──
  function showConflict(ack) {
    state.phase = 'conflict';
    state.conflict = conflictModel({ ack, original: base, patch: state.sent.patch });
    state.choices = {};
    body.innerHTML = '';
    const m = state.conflict;
    const clashes = m.rows.filter(r => r.status === 'conflict');
    const box = _el('div', 'airspace-conflict');
    box.appendChild(_el('div', 'airspace-conflict-title', 'Not saved.'));
    box.appendChild(_el('div', 'airspace-conflict-text',
      `${m.by || 'Someone'} changed this airspace${m.at != null ? ` at ${o.zulu(m.at)}` : ''} while you were editing (definition rev ${openedRev} to ${m.currentDefRev}). `
      + (clashes.length ? `${clashes.length === 1 ? 'One of your fields clashes' : `${clashes.length} of your fields clash`} with their edit. Nothing was written.` : 'Nothing of yours clashes with it, but nothing was written.')));
    const table = _el('table', 'airspace-conflict-table');
    const hr = _el('tr'); for (const h of ['Field', 'You started from', 'They now', 'Yours', 'Use']) hr.appendChild(_el('th', '', h));
    table.appendChild(hr);
    const reviewBtn = _el('button', 'airspace-save-btn', 'Review and save');
    const refreshReview = () => { reviewBtn.disabled = !resolveConflicts(m, state.choices).ok; };
    for (const r of m.rows) {
      const tr = _el('tr', r.status === 'conflict' ? 'airspace-conflict-row-bad' : '');
      tr.appendChild(_el('td', '', r.label));
      tr.appendChild(_el('td', '', valueText(r.field, r.base, o.transitionAltFt)));
      tr.appendChild(_el('td', '', valueText(r.field, r.theirs, o.transitionAltFt)));
      tr.appendChild(_el('td', '', valueText(r.field, r.yours, o.transitionAltFt)));
      const use = _el('td');
      if (r.status === 'conflict') {
        for (const [key, text] of [['theirs', 'Theirs'], ['mine', 'Mine']]) {
          const b = _el('button', 'airspace-action-btn airspace-choice-btn', text);
          b.dataset.field = r.field; b.dataset.choice = key;
          b.addEventListener('click', () => {
            state.choices[r.field] = key;
            for (const x of use.querySelectorAll('button')) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
            refreshReview();
          });
          use.appendChild(b);
        }
      } else use.textContent = r.status === 'already' ? 'They already made this change' : 'Applies cleanly (they did not touch it)';
      tr.appendChild(use);
      table.appendChild(tr);
    }
    box.appendChild(table);
    const act = _el('div', 'airspace-editor-actions');
    const discard = _el('button', 'airspace-action-btn', 'Discard my changes');
    const stat = _el('span', 'airspace-editor-status');
    act.append(reviewBtn, discard, stat);
    box.appendChild(act);
    box.appendChild(_el('div', 'airspace-field-why', `Only the clashing ${clashes.length === 1 ? 'field needs' : 'fields need'} a choice. Saving re-sends your changes against rev ${m.currentDefRev}.`));
    body.appendChild(box);
    reviewBtn.disabled = !resolveConflicts(m, state.choices).ok;
    reviewBtn.addEventListener('click', () => {
      const res = resolveConflicts(m, state.choices);
      if (!res.ok) return;
      if (res.empty) { stat.textContent = 'Nothing left to save: you took theirs for everything.'; return; }
      state.sent = { patch: res.patch, creating: false };
      state.pending = o.send(asPosition, base.airspaceId, o.record.rev, { kind: 'EditAirspace', patch: res.patch }, { baseDefRev: res.baseDefRev }) ?? '?';
      stat.textContent = 'Sending...'; reviewBtn.disabled = true;
      state.conflictStat = stat;
    });
    discard.addEventListener('click', () => { destroy(); o.onClose({ saved: false }); });
  }

  /** The panel offers every airspace ack to every open view; true = it was this one's and is handled. */
  function handleAck(ack) {
    if (!state.pending) return false;
    if (state.pending !== '?' && ack.clientMutationId !== state.pending) return false;
    if (state.pending === '?' && ack.airspaceId !== (creating ? _createDefinition().airspaceId : base.airspaceId)) return false;
    state.pending = null;
    if (ack.ok) { destroy(); o.onClose({ saved: true, ack }); return true; }
    if (ack.reason === 'STALE_REV' && !creating && Array.isArray(ack.conflicts)) { showConflict(ack); return true; }
    const text = ack.reason === 'NOT_FOUND' ? 'This airspace no longer exists (it was deleted).'
      : (ack.detail || ack.reason || 'Refused.');
    state.serverMessage = text;
    if (state.phase === 'conflict' && state.conflictStat) { state.conflictStat.textContent = text; state.conflictStat.classList.add('airspace-status-bad'); }
    else refresh();
    return true;
  }
  function destroy() { if (state.geo && state.geo.destroy) state.geo.destroy(); el.remove(); }

  refresh();
  return { el, kind: 'edit', handleAck, destroy, model: () => ({ state, latest, editable, reasons }) };
}
