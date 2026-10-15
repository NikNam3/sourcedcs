import test from 'node:test';
import assert from 'node:assert/strict';

/* The carrier strip types wired through the shared tables (docs/adr/0074, WP7A part 2):
 * STATES_BY_STRIP_TYPE, the Block Maps, INELIGIBLE_STATES, permission.js, the CARRIER
 * Facility. Every assertion here is a decision that used to be a default. */

const nla = await import('../src/efsp/nla.js');
const permission = await import('../src/efsp/permission.js');
const classPermission = (await import('./helpers/permission.mjs')).classPermission();
const blockMap = await import('../src/efsp/block-map.js');
const facilityConfig = (await import('../src/efsp/facility-config.js')).createFacilityConfig();
const { INELIGIBLE_STATES, CorrelationReconciler } = await import('../src/efsp/correlation-reconciler.js');

const CARRIER_STRIP_TYPES = ['MARSHAL', 'FINAL', 'PATTERN'];
const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);

test('the three carrier strip types have states, owners, a Block Map and an NLA table', () => {
  for (const stripType of CARRIER_STRIP_TYPES) {
    assert.ok(nla.STATES_BY_STRIP_TYPE[stripType], `${stripType} states`);
    assert.ok(nla.isValidState(nla.STATES_BY_STRIP_TYPE[stripType][0], stripType));
    assert.ok(blockMap.isValidStripType(stripType));
    assert.ok(permission.STATE_OWNERS_BY_STRIP_TYPE[stripType], `${stripType} owners`);
    // The trap: an unregistered strip type falls back to the DEPARTURE table and would offer "Send to Clearance".
    const first = nla.STATES_BY_STRIP_TYPE[stripType][0];
    const r = nla.computeNla({ stripType, state: first }, null, NOW, {});
    assert.ok(!r || r.inhibited || !['PENDING_CLEARANCE'].includes(r.toState), `${stripType} must not use DEPARTURE's NLA`);
  }
});

test('no carrier state name collides with another strip type\'s state, except DROPPED', () => {
  const others = new Set();
  for (const [stripType, states] of Object.entries(nla.STATES_BY_STRIP_TYPE)) if (!CARRIER_STRIP_TYPES.includes(stripType)) states.forEach(s => others.add(s));
  const seen = new Set();
  for (const stripType of CARRIER_STRIP_TYPES) {
    for (const s of nla.STATES_BY_STRIP_TYPE[stripType]) {
      if (s === 'DROPPED') continue;
      assert.ok(!others.has(s), `${stripType}/${s} collides with a non-carrier state`);
      assert.ok(!seen.has(s), `${stripType}/${s} collides with another carrier strip type`);
      seen.add(s);
    }
  }
  assert.ok(!nla.MARSHAL_STATES.includes('FINAL') && !nla.FINAL_STATES.includes('FINAL'), 'FINAL is an ARRIVAL state');
});

// "a test forces this decision": EVERY state of EVERY strip type carries an explicit
// eligibility expectation here, so a state added to STATES_BY_STRIP_TYPE fails this
// test until somebody decides (docs/adr/0041, and the reconciler's own comment).
const ELIGIBILITY = {
  PROPOSED: false, PENDING_CLEARANCE: false, CLEARED: false, HELD: false, TASKED: false, DROPPED: false,
  PUSHBACK: true, TAXI: true, RUNWAY_QUEUE: true, LUAW: true, DEPARTED: true, HANDED_OFF: true,
  INBOUND: true, HANDED_TO_TOWER: true, TRAFFIC_PATTERN: true, FINAL: true, LANDED: true, TAXI_IN: true,
  IN_SECTOR: true, AIRBORNE: true, ON_STATION: true, OFF_STATION: true, RTB: true,
  // carrier (docs/adr/0074): all eligible, LAUNCH included (correlation reads the track store, not illumination)
  LAUNCH: true, IN_STACK: true, COMMENCED: true, ON_FINAL: true, BALL: true, BOLTER_WAVEOFF: true, IN_PATTERN: true, RECOVERED: true,
};
test('every state of every strip type has an explicit correlation-eligibility decision, and the list agrees', () => {
  for (const [stripType, states] of Object.entries(nla.STATES_BY_STRIP_TYPE)) {
    for (const s of states) {
      assert.ok(Object.prototype.hasOwnProperty.call(ELIGIBILITY, s), `${stripType}/${s}: no eligibility decision — add it to INELIGIBLE_STATES or to this table as eligible`);
      assert.equal(CorrelationReconciler.isEligible([{ state: s }]), ELIGIBILITY[s], `${stripType}/${s}`);
      assert.equal(INELIGIBLE_STATES.has(s), !ELIGIBILITY[s], `${stripType}/${s}`);
    }
  }
});

