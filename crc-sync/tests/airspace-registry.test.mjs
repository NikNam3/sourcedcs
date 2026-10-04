import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRegistry, panel, admin, stateOp, MOA, RANGE, SQUARE, THEATER } from './helpers/airspace-registry.mjs';

const edit = (store, id, patch, who = panel('CTR'), baseDefRev) => store.apply({
  airspaceId: id, baseDefRev: baseDefRev ?? store.getAirspace(id).defRev, op: { kind: 'EditAirspace', patch },
}, who);
const create = (store, def, who = panel('CTR')) => store.apply({ ...(who.service ? { theater: THEATER } : {}), op: { kind: 'CreateAirspace', definition: def } }, who);
const del = (store, id, who = panel('CTR'), baseDefRev) => store.apply({ airspaceId: id, baseDefRev: baseDefRev ?? store.getAirspace(id)?.defRev, op: { kind: 'DeleteAirspace' } }, who);
const WINDOW = { fromUtc: 1, toUtc: 2 };
const LOG = () => { const lines = []; return { lines, record: (e) => lines.push(e) }; };
const NEW = { airspaceId: 'MOA-NEW', name: 'New MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR' };

// ── create ───────────────────────────────────────────────────────────────

test('Create: the controlling Position creates; the record starts RETURNED at defRev 1, source PANEL', () => {
  const { store } = makeRegistry({ defs: [] });
  const r = create(store, NEW);
  assert.equal(r.ok, true, JSON.stringify(r));
  const a = store.getAirspace('MOA-NEW');
  assert.equal(a.state, 'RETURNED');
  assert.equal(a.defRev, 1);
  assert.equal(a.rev, 0);
  assert.equal(a.definition.source, 'PANEL');
  assert.equal(a.theater, THEATER);
  assert.equal('definitionHistory' in a, false, 'the bounded history is not part of a view');
});

test('Create: the registry stamps the source; a client cannot claim one', () => {
  const { store } = makeRegistry({ defs: [] });
  create(store, { ...NEW, source: 'ACO' });
  assert.equal(store.getAirspace('MOA-NEW').definition.source, 'PANEL');
  store.apply({ theater: THEATER, op: { kind: 'CreateAirspace', definition: { ...NEW, airspaceId: 'MOA-WEB', name: 'Web MOA' } } }, admin());
  assert.equal(store.getAirspace('MOA-WEB').definition.source, 'WEB');
});

test('Create refusals: duplicate id, duplicate name (case-insensitive), unknown Facility, Position not of the Facility, bad using Facility', () => {
  const { store } = makeRegistry({ defs: [MOA] });
  assert.match(create(store, { ...NEW, airspaceId: 'MOA-1' }).detail, /already exists/);
  assert.match(create(store, { ...NEW, name: 'test moa' }).detail, /name "test moa" is already used/);
  assert.match(create(store, { ...NEW, controllingFacilityId: 'NOWHERE' }, admin()).detail, /not a configured Facility/);
  assert.match(create(store, { ...NEW, controllingPositionId: 'AP' }, admin()).detail, /AP is not a Position of CENTER/);
  assert.match(create(store, { ...NEW, usingFacilityId: 'CENTER' }, admin()).detail, /cannot be the controlling Facility/);
  assert.match(create(store, { ...NEW, usingFacilityId: 'RANGES' }, admin()).detail, /cannot be RANGES/);
  assert.match(create(store, { ...NEW, usingFacilityId: 'GHOST' }, admin()).detail, /not a configured Facility/);
  assert.match(create(store, { ...NEW, usingPositionId: 'AP' }, admin()).detail, /already a Position of INCIRLIK/);
  assert.equal(store.getAll().length, 1);
});

test('the same id may exist in two theaters (R3-22), and the id is reusable after a delete', () => {
  const { store, state } = makeRegistry({ defs: [MOA] });
  const r = store.apply({ theater: 'Other', op: { kind: 'CreateAirspace', definition: MOA } }, admin());
  assert.equal(r.ok, true);
  assert.equal(store.getAirspace('MOA-1', 'Other').theater, 'Other');
  assert.equal(del(store, 'MOA-1').ok, true);
  assert.equal(create(store, MOA).ok, true, 'reusable after delete');
  assert.deepEqual(store.listTheaters().map(t => t.theater).sort(), ['Other', 'Test']);
  state.theater = 'Other';
  assert.equal(store.getAll().length, 1);
});

// ── edit: defRev, history, per-field conflicts ───────────────────────────

