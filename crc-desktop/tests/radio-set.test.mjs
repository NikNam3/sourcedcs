// The derived radio set and its link groups (docs/adr/0158 §2, §3): app/public/js/radio/radio-set.js and link-groups.js.
// Pure: every input is passed in. Position and Facility ids here are test fixtures, not rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRadioSet, positionRadios, rowsWithoutRadio, positionsWithoutRow, guardRadios, manualRadios, positionRowsOf, GUARDS,
  assignSlots, slotKeyOf,
} from '../app/public/js/radio/radio-set.js';
import {
  AUTO_GROUP_ID, NO_SLOT_CONFLICT, SRS_SLOTS, mayTransmit, assignLinkGroups, createGroup, renameGroup, deleteGroup, moveRadio, forgetRadio,
  nextGroupName, groupNameProblem, transmitRadioIds, resolvePttTarget, intendedGroupOf,
} from '../app/public/js/radio/link-groups.js';

const F = 'FAC1';
const row = (positionId, label, mhz, extra = {}) => ({ facilityId: F, kind: 'POSITION', positionId, label, mhz, defaultMhz: mhz, added: false, ...extra });
const ROWS = [
  row('P1', 'TWR', 275.8),
  row('P1', 'TWR VHF', 122.1),
  row('P1', 'TWR 2', 290.2), // a second UHF row: no second radio
  row('P2', 'APP', 340.2),
  row('P3', 'FM', 40.5),     // outside both bands
  { facilityId: F, kind: 'SFA', rackId: 'freq-1', use: 'RANGE', mhz: 251.0, defaultMhz: 251.0 },
];
const staff = (...ids) => ids.map(positionId => ({ facilityId: F, positionId }));
const ids = (set) => set.radios.map(r => r.id);
const radio = (set, id) => set.radios.find(r => r.id === id);
const group = (set, id) => set.groups.find(g => g.id === id);

// ── the radios ───────────────────────────────────────────────────────────────

test('nothing staffed: only the two guards, separate and linked to nothing', () => {
  const set = buildRadioSet({ rows: ROWS });
  assert.deepEqual(ids(set), ['GUARD:UHF', 'GUARD:VHF']);
  for (const r of set.radios) { assert.equal(r.groupId, null); assert.equal(r.conflict, null); assert.equal(r.kind, 'GUARD'); }
  assert.deepEqual(set.radios.map(r => [r.band, r.mhz]), [['UHF', 243], ['VHF', 121.5]]);
  assert.deepEqual(set.groups, [{ id: AUTO_GROUP_ID, name: 'POSITIONS', auto: true, radioIds: [] }]);
});

test('a staffed Position gets its first UHF row and its first VHF row as radios, in the automatic group', () => {
  const set = buildRadioSet({ staffed: staff('P1'), rows: ROWS });
  assert.deepEqual(ids(set), ['POSITION:P1:UHF', 'POSITION:P1:VHF', 'GUARD:UHF', 'GUARD:VHF']);
  assert.deepEqual(radio(set, 'POSITION:P1:UHF'), {
    id: 'POSITION:P1:UHF', kind: 'POSITION', positionId: 'P1', band: 'UHF', mhz: 275.8, modulation: 'AM',
    label: 'P1 TWR', groupId: AUTO_GROUP_ID, conflict: null, receiveOnly: false,
  });
  assert.equal(radio(set, 'POSITION:P1:VHF').mhz, 122.1);
  assert.deepEqual(group(set, AUTO_GROUP_ID).radioIds, ['POSITION:P1:UHF', 'POSITION:P1:VHF']);
});

test('a Position with UHF only has one radio; several Positions link into one automatic group', () => {
  const set = buildRadioSet({ staffed: staff('P1', 'P2'), rows: ROWS });
  assert.deepEqual(group(set, AUTO_GROUP_ID).radioIds, ['POSITION:P1:UHF', 'POSITION:P1:VHF', 'POSITION:P2:UHF']);
  assert.equal(radio(set, 'POSITION:P2:VHF'), undefined);
});

