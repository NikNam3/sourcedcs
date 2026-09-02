'use strict';

/* Unit tests for the pure Block Map binding/resolution logic in
   strip-template.js — no DOM involved, matching los-math.test.js's style. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEPARTURE_BLOCK_MAP, ARRIVAL_BLOCK_MAP, resolveBlockValue, requiredBlocksFor, formatBlock3,
  activeAnnotationValue, hasActiveAnnotationEntry, isBlockEditable, CONFIRM_VACATED_ELIGIBLE_BLOCKS,
} = require('../app/public/js/panels/efsp/strip-template.js');

const REQUIRED_DEPARTURE_BLOCKS = [
  '1', '2', '3', '4', '4B', '5', '6', '7', '8', '8A', '8B', '9', '9D', '9E',
  '10', '11', '14', '18', '24', '25', '26',
];

const REQUIRED_ARRIVAL_BLOCKS = [
  '1', '2', '3', '4', '4B', '5', '6', '7', '8', '8B', '9', '9A-FUEL', '9E', '24', '25', '26',
];

function makeFdr(overrides = {}) {
  return {
    identity: { callsign: 'VIPER1', flightSize: 1, wakeCategory: 'D', aircraftType: 'F16', equipmentSuffix: 'GR', degradation: 'NONE', beaconAssigned: '1234', ...overrides.identity },
    filed: { route: 'DCT', requestedAltitude: '250', departureAirport: 'LTAG', destinationAirport: 'LTAC', proposedDepartureTimeUtc: null, fullRouteClearance: false, remarks: '' , ...overrides.filed },
    assigned: { datalinkClearanceIndicator: 'NONE', atisCode: null, releaseTimeUtc: null, takeoffTimeUtc: null, ...overrides.assigned },
    provenance: { ...overrides.provenance },
  };
}

function makeStrip(overrides = {}) {
  return { rev: 3, cid: '007', state: 'PROPOSED', flags: { removeIndicator: false }, annotations: {}, ...overrides };
}

test('requiredBlocksFor matches exactly the guide §6.2 ✱-marked blocks (client copy matches server copy)', () => {
  assert.deepEqual(requiredBlocksFor().sort(), [...REQUIRED_DEPARTURE_BLOCKS].sort());
});

test('every Block ID in the client Block Map exists in the server\'s too, by construction of the shared fixture shape (same required flags)', () => {
  // This doesn't import crc-sync (separate deployable packages, ADR 0001) —
  // it asserts the client's own copy is internally consistent, which is
  // the half of "kept in sync" this test suite can actually check.
  for (const [id, def] of Object.entries(DEPARTURE_BLOCK_MAP)) {
    assert.equal(typeof def.required, 'boolean', id);
    assert.ok(def.target && typeof def.target.kind === 'string', id);
  }
});

test('resolveBlockValue reads fdr-bound Blocks from the exact field path', () => {
  const fdr = makeFdr();
  assert.deepEqual(resolveBlockValue('1', fdr, makeStrip()), { value: 'VIPER1', provenance: 'CONTROLLER_ENTERED' });
  assert.deepEqual(resolveBlockValue('5', fdr, makeStrip()), { value: '1234', provenance: 'CONTROLLER_ENTERED' });
});

test('resolveBlockValue uses the FDR\'s own provenance map when present, overriding the Block Map default', () => {
  const fdr = makeFdr({ provenance: { 'identity.callsign': 'UPSTREAM_ATO' } });
  assert.equal(resolveBlockValue('1', fdr, makeStrip()).provenance, 'UPSTREAM_ATO');
});

test('resolveBlockValue on Block 9 defaults to COMPUTER_GENERATED provenance when the FDR carries none for it', () => {
  const fdr = makeFdr();
  assert.equal(resolveBlockValue('9', fdr, makeStrip()).provenance, 'COMPUTER_GENERATED');
});

test('resolveBlockValue on an fdr-bound Block with a null fdr returns {value:null}, not a throw', () => {
  assert.deepEqual(resolveBlockValue('1', null, makeStrip()), { value: null, provenance: 'CONTROLLER_ENTERED' });
});

test('resolveBlockValue on system Blocks reads directly off the Strip (rev, cid, state)', () => {
  const strip = makeStrip({ rev: 9, cid: '042', state: 'CLEARED' });
  assert.deepEqual(resolveBlockValue('2', null, strip), { value: 9, provenance: 'SYSTEM_DERIVED' });
  assert.deepEqual(resolveBlockValue('4', null, strip), { value: '042', provenance: 'SYSTEM_DERIVED' });
  assert.deepEqual(resolveBlockValue('25', null, strip), { value: 'CLEARED', provenance: 'SYSTEM_DERIVED' });
});

test('resolveBlockValue on the flag Block 4A reads strip.flags.removeIndicator', () => {
  const strip = makeStrip({ flags: { removeIndicator: true } });
  assert.equal(resolveBlockValue('4A', null, strip).value, true);
});

test('resolveBlockValue on the NLA Block 26 always returns a null value — the label comes from efsp-nla.js, not stored state', () => {
  assert.equal(resolveBlockValue('26', makeFdr(), makeStrip()).value, null);
});

test('resolveBlockValue on annotation Blocks returns the currently-ACTIVE entry\'s value, not a superseded one', () => {
  const strip = makeStrip({
    annotations: {
      '11': { blockId: '11', entries: [
        { value: '250', status: 'SUPERSEDED' },
        { value: '270', status: 'ACTIVE' },
      ] },
    },
  });
  assert.equal(resolveBlockValue('11', null, strip).value, '270');
});

test('resolveBlockValue on an annotation Block with no entries yet returns null', () => {
  assert.equal(resolveBlockValue('11', null, makeStrip()).value, null);
});

test('resolveBlockValue returns null for an unknown Block ID rather than throwing', () => {
  assert.deepEqual(resolveBlockValue('ZZZ', makeFdr(), makeStrip()), { value: null, provenance: 'SYSTEM_DERIVED' });
});

test('every required Block resolves to a non-undefined value given a complete fixture FDR/Strip', () => {
  const fdr = makeFdr();
  const strip = makeStrip();
  for (const id of REQUIRED_DEPARTURE_BLOCKS) {
    const result = resolveBlockValue(id, fdr, strip);
    assert.notEqual(result.value, undefined, id);
  }
});

// ── activeAnnotationValue ────────────────────────────────────────────────

test('activeAnnotationValue returns null for a Strip with no annotations object populated at all', () => {
  assert.equal(activeAnnotationValue({}, '11'), null);
});

// ── hasActiveAnnotationEntry / CONFIRM_VACATED_ELIGIBLE_BLOCKS ─────────────

test('hasActiveAnnotationEntry is false for a Strip with no annotations at all', () => {
  assert.equal(hasActiveAnnotationEntry({}, '21'), false);
});

test('hasActiveAnnotationEntry is true when an ACTIVE entry exists, false once it\'s STRUCK', () => {
  const active = makeStrip({ annotations: { '21': { blockId: '21', entries: [{ value: '90', status: 'ACTIVE' }] } } });
  assert.equal(hasActiveAnnotationEntry(active, '21'), true);

  const struck = makeStrip({ annotations: { '21': { blockId: '21', entries: [{ value: '90', status: 'STRUCK' }] } } });
  assert.equal(hasActiveAnnotationEntry(struck, '21'), false);
});

test('DEPARTURE Block 21 (Initial altitude) is confirmVacated-eligible, per guide §3.7 rule 3', () => {
  assert.ok(CONFIRM_VACATED_ELIGIBLE_BLOCKS.DEPARTURE.includes('21'));
});

test('ARRIVAL Block 7 (assigned/cleared altitude) is confirmVacated-eligible', () => {
  assert.ok(CONFIRM_VACATED_ELIGIBLE_BLOCKS.ARRIVAL.includes('7'));
});

// ── formatBlock3 (composite) ─────────────────────────────────────────────

test('formatBlock3 renders count/wake/type/suffix, omitting count for a single-ship', () => {
  assert.equal(formatBlock3(makeFdr()), 'D/F16/GR');
});

test('formatBlock3 includes the flight count for a formation (flightSize > 1)', () => {
  const fdr = makeFdr({ identity: { flightSize: 2, wakeCategory: 'D', aircraftType: 'F16', equipmentSuffix: 'GR', degradation: 'NONE' } });
  assert.equal(formatBlock3(fdr), '2D/F16/GR');
});

test('formatBlock3 renders /H or /O for a degradation override, ignoring the stored equipmentSuffix entirely', () => {
  const transponderFailed = makeFdr({ identity: { flightSize: 1, wakeCategory: 'D', aircraftType: 'F16', equipmentSuffix: 'GR', degradation: 'TRANSPONDER_FAILED' } });
  assert.equal(formatBlock3(transponderFailed), 'D/F16/H');

  const modeCFailed = makeFdr({ identity: { flightSize: 1, wakeCategory: 'D', aircraftType: 'F16', equipmentSuffix: 'GR', degradation: 'MODE_C_FAILED' } });
  assert.equal(formatBlock3(modeCFailed), 'D/F16/O');
});

test('formatBlock3 with no equipmentSuffix and no degradation renders no suffix segment at all', () => {
  const fdr = makeFdr({ identity: { flightSize: 1, wakeCategory: 'D', aircraftType: 'F16', equipmentSuffix: '', degradation: 'NONE' } });
  assert.equal(formatBlock3(fdr), 'D/F16');
});

test('formatBlock3 with a null fdr returns an empty string, not a throw', () => {
  assert.equal(formatBlock3(null), '');
});

// ── isBlockEditable ──────────────────────────────────────────────────────

test('isBlockEditable is true for fdr-routed and annotation-routed Blocks', () => {
  for (const id of ['1', '5', '7', '8', '8A', '8B', '9', '9E', '11', '24']) {
    assert.equal(isBlockEditable(id), true, id);
  }
});

test('isBlockEditable is false for system/composite/flag/nla Blocks', () => {
  for (const id of ['2', '3', '4', '4A', '25', '26']) {
    assert.equal(isBlockEditable(id), false, id);
  }
});

test('isBlockEditable is false for an unknown Block ID', () => {
  assert.equal(isBlockEditable('ZZZ'), false);
});

// ── ARRIVAL_BLOCK_MAP (Phase 2, docs/adr/0008) ──────────────────────────

function makeArrivalFdr(overrides = {}) {
  return {
    identity: { callsign: 'REACH1', flightSize: 1, wakeCategory: 'D', aircraftType: 'C17', equipmentSuffix: 'GR', degradation: 'NONE', beaconAssigned: '5678', ...overrides.identity },
    filed: { route: 'DCT', originAirport: 'LTAG', arrivalFix: 'KADOX', estimatedArrivalTimeUtc: '1200', remarks: '', ...overrides.filed },
    assigned: { datalinkClearanceIndicator: 'NONE', landingRunway: null, ...overrides.assigned },
    provenance: { ...overrides.provenance },
  };
}

function makeArrivalStrip(overrides = {}) {
  return { rev: 1, cid: '001', role: 'ARRIVAL', state: 'INBOUND', flags: { removeIndicator: false }, annotations: {}, ...overrides };
}

test('requiredBlocksFor(ARRIVAL) matches ARRIVAL_BLOCK_MAP\'s required set', () => {
  assert.deepEqual(requiredBlocksFor('ARRIVAL').sort(), [...REQUIRED_ARRIVAL_BLOCKS].sort());
});

test('resolveBlockValue routes to ARRIVAL_BLOCK_MAP when strip.role is ARRIVAL', () => {
  const fdr = makeArrivalFdr();
  const strip = makeArrivalStrip();
  assert.deepEqual(resolveBlockValue('8', fdr, strip), { value: 'LTAG', provenance: 'CONTROLLER_ENTERED' });
});

test('resolveBlockValue on ARRIVAL Block 7 (assigned/cleared altitude) reads the annotation cell, not an fdr field — unlike DEPARTURE\'s Block 7', () => {
  const strip = makeArrivalStrip({
    annotations: { '7': { blockId: '7', entries: [{ value: '4000', status: 'ACTIVE' }] } },
  });
  assert.equal(resolveBlockValue('7', makeArrivalFdr(), strip).value, '4000');
});

test('resolveBlockValue on a DEPARTURE Strip (no role, or role:DEPARTURE) still reads Block 7 from the fdr, unaffected by ARRIVAL\'s remapping', () => {
  const fdr = { identity: {}, filed: { requestedAltitude: '250' }, assigned: {}, provenance: {} };
  assert.equal(resolveBlockValue('7', fdr, makeStrip()).value, '250');
});

test('isBlockEditable is role-aware: ARRIVAL Block 7 is editable (annotation-routed), DEPARTURE Block 7 is also editable (fdr-routed) — same Block ID, both editable, different mechanism', () => {
  assert.equal(isBlockEditable('7', 'ARRIVAL'), true);
  assert.equal(isBlockEditable('7', 'DEPARTURE'), true);
});

test('isBlockEditable defaults to DEPARTURE when no role is given', () => {
  assert.equal(isBlockEditable('9D'), true); // DEPARTURE-only Block, not in ARRIVAL_BLOCK_MAP at all
  assert.equal(isBlockEditable('9D', 'ARRIVAL'), false);
});

test('every required ARRIVAL Block exists in ARRIVAL_BLOCK_MAP', () => {
  for (const id of REQUIRED_ARRIVAL_BLOCKS) assert.ok(ARRIVAL_BLOCK_MAP[id], id);
});
