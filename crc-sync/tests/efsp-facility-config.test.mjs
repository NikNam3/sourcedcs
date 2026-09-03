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
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = tmpFile;
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER = tmpFileCenter;

const {
  getFacilityIds, getFacilityConfig, getPositionSet, getCoveringChain, getBaysFor, getAllBays,
  bayImpliesState, bayForImpliedState, coordinationBayFor, setFacilityConfig, validateConfig,
  DEFAULT_CONFIG, DEFAULT_CENTER_CONFIG, DEFAULT_FACILITY_ID,
} = await import('../src/efsp/facility-config.js');
const { DEPARTURE_BLOCK_MAP, requiredBlocksFor } = await import('../src/efsp/block-map.js');

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
  assert.equal(getBaysFor('OPS')[0].bayId, 'ops-filed');
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

test('DEFAULT_CONFIG.blockVisibility.DEPARTURE includes every Block block-map.js defines for DEPARTURE — nothing hidden by default', () => {
  assert.deepEqual(new Set(DEFAULT_CONFIG.blockVisibility.DEPARTURE), new Set(Object.keys(DEPARTURE_BLOCK_MAP)));
});

test('validateConfig rejects a config omitting a required Block from blockVisibility.DEPARTURE', () => {
  const candidate = { ...getFacilityConfig(), blockVisibility: { DEPARTURE: DEFAULT_CONFIG.blockVisibility.DEPARTURE.filter(id => id !== '1') } };
  const result = validateConfig(candidate);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VALIDATION_ERROR');
  assert.match(result.detail, /1/);
});

test('validateConfig accepts a config omitting only optional (non-required) Blocks', () => {
  const optionalId = Object.keys(DEPARTURE_BLOCK_MAP).find(id => !requiredBlocksFor('DEPARTURE').includes(id));
  const candidate = { ...getFacilityConfig(), blockVisibility: { DEPARTURE: DEFAULT_CONFIG.blockVisibility.DEPARTURE.filter(id => id !== optionalId) } };
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
  const invalid = { ...before, blockVisibility: { DEPARTURE: [] } };
  const result = setFacilityConfig(invalid);
  assert.equal(result.ok, false);
  // Unpersisted — the live config is unchanged.
  assert.deepEqual(getFacilityConfig().blockVisibility, before.blockVisibility);
});

test('loading an on-disk config that fails validation falls back to DEFAULT_CONFIG rather than throwing', async () => {
  const fs2 = await import('fs');
  const os2 = await import('os');
  const path2 = await import('path');
  const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'efsp-facility-config-badload-'));
  const file = path2.join(dir, 'efsp-facility-incirlik.json');
  fs2.writeFileSync(file, JSON.stringify({ ...DEFAULT_CONFIG, blockVisibility: { DEPARTURE: [] } }));

  const prevPath = process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH;
  process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = file;
  const fresh = await import(`../src/efsp/facility-config.js?bad=${Date.now()}`);
  process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = prevPath;

  assert.deepEqual(fresh.getPositionSet(), DEFAULT_CONFIG.positions);
  assert.deepEqual(fresh.getFacilityConfig().blockVisibility, DEFAULT_CONFIG.blockVisibility);
});

test('bayForImpliedState resolves the Bay whose impliesState matches, falling back to the Position\'s first Bay', () => {
  assert.equal(bayForImpliedState('CD', 'CLEARED').bayId, 'cd-cleared');
  assert.equal(bayForImpliedState('OPS', 'NOT_A_REAL_STATE').bayId, getBaysFor('OPS')[0].bayId);
});

// ── WP4A (docs/adr/0013): a second Facility, CENTER/CTR ─────────────────

test('DEFAULT_FACILITY_ID is INCIRLIK — every optional trailing facilityId param defaults to it', () => {
  assert.equal(DEFAULT_FACILITY_ID, 'INCIRLIK');
});

test('getFacilityIds returns both Facilities, INCIRLIK first', () => {
  assert.deepEqual(getFacilityIds(), ['INCIRLIK', 'CENTER']);
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
