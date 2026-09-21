import { test } from 'node:test';
import assert from 'node:assert/strict';

const { DEPARTURE_BLOCK_MAP, ARRIVAL_BLOCK_MAP, OVERFLIGHT_BLOCK_MAP, MISSION_BLOCK_MAP, BLOCK_MAPS, isValidRole, requiredBlocksFor, resolveBlockTarget, validateFacilityConfig, interlockFor, interlockBlocks, MILITARY_BLOCK_NAMESPACE } =
  await import('../src/efsp/block-map.js');
const { MILITARY_WRITABLE_FIELDS, defaultMilitary } = await import('../src/efsp/fdr-store.js');

const REQUIRED_DEPARTURE_BLOCKS = [
  '1', '2', '3', '4', '4B', '5', '6', '7', '8', '8A', '8B', '9', '9D', '9E',
  '10', '11', '14', '18', '24', '25', '26',
];

test('requiredBlocksFor(DEPARTURE) matches exactly the guide §6.2 ✱-marked blocks', () => {
  assert.deepEqual(requiredBlocksFor('DEPARTURE').sort(), [...REQUIRED_DEPARTURE_BLOCKS].sort());
});

test('every required Block from §6.2 exists in the Block Map at all', () => {
  for (const id of REQUIRED_DEPARTURE_BLOCKS) {
    assert.ok(DEPARTURE_BLOCK_MAP[id], id);
  }
});

test('deferred/optional Blocks (2A, 4A, 9A-9C, 16, 17, 19-23) are present but not required — schema fields stay present, not absent (guide §12)', () => {
  const optional = ['2A', '4A', '9A', '9B', '9C', '16', '17', '19', '20', '21', '22', '23'];
  for (const id of optional) {
    assert.ok(DEPARTURE_BLOCK_MAP[id], id);
    assert.equal(DEPARTURE_BLOCK_MAP[id].required, false, id);
  }
});

test('requiredBlocksFor returns an empty array for an unknown role', () => {
  assert.deepEqual(requiredBlocksFor('NOT_A_ROLE'), []);
});

test('isValidRole is true for DEPARTURE, ARRIVAL, OVERFLIGHT (docs/adr/0023) and MISSION (WP4A second slice), false for anything else', () => {
  assert.equal(isValidRole('DEPARTURE'), true);
  assert.equal(isValidRole('ARRIVAL'), true);
  assert.equal(isValidRole('OVERFLIGHT'), true);
  assert.equal(isValidRole('MISSION'), true);
  assert.equal(isValidRole('NOT_A_ROLE'), false);
});

// ── resolveBlockTarget ───────────────────────────────────────────────────

test('resolveBlockTarget routes fdr-bound Blocks to their exact field path', () => {
  assert.deepEqual(resolveBlockTarget('DEPARTURE', '1'), { kind: 'fdr', path: 'identity.callsign' });
  assert.deepEqual(resolveBlockTarget('DEPARTURE', '5'), { kind: 'fdr', path: 'identity.beaconAssigned' });
  assert.deepEqual(resolveBlockTarget('DEPARTURE', '9E'), { kind: 'fdr', path: 'filed.remarks' });
  assert.deepEqual(resolveBlockTarget('DEPARTURE', '14'), { kind: 'fdr', path: 'assigned.releaseTimeUtc' });
});

test('resolveBlockTarget routes annotation-only Blocks to {kind:"annotation"}', () => {
  for (const id of ['2A', '9A', '11', '19', '24']) {
    assert.deepEqual(resolveBlockTarget('DEPARTURE', id), { kind: 'annotation' }, id);
  }
});

test('resolveBlockTarget returns null for system-derived Blocks (2, 4, 25, 26) — not SetBlock-writable', () => {
  for (const id of ['2', '4', '25', '26']) {
    assert.equal(resolveBlockTarget('DEPARTURE', id), null, id);
  }
});

