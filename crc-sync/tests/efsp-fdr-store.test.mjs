import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  FdrStore, deriveEquipmentSuffix, VOID_DEADLINE_MINUTES,
  EDCT_WINDOW_MINUTES, CALL_FOR_RELEASE_BEFORE_MINUTES, CALL_FOR_RELEASE_AFTER_MINUTES,
  TRACK_DEGRADATION_FLAGS, AIRSPACE_OWNERS,
} = await import('../src/efsp/fdr-store.js');
const { isReserved } = await import('../src/efsp/code-allocator.js');

function makeSeed(overrides = {}) {
  return {
    callsign: 'VIPER1',
    flightSize: 1,
    aircraftType: 'F16',
    wakeCategory: 'D',
    equipmentCodes: ['G', 'R'],
    route: 'DCT',
    requestedAltitude: '250',
    departureAirport: 'LTAG',
    destinationAirport: 'LTAC',
    ...overrides,
  };
}

test('createFdr rejects a callsign longer than 7 alphanumeric characters (§3.2 rule 1)', () => {
  const store = new FdrStore();
  const result = store.createFdr(makeSeed({ callsign: 'TOOLONGCS' }), { by: 'OPS' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

test('createFdr rejects a non-alphanumeric callsign', () => {
  const store = new FdrStore();
  const result = store.createFdr(makeSeed({ callsign: 'VI-P1' }), { by: 'OPS' });
  assert.equal(result.ok, false);
});

test('createFdr accepts exactly 7 alphanumeric characters', () => {
  const store = new FdrStore();
  const result = store.createFdr(makeSeed({ callsign: 'ABCDEFG' }), { by: 'OPS' });
  assert.equal(result.ok, true);
  assert.equal(result.fdr.identity.callsign, 'ABCDEFG');
});

test('createFdr mints a beacon code automatically and marks it COMPUTER_GENERATED', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  assert.ok(fdr.identity.beaconAssigned);
  assert.equal(isReserved(fdr.identity.beaconAssigned), false);
  assert.equal(fdr.provenance['identity.beaconAssigned'], 'COMPUTER_GENERATED');
});

test('createFdr never mints a code from the code allocator that duplicates another FDR\'s freshly minted code', () => {
  const store = new FdrStore();
  const { fdr: a } = store.createFdr(makeSeed({ callsign: 'AAA1111' }), { by: 'OPS' });
  const { fdr: b } = store.createFdr(makeSeed({ callsign: 'BBB2222' }), { by: 'OPS' });
  assert.notEqual(a.identity.beaconAssigned, b.identity.beaconAssigned);
});

test('createFdr derives equipmentSuffix from equipmentCodes and marks it SYSTEM_DERIVED', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed({ equipmentCodes: ['R', 'G'] }), { by: 'OPS' });
  assert.equal(fdr.identity.equipmentSuffix, deriveEquipmentSuffix(['R', 'G']));
  assert.equal(fdr.provenance['identity.equipmentSuffix'], 'SYSTEM_DERIVED');
});

test('createFdr leaves modeOne/modeTwo/beaconObserved/trackRef/military null (WP5/WP6/WP7 hooks, inert in Phase 1)', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  assert.equal(fdr.identity.modeOne, null);
  assert.equal(fdr.identity.modeTwo, null);
  assert.equal(fdr.identity.beaconObserved, null);
  assert.equal(fdr.trackRef, null);
  assert.equal(fdr.military, null);
});

test('createFdr defaults flightSize to 1 and rejects non-positive-integer overrides silently falling back to 1', () => {
  const store = new FdrStore();
  const { fdr: a } = store.createFdr(makeSeed({ flightSize: undefined }), { by: 'OPS' });
  assert.equal(a.identity.flightSize, 1);
  const { fdr: b } = store.createFdr(makeSeed({ callsign: 'FML0002', flightSize: -1 }), { by: 'OPS' });
  assert.equal(b.identity.flightSize, 1);
});

test('setField rejects a direct write to identity.equipmentSuffix — the §3.3 interlock', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const result = store.setField(fdr.fdrId, 'identity.equipmentSuffix', 'HACKED', { by: 'GND' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
  assert.equal(store.getFdr(fdr.fdrId).identity.equipmentSuffix, fdr.identity.equipmentSuffix);
});

test('setField on identity.equipmentCodes recomputes equipmentSuffix automatically', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed({ equipmentCodes: ['G'] }), { by: 'OPS' });
  const before = fdr.identity.equipmentSuffix;
  const result = store.setField(fdr.fdrId, 'identity.equipmentCodes', ['G', 'R', 'Z'], { by: 'CD' });
  assert.equal(result.ok, true);
  assert.notEqual(result.fdr.identity.equipmentSuffix, before);
  assert.equal(result.fdr.identity.equipmentSuffix, deriveEquipmentSuffix(['G', 'R', 'Z']));
});

