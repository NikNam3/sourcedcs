import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// createFdr() expands §9.10 stereo routes (docs/adr/0050), so this file needs
// a table to expand against — and its own, pointed at a temp file, so it can
// never read or write the real committed config/efsp-stereo-routes.json
// (which ships empty). Set before the first import: stereo-routes.js resolves
// its path and loads once at require time.
const stereoTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-fdr-store-stereo-'));
process.env.CRCSYNC_EFSP_STEREO_ROUTES_PATH = path.join(stereoTmpDir, 'efsp-stereo-routes.json');
fs.writeFileSync(process.env.CRCSYNC_EFSP_STEREO_ROUTES_PATH, JSON.stringify([
  {
    name: 'PACK 1', description: 'north departure',
    departureAirport: 'LTAG', destinationAirport: 'LTAG',
    route: 'LTAG DCT ALPHA DCT LTAG', requestedAltitude: '250', remarks: 'squadron standard',
  },
  { name: 'PACK 9', route: 'LTAG DCT RETIRED', active: false },
]));

const {
  FdrStore, deriveEquipmentSuffix, VOID_DEADLINE_MINUTES,
  EDCT_WINDOW_MINUTES, CALL_FOR_RELEASE_BEFORE_MINUTES, CALL_FOR_RELEASE_AFTER_MINUTES,
  TRACK_DEGRADATION_FLAGS, AIRSPACE_OWNERS, RADAR_SERVICE_STATES, SEPARATION_REGIMES,
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

test('createFdr leaves modeOne/modeTwo/beaconObserved/trackRef null (WP5/WP7 hooks, inert in Phase 1)', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  assert.equal(fdr.identity.modeOne, null);
  assert.equal(fdr.identity.modeTwo, null);
  assert.equal(fdr.identity.beaconObserved, null);
  assert.equal(fdr.trackRef, null);
});

// fdr.military stopped being the `null` WP6 hook this test used to assert in
// docs/adr/0052. It is an object now, and the §12 discipline that made it
// worth asserting moved INSIDE it: the two fields WP6 delivers are seeded to
// their own defaults, and every field it does not deliver is still present and
// null, which is the property this replaces the old assertion with.
test('createFdr seeds guide §6.4\'s military namespace, with every undelivered field present and null (§12)', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  assert.equal(fdr.military.ordnanceState, 'CLEAN');   // M14, §9.5
  assert.equal(fdr.military.hookRequired, false);      // M15, §9.7
  assert.equal(fdr.military.alertStatus, 'NONE');      // M16, §9.6 — no Block yet
  for (const key of ['altrvRef', 'arInfo', 'scl', 'fuelState', 'releaseAuthority']) {
    assert.equal(fdr.military[key], null, `military.${key} must be present and null, not absent (§12)`);
  }
  for (const key of ['designator', 'entryFix', 'entryTimeUtc', 'exitFix', 'exitEstimateUtc', 'requestedAltitudeAfterExit']) {
    assert.equal(fdr.military.mtr[key], null, `military.mtr.${key} must be present and null, not absent (§12)`);
  }
});

test('two FDRs do not share one military.mtr object', () => {
  const store = new FdrStore();
  const { fdr: a } = store.createFdr(makeSeed(), { by: 'OPS' });
  const { fdr: b } = store.createFdr(makeSeed({ callsign: 'MIL0002' }), { by: 'OPS' });
  assert.notEqual(a.military, b.military);
  assert.notEqual(a.military.mtr, b.military.mtr);
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
  assert.deepEqual(fdr.airspace, { owner: null, changedAt: null, changedBy: null, transitions: [] });
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

// ── WP4A second slice, §4.6.3 — the three-field separation model ────────

test('a fresh FDR\'s tofi sub-object starts at its documented defaults, not null', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  assert.deepEqual(fdr.tofi, { ifrActive: false, radarService: null, separationRegime: null, changedAt: null, changedBy: null });
});

test('setTofi accepts a partial patch, merging into the existing sub-object rather than replacing it, and stamps changedAt/changedBy', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });

  const first = store.setTofi(fdr.fdrId, { ifrActive: true }, { by: 'CTR' });
  assert.equal(first.ok, true);
  assert.equal(first.fdr.tofi.ifrActive, true);
  assert.equal(first.fdr.tofi.radarService, null);
  assert.equal(first.fdr.tofi.changedBy, 'CTR');
  assert.ok(Number.isFinite(first.fdr.tofi.changedAt));

  const second = store.setTofi(fdr.fdrId, { radarService: 'ACTIVE' }, { by: 'TAC_C2' });
  assert.equal(second.ok, true);
  assert.equal(second.fdr.tofi.ifrActive, true); // the first patch's field survives the second, independent write
  assert.equal(second.fdr.tofi.radarService, 'ACTIVE');
});

test('defect D14: setTofi rejects an invalid radar_service or separation_regime value', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });

  const badService = store.setTofi(fdr.fdrId, { radarService: 'ON' }, { by: 'CTR' });
  assert.equal(badService.ok, false);
  assert.equal(badService.reason, 'VALIDATION_ERROR');

  const badRegime = store.setTofi(fdr.fdrId, { separationRegime: 'HOT' }, { by: 'CTR' });
  assert.equal(badRegime.ok, false);
  assert.equal(badRegime.reason, 'VALIDATION_ERROR');
});