test('resolveBlockTarget returns null for the composite Block 3 and flag Block 4A', () => {
  assert.equal(resolveBlockTarget('DEPARTURE', '3'), null);
  assert.equal(resolveBlockTarget('DEPARTURE', '4A'), null);
});

test('resolveBlockTarget returns null for an unknown Block ID', () => {
  assert.equal(resolveBlockTarget('DEPARTURE', 'ZZZ'), null);
});

test('resolveBlockTarget returns null for an unknown role entirely', () => {
  assert.equal(resolveBlockTarget('NOT_A_ROLE', '1'), null);
});

test('resolveBlockTarget returns null for a Block ID MISSION does not define (it uses an M-prefixed namespace, not FAA numbering)', () => {
  assert.equal(resolveBlockTarget('MISSION', '1'), null);
});

// ── ARRIVAL_BLOCK_MAP (Phase 2, docs/adr/0008 — [SOURCE-DEFINED]) ────────

const REQUIRED_ARRIVAL_BLOCKS = [
  '1', '2', '3', '4', '4B', '5', '6', '7', '8', '8B', '9', '9A-FUEL', '9E', '24', '25', '26',
];

test('requiredBlocksFor(ARRIVAL) matches ARRIVAL_BLOCK_MAP\'s required set', () => {
  assert.deepEqual(requiredBlocksFor('ARRIVAL').sort(), [...REQUIRED_ARRIVAL_BLOCKS].sort());
});

test('every required ARRIVAL Block exists in the Block Map at all', () => {
  for (const id of REQUIRED_ARRIVAL_BLOCKS) assert.ok(ARRIVAL_BLOCK_MAP[id], id);
});

test('ARRIVAL\'s optional 9A-* sub-fields (destination/point-out/vector/speed) are present but not required', () => {
  for (const id of ['9A-DEST', '9A-PTOUT', '9A-VECTOR', '9A-SPEED']) {
    assert.ok(ARRIVAL_BLOCK_MAP[id], id);
    assert.equal(ARRIVAL_BLOCK_MAP[id].required, false, id);
  }
});

test('ARRIVAL Block 7 (assigned/cleared altitude) is annotation-routed, not fdr-routed — confirmVacated-eligible per guide §3.7 rule 3', () => {
  assert.deepEqual(resolveBlockTarget('ARRIVAL', '7'), { kind: 'annotation' });
});

test('ARRIVAL resolveBlockTarget routes fdr-bound Blocks to their exact field path', () => {
  assert.deepEqual(resolveBlockTarget('ARRIVAL', '1'), { kind: 'fdr', path: 'identity.callsign' });
  assert.deepEqual(resolveBlockTarget('ARRIVAL', '8'), { kind: 'fdr', path: 'filed.originAirport' });
  assert.deepEqual(resolveBlockTarget('ARRIVAL', '8B'), { kind: 'fdr', path: 'assigned.landingRunway' });
  assert.deepEqual(resolveBlockTarget('ARRIVAL', '6'), { kind: 'fdr', path: 'filed.estimatedArrivalTimeUtc' });
});

test('ARRIVAL resolveBlockTarget returns null for system/composite/flag Blocks (2, 3, 4, 4A, 25, 26)', () => {
  for (const id of ['2', '3', '4', '4A', '25', '26']) {
    assert.equal(resolveBlockTarget('ARRIVAL', id), null, id);
  }
});

// The exact test the guide's own WP2 acceptance criteria names (§13, §8.3
// note 1) — minimum fuel MUST survive any facility narrowing, everything
// else in 9A MAY be omitted.
test('a facility config omitting minimum fuel (9A-FUEL) from blockVisibility.ARRIVAL is rejected by the validator', () => {
  const withoutFuel = requiredBlocksFor('ARRIVAL').filter(id => id !== '9A-FUEL');
  const result = validateFacilityConfig({ role: 'ARRIVAL', visibleBlocks: withoutFuel });
  assert.equal(result.ok, false);
  assert.match(result.detail, /9A-FUEL/);
});

