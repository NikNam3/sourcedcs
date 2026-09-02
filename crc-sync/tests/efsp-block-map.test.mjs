import { test } from 'node:test';
import assert from 'node:assert/strict';

const { DEPARTURE_BLOCK_MAP, ARRIVAL_BLOCK_MAP, isValidRole, requiredBlocksFor, resolveBlockTarget, validateFacilityConfig } =
  await import('../src/efsp/block-map.js');

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

test('requiredBlocksFor returns an empty array for an unknown/unbuilt role', () => {
  assert.deepEqual(requiredBlocksFor('OVERFLIGHT'), []); // not built in Phase 2
  assert.deepEqual(requiredBlocksFor('NOT_A_ROLE'), []);
});

test('isValidRole is true for DEPARTURE and ARRIVAL, false for anything else', () => {
  assert.equal(isValidRole('DEPARTURE'), true);
  assert.equal(isValidRole('ARRIVAL'), true);
  assert.equal(isValidRole('OVERFLIGHT'), false);
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

test('resolveBlockTarget returns null for an unbuilt role entirely', () => {
  assert.equal(resolveBlockTarget('OVERFLIGHT', '1'), null);
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