test('setTofi accepts every documented separation_regime value, including DUE_REGARD and MARSA (mutually exclusive by construction — one enum field, not two booleans)', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  for (const regime of SEPARATION_REGIMES) {
    const result = store.setTofi(fdr.fdrId, { separationRegime: regime }, { by: 'CTR' });
    assert.equal(result.ok, true, regime);
    assert.equal(result.fdr.tofi.separationRegime, regime);
  }
});

test('setTofi on a nonexistent fdrId returns NOT_FOUND', () => {
  const store = new FdrStore();
  const result = store.setTofi('does-not-exist', { ifrActive: true }, { by: 'CTR' });
  assert.equal(result.reason, 'NOT_FOUND');
});

test('there is no generic setField path to any tofi.* field at all — setTofi is the only route (defect D14: never derivable from airspace type or anything else)', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  for (const path of ['tofi.ifrActive', 'tofi.radarService', 'tofi.separationRegime']) {
    const result = store.setField(fdr.fdrId, path, true, { by: 'CTR' });
    assert.equal(result.ok, false, path);
    assert.equal(result.reason, 'VALIDATION_ERROR', path);
  }
});

test('RADAR_SERVICE_STATES and SEPARATION_REGIMES have exactly the values the guide names, nothing else', () => {
  assert.deepEqual([...RADAR_SERVICE_STATES].sort(), ['ACTIVE', 'TERMINATED']);
  assert.deepEqual([...SEPARATION_REGIMES].sort(), ['ATC', 'DUE_REGARD', 'MARSA', 'SEE_AND_AVOID', 'USING_AGENCY']);
});

// ── identity.beaconObserved — WP5 (docs/adr/0045) ──────────────────────────
//
// The missing half of §3.10.2 rule 1's assigned-vs-observed pair. It was a
// declared-but-never-written hook through Phase 1 and Phase 2, which meant the
// three-case render the rule asks for (matching / mismatched / assigned but
// nothing received) had no data behind it, and defect D22 could not be tested.

test('setBeaconObserved records what the aircraft is actually squawking, with upstream provenance', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const result = store.setBeaconObserved(fdr.fdrId, '0056');
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(store.getFdr(fdr.fdrId).identity.beaconObserved, '0056');
  assert.equal(store.getFdr(fdr.fdrId).provenance['identity.beaconObserved'], 'UPSTREAM_TRACK');
});

test('a mismatch between assigned and observed is visible as two fields, never collapsed (defect D22)', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const assigned = store.getFdr(fdr.fdrId).identity.beaconAssigned;
  store.setBeaconObserved(fdr.fdrId, '0056');
  const after = store.getFdr(fdr.fdrId).identity;
  assert.equal(after.beaconAssigned, assigned, 'the assignment is untouched by an observation');
  assert.equal(after.beaconObserved, '0056');
  assert.notEqual(after.beaconAssigned, after.beaconObserved);
});

test('null is a real observed value — "assigned but nothing received", not an absence', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  store.setBeaconObserved(fdr.fdrId, '0056');
  const result = store.setBeaconObserved(fdr.fdrId, null);
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(store.getFdr(fdr.fdrId).identity.beaconObserved, null);
});

test('setBeaconObserved writes only on change, so a once-a-second reconciler does not churn every FDR rev', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const before = store.getFdr(fdr.fdrId).rev;

  const first = store.setBeaconObserved(fdr.fdrId, '0041');
  assert.equal(first.changed, true);
  assert.equal(store.getFdr(fdr.fdrId).rev, before + 1);

  const again = store.setBeaconObserved(fdr.fdrId, '0041');
  assert.equal(again.ok, true);
  assert.equal(again.changed, false);
  assert.equal(store.getFdr(fdr.fdrId).rev, before + 1, 'an unchanged observation is a no-op');
});

test('an observation does not stamp updatedBy — surveillance is not a controller', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  store.setBeaconObserved(fdr.fdrId, '0041');
  assert.equal(store.getFdr(fdr.fdrId).updatedBy, 'OPS', 'still whoever last actually acted');
});

test('setBeaconObserved refuses anything that is not a Mode 3/A code', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  for (const bad of ['8888', '99', '00000', 41, 'abcd', '']) {
    const result = store.setBeaconObserved(fdr.fdrId, bad);
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.equal(result.reason, 'VALIDATION_ERROR', JSON.stringify(bad));
  }
  assert.equal(store.getFdr(fdr.fdrId).identity.beaconObserved, null);
});

test('setBeaconObserved on a nonexistent fdrId returns NOT_FOUND', () => {
  const store = new FdrStore();
  assert.equal(store.setBeaconObserved('nope', '0041').reason, 'NOT_FOUND');
});

test('there is no generic setField route to identity.beaconObserved — its provenance is not a controller', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const result = store.setField(fdr.fdrId, 'identity.beaconObserved', '0056', { by: 'APP' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
});

test('trackRef stays null and has no route to being written — §6.6 rule 2 forbids what it could hold', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  assert.equal(fdr.trackRef, null);
  const result = store.setField(fdr.fdrId, 'trackRef', 'track-101', { by: 'APP' });
  assert.equal(result.ok, false);
  assert.equal(store.getFdr(fdr.fdrId).trackRef, null);
});

// ── §9.10 stereo routes (docs/adr/0050) ──────────────────────────────────

