import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// facility-config.js reads its config paths once at module load — set both
// override env vars before the first import, same pattern as
// theater-settings.test.mjs. WP4A (docs/adr/0013) added a second Facility
// with its own path/env var — omitting this one would let a test that
// mutates CENTER's config (setFacilityConfig(..., 'CENTER')) write
// straight to the real, committed config/efsp-facility-center.json.
const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-facility-config-test-'));
const tmpFile = path.join(tmpDir, 'efsp-facility-incirlik.json');
const tmpFileCenter = path.join(tmpDir, 'efsp-facility-center.json');
const tmpFileTactical = path.join(tmpDir, 'efsp-facility-tactical.json');
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = tmpFile;
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER = tmpFileCenter;
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL = tmpFileTactical;

const {
  getFacilityIds, getFacilityConfig, getPositionSet, getPositionClass, getCoveringChain, getBaysFor, getAllBays,
  bayImpliesState, bayForImpliedState, coordinationBayFor, setFacilityConfig, validateConfig, isBlockVisible,
  DEFAULT_CONFIG, DEFAULT_CENTER_CONFIG, DEFAULT_TACTICAL_CONFIG, DEFAULT_FACILITY_ID,
} = await import('../src/efsp/facility-config.js');
const { DEPARTURE_BLOCK_MAP, OVERFLIGHT_BLOCK_MAP, MISSION_BLOCK_MAP, requiredBlocksFor } = await import('../src/efsp/block-map.js');

test('getPositionSet returns exactly INCIRLIK\'s five Phase 2 Positions', () => {
  assert.deepEqual(getPositionSet(), ['OPS', 'CD', 'GND', 'TWR', 'APP']);
});

test('getCoveringChain matches the guide\'s default chain, un-truncated through APP (Phase 2)', () => {
  assert.deepEqual(getCoveringChain(), { CD: 'GND', GND: 'TWR', TWR: 'APP' });
});

test('OPS and APP have no entry in the covering chain — OPS per the guide\'s table, APP because there\'s no CTR Facility yet to cover it', () => {
  const chain = getCoveringChain();
  assert.equal('OPS' in chain, false);
  assert.equal('APP' in chain, false);
});

test('every Position in the Position set has at least one Bay, including a Coordination Bay (WP4A seam, present but inert)', () => {
  for (const id of getPositionSet()) {
    const bays = getBaysFor(id);
    assert.ok(bays.length > 0, id);
    assert.ok(bays.some(b => b.bayId.endsWith('-coordination')), `${id} has no Coordination Bay`);
  }
});

test('getBaysFor an unknown Position returns an empty array, not a throw', () => {
  assert.deepEqual(getBaysFor('NOT_A_POSITION'), []);
});

test('bayImpliesState resolves the known state-implying Bays from the guide\'s Bay-name mapping', () => {
  assert.equal(bayImpliesState('ops-proposed'), 'PROPOSED');
  assert.equal(bayImpliesState('cd-pending-clearance'), 'PENDING_CLEARANCE');
  assert.equal(bayImpliesState('cd-cleared'), 'CLEARED');
  assert.equal(bayImpliesState('cd-held'), 'HELD');
  assert.equal(bayImpliesState('gnd-pushback'), 'PUSHBACK');
  assert.equal(bayImpliesState('gnd-taxi-out'), 'TAXI');
  assert.equal(bayImpliesState('gnd-taxi-in'), 'TAXI_IN'); // ARRIVAL role, Phase 2
  assert.equal(bayImpliesState('twr-runway-queue'), 'RUNWAY_QUEUE');
  assert.equal(bayImpliesState('twr-airborne'), 'DEPARTED');
  assert.equal(bayImpliesState('twr-arrivals'), 'HANDED_TO_TOWER'); // ARRIVAL role, Phase 2
  assert.equal(bayImpliesState('twr-final'), 'FINAL'); // ARRIVAL role, Phase 2 — EfspState, not Strip Role
  assert.equal(bayImpliesState('twr-landed'), 'LANDED'); // ARRIVAL role, Phase 2
  assert.equal(bayImpliesState('app-inbound'), 'INBOUND'); // Phase 2
  assert.equal(bayImpliesState('app-departures'), 'HANDED_OFF'); // Phase 2
});

test('bayImpliesState returns null for Bays with no implied state, and for unknown Bay ids', () => {
  for (const id of ['ops-filed', 'ops-coordination', 'cd-coordination', 'gnd-coordination', 'twr-coordination', 'app-coordination']) {
    assert.equal(bayImpliesState(id), null, id);
  }
  assert.equal(bayImpliesState('not-a-real-bay'), null);
});

