/* The airspace editor's model (AIRSP-2P-A): which fields a session may change (R3-23 lock, authority scope), what a draft
   changes, what is wrong with it, how a STALE_REV answer becomes the conflict table and the choices become a patch. */

import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { editableFields, lockReason, draftFromDefinition, definitionFromDraft, dirtyFields, buildPatch, validateDraft, wasText, impactNote, conflictModel, resolveConflicts, altitudeText, parseAltitudeText, parseFrequencyText, RESTART_NOTE } from '../app/public/js/panels/efsp/airspace-draft.js';

const def = (extra = {}) => ({
  airspaceId: 'R-TOROS', name: 'TOROS RANGE', kind: 'AREA', type: 'RESTRICTED', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP',
  usingPositionId: 'RNG1', usingFacilityId: null, workingFrequencyMhz: 138.0, controlFrequencyMhz: 251.5, altLowerFt: null, altUpperFt: 18000,
  geometry: null, source: 'PANEL', ...extra,
});
const rec = (state = 'RETURNED', extra = {}) => ({ airspaceId: 'R-TOROS', definition: def(), defRev: 7, rev: 2, state, pendingRequest: null, ...extra });
const ALL = { positionId: 'AP', scope: 'ALL' };

test('a RETURNED airspace with no request: every field but ID is editable for the controlling Position', () => {
  const { editable, reasons } = editableFields({ record: rec(), creating: false, authority: ALL });
  for (const f of ['name', 'type', 'controllingFacilityId', 'controllingPositionId', 'usingPositionId', 'usingFacilityId', 'workingFrequencyMhz', 'controlFrequencyMhz', 'altLowerFt', 'altUpperFt', 'geometry']) {
    assert.ok(editable.has(f), f);
  }
  assert.equal(editable.has('airspaceId'), false);
  assert.equal(reasons.airspaceId, 'fixed after create');
});

test('R3-23: while ACTIVE only name and the two frequencies are editable, with the reason', () => {
  const { editable, reasons } = editableFields({ record: rec('ACTIVE'), creating: false, authority: ALL });
  assert.deepEqual([...editable].sort(), ['controlFrequencyMhz', 'name', 'workingFrequencyMhz']);
  assert.equal(reasons.altUpperFt, 'airspace is ACTIVE: only name and frequencies can change');
  assert.equal(reasons.usingPositionId, reasons.altUpperFt);
});

test('R3-23: SCHEDULED and RELEASED lock too, and so does a pending request on a RETURNED record', () => {
  for (const s of ['SCHEDULED', 'RELEASED']) assert.equal(lockReason(rec(s)), `airspace is ${s}: only name and frequencies can change`);
  assert.match(lockReason(rec('RETURNED', { pendingRequest: { requestedPositionId: 'RNG1' } })), /activation request outstanding/);
  assert.equal(lockReason(rec()), null);
  const { editable } = editableFields({ record: rec('RETURNED', { pendingRequest: {} }), creating: false, authority: ALL });
  assert.equal(editable.has('type'), false);
});

test('a range may change only its control frequency, and a Position with no authority nothing', () => {
  const r = editableFields({ record: rec(), creating: false, authority: { positionId: 'RNG1', scope: 'FREQUENCY' } });
  assert.deepEqual([...r.editable], ['controlFrequencyMhz']);
  assert.match(r.reasons.name, /range may change only/);
  assert.equal(editableFields({ record: rec(), creating: false, authority: null }).editable.size, 0);
});

test('a ROUTE derives its altitudes (read-only) and has no outline; an AREA has no leg table', () => {
  const route = rec('RETURNED', { definition: def({ kind: 'ROUTE', type: 'IR', segments: [], defaultWidthNm: 4 }) });
  const r = editableFields({ record: route, creating: false, authority: ALL });
  assert.equal(r.editable.has('altLowerFt'), false);
  assert.equal(r.reasons.altLowerFt, 'derived from the route legs');
  assert.ok(r.editable.has('segments') && !r.editable.has('geometry'));
  assert.ok(!editableFields({ record: rec(), creating: false, authority: ALL }).editable.has('segments'));
});

test('on create everything but nothing is locked, and the ID is editable', () => {
  const { editable } = editableFields({ record: null, creating: true, authority: null });
  assert.ok(editable.has('name') && editable.has('altUpperFt'));
});

test('altitude and frequency text: FL above the transition altitude, feet below; "none" is null', () => {
  assert.equal(altitudeText(18000, 18000), 'FL180');
  assert.equal(altitudeText(5000, 18000), '5000');
  assert.equal(altitudeText(null), '');
  assert.equal(parseAltitudeText('FL230'), 23000);
  assert.equal(parseAltitudeText('fl 90'), 9000);
  assert.equal(parseAltitudeText('5000'), 5000);
  assert.equal(parseAltitudeText(''), null);
  assert.ok(Number.isNaN(parseAltitudeText('high')));
  assert.equal(parseFrequencyText('139.250'), 139.25);
  assert.equal(parseFrequencyText(' '), null);
  assert.ok(Number.isNaN(parseFrequencyText('139,25')));
});

