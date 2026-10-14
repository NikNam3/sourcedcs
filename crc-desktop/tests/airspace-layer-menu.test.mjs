/* AIRSP-2P-B, H100 DA-9: the airspace layer menu's model. The whole rule: shown when its layer is on and, if it has an
   individual setting, that wins; otherwise when both its kind and its state are enabled. Default = ACTIVE only. */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../app/public/js/airspace-layer-menu.js';

const sq = { source: 'POLYGON', points: [[36, 35], [36, 36], [37, 36], [37, 35]] };
const area = (id, state, type = 'MOA', geometry = sq, fac = 'CENTER') => ({ airspaceId: id, state, definition: { airspaceId: id, name: id, kind: 'AREA', type, controllingFacilityId: fac, geometry } });
const route = (id, state) => ({ airspaceId: id, state, definition: { airspaceId: id, name: id, kind: 'ROUTE', type: 'VR', controllingFacilityId: 'CENTER', defaultWidthNm: 4, segments: [{ fix: { name: 'A', lat: 1, lon: 1 }, altLowerFt: 1, altUpperFt: 2, widthNm: null }, { fix: { name: 'B', lat: 2, lon: 2 }, altLowerFt: null, altUpperFt: null, widthNm: null }] } });
const T = 'Syria';

test('default: outlines, labels and corridors on, centrelines off, every kind on but JURISDICTION, ACTIVE only, no overrides', () => {
  const d = m.defaultMenu();
  assert.deepEqual(d.layers, { outlines: true, labels: true, corridors: true, centrelines: false });
  assert.ok(m.MENU_KINDS.every(k => d.kinds[k] === (k !== 'JURISDICTION')));
  assert.deepEqual(d.states, { SCHEDULED: false, ACTIVE: true, RELEASED: false, RETURNED: false });
  assert.deepEqual(d.overrides, {});
  assert.equal(m.isDefaultMenu(d), true);
});

test('default shows ACTIVE airspaces only, of any kind', () => {
  const d = m.defaultMenu();
  assert.equal(m.decide(area('A', 'ACTIVE'), d, T).shown, true);
  assert.equal(m.decide(route('R', 'ACTIVE'), d, T).shown, true);
  for (const s of ['SCHEDULED', 'RELEASED', 'RETURNED']) assert.equal(m.decide(area('A', s), d, T).shown, false, s);
});

test('a jurisdiction area (crc-sync ADR 0125): off by default, its kind alone decides (it has no state)', () => {
  const j = (state) => ({ airspaceId: 'LTAG-CZ', state, definition: { airspaceId: 'LTAG-CZ', name: 'LTAG CTR (control zone)', kind: 'JURISDICTION', type: null, controllingFacilityId: 'INCIRLIK', geometry: { source: 'CIRCLE', centre: { lat: 37, lon: 35.4 }, radiusNm: 5, cut: null } } });
  assert.equal(m.kindOf(j('RETURNED').definition), 'JURISDICTION');
  assert.equal(m.hasOutline(j('RETURNED').definition), true);
  assert.equal(m.decide(j('RETURNED'), m.defaultMenu(), T).shown, false);
  const on = m.setKind(m.defaultMenu(), 'JURISDICTION', true);
  for (const s of ['SCHEDULED', 'ACTIVE', 'RELEASED', 'RETURNED']) assert.equal(m.decide(j(s), on, T).shown, true, s);
});

test('each kind toggle and each state toggle', () => {
  let d = m.setKind(m.defaultMenu(), 'MOA', false);
  assert.equal(m.decide(area('A', 'ACTIVE', 'MOA'), d, T).shown, false);
  assert.equal(m.decide(area('A', 'ACTIVE', 'RANGE'), d, T).shown, true);
  d = m.setKind(m.defaultMenu(), 'ROUTE', false);
  assert.equal(m.decide(route('R', 'ACTIVE'), d, T).shown, false);
  d = m.setState(m.defaultMenu(), 'RETURNED', true);
  assert.equal(m.decide(area('A', 'RETURNED'), d, T).shown, true);
  d = m.setState(d, 'ACTIVE', false);
  assert.equal(m.decide(area('B', 'ACTIVE'), d, T).shown, false);
});

test('each layer toggle', () => {
  let d = m.setLayer(m.defaultMenu(), 'outlines', false);
  assert.equal(m.decide(area('A', 'ACTIVE'), d, T).shown, false);
  assert.equal(m.decide(route('R', 'ACTIVE'), d, T).shown, true); // routes follow corridors/centrelines
  d = m.setLayer(m.defaultMenu(), 'labels', false);
  const dec = m.decide(area('A', 'ACTIVE'), d, T); assert.equal(dec.shown, true); assert.equal(dec.drawsLabel, false); assert.equal(dec.drawsOutline, true);
  d = m.setLayer(m.setLayer(m.defaultMenu(), 'corridors', false), 'centrelines', false);
  assert.equal(m.decide(route('R', 'ACTIVE'), d, T).shown, false);
  d = m.setLayer(m.setLayer(m.defaultMenu(), 'corridors', false), 'centrelines', true);
  const r = m.decide(route('R', 'ACTIVE'), d, T); assert.equal(r.drawsCorridor, false); assert.equal(r.drawsCentreline, true);
});