test('TWR\'s runway-queue Bay has one Rack per configured runway (guide §4.2)', () => {
  const twrBays = getBaysFor('TWR');
  const runwayQueue = twrBays.find(b => b.bayId === 'twr-runway-queue');
  assert.ok(runwayQueue.rackIds.length >= 2);
});

test('getAllBays tags every Bay with its owning positionId — required to keep Bays grouped by Position client-side (guide §4.8.5 rule 2)', () => {
  const all = getAllBays();
  const opsProposed = all.find(b => b.bayId === 'ops-proposed');
  const gndPushback = all.find(b => b.bayId === 'gnd-pushback');
  assert.equal(opsProposed.positionId, 'OPS');
  assert.equal(gndPushback.positionId, 'GND');
  assert.ok(all.every(b => typeof b.positionId === 'string' && b.positionId.length > 0));
});

test('getAllBays returns every Bay across every Position, flattened', () => {
  const all = getAllBays();
  const total = getPositionSet().reduce((sum, id) => sum + getBaysFor(id).length, 0);
  assert.equal(all.length, total);
});

test('getFacilityConfig returns a deep copy — mutating it never affects subsequent calls', () => {
  const cfg = getFacilityConfig();
  cfg.positions.push('HACKED');
  cfg.bays.OPS[0].bayId = 'tampered';
  assert.deepEqual(getPositionSet(), ['OPS', 'CD', 'GND', 'TWR', 'APP']);
  assert.equal(getBaysFor('OPS')[0].bayId, 'ops-proposed');
});

test('setFacilityConfig persists to disk and survives being re-read from a fresh copy of the module state', () => {
  const patched = { ...getFacilityConfig(), facility: 'INCIRLIK-TEST' };
  const result = setFacilityConfig(patched);
  assert.equal(result, true);

  const onDisk = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  assert.equal(onDisk.facility, 'INCIRLIK-TEST');

  // Restore for any tests that might run after this one in the same file.
  setFacilityConfig(DEFAULT_CONFIG);
});

test('setFacilityConfig rejects a non-object patch without throwing', () => {
  assert.equal(setFacilityConfig(null), false);
  assert.equal(setFacilityConfig('not an object'), false);
  assert.equal(setFacilityConfig(undefined), false);
});

test('DEFAULT_CONFIG matches what a fresh, unconfigured store actually serves', () => {
  assert.deepEqual(getPositionSet(), DEFAULT_CONFIG.positions);
  assert.deepEqual(getCoveringChain(), DEFAULT_CONFIG.coveringChain);
});

test('nothing is hidden by default, at any Facility — and a Block added later stays that way', () => {
  // This is an exclusion list precisely so a new Block cannot fall outside
  // it. An inclusion list of "everything today" silently became a deny-list
  // for everything invented tomorrow, which is how IFR/RSVC/SREG ended up
  // unwritable on the real server (docs/adr/0041).
  for (const config of [DEFAULT_CONFIG, DEFAULT_CENTER_CONFIG, DEFAULT_TACTICAL_CONFIG]) {
    assert.deepEqual(config.hiddenBlocks, {}, config.facility);
  }
});

test('validateConfig rejects a config hiding a required Block', () => {
  const candidate = { ...getFacilityConfig(), hiddenBlocks: { DEPARTURE: ['1'] } };
  const result = validateConfig(candidate);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
  assert.match(result.detail, /1/);
});

test('validateConfig accepts a config omitting only optional (non-required) Blocks', () => {
  const optionalId = Object.keys(DEPARTURE_BLOCK_MAP).find(id => !requiredBlocksFor('DEPARTURE').includes(id));
  const candidate = { ...getFacilityConfig(), hiddenBlocks: { DEPARTURE: [optionalId] } };
  assert.equal(validateConfig(candidate).ok, true);
});

test('validateConfig rejects a Bay set referencing a Position not in the Position set', () => {
  const candidate = { ...getFacilityConfig(), bays: { ...getFacilityConfig().bays, GHOST: [{ bayId: 'ghost-main', rackIds: ['main'] }] } };
  const result = validateConfig(candidate);
  assert.equal(result.ok, false);
  assert.match(result.detail, /GHOST/);
});