test('dirty tracking: only what changed is dirty, 139.25 for 139.250 is no change, and the patch carries just those', () => {
  const base = def();
  const draft = draftFromDefinition(base);
  assert.deepEqual(dirtyFields(base, draft), []);
  draft.workingFrequencyMhz = '138.0';
  assert.deepEqual(dirtyFields(base, draft), []);
  draft.workingFrequencyMhz = '139.100';
  draft.altUpperFt = 'FL200';
  assert.deepEqual(dirtyFields(base, draft), ['workingFrequencyMhz', 'altUpperFt']);
  const { editable } = editableFields({ record: rec(), creating: false, authority: ALL });
  assert.deepEqual(buildPatch(base, draft, editable), { workingFrequencyMhz: 139.1, altUpperFt: 20000 });
  assert.equal(wasText('workingFrequencyMhz', base), '138.000');
  assert.equal(wasText('altUpperFt', base), '18000 · FL180');
});

test('clearing an optional field patches null; the patch never carries a field the session may not change', () => {
  const base = def();
  const draft = draftFromDefinition(base);
  draft.controlFrequencyMhz = '';
  draft.name = 'TOROS 2';
  const ro = editableFields({ record: rec('ACTIVE'), creating: false, authority: ALL }).editable;
  assert.deepEqual(buildPatch(base, draft, ro), { name: 'TOROS 2', controlFrequencyMhz: null });
  draft.type = 'MOA';
  assert.equal('type' in buildPatch(base, draft, ro), false, 'type is locked while ACTIVE');
});

const others = [{ airspaceId: 'MOA-KYE', name: 'MOA KONYA EAST', workingFrequencyMhz: 134.6, controlFrequencyMhz: null }];
const check = (draftChanges, o = {}) => {
  const base = o.base || def();
  const draft = { ...draftFromDefinition(base), ...draftChanges };
  return validateDraft(base, draft, { creating: !!o.creating, editable: o.editable || editableFields({ record: rec(), creating: false, authority: ALL }).editable, others });
};

test('mockup scene 3: the four problems, on their fields, summarised', () => {
  const v = check({ name: '', controllingPositionId: 'CTR', workingFrequencyMhz: '12', altLowerFt: '23000', altUpperFt: '5000' }, { base: def({ usingPositionId: null }) });
  assert.equal(v.fieldErrors.name, 'A name is required.');
  assert.equal(v.fieldErrors.controllingPositionId, 'CTR is not a Position at INCIRLIK.');
  assert.equal(v.fieldErrors.workingFrequencyMhz, '30 to 400 MHz.');
  assert.equal(v.fieldErrors.altUpperFt, 'Must be above the lower limit (23000).');
  assert.equal(v.valid, false);
  assert.match(v.summary, /^4 problems to fix before Save: NAME, CTRL POSITION, WORK FREQ, ALT UPPER\.$/);
});

test('a shared frequency is a grey note, never an error', () => {
  const v = check({ workingFrequencyMhz: '134.600' });
  assert.equal(v.valid, true);
  assert.deepEqual(v.notes, ['134.600 is also the working frequency of MOA KONYA EAST. Saving is still allowed.']);
});