test('Block Maps: derived Blocks are not writable by SetBlock; carrier Blocks route to the flight; FINAL has only the talk-down\'s HDG and ALT (docs/adr/0117)', () => {
  for (const id of ['C3', 'C5', 'C6', 'C7', 'C8', 'C9']) assert.equal(blockMap.resolveBlockTarget('MARSHAL', id), null, id);
  for (const [id, field] of [['C4', 'approachType'], ['C10', 'approachButton'], ['C12', 'lowStateLb'], ['C13', 'bingoField'], ['C14', 'bingoFuelLb'], ['C15', 'eeatUtc']]) {
    assert.deepEqual(blockMap.resolveBlockTarget('MARSHAL', id), { kind: 'carrier', field });
  }
  // ...and the flight's remarks, which every strip type carries (H138 U2).
  const remarks = { kind: 'flightData', path: 'filed.remarks' };
  const writable = { '7A': { kind: 'clearance', field: 'altitude' }, '9A-VECTOR': { kind: 'clearance', field: 'heading' }, '9E': remarks };
  for (const [id, def] of Object.entries(blockMap.FINAL_BLOCK_MAP)) {
    assert.deepEqual(blockMap.resolveBlockTarget('FINAL', id), writable[id] || null, `FINAL/${id}`);
    if (id !== '9E') assert.ok(!['flightData', 'annotation'].includes(def.target.kind), id);
  }
  assert.ok(blockMap.resolveBlockTarget('PATTERN', 'C24'));
  for (const type of ['MARSHAL', 'FINAL', 'PATTERN']) assert.deepEqual(blockMap.resolveBlockTarget(type, '9E'), remarks, type);
});

test('permissions: only the Marshal creates, only as MARSHAL; no CV Position proposes a coordination, TOFIs or converts (the Marshal answers a HANDOFF, docs/adr/0101)', () => {
  assert.equal(classPermission.canMutate('CV_MARSHAL', 'CreateStrip'), true);
  assert.equal(permission.canCreateStripType('CV_MARSHAL', 'MARSHAL'), true);
  assert.equal(permission.canCreateStripType('CV_MARSHAL', 'FINAL'), false);
  assert.equal(permission.canCreateStripType('CV_MARSHAL', 'PATTERN'), false);
  for (const p of ['CV_PRIFLY', 'CV_APP1', 'CV_APP2']) assert.equal(classPermission.canMutate(p, 'CreateStrip'), false, p);
  for (const p of ['CV_MARSHAL', 'CV_PRIFLY', 'CV_APP1', 'CV_APP2']) {
    // The Marshal alone holds HANDOFF and ControlRelease, and only their receiving actions (DR-3).
    const held = p === 'CV_MARSHAL' ? ['HANDOFF', 'ControlRelease'] : [];
    for (const k of [...permission.COORDINATION_OP_KINDS, 'ControlRelease', 'TOFI', 'ConvertToArrival', 'ApproveAirspaceEntry', 'ClearAirspaceEntry']) {
      assert.equal(classPermission.canMutate(p, k), held.includes(k), `${p}/${k}`);
    }
    assert.equal(classPermission.canMutateAction(p, 'HANDOFF', 'PROPOSE'), false, `${p} never proposes`);
    assert.equal(classPermission.canMutateAction(p, 'HANDOFF', 'CANCEL'), false, `${p} never cancels`);
    assert.equal(classPermission.canMutateAction(p, 'HANDOFF', 'ACCEPT'), p === 'CV_MARSHAL');
    assert.equal(classPermission.canMutateAction(p, 'ControlRelease', 'GRANT'), false);
    assert.equal(classPermission.canMutateAction(p, 'ControlRelease', 'REQUEST'), p === 'CV_MARSHAL');
    assert.equal(classPermission.canMutate(p, 'TransferStrip'), true);
  }
});

