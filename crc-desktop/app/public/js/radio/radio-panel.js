'use strict';

// The new radio panel, "RADIO 2" (docs/adr/0158 §2): it draws the radio set and handles clicks. The set is recomputed
// (radio-set.js, pure) from the EFSP state (radio-inputs.js) and the prefs (radio-prefs.js) whenever either changes,
// and sent to the engine. The rows are rebuilt only when what they show changes (radio-panel-model.js structureKey);
// RX/TX and the engine line are repainted in place on every engine state. The pieces: radio-row.js (a row),
// link-group-editor.js (group headers, + GROUP), manual-radio-form.js (+ RADIO), radio-setup.js (devices, PTT key...),
// radio-ptt.js (push-to-talk).
//
// The engine is radio-engine.js (docs/adr/0158 §1); a test injects a fake through initRadioPanel({ engine }).

import * as radioEngine from './radio-engine.js';
import { el } from './radio-dom.js';
import { readRadioInputs } from './radio-inputs.js';
import { buildRadioSet, positionsWithoutRow, rowsWithoutRadio } from './radio-set.js';
import {
  createGroup, deleteGroup, groupPttRadio, intendedGroupOf, moveRadio, renameGroup, resolvePttTarget,
} from './link-groups.js';
import {
  getRadioPrefs, onRadioPrefsChanged, radioAudioOf, removeManualRadio, retuneManualRadio, updateRadioPrefs,
  withGroups, withMembership, withPttTarget, withRadioAudio, addManualRadio, addIntercom, removeIntercom, withIntercomUnit,
} from './radio-prefs.js';
import { bindRadioPrefsToSettings } from './radio-prefs-storage.js';
import {
  engineLine, linkMenuOptions, noRowNotes, outOfBandNote, panelSections, radioActivity, structureKey,
} from './radio-panel-model.js';
import { buildRadioRow, paintRadioActivity } from './radio-row.js';
import { buildGroupCreate, buildGroupHeader } from './link-group-editor.js';
import { buildManualRadioForm, parseManualFrequency } from './manual-radio-form.js';
import { buildRadioSetup } from './radio-setup.js';
import { createRadioPtt, setRadioPanelIsClient } from './radio-ptt.js';
import { createEngineSync } from './radio-engine-sync.js';
import { createRelaySync } from './radio-relay-sync.js';
import { onEfspChanged } from '../panels/efsp/efsp-change-bus.js';

const MANUAL_PREFIX = 'MANUAL:';

let _root = null;
let _bodyEl = null;
let _lineEl = null;
let _pttBtn = null;
let _set = { radios: [], groups: [] };
let _target = null;
let _engineState = null;
let _lastKey = null;
let engine = radioEngine;
let _sync = null;
let _relay = null;
// What the controller is in the middle of: one inline edit at a time, and the last refusal it got.
const _ui = { editing: null, editError: null, renaming: null, renameError: null, groupError: null, manualOpen: false, manualError: null };

const relayingIds = () => (_relay ? _relay.relayingGroupIds() : []);
const relayDown = () => (_relay ? _relay.downNote() : null);
const srsClientsOf = (state) => (state && Array.isArray(state.srsClients) ? state.srsClients : []);

function setUi(patch) { Object.assign(_ui, patch); render(); }
const update = (fn) => updateRadioPrefs(fn);

function rowCtx(radio, prefs) {
  const groupIds = new Set(_set.groups.map(g => g.id));
  const manualId = radio.kind === 'MANUAL' ? radio.id.slice(MANUAL_PREFIX.length) : null;
  const audio = radioAudioOf(prefs, radio.id);
  const editing = _ui.editing === radio.id;
  return {
    audio, isTarget: _target === radio.id, editing, editError: editing ? _ui.editError : null,
    linkOptions: linkMenuOptions(_set, radio, intendedGroupOf(radio, prefs.membership, groupIds)),
    onTarget: () => update(p => withPttTarget(p, radio.id)),
    onMove: (groupId) => update(p => withMembership(p, moveRadio(p.membership, radio, groupId))),
    onAudio: (patch, commit) => {
      const next = { ...radioAudioOf(getRadioPrefs(), radio.id), ...patch };
      engine.setRadioAudio(radio.id, next);
      if (!commit) return;
      if ('muted' in patch) _lastKey = null; // the MUTE button's own face changes
      update(p => withRadioAudio(p, radio.id, patch));
    },
    onEdit: (on) => setUi({ editing: on ? radio.id : null, editError: null }),
    onRetune: (text) => {
      const r = parseManualFrequency(text);
      if (r.error) { setUi({ editError: r.error }); return; }
      _ui.editing = null; _ui.editError = null;
      update(p => retuneManualRadio(p, manualId, { mhz: r.mhz }));
    },
    onModulation: () => update(p => retuneManualRadio(p, manualId, { modulation: radio.modulation === 'AM' ? 'FM' : 'AM' })),
    onRemove: () => update(p => (radio.kind === 'INTERCOM' ? removeIntercom(p) : removeManualRadio(p, manualId))),
    srsClients: srsClientsOf(_engineState),
    intercomUnitId: prefs.intercom ? prefs.intercom.unitId : null,
    onIntercomUnit: (unitId) => update(p => withIntercomUnit(p, unitId)),
  };
}