test('an individual setting beats the kind and state filters, both ways; its layer must still be on', () => {
  let d = m.setOverride(m.defaultMenu(), T, 'SCHED-MOA', 'on');
  assert.equal(m.decide(area('SCHED-MOA', 'SCHEDULED'), d, T).shown, true);
  d = m.setOverride(d, T, 'NOISY', 'off');
  assert.equal(m.decide(area('NOISY', 'ACTIVE'), d, T).shown, false);
  assert.equal(m.decide(area('NOISY', 'ACTIVE'), d, T).word, 'hidden');
  d = m.setLayer(d, 'outlines', false);
  assert.equal(m.decide(area('SCHED-MOA', 'SCHEDULED'), d, T).shown, false); // "its layer is on" comes first
  // 'filter' removes the individual setting
  d = m.setOverride(m.setOverride(m.defaultMenu(), T, 'X', 'on'), T, 'X', 'filter');
  assert.deepEqual(d.overrides, {});
});

test('an airspace with no outline is never shown and says so', () => {
  const d = m.setOverride(m.defaultMenu(), T, 'N', 'on');
  const dec = m.decide(area('N', 'ACTIVE', 'MOA', null), d, T);
  assert.equal(dec.shown, false); assert.equal(dec.word, 'no outline');
  assert.equal(m.decide(area('A', 'ACTIVE'), m.defaultMenu(), T).word, 'shown');
});

test('reset restores the default; isDefaultMenu notices every kind of change', () => {
  let d = m.setOverride(m.setState(m.setKind(m.setLayer(m.defaultMenu(), 'centrelines', true), 'WARNING', false), 'RETURNED', true), T, 'A', 'off');
  assert.equal(m.isDefaultMenu(d), false);
  assert.equal(m.isDefaultMenu(m.resetMenu()), true);
  for (const f of [(x) => m.setLayer(x, 'labels', false), (x) => m.setKind(x, 'ROUTE', false), (x) => m.setState(x, 'SCHEDULED', true), (x) => m.setOverride(x, T, 'A', 'on')]) assert.equal(m.isDefaultMenu(f(m.defaultMenu())), false);
  void d;
});

test('theater switch: individual settings are per theater and hold when switching back', () => {
  let d = m.setOverride(m.defaultMenu(), 'Syria', 'A', 'off');
  d = m.setOverride(d, 'Caucasus', 'A', 'on');
  assert.equal(m.overrideOf(d, 'Syria', 'A'), 'off');
  assert.equal(m.overrideOf(d, 'Caucasus', 'A'), 'on');
  assert.equal(m.overrideOf(d, 'Nevada', 'A'), 'filter');
  assert.equal(m.decide(area('A', 'ACTIVE'), d, 'Syria').shown, false);
  assert.equal(m.decide(area('A', 'ACTIVE'), d, 'Nevada').shown, true);
});

test('an override for a deleted airspace is pruned; others stay; no change returns the same object', () => {
  let d = m.setOverride(m.setOverride(m.defaultMenu(), T, 'GONE', 'on'), T, 'HERE', 'off');
  const p = m.pruneOverrides(d, T, ['HERE', 'OTHER']);
  assert.deepEqual(p.overrides[T], { HERE: 'off' });
  assert.equal(m.pruneOverrides(p, T, ['HERE']), p);
  assert.deepEqual(m.pruneOverrides(p, T, []).overrides, {});
});

test('persistence round trip, and a damaged stored menu falls back to defaults field by field', () => {
  const d = m.setOverride(m.setState(m.setLayer(m.defaultMenu(), 'centrelines', true), 'RETURNED', true), T, 'A', 'off');
  assert.deepEqual(m.sanitizeMenu(JSON.parse(JSON.stringify(d))), d);
  assert.deepEqual(m.sanitizeMenu(null), m.defaultMenu());
  const bad = m.sanitizeMenu({ layers: { outlines: 'yes', labels: false }, kinds: 5, states: { ACTIVE: false }, overrides: { Syria: { A: 'maybe', B: 'on' }, X: 3 } });
  assert.equal(bad.layers.outlines, true); assert.equal(bad.layers.labels, false);
  assert.equal(bad.kinds.MOA, true); assert.equal(bad.states.ACTIVE, false); assert.equal(bad.states.RETURNED, false);
  assert.deepEqual(bad.overrides, { Syria: { B: 'on' } });
});

test('the checklist groups by controlling Facility, sorted by name, filtered by the search box', () => {
  const list = [area('B', 'ACTIVE', 'MOA', sq, 'CENTER'), area('A', 'ACTIVE', 'MOA', sq, 'INCIRLIK'), area('C', 'RETURNED', 'MOA', sq, 'CENTER')];
  const g = m.checklistGroups(list, '');
  assert.deepEqual(g.map(x => x.facilityId), ['CENTER', 'INCIRLIK']);
  assert.deepEqual(g[0].airspaces.map(a => a.airspaceId), ['B', 'C']);
  assert.deepEqual(m.checklistGroups(list, 'c').flatMap(x => x.airspaces.map(a => a.airspaceId)), ['C']);
});