test('a row outside both bands gets no radio, and is listed for the panel\'s note', () => {
  const set = buildRadioSet({ staffed: staff('P3'), rows: ROWS });
  assert.deepEqual(ids(set), ['GUARD:UHF', 'GUARD:VHF']);
  assert.deepEqual(rowsWithoutRadio(staff('P1', 'P3'), ROWS).map(r => r.label), ['FM']);
});

test('table order: shipped rows first, then added rows in the order they came', () => {
  const rows = [
    row('P5', 'ADD1', 251.0, { added: true, defaultMhz: null }),
    row('P5', 'SHIP', 260.0),
    row('P5', 'ADD2', 124.0, { added: true, defaultMhz: null }),
    row('P5', 'ADD3', 125.0, { added: true, defaultMhz: null }),
  ];
  assert.deepEqual(positionRowsOf(rows, { facilityId: F, positionId: 'P5' }).map(r => r.label), ['SHIP', 'ADD1', 'ADD2', 'ADD3']);
  const set = buildRadioSet({ staffed: staff('P5'), rows });
  assert.equal(radio(set, 'POSITION:P5:UHF').mhz, 260.0);
  assert.equal(radio(set, 'POSITION:P5:VHF').mhz, 124.0);
});

test('a row of another Facility with the same Position id is not this Position\'s', () => {
  const rows = [{ ...row('P1', 'TWR', 275.8), facilityId: 'OTHER' }];
  assert.deepEqual(positionRadios(staff('P1'), rows), []);
});

test('the label is the Position alone when the row is named after it', () => {
  assert.equal(positionRadios(staff('P1'), [row('P1', 'P1', 275.8)])[0].label, 'P1');
});

test('a Position listed twice still has one radio per band', () => {
  assert.deepEqual(positionRadios(staff('P1', 'P1'), ROWS).map(r => r.id), ['POSITION:P1:UHF', 'POSITION:P1:VHF']);
});

test('manual radios come last, keep their label, and one outside both bands has band null', () => {
  const set = buildRadioSet({ manual: [{ id: 'm1', label: 'TAC', mhz: 251.0 }, { id: 'm2', mhz: 40.5 }, { id: 'bad', mhz: NaN }] });
  assert.deepEqual(ids(set), ['GUARD:UHF', 'GUARD:VHF', 'MANUAL:m1', 'MANUAL:m2']);
  assert.equal(radio(set, 'MANUAL:m1').label, 'TAC');
  assert.equal(radio(set, 'MANUAL:m2').label, 'MANUAL');
  assert.equal(radio(set, 'MANUAL:m2').band, null);
  assert.equal(radio(set, 'MANUAL:m1').groupId, null);
});

test('the guards are fixed: 243.000 UHF and 121.500 VHF', () => {
  assert.deepEqual(GUARDS.map(g => [g.band, g.mhz]), [['UHF', 243], ['VHF', 121.5]]);
  assert.deepEqual(guardRadios().map(r => r.label), ['GUARD UHF', 'GUARD VHF']);
  assert.deepEqual(manualRadios(), []);
});

// ── staff, unstaff, retune ───────────────────────────────────────────────────

test('staff then unstaff: the Position radios come and go, the membership stays', () => {
  const groups = [{ id: 'G1', name: 'A' }];
  const membership = { 'POSITION:P1:VHF': 'G1' };
  const on = buildRadioSet({ staffed: staff('P1'), rows: ROWS, groups, membership });
  assert.equal(radio(on, 'POSITION:P1:VHF').groupId, 'G1');
  const off = buildRadioSet({ staffed: [], rows: ROWS, groups, membership });
  assert.equal(radio(off, 'POSITION:P1:VHF'), undefined);
  assert.deepEqual(group(off, 'G1').radioIds, []);
  // staffed again: the radio the controller moved is back in the controller's group, not the automatic one
  const again = buildRadioSet({ staffed: staff('P1'), rows: ROWS, groups, membership });
  assert.equal(radio(again, 'POSITION:P1:VHF').groupId, 'G1');
  assert.deepEqual(group(again, AUTO_GROUP_ID).radioIds, ['POSITION:P1:UHF']);
});