// A group's PTT mark: lit when the PTT target is one of its radios; a press targets its first radio that may transmit.
function pttCtx(group) {
  const full = _set.groups.find(g => g.id === group.id);
  const radioId = groupPttRadio(_set, full);
  const target = _set.radios.find(r => r.id === _target);
  return {
    isTarget: !!target && target.groupId === group.id, disabled: !radioId,
    onTarget: () => { if (radioId) update(p => withPttTarget(p, radioId)); },
  };
}

function groupCtx(group) {
  return {
    renaming: _ui.renaming === group.id, renameError: _ui.renaming === group.id ? _ui.renameError : null,
    onRename: (on) => setUi({ renaming: on ? group.id : null, renameError: null }),
    onRenameCommit: (text) => {
      const r = renameGroup(getRadioPrefs().groups, group.id, text);
      if (r.error) { setUi({ renameError: r.error }); return; }
      _ui.renaming = null; _ui.renameError = null;
      update(p => withGroups(p, r.groups));
    },
    onDelete: () => update((p) => { const d = deleteGroup(p, group.id); return withMembership(withGroups(p, d.groups), d.membership); }),
  };
}

function onCreateGroup() {
  const r = createGroup(getRadioPrefs().groups);
  if (r.error) { setUi({ groupError: r.error }); return; }
  _ui.groupError = null;
  update(p => withGroups(p, r.groups));
}

function onAddManual({ label, text }) {
  const r = parseManualFrequency(text);
  if (r.error) { setUi({ manualError: r.error }); return; }
  _ui.manualOpen = false; _ui.manualError = null;
  update(p => addManualRadio(p, { label, mhz: r.mhz }).prefs);
}

function buildBody(prefs, notes) {
  const frag = document.createDocumentFragment();
  const down = relayDown(); // docs/adr/0160: crc-sync's relay is down for one of this session's networks
  if (down) frag.appendChild(el('div', 'radio-note radio-panel-note radio-problem', down));
  for (const n of notes) frag.appendChild(el('div', 'radio-note radio-panel-note', n));
  for (const section of panelSections(_set)) {
    const sec = el('div', 'radio-section' + (section.group && section.group.auto ? ' radio-section-auto' : ''));
    const relaying = !!section.group && relayingIds().includes(section.group.id);
    const ptt = section.group ? pttCtx(section.group) : null;
    sec.appendChild(buildGroupHeader(section.group, { ...(section.group && !section.group.auto ? groupCtx(section.group) : {}), relaying, ptt }));
    if (!section.radios.length) sec.appendChild(el('div', 'radio-note radio-empty', section.group && section.group.auto ? 'no Position radio' : 'no radio'));
    for (const r of section.radios) sec.appendChild(buildRadioRow(r, { ...rowCtx(r, prefs), inGroup: !!section.group }));
    frag.appendChild(sec);
  }
  const foot = el('div', 'radio-foot');
  foot.append(
    buildGroupCreate(onCreateGroup, _ui.groupError),
    buildManualRadioForm({ open: _ui.manualOpen, error: _ui.manualError, onOpen: (on) => setUi({ manualOpen: on, manualError: null }), onAdd: onAddManual }),
  );
  if (!prefs.intercom) { // one intercom at most (H183)
    const ic = el('button', 'radio-small-btn', '+ INTERCOM', { type: 'button', title: 'An intercom (one at most), never linked' });
    ic.addEventListener('click', () => update(p => addIntercom(p)));
    foot.appendChild(ic);
  }
  frag.appendChild(foot);
  _bodyEl.replaceChildren(frag);
}