test('ACCEPTANCE (WP6): a stereo route filed by short name produces a complete FDR', () => {
  // The guide's own acceptance criterion for this deliverable, word for word.
  // Callsign and short name are ALL that is supplied — everything else comes
  // out of the table, which is what "does not require a full flight-plan
  // form" (§9.10) means in practice.
  const store = new FdrStore();
  const { ok, fdr } = store.createFdr({ callsign: 'PACK11', stereoRouteName: 'PACK1' }, { by: 'OPS' });
  assert.equal(ok, true);
  assert.equal(fdr.filed.route, 'LTAG DCT ALPHA DCT LTAG');
  assert.equal(fdr.filed.requestedAltitude, '250');
  assert.equal(fdr.filed.departureAirport, 'LTAG');
  assert.equal(fdr.filed.destinationAirport, 'LTAG');
  assert.equal(fdr.filed.remarks, 'squadron standard');
  assert.equal(fdr.filed.stereoRouteName, 'PACK 1');
});

test('the FDR records the table\'s canonical name, not the spelling that was typed', () => {
  const store = new FdrStore();
  for (const typed of ['PACK1', 'pack 1', 'pack-1']) {
    const { fdr } = store.createFdr({ callsign: 'VIPER1', stereoRouteName: typed }, { by: 'OPS' });
    assert.equal(fdr.filed.stereoRouteName, 'PACK 1', `typed ${typed}`);
  }
});

test('an unknown stereo name is refused outright, not silently blanked', () => {
  // Deliberately unlike flight-plan-lookup.js's never-block contract: that
  // fronts a remote service that can be down, this is local config, and "not
  // in the table" is a wrong answer rather than a transient failure.
  const store = new FdrStore();
  const result = store.createFdr({ callsign: 'VIPER1', stereoRouteName: 'PACK99' }, { by: 'OPS' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
  assert.match(result.detail, /PACK99 is not a configured stereo route/);
});

test('a retired stereo route is refused with its own message, not reported as a typo', () => {
  const store = new FdrStore();
  const result = store.createFdr({ callsign: 'VIPER1', stereoRouteName: 'pack9' }, { by: 'OPS' });
  assert.equal(result.ok, false);
  assert.match(result.detail, /PACK 9 is not an active stereo route/);
});

test('a refused stereo filing burns no beacon code — the check runs before allocate()', () => {
  // The "a denied CreateStrip has no side effects" property. Get this
  // ordering wrong and every typo leaks a code out of a finite pool.
  const store = new FdrStore();
  const before = store.createFdr({ callsign: 'FIRST' }, { by: 'OPS' });
  assert.equal(store.createFdr({ callsign: 'NOPE', stereoRouteName: 'PACK99' }, { by: 'OPS' }).ok, false);
  assert.equal(store.createFdr({ callsign: 'NOPE2', stereoRouteName: 'PACK9' }, { by: 'OPS' }).ok, false);
  const after = store.createFdr({ callsign: 'SECOND' }, { by: 'OPS' });
  // Two refusals in between cost exactly nothing: the next code is the one
  // that would have followed anyway.
  assert.equal(
    Number.parseInt(after.fdr.identity.beaconAssigned, 8) - Number.parseInt(before.fdr.identity.beaconAssigned, 8),
    1);
});

test('an explicitly supplied field beats the stereo\'s — the table is a template, not an override', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(
    { callsign: 'VIPER1', stereoRouteName: 'PACK1', destinationAirport: 'LTAC', requestedAltitude: '310' },
    { by: 'OPS' });
  assert.equal(fdr.filed.destinationAirport, 'LTAC');
  assert.equal(fdr.filed.requestedAltitude, '310');
  // Everything not explicitly given still comes from the table.
  assert.equal(fdr.filed.route, 'LTAG DCT ALPHA DCT LTAG');
  assert.equal(fdr.filed.departureAirport, 'LTAG');
  // And the flight is still on PACK 1 — an amended destination does not
  // un-file it.
  assert.equal(fdr.filed.stereoRouteName, 'PACK 1');
});

test('a blank or absent stereoRouteName leaves every existing caller behaving identically', () => {
  const store = new FdrStore();
  for (const seed of [makeSeed(), makeSeed({ stereoRouteName: '' }), makeSeed({ stereoRouteName: null })]) {
    const { ok, fdr } = store.createFdr(seed, { by: 'OPS' });
    assert.equal(ok, true);
    assert.equal(fdr.filed.stereoRouteName, '');
    assert.equal(fdr.filed.route, 'DCT');
  }
});

test('fields the table filled are COMPUTER_GENERATED, fields the controller gave are not (§10.5)', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr({ callsign: 'VIPER1', stereoRouteName: 'PACK1', destinationAirport: 'LTAC' }, { by: 'OPS' });
  assert.equal(fdr.provenance['filed.route'], 'COMPUTER_GENERATED');
  assert.equal(fdr.provenance['filed.stereoRouteName'], 'COMPUTER_GENERATED');
  assert.equal(fdr.provenance['filed.destinationAirport'], undefined);
});

test('writing filed.stereoRouteName RE-FILES the flight — route and altitude come from the table', () => {
  // "VIPER11, request change to PACK 2." Naming a different route IS the
  // amendment; leaving the old route under the new label would be a lie the
  // standing-release matcher then believes.
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  assert.equal(fdr.filed.route, 'DCT');
  const revBefore = fdr.rev; // the store hands back the live object, so read it before the write

  const result = store.setField(fdr.fdrId, 'filed.stereoRouteName', 'pack1', { by: 'CD' });
  assert.equal(result.ok, true);
  assert.equal(result.fdr.filed.stereoRouteName, 'PACK 1'); // canonical, not what was typed
  assert.equal(result.fdr.filed.route, 'LTAG DCT ALPHA DCT LTAG');
  assert.equal(result.fdr.filed.requestedAltitude, '250');
  assert.equal(result.fdr.filed.departureAirport, 'LTAG');
  assert.equal(result.fdr.filed.destinationAirport, 'LTAG');
  assert.equal(result.fdr.rev, revBefore + 1);
});