test('setField on identity.degradation is independent of equipmentCodes/equipmentSuffix (§3.3 exception)', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed({ equipmentCodes: ['G', 'R'] }), { by: 'OPS' });
  const suffixBefore = fdr.identity.equipmentSuffix;
  const codesBefore = [...fdr.identity.equipmentCodes];

  const result = store.setField(fdr.fdrId, 'identity.degradation', 'TRANSPONDER_FAILED', { by: 'TWR' });
  assert.equal(result.ok, true);
  assert.equal(result.fdr.identity.degradation, 'TRANSPONDER_FAILED');
  assert.equal(result.fdr.identity.equipmentSuffix, suffixBefore);
  assert.deepEqual(result.fdr.identity.equipmentCodes, codesBefore);
});

test('setField rejects an invalid degradation value', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const result = store.setField(fdr.fdrId, 'identity.degradation', 'BOGUS', { by: 'TWR' });
  assert.equal(result.ok, false);
});

test('setField rejects identity.beaconAssigned — must go through setBeaconAssigned', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const result = store.setField(fdr.fdrId, 'identity.beaconAssigned', '1234', { by: 'CD' });
  assert.equal(result.ok, false);
});

test('there is no writable path for identity.modeOne or identity.modeTwo anywhere (defect D24, by construction)', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  assert.equal(store.setField(fdr.fdrId, 'identity.modeOne', '05', { by: 'CD' }).ok, false);
  assert.equal(store.setField(fdr.fdrId, 'identity.modeTwo', '1234', { by: 'CD' }).ok, false);
});

test('setBeaconAssigned rejects a reserved code as VALIDATION_ERROR and does not change the FDR', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const before = fdr.identity.beaconAssigned;
  const result = store.setBeaconAssigned(fdr.fdrId, '7700', { by: 'CD' });
  assert.equal(result.ok, false);
  assert.equal(store.getFdr(fdr.fdrId).identity.beaconAssigned, before);
});

test('setBeaconAssigned rejects 7777 specifically — never offered/settable as an assignment (§3.10.2 rule 5)', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const result = store.setBeaconAssigned(fdr.fdrId, '7777', { by: 'CD' });
  assert.equal(result.ok, false);
});

test('setBeaconAssigned accepts a controller override, releases the old code, and stamps provenance CONTROLLER_ENTERED', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const oldCode = fdr.identity.beaconAssigned;

  const result = store.setBeaconAssigned(fdr.fdrId, '4321', { by: 'CD' });
  assert.equal(result.ok, true);
  assert.equal(result.fdr.identity.beaconAssigned, '4321');
  assert.equal(result.fdr.provenance['identity.beaconAssigned'], 'CONTROLLER_ENTERED');
  assert.equal(store.codeAllocator.isAllocated(oldCode), false);
  assert.equal(store.codeAllocator.holderOf('4321'), fdr.fdrId);
});

test('setBeaconAssigned surfaces a duplicate as a warning, never a hard block (defect D23)', () => {
  const store = new FdrStore();
  const { fdr: a } = store.createFdr(makeSeed({ callsign: 'AAA1111' }), { by: 'OPS' });
  const { fdr: b } = store.createFdr(makeSeed({ callsign: 'BBB2222' }), { by: 'OPS' });

  const result = store.setBeaconAssigned(b.fdrId, a.identity.beaconAssigned, { by: 'CD' });
  assert.equal(result.ok, true);
  assert.equal(result.warning, 'DUPLICATE_IGNORED_WARNING');
  assert.equal(store.getFdr(b.fdrId).identity.beaconAssigned, a.identity.beaconAssigned);
});

test('setField on assigned.releaseState computes voidDeadlineUtc = voidTimeUtc + 30min only for CLEARANCE_VOID_TIME', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const voidTime = Date.UTC(2026, 0, 1, 12, 0, 0);

  store.setField(fdr.fdrId, 'assigned.voidTimeUtc', voidTime, { by: 'CD' });
  const result = store.setField(fdr.fdrId, 'assigned.releaseState', 'CLEARANCE_VOID_TIME', { by: 'CD' });
  assert.equal(result.ok, true);
  assert.equal(result.fdr.assigned.voidDeadlineUtc, voidTime + VOID_DEADLINE_MINUTES * 60 * 1000);
});