test('a facility config omitting the OPTIONAL 9A-* sub-fields (destination/point-out/vector/speed) from blockVisibility.ARRIVAL is accepted', () => {
  const result = validateFacilityConfig({ role: 'ARRIVAL', visibleBlocks: REQUIRED_ARRIVAL_BLOCKS });
  assert.equal(result.ok, true);
});

// ── OVERFLIGHT_BLOCK_MAP (docs/adr/0023 — [SOURCE-DEFINED]) ──────────────

const REQUIRED_OVERFLIGHT_BLOCKS = [
  '1', '2', '3', '4', '4B', '5', '7', '8', '8B', '9', '9E', '24', '25', '26',
];

test('requiredBlocksFor(OVERFLIGHT) matches OVERFLIGHT_BLOCK_MAP\'s required set', () => {
  assert.deepEqual(requiredBlocksFor('OVERFLIGHT').sort(), [...REQUIRED_OVERFLIGHT_BLOCKS].sort());
});

test('every required OVERFLIGHT Block exists in the Block Map at all', () => {
  for (const id of REQUIRED_OVERFLIGHT_BLOCKS) assert.ok(OVERFLIGHT_BLOCK_MAP[id], id);
});

test('OVERFLIGHT has no ground/runway/taxi Blocks — it never touches Incirlik\'s ground', () => {
  for (const id of ['8A', '14', '14B', '14C', '16', '17', '18']) {
    assert.equal(OVERFLIGHT_BLOCK_MAP[id], undefined, id);
  }
});

test('OVERFLIGHT resolveBlockTarget reuses DEPARTURE/ARRIVAL Airport paths for the flight\'s real origin/destination, never Incirlik-specific ones', () => {
  assert.deepEqual(resolveBlockTarget('OVERFLIGHT', '8'), { kind: 'fdr', path: 'filed.departureAirport' });
  assert.deepEqual(resolveBlockTarget('OVERFLIGHT', '8B'), { kind: 'fdr', path: 'filed.destinationAirport' });
});

test('OVERFLIGHT resolveBlockTarget returns null for system/composite/flag Blocks (2, 3, 4, 4A, 25, 26)', () => {
  for (const id of ['2', '3', '4', '4A', '25', '26']) {
    assert.equal(resolveBlockTarget('OVERFLIGHT', id), null, id);
  }
});

// ── MISSION_BLOCK_MAP (WP4A second slice — [SOURCE-DEFINED], minimal scope) ──

const REQUIRED_MISSION_BLOCKS = ['M1', 'M3', 'M4', 'M25', 'M26'];

test('requiredBlocksFor(MISSION) matches MISSION_BLOCK_MAP\'s required set', () => {
  assert.deepEqual(requiredBlocksFor('MISSION').sort(), [...REQUIRED_MISSION_BLOCKS].sort());
});

test('every required MISSION Block exists in the Block Map at all', () => {
  for (const id of REQUIRED_MISSION_BLOCKS) assert.ok(MISSION_BLOCK_MAP[id], id);
});

test('MISSION reuses identity.callsign and identity.beaconAssigned (the guide\'s own "bridge field") rather than inventing new identity fields', () => {
  assert.deepEqual(resolveBlockTarget('MISSION', 'M3'), { kind: 'fdr', path: 'identity.callsign' });
  assert.deepEqual(resolveBlockTarget('MISSION', 'M4'), { kind: 'fdr', path: 'identity.beaconAssigned' });
});