test('a re-file overwrites the previous route unconditionally — no stale leg survives it', () => {
  // The opposite precedence from createFdr's, on purpose: there an explicit
  // seed value is the controller's entry and wins; here the explicit entry
  // IS the route name.
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed({ requestedAltitude: '310', destinationAirport: 'LTAC' }), { by: 'OPS' });
  const { fdr: refiled } = store.setField(fdr.fdrId, 'filed.stereoRouteName', 'PACK 1', { by: 'CD' });
  assert.equal(refiled.filed.requestedAltitude, '250');
  assert.equal(refiled.filed.destinationAirport, 'LTAG');
});

test('a re-file leaves remarks and the issued clearance alone', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed({ remarks: 'PPR 1420, tail swap' }), { by: 'OPS' });
  store.setField(fdr.fdrId, 'assigned.clearedRoute', 'AS FILED, RADAR VECTORS', { by: 'CD' });
  const { fdr: refiled } = store.setField(fdr.fdrId, 'filed.stereoRouteName', 'PACK 1', { by: 'CD' });
  // Remarks are controller free text with nothing to do with the route;
  // clearedRoute is a clearance already issued to the pilot (§3.1).
  assert.equal(refiled.filed.remarks, 'PPR 1420, tail swap');
  assert.equal(refiled.assigned.clearedRoute, 'AS FILED, RADAR VECTORS');
});

test('re-filing onto an unknown or retired route writes NOTHING and does not bump rev', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr({ callsign: 'PACK11', stereoRouteName: 'PACK1' }, { by: 'OPS' });
  const before = JSON.stringify(store.getFdr(fdr.fdrId));

  for (const [name, pattern] of [['PACK99', /not a configured stereo route/], ['PACK 9', /not an active stereo route/]]) {
    const result = store.setField(fdr.fdrId, 'filed.stereoRouteName', name, { by: 'CD' });
    assert.equal(result.ok, false, name);
    assert.match(result.detail, pattern);
  }
  // A half-applied re-file would leave the label and the route disagreeing,
  // which is the exact state this design exists to prevent.
  assert.equal(JSON.stringify(store.getFdr(fdr.fdrId)), before);
});

test('clearing the stereo name un-labels the flight without blanking its route', () => {
  // "Cancel the stereo" must never leave a taxiing aircraft with no route.
  const store = new FdrStore();
  const { fdr } = store.createFdr({ callsign: 'PACK11', stereoRouteName: 'PACK1' }, { by: 'OPS' });
  for (const empty of ['', '   ', null]) {
    store.setField(fdr.fdrId, 'filed.stereoRouteName', 'PACK 1', { by: 'CD' }); // re-label first
    const { ok, fdr: cleared } = store.setField(fdr.fdrId, 'filed.stereoRouteName', empty, { by: 'CD' });
    assert.equal(ok, true, JSON.stringify(empty));
    assert.equal(cleared.filed.stereoRouteName, '');
    assert.equal(cleared.filed.route, 'LTAG DCT ALPHA DCT LTAG');
  }
});

test('a re-filed route is COMPUTER_GENERATED, and the name the controller typed is not', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const { fdr: refiled } = store.setField(fdr.fdrId, 'filed.stereoRouteName', 'PACK 1', { by: 'CD' });
  assert.equal(refiled.provenance['filed.route'], 'COMPUTER_GENERATED');
  assert.equal(refiled.provenance['filed.stereoRouteName'], 'CONTROLLER_ENTERED');
});

test('amending the route clears the stereo name — an amended route is no longer the canned one', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr({ callsign: 'PACK11', stereoRouteName: 'PACK1' }, { by: 'OPS' });
  assert.equal(fdr.filed.stereoRouteName, 'PACK 1');
  const result = store.setField(fdr.fdrId, 'filed.route', 'LTAG DCT DELTA', { by: 'CD' });
  assert.equal(result.ok, true);
  assert.equal(result.fdr.filed.stereoRouteName, '');
  assert.equal(result.fdr.filed.route, 'LTAG DCT DELTA');
});

test('amending any OTHER filed field leaves the stereo name alone', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr({ callsign: 'PACK11', stereoRouteName: 'PACK1' }, { by: 'OPS' });
  for (const path of ['filed.requestedAltitude', 'filed.destinationAirport', 'filed.remarks']) {
    assert.equal(store.setField(fdr.fdrId, path, 'CHANGED', { by: 'CD' }).ok, true);
    assert.equal(store.getFdr(fdr.fdrId).filed.stereoRouteName, 'PACK 1', `after ${path}`);
  }
});

// ── WP6 (docs/adr/0052) — guide §6.4's military extension namespace ────────