test('Edit: patch applies, defRev and history advance, null clears an optional field, state rev is untouched', () => {
  const { store } = makeRegistry({ defs: [MOA] });
  const rev0 = store.getAirspace('MOA-1').rev;
  const r = edit(store, 'MOA-1', { workingFrequencyMhz: 135.0, altLowerFt: 5000 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.changes.map(c => c.field).sort(), ['altLowerFt', 'workingFrequencyMhz']);
  const a = store.getAirspace('MOA-1');
  assert.equal(a.defRev, 2);
  assert.equal(a.rev, rev0, 'a definition edit never moves the state revision');
  assert.equal(a.definition.workingFrequencyMhz, 135);
  const h = store.getHistory('MOA-1');
  assert.equal(h.length, 1);
  assert.deepEqual(h[0].changes.find(c => c.field === 'workingFrequencyMhz'), { field: 'workingFrequencyMhz', from: 134.25, to: 135 });
  assert.equal(edit(store, 'MOA-1', { altLowerFt: null }).ok, true);
  assert.equal(store.getAirspace('MOA-1').definition.altLowerFt, null);
  assert.match(edit(store, 'MOA-1', { name: null }).detail, /cannot be cleared/);
});

test('Edit: airspaceId, kind and source are not patchable; unknown fields, ROUTE-derived altitudes are refused', () => {
  const { store } = makeRegistry({ defs: [MOA] });
  assert.match(edit(store, 'MOA-1', { airspaceId: 'X-2' }).detail, /cannot be changed/);
  assert.match(edit(store, 'MOA-1', { kind: 'ROUTE' }).detail, /cannot be changed/);
  assert.match(edit(store, 'MOA-1', { source: 'ACO' }).detail, /stamped/);
  assert.match(edit(store, 'MOA-1', { colour: 'red' }).detail, /no field colour/);
  assert.match(edit(store, 'MOA-1', { segments: [] }).detail, /an AREA has a geometry/);
  assert.match(edit(store, 'MOA-1', {}).detail, /non-empty patch/);
  assert.equal(store.getAirspace('MOA-1').defRev, 1);
});

test('conflicts: disjoint fields merge, overlapping fields are refused with {field, base, theirs}, nothing is written', () => {
  const { store } = makeRegistry({ defs: [MOA] });
  assert.equal(edit(store, 'MOA-1', { workingFrequencyMhz: 135.0 }, panel('CTR', 'alice'), 1).ok, true); // alice: rev 1 -> 2
  // bob read rev 1 as well and changes a DIFFERENT field: merges
  assert.equal(edit(store, 'MOA-1', { name: 'Bob MOA' }, panel('CTR', 'bob'), 1).ok, true);
  assert.equal(store.getAirspace('MOA-1').defRev, 3);
  assert.equal(store.getAirspace('MOA-1').definition.workingFrequencyMhz, 135);
  // carol read rev 1 and changes the SAME field alice changed: refused
  const r = edit(store, 'MOA-1', { workingFrequencyMhz: 136.0 }, panel('CTR', 'carol'), 1);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'STALE_REV');
  assert.deepEqual(r.conflicts, [{ field: 'workingFrequencyMhz', base: 134.25, theirs: 135 }]);
  assert.equal(store.getAirspace('MOA-1').definition.workingFrequencyMhz, 135, 'nothing written');
  assert.equal(store.getAirspace('MOA-1').defRev, 3);
});

test('conflicts: a base older than the bounded history (50) is refused with every patched field a conflict', () => {
  const { store } = makeRegistry({ defs: [MOA] });
  for (let i = 0; i < 52; i++) assert.equal(edit(store, 'MOA-1', { workingFrequencyMhz: 130 + (i % 2) }).ok, true);
  assert.equal(store.getHistory('MOA-1').length, 50);
  const r = edit(store, 'MOA-1', { name: 'Late' }, panel('CTR'), 1);
  assert.equal(r.reason, 'STALE_REV');
  assert.deepEqual(r.conflicts.map(c => c.field), ['name']);
  // a base inside the window still merges
  assert.equal(edit(store, 'MOA-1', { name: 'Fine' }, panel('CTR'), store.getAirspace('MOA-1').defRev - 3).ok, true);
});

test('Edit needs a baseDefRev that exists', () => {
  const { store } = makeRegistry({ defs: [MOA] });
  assert.match(store.apply({ airspaceId: 'MOA-1', op: { kind: 'EditAirspace', patch: { name: 'X' } } }, panel('CTR')).detail, /needs baseDefRev/);
  assert.match(edit(store, 'MOA-1', { name: 'X' }, panel('CTR'), 9).detail, /not a revision/);
});

test('a state op and a definition edit never make each other STALE_REV', () => {
  const { store } = makeRegistry({ defs: [MOA] });
  const rev = store.getAirspace('MOA-1').rev; const defRev = store.getAirspace('MOA-1').defRev;
  assert.equal(edit(store, 'MOA-1', { name: 'Renamed' }).ok, true);
  // a schedule sent with the state rev the client had before the edit still lands
  const s = store.apply({ airspaceId: 'MOA-1', baseRev: rev, op: { kind: 'ScheduleAirspace', ...WINDOW } }, panel('CTR'));
  assert.equal(s.ok, true, JSON.stringify(s));
  // and an edit with the defRev from before the schedule still lands (the schedule did not move defRev)
  assert.equal(edit(store, 'MOA-1', { workingFrequencyMhz: 140 }, panel('CTR'), defRev + 1).ok, true);
});