test('setFacilityConfig rejects an invalid config and does not persist it', () => {
  const before = getFacilityConfig();
  const invalid = { ...before, hiddenBlocks: { DEPARTURE: ['1'] } };
  const result = setFacilityConfig(invalid);
  assert.equal(result.ok, false);
  // Unpersisted — the live config is unchanged.
  assert.deepEqual(getFacilityConfig().hiddenBlocks, before.hiddenBlocks);
});

test('loading an on-disk config that fails validation falls back to DEFAULT_CONFIG rather than throwing', async () => {
  const fs2 = await import('fs');
  const os2 = await import('os');
  const path2 = await import('path');
  const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'efsp-facility-config-badload-'));
  const file = path2.join(dir, 'efsp-facility-incirlik.json');
  fs2.writeFileSync(file, JSON.stringify({ ...DEFAULT_CONFIG, hiddenBlocks: { DEPARTURE: ['1'] } }));

  const prevPath = process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH;
  process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = file;
  const fresh = await import(`../src/efsp/facility-config.js?bad=${Date.now()}`);
  process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = prevPath;

  assert.deepEqual(fresh.getPositionSet(), DEFAULT_CONFIG.positions);
  assert.deepEqual(fresh.getFacilityConfig().hiddenBlocks, DEFAULT_CONFIG.hiddenBlocks);
});

test('bayForImpliedState resolves the Bay whose impliesState matches, falling back to the Position\'s first Bay', () => {
  assert.equal(bayForImpliedState('CD', 'CLEARED').bayId, 'cd-cleared');
  assert.equal(bayForImpliedState('OPS', 'NOT_A_REAL_STATE').bayId, getBaysFor('OPS')[0].bayId);
});

// ── WP4A (docs/adr/0013): a second Facility, CENTER/CTR ─────────────────

test('DEFAULT_FACILITY_ID is INCIRLIK — every optional trailing facilityId param defaults to it', () => {
  assert.equal(DEFAULT_FACILITY_ID, 'INCIRLIK');
});

test('getFacilityIds returns every Facility, INCIRLIK first', () => {
  assert.deepEqual(getFacilityIds(), ['INCIRLIK', 'CENTER', 'TACTICAL', 'RANGES']);
});

// The RANGES Facility (guide §4.1's fifth) is unlike the other four: its
// Position set is DERIVED from the airspace config rather than listed, so
// with no airspaces configured it is a real Facility with no Positions —
// which is correct, not a defect. A Position exists only for a range that
// has control of its own.
test('RANGES exists with no Positions until an airspace declares one, and works no Strips', () => {
  assert.deepEqual(getPositionSet('RANGES'), []);
  assert.deepEqual(getAllBays('RANGES'), []); // its board is not a strip rack (§4.2)
});

test('every zero-arg call site from before WP4A keeps behaving identically — the optional facilityId param defaults to INCIRLIK', () => {
  assert.deepEqual(getPositionSet(), getPositionSet('INCIRLIK'));
  assert.deepEqual(getCoveringChain(), getCoveringChain('INCIRLIK'));
  assert.deepEqual(getBaysFor('OPS'), getBaysFor('OPS', 'INCIRLIK'));
  assert.deepEqual(getFacilityConfig().facility, getFacilityConfig('INCIRLIK').facility);
});

test('CENTER has exactly one Position, CTR, with no covering Position (mirrors OPS\'s "absent from the chain" precedent)', () => {
  assert.deepEqual(getPositionSet('CENTER'), ['CTR']);
  assert.deepEqual(getCoveringChain('CENTER'), {});
});

test('INCIRLIK\'s own covering chain is NOT extended to CTR — the covering chain is an intrafacility occupancy-fallback mechanism, a different thing from the cross-Facility HANDOFF primitive (docs/adr/0013)', () => {
  assert.equal('APP' in getCoveringChain('INCIRLIK'), false);
});

test('CTR has a Coordination Bay and an en-route Bay implying INBOUND', () => {
  const bays = getBaysFor('CTR', 'CENTER');
  assert.ok(bays.some(b => b.bayId.endsWith('-coordination')));
  assert.equal(bayImpliesState('ctr-enroute', 'CENTER'), 'INBOUND');
});

test('docs/adr/0022: CTR also has a departures Bay implying HANDED_OFF, for a Strip handed off from APP', () => {
  assert.equal(bayImpliesState('ctr-departures', 'CENTER'), 'HANDED_OFF');
});

test('docs/adr/0023: both Facilities have an overflight Bay implying TRANSITING', () => {
  assert.equal(bayImpliesState('app-overflight', 'INCIRLIK'), 'TRANSITING');
  assert.equal(bayImpliesState('ctr-overflight', 'CENTER'), 'TRANSITING');
});