test('setMilitary writes the ordnance state and the hook requirement, and bumps rev', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const before = fdr.rev;

  const loaded = store.setMilitary(fdr.fdrId, { ordnanceState: 'LOADED' }, { by: 'OPS' });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.fdr.military.ordnanceState, 'LOADED');
  assert.equal(loaded.fdr.military.hookRequired, false, 'a partial patch leaves the other fields alone');
  assert.equal(loaded.fdr.rev, before + 1);
  assert.equal(loaded.fdr.provenance.military, 'CONTROLLER_ENTERED');

  const hook = store.setMilitary(fdr.fdrId, { hookRequired: true }, { by: 'TWR' });
  assert.equal(hook.fdr.military.hookRequired, true);
  assert.equal(hook.fdr.military.ordnanceState, 'LOADED', 'and does not undo the earlier one');
});

test('setMilitary refuses a value outside either enum', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  for (const patch of [{ ordnanceState: 'ARMED' }, { alertStatus: 'READY' }]) {
    const result = store.setMilitary(fdr.fdrId, patch, { by: 'OPS' });
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.equal(result.reason, 'VALIDATION_ERROR');
  }
  assert.equal(store.getFdr(fdr.fdrId).military.ordnanceState, 'CLEAN', 'a refusal leaves the record untouched');
});

// D15's shape: hookRequired is a bare boolean, so the one thing that must not
// happen is a truthy STRING landing in it — "false" would read as true forever
// after, and the field decides whether an arrival is gated on rigged gear.
test('setMilitary refuses a non-boolean hookRequired rather than coercing it', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  for (const value of ['false', 'true', 1, 0, null]) {
    const result = store.setMilitary(fdr.fdrId, { hookRequired: value }, { by: 'OPS' });
    assert.equal(result.ok, false, JSON.stringify(value));
  }
  assert.equal(store.getFdr(fdr.fdrId).military.hookRequired, false);
});

test('setMilitary refuses a field WP6 does not deliver, rather than growing one', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  for (const key of ['mtr', 'altrvRef', 'arInfo', 'scl', 'fuelState', 'releaseAuthority', 'ordnanceStat']) {
    const result = store.setMilitary(fdr.fdrId, { [key]: 'anything' }, { by: 'OPS' });
    assert.equal(result.ok, false, key);
    assert.match(result.detail, new RegExp(`military\\.${key} is not writable`));
  }
});

test('setField cannot reach the military namespace — every path but the six MTR leaves routes through setMilitary', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  for (const path of ['military', 'military.ordnanceState', 'military.hookRequired', 'military.alertStatus', 'military.mtr']) {
    const result = store.setField(fdr.fdrId, path, 'HUNG', { by: 'OPS' });
    assert.equal(result.ok, false, path);
    assert.equal(result.reason, 'VALIDATION_ERROR');
  }
});

// The durable-snapshot case. Every board that has ever run carries FDRs whose
// `military` is the literal null it was before docs/adr/0052, and a §9.5/§9.7
// reader must not throw on exactly the flights that were already airborne
// when the service restarted.
test('restore seeds the military namespace onto an FDR written before it existed', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const legacy = JSON.parse(JSON.stringify(store.snapshot()));
  legacy.fdrs[0].military = null;

  const restored = new FdrStore();
  restored.restore(legacy);
  const back = restored.getFdr(fdr.fdrId);
  assert.equal(back.military.ordnanceState, 'CLEAN');
  assert.equal(back.military.hookRequired, false);
  assert.equal(back.military.mtr.designator, null);
  assert.equal(restored.setMilitary(fdr.fdrId, { ordnanceState: 'HUNG' }, { by: 'OPS' }).ok, true);
});

// F-206 — both TOFI enum fields START as null, and null is a real, renderable
// state ("no radar service", "the regime has not been stated"), so clearing one
// is a meaningful controller action. A picker's "—" option sends the empty
// string, which is the same intent spelled the way a <select> spells it.
test('setTofi clears radar_service and separation_regime, whether the clear arrives as null or as an empty string', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  store.setTofi(fdr.fdrId, { radarService: 'ACTIVE', separationRegime: 'DUE_REGARD' }, { by: 'CTR' });

  const byEmptyString = store.setTofi(fdr.fdrId, { separationRegime: '' }, { by: 'CTR' });
  assert.equal(byEmptyString.ok, true);
  assert.equal(byEmptyString.fdr.tofi.separationRegime, null);
  assert.equal(byEmptyString.fdr.tofi.radarService, 'ACTIVE', 'the other field is untouched');

  const byNull = store.setTofi(fdr.fdrId, { radarService: null }, { by: 'CTR' });
  assert.equal(byNull.ok, true);
  assert.equal(byNull.fdr.tofi.radarService, null);
});

// The four enum Blocks whose field has no "unset" value to return to. Their
// cleared state is a member of the enum itself (NONE / CLEAN), or the field is
// exhaustive — so the server refuses, and the picker must not offer "—".
test('the enum fields with no null state refuse being cleared', () => {
  const store = new FdrStore();
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  assert.equal(store.setField(fdr.fdrId, 'identity.trackDegradationFlag', '', { by: 'CTR' }).ok, false); // Block 5A — NONE is the clear
  assert.equal(store.setField(fdr.fdrId, 'assigned.releaseState', '', { by: 'CTR' }).ok, false);         // Block 14A — §3.8's six states are exhaustive
  assert.equal(store.setAirspaceOwner(fdr.fdrId, '', { by: 'CTR' }).ok, false);                          // Block 24A — a DIRECTION, never absent (D15)
  assert.equal(store.setMilitary(fdr.fdrId, { ordnanceState: '' }, { by: 'CTR' }).ok, false);            // Block 3G — CLEAN is the clear
});


