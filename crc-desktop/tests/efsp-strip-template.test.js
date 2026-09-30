'use strict';

/* Unit tests for the pure Block Map binding/resolution logic in
   strip-template.js — no DOM involved, matching los-math.test.js's style. */

const test = require('node:test');
const assert = require('node:assert/strict');

// In the browser these are globals from their own <script>s; strip-template.js
// reads them at call time (docs/adr/0073). The stereo cache is swapped per test.
Object.assign(globalThis, require('../app/public/js/panels/efsp/time-chains.js'));
let _stereoCache = [];
globalThis.cachedStereoRoutesClient = () => _stereoCache;

const {
  DEPARTURE_BLOCK_MAP, ARRIVAL_BLOCK_MAP, OVERFLIGHT_BLOCK_MAP, MISSION_BLOCK_MAP, BLOCK_MAPS, resolveBlockValue, requiredBlocksFor, formatBlock3,
  activeAnnotationValue, hasActiveAnnotationEntry, annotationHistory, supersededAnnotationEntries,
  isBlockEditable, CONFIRM_VACATED_ELIGIBLE_BLOCKS,
  enumSelectOptionsFor, isBooleanToggleBlock, blockLabelFor,
  ZULU_HHMM_BLOCKS, formatZuluHhmm, blockTitleFor, isEnumBlockClearable, blockValueHintFor,
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
  // Block 24 (MIT RMKS) is a Strip annotation; 21 is the flight's clearance now.
  const active = makeStrip({ annotations: { '24': { blockId: '24', entries: [{ value: '90', status: 'ACTIVE' }] } } });
  assert.equal(hasActiveAnnotationEntry(active, '24'), true);

  const struck = makeStrip({ annotations: { '24': { blockId: '24', entries: [{ value: '90', status: 'STRUCK' }] } } });
  assert.equal(hasActiveAnnotationEntry(struck, '24'), false);
});

test('the assigned altitude and heading read their history from the FLIGHT, not the Strip (docs/adr/0058)', () => {
  const fdr = { fdrId: 'fX', clearance: {
    altitude: { entries: [{ value: '050', status: 'SUPERSEDED' }, { value: 'FL180', status: 'ACTIVE' }] },
    heading: { entries: [] },
  } };
  global.getEfspFdr = (id) => (id === 'fX' ? fdr : null);
  try {
    const strip = makeStrip({ fdrId: 'fX', annotations: { '21': { blockId: '21', entries: [{ value: 'stale', status: 'ACTIVE' }] } } });
    assert.equal(activeAnnotationValue(strip, '21'), 'FL180', 'a leftover Strip note is ignored');
    assert.equal(hasActiveAnnotationEntry(strip, '21'), true);
    assert.deepEqual(supersededAnnotationEntries(strip, '21').map(x => x.value), ['050']);
    assert.equal(resolveBlockValue('21', fdr, strip).value, 'FL180');
    assert.equal(hasActiveAnnotationEntry(strip, '20'), false);
  } finally {
    delete global.getEfspFdr;
  }
});