test('MISSION\'s own fields (mission number/package/controlling agency/vul window) route to the mission.* FDR sub-object', () => {
  assert.deepEqual(resolveBlockTarget('MISSION', 'M1'), { kind: 'fdr', path: 'mission.missionNumber' });
  assert.deepEqual(resolveBlockTarget('MISSION', 'M2'), { kind: 'fdr', path: 'mission.packageId' });
  assert.deepEqual(resolveBlockTarget('MISSION', 'M5'), { kind: 'fdr', path: 'mission.controllingAgency' });
  assert.deepEqual(resolveBlockTarget('MISSION', 'M6'), { kind: 'fdr', path: 'mission.vulWindowStartUtc' });
  assert.deepEqual(resolveBlockTarget('MISSION', 'M7'), { kind: 'fdr', path: 'mission.vulWindowEndUtc' });
});

test('MISSION has no FAA-numbered Blocks at all — its namespace is entirely M-prefixed (guide §9.8: drawn from the military extension namespace)', () => {
  for (const id of ['1', '2', '3', '4', '5', '8', '9', '24']) {
    assert.equal(MISSION_BLOCK_MAP[id], undefined, id);
  }
});

test('MISSION resolveBlockTarget returns null for system Blocks (M25, M26)', () => {
  for (const id of ['M25', 'M26']) {
    assert.equal(resolveBlockTarget('MISSION', id), null, id);
  }
});

// ── Blocks 3A-3E (docs/adr/0023 gap-closure) — aircraft type/wake category/
// tail number/unit/home station. Block 3 only ever DISPLAYED these as a
// read-only composite; identity.aircraftType/wakeCategory/tailNumber/unit/
// homeStation were already validated and writable via fdr-store.js's
// generic setField() (all five in WRITABLE_PATHS since Phase 1), but no
// Block anywhere routed a SetBlock at any of them until now. Present,
// optional, and identical across all three roles. ─────────────────────────

const IDENTITY_SUB_BLOCK_PATHS = {
  '3A': 'identity.aircraftType', '3B': 'identity.wakeCategory',
  '3C': 'identity.tailNumber', '3D': 'identity.unit', '3E': 'identity.homeStation',
};

for (const role of ['DEPARTURE', 'ARRIVAL', 'OVERFLIGHT']) {
  test(`${role}'s Blocks 3A-3E are present, optional, and fdr-routed to the right identity path`, () => {
    for (const [id, path] of Object.entries(IDENTITY_SUB_BLOCK_PATHS)) {
      assert.deepEqual(resolveBlockTarget(role, id), { kind: 'fdr', path }, `${role}/${id}`);
      assert.equal(requiredBlocksFor(role).includes(id), false, `${role}/${id} should not be required`);
    }
  });
}

// ── validateFacilityConfig ───────────────────────────────────────────────

test('validateFacilityConfig accepts a config that includes every required Block', () => {
  const result = validateFacilityConfig({ role: 'DEPARTURE', visibleBlocks: REQUIRED_DEPARTURE_BLOCKS });
  assert.deepEqual(result, { ok: true });
});

test('validateFacilityConfig rejects a config missing even one required Block, and names it', () => {
  const missingOne = REQUIRED_DEPARTURE_BLOCKS.filter(id => id !== '5');
  const result = validateFacilityConfig({ role: 'DEPARTURE', visibleBlocks: missingOne });
  assert.equal(result.ok, false);
  assert.match(result.detail, /5/);
});

test('validateFacilityConfig lists every missing required Block, not just the first', () => {
  const missingThree = REQUIRED_DEPARTURE_BLOCKS.filter(id => !['5', '9', '18'].includes(id));
  const result = validateFacilityConfig({ role: 'DEPARTURE', visibleBlocks: missingThree });
  assert.equal(result.ok, false);
  for (const id of ['5', '9', '18']) assert.match(result.detail, new RegExp(`\\b${id}\\b`));
});

test('validateFacilityConfig tolerates extra, non-required visible Blocks', () => {
  const result = validateFacilityConfig({ role: 'DEPARTURE', visibleBlocks: [...REQUIRED_DEPARTURE_BLOCKS, '2A', '16'] });
  assert.deepEqual(result, { ok: true });
});

