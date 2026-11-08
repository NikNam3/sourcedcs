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

const CARRIER_STRIP_TYPES = ['CV_LAUNCH', 'CV_RECOVERY'];
const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);

test('the two carrier strip types (docs/adr/0156) have states, owners, a Block Map and an NLA table; MARSHAL and PATTERN are gone', () => {
  assert.deepEqual(nla.STATES_BY_STRIP_TYPE.CV_LAUNCH, ['ON_DECK', 'CV_AIRBORNE', 'KILO', 'DROPPED']);
  assert.deepEqual(nla.STATES_BY_STRIP_TYPE.CV_RECOVERY, ['STACK', 'COMMENCED', 'FINAL_APPROACH', 'DIRTY', 'BULLSEYE', 'CV_PATTERN', 'DROPPED']);
  for (const gone of ['MARSHAL', 'PATTERN']) assert.equal(nla.STATES_BY_STRIP_TYPE[gone], undefined, gone);
  for (const stripType of CARRIER_STRIP_TYPES) {
    assert.ok(blockMap.isValidStripType(stripType));
    assert.ok(permission.STATE_OWNERS_BY_STRIP_TYPE[stripType], `${stripType} owners`);
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
      assert.ok(!seen.has(s), `${stripType}/${s} collides with the other carrier strip type`);
      seen.add(s);
    }
  }
});