test('ALT is confirm-vacated on every Role that has one, and the filed altitude reads CRUS ALT', () => {
  assert.deepEqual(CONFIRM_VACATED_ELIGIBLE_BLOCKS, { DEPARTURE: ['21'], ARRIVAL: ['7'], OVERFLIGHT: ['7A'] });
  assert.equal(blockLabelFor('7', 'DEPARTURE'), 'CRUS ALT');
  assert.equal(blockLabelFor('7', 'OVERFLIGHT'), 'CRUS ALT');
  assert.equal(blockLabelFor('21', 'DEPARTURE'), 'ALT');
  assert.equal(blockLabelFor('7', 'ARRIVAL'), 'ALT');
  assert.equal(blockLabelFor('7A', 'OVERFLIGHT'), 'ALT');
  for (const [role, id] of [['DEPARTURE', '20'], ['ARRIVAL', '9A-VECTOR'], ['OVERFLIGHT', '9A-VECTOR']]) {
    assert.equal(blockLabelFor(id, role), 'HDG', `${role} ${id}`);
  }
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

test('resolveBlockValue on ARRIVAL Block 7 reads the flight\'s assigned altitude — unlike DEPARTURE\'s Block 7, the filed one', () => {
  const fdr = { ...makeArrivalFdr(), clearance: { altitude: { entries: [{ value: '4000', status: 'ACTIVE' }] }, heading: { entries: [] } } };
  assert.equal(resolveBlockValue('7', fdr, makeArrivalStrip()).value, '4000');
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

// ── MISSION_BLOCK_MAP (WP4A second slice) ────────────────────────────────

const REQUIRED_MISSION_BLOCKS = ['M1', 'M3', 'M4', 'M25', 'M26'];

function makeMissionFdr(overrides = {}) {
  return {
    identity: { callsign: 'EAGLE1', beaconAssigned: '4321', ...overrides.identity },
    filed: { remarks: '', ...overrides.filed },
    assigned: {},
    mission: { missionNumber: 'ALPHA01', packageId: 'PKG1', controllingAgency: 'AWACS', vulWindowStartUtc: null, vulWindowEndUtc: null, ...overrides.mission },
    provenance: {},
  };
}

function makeMissionStrip(overrides = {}) {
  return { rev: 1, cid: '001', role: 'MISSION', state: 'TASKED', flags: { removeIndicator: false }, annotations: {}, ...overrides };
}

test('requiredBlocksFor(MISSION) matches MISSION_BLOCK_MAP\'s required set', () => {
  assert.deepEqual(requiredBlocksFor('MISSION').sort(), [...REQUIRED_MISSION_BLOCKS].sort());
});

test('resolveBlockValue routes to MISSION_BLOCK_MAP when strip.role is MISSION, reusing identity.callsign/beaconAssigned', () => {
  const fdr = makeMissionFdr();
  const strip = makeMissionStrip();
  assert.equal(resolveBlockValue('M3', fdr, strip).value, 'EAGLE1');
  assert.equal(resolveBlockValue('M4', fdr, strip).value, '4321');
  assert.equal(resolveBlockValue('M1', fdr, strip).value, 'ALPHA01');
  assert.equal(resolveBlockValue('M2', fdr, strip).value, 'PKG1');
  assert.equal(resolveBlockValue('M5', fdr, strip).value, 'AWACS');
});

test('every required MISSION Block exists in MISSION_BLOCK_MAP', () => {
  for (const id of REQUIRED_MISSION_BLOCKS) assert.ok(MISSION_BLOCK_MAP[id], id);
});

test('MISSION has no FAA-numbered Blocks — its namespace is entirely M-prefixed', () => {
  for (const id of ['1', '2', '3', '4', '5', '8', '9', '24']) {
    assert.equal(MISSION_BLOCK_MAP[id], undefined, id);
  }
});

// ── WP4A gap-closure (docs/adr/0022) ────────────────────────────────────

test('resolveBlockValue on Block 24A (airspace owner) reads fdr.airspace.owner — previously fell through to the null catch-all even before it had an edit path', () => {
  const fdr = { identity: {}, filed: {}, assigned: {}, provenance: {}, airspace: { owner: 'USING_AGENCY' } };
  assert.deepEqual(resolveBlockValue('24A', fdr, makeStrip()), { value: 'USING_AGENCY', provenance: 'CONTROLLER_ENTERED' });
});

test('resolveBlockValue on Block 24A with no airspace decided yet returns null, not undefined or a throw', () => {
  const fdr = { identity: {}, filed: {}, assigned: {}, provenance: {}, airspace: { owner: null } };
  assert.equal(resolveBlockValue('24A', fdr, makeStrip()).value, null);
});

test('resolveBlockValue on Block 5A (track-degradation) reads identity.trackDegradationFlag via the plain fdr path', () => {
  const fdr = { identity: { trackDegradationFlag: 'CST' }, filed: {}, assigned: {}, provenance: {} };
  assert.equal(resolveBlockValue('5A', fdr, makeStrip()).value, 'CST');
});

test('enumSelectOptionsFor returns the picker options for 5A, 24A, RSVC and SREG, null for an ordinary Block', () => {
  assert.deepEqual(enumSelectOptionsFor('5A'), ['NONE', 'CST', 'FAIL', 'IF', 'NT', 'TRK']);
  assert.deepEqual(enumSelectOptionsFor('24A'), ['CONTROLLING_AGENCY', 'USING_AGENCY']);
  assert.deepEqual(enumSelectOptionsFor('RSVC'), ['ACTIVE', 'TERMINATED']);
  assert.deepEqual(enumSelectOptionsFor('SREG'), ['ATC', 'MARSA', 'USING_AGENCY', 'DUE_REGARD', 'SEE_AND_AVOID']);
  assert.equal(enumSelectOptionsFor('1'), null);
});

test('5A is plain fdr-routed (isBlockEditable true) but 24A/RSVC/SREG stay excluded from the generic free-text path — all still get the enum-select widget via enumSelectOptionsFor, checked ahead of isBlockEditable in bay-view.js', () => {
  assert.equal(isBlockEditable('5A', 'DEPARTURE'), true);
  assert.equal(isBlockEditable('24A', 'DEPARTURE'), false);
  assert.equal(isBlockEditable('RSVC', 'DEPARTURE'), false);
  assert.equal(isBlockEditable('SREG', 'DEPARTURE'), false);
});

// ── WP4A second slice, §4.6.3 — the three-field separation model ────────

test('resolveBlockValue on IFR/RSVC/SREG reads the corresponding fdr.tofi field', () => {
  const fdr = { identity: {}, filed: {}, assigned: {}, provenance: {}, tofi: { ifrActive: true, radarService: 'ACTIVE', separationRegime: 'MARSA' } };
  assert.equal(resolveBlockValue('IFR', fdr, makeStrip()).value, true);
  assert.equal(resolveBlockValue('RSVC', fdr, makeStrip()).value, 'ACTIVE');
  assert.equal(resolveBlockValue('SREG', fdr, makeStrip()).value, 'MARSA');
});

test('resolveBlockValue on IFR/RSVC/SREG with no fdr.tofi at all returns null, not a throw', () => {
  const fdr = { identity: {}, filed: {}, assigned: {}, provenance: {} };
  assert.equal(resolveBlockValue('IFR', fdr, makeStrip()).value, null);
  assert.equal(resolveBlockValue('RSVC', fdr, makeStrip()).value, null);
});

test('IFR is neither a free-text-editable Block nor an enum-select Block — it gets the boolean-toggle affordance instead', () => {
  assert.equal(isBlockEditable('IFR', 'DEPARTURE'), false);
  assert.equal(enumSelectOptionsFor('IFR'), null);
  assert.equal(isBooleanToggleBlock('IFR'), true);
  assert.equal(isBooleanToggleBlock('RSVC'), false);
  assert.equal(isBooleanToggleBlock('1'), false);
});

// ── docs/adr/0024 — every Block Map entry has a short display label ────

test('every entry in every Block Map has a non-empty label of 8 characters or fewer', () => {
  for (const [role, map] of Object.entries(BLOCK_MAPS)) {
    for (const [blockId, def] of Object.entries(map)) {
      assert.ok(typeof def.label === 'string' && def.label.length > 0, `${role} Block ${blockId} is missing a label`);
      assert.ok(def.label.length <= 8, `${role} Block ${blockId}'s label "${def.label}" is longer than 8 characters`);
    }
  }
});

test('blockLabelFor looks up a Block\'s label per role, and returns null for a Block that role has no entry for', () => {
  assert.equal(blockLabelFor('5', 'DEPARTURE'), 'SQUAWK');
  assert.equal(blockLabelFor('8', 'ARRIVAL'), 'ORIG');
  assert.equal(blockLabelFor('8A', 'OVERFLIGHT'), null);
});

// ── §9.10 Block 9F, the stereo route name (docs/adr/0050) ────────────────

test('Block 9F is labelled STEREO and bound to filed.stereoRouteName on DEPARTURE', () => {
  assert.equal(blockLabelFor('9F', 'DEPARTURE'), 'STEREO');
  assert.equal(DEPARTURE_BLOCK_MAP['9F'].target.path, 'filed.stereoRouteName');
  assert.ok(blockLabelFor('9F', 'DEPARTURE').length <= 8, 'docs/adr/0024 caps a Block label at 8 characters');
});

test('resolveBlockValue reads the stereo name off the FDR', () => {
  const fdr = { filed: { stereoRouteName: 'PACK 1' }, provenance: { 'filed.stereoRouteName': 'COMPUTER_GENERATED' } };
  const resolved = resolveBlockValue('9F', fdr, makeStrip());
  assert.equal(resolved.value, 'PACK 1');
  assert.equal(resolved.provenance, 'COMPUTER_GENERATED');
});

test('a flight filed without a stereo renders Block 9F as blank, not as a broken cell', () => {
  // The common case by a wide margin — most flights are not on a canned
  // route, and the shipped table is empty. An unset name reads as the empty
  // string exactly like filed.route and filed.remarks do, because 9F is
  // plain fdr-routed; a Strip restored from a board persisted before 9F
  // existed has no key at all, and reads as null.
  assert.equal(resolveBlockValue('9F', { filed: { stereoRouteName: '' }, provenance: {} }, makeStrip()).value, '');
  assert.equal(resolveBlockValue('9F', { filed: {}, provenance: {} }, makeStrip()).value, null);
  assert.equal(resolveBlockValue('9F', null, makeStrip()).value, null);
});

test('9F is a select of the configured stereo routes, never free text', () => {
  // docs/adr/0073 replaces 0050's free text: the options are the last list
  // crc-sync returned, in table order, and a pick re-files exactly as typing
  // the name did (the server path is unchanged).
  _stereoCache = [{ name: 'PACK 1', route: 'A' }, { name: 'PACK 2', route: 'B', description: 'south' }];
  try {
    assert.deepEqual(enumSelectOptionsFor('9F', makeFdr()), ['PACK 1', 'PACK 2']);
    assert.deepEqual(enumSelectOptionsFor('9F'), ['PACK 1', 'PACK 2'], 'no FDR is no current route, not a throw');
    assert.equal(isBlockEditable('9F', 'DEPARTURE'), true);
    assert.equal(isEnumBlockClearable('9F'), true, '"—" clears the label and keeps the route (0050)');
    assert.equal(isBooleanToggleBlock('9F'), false);
    // T3: a route retired since the flight filed stays on it and selected.
    assert.deepEqual(enumSelectOptionsFor('9F', makeFdr({ filed: { stereoRouteName: 'PACK 9' } })), ['PACK 1', 'PACK 2', 'PACK 9']);
    assert.deepEqual(enumSelectOptionsFor('9F', makeFdr({ filed: { stereoRouteName: 'PACK 2' } })), ['PACK 1', 'PACK 2']);
    // An inactive record (never sent today, but the flag exists) is not offered.
    _stereoCache = [{ name: 'PACK 1', route: 'A' }, { name: 'OLD', route: 'C', active: false }];
    assert.deepEqual(enumSelectOptionsFor('9F', makeFdr()), ['PACK 1']);
  } finally { _stereoCache = []; }
});

test('9F with no route table is a plain cell, never a control that cannot act (T1)', () => {
  _stereoCache = [];
  assert.equal(enumSelectOptionsFor('9F', makeFdr()), null);
  assert.equal(isBlockEditable('9F', 'DEPARTURE'), false, 'null options with an editable 9F would fall back to free text');
  assert.deepEqual(blockValueHintFor('9F', makeFdr(), makeStrip()), { title: 'no stereo routes configured', estimated: false });
  // A flight already on a stereo can still have it cleared.
  assert.deepEqual(enumSelectOptionsFor('9F', makeFdr({ filed: { stereoRouteName: 'PACK 1' } })), ['PACK 1']);
  assert.equal(blockValueHintFor('9F', makeFdr({ filed: { stereoRouteName: 'PACK 1' } }), makeStrip()), null);
});

// ── §3.7 history, the half that never reached the DOM ────────────────────

const e = (value, status) => ({ value, status, at: 1, by: 'c-OPS' });
// Block 24 (MIT RMKS): an ordinary Strip annotation. 21 is the flight's clearance now.
const withCell = (entries) => ({ annotations: { 24: { blockId: '24', entries } } });

test('annotationHistory returns every entry in the order written', () => {
  const strip = withCell([e('2000', 'SUPERSEDED'), e('4000', 'STRUCK'), e('6000', 'ACTIVE')]);
  assert.deepEqual(annotationHistory(strip, '24').map(x => x.value), ['2000', '4000', '6000']);
  assert.deepEqual(annotationHistory(strip, '24').map(x => x.status), ['SUPERSEDED', 'STRUCK', 'ACTIVE']);
});

test('annotationHistory is [] for a Block never written, and for one that is not an annotation', () => {
  // [] rather than null, so no caller needs a null check to ask the question.
  assert.deepEqual(annotationHistory(withCell([]), '20'), []);
  assert.deepEqual(annotationHistory({ annotations: {} }, '24'), []);
  assert.deepEqual(annotationHistory({}, '24'), []);
  assert.deepEqual(annotationHistory(withCell([e('x', 'ACTIVE')]), '9'), [], 'Block 9 is fdr-routed');
});

test('supersededAnnotationEntries is everything the Block is no longer showing as current', () => {
  const strip = withCell([e('2000', 'SUPERSEDED'), e('4000', 'STRUCK'), e('5000', 'PREPLANNED'), e('6000', 'ACTIVE')]);
  assert.deepEqual(supersededAnnotationEntries(strip, '24').map(x => x.value), ['2000', '4000', '5000']);
  // PREPLANNED is carried through as its own status rather than folded into
  // SUPERSEDED — it is a distinct thing the server can produce and nothing has
  // ever rendered it.
  assert.equal(supersededAnnotationEntries(strip, '24')[2].status, 'PREPLANNED');
});

test('a Block with only an ACTIVE entry has no superseded entries', () => {
  assert.deepEqual(supersededAnnotationEntries(withCell([e('6000', 'ACTIVE')]), '24'), []);
});

// ── labels have to tell Blocks apart ─────────────────────────────────────

test('no two Blocks in a Role share a label', () => {
  // Surfaced the moment the expanded view started rendering the long tail: a
  // DEPARTURE Strip had FOUR fields labelled NOTE (2A, 19, 23, 24) and THREE
  // labelled RESTR (9A, 9B, 9C). All seven were writable and none of them said
  // what it was. They had never been rendered, so nobody had to read them.
  //
  // Several were not merely ambiguous but wrong against guide §6.2: 2A is the
  // Voice Clearance Issued checkbox, 19 is Gate/parking, 23 is Facility
  // remarks, 24 is Miles/minutes-in-trail, and 9A-9C are "facility use", not
  // altitude restrictions — those are Block 9's own manual half.
  for (const [role, map] of Object.entries(BLOCK_MAPS)) {
    const byLabel = {};
    for (const [id, def] of Object.entries(map)) {
      if (!def.label) continue;
      (byLabel[def.label] = byLabel[def.label] || []).push(id);
    }
    const dupes = Object.entries(byLabel).filter(([, ids]) => ids.length > 1);
    assert.deepEqual(dupes, [], `${role}: two Blocks cannot share one label`);
  }
});

test('every label fits the compact chip', () => {
  // strip-template.js's own header rule: 8 characters or fewer, so the compact
  // view never has to grow wider to fit one.
  for (const [role, map] of Object.entries(BLOCK_MAPS)) {
    for (const [id, def] of Object.entries(map)) {
      if (!def.label) continue;
      assert.ok(def.label.length <= 8, `${role}/${id}: label "${def.label}" is ${def.label.length} characters`);
    }
  }
});


// ── §9.4 MTR fields (crc-sync's docs/adr/0062) ──────────────────────────────

const MTR_LABELS = { '9G-MTR': 'MTR', '9G-ENTRY': 'ENTRY', '9G-TIME': 'ENTRY TM', '9H-EXIT': 'EXIT', '9H-TIME': 'EXIT EST', '9H-ALT': 'EXIT ALT' };
const MTR_ROLES = ['DEPARTURE', 'ARRIVAL', 'OVERFLIGHT'];

function mtrFdr(mtr) {
  return { ...makeFdr(), military: { ordnanceState: 'CLEAN', hookRequired: false, alertStatus: 'NONE', mtr } };
}

test('resolveBlockValue reads each MTR field, the two times as a four-digit Zulu time', () => {
  const fdr = mtrFdr({
    designator: 'IR107', entryFix: 'A', entryTimeUtc: Date.UTC(2016, 5, 21, 14, 5),
    exitFix: 'F', exitEstimateUtc: Date.UTC(2016, 5, 21, 14, 32), requestedAltitudeAfterExit: 'FL190',
  });
  const expected = { '9G-MTR': 'IR107', '9G-ENTRY': 'A', '9G-TIME': '1405', '9H-EXIT': 'F', '9H-TIME': '1432', '9H-ALT': 'FL190' };
  for (const role of MTR_ROLES) {
    for (const [id, value] of Object.entries(expected)) {
      assert.equal(resolveBlockValue(id, fdr, { role }).value, value, `${role}/${id}`);
    }
  }
});

test('an MTR Block on an FDR with military: null (or no time) renders blank, not a throw', () => {
  const fdr = { ...makeFdr(), military: null };
  for (const id of Object.keys(MTR_LABELS)) assert.equal(resolveBlockValue(id, fdr, { role: 'ARRIVAL' }).value, null, id);
  assert.equal(resolveBlockValue('9H-TIME', mtrFdr({ exitEstimateUtc: null }), { role: 'ARRIVAL' }).value, null);
});

test('the MTR labels are exactly the §9.4 set on every ATC Role', () => {
  for (const role of MTR_ROLES) {
    for (const [id, label] of Object.entries(MTR_LABELS)) assert.equal(blockLabelFor(id, role), label, `${role}/${id}`);
  }
});

test('the MTR Blocks are ordinary click-to-edit cells — no picker, no toggle', () => {
  for (const id of Object.keys(MTR_LABELS)) {
    assert.equal(enumSelectOptionsFor(id), null, id);
    assert.equal(isBooleanToggleBlock(id), false, id);
    for (const role of MTR_ROLES) assert.equal(isBlockEditable(id, role), true, `${role}/${id}`);
  }
});

test('ZULU_HHMM_BLOCKS holds the MTR times and every typed …TimeUtc Block (F4), and formatZuluHhmm pads', () => {
  assert.deepEqual([...ZULU_HHMM_BLOCKS].sort(), ['14', '14B', '14C', '14D', '16', '17', '18', '6', '9G-TIME', '9H-TIME', 'M6', 'M7']);
  assert.equal(formatZuluHhmm(Date.UTC(2016, 5, 21, 9, 5)), '0905');
  assert.equal(formatZuluHhmm(null), '');
  assert.equal(formatZuluHhmm('garbage'), '');
});

test('F4: every ZULU_HHMM Block is an epoch-ms …Utc FDR path on every role map that has it, and renders as HHMM', () => {
  for (const id of ZULU_HHMM_BLOCKS) {
    let seen = 0;
    for (const [role, map] of Object.entries(BLOCK_MAPS)) {
      if (!map[id]) continue;
      seen += 1;
      assert.equal(map[id].target.kind, 'fdr', `${role}/${id}`);
      assert.match(map[id].target.path, /Utc$/, `${role}/${id}`);
    }
    assert.ok(seen > 0, id);
  }
  const voidAt = Date.UTC(2016, 5, 21, 14, 32);
  const fdr = makeFdr({ assigned: { voidTimeUtc: voidAt, releaseTimeUtc: null } });
  assert.equal(resolveBlockValue('14D', fdr, makeStrip()).value, '1432');
  assert.equal(resolveBlockValue('14', fdr, makeStrip()).value, null, 'no time is blank, not 0000');
  const eta = makeFdr({ filed: { estimatedArrivalTimeUtc: Date.UTC(2016, 5, 21, 9, 5) } });
  assert.equal(resolveBlockValue('6', eta, makeStrip({ role: 'ARRIVAL' })).value, '0905');
});

test('every epoch time Block of every Role renders HHMM — the set is derived from the Block Maps (§11.2 rule 1)', () => {
  // Every fdr target path ending in Utc is an epoch time. A time Block added
  // to a map later without ZULU_HHMM_BLOCKS fails here, not on a Strip.
  const derived = new Set();
  for (const map of Object.values(BLOCK_MAPS)) {
    for (const [id, def] of Object.entries(map)) if (def.target.kind === 'fdr' && /Utc$/.test(def.target.path)) derived.add(id);
  }
  assert.deepEqual([...derived].sort(), [...ZULU_HHMM_BLOCKS].sort());
  const at = Date.UTC(2016, 5, 21, 14, 32);
  for (const [role, map] of Object.entries(BLOCK_MAPS)) {
    for (const [id, def] of Object.entries(map)) {
      if (!derived.has(id)) continue;
      const fdr = makeFdr();
      const parts = def.target.path.split('.');
      fdr[parts[0]] = { ...(fdr[parts[0]] || {}) };
      let o = fdr; for (const k of parts.slice(0, -1)) o = (o[k] = o[k] || {});
      o[parts[parts.length - 1]] = at;
      assert.equal(resolveBlockValue(id, fdr, makeStrip({ role })).value, '1432', `${role}/${id}`);
    }
  }
});

test('S-F4: a MISSION Strip reads its vul window as HHMM, and M6/M7 open for editing on it', () => {
  const fdr = makeFdr();
  fdr.mission = { vulWindowStartUtc: Date.UTC(2016, 5, 21, 22, 0), vulWindowEndUtc: Date.UTC(2016, 5, 22, 1, 30) };
  assert.equal(resolveBlockValue('M6', fdr, makeStrip({ role: 'MISSION' })).value, '2200');
  assert.equal(resolveBlockValue('M7', fdr, makeStrip({ role: 'MISSION' })).value, '0130');
  assert.equal(isBlockEditable('M6', 'MISSION'), true);
});

// ── §10.5 fallback chains on the Strip (docs/adr/0073) ────────────────────

const Z = (hh, mm) => Date.UTC(2016, 5, 21, hh, mm);

test('§10.5: departure, off-block and takeoff time each follow an explicit ordered fallback, and the chosen source is visible on hover', () => {
  // Only an ATO departure: P-time shows it, TAXI and TAKEOFF estimate from it.
  const fdr = makeFdr({ assigned: { taxiTimeUtc: null, takeoffTimeUtc: null } });
  fdr.ato = { departure: { timeUtc: Z(13, 10) } };
  const strip = makeStrip();
  const p = resolveBlockValue('6', fdr, strip);
  assert.deepEqual(p, { value: '1310', provenance: 'COMPUTER_GENERATED', timeSource: 'ATO', estimated: false });
  assert.match(blockTitleFor('6', fdr, strip), /1310Z from the ATO/);
  for (const id of ['17', '18']) {
    const v = resolveBlockValue(id, fdr, strip);
    assert.equal(v.value, '1310', id);
    assert.equal(v.estimated, true, id);
    assert.equal(blockValueHintFor(id, fdr, strip).estimated, true, id);
  }
  assert.match(blockTitleFor('17', fdr, strip), /~1310Z estimate: P-time, from the ATO/);
  assert.match(blockTitleFor('18', fdr, strip), /~1310Z estimate: off-block, estimate: P-time/);

  // A controller types TAKEOFF 1402: an actual, no italics, and the hover says so.
  fdr.assigned.takeoffTimeUtc = Z(14, 2);
  fdr.provenance = { 'assigned.takeoffTimeUtc': 'CONTROLLER_ENTERED' };
  const tko = resolveBlockValue('18', fdr, strip);
  assert.deepEqual(tko, { value: '1402', provenance: 'CONTROLLER_ENTERED', timeSource: 'CONTROLLER', estimated: false });
  const hover = blockValueHintFor('18', fdr, strip);
  assert.equal(hover.estimated, false);
  assert.match(hover.title, /1402Z entered by a controller/);
  assert.match(hover.title, /if cleared: estimate: off-block, estimate: P-time, 1310Z/);

  // Cleared (the server stores null): the estimate is back.
  fdr.assigned.takeoffTimeUtc = null;
  assert.equal(resolveBlockValue('18', fdr, strip).estimated, true);
});

test('§10.5: the chains are DEPARTURE-only — an ARRIVAL Block 6 is the ETA, shown as stored', () => {
  const fdr = makeFdr({ filed: { estimatedArrivalTimeUtc: Z(9, 5) } });
  fdr.ato = { departure: { timeUtc: Z(13, 10) } };
  const arrival = makeStrip({ role: 'ARRIVAL' });
  assert.deepEqual(resolveBlockValue('6', fdr, arrival), { value: '0905', provenance: 'CONTROLLER_ENTERED' });
  assert.equal(blockTitleFor('6', fdr, arrival), null);
  assert.equal(blockValueHintFor('6', fdr, arrival), null);
  // And the collapsed face's label, which strip-view.js titles with the FDR
  // alone, gets no chain title — it cannot tell a P-time from an ETA.
  assert.equal(blockTitleFor('6', fdr), null);
});

test('§10.5: with no source at all a time Block is blank, and says so on hover', () => {
  const fdr = makeFdr();
  assert.equal(resolveBlockValue('6', fdr, makeStrip()).value, null);
  assert.match(blockValueHintFor('17', fdr, makeStrip()).title, /no time from any source/);
});

test('every MTR Block has a label title; others have none', () => {
  for (const id of Object.keys(MTR_LABELS)) assert.ok(blockTitleFor(id, null), id);
  assert.equal(blockTitleFor('9', null), null);
});