/** Recomputes the set, tells the engine, and redraws what changed. */
export function render() {
  const prefs = getRadioPrefs();
  const { staffed, rows } = readRadioInputs();
  _set = buildRadioSet({ staffed, rows, manual: prefs.manual, intercom: prefs.intercom, groups: prefs.groups, membership: prefs.membership });
  if (_sync) _sync.push(_set, prefs);
  if (_relay) _relay.push(_set);
  if (engine.setIdentity) engine.setIdentity({ name: srsNameFor(staffed) });
  _target = resolvePttTarget(_set, prefs.pttTarget);
  if (!_bodyEl) return;
  const notes = [...noRowNotes(positionsWithoutRow(staffed, rows)), outOfBandNote(rowsWithoutRadio(staffed, rows))].filter(Boolean);
  const key = structureKey(_set, { pttTarget: _target, editing: [_ui, notes, prefs.intercom, srsClientsOf(_engineState), relayingIds(), relayDown()] });
  if (key !== _lastKey) { _lastKey = key; buildBody(prefs, notes); }
  paint();
}

/** RX/TX on the rows, the PTT button, the engine line: in place, no rebuild. */
function paint() {
  if (!_bodyEl) return;
  for (const row of _bodyEl.querySelectorAll('.radio-row')) paintRadioActivity(row, radioActivity(_engineState, row.dataset.radioId));
  const line = engineLine(_engineState);
  _lineEl.textContent = line.text;
  _lineEl.classList.toggle('radio-problem', line.problem);
  const target = _set.radios.find(r => r.id === _target);
  _pttBtn.textContent = target ? `PTT ${target.label}` : 'PTT';
  _pttBtn.disabled = !target;
  _pttBtn.classList.toggle('radio-ptt-tx', !!(_engineState && (_engineState.txRadioIds || []).length));
}

function buildHeader(ptt) {
  const head = el('div', 'radio-head');
  _lineEl = el('span', 'radio-engine-line');
  _pttBtn = el('button', 'radio-ptt', 'PTT', { type: 'button', title: 'Hold to transmit on the selected radio\'s group' });
  const down = (e) => { e.preventDefault(); ptt.down(); };
  const up = (e) => { e.preventDefault(); ptt.up(); };
  _pttBtn.addEventListener('mousedown', down);
  for (const ev of ['mouseup', 'mouseleave']) _pttBtn.addEventListener(ev, up);
  _pttBtn.addEventListener('touchstart', down, { passive: false });
  for (const ev of ['touchend', 'touchcancel']) _pttBtn.addEventListener(ev, up, { passive: false });
  const setupBtn = el('button', 'radio-small-btn', 'SETUP', { type: 'button', title: 'Devices, PTT key, sound' });
  head.append(_pttBtn, _lineEl, setupBtn);
  return { head, setupBtn };
}

/** The dock's init (dock.js mountExistingPanel), once. */
// The name in the SRS client list: the Positions this session works, e.g. "CRC LC+GC" (S-RADIO-1 RQ3).
function srsNameFor(staffed) {
  const ids = staffed.filter(s => !s.observer).map(s => s.positionId);
  return ids.length ? `CRC ${ids.join('+')}`.slice(0, 32) : 'CRC';
}

// The radio client this crc-desktop runs (S-RADIO-1 RQ11): /js/config.js's RADIO_CLIENT, set by main.js.
const radioClientIsNode = () => (typeof RADIO_CLIENT !== 'undefined' && RADIO_CLIENT === 'node');

export function initRadioPanel({ engine: injected } = {}) {
  _root = document.getElementById('radio-panel');
  if (!_root) return null;
  if (injected) engine = injected;
  _sync = createEngineSync(engine);
  _relay = createRelaySync({ onStatusChanged: () => render() });
  setRadioPanelIsClient(radioClientIsNode());
  bindRadioPrefsToSettings();
  const ptt = createRadioPtt({ engine, getTarget: () => _target, setActive: (on) => _pttBtn && _pttBtn.classList.toggle('radio-ptt-held', on) });
  const { head, setupBtn } = buildHeader(ptt);
  _bodyEl = el('div', 'radio-body');
  const setup = buildRadioSetup(engine);
  setup.element.hidden = true;
  setupBtn.addEventListener('click', () => { setup.element.hidden = !setup.element.hidden; setupBtn.classList.toggle('radio-small-btn-on', !setup.element.hidden); });
  _root.replaceChildren(head, setup.element, _bodyEl);
  onRadioPrefsChanged(() => render());
  engine.onState((s) => {
    const clientsBefore = JSON.stringify(srsClientsOf(_engineState));
    _engineState = s;
    if (JSON.stringify(srsClientsOf(s)) !== clientsBefore) render(); // the intercom's unit picker lists them
    else paint();
  });
  render();
  return { onShow: () => render() };
}

// The Positions this session is signed on at and the frequency table both change under these topics (radio-inputs.js).
onEfspChanged(['snapshot', 'positions'], () => { if (_root) render(); });
