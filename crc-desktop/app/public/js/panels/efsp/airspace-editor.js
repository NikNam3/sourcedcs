'use strict';

// The inline airspace editor's DOM half (docs/adr/0098 §4; mockup scenes 2-4, docs/wip/AIRSP-mockup.html). The model it drives
// (the draft, which fields may change, validation, impact note, conflicts) is airspace-draft.js; the panel hands this a `send`.
//
// Colour (ADR 0056/0058): everything is grey; orange-red (--efsp-bad) marks only an error or the one clashing row.

import { AREA_TYPES, ROUTE_TYPES, MAX_NAME_LENGTH } from './airspace-validate.js';
import * as caps from './airspace-capabilities.js';
import { FIELD_LABELS, SCALAR_FIELDS, GEOMETRY_FIELDS, altitudeText, draftFromDefinition, definitionFromDraft, editableFields, dirtyFields, buildPatch, wasText, validateDraft, impactNote, RESTART_NOTE, conflictModel, resolveConflicts, valueText } from './airspace-draft.js';
import { mountGeometryEditor } from './airspace-geometry-editor.js';

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
  let base = creating ? { kind: 'AREA' } : o.record.definition;
  const openedRev = creating ? null : o.record.defRev;
  let { editable, reasons } = editableFields({ record: o.record, creating, authority: o.authority, kind: base.kind });
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

  // T27: a create is sent as the draft's controlling Position when held (else OPS of its Facility, else the first creator),
  // so it follows the CTRL FACILITY/POSITION pickers; an edit acts as the Position the panel chose (authorityFor).
  const actingPosition = () => (creating
    ? caps.createActingPositionFor(o.signedOn, { controllingFacilityId: state.draft.controllingFacilityId, controllingPositionId: state.draft.controllingPositionId })
    : (o.authority && o.authority.positionId));
  head.appendChild(_el('span', 'airspace-editor-as', `${creating ? 'Creating' : 'Editing'} as `));
  const asEl = _el('strong', 'airspace-editor-as-position', actingPosition() || '?');
  head.appendChild(asEl);
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

  const noteEl = _el('div', 'airspace-editor-notes');
  const impactEl = _el('div', 'airspace-editor-impact');
  const actions = _el('div', 'airspace-editor-actions');
  const saveBtn = _el('button', 'airspace-save-btn', 'Save');
  const cancelBtn = _el('button', 'airspace-action-btn', 'Cancel');
  const status = _el('span', 'airspace-editor-status');
  actions.append(saveBtn, cancelBtn, status);

  function buildForm() {
    if (state.geo && state.geo.destroy) state.geo.destroy();
    state.geo = null;
    form.innerHTML = '';
    for (const m of [inputs, rowEls, dots, wasEls, errEls]) for (const k of Object.keys(m)) delete m[k];
  if (creating) {
    const kindSel = document.createElement('select'); kindSel.className = 'airspace-input'; kindSel.id = 'airspace-kind';
    for (const k of ['AREA', 'ROUTE']) kindSel.appendChild(new Option(k === 'AREA' ? 'AREA (an outline: MOA, restricted, prohibited or warning area)' : 'ROUTE (a corridor: an MTR)', k));
    kindSel.value = base.kind;
    kindSel.addEventListener('change', () => switchKind(kindSel.value));
    inputs.kind = kindSel; addRow('kind', kindSel);
  }
  if (creating) addRow('airspaceId', input('airspaceId', { maxlength: 24, placeholder: 'MOA-ADS', autocapitalize: 'characters' }));
  else addRow('airspaceId', _el('div', 'airspace-readonly', base.airspaceId));
  addRow('name', input('name', { maxlength: MAX_NAME_LENGTH + 10 }));
  addRow('type', select('type', base.kind === 'ROUTE' ? ROUTE_TYPES : AREA_TYPES));
  addRow('controllingFacilityId', select('controllingFacilityId', facilityOptions()));
  addRow('controllingPositionId', select('controllingPositionId', positionOptions()));
  fillPositions();
  addRow('usingFacilityId', select('usingFacilityId', caps.facilityIds().filter(f => f !== 'RANGES'), 'none'));
  addRow('usingPositionId', input('usingPositionId', { placeholder: 'none' }), `config: ${RESTART_NOTE}`);
  addRow('workingFrequencyMhz', input('workingFrequencyMhz', { inputmode: 'decimal', placeholder: 'MHz' }));
  addRow('controlFrequencyMhz', input('controlFrequencyMhz', { inputmode: 'decimal', placeholder: 'MHz' }));
  if (base.kind !== 'ROUTE') {
    addRow('altLowerFt', input('altLowerFt', { placeholder: 'none = surface' }));
    addRow('altUpperFt', input('altUpperFt', { placeholder: 'none = unbounded' }));
  } else {
    addRow('altLowerFt', _el('div', 'airspace-readonly', altitudeText(base.altLowerFt, o.transitionAltFt) || 'surface'));
    addRow('altUpperFt', _el('div', 'airspace-readonly', altitudeText(base.altUpperFt, o.transitionAltFt) || 'unbounded'));
  }
  const geoHost = _el('div', 'airspace-geometry');
  form.appendChild(geoHost);
  // Fields the session may not change are read-only (and say why under the field, above).
  for (const f of SCALAR_FIELDS) {
    if (inputs[f] && !editable.has(f)) inputs[f].disabled = true;
    if (rowEls[f] && !editable.has(f)) rowEls[f].classList.add('airspace-field-locked');
  }

  const geoDefinition = () => ({ ...base, ...(base.kind === 'ROUTE' ? { segments: state.draft.segments, defaultWidthNm: state.draft.defaultWidthNm } : { geometry: state.draft.geometry }) });
  const geoEditable = [...GEOMETRY_FIELDS].some(f => editable.has(f));
  state.geo = mountGeometryEditor(geoHost, geoDefinition(), (patch) => { Object.assign(state.draft, patch); refresh(); });
  if (!geoEditable && state.geo && state.geo.setReadOnly) state.geo.setReadOnly(reasons.geometry || reasons.segments || 'read-only');

  }
  /** Creating: choosing AREA or ROUTE rebuilds the form for that kind (the ID, name, Position and frequencies stay). */
  function switchKind(kind) {
    const keep = Object.fromEntries(['airspaceId', 'name', 'controllingFacilityId', 'controllingPositionId', 'usingFacilityId', 'usingPositionId', 'workingFrequencyMhz', 'controlFrequencyMhz'].map(f => [f, state.draft[f]]));
    base = { kind };
    ({ editable, reasons } = editableFields({ record: null, creating: true, authority: null, kind }));
    state.draft = { ...draftFromDefinition({ kind }, o.transitionAltFt), ...keep, type: (kind === 'ROUTE' ? ROUTE_TYPES : AREA_TYPES)[0] };
    state.serverMessage = null;
    buildForm();
    refresh();
  }
  buildForm();

  body.append(form, noteEl, impactEl, actions);

  // ── refresh: dirty marks, was-text, errors, Save ──
  let latest = null;
  function refresh() {
    asEl.textContent = actingPosition() || '?';
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
    state.pending = o.send(actingPosition(), id, creating ? 0 : o.record.rev, op, creating ? {} : { baseDefRev: defRev }, { onAck: handleAck }) ?? '?';
    refresh();
  }
  function _createDefinition() {
    const { definition } = definitionFromDraft({ kind: base.kind }, state.draft);
    const out = {};
    for (const k of ['airspaceId', 'name', 'kind', 'type', 'controllingFacilityId', 'controllingPositionId', 'usingFacilityId', 'usingPositionId',
      'workingFrequencyMhz', 'controlFrequencyMhz', 'altLowerFt', 'altUpperFt', 'geometry', 'segments', 'defaultWidthNm']) {
      if (base.kind === 'ROUTE' && (k === 'altLowerFt' || k === 'altUpperFt')) continue;
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
      state.pending = o.send(actingPosition(), base.airspaceId, o.record.rev, { kind: 'EditAirspace', patch: res.patch }, { baseDefRev: res.baseDefRev }, { onAck: handleAck }) ?? '?';
      stat.textContent = 'Sending...'; reviewBtn.disabled = true;
      state.conflictStat = stat;
    });
    discard.addEventListener('click', () => { destroy(); o.onClose({ saved: false }); });
  }

  /** The one ack path hands this view the ack of its own send (airspace-panel.js `_sendDefinitionOp`); true = shown here. */
  function handleAck(ack) {
    if (!state.pending) return false;
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