// ── §9.4 MTR fields (docs/adr/0062) — the six military.mtr.* leaves ──────────

const { normalizeMtrValue } = await import('../src/efsp/fdr-store.js');
const { resolveZuluHhmm, formatZuluHhmm, parseZuluHhmm } = await import('../src/efsp/zulu-time.js');

// A mission clock fixed on a date nothing else uses, so a time resolved
// against the WALL date would visibly land on the wrong day.
const MISSION_NOW = Date.UTC(2016, 5, 21, 14, 0);
const missionClock = { now: () => MISSION_NOW, source: 'MISSION' };
const MTR_PATHS = ['designator', 'entryFix', 'entryTimeUtc', 'exitFix', 'exitEstimateUtc', 'requestedAltitudeAfterExit']
  .map(k => `military.mtr.${k}`);

test('each of the six MTR paths is writable through setField, and bumps rev and updatedAt', () => {
  const store = new FdrStore(undefined, { clock: missionClock });
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const values = { designator: 'ir107', entryFix: ' a ', entryTimeUtc: '1405', exitFix: 'f', exitEstimateUtc: '1432', requestedAltitudeAfterExit: 'fl190' };
  for (const [key, value] of Object.entries(values)) {
    const before = store.getFdr(fdr.fdrId).rev;
    const result = store.setField(fdr.fdrId, `military.mtr.${key}`, value, { by: 'CTR' });
    assert.equal(result.ok, true, key);
    assert.equal(result.fdr.rev, before + 1, key);
    assert.equal(result.fdr.updatedAt, MISSION_NOW, `${key}: an MTR write is a filed-plan amendment (updatedAt)`);
  }
  const mtr = store.getFdr(fdr.fdrId).military.mtr;
  assert.deepEqual(mtr, {
    designator: 'IR107', entryFix: 'A', entryTimeUtc: Date.UTC(2016, 5, 21, 14, 5),
    exitFix: 'F', exitEstimateUtc: Date.UTC(2016, 5, 21, 14, 32), requestedAltitudeAfterExit: 'FL190',
  });
});

test('MTR times are stored as epoch ms on the MISSION date, typed as HHMM / HH:MM / trailing Z', () => {
  const store = new FdrStore(undefined, { clock: missionClock });
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  for (const typed of ['1432', '14:32', '1432Z', '14:32z']) {
    const r = store.setField(fdr.fdrId, 'military.mtr.exitEstimateUtc', typed, { by: 'CTR' });
    assert.equal(r.ok, true, typed);
    assert.equal(r.fdr.military.mtr.exitEstimateUtc, Date.UTC(2016, 5, 21, 14, 32), typed);
  }
});

test('MTR times refuse what is not a time of day, legibly, and leave the FDR byte-identical', () => {
  const store = new FdrStore(undefined, { clock: missionClock });
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  store.setField(fdr.fdrId, 'military.mtr.exitEstimateUtc', '1432', { by: 'CTR' });
  const before = JSON.stringify(store.getFdr(fdr.fdrId));
  for (const bad of ['2460', '1260', 'abc', '143', '14320', '1472']) {
    const r = store.setField(fdr.fdrId, 'military.mtr.exitEstimateUtc', bad, { by: 'CTR' });
    assert.equal(r.ok, false, bad);
    assert.equal(r.reason, 'VALIDATION_ERROR');
    assert.match(r.detail, /MTR exit estimate must be a UTC time as HHMM/);
  }
  const entry = store.setField(fdr.fdrId, 'military.mtr.entryTimeUtc', '2400', { by: 'OPS' });
  assert.match(entry.detail, /MTR entry time must be a UTC time as HHMM/);
  assert.equal(JSON.stringify(store.getFdr(fdr.fdrId)), before);
});

test('the requested altitude after exit takes whatever parseAltitudeFt parses, and refuses the rest', () => {
  const store = new FdrStore(undefined, { clock: missionClock });
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  for (const [typed, stored] of [['FL210', 'FL210'], ['080', '080'], ['8000', '8000'], [' fl 190 ', 'FL190'], ['A050', 'A050']]) {
    const r = store.setField(fdr.fdrId, 'military.mtr.requestedAltitudeAfterExit', typed, { by: 'CTR' });
    assert.equal(r.ok, true, typed);
    assert.equal(r.fdr.military.mtr.requestedAltitudeAfterExit, stored, typed);
  }
  const rev = store.getFdr(fdr.fdrId).rev;
  for (const bad of ['high', 'FL190B210']) {
    const r = store.setField(fdr.fdrId, 'military.mtr.requestedAltitudeAfterExit', bad, { by: 'CTR' });
    assert.equal(r.ok, false, bad);
    assert.match(r.detail, /requested altitude after exit must be an altitude/);
  }
  assert.equal(store.getFdr(fdr.fdrId).rev, rev);
});

test('an empty MTR value clears to null, on every one of the six paths', () => {
  const store = new FdrStore(undefined, { clock: missionClock });
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const fill = ['IR107', 'A', '1405', 'F', '1432', 'FL190'];
  MTR_PATHS.forEach((p, i) => store.setField(fdr.fdrId, p, fill[i], { by: 'CTR' }));
  for (const p of MTR_PATHS) {
    for (const empty of ['', '   ', null]) {
      const r = store.setField(fdr.fdrId, p, empty, { by: 'CTR' });
      assert.equal(r.ok, true, `${p} ${JSON.stringify(empty)}`);
      assert.equal(r.fdr.military.mtr[p.split('.').pop()], null);
    }
  }
});

