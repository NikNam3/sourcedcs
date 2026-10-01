import test from 'node:test';
import assert from 'node:assert/strict';

/* The carrier Roles wired through the shared tables (docs/adr/0074, WP7A part 2):
 * STATES_BY_ROLE, the Block Maps, INELIGIBLE_STATES, permission.js, the CARRIER
 * Facility. Every assertion here is a decision that used to be a default. */

const nla = await import('../src/efsp/nla.js');
const permission = await import('../src/efsp/permission.js');
const blockMap = await import('../src/efsp/block-map.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const { INELIGIBLE_STATES, CorrelationReconciler } = await import('../src/efsp/correlation-reconciler.js');

const CARRIER_ROLES = ['MARSHAL', 'FINAL', 'PATTERN'];
const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);

test('the three carrier Roles have states, owners, a Block Map and an NLA table', () => {
  for (const role of CARRIER_ROLES) {
    assert.ok(nla.STATES_BY_ROLE[role], `${role} states`);
    assert.ok(nla.isValidState(nla.STATES_BY_ROLE[role][0], role));
    assert.ok(blockMap.isValidRole(role));
    assert.ok(permission.STATE_OWNERS_BY_ROLE[role], `${role} owners`);
    // The trap: an unregistered Role falls back to the DEPARTURE table and would offer "Send to Clearance".
    const first = nla.STATES_BY_ROLE[role][0];
    const r = nla.computeNla({ role, state: first }, null, NOW, {});
    assert.ok(!r || r.inhibited || !['PENDING_CLEARANCE'].includes(r.toState), `${role} must not use DEPARTURE's NLA`);
  }
});

test('no carrier state name collides with another Role\'s state, except DROPPED', () => {
  const others = new Set();
  for (const [role, states] of Object.entries(nla.STATES_BY_ROLE)) if (!CARRIER_ROLES.includes(role)) states.forEach(s => others.add(s));
  const seen = new Set();
  for (const role of CARRIER_ROLES) {
    for (const s of nla.STATES_BY_ROLE[role]) {
      if (s === 'DROPPED') continue;
      assert.ok(!others.has(s), `${role}/${s} collides with a non-carrier state`);
      assert.ok(!seen.has(s), `${role}/${s} collides with another carrier Role`);
      seen.add(s);
    }
  }
  assert.ok(!nla.MARSHAL_STATES.includes('FINAL') && !nla.FINAL_STATES.includes('FINAL'), 'FINAL is an ARRIVAL state');
});

// "a test forces this decision": EVERY state of EVERY Role carries an explicit
// eligibility expectation here, so a state added to STATES_BY_ROLE fails this
// test until somebody decides (docs/adr/0041, and the reconciler's own comment).
const ELIGIBILITY = {
  PROPOSED: false, PENDING_CLEARANCE: false, CLEARED: false, HELD: false, TASKED: false, DROPPED: false,
  PUSHBACK: true, TAXI: true, RUNWAY_QUEUE: true, LUAW: true, DEPARTED: true, HANDED_OFF: true,
  INBOUND: true, HANDED_TO_TOWER: true, FINAL: true, LANDED: true, TAXI_IN: true,
  TRANSITING: true, AIRBORNE: true, ON_STATION: true, OFF_STATION: true, RTB: true,
  // carrier (docs/adr/0074): all eligible, LAUNCH included (correlation reads the track store, not illumination)
  LAUNCH: true, IN_STACK: true, COMMENCED: true, ON_FINAL: true, BALL: true, BOLTER_WAVEOFF: true, IN_PATTERN: true, RECOVERED: true,
};
test('every state of every Role has an explicit correlation-eligibility decision, and the list agrees', () => {
  for (const [role, states] of Object.entries(nla.STATES_BY_ROLE)) {
    for (const s of states) {
      assert.ok(Object.prototype.hasOwnProperty.call(ELIGIBILITY, s), `${role}/${s}: no eligibility decision — add it to INELIGIBLE_STATES or to this table as eligible`);
      assert.equal(CorrelationReconciler.isEligible([{ state: s }]), ELIGIBILITY[s], `${role}/${s}`);
      assert.equal(INELIGIBLE_STATES.has(s), !ELIGIBILITY[s], `${role}/${s}`);
    }
  }
});