test('validateFacilityConfig rejects an empty visibleBlocks list for a real role', () => {
  const result = validateFacilityConfig({ role: 'DEPARTURE', visibleBlocks: [] });
  assert.equal(result.ok, false);
});

// ── §9.10 Block 9F, the stereo route name (docs/adr/0050) ────────────────

test('Block 9F exists on DEPARTURE only — the other roles never file a local canned route', () => {
  assert.ok(DEPARTURE_BLOCK_MAP['9F'], 'DEPARTURE should carry 9F');
  assert.equal(ARRIVAL_BLOCK_MAP['9F'], undefined);
  assert.equal(OVERFLIGHT_BLOCK_MAP['9F'], undefined);
  assert.equal(MISSION_BLOCK_MAP['9F'], undefined);
});

test('Block 9F is optional — most flights are not filed on a stereo', () => {
  assert.equal(DEPARTURE_BLOCK_MAP['9F'].required, false);
  assert.equal(requiredBlocksFor('DEPARTURE').includes('9F'), false);
});

test('the guide\'s M18 number is deliberately NOT taken — it belongs to MISSION\'s own namespace', () => {
  // docs/adr/0026 froze M1-M8/M25/M26 with their own meanings (its M4 is the
  // beacon; the guide's M4 is IFF Mode 1/2), and MISSION is the one Role that
  // never files a stereo. See block-map.js's '9F' comment.
  for (const map of [DEPARTURE_BLOCK_MAP, ARRIVAL_BLOCK_MAP, OVERFLIGHT_BLOCK_MAP, MISSION_BLOCK_MAP]) {
    assert.equal(map['M18'], undefined);
  }
});

test('a SetBlock at 9F routes to filed.stereoRouteName — writing it is how a flight is re-filed', () => {
  assert.deepEqual(resolveBlockTarget('DEPARTURE', '9F'), { kind: 'fdr', path: 'filed.stereoRouteName' });
  // And nowhere else: the other Roles have no 9F at all, so a SetBlock at it
  // there is the ordinary unknown-Block VALIDATION_ERROR.
  for (const role of ['ARRIVAL', 'OVERFLIGHT', 'MISSION']) {
    assert.equal(resolveBlockTarget(role, '9F'), null, role);
  }
});


// ── WP6: the MARSA course/altitude interlock (§9.2 rule 2, docs/adr/0051) ──

test('every Strip Role a controller issues clearances on has BOTH a course and an altitude interlock Block', () => {
  // The point of this test. §13's acceptance criterion — "a heading or
  // altitude assignment to a MARSA participant before rendezvous voids the
  // relation" — can pass on one Role while silently not holding on another,
  // because each Role has its own Block Map. OVERFLIGHT had neither Block
  // before this slice, so a participant transiting on one could be vectored
  // with nothing voiding anything, and nothing anywhere would have said so.
  for (const role of ['DEPARTURE', 'ARRIVAL', 'OVERFLIGHT']) {
    const kinds = interlockBlocks(role).map(id => interlockFor(role, id));
    assert.ok(kinds.includes('COURSE'), `${role} has no course-assignment Block`);
    assert.ok(kinds.includes('ALTITUDE'), `${role} has no altitude-assignment Block`);
  }
});

test('MISSION has no interlock Block, and that is a decision', () => {
  // The interlock is about ATC ISSUING a clearance; a MISSION Strip is the
  // MRU-side mission line (§9.8), not a clearance surface. The relation's
  // participants are fdrIds, so a void raised on the ATC-side replica of the
  // same flight IS a void of this flight's relation — tagging a MISSION Block
  // would add a second place the same aircraft can void from, not coverage.
  assert.deepEqual(interlockBlocks('MISSION'), []);
});