test('ship-level predicates take exactly one Position (D21)', () => {
  assert.equal(permission.canEditCarrierState.length, 1);
  assert.equal(permission.canSequenceMarshalStack.length, 1);
  // the carrier management panel (decisions H119): PriFly and the Marshal edit it, the lanes read
  assert.equal(permission.canEditCarrierState('CV_PRIFLY'), true);
  assert.equal(permission.canEditCarrierState('CV_MARSHAL'), true);
  assert.equal(permission.canEditCarrierState('CV_APP1'), false);
  assert.equal(permission.canEditCarrierState('CV_APP2'), false);
  assert.equal(permission.canSequenceMarshalStack('CV_MARSHAL'), true);
  assert.equal(permission.canSequenceMarshalStack('CV_PRIFLY'), false);
  assert.equal(permission.canRecordCarrierHandoff('CV_MARSHAL', 'MARSHAL_TO_APPROACH'), true);
  assert.equal(permission.canRecordCarrierHandoff('CV_APP1', 'MARSHAL_TO_APPROACH'), false);
  assert.equal(permission.canRecordCarrierHandoff('CV_APP2', 'FINAL_TO_LSO'), true);
  assert.equal(permission.canRecordCarrierHandoff('CV_MARSHAL', 'nonsense'), false);
  // a Position of another Facility has none of them
  assert.equal(permission.canEditCarrierState('LC'), false);
});

test('state authority: Marshal to Commence, lane to the end of the approach, PriFly the pattern', () => {
  assert.equal(permission.canActOnState('CV_MARSHAL', 'MARSHAL', 'IN_STACK'), true);
  assert.equal(permission.canActOnState('CV_APP1', 'MARSHAL', 'IN_STACK'), false);
  assert.equal(permission.canActOnState('CV_APP2', 'MARSHAL', 'COMMENCED'), true);
  assert.equal(permission.canActOnState('CV_APP1', 'FINAL', 'ON_FINAL'), true);
  assert.equal(permission.canActOnState('CV_MARSHAL', 'FINAL', 'ON_FINAL'), false);
  assert.equal(permission.canActOnState('CV_PRIFLY', 'PATTERN', 'IN_PATTERN'), true);
  assert.equal(permission.canActOnState('CV_PRIFLY', 'FINAL', 'BALL'), false);
});

test('the CARRIER Facility: four MILITARY_ATC Positions, Bays that imply carrier states, PriFly on the offer lists (H111)', () => {
  const c = facilityConfig.getFacilityConfig('CARRIER');
  assert.deepEqual(c.positions, ['CV_MARSHAL', 'CV_PRIFLY', 'CV_APP1', 'CV_APP2']);
  for (const p of c.positions) assert.equal(facilityConfig.getPositionClass(p), 'MILITARY_ATC');
  // The lists themselves are asserted once, in efsp-facility-config.test.mjs; here only that every Position can be offered and be offered to.
  for (const p of c.positions) assert.ok(Array.isArray(c.consolidation[p]) && c.consolidation[p].length === 3, p);
  assert.equal(facilityConfig.bayImpliesState('cv-marshal-stack', 'CARRIER'), 'IN_STACK');
  assert.equal(facilityConfig.bayImpliesState('cv-app2-bolter', 'CARRIER'), 'BOLTER_WAVEOFF');
  assert.deepEqual(facilityConfig.getBaysFor('CV_PRIFLY', 'CARRIER')[0].rackIds, ['initial', 'break', 'downwind', 'groove']);
  // every Bay-implied state is a state of some carrier strip type
  const carrierStates = new Set(CARRIER_STRIP_TYPES.flatMap(r => nla.STATES_BY_STRIP_TYPE[r]));
  for (const b of facilityConfig.getAllBays('CARRIER')) if (b.impliesState) assert.ok(carrierStates.has(b.impliesState), b.bayId);
  assert.equal(facilityConfig.validateConfig(c).ok, true);
});