test('designator and fixes take no format rule (D11) — any text, trimmed and upper-cased', () => {
  const store = new FdrStore(undefined, { clock: missionClock });
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  for (const typed of ['vr1203', 'sr 44', 'BAKER/10', 'x']) {
    const r = store.setField(fdr.fdrId, 'military.mtr.designator', typed, { by: 'OPS' });
    assert.equal(r.ok, true, typed);
    assert.equal(r.fdr.military.mtr.designator, typed.trim().toUpperCase());
  }
  const long = store.setField(fdr.fdrId, 'military.mtr.exitFix', 'X'.repeat(2001), { by: 'CTR' });
  assert.equal(long.ok, false, 'the ordinary free-text cap still applies');
});

test('setMilitary still refuses mtr, whole — the leaves go through setField only', () => {
  const store = new FdrStore(undefined, { clock: missionClock });
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const r = store.setMilitary(fdr.fdrId, { mtr: { designator: 'IR107' } }, { by: 'OPS' });
  assert.equal(r.ok, false);
  assert.equal(store.getFdr(fdr.fdrId).military.mtr.designator, null);
});

test('an FDR restored from before docs/adr/0052 (military: null) accepts an MTR write', () => {
  const store = new FdrStore(undefined, { clock: missionClock });
  const { fdr } = store.createFdr(makeSeed(), { by: 'OPS' });
  const legacy = JSON.parse(JSON.stringify(store.snapshot()));
  legacy.fdrs[0].military = null;
  const restored = new FdrStore(undefined, { clock: missionClock });
  restored.restore(legacy);
  const r = restored.setField(fdr.fdrId, 'military.mtr.exitFix', 'E', { by: 'CTR' });
  assert.equal(r.ok, true);
  assert.equal(r.fdr.military.mtr.exitFix, 'E');
  // …and even one whose military was nulled after restore (setPath would throw).
  restored.getFdr(fdr.fdrId).military = null;
  assert.equal(restored.setField(fdr.fdrId, 'military.mtr.designator', 'IR107', { by: 'CTR' }).ok, true);
});

test('normalizeMtrValue takes an epoch number for a time as-is (an import or a scenario)', () => {
  const ms = Date.UTC(2016, 5, 21, 14, 32);
  assert.deepEqual(normalizeMtrValue('military.mtr.exitEstimateUtc', ms, MISSION_NOW), { ok: true, value: ms });
  assert.equal(normalizeMtrValue('military.mtr.designator', 107, MISSION_NOW).value, '107');
});

// ── zulu-time.js — a typed HHMM dated by the mission clock ──────────────────

test('resolveZuluHhmm dates a time on the mission clock\'s day, never the wall clock\'s', () => {
  assert.equal(resolveZuluHhmm('1432', MISSION_NOW), Date.UTC(2016, 5, 21, 14, 32));
  assert.equal(resolveZuluHhmm('0300', MISSION_NOW), Date.UTC(2016, 5, 21, 3, 0), '11 h back beats 13 h ahead');
  assert.equal(resolveZuluHhmm('0100', MISSION_NOW), Date.UTC(2016, 5, 22, 1, 0), '11 h ahead beats 13 h back');
});

test('resolveZuluHhmm takes the occurrence nearest now, across Zulu midnight both ways', () => {
  const lateEvening = Date.UTC(2016, 5, 21, 23, 50);
  assert.equal(resolveZuluHhmm('0010', lateEvening), Date.UTC(2016, 5, 22, 0, 10), 'a time just after midnight is tomorrow');
  const earlyMorning = Date.UTC(2016, 5, 22, 0, 5);
  assert.equal(resolveZuluHhmm('2355', earlyMorning), Date.UTC(2016, 5, 21, 23, 55), 'a time just before midnight is yesterday');
});

test('parseZuluHhmm / formatZuluHhmm round-trip and refuse non-times', () => {
  assert.deepEqual(parseZuluHhmm('14:32z'), { hh: 14, mm: 32 });
  for (const bad of ['2460', '1260', '143', '', null, 'abcd', '14.32']) assert.equal(parseZuluHhmm(bad), null, String(bad));
  assert.equal(formatZuluHhmm(Date.UTC(2016, 5, 21, 9, 5)), '0905');
  assert.equal(formatZuluHhmm(null), '');
  assert.equal(resolveZuluHhmm('1432', NaN), null);
});

// ── docs/adr/0073 — §10.5's stored input, and the vul window's typed times ──
//
// A mission clock years from the wall clock (T7, H11): a time dated by the
// wall date would land visibly on the wrong day.
const MISSION_DAY = (hh, mm, day = 21) => Date.UTC(2016, 5, day, hh, mm);
function missionStore(nowMs) {
  return new FdrStore(undefined, { clock: { now: () => nowMs, source: 'MISSION' } });
}

test('0073: createFdr dates the DD1801 departure time by the mission clock into fdr.timeInputs', () => {
  const store = missionStore(MISSION_DAY(13, 50));
  const { fdr } = store.createFdr(makeSeed({ flightPlanDepartureTimeHhmm: '1430' }), { by: 'c-OPS' });
  assert.deepEqual(fdr.timeInputs, { flightPlanDepartureUtc: MISSION_DAY(14, 30) });
  // Not the controller's field: a cleared P-time falls back to the plan instead of losing it.
  assert.equal(fdr.filed.proposedDepartureTimeUtc, null);
});