test('assigned.voidDeadlineUtc is null when releaseState is not CLEARANCE_VOID_TIME, even with a voidTimeUtc set', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  store.setField(fdr.fdrId, 'assigned.voidTimeUtc', Date.now(), { by: 'CD' });
  const result = store.setField(fdr.fdrId, 'assigned.releaseState', 'HOLD_FOR_RELEASE', { by: 'CD' });
  assert.equal(result.fdr.assigned.voidDeadlineUtc, null);
});

test('setting voidTimeUtc AFTER releaseState is already CLEARANCE_VOID_TIME recomputes the deadline', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  store.setField(fdr.fdrId, 'assigned.releaseState', 'CLEARANCE_VOID_TIME', { by: 'CD' });
  const voidTime = Date.UTC(2026, 0, 1, 8, 0, 0);
  const result = store.setField(fdr.fdrId, 'assigned.voidTimeUtc', voidTime, { by: 'CD' });
  assert.equal(result.fdr.assigned.voidDeadlineUtc, voidTime + VOID_DEADLINE_MINUTES * 60 * 1000);
});

test('setField rejects an invalid releaseState value', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const result = store.setField(fdr.fdrId, 'assigned.releaseState', 'BOGUS', { by: 'CD' });
  assert.equal(result.ok, false);
});

test('setField rejects an unknown/non-whitelisted path', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  assert.equal(store.setField(fdr.fdrId, 'fdrId', 'hacked', { by: 'OPS' }).ok, false);
  assert.equal(store.setField(fdr.fdrId, 'identity.notARealField', 'x', { by: 'OPS' }).ok, false);
});

test('setField bumps rev, updatedAt, updatedBy and stamps provenance CONTROLLER_ENTERED on success', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const revBefore = fdr.rev;
  const result = store.setField(fdr.fdrId, 'filed.remarks', 'NORDO PRACTICE', { by: 'CD' });
  assert.equal(result.fdr.rev, revBefore + 1);
  assert.equal(result.fdr.updatedBy, 'CD');
  assert.equal(result.fdr.provenance['filed.remarks'], 'CONTROLLER_ENTERED');
});

test('setField on a nonexistent fdrId returns NOT_FOUND', () => {
  const store = new FdrStore();
  const result = store.setField('does-not-exist', 'filed.remarks', 'x', { by: 'CD' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_FOUND');
});

test('releaseFdr frees the beacon code back to the allocator', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const code = fdr.identity.beaconAssigned;
  store.releaseFdr(fdr.fdrId);
  assert.equal(store.codeAllocator.isAllocated(code), false);
});

test('snapshot()/restore() round-trips both FDR state and code-allocator state', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const snap = store.snapshot();

  const restored = new FdrStore();
  restored.restore(snap);
  assert.deepEqual(restored.getFdr(fdr.fdrId), fdr);
  assert.equal(restored.codeAllocator.isAllocated(fdr.identity.beaconAssigned), true);
});

// ── WP4A: EDCT / CALL_FOR_RELEASE (§4.6.2), docs/adr/0017 ──────────────

test('a fresh FDR starts with every EDCT/CALL_FOR_RELEASE field null', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  assert.equal(fdr.assigned.edctTimeUtc, null);
  assert.equal(fdr.assigned.edctWindowStartUtc, null);
  assert.equal(fdr.assigned.edctWindowEndUtc, null);
  assert.equal(fdr.assigned.callForReleaseTimeUtc, null);
  assert.equal(fdr.assigned.callForReleaseWindowStartUtc, null);
  assert.equal(fdr.assigned.callForReleaseWindowEndUtc, null);
});

test('setting releaseState EDCT with an edctTimeUtc derives a +/-5min window', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const t = Date.UTC(2026, 0, 1, 12, 0, 0);

  store.setField(fdr.fdrId, 'assigned.edctTimeUtc', t, { by: 'CTR' });
  const result = store.setField(fdr.fdrId, 'assigned.releaseState', 'EDCT', { by: 'CTR' });

  assert.equal(result.ok, true);
  assert.equal(result.fdr.assigned.edctWindowStartUtc, t - EDCT_WINDOW_MINUTES * 60 * 1000);
  assert.equal(result.fdr.assigned.edctWindowEndUtc, t + EDCT_WINDOW_MINUTES * 60 * 1000);
});

test('setting releaseState CALL_FOR_RELEASE with a callForReleaseTimeUtc derives a -2/+1min window', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const t = Date.UTC(2026, 0, 1, 12, 0, 0);

  store.setField(fdr.fdrId, 'assigned.callForReleaseTimeUtc', t, { by: 'CTR' });
  const result = store.setField(fdr.fdrId, 'assigned.releaseState', 'CALL_FOR_RELEASE', { by: 'CTR' });

  assert.equal(result.ok, true);
  assert.equal(result.fdr.assigned.callForReleaseWindowStartUtc, t - CALL_FOR_RELEASE_BEFORE_MINUTES * 60 * 1000);
  assert.equal(result.fdr.assigned.callForReleaseWindowEndUtc, t + CALL_FOR_RELEASE_AFTER_MINUTES * 60 * 1000);
});