// ── R3-23, occupied warning, delete guard ────────────────────────────────

test('R3-23: while not RETURNED only name and frequencies may change, and the detail names the state and the flights', () => {
  const occupants = { 'MOA-1': [{ stripId: 's1', callsign: 'VIPER 1', frequencyMhz: 134.25 }, { stripId: 's2', callsign: 'VIPER 2', frequencyMhz: 134.25 }] };
  const { store } = makeRegistry({ defs: [MOA], occupants });
  assert.equal(stateOp(store, 'MOA-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'CTR').ok, true);
  assert.equal(stateOp(store, 'MOA-1', { kind: 'ApproveActivation' }, 'CTR').ok, true);
  const r = edit(store, 'MOA-1', { altUpperFt: 20000 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'VALIDATION_ERROR');
  assert.match(r.detail, /ACTIVE: only name, workingFrequencyMhz, controlFrequencyMhz can change, not altUpperFt/);
  assert.match(r.detail, /VIPER 1, VIPER 2/);
  assert.equal(edit(store, 'MOA-1', { name: 'Hot MOA', altUpperFt: 20000 }).ok, false, 'one locked field refuses the whole patch');
  assert.equal(store.getAirspace('MOA-1').definition.name, 'Test MOA');
});

test('R3-23 also holds with a pending request (SCHEDULED) and RELEASED', () => {
  const { store } = makeRegistry({ defs: [RANGE] });
  stateOp(store, 'RANGE-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'RANGE_1_CONTROL');
  assert.match(edit(store, 'RANGE-1', { type: 'DANGER' }, panel('AP')).detail, /SCHEDULED/);
  stateOp(store, 'RANGE-1', { kind: 'RequestActivation' }, 'RANGE_1_CONTROL');
  stateOp(store, 'RANGE-1', { kind: 'ApproveActivation' }, 'AP');
  stateOp(store, 'RANGE-1', { kind: 'ReleaseAirspace' }, 'RANGE_1_CONTROL');
  assert.match(edit(store, 'RANGE-1', { type: 'DANGER' }, panel('AP')).detail, /RELEASED/);
});

test('AIRSP-4: editing an occupied AREA warns, lists the flights and names the stale entries', () => {
  const occupants = { 'MOA-1': [{ stripId: 's1', callsign: 'VIPER 1', frequencyMhz: 134.25 }, { stripId: 's2', callsign: 'VIPER 2', frequencyMhz: 135.0 }] };
  const { store } = makeRegistry({ defs: [MOA], occupants });
  const r = edit(store, 'MOA-1', { workingFrequencyMhz: 135.0 });
  assert.equal(r.ok, true);
  assert.equal(r.warning, 'AIRSPACE_EDITED_OCCUPIED');
  assert.deepEqual(r.occupied.map(o => o.callsign), ['VIPER 1', 'VIPER 2']);
  assert.deepEqual(r.staleEntries, [{ stripId: 's1', callsign: 'VIPER 1', frequencyMhz: 134.25 }], 'only the Strip still on the old frequency is stale');
  // a rename warns too, but nothing is stale
  const r2 = edit(store, 'MOA-1', { name: 'Renamed' });
  assert.equal(r2.warning, 'AIRSPACE_EDITED_OCCUPIED');
  assert.deepEqual(r2.staleEntries, []);
});

test('re-approving one flight afterwards puts the new frequency on that Strip: only the other one stays stale', () => {
  const occupants = { 'MOA-1': [{ stripId: 's1', callsign: 'VIPER 1', frequencyMhz: 134.25 }, { stripId: 's2', callsign: 'VIPER 2', frequencyMhz: 134.25 }] };
  const { store } = makeRegistry({ defs: [MOA], occupants });
  assert.equal(edit(store, 'MOA-1', { workingFrequencyMhz: 135.0 }).staleEntries.length, 2);
  occupants['MOA-1'][0].frequencyMhz = 135.0; // the controller re-approves VIPER 1 onto the new frequency
  assert.deepEqual(edit(store, 'MOA-1', { workingFrequencyMhz: 135.0, controlFrequencyMhz: 250.0 }).staleEntries.map(s => s.callsign), ['VIPER 2']);
});

test('a ROUTE never warns about occupancy (a count only)', () => {
  const route = { airspaceId: 'IR-100', name: 'IR 100', kind: 'ROUTE', type: 'IR', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', defaultWidthNm: 8,
    segments: [{ fix: { name: 'A', lat: 36, lon: 35 }, altLowerFt: 500, altUpperFt: 1500 }, { fix: { name: 'B', lat: 36, lon: 36 } }] };
  const { store, state } = makeRegistry({ defs: [route], occupants: { 'IR-100': [{ stripId: 's1', callsign: 'X', frequencyMhz: null }] }, routeCount: 3 });
  const r = edit(store, 'IR-100', { name: 'IR 100 renamed' });
  assert.equal(r.ok, true);
  assert.equal(r.warning, undefined);
  assert.equal(store.routeOccupancy('IR-100'), 3);
  stateOp(store, 'IR-100', { kind: 'ScheduleAirspace', ...WINDOW }, 'CTR');
  stateOp(store, 'IR-100', { kind: 'ApproveActivation' }, 'CTR');
  const rel = stateOp(store, 'IR-100', { kind: 'ReleaseAirspace' }, 'CTR');
  assert.equal(rel.ok, true);
  assert.equal(rel.warning, undefined, 'releasing a route with flights on it does not warn');
  assert.ok(state);
});

test('Delete: guarded (RETURNED, no pending request, no flights), with the blockers listed; the audit keeps the full definition', () => {
  const occupants = { 'MOA-1': [{ stripId: 's1', callsign: 'VIPER 1', frequencyMhz: null }] };
  const log = LOG();
  const { store } = makeRegistry({ defs: [MOA, RANGE], occupants, mutationLog: log });
  log.lines.length = 0; // the seeding import is not what these tests look at
  const r = del(store, 'MOA-1');
  assert.equal(r.ok, false);
  assert.match(r.detail, /1 flight is working it \(VIPER 1\)/);
  assert.deepEqual(r.blockers, ['1 flight is working it (VIPER 1)']);
  stateOp(store, 'RANGE-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'RANGE_1_CONTROL');
  stateOp(store, 'RANGE-1', { kind: 'RequestActivation' }, 'RANGE_1_CONTROL');
  const pending = del(store, 'RANGE-1', panel('AP'));
  assert.deepEqual(pending.blockers, ['it is SCHEDULED', 'an activation request is outstanding']);
  occupants['MOA-1'] = [];
  const ok = del(store, 'MOA-1');
  assert.equal(ok.ok, true);
  assert.equal(ok.removed, 'MOA-1');
  assert.equal(store.getAirspace('MOA-1'), null);
  const entry = log.lines.findLast(e => e.op === 'DeleteAirspace' && e.ok);
  assert.equal(entry.before.definition.name, 'Test MOA', 'before keeps the full definition');
  assert.equal(entry.facilityId, 'CENTER', 'from before, never null');
});

test('Delete with a pending activation request is refused, and the request is still there', () => {
  const { store } = makeRegistry({ defs: [RANGE] });
  stateOp(store, 'RANGE-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'RANGE_1_CONTROL');
  stateOp(store, 'RANGE-1', { kind: 'RequestActivation' }, 'RANGE_1_CONTROL');
  assert.equal(del(store, 'RANGE-1', panel('AP')).ok, false);
  assert.ok(store.getAirspace('RANGE-1').pendingRequest);
});

test('Delete conflicts with an edit made since the editor last looked', () => {
  const { store } = makeRegistry({ defs: [MOA] });
  edit(store, 'MOA-1', { name: 'Edited' });
  const r = del(store, 'MOA-1', panel('CTR'), 1);
  assert.equal(r.reason, 'STALE_REV');
  assert.deepEqual(r.conflicts.map(c => c.field), ['name']);
  assert.ok(store.getAirspace('MOA-1'));
});

// ── authority rows (ADR 0098 §11) ────────────────────────────────────────

test('authority: who may create, edit and delete', () => {
  const { store } = makeRegistry({ defs: [MOA, RANGE] });
  // the controlling Position: yes, as itself
  assert.equal(edit(store, 'MOA-1', { name: 'A' }, panel('CTR')).ok, true);
  // another ATC Position that is not the controlling one: no
  assert.equal(edit(store, 'MOA-1', { name: 'B' }, panel('AP')).reason, 'PERMISSION_DENIED');
  assert.equal(del(store, 'MOA-1', panel('AP')).reason, 'PERMISSION_DENIED');
  assert.equal(create(store, NEW, panel('AP')).reason, 'PERMISSION_DENIED', 'AP is not the controlling Position of what it creates');
  // OPS of the controlling Facility: yes, for its Facility's airspaces, any field
  assert.equal(edit(store, 'RANGE-1', { type: 'DANGER' }, panel('OPS')).ok, true);
  assert.equal(edit(store, 'MOA-1', { name: 'C' }, panel('OPS')).reason, 'PERMISSION_DENIED', 'MOA-1 belongs to CENTER, not OPS\'s Facility');
  assert.equal(create(store, { ...NEW, controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP' }, panel('OPS')).ok, true, 'OPS creates for a Position of its Facility');
  assert.equal(create(store, { ...NEW, airspaceId: 'MOA-N2', name: 'N2' }, panel('OPS')).reason, 'PERMISSION_DENIED', 'not for another Facility');
  // a session signed on to nothing (no Position) may do none of it
  assert.equal(edit(store, 'MOA-1', { name: 'D' }, panel(null)).reason, 'PERMISSION_DENIED');
  assert.equal(create(store, { ...NEW, airspaceId: 'MOA-N3', name: 'N3' }, panel(null)).reason, 'PERMISSION_DENIED');
});

test('authority: a RANGES Position edits only the control frequency of its own airspaces', () => {
  const { store } = makeRegistry({ defs: [RANGE] });
  assert.equal(edit(store, 'RANGE-1', { controlFrequencyMhz: 284.0 }, panel('RANGE_1_CONTROL')).ok, true);
  const r = edit(store, 'RANGE-1', { name: 'Mine now', controlFrequencyMhz: 285.0 }, panel('RANGE_1_CONTROL'));
  assert.equal(r.reason, 'PERMISSION_DENIED', 'a patch with one denied field is refused whole');
  assert.equal(store.getAirspace('RANGE-1').definition.controlFrequencyMhz, 284.0);
  assert.equal(del(store, 'RANGE-1', panel('RANGE_1_CONTROL')).reason, 'PERMISSION_DENIED');
  assert.equal(create(store, { ...NEW, usingPositionId: 'RANGE_1_CONTROL' }, panel('RANGE_1_CONTROL')).reason, 'PERMISSION_DENIED');
});

test('authority: TAC_C2 (airspaceUse at its Facility) schedules, requests and releases, but never edits (AIRSP-6)', () => {
  const mru = { ...MOA, airspaceId: 'MRU-1', name: 'MRU area', usingFacilityId: 'TACTICAL' };
  const { store } = makeRegistry({ defs: [mru] });
  assert.equal(edit(store, 'MRU-1', { name: 'T' }, panel('TAC_C2')).reason, 'PERMISSION_DENIED');
  assert.equal(del(store, 'MRU-1', panel('TAC_C2')).reason, 'PERMISSION_DENIED');
  assert.equal(stateOp(store, 'MRU-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'TAC_C2').ok, true);
  assert.equal(stateOp(store, 'MRU-1', { kind: 'RequestActivation' }, 'TAC_C2').ok, true);
  // GCI is in TACTICAL too, but has no airspaceUse capability (DA-7: TAC_C2 only)
  assert.equal(stateOp(store, 'MRU-1', { kind: 'ApproveActivation' }, 'TAC_C2').reason, 'PERMISSION_DENIED', 'the using side never approves');
  assert.equal(stateOp(store, 'MRU-1', { kind: 'ApproveActivation' }, 'CTR').ok, true);
  assert.equal(stateOp(store, 'MRU-1', { kind: 'ReleaseAirspace' }, 'GCI').reason, 'PERMISSION_DENIED');
  assert.equal(stateOp(store, 'MRU-1', { kind: 'ReleaseAirspace' }, 'TAC_C2').ok, true);
  assert.equal(stateOp(store, 'MRU-1', { kind: 'ReturnAirspace' }, 'TAC_C2').reason, 'PERMISSION_DENIED');
  assert.equal(stateOp(store, 'MRU-1', { kind: 'ReturnAirspace' }, 'CTR').ok, true);
});

test('authority: an airspace with a using Facility needs a request, like one with a using Position', () => {
  const mru = { ...MOA, airspaceId: 'MRU-1', name: 'MRU area', usingFacilityId: 'TACTICAL' };
  const { store } = makeRegistry({ defs: [mru] });
  stateOp(store, 'MRU-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'CTR');
  assert.match(stateOp(store, 'MRU-1', { kind: 'ApproveActivation' }, 'CTR').detail, /no activation request/);
});

test('authority: SQUADRON_ADMIN creates, edits and deletes in any theater, audited as WEB with actorId=sub and no Position; it never acts on state', () => {
  const log = LOG();
  const { store } = makeRegistry({ defs: [MOA], mutationLog: log });
  log.lines.length = 0; // the seeding import is not what these tests look at
  const r = store.apply({ clientMutationId: 'w1', theater: 'Other', op: { kind: 'CreateAirspace', definition: { ...NEW, controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP' } } }, admin('sub-123'));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(store.apply({ theater: 'Other', airspaceId: 'MOA-NEW', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { name: 'Web edited' } } }, admin('sub-123')).ok, true);
  assert.equal(store.apply({ theater: 'Other', airspaceId: 'MOA-NEW', op: { kind: 'ScheduleAirspace', ...WINDOW } }, admin()).reason, 'PERMISSION_DENIED');
  const entry = log.lines.find(e => e.op === 'EditAirspace');
  assert.equal(entry.via, 'WEB');
  assert.equal(entry.actorId, 'sub-123');
  assert.equal(entry.actorName, 'Web User');
  assert.equal(entry.actingPositionId, null);
  assert.equal(entry.theater, 'Other');
  assert.equal(store.apply({ airspaceId: 'MOA-1', op: { kind: 'CreateAirspace', definition: NEW } }, admin()).detail, 'a service op names its theater');
  // still subject to R3-23 and the delete guard
  store.apply({ airspaceId: 'MOA-1', op: { kind: 'ScheduleAirspace', ...WINDOW } }, panel('CTR'));
  assert.equal(store.apply({ theater: THEATER, airspaceId: 'MOA-1', baseDefRev: 1, op: { kind: 'EditAirspace', patch: { altUpperFt: 9000 } } }, admin()).reason, 'VALIDATION_ERROR');
  assert.equal(store.apply({ theater: THEATER, airspaceId: 'MOA-1', baseDefRev: 1, op: { kind: 'DeleteAirspace' } }, admin()).reason, 'VALIDATION_ERROR');
});

test('reassigning the controlling Position on a RETURNED airspace: the old owner, with the form still open, is refused', () => {
  const { store } = makeRegistry({ defs: [{ ...MOA, controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP' }] });
  assert.equal(edit(store, 'MOA-1', { controllingPositionId: 'LC' }, panel('AP')).ok, true);
  assert.equal(edit(store, 'MOA-1', { name: 'Late edit' }, panel('AP'), 1).reason, 'PERMISSION_DENIED');
  assert.equal(stateOp(store, 'MOA-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'AP').reason, 'PERMISSION_DENIED', 'nor does it schedule any more');
  assert.equal(stateOp(store, 'MOA-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'LC').ok, true);
});

test('a RANGES using Position edit takes effect at restart: the ack says so', () => {
  const { store } = makeRegistry({ defs: [MOA] });
  const r = edit(store, 'MOA-1', { usingPositionId: 'RANGE_9_CONTROL' });
  assert.equal(r.ok, true);
  assert.equal(r.effectiveAtRestart, true);
  assert.deepEqual(store.rangePositionIds(), ['RANGE_9_CONTROL']);
});

test('`type` changed to RESTRICTED on a RETURNED airspace changes nothing in the behaviour (D14)', () => {
  const { store } = makeRegistry({ defs: [MOA] });
  assert.equal(edit(store, 'MOA-1', { type: 'RESTRICTED' }).ok, true);
  assert.equal(stateOp(store, 'MOA-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'CTR').ok, true);
  assert.equal(stateOp(store, 'MOA-1', { kind: 'ApproveActivation' }, 'CTR').ok, true);
  assert.equal(store.isActive('MOA-1'), true);
});

// ── ROUTE ────────────────────────────────────────────────────────────────

const ROUTE = { airspaceId: 'IR-100', name: 'IR 100', kind: 'ROUTE', type: 'IR', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'TACTICAL', defaultWidthNm: 8,
  segments: [{ fix: { name: 'A', lat: 36, lon: 35 }, altLowerFt: 500, altUpperFt: 1500 }, { fix: { name: 'B', lat: 36, lon: 36 }, altLowerFt: 1000, altUpperFt: 4000 }, { fix: { name: 'C', lat: 37, lon: 36 } }] };

test('ROUTE: requested by TAC_C2, delayed by CTR (the request stays), then confirmed; a Strip matching the designator shows as a count', () => {
  const { store } = makeRegistry({ defs: [ROUTE], routeCount: 1 });
  assert.equal(store.getAirspace('IR-100').definition.altUpperFt, 4000, 'derived envelope');
  stateOp(store, 'IR-100', { kind: 'ScheduleAirspace', ...WINDOW }, 'TAC_C2');
  assert.equal(stateOp(store, 'IR-100', { kind: 'RequestActivation' }, 'TAC_C2').ok, true);
  const delayed = stateOp(store, 'IR-100', { kind: 'DelayActivation', note: 'traffic on the route, 10 min' }, 'CTR');
  assert.equal(delayed.ok, true, JSON.stringify(delayed));
  const rec = store.getAirspace('IR-100');
  assert.equal(rec.state, 'SCHEDULED');
  assert.equal(rec.pendingRequest.delay.note, 'traffic on the route, 10 min');
  assert.equal(rec.pendingRequest.delay.by, 'c1');
  assert.equal(stateOp(store, 'IR-100', { kind: 'DelayActivation' }, 'TAC_C2').reason, 'PERMISSION_DENIED', 'only the controlling side delays');
  const confirmed = stateOp(store, 'IR-100', { kind: 'ApproveActivation' }, 'CTR');
  assert.equal(confirmed.ok, true);
  assert.equal(store.getAirspace('IR-100').state, 'ACTIVE');
  assert.equal(store.routeOccupancy('IR-100'), 1);
});

test('ROUTE: Confirm works with no request at all; Deny is refused; Delay on an AREA is refused', () => {
  const { store } = makeRegistry({ defs: [ROUTE, MOA] });
  stateOp(store, 'IR-100', { kind: 'ScheduleAirspace', ...WINDOW }, 'CTR');
  const denied = stateOp(store, 'IR-100', { kind: 'DenyActivation' }, 'CTR');
  assert.equal(denied.ok, false);
  assert.match(denied.detail, /a route cannot be denied, delay it/);
  assert.equal(stateOp(store, 'IR-100', { kind: 'ApproveActivation' }, 'CTR').ok, true, 'confirm without a request');
  stateOp(store, 'MOA-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'CTR');
  assert.match(stateOp(store, 'MOA-1', { kind: 'DelayActivation' }, 'CTR').detail, /only a route activation is delayed/);
});

test('ROUTE: an edit re-derives the envelope; a client cannot send altitudes', () => {
  const { store } = makeRegistry({ defs: [ROUTE] });
  assert.match(edit(store, 'IR-100', { altUpperFt: 9000 }).detail, /derived from its segments/);
  const segs = JSON.parse(JSON.stringify(ROUTE.segments)); segs[1].altUpperFt = 9000;
  assert.equal(edit(store, 'IR-100', { segments: segs }).ok, true);
  assert.equal(store.getAirspace('IR-100').definition.altUpperFt, 9000);
});

// ── import and seed ──────────────────────────────────────────────────────

test('Import: additive, existing ids skipped and reported, one audit entry with created[] and skipped[]', () => {
  const log = LOG();
  const { store } = makeRegistry({ defs: [MOA], mutationLog: log });
  log.lines.length = 0; // the seeding import is not what these tests look at
  const r = store.apply({ clientMutationId: 'i1', theater: THEATER, op: { kind: 'ImportAirspaces', theater: THEATER, source: 'ACO', definitions: [MOA, NEW] } }, admin());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.created, ['MOA-NEW']);
  assert.deepEqual(r.skipped, [{ airspaceId: 'MOA-1', reason: 'EXISTS' }]);
  assert.equal(store.getAirspace('MOA-NEW').definition.source, 'ACO');
  assert.equal(store.getAirspace('MOA-1').definition.name, 'Test MOA', 'never overwritten');
  assert.equal(log.lines.length, 1);
  assert.deepEqual(log.lines[0].created, ['MOA-NEW']);
  assert.equal(log.lines[0].facilityId, 'CENTER');
});

test('Import: one invalid definition refuses the whole list; a panel session may not import', () => {
  const { store } = makeRegistry({ defs: [] });
  const r = store.apply({ theater: THEATER, op: { kind: 'ImportAirspaces', theater: THEATER, source: 'ACO', definitions: [NEW, { ...NEW, airspaceId: 'MOA-BAD', name: 'Bad', type: 'NOPE' }] } }, admin());
  assert.equal(r.ok, false);
  assert.match(r.detail, /nothing created: .*MOA-BAD/);
  assert.equal(store.getAll().length, 0);
  assert.equal(store.apply({ op: { kind: 'ImportAirspaces', theater: THEATER, source: 'ACO', definitions: [NEW] } }, panel('CTR')).reason, 'PERMISSION_DENIED');
  assert.match(store.apply({ theater: THEATER, op: { kind: 'ImportAirspaces', theater: THEATER, source: 'ACO', definitions: [NEW, NEW] } }, admin()).detail, /lists MOA-NEW twice/);
});

test('seed: each theater\'s unseeded ids land once; a seeded id that is deleted does not come back; a new id lands', () => {
  const { store } = makeRegistry({ defs: [] });
  const standing = { Test: [MOA], Other: [{ ...MOA, airspaceId: 'MOA-O', name: 'Other' }] };
  assert.equal(store.seed(standing), 2);
  assert.equal(store.getAirspace('MOA-1').definition.source, 'STANDING');
  assert.equal(del(store, 'MOA-1').ok, true);
  // a restart: the snapshot comes back with `seeded`
  const again = makeRegistry({ defs: [] }).store;
  again.restore(JSON.parse(JSON.stringify(store.snapshot())));
  assert.equal(again.seed(standing), 0, 'nothing new');
  assert.equal(again.getAirspace('MOA-1'), null, 'the deleted seeded id is not resurrected');
  const more = { ...standing, Test: [...standing.Test, NEW] };
  assert.equal(again.seed(more), 1, 'a later addition lands');
  assert.ok(again.getAirspace('MOA-NEW'));
});

test('seed: a definition that fails validation or references is a START-UP error naming the theater and the id', () => {
  const { store } = makeRegistry({ defs: [] });
  assert.throws(() => store.seed({ Syria: [{ ...NEW, controllingPositionId: 'NOBODY' }] }), /theater Syria.*MOA-NEW: NOBODY is not a Position of CENTER/);
  assert.throws(() => store.seed({ Syria: [{ ...NEW, type: 'XX' }] }), /theater Syria.*MOA-NEW/);
});

// ── theater scoping ──────────────────────────────────────────────────────

test('a theater change between missions: the other theater\'s list disappears from getAll(), its records keep their state', () => {
  const { store, state } = makeRegistry({ defs: [] });
  create(store, NEW);
  stateOp(store, 'MOA-NEW', { kind: 'ScheduleAirspace', ...WINDOW }, 'CTR');
  state.theater = 'Other';
  assert.deepEqual(store.getAll(), []);
  assert.equal(store.getAirspace('MOA-NEW'), null);
  assert.equal(store.isActive('MOA-NEW'), false);
  assert.equal(stateOp(store, 'MOA-NEW', { kind: 'ApproveActivation' }, 'CTR').reason, 'NOT_FOUND');
  state.theater = THEATER;
  assert.equal(store.getAirspace('MOA-NEW').state, 'SCHEDULED');
});

test('no mission loaded: panel ops answer NOT_FOUND "no mission loaded", getAll is empty, service ops name their theater', () => {
  const { store, state } = makeRegistry({ defs: [MOA] });
  state.theater = null;
  assert.deepEqual(store.getAll(), []);
  const r = create(store, NEW);
  assert.equal(r.reason, 'NOT_FOUND');
  assert.equal(r.detail, 'no mission loaded');
  assert.equal(store.apply({ theater: THEATER, op: { kind: 'CreateAirspace', definition: NEW } }, admin()).ok, true, 'the web may edit any theater');
  assert.deepEqual(store.getAllFor(THEATER).map(a => a.airspaceId).sort(), ['MOA-1', 'MOA-NEW']);
});

// ── audit and sequence ───────────────────────────────────────────────────

test('audit: before/after include the definition; facilityId is never null on create; every outcome is one entry; via is recorded', () => {
  const log = LOG();
  const { store } = makeRegistry({ defs: [MOA], mutationLog: log });
  log.lines.length = 0; // the seeding import is not what these tests look at
  create(store, NEW);
  edit(store, 'MOA-1', { name: 'Edited' });
  edit(store, 'MOA-1', { airspaceId: 'NOPE' });            // a refusal
  stateOp(store, 'NOPE-1', { kind: 'ScheduleAirspace' }, 'CTR'); // NOT_FOUND
  assert.equal(log.lines.length, 4);
  const [c, e, refusal, nf] = log.lines;
  assert.equal(c.facilityId, 'CENTER');
  assert.equal(c.after.definition.name, 'New MOA');
  assert.equal(c.via, 'PANEL');
  assert.equal(c.theater, THEATER);
  assert.equal(e.before.definition.name, 'Test MOA');
  assert.equal(e.after.definition.name, 'Edited');
  assert.deepEqual(e.changes, [{ field: 'name', from: 'Test MOA', to: 'Edited' }]);
  assert.equal(refusal.ok, false);
  assert.equal(nf.reason, 'NOT_FOUND');
});

test('seq: every definition and state change advances the airspace seq; a refusal does not', () => {
  const { store } = makeRegistry({ defs: [MOA] });
  const s0 = store.currentSeq;
  edit(store, 'MOA-1', { name: 'X' });
  assert.equal(store.currentSeq, s0 + 1);
  edit(store, 'MOA-1', { airspaceId: 'Y-1' });
  assert.equal(store.currentSeq, s0 + 1);
  stateOp(store, 'MOA-1', { kind: 'ScheduleAirspace', ...WINDOW }, 'CTR');
  assert.equal(store.currentSeq, s0 + 2);
  create(store, NEW);
  del(store, 'MOA-NEW');
  assert.equal(store.currentSeq, s0 + 4);
  assert.ok(SQUARE);
});

// ── persistence round trips ──────────────────────────────────────────────

test('create then restart, edit then restart, delete then restart: the snapshot alone brings it all back', () => {
  const { store } = makeRegistry({ defs: [] });
  const roundTrip = (s) => { const r = makeRegistry({ defs: [] }).store; r.restore(JSON.parse(JSON.stringify(s.snapshot()))); return r; };
  create(store, NEW);
  let r = roundTrip(store);
  assert.equal(r.getAirspace('MOA-NEW').defRev, 1);
  edit(r, 'MOA-NEW', { workingFrequencyMhz: 140 });
  r = roundTrip(r);
  assert.equal(r.getAirspace('MOA-NEW').definition.workingFrequencyMhz, 140);
  assert.equal(r.getHistory('MOA-NEW').length, 1, 'the history survives');
  del(r, 'MOA-NEW');
  r = roundTrip(r);
  assert.equal(r.getAirspace('MOA-NEW'), null);
});

test('restore refuses a definition that does not validate, naming the theater and id', () => {
  const store = makeRegistry({ defs: [MOA] }).store;
  const snap = JSON.parse(JSON.stringify(store.snapshot()));
  snap.byTheater.Test[0].definition.type = 'GONE';
  assert.throws(() => makeRegistry({ defs: [] }).store.restore(snap), /airspace MOA-1 \(theater Test\).*type/);
});