test('docs/adr/0022: aitAuthorized defaults to false on both Facilities', () => {
  assert.equal(getFacilityConfig('INCIRLIK').aitAuthorized, false);
  assert.equal(getFacilityConfig('CENTER').aitAuthorized, false);
});

test('coordinationBayFor resolves each Position\'s Coordination Bay in the correct Facility, and null for a Position with none', () => {
  assert.equal(coordinationBayFor('APP', 'INCIRLIK').bayId, 'app-coordination');
  assert.equal(coordinationBayFor('CTR', 'CENTER').bayId, 'ctr-app-coordination');
  assert.equal(coordinationBayFor('NOT_A_POSITION', 'INCIRLIK'), null);
});

test('getAllBays stamps every Bay with its facilityId, and does not mix the two Facilities\' Bays together', () => {
  const incirlikBays = getAllBays('INCIRLIK');
  const centerBays = getAllBays('CENTER');
  assert.ok(incirlikBays.every(b => b.facilityId === 'INCIRLIK'));
  assert.ok(centerBays.every(b => b.facilityId === 'CENTER'));
  assert.equal(incirlikBays.some(b => b.bayId === 'ctr-enroute'), false);
  assert.equal(centerBays.some(b => b.bayId === 'ops-filed'), false);
});

test('DEFAULT_CENTER_CONFIG is a valid config on its own', () => {
  assert.equal(validateConfig(DEFAULT_CENTER_CONFIG).ok, true);
});

// ── WP4A second slice: the TACTICAL Facility and positionClass ──────────

test('DEFAULT_TACTICAL_CONFIG is a valid config on its own', () => {
  assert.equal(validateConfig(DEFAULT_TACTICAL_CONFIG).ok, true);
});

test('TACTICAL has exactly the 4 MRU/non-ATC Positions from guide §4.1', () => {
  assert.deepEqual(new Set(getPositionSet('TACTICAL')), new Set(['TAC_C2', 'AIC', 'GCI', 'JTAC']));
});

test('getPositionClass resolves every Position\'s doctrinal class, searching across all Facilities (Position IDs are globally unique)', () => {
  assert.equal(getPositionClass('APP'), 'MILITARY_ATC');
  assert.equal(getPositionClass('CTR'), 'CIVIL_ATC');
  assert.equal(getPositionClass('TAC_C2'), 'MRU');
  assert.equal(getPositionClass('GCI'), 'MRU');
  assert.equal(getPositionClass('AIC'), 'MRU_POSITION');
  assert.equal(getPositionClass('JTAC'), 'NON_ATC');
  assert.equal(getPositionClass('NOT_A_POSITION'), null);
});

test('AIC/GCI -> TAC_C2 is a legal intrafacility covering-chain entry, but TAC_C2 -> CTR is NOT — that hop would cross a Facility boundary (mirrors docs/adr/0013 point 4\'s identical APP -> CTR rejection)', () => {
  const chain = getCoveringChain('TACTICAL');
  assert.equal(chain.AIC, 'TAC_C2');
  assert.equal(chain.GCI, 'TAC_C2');
  assert.equal('TAC_C2' in chain, false);
});

test('every TACTICAL Position has at least one Bay, including a Coordination Bay — except JTAC, whose single read-only viewing Bay is deliberately not a Coordination Bay (it never holds any coordination or TOFI grant)', () => {
  for (const id of ['TAC_C2', 'AIC', 'GCI']) {
    const bays = getBaysFor(id, 'TACTICAL');
    assert.ok(bays.length > 0, id);
    assert.ok(bays.some(b => b.bayId.endsWith('-coordination')), `${id} has no Coordination Bay`);
  }
  const jtacBays = getBaysFor('JTAC', 'TACTICAL');
  assert.ok(jtacBays.length > 0);
  assert.equal(jtacBays.some(b => b.bayId.endsWith('-coordination')), false);
});

test('TAC_C2 and GCI each have Bays implying every MISSION lifecycle state that has an NLA (TASKED/AIRBORNE/ON_STATION)', () => {
  assert.equal(bayImpliesState('tac-c2-tasked', 'TACTICAL'), 'TASKED');
  assert.equal(bayImpliesState('tac-c2-airborne', 'TACTICAL'), 'AIRBORNE');
  assert.equal(bayImpliesState('tac-c2-on-station', 'TACTICAL'), 'ON_STATION');
  assert.equal(bayImpliesState('gci-on-station', 'TACTICAL'), 'ON_STATION');
});