test('name uniqueness is case-insensitive among the others; ID is checked on create only', () => {
  assert.equal(check({ name: 'moa konya east' }).fieldErrors.name, 'Another airspace here already has this name.');
  const base = { kind: 'AREA' };
  const creating = (changes) => validateDraft(base, { ...draftFromDefinition(null), controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', type: 'MOA', name: 'New', ...changes },
    { creating: true, editable: new Set(['airspaceId', 'name', 'type']), others });
  assert.match(creating({ airspaceId: 'x' }).fieldErrors.airspaceId, /2-24 characters/);
  assert.match(creating({ airspaceId: 'MOA-KYE' }).fieldErrors.airspaceId, /already used/);
  assert.equal(creating({ airspaceId: 'MOA-NEW' }).valid, true);
});

test('one using agency at most, never the controlling Facility, and a using Position needs an id of its own', () => {
  assert.equal(check({ usingFacilityId: 'TACTICAL', usingPositionId: 'RNG1' }).fieldErrors.usingFacilityId, 'Name at most one using agency.');
  assert.match(check({ usingFacilityId: 'INCIRLIK', usingPositionId: '' }).fieldErrors.usingFacilityId, /controlling Facility/);
  assert.match(check({ usingPositionId: 'CTR' }).fieldErrors.usingPositionId, /already a Position of CENTER/);
  assert.equal(check({ usingFacilityId: 'TACTICAL', usingPositionId: '' }).valid, true);
});

test('a locked field that is unchanged is never reported, and unparsable text is', () => {
  const ro = editableFields({ record: rec('ACTIVE'), creating: false, authority: ALL }).editable;
  assert.equal(check({}, { editable: ro }).valid, true);
  assert.equal(check({ workingFrequencyMhz: 'abc' }).fieldErrors.workingFrequencyMhz, 'Enter MHz, for example 139.250.');
  assert.equal(check({ altUpperFt: 'high' }).fieldErrors.altUpperFt, 'Whole feet, or FL and three digits.');
});

test('the impact note names the flights and the frequency they must be re-approved on (mockup scene 2)', () => {
  const flights = [{ callsign: 'VIPER11', frequencyMhz: 138 }, { callsign: 'VIPER12', frequencyMhz: 138 }];
  const lines = impactNote({ flights, patch: { workingFrequencyMhz: 139.1 }, definition: def() });
  assert.match(lines[0], /2 flights approved into it/);
  assert.match(lines[1], /VIPER11 and VIPER12 are on 138\.000\. Re-approve them on 139\.100 \(or 251\.500\)?|VIPER11 and VIPER12 are on 138\.000\. Re-approve them on 139\.100 or 251\.500/);
  assert.deepEqual(impactNote({ flights: [], patch: { workingFrequencyMhz: 139.1 }, definition: def() }), []);
  assert.match(RESTART_NOTE, /next crc-sync restart/);
});

const ackWith = (conflicts, current) => ({ ok: false, reason: 'STALE_REV', conflicts, airspace: { definition: current, defRev: 8, updatedBy: 'c-0377', updatedAt: 1000 } });

test('mockup scene 4: only the clashing field needs a choice; the rest applies cleanly', () => {
  const original = def();
  const patch = { controlFrequencyMhz: 252.0, workingFrequencyMhz: 139.1, altUpperFt: 20000 };
  const model = conflictModel({ ack: ackWith([{ field: 'controlFrequencyMhz', base: 251.5, theirs: 251.8 }], def({ controlFrequencyMhz: 251.8 })), original, patch });
  assert.deepEqual(model.rows.map(r => [r.field, r.status]), [['controlFrequencyMhz', 'conflict'], ['workingFrequencyMhz', 'clean'], ['altUpperFt', 'clean']]);
  assert.equal(model.rows[0].base, 251.5);
  assert.equal(model.rows[0].theirs, 251.8);
  assert.equal(model.currentDefRev, 8);
  assert.deepEqual(resolveConflicts(model, {}), { ok: false, unresolved: ['controlFrequencyMhz'] });
  const mine = resolveConflicts(model, { controlFrequencyMhz: 'mine' });
  assert.deepEqual(mine, { ok: true, patch, baseDefRev: 8, empty: false });
  const theirs = resolveConflicts(model, { controlFrequencyMhz: 'theirs' });
  assert.deepEqual(theirs.patch, { workingFrequencyMhz: 139.1, altUpperFt: 20000 });
  assert.equal(theirs.baseDefRev, 8, 're-sent against the current revision');
});

test('taking theirs for the only changed field leaves nothing to send; a field they already set the same is dropped', () => {
  const original = def();
  const model = conflictModel({ ack: ackWith([{ field: 'name', base: 'TOROS RANGE', theirs: 'TOROS 2' }], def({ name: 'TOROS 2' })), original, patch: { name: 'TOROS 3' } });
  assert.equal(resolveConflicts(model, { name: 'theirs' }).empty, true);
  const agree = conflictModel({ ack: ackWith([{ field: 'name', base: 'TOROS RANGE', theirs: 'TOROS 3' }], def({ name: 'TOROS 3' })), original, patch: { name: 'TOROS 3' } });
  assert.equal(agree.rows[0].status, 'already', 'both want the same value: no choice needed');
  assert.deepEqual(resolveConflicts(agree, {}).patch, {});
});

test('a base older than the bounded history lists every patched field as a conflict, each needing a choice', () => {
  const patch = { name: 'A', workingFrequencyMhz: 140 };
  const conflicts = [{ field: 'name', base: 'TOROS RANGE', theirs: 'X' }, { field: 'workingFrequencyMhz', base: 138, theirs: 141 }];
  const model = conflictModel({ ack: ackWith(conflicts, def({ name: 'X', workingFrequencyMhz: 141 })), original: def(), patch });
  assert.equal(resolveConflicts(model, { name: 'mine' }).ok, false);
  assert.equal(resolveConflicts(model, { name: 'mine', workingFrequencyMhz: 'mine' }).ok, true);
});

test('definitionFromDraft keeps what the form cannot touch', () => {
  const base = def();
  const { definition } = definitionFromDraft(base, draftFromDefinition(base));
  assert.deepEqual(definition, { ...base, usingFacilityId: null });
});