test('a retune keeps the radio\'s identity and its group', () => {
  const membership = { 'POSITION:P1:UHF': null };
  const before = buildRadioSet({ staffed: staff('P1'), rows: ROWS, membership });
  const rows = ROWS.map(r => (r.positionId === 'P1' && r.label === 'TWR' ? { ...r, mhz: 280.0 } : r));
  const after = buildRadioSet({ staffed: staff('P1'), rows, membership });
  assert.equal(radio(before, 'POSITION:P1:UHF').mhz, 275.8);
  assert.equal(radio(after, 'POSITION:P1:UHF').mhz, 280.0);
  assert.equal(radio(after, 'POSITION:P1:UHF').groupId, null);
});

test('a retune that moves a row out of its band moves the radio to the Position\'s next row of that band', () => {
  const rows = ROWS.map(r => (r.positionId === 'P1' && r.label === 'TWR' ? { ...r, mhz: 40.0 } : r));
  const set = buildRadioSet({ staffed: staff('P1'), rows });
  assert.equal(radio(set, 'POSITION:P1:UHF').mhz, 290.2);
  assert.equal(radio(set, 'POSITION:P1:UHF').label, 'P1 TWR 2');
});

// ── one frequency per group ──────────────────────────────────────────────────

test('a conflict: the first radio keeps the frequency, the second is left out of its group with conflict set', () => {
  const groups = [{ id: 'G1', name: 'B' }];
  const manual = [{ id: 'm1', label: 'TWR', mhz: 275.8 }];
  const set = buildRadioSet({ staffed: staff('P1'), rows: ROWS, manual, groups, membership: { 'MANUAL:m1': 'G1' } });
  assert.equal(radio(set, 'POSITION:P1:UHF').groupId, AUTO_GROUP_ID);
  assert.equal(radio(set, 'POSITION:P1:UHF').conflict, null);
  assert.equal(radio(set, 'MANUAL:m1').groupId, null);
  assert.equal(radio(set, 'MANUAL:m1').conflict, 'frequency already in group POSITIONS');
  assert.deepEqual(group(set, 'G1').radioIds, []);
});

test('a conflict clears by itself when the other radio leaves the group, and the radio rejoins', () => {
  const groups = [{ id: 'G1', name: 'B' }];
  const manual = [{ id: 'm1', mhz: 275.8 }];
  const membership = { 'MANUAL:m1': 'G1', 'POSITION:P1:UHF': null };
  const set = buildRadioSet({ staffed: staff('P1'), rows: ROWS, manual, groups, membership });
  assert.equal(radio(set, 'MANUAL:m1').groupId, 'G1');
  assert.equal(radio(set, 'MANUAL:m1').conflict, null);
});

test('two radios on one frequency in the same group, or unlinked, are no conflict', () => {
  const manual = [{ id: 'm1', mhz: 243.0 }, { id: 'm2', mhz: 243.0 }];
  const unlinked = buildRadioSet({ manual });
  assert.ok(unlinked.radios.every(r => r.conflict === null));
  const groups = [{ id: 'G1', name: 'A' }];
  const same = buildRadioSet({ manual, groups, membership: { 'GUARD:UHF': 'G1', 'MANUAL:m1': 'G1', 'MANUAL:m2': 'G1' } });
  assert.ok(same.radios.every(r => r.conflict === null));
  assert.deepEqual(group(same, 'G1').radioIds, ['GUARD:UHF', 'MANUAL:m1', 'MANUAL:m2']);
});