test('the interlock answer is per-Role — Block 7 means opposite things on DEPARTURE and ARRIVAL', () => {
  // DEPARTURE's Block 7 is filed.requestedAltitude, what the flight ASKED FOR.
  // ARRIVAL's Block 7 is the assigned/cleared altitude. Same id, opposite
  // answers — which is why this lives in the Block Map and not in a list of
  // ids held next to the interlock.
  assert.equal(interlockFor('DEPARTURE', '7'), null);
  assert.equal(interlockFor('ARRIVAL', '7'), 'ALTITUDE');
  assert.equal(interlockFor('DEPARTURE', '20'), 'COURSE');
  assert.equal(interlockFor('DEPARTURE', '21'), 'ALTITUDE');
  assert.equal(interlockFor('OVERFLIGHT', '7A'), 'ALTITUDE');
  assert.equal(interlockFor('OVERFLIGHT', '9A-VECTOR'), 'COURSE');
});

test('interlockFor is null for an unknown Block or Role rather than throwing', () => {
  assert.equal(interlockFor('DEPARTURE', 'NOPE'), null);
  assert.equal(interlockFor('NOT_A_ROLE', '20'), null);
});

test('every interlock Block is one a controller can actually write', () => {
  // An interlock on a system/composite Block would never fire: resolveBlockTarget
  // returns null for those, so SetBlock refuses before reaching the interlock
  // at all. That would be the acceptance criterion held by an unreachable path
  // — docs/adr/0039's defect class exactly.
  for (const role of Object.keys(BLOCK_MAPS)) {
    for (const blockId of interlockBlocks(role)) {
      assert.ok(resolveBlockTarget(role, blockId), `${role}/${blockId} is tagged but not writable`);
    }
  }
});

test('OVERFLIGHT\'s two new assignment Blocks are annotation-routed, so a clearance history survives', () => {
  // §3.7's append-only model: a transiting flight given three altitudes has to
  // be able to show all three afterwards, and confirmVacated has to be
  // available — the same reason ARRIVAL's Block 7 is annotation-routed rather
  // than an FDR field.
  assert.deepEqual(resolveBlockTarget('OVERFLIGHT', '7A'), { kind: 'annotation' });
  assert.deepEqual(resolveBlockTarget('OVERFLIGHT', '9A-VECTOR'), { kind: 'annotation' });
  // And neither is required — a flight that is never vectored needs neither.
  assert.equal(OVERFLIGHT_BLOCK_MAP['7A'].required, false);
  assert.equal(OVERFLIGHT_BLOCK_MAP['9A-VECTOR'].required, false);
});

// ── WP6 (docs/adr/0052) — guide §6.4's military extension namespace ────────

const ATC_ROLES = ['DEPARTURE', 'ARRIVAL', 'OVERFLIGHT'];

test('the hook and ordnance Blocks exist on EVERY ATC Role, not just the one a test happened to use', () => {
  // docs/adr/0051's lesson, asserted rather than trusted: each Role has its own
  // Block Map, so a field added to one silently does not exist on the others,
  // and the test that passes is not the test that matters. A hook requirement
  // and an ordnance state are facts about the airframe — there is no ATC Role
  // they stop being true for.
  for (const role of ATC_ROLES) {
    assert.deepEqual(resolveBlockTarget(role, '3F'), { kind: 'military', field: 'hookRequired' }, `${role}/3F`);
    assert.deepEqual(resolveBlockTarget(role, '3G'), { kind: 'military', field: 'ordnanceState' }, `${role}/3G`);
    assert.equal(BLOCK_MAPS[role]['3F'].required, false, `${role}/3F`);
    assert.equal(BLOCK_MAPS[role]['3G'].required, false, `${role}/3G`);
  }
});

test('MISSION gets neither, so one aircraft\'s ordnance has exactly one place to be declared', () => {
  assert.equal(MISSION_BLOCK_MAP['3F'], undefined);
  assert.equal(MISSION_BLOCK_MAP['3G'], undefined);
  assert.equal(resolveBlockTarget('MISSION', '3G'), null);
});