test('leaving releaseState anything other than EDCT/CALL_FOR_RELEASE keeps both windows null, even with a time set (mirrors voidDeadlineUtc\'s own guard)', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  store.setField(fdr.fdrId, 'assigned.edctTimeUtc', Date.now(), { by: 'CTR' });
  const result = store.setField(fdr.fdrId, 'assigned.releaseState', 'RELEASED', { by: 'CTR' });
  assert.equal(result.fdr.assigned.edctWindowStartUtc, null);
  assert.equal(result.fdr.assigned.edctWindowEndUtc, null);
});

test('switching releaseState away from EDCT clears its window even though edctTimeUtc itself is untouched', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  store.setField(fdr.fdrId, 'assigned.edctTimeUtc', Date.now(), { by: 'CTR' });
  store.setField(fdr.fdrId, 'assigned.releaseState', 'EDCT', { by: 'CTR' });
  const result = store.setField(fdr.fdrId, 'assigned.releaseState', 'HOLD_FOR_RELEASE', { by: 'CTR' });
  assert.equal(result.fdr.assigned.edctWindowStartUtc, null);
  assert.equal(result.fdr.assigned.edctWindowEndUtc, null);
});

// ── WP4A: track-degradation flag (§4.6 rule 5), docs/adr/0019 ──────────

test('identity.trackDegradationFlag defaults to NONE and is writable via setField', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  assert.equal(fdr.identity.trackDegradationFlag, 'NONE');

  const result = store.setField(fdr.fdrId, 'identity.trackDegradationFlag', 'CST', { by: 'CTR' });
  assert.equal(result.ok, true);
  assert.equal(result.fdr.identity.trackDegradationFlag, 'CST');
});

test('setField rejects an invalid track degradation flag', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const result = store.setField(fdr.fdrId, 'identity.trackDegradationFlag', 'BOGUS', { by: 'CTR' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

test('every value TRACK_DEGRADATION_FLAGS lists is accepted', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  for (const flag of TRACK_DEGRADATION_FLAGS) {
    assert.equal(store.setField(fdr.fdrId, 'identity.trackDegradationFlag', flag, { by: 'CTR' }).ok, true, flag);
  }
});

// ── WP4A: airspace ownership as a direction (§4.6.4), docs/adr/0018 ────

test('a fresh FDR\'s airspace ownership starts null (undecided), not a default direction', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  assert.deepEqual(fdr.airspace, { owner: null, changedAt: null, changedBy: null });
});

test('setAirspaceOwner accepts CONTROLLING_AGENCY and USING_AGENCY, stamping changedAt/changedBy', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });

  const result = store.setAirspaceOwner(fdr.fdrId, 'USING_AGENCY', { by: 'CTR' });
  assert.equal(result.ok, true);
  assert.equal(result.fdr.airspace.owner, 'USING_AGENCY');
  assert.equal(result.fdr.airspace.changedBy, 'CTR');
  assert.ok(Number.isFinite(result.fdr.airspace.changedAt));
});

test('defect D15: setAirspaceOwner rejects every non-direction value, including both booleans — there is NO boolean path', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  for (const bogus of [true, false, 'released', 'hot', 'cold', 1, 0, null, undefined, '']) {
    const result = store.setAirspaceOwner(fdr.fdrId, bogus, { by: 'CTR' });
    assert.equal(result.ok, false, JSON.stringify(bogus));
    assert.equal(result.reason, 'VALIDATION_ERROR', JSON.stringify(bogus));
  }
});

test('setAirspaceOwner on a nonexistent fdrId returns NOT_FOUND', () => {
  const store = new FdrStore();
  const result = store.setAirspaceOwner('does-not-exist', 'USING_AGENCY', { by: 'CTR' });
  assert.equal(result.reason, 'NOT_FOUND');
});

test('there is no generic setField path to airspace.owner at all — AIRSPACE_OWNERS/setAirspaceOwner is the only route', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const result = store.setField(fdr.fdrId, 'airspace.owner', 'USING_AGENCY', { by: 'CTR' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

test('AIRSPACE_OWNERS has exactly the two directions the guide names, nothing else', () => {
  assert.deepEqual([...AIRSPACE_OWNERS].sort(), ['CONTROLLING_AGENCY', 'USING_AGENCY']);
});