test('Block Maps: derived Blocks are not writable by SetBlock; carrier Blocks route to the flight; FINAL has nothing writable', () => {
  for (const id of ['C3', 'C5', 'C6', 'C7', 'C8', 'C9']) assert.equal(blockMap.resolveBlockTarget('MARSHAL', id), null, id);
  for (const [id, field] of [['C4', 'approachType'], ['C10', 'approachButton'], ['C12', 'lowStateLb'], ['C13', 'bingoField'], ['C14', 'bingoFuelLb'], ['C15', 'eeatUtc']]) {
    assert.deepEqual(blockMap.resolveBlockTarget('MARSHAL', id), { kind: 'carrier', field });
  }
  for (const [id, def] of Object.entries(blockMap.FINAL_BLOCK_MAP)) {
    assert.equal(blockMap.resolveBlockTarget('FINAL', id), null, `FINAL/${id} must not be writable`);
    assert.ok(!['fdr', 'annotation'].includes(def.target.kind), id);
  }
  assert.ok(blockMap.resolveBlockTarget('PATTERN', 'C24'));
});

test('permissions: only the Marshal creates, only as MARSHAL; no CV Position coordinates, TOFIs or converts', () => {
  assert.equal(permission.canMutate('CV_MARSHAL', 'CreateStrip'), true);
  assert.equal(permission.canCreateStripRole('CV_MARSHAL', 'MARSHAL'), true);
  assert.equal(permission.canCreateStripRole('CV_MARSHAL', 'FINAL'), false);
  assert.equal(permission.canCreateStripRole('CV_MARSHAL', 'PATTERN'), false);
  for (const p of ['CV_PRIFLY', 'CV_APP1', 'CV_APP2']) assert.equal(permission.canMutate(p, 'CreateStrip'), false, p);
  for (const p of ['CV_MARSHAL', 'CV_PRIFLY', 'CV_APP1', 'CV_APP2']) {
    for (const k of [...permission.COORDINATION_OP_KINDS, 'TOFI', 'ConvertToArrival', 'ApproveAirspaceEntry', 'ClearAirspaceEntry']) {
      assert.equal(permission.canMutate(p, k), false, `${p}/${k}`);
    }
    assert.equal(permission.canMutate(p, 'TransferStrip'), true);
  }
});