test('the frequency is compared to the kHz, so a float that prints the same is the same frequency', () => {
  const groups = [{ id: 'G1', name: 'A' }, { id: 'G2', name: 'B' }];
  const set = assignLinkGroups(
    [{ id: 'MANUAL:a', kind: 'MANUAL', mhz: 0.1 + 118.2 }, { id: 'MANUAL:b', kind: 'MANUAL', mhz: 118.3 }],
    { groups, membership: { 'MANUAL:a': 'G1', 'MANUAL:b': 'G2' } },
  );
  assert.equal(set.radios[1].conflict, 'frequency already in group A');
});

// ── groups ───────────────────────────────────────────────────────────────────

test('create groups: default names A, B, C..., the next free one, ids that do not repeat', () => {
  let r = createGroup([]);
  assert.deepEqual(r, { groups: [{ id: 'G1', name: 'A' }], id: 'G1' });
  r = createGroup(r.groups);
  assert.deepEqual(r.groups.map(g => g.name), ['A', 'B']);
  const renamed = renameGroup(r.groups, 'G1', 'tac');
  assert.deepEqual(renamed.groups.map(g => g.name), ['TAC', 'B']);
  assert.equal(nextGroupName(renamed.groups), 'A');
  assert.equal(createGroup(renamed.groups).id, 'G3');
  const letters = Array.from({ length: 26 }, (_, i) => ({ id: `x${i}`, name: String.fromCharCode(65 + i) }));
  assert.equal(nextGroupName(letters), 'G27');
});

test('a group name is 1 to 12 characters, not the automatic group\'s, not taken', () => {
  const groups = [{ id: 'G1', name: 'A' }];
  assert.match(createGroup(groups, 'a').error, /already a group/);
  assert.match(createGroup(groups, 'positions').error, /automatic group/);
  assert.match(renameGroup(groups, 'G1', '   ').error, /1 to 12/);
  assert.match(renameGroup(groups, 'G1', 'X'.repeat(13)).error, /1 to 12/);
  assert.match(renameGroup(groups, 'G9', 'X').error, /no such group/);
  assert.equal(groupNameProblem('A', groups, 'G1'), null); // renaming a group to its own name
  assert.deepEqual(createGroup(groups, ' Ctr ').groups[1], { id: 'G2', name: 'CTR' });
});

test('delete a group with radios in it: they become unlinked, a Position radio does not fall back to the automatic group', () => {
  const groups = [{ id: 'G1', name: 'A' }, { id: 'G2', name: 'B' }];
  const membership = { 'POSITION:P1:UHF': 'G1', 'GUARD:VHF': 'G1', 'GUARD:UHF': 'G2' };
  const d = deleteGroup({ groups, membership }, 'G1');
  assert.deepEqual(d.groups, [{ id: 'G2', name: 'B' }]);
  assert.deepEqual(d.membership, { 'POSITION:P1:UHF': null, 'GUARD:VHF': null, 'GUARD:UHF': 'G2' });
  const set = buildRadioSet({ staffed: staff('P1'), rows: ROWS, ...d });
  assert.equal(radio(set, 'POSITION:P1:UHF').groupId, null);
  assert.equal(radio(set, 'GUARD:VHF').groupId, null);
  assert.equal(radio(set, 'GUARD:UHF').groupId, 'G2');
  assert.deepEqual(deleteGroup({ groups, membership }, AUTO_GROUP_ID), { groups, membership });
});

test('a membership naming a group that no longer exists links nothing', () => {
  assert.equal(intendedGroupOf({ id: 'GUARD:UHF', kind: 'GUARD' }, { 'GUARD:UHF': 'G9' }), null);
  assert.equal(intendedGroupOf({ id: 'POSITION:P1:UHF', kind: 'POSITION' }, {}), AUTO_GROUP_ID);
});