test('0073: a DD1801 departure time that is not a time is dropped, never a refusal', () => {
  const store = missionStore(MISSION_DAY(13, 50));
  for (const junk of ['garbage', '2561', '', undefined]) {
    const r = store.createFdr(makeSeed({ flightPlanDepartureTimeHhmm: junk }), { by: 'c-OPS' });
    assert.equal(r.ok, true, String(junk));
    assert.deepEqual(r.fdr.timeInputs, { flightPlanDepartureUtc: null }, String(junk));
  }
});

test('0073: restore() seeds timeInputs onto an FDR persisted before it, so a reader never throws (T9)', () => {
  const store = missionStore(MISSION_DAY(13, 50));
  const { fdr } = store.createFdr(makeSeed(), { by: 'c-OPS' });
  const old = JSON.parse(JSON.stringify(fdr));
  delete old.timeInputs;
  const restored = missionStore(MISSION_DAY(13, 50));
  restored.restore({ fdrs: [old], codes: store.snapshot().codes });
  assert.deepEqual(restored.getFdr(fdr.fdrId).timeInputs, { flightPlanDepartureUtc: null });
});

test('S-F4: a typed vul start resolves like any typed time; a typed end to the first occurrence after the start', () => {
  const store = missionStore(MISSION_DAY(20, 0));
  const { fdr } = store.createFdr(makeSeed(), { by: 'c-TAC_C2' });
  assert.equal(store.setField(fdr.fdrId, 'mission.vulWindowStartUtc', '2200', { by: 'c-TAC_C2' }).ok, true);
  assert.equal(store.getFdr(fdr.fdrId).mission.vulWindowStartUtc, MISSION_DAY(22, 0));
  // 0200 is nearer to now (2000Z) on the SAME day, 18 h back — but an end is after its start.
  store.setField(fdr.fdrId, 'mission.vulWindowEndUtc', '0200', { by: 'c-TAC_C2' });
  assert.equal(store.getFdr(fdr.fdrId).mission.vulWindowEndUtc, MISSION_DAY(2, 0, 22));
  // And a window may run longer than 12 h: 2130 after a 2200 start is the next evening.
  store.setField(fdr.fdrId, 'mission.vulWindowEndUtc', '2130', { by: 'c-TAC_C2' });
  assert.equal(store.getFdr(fdr.fdrId).mission.vulWindowEndUtc, MISSION_DAY(21, 30, 22));
});

test('S-F4: a typed vul end with no start resolves to the nearest occurrence; junk is refused with no write', () => {
  const store = missionStore(MISSION_DAY(23, 50));
  const { fdr } = store.createFdr(makeSeed(), { by: 'c-TAC_C2' });
  store.setField(fdr.fdrId, 'mission.vulWindowEndUtc', '0030', { by: 'c-TAC_C2' });
  assert.equal(store.getFdr(fdr.fdrId).mission.vulWindowEndUtc, MISSION_DAY(0, 30, 22));
  const rev = store.getFdr(fdr.fdrId).rev;
  const r = store.setField(fdr.fdrId, 'mission.vulWindowStartUtc', 'NOSUCH', { by: 'c-TAC_C2' });
  assert.deepEqual(r, { ok: false, reason: 'VALIDATION_ERROR', detail: 'vul window start must be a UTC time as HHMM, e.g. 1432' });
  assert.equal(store.getFdr(fdr.fdrId).rev, rev);
  store.setField(fdr.fdrId, 'mission.vulWindowEndUtc', '', { by: 'c-TAC_C2' });
  assert.equal(store.getFdr(fdr.fdrId).mission.vulWindowEndUtc, null);
});

test('S-F4: the ATO\'s epoch-ms vul window passes createFdr untouched, and a typed seed is resolved', () => {
  const store = missionStore(MISSION_DAY(20, 0));
  const ato = store.createFdr(makeSeed({ vulWindowStartUtc: MISSION_DAY(6, 0), vulWindowEndUtc: MISSION_DAY(5, 0) }), { by: 'ato' }).fdr;
  assert.deepEqual([ato.mission.vulWindowStartUtc, ato.mission.vulWindowEndUtc], [MISSION_DAY(6, 0), MISSION_DAY(5, 0)]);
  const typed = store.createFdr(makeSeed({ vulWindowStartUtc: '2200', vulWindowEndUtc: '0100' }), { by: 'c-TAC_C2' }).fdr;
  assert.deepEqual([typed.mission.vulWindowStartUtc, typed.mission.vulWindowEndUtc], [MISSION_DAY(22, 0), MISSION_DAY(1, 0, 22)]);
});

test('0073: resolveZuluHhmmAfter is the first occurrence strictly after its anchor', async () => {
  const { resolveZuluHhmmAfter } = await import('../src/efsp/zulu-time.js');
  assert.equal(resolveZuluHhmmAfter('2300', MISSION_DAY(22, 0)), MISSION_DAY(23, 0));
  assert.equal(resolveZuluHhmmAfter('2200', MISSION_DAY(22, 0)), MISSION_DAY(22, 0, 22), 'equal to the anchor is the next day');
  assert.equal(resolveZuluHhmmAfter('0100', MISSION_DAY(22, 0)), MISSION_DAY(1, 0, 22));
  assert.equal(resolveZuluHhmmAfter('2561', MISSION_DAY(22, 0)), null);
  assert.equal(resolveZuluHhmmAfter('1432', NaN), null);
});