// "a test forces this decision": EVERY state of EVERY strip type carries an explicit
// eligibility expectation here, so a state added to STATES_BY_STRIP_TYPE fails this
// test until somebody decides (docs/adr/0041, and the reconciler's own comment).
const ELIGIBILITY = {
  PROPOSED: false, PENDING_CLEARANCE: false, CLEARED: false, HELD: false, TASKED: false, DROPPED: false,
  PUSHBACK: true, TAXI: true, RUNWAY_QUEUE: true, LUAW: true, DEPARTED: true, HANDED_OFF: true,
  INBOUND: true, HANDED_TO_TOWER: true, TRAFFIC_PATTERN: true, FINAL: true, LANDED: true, TAXI_IN: true,
  IN_SECTOR: true, AIRBORNE: true, ON_STATION: true, OFF_STATION: true, RTB: true,
  // carrier (docs/adr/0156): all eligible, ON_DECK included (correlation reads the track store; Case I is held back by
  // the reconciler, not by state)
  ON_DECK: true, CV_AIRBORNE: true, KILO: true, STACK: true, COMMENCED: true, FINAL_APPROACH: true, DIRTY: true, BULLSEYE: true, CV_PATTERN: true,
  // PAR's FINAL
  ON_FINAL: true, BOLTER_WAVEOFF: true,
  // docs/adr/0146: a tagged VFR has a track by definition
  TRACKED: true,
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

test('permissions: PriFly creates the launch, the Marshal the recovery; no CV Position proposes a coordination, TOFIs or converts (the Marshal answers a HANDOFF, docs/adr/0101)', () => {
  assert.equal(permission.canCreateStripType('CV_PRIFLY', 'CV_LAUNCH'), true);
  assert.equal(permission.canCreateStripType('CV_PRIFLY', 'CV_RECOVERY'), false);
  assert.equal(permission.canCreateStripType('CV_MARSHAL', 'CV_RECOVERY'), true);
  assert.equal(permission.canCreateStripType('CV_MARSHAL', 'CV_LAUNCH'), false);
  for (const p of ['CV_MARSHAL', 'CV_PRIFLY']) assert.equal(classPermission.canMutate(p, 'CreateStrip'), true, p);
  for (const p of ['CV_APP1', 'CV_APP2', 'CV_DEP']) assert.equal(classPermission.canMutate(p, 'CreateStrip'), false, p);
  for (const p of ['CV_MARSHAL', 'CV_PRIFLY', 'CV_APP1', 'CV_APP2', 'CV_DEP']) {
    const held = p === 'CV_MARSHAL' ? ['HANDOFF', 'ControlRelease'] : [];
    for (const k of [...permission.COORDINATION_OP_KINDS, 'ControlRelease', 'TOFI', 'ConvertToArrival', 'ApproveAirspaceEntry', 'ClearAirspaceEntry']) {
      assert.equal(classPermission.canMutate(p, k), held.includes(k), `${p}/${k}`);
    }
    assert.equal(classPermission.canMutateAction(p, 'HANDOFF', 'PROPOSE'), false, `${p} never proposes`);
    assert.equal(classPermission.canMutateAction(p, 'HANDOFF', 'ACCEPT'), p === 'CV_MARSHAL');
    assert.equal(classPermission.canMutate(p, 'TransferStrip'), true);
  }
});

test('ship-level predicates take exactly one Position (D21)', () => {
  assert.equal(permission.canEditCarrierState.length, 1);
  assert.equal(permission.canSequenceMarshalStack.length, 1);
  assert.equal(permission.canEditCarrierState('CV_PRIFLY'), true);
  assert.equal(permission.canEditCarrierState('CV_MARSHAL'), true);
  assert.equal(permission.canEditCarrierState('CV_APP1'), false);
  assert.equal(permission.canSequenceMarshalStack('CV_MARSHAL'), true);
  assert.equal(permission.canSequenceMarshalStack('CV_PRIFLY'), false);
  assert.equal(permission.canRecordCarrierHandoff('CV_MARSHAL', 'TO_APPROACH'), true);
  assert.equal(permission.canRecordCarrierHandoff('CV_APP1', 'TO_APPROACH'), false);
  assert.equal(permission.canRecordCarrierHandoff('CV_APP2', 'RETURN_TO_STACK'), true);
  assert.equal(permission.canRecordCarrierHandoff('CV_MARSHAL', 'nonsense'), false);
  assert.equal(permission.canEditCarrierState('LC'), false);
});

test('state authority (docs/adr/0156): PriFly on deck, departure control airborne, the Marshal to TO APPR, the lane to the drop, PriFly or the lane the pattern', () => {
  const t = (p, type, s) => permission.canActOnState(p, type, s);
  assert.equal(t('CV_PRIFLY', 'CV_LAUNCH', 'ON_DECK'), true);
  assert.equal(t('CV_MARSHAL', 'CV_LAUNCH', 'ON_DECK'), false);
  for (const s of ['CV_AIRBORNE', 'KILO']) { assert.equal(t('CV_DEP', 'CV_LAUNCH', s), true, s); assert.equal(t('CV_MARSHAL', 'CV_LAUNCH', s), false, s); }
  for (const s of ['STACK', 'COMMENCED']) { assert.equal(t('CV_MARSHAL', 'CV_RECOVERY', s), true, s); assert.equal(t('CV_APP1', 'CV_RECOVERY', s), false, s); }
  for (const s of ['FINAL_APPROACH', 'DIRTY', 'BULLSEYE']) {
    for (const lane of ['CV_APP1', 'CV_APP2']) assert.equal(t(lane, 'CV_RECOVERY', s), true, `${lane}/${s}`);
    assert.equal(t('CV_MARSHAL', 'CV_RECOVERY', s), false, s);
    assert.equal(t('CV_PRIFLY', 'CV_RECOVERY', s), false, s);
  }
  for (const p of ['CV_PRIFLY', 'CV_APP1', 'CV_APP2']) assert.equal(t(p, 'CV_RECOVERY', 'CV_PATTERN'), true, p);
  assert.equal(t('CV_MARSHAL', 'CV_RECOVERY', 'CV_PATTERN'), false);
});

test('the CARRIER Facility (docs/adr/0156): five MILITARY_ATC Positions and Bays that imply the new carrier states', () => {
  const c = facilityConfig.getFacilityConfig('CARRIER');
  assert.deepEqual(c.positions, ['CV_MARSHAL', 'CV_PRIFLY', 'CV_APP1', 'CV_APP2', 'CV_DEP']);
  for (const p of c.positions) assert.equal(facilityConfig.getPositionClass(p), 'MILITARY_ATC');
  for (const p of c.positions) assert.ok(Array.isArray(c.consolidation[p]) && c.consolidation[p].length === 4, p);
  const implied = Object.fromEntries(facilityConfig.getAllBays('CARRIER').map(b => [b.bayId, b.impliesState || null]));
  assert.deepEqual(implied, {
    'cv-marshal-stack': 'STACK', 'cv-marshal-coordination': null,
    'cv-prifly-launch': 'ON_DECK', 'cv-prifly-pattern': 'CV_PATTERN', 'cv-prifly-deck': null,
    'cv-app1-approach': 'FINAL_APPROACH', 'cv-app1-pattern': 'CV_PATTERN',
    'cv-app2-approach': 'FINAL_APPROACH', 'cv-app2-pattern': 'CV_PATTERN',
    'cv-dep-departures': 'CV_AIRBORNE',
  });
  assert.equal(facilityConfig.validateConfig(c).ok, true);
});

test('the NLA tables (docs/adr/0156): one button per state, the flight\'s Case for a recovery, the ship\'s for a launch', () => {
  const ctx = ({ ship = 'III', flight = null, lane = 'CV_APP1', staffed = true, inStack = true } = {}) => ({
    carrierCase: () => ship, carrierCaseOf: () => flight, carrierLaneFor: () => lane, isStaffed: () => staffed,
    consolidatedAt: () => null, carrierInStack: () => inStack,
  });
  const strip = (stripType, state) => ({ stripType, state, stripId: 's', flightDataId: 'f' });
  const L = (state, c) => nla.computeNla(strip('CV_LAUNCH', state), null, NOW, ctx(c));
  const R = (state, c) => nla.computeNla(strip('CV_RECOVERY', state), null, NOW, ctx(c));
  assert.deepEqual(L('ON_DECK', { ship: 'I' }), { toState: 'DROPPED', alsoHandoff: 'LAUNCH_TO_MARSHAL' });
  for (const ship of ['II', 'III']) assert.deepEqual(L('ON_DECK', { ship }), { toState: 'CV_AIRBORNE', transferTo: 'CV_DEP', carrierHandoff: 'LAUNCH_TO_DEPARTURE' }, ship);
  assert.equal(L('ON_DECK', { ship: 'III', staffed: false }).inhibited, 'no receiving Position present');
  assert.deepEqual(L('CV_AIRBORNE'), { toState: 'KILO' });
  assert.deepEqual(L('KILO'), { toState: 'DROPPED', alsoHandoff: 'DEPARTURE_TO_MARSHAL' });
  // The flight's Case wins over the ship's.
  assert.deepEqual(R('STACK', { ship: 'I', flight: 'III' }), { toState: 'COMMENCED', carrierHandoff: 'COMMENCE' });
  assert.deepEqual(R('STACK', { ship: 'III', flight: 'I' }), { toState: 'CV_PATTERN', transferTo: 'CV_PRIFLY', carrierHandoff: 'CASE_I_TO_PRIFLY' });
  assert.equal(R('STACK', { flight: 'I', staffed: false }).inhibited, 'no receiving Position present');
  assert.match(R('STACK', { inStack: false }).inhibited, /not in the Marshal stack/);
  assert.deepEqual(R('COMMENCED', { flight: 'III', lane: 'CV_APP2' }), { toState: 'FINAL_APPROACH', transferTo: 'CV_APP2', carrierHandoff: 'TO_APPROACH' });
  assert.equal(R('COMMENCED', { lane: null }).inhibited, 'no receiving Position present');
  assert.deepEqual(R('FINAL_APPROACH'), { toState: 'DIRTY' });
  assert.deepEqual(R('DIRTY'), { toState: 'BULLSEYE' });
  assert.deepEqual(R('BULLSEYE'), { toState: 'CV_PATTERN' });
  assert.deepEqual(R('CV_PATTERN'), { toState: 'DROPPED' });
  // FINAL is PAR's only now: the carrier Facility gets the airfield's table.
  assert.deepEqual(nla.computeNla(strip('FINAL', 'ON_FINAL'), null, NOW, { facilityId: 'CARRIER' }), { toState: 'TAXI_IN', transferTo: 'GC', alsoLegal: ['BOLTER_WAVEOFF'] });
});

test('a ship radar selector can name the radar and the hull', async () => {
  const { selectorMatches } = await import('../src/efsp/position-coverage.js');
  // the hull is our coalition's ship (CRCSYNC_COALITION, default BLUE = 3), as the carrier panel matches it
  const search = { id: 'carrier:1', type: 'carrier', carrierRadar: 'search', unitName: 'UNION', shipType: 'CVN_72', coalition: 3 };
  const app = { ...search, id: 'cvapp:1', carrierRadar: 'approach' };
  const other = { ...search, id: 'carrier:2', unitName: 'TARAWA', shipType: 'LHA_Tarawa' };
  assert.equal(selectorMatches({ kind: 'carrier' }, other), true, 'the bare selector still matches every ship');
  assert.equal(selectorMatches({ kind: 'carrier', hull: 'CVN-72' }, other), false);
  assert.equal(selectorMatches({ kind: 'carrier', hull: 'CVN-72' }, search), true);
  assert.equal(selectorMatches({ kind: 'carrier', hull: 'CVN-72', radar: 'search' }, app), false);
  assert.equal(selectorMatches({ kind: 'carrier', hull: 'CVN-72', radar: 'approach' }, app), true);
  assert.ok(facilityConfig.validateRadarSelector({ kind: 'airport', radar: 'search' }));
  assert.equal(facilityConfig.validateRadarSelector({ kind: 'carrier', radar: 'approach', hull: 'CVN-72' }), null);
});