test('the NLA tables: Commence is Case- and lane-dependent; one next action per Strip', () => {
  const ctx = (caseValue, lane = 'CV_APP1', staffed = true) => ({ carrierCase: () => caseValue, carrierLaneFor: () => lane, isStaffed: () => staffed });
  const strip = (stripType, state) => ({ stripType, state, stripId: 's', flightDataId: 'f' });
  assert.deepEqual(nla.computeNla(strip('MARSHAL', 'IN_STACK'), null, NOW, ctx('III')),
    { toState: 'COMMENCED', transferTo: 'CV_APP1', carrierHandoff: 'MARSHAL_TO_APPROACH' });
  assert.deepEqual(nla.computeNla(strip('MARSHAL', 'IN_STACK'), null, NOW, ctx('II', 'CV_APP2')).transferTo, 'CV_APP2');
  assert.equal(nla.computeNla(strip('MARSHAL', 'IN_STACK'), null, NOW, ctx('III', null)).inhibited, 'no receiving Position present');
  const caseI = nla.computeNla(strip('MARSHAL', 'IN_STACK'), null, NOW, ctx('I'));
  assert.equal(caseI.carrierHandoff, 'MARSHAL_TO_PATTERN_CASE_I');
  assert.equal(caseI.stripTypeChange, 'PATTERN');
  assert.equal(nla.computeNla(strip('MARSHAL', 'IN_STACK'), null, NOW, ctx('I', 'CV_APP1', false)).inhibited, 'no receiving Position present');
  assert.equal(nla.computeNla(strip('MARSHAL', 'COMMENCED'), null, NOW, ctx('III')).stripTypeChange, 'FINAL');
  assert.equal(nla.computeNla(strip('FINAL', 'ON_FINAL'), null, NOW, { facilityId: 'CARRIER' }).carrierHandoff, 'FINAL_TO_LSO');
  // At an airfield the final's NLA is Landed: the Strip goes to GC at TAXI_IN, no carrier handoff, never BALL (docs/adr/0117).
  assert.equal(nla.computeNla(strip('FINAL', 'ON_FINAL'), null, NOW, { facilityId: 'INCIRLIK' }).carrierHandoff, undefined);
  assert.deepEqual(nla.computeNla(strip('FINAL', 'ON_FINAL'), null, NOW, { facilityId: 'INCIRLIK' }), { toState: 'TAXI_IN', transferTo: 'GC', alsoLegal: ['BOLTER_WAVEOFF'] });
  assert.deepEqual(nla.computeNla(strip('FINAL', 'BALL'), null, NOW, {}).toState, 'DROPPED');
  assert.equal(nla.computeNla(strip('PATTERN', 'IN_PATTERN'), null, NOW, {}).toState, 'RECOVERED');
  assert.equal(nla.computeNla(strip('MARSHAL', 'LAUNCH'), null, NOW, {}).toState, 'DROPPED');
});

test('a ship radar selector can name the radar and the hull', async () => {
  const { selectorMatches } = await import('../src/efsp/position-coverage.js');
  const search = { type: 'carrier', carrierRadar: 'search', unitName: 'UNION', shipType: 'CVN_72', coalition: 2 };
  const app = { ...search, carrierRadar: 'approach' };
  const other = { ...search, unitName: 'TARAWA', shipType: 'LHA_Tarawa' };
  assert.equal(selectorMatches({ kind: 'carrier' }, other), true, 'the bare selector still matches every ship');
  assert.equal(selectorMatches({ kind: 'carrier', hull: 'CVN-72' }, other), false);
  assert.equal(selectorMatches({ kind: 'carrier', hull: 'CVN-72' }, search), true);
  assert.equal(selectorMatches({ kind: 'carrier', hull: 'CVN-72', radar: 'search' }, app), false);
  assert.equal(selectorMatches({ kind: 'carrier', hull: 'CVN-72', radar: 'approach' }, app), true);
  assert.ok(facilityConfig.validateRadarSelector({ kind: 'airport', radar: 'search' }));
  assert.equal(facilityConfig.validateRadarSelector({ kind: 'carrier', radar: 'approach', hull: 'CVN-72' }), null);
});