test('every Block of every Role is writable at every Facility, since none hides anything', () => {
  for (const [facilityId, map] of [['INCIRLIK', DEPARTURE_BLOCK_MAP], ['CENTER', DEPARTURE_BLOCK_MAP], ['TACTICAL', MISSION_BLOCK_MAP]]) {
    const role = map === MISSION_BLOCK_MAP ? 'MISSION' : 'DEPARTURE';
    for (const blockId of Object.keys(map)) {
      assert.equal(isBlockVisible(role, blockId, facilityId), true, `${facilityId} ${role} ${blockId}`);
    }
  }
});

test('no default config carries a legacy blockVisibility list — one would hide every Block added since it was written', () => {
  for (const config of [DEFAULT_CONFIG, DEFAULT_CENTER_CONFIG, DEFAULT_TACTICAL_CONFIG]) {
    assert.equal(config.blockVisibility, undefined, config.facility);
  }
});

test('setFacilityConfig targets the Facility named by its second argument, leaving the other untouched', () => {
  const patchedCenter = { ...getFacilityConfig('CENTER'), facility: 'CENTER-TEST' };
  assert.equal(setFacilityConfig(patchedCenter, 'CENTER'), true);
  assert.equal(getFacilityConfig('CENTER').facility, 'CENTER-TEST');
  assert.equal(getFacilityConfig('INCIRLIK').facility, 'INCIRLIK');
  // Restore for any tests that might run after this one in the same file.
  setFacilityConfig(DEFAULT_CENTER_CONFIG, 'CENTER');
});

test('setFacilityConfig rejects an unknown facilityId without throwing', () => {
  const result = setFacilityConfig({ facility: 'GHOST' }, 'GHOST_FACILITY');
  assert.equal(result.ok, false);
});

test('the actual committed config/efsp-facility-incirlik.json seed is valid JSON matching DEFAULT_CONFIG\'s shape, and round-trips through a fresh load + mutate + re-import', async () => {
  const realSeedPath = path.join(new URL('.', import.meta.url).pathname, '../config/efsp-facility-incirlik.json');
  const realSeed = JSON.parse(fs.readFileSync(realSeedPath, 'utf8'));
  assert.equal(validateConfig(realSeed).ok, true, 'the committed seed file itself must pass validation');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-facility-config-realseed-'));
  const copyPath = path.join(dir, 'efsp-facility-incirlik.json');
  fs.copyFileSync(realSeedPath, copyPath);

  const prevPath = process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH;
  process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = copyPath;
  const fresh = await import(`../src/efsp/facility-config.js?realseed=${Date.now()}`);
  assert.deepEqual(fresh.getPositionSet(), realSeed.positions);

  const patched = { ...fresh.getFacilityConfig(), facility: 'INCIRLIK-ROUNDTRIP' };
  assert.equal(fresh.setFacilityConfig(patched), true);
  const reloaded = await import(`../src/efsp/facility-config.js?realseed2=${Date.now()}`);
  assert.equal(reloaded.getFacilityConfig().facility, 'INCIRLIK-ROUNDTRIP');

  process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = prevPath;
});

// ── Position letters (docs/adr/0088) ──────────────────────────────────────

test('position letters: T/A/C for the ATC scopes, M for every tactical Position (H41 S5, H48)', async () => {
  const { getPositionLetter, allPositionLetters } = await import('../src/efsp/facility-config.js');
  assert.equal(getPositionLetter('TWR'), 'T');
  assert.equal(getPositionLetter('APP'), 'A');
  assert.equal(getPositionLetter('CTR'), 'C');
  for (const p of ['TAC_C2', 'AIC', 'GCI', 'JTAC']) assert.equal(getPositionLetter(p), 'M');
  assert.equal(getPositionLetter('NOPE'), null);
  assert.equal(allPositionLetters().INCIRLIK.APP, 'A');
});

test('a position letter must be one character, on a known Position', () => {
  const base = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  assert.equal(validateConfig({ ...base, positionLetters: { APP: 'AP' } }).ok, false);
  assert.equal(validateConfig({ ...base, positionLetters: { APP: 'a' } }).ok, false);
  assert.equal(validateConfig({ ...base, positionLetters: { XXX: 'X' } }).ok, false);
  assert.equal(validateConfig({ ...base, positionLetters: { APP: 'R' } }).ok, true);
});