test('ship-level predicates take exactly one Position (D21)', () => {
  assert.equal(permission.canSetRecoveryCase.length, 1);
  assert.equal(permission.canSequenceMarshalStack.length, 1);
  assert.equal(permission.canEditShipStateInput.length, 1);
  assert.equal(permission.canSetRecoveryCase('CV_PRIFLY'), true);
  assert.equal(permission.canSetRecoveryCase('CV_MARSHAL'), false);
  assert.equal(permission.canSequenceMarshalStack('CV_MARSHAL'), true);
  assert.equal(permission.canSequenceMarshalStack('CV_PRIFLY'), false);
  assert.equal(permission.canEditShipStateInput('CV_APP1'), false);
  assert.equal(permission.canEditShipStateInput('CV_PRIFLY'), true);
  assert.equal(permission.canRecordCarrierTransfer('CV_MARSHAL', 'MARSHAL_TO_APPROACH'), true);
  assert.equal(permission.canRecordCarrierTransfer('CV_APP1', 'MARSHAL_TO_APPROACH'), false);
  assert.equal(permission.canRecordCarrierTransfer('CV_APP2', 'FINAL_TO_LSO'), true);
  assert.equal(permission.canRecordCarrierTransfer('CV_MARSHAL', 'nonsense'), false);
  // a Position of another Facility has none of them
  assert.equal(permission.canSetRecoveryCase('TWR'), false);
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

test('the CARRIER Facility: four MILITARY_ATC Positions, Bays that imply carrier states, PriFly out of the covering chain', () => {
  const c = facilityConfig.getFacilityConfig('CARRIER');
  assert.deepEqual(c.positions, ['CV_MARSHAL', 'CV_PRIFLY', 'CV_APP1', 'CV_APP2']);
  for (const p of c.positions) assert.equal(facilityConfig.getPositionClass(p), 'MILITARY_ATC');
  assert.deepEqual(c.coveringChain, { CV_APP2: 'CV_APP1', CV_APP1: 'CV_MARSHAL' });
  assert.ok(!Object.keys(c.coveringChain).includes('CV_PRIFLY') && !Object.values(c.coveringChain).includes('CV_PRIFLY'));
  assert.equal(facilityConfig.bayImpliesState('cv-marshal-stack', 'CARRIER'), 'IN_STACK');
  assert.equal(facilityConfig.bayImpliesState('cv-app2-bolter', 'CARRIER'), 'BOLTER_WAVEOFF');
  assert.deepEqual(facilityConfig.getBaysFor('CV_PRIFLY', 'CARRIER')[0].rackIds, ['initial', 'break', 'downwind', 'groove']);
  // every Bay-implied state is a state of some carrier Role
  const carrierStates = new Set(CARRIER_ROLES.flatMap(r => nla.STATES_BY_ROLE[r]));
  for (const b of facilityConfig.getAllBays('CARRIER')) if (b.impliesState) assert.ok(carrierStates.has(b.impliesState), b.bayId);
  assert.equal(facilityConfig.validateConfig(c).ok, true);
});

test('the NLA tables: Commence is Case- and lane-dependent; one next action per Strip', () => {
  const ctx = (caseValue, lane = 'CV_APP1', occupied = true) => ({ carrierCase: () => caseValue, carrierLaneFor: () => lane, isOccupied: () => occupied });
  const strip = (role, state) => ({ role, state, stripId: 's', fdrId: 'f' });
  assert.deepEqual(nla.computeNla(strip('MARSHAL', 'IN_STACK'), null, NOW, ctx('III')),
    { toState: 'COMMENCED', transferTo: 'CV_APP1', carrierTransfer: 'MARSHAL_TO_APPROACH' });
  assert.deepEqual(nla.computeNla(strip('MARSHAL', 'IN_STACK'), null, NOW, ctx('II', 'CV_APP2')).transferTo, 'CV_APP2');
  assert.equal(nla.computeNla(strip('MARSHAL', 'IN_STACK'), null, NOW, ctx('III', null)).inhibited, 'no receiving Position present');
  const caseI = nla.computeNla(strip('MARSHAL', 'IN_STACK'), null, NOW, ctx('I'));
  assert.equal(caseI.carrierTransfer, 'MARSHAL_TO_PATTERN_CASE_I');
  assert.equal(caseI.roleChange, 'PATTERN');
  assert.equal(nla.computeNla(strip('MARSHAL', 'IN_STACK'), null, NOW, ctx('I', 'CV_APP1', false)).inhibited, 'no receiving Position present');
  assert.equal(nla.computeNla(strip('MARSHAL', 'COMMENCED'), null, NOW, ctx('III')).roleChange, 'FINAL');
  assert.equal(nla.computeNla(strip('FINAL', 'ON_FINAL'), null, NOW, { facilityId: 'CARRIER' }).carrierTransfer, 'FINAL_TO_LSO');
  // PAR's "Landing assured" is the same state change with no carrier hand-over (ADR 0075).
  assert.equal(nla.computeNla(strip('FINAL', 'ON_FINAL'), null, NOW, { facilityId: 'INCIRLIK' }).carrierTransfer, undefined);
  assert.equal(nla.computeNla(strip('FINAL', 'ON_FINAL'), null, NOW, { facilityId: 'INCIRLIK' }).toState, 'BALL');
  assert.deepEqual(nla.computeNla(strip('FINAL', 'BALL'), null, NOW, {}).toState, 'DROPPED');
  assert.equal(nla.computeNla(strip('PATTERN', 'IN_PATTERN'), null, NOW, {}).toState, 'RECOVERED');
  assert.equal(nla.computeNla(strip('MARSHAL', 'LAUNCH'), null, NOW, {}).toState, 'DROPPED');
});

test('a ship radar selector can name the radar and the hull', async () => {
  const { selectorMatches } = await import('../src/efsp/station-coverage.js');
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