test('move a radio: into a group, out of every group, back to its default (stored only when it differs)', () => {
  const pos = { id: 'POSITION:P1:UHF', kind: 'POSITION' };
  const guard = { id: 'GUARD:UHF', kind: 'GUARD' };
  let m = moveRadio({}, pos, null);
  assert.deepEqual(m, { 'POSITION:P1:UHF': null });
  m = moveRadio(m, pos, 'G1');
  assert.deepEqual(m, { 'POSITION:P1:UHF': 'G1' });
  m = moveRadio(m, pos, AUTO_GROUP_ID);
  assert.deepEqual(m, {});
  m = moveRadio(m, guard, AUTO_GROUP_ID); // a guard may be linked with the Positions, by hand
  assert.deepEqual(m, { 'GUARD:UHF': AUTO_GROUP_ID });
  m = moveRadio(m, guard, null);
  assert.deepEqual(m, {});
  assert.deepEqual(forgetRadio({ 'MANUAL:m1': 'G1', 'GUARD:UHF': 'G1' }, 'MANUAL:m1'), { 'GUARD:UHF': 'G1' });
  const same = { a: 1 };
  assert.equal(forgetRadio(same, 'x'), same);
});

test('a radio is in at most one group', () => {
  const groups = [{ id: 'G1', name: 'A' }, { id: 'G2', name: 'B' }];
  const set = buildRadioSet({ staffed: staff('P1', 'P2'), rows: ROWS, groups, membership: { 'POSITION:P2:UHF': 'G2', 'GUARD:UHF': 'G1' } });
  const seen = set.groups.flatMap(g => g.radioIds);
  assert.equal(seen.length, new Set(seen).size);
  for (const r of set.radios) assert.equal(set.groups.filter(g => g.radioIds.includes(r.id)).length, r.groupId ? 1 : 0);
});

// ── transmit ─────────────────────────────────────────────────────────────────

test('PTT keys the selected radio\'s whole group, or the radio alone when unlinked', () => {
  const set = buildRadioSet({ staffed: staff('P1', 'P2'), rows: ROWS });
  assert.deepEqual(transmitRadioIds(set, 'POSITION:P2:UHF'), ['POSITION:P1:UHF', 'POSITION:P1:VHF', 'POSITION:P2:UHF']);
  assert.deepEqual(transmitRadioIds(set, 'GUARD:UHF'), ['GUARD:UHF']);
  assert.deepEqual(transmitRadioIds(set, 'nope'), []);
});

test('the PTT target: the controller\'s choice while it may transmit, else the automatic group\'s first, else the first radio', () => {
  const set = buildRadioSet({ staffed: staff('P2'), rows: ROWS });
  assert.equal(resolvePttTarget(set, 'GUARD:VHF'), 'GUARD:VHF');
  assert.equal(resolvePttTarget(set, 'POSITION:P1:UHF'), 'POSITION:P2:UHF'); // P1 left
  assert.equal(resolvePttTarget(buildRadioSet({}), null), 'GUARD:UHF');
  const observing = buildRadioSet({ staffed: [{ facilityId: F, positionId: 'P2', observer: true }], rows: ROWS });
  assert.equal(resolvePttTarget(observing, 'POSITION:P2:UHF'), 'GUARD:UHF'); // never a receive-only radio
});

// ── Observers (S-RADIO-1 RQ14) ───────────────────────────────────────────────

test('an Observer\'s Position radios are receive-only and unlinked, whatever the membership says, and never keyed', () => {
  const staffed = [{ facilityId: F, positionId: 'P1' }, { facilityId: F, positionId: 'P2', observer: true }];
  const groups = [{ id: 'G1', name: 'A' }];
  const set = buildRadioSet({ staffed, rows: ROWS, groups, membership: { 'POSITION:P2:UHF': 'G1' } });
  const obs = radio(set, 'POSITION:P2:UHF');
  assert.equal(obs.receiveOnly, true);
  assert.equal(obs.groupId, null);
  assert.equal(obs.conflict, null);
  assert.equal(radio(set, 'POSITION:P1:UHF').receiveOnly, false);
  assert.deepEqual(group(set, AUTO_GROUP_ID).radioIds, ['POSITION:P1:UHF', 'POSITION:P1:VHF']);
  assert.deepEqual(group(set, 'G1').radioIds, []);
  assert.equal(mayTransmit(obs), false);
  assert.deepEqual(transmitRadioIds(set, 'POSITION:P2:UHF'), []);
});