test('the guide\'s M-prefix is never used as a Block id outside MISSION_BLOCK_MAP', () => {
  // The collision docs/adr/0026 created and 0052 finally wrote down: the guide's
  // §6.4 M-numbers mean different things from MISSION_BLOCK_MAP's frozen
  // M1-M8, so an M-numbered Block on an ATC Map would be ambiguous by
  // construction. Sub-letter onto the parent Block instead.
  for (const role of ATC_ROLES) {
    const mNumbered = Object.keys(BLOCK_MAPS[role]).filter(id => /^M\d/.test(id));
    assert.deepEqual(mNumbered, [], `${role} must not use the M-prefix — sub-letter onto the parent Block instead`);
  }
});

test('MILITARY_BLOCK_NAMESPACE agrees with the Block Maps it documents', () => {
  // The table is documentation, and documentation drifts. This is what stops
  // it: every entry claiming a concrete Block id must name one that exists and
  // routes where it says, and every `military`-kind Block on any Map must
  // appear in the table.
  const claimed = new Map();
  for (const [m, entry] of Object.entries(MILITARY_BLOCK_NAMESPACE)) {
    if (!entry.blockId || entry.blockId.endsWith('*')) continue; // RESERVED, no Block yet
    const def = DEPARTURE_BLOCK_MAP[entry.blockId];
    assert.ok(def, `${m} claims Block ${entry.blockId}, which does not exist`);
    claimed.set(entry.blockId, entry);
    if (def.target.kind === 'military') {
      assert.equal(`military.${def.target.field}`, entry.field, `${m}/${entry.blockId} writes a different field than the table says`);
    }
  }
  for (const role of ATC_ROLES) {
    for (const [id, def] of Object.entries(BLOCK_MAPS[role])) {
      if (def.target.kind !== 'military') continue;
      assert.ok(claimed.has(id), `${role}/${id} is a military Block with no MILITARY_BLOCK_NAMESPACE entry`);
    }
  }
});

test('every field the namespace table calls RESERVED or deferred is one setMilitary refuses to write', () => {
  // §12's rule is that a deferral leaves its fields present and unpopulated.
  // The failure mode is a deferred field quietly becoming writable because a
  // setter merged a patch it did not check — so the table and the setter's
  // allow-list are held against each other here rather than in a comment.
  for (const [m, entry] of Object.entries(MILITARY_BLOCK_NAMESPACE)) {
    if (!entry.field.startsWith('military.')) continue;
    const key = entry.field.slice('military.'.length);
    const hasBlock = !!entry.blockId && !entry.blockId.endsWith('*');
    if (hasBlock) {
      assert.ok(MILITARY_WRITABLE_FIELDS.has(key), `${m}: ${entry.field} has Block ${entry.blockId} but setMilitary will not write it`);
    } else if (key !== 'alertStatus') {
      // alertStatus is the one deliberate middle case — validated by the
      // setter, no Block until §9.6 picks one. Everything else with no Block
      // must be unwritable outright.
      assert.equal(MILITARY_WRITABLE_FIELDS.has(key), false, `${m}: ${entry.field} has no Block but setMilitary would write it`);
    }
    assert.ok(key in defaultMilitary(), `${m}: ${entry.field} is not seeded on a new FDR (§12 wants it present, not absent)`);
  }
});

test('no military Block is tagged as a MARSA interlock', () => {
  // §9.2 rule 2 is about ATC ISSUING a course or an altitude. Declaring an
  // ordnance state or a hook requirement issues nothing, and tagging one would
  // void a live AR every time a pilot reported a hung store.
  for (const role of ATC_ROLES) {
    for (const [id, def] of Object.entries(BLOCK_MAPS[role])) {
      if (def.target.kind === 'military') assert.equal(interlockFor(role, id), null, `${role}/${id}`);
    }
  }
});