// ── Positions with no row (RQ15) ─────────────────────────────────────────────

test('a staffed Position with no frequency row is listed for the panel\'s grey line', () => {
  assert.deepEqual(positionsWithoutRow(staff('P1', 'P9'), ROWS), [{ facilityId: F, positionId: 'P9' }]);
  assert.deepEqual(positionsWithoutRow(staff('P3'), ROWS), []); // a row, but outside both bands: the other note
});

// ── SRS slots (RQ13) ─────────────────────────────────────────────────────────

test('one SRS slot per distinct frequency and modulation: duplicates share a slot', () => {
  assert.equal(slotKeyOf({ mhz: 0.1 + 118.2, modulation: 'AM' }), slotKeyOf({ mhz: 118.3, modulation: 'AM' }));
  assert.notEqual(slotKeyOf({ mhz: 118.3, modulation: 'AM' }), slotKeyOf({ mhz: 118.3, modulation: 'FM' }));
  const manual = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, mhz: 243.0 })); // all on guard
  const set = buildRadioSet({ manual });
  assert.ok(set.radios.every(r => r.conflict === null));
});

test('past 11 slots the overflow radios get the grey conflict: guards first, then Positions, then manual', () => {
  const rows = Array.from({ length: 5 }, (_, i) => [row(`Q${i}`, 'U', 250 + i), row(`Q${i}`, 'V', 120 + i)]).flat();
  const staffed = staff('Q0', 'Q1', 'Q2', 'Q3', 'Q4'); // 10 Position radios + 2 guards = 12 slots
  const manual = [{ id: 'm1', mhz: 300.0 }];
  const set = buildRadioSet({ staffed, rows, manual });
  assert.equal(SRS_SLOTS, 11);
  assert.equal(radio(set, 'GUARD:UHF').conflict, null);
  assert.equal(radio(set, 'GUARD:VHF').conflict, null);
  assert.equal(radio(set, 'POSITION:Q3:VHF').conflict, null);
  assert.equal(radio(set, 'POSITION:Q4:UHF').conflict, null); // the 11th
  assert.equal(radio(set, 'POSITION:Q4:VHF').conflict, NO_SLOT_CONFLICT);
  assert.equal(radio(set, 'POSITION:Q4:VHF').groupId, null);
  assert.equal(radio(set, 'MANUAL:m1').conflict, NO_SLOT_CONFLICT);
  assert.equal(mayTransmit(radio(set, 'MANUAL:m1')), false);
  assert.ok(!group(set, AUTO_GROUP_ID).radioIds.includes('POSITION:Q4:VHF'));
  // a radio sharing a frequency already in a slot is never refused
  const shared = assignSlots([...set.radios.map(r => ({ ...r, conflict: null })), { id: 'MANUAL:x', kind: 'MANUAL', mhz: 250, modulation: 'AM' }]);
  assert.equal(shared.find(r => r.id === 'MANUAL:x').conflict, null);
});

test('a manual radio may be FM (RQ18); anything else is AM', () => {
  const set = buildRadioSet({ manual: [{ id: 'f', mhz: 40.5, modulation: 'FM' }, { id: 'x', mhz: 251, modulation: 'INTERCOM' }] });
  assert.equal(radio(set, 'MANUAL:f').modulation, 'FM');
  assert.equal(radio(set, 'MANUAL:x').modulation, 'AM');
});
