import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

// facility-config.js reads its config paths once at module load — set both
// override env vars before the first import, same pattern as
// apt-config.test.mjs. WP4A (docs/adr/0013) added a second Facility
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
  getFacilityIds, getFacilityConfig, getPositionSet, getPositionClass, getConsolidation, getBaysFor, getAllBays,
  bayImpliesState, bayForImpliedState, coordinationBayFor, setFacilityConfig, validateConfig, isBlockVisible,
  getShippedConfig, DEFAULT_FACILITY_ID,
} = await import('../src/efsp/facility-config.js');
const { DEPARTURE_BLOCK_MAP, OVERFLIGHT_BLOCK_MAP, MISSION_BLOCK_MAP, requiredBlocksFor } = await import('../src/efsp/block-map.js');

test('getPositionSet returns exactly INCIRLIK\'s eight Positions (RSU, SFA and PAR since L18, ADR 0075)', () => {
  assert.deepEqual(getPositionSet(), ['OPS', 'CD', 'GND', 'TWR', 'RSU', 'APP', 'SFA', 'PAR']);
});

test('getConsolidation matches the guide\'s default chain, un-truncated through APP, plus SFA and PAR to APP (L18)', () => {
  assert.deepEqual(getConsolidation(), { CD: 'GND', GND: 'TWR', TWR: 'APP', SFA: 'APP', PAR: 'APP' });
});

test('OPS, RSU and APP have no entry in the covering chain — OPS per the guide\'s table, RSU so a Strip never strands on a supervisory Position (ADR 0075), APP because there\'s no CTR Facility yet to cover it', () => {
  const chain = getConsolidation();
  assert.equal('OPS' in chain, false);
  assert.equal('RSU' in chain, false);
  assert.equal('APP' in chain, false);
});

test('every Position in the Position set has at least one Bay, including a Coordination Bay (WP4A seam, present but inert) — except RSU, SFA and PAR, which sit on no Facility boundary (ADR 0075)', () => {
  for (const id of getPositionSet()) {
    const bays = getBaysFor(id);
    assert.ok(bays.length > 0, id);
    if (['RSU', 'SFA', 'PAR'].includes(id)) continue;
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
  assert.deepEqual(getPositionSet(), getShippedConfig('INCIRLIK').positions);
  assert.equal(getBaysFor('OPS')[0].bayId, 'ops-proposed');
});

test('setFacilityConfig persists to disk and survives being re-read from a fresh copy of the module state', () => {
  const patched = { ...getFacilityConfig(), aitAuthorized: true };
  const result = setFacilityConfig(patched);
  assert.equal(result, true);

  const onDisk = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  assert.equal(onDisk.aitAuthorized, true);

  // Restore for any tests that might run after this one in the same file.
  setFacilityConfig(getShippedConfig('INCIRLIK'));
});

test('setFacilityConfig rejects a non-object patch without throwing', () => {
  assert.equal(setFacilityConfig(null), false);
  assert.equal(setFacilityConfig('not an object'), false);
  assert.equal(setFacilityConfig(undefined), false);
});

test('the shipped INCIRLIK config matches what a fresh, unconfigured store actually serves', () => {
  assert.deepEqual(getPositionSet(), getShippedConfig('INCIRLIK').positions);
  assert.deepEqual(getConsolidation(), getShippedConfig('INCIRLIK').coveringChain);
});

test('nothing is hidden by default, at any Facility — and a Block added later stays that way', () => {
  // This is an exclusion list precisely so a new Block cannot fall outside
  // it. An inclusion list of "everything today" silently became a deny-list
  // for everything invented tomorrow, which is how IFR/RSVC/SREG ended up
  // unwritable on the real server (docs/adr/0041).
  for (const config of [getShippedConfig('INCIRLIK'), getShippedConfig('CENTER'), getShippedConfig('TACTICAL')]) {
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

test('bayForImpliedState resolves the Bay whose impliesState matches, falling back to the Position\'s first Bay', () => {
  assert.equal(bayForImpliedState('CD', 'CLEARED').bayId, 'cd-cleared');
  assert.equal(bayForImpliedState('OPS', 'NOT_A_REAL_STATE').bayId, getBaysFor('OPS')[0].bayId);
});

// ── WP4A (docs/adr/0013): a second Facility, CENTER/CTR ─────────────────

test('DEFAULT_FACILITY_ID is INCIRLIK — every optional trailing facilityId param defaults to it', () => {
  assert.equal(DEFAULT_FACILITY_ID, 'INCIRLIK');
});

test('getFacilityIds returns every Facility, INCIRLIK first', () => {
  assert.deepEqual(getFacilityIds(), ['INCIRLIK', 'CENTER', 'TACTICAL', 'CARRIER', 'RANGES']);
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
  assert.deepEqual(getConsolidation(), getConsolidation('INCIRLIK'));
  assert.deepEqual(getBaysFor('OPS'), getBaysFor('OPS', 'INCIRLIK'));
  assert.deepEqual(getFacilityConfig().facility, getFacilityConfig('INCIRLIK').facility);
});

test('CENTER has exactly one Position, CTR, with no covering Position (mirrors OPS\'s "absent from the chain" precedent)', () => {
  assert.deepEqual(getPositionSet('CENTER'), ['CTR']);
  assert.deepEqual(getConsolidation('CENTER'), {});
});

test('INCIRLIK\'s own covering chain is NOT extended to CTR — the covering chain is an intrafacility occupancy-fallback mechanism, a different thing from the cross-Facility HANDOFF primitive (docs/adr/0013)', () => {
  assert.equal('APP' in getConsolidation('INCIRLIK'), false);
});

test('CTR has a Coordination Bay and an en-route Bay implying INBOUND', () => {
  const bays = getBaysFor('CTR', 'CENTER');
  assert.ok(bays.some(b => b.bayId.endsWith('-coordination')));
  assert.equal(bayImpliesState('ctr-enroute', 'CENTER'), 'INBOUND');
});

test('docs/adr/0022: CTR also has a departures Bay implying HANDED_OFF, for a Strip handed off from APP', () => {
  assert.equal(bayImpliesState('ctr-departures', 'CENTER'), 'HANDED_OFF');
});

test('docs/adr/0087: both Facilities have an overflight Bay that holds the Role and implies no state', () => {
  assert.equal(bayImpliesState('app-overflight', 'INCIRLIK'), null);
  assert.equal(bayImpliesState('ctr-overflight', 'CENTER'), null);
  assert.equal(getAllBays('INCIRLIK').find(b => b.bayId === 'app-overflight').holdsRole, 'OVERFLIGHT');
  assert.equal(getAllBays('CENTER').find(b => b.bayId === 'ctr-overflight').holdsRole, 'OVERFLIGHT');
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

test('the shipped CENTER config is a valid config on its own', () => {
  assert.equal(validateConfig(getShippedConfig('CENTER')).ok, true);
});

// ── WP4A second slice: the TACTICAL Facility and positionClass ──────────

test('the shipped TACTICAL config is a valid config on its own', () => {
  assert.equal(validateConfig(getShippedConfig('TACTICAL')).ok, true);
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

test('AIC/GCI -> TAC_C2 is a legal intrafacility consolidation entry, but TAC_C2 -> CTR is NOT — that hop would cross a Facility boundary (mirrors docs/adr/0013 point 4\'s identical APP -> CTR rejection)', () => {
  const chain = getConsolidation('TACTICAL');
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
  for (const config of [getShippedConfig('INCIRLIK'), getShippedConfig('CENTER'), getShippedConfig('TACTICAL')]) {
    assert.equal(config.blockVisibility, undefined, config.facility);
  }
});

test('setFacilityConfig targets the Facility named by its second argument, leaving the other untouched', () => {
  const patchedCenter = { ...getFacilityConfig('CENTER'), aitAuthorized: true };
  assert.equal(setFacilityConfig(patchedCenter, 'CENTER'), true);
  assert.equal(getFacilityConfig('CENTER').aitAuthorized, true);
  assert.equal(getFacilityConfig('INCIRLIK').aitAuthorized, false);
  // Restore for any tests that might run after this one in the same file.
  setFacilityConfig(getShippedConfig('CENTER'), 'CENTER');
});

test('setFacilityConfig rejects an unknown facilityId without throwing', () => {
  const result = setFacilityConfig({ facility: 'GHOST' }, 'GHOST_FACILITY');
  assert.equal(result.ok, false);
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
  const base = JSON.parse(JSON.stringify(getShippedConfig('INCIRLIK')));
  assert.equal(validateConfig({ ...base, positionLetters: { APP: 'AP' } }).ok, false);
  assert.equal(validateConfig({ ...base, positionLetters: { APP: 'a' } }).ok, false);
  assert.equal(validateConfig({ ...base, positionLetters: { XXX: 'X' } }).ok, false);
  assert.equal(validateConfig({ ...base, positionLetters: { APP: 'R' } }).ok, true);
});

// ── Loading (docs/wip/DATA-1.md, S-ARCH2 (12)) — each case in a fresh process, since the module loads once ──

const CHILD_CWD = path.join(new URL('.', import.meta.url).pathname, '..');
const REAL_CONFIG = path.join(CHILD_CWD, 'config');
const FILES = ['incirlik', 'center', 'tactical', 'carrier'].map(id => `efsp-facility-${id}.json`);

/** A temp config dir holding the four shipped files, so a case can break or remove one. The shipped tuning
 *  files are copied too: since DATA-2 they have no code defaults, and a missing one is a startup error. */
function scratchConfigDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-facility-load-'));
  const config = path.join(dir, 'config');
  fs.mkdirSync(config);
  for (const f of fs.readdirSync(REAL_CONFIG).filter(f => f.endsWith('.json'))) fs.copyFileSync(path.join(REAL_CONFIG, f), path.join(config, f));
  return { dir, config, state: path.join(dir, 'state') };
}

/** Runs `body` (it sees `fc`, the facility-config module) in a fresh node process with the given env. */
function inChild({ config, state }, body, extraEnv = {}) {
  const env = { ...process.env, CRCSYNC_CONFIG_DIR: config, CRCSYNC_STATE_DIR: state, ...extraEnv };
  for (const k of ['CRCSYNC_EFSP_FACILITY_CONFIG_PATH', 'CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER', 'CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL', 'CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER']) {
    if (!(k in extraEnv)) delete env[k];
  }
  return spawnSync(process.execPath, ['-e', `const fc = require('./src/efsp/facility-config.js'); ${body}`], { cwd: CHILD_CWD, encoding: 'utf8', env });
}
const posOf = (id = 'INCIRLIK') => `console.log(JSON.stringify(fc.getPositionSet('${id}')))`;

test('load, branch 1: with no override and no state/ copy, a Facility is read from the shipped config/ file', () => {
  const d = scratchConfigDir();
  const r = inChild(d, posOf('CENTER'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '["CTR"]');
});

test('load, branch 2: a state/ copy replaces the shipped file', () => {
  const d = scratchConfigDir();
  fs.mkdirSync(d.state);
  const center = JSON.parse(fs.readFileSync(path.join(d.config, FILES[1]), 'utf8'));
  center.positions = ['CTR', 'CTR2']; center.positionClasses.CTR2 = 'CIVIL_ATC';
  fs.writeFileSync(path.join(d.state, FILES[1]), JSON.stringify(center));
  const r = inChild(d, posOf('CENTER'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '["CTR","CTR2"]');
});

test('load, branch 3: an override path that exists beats state/ and config/', () => {
  const d = scratchConfigDir();
  fs.mkdirSync(d.state);
  const center = JSON.parse(fs.readFileSync(path.join(d.config, FILES[1]), 'utf8'));
  fs.writeFileSync(path.join(d.state, FILES[1]), JSON.stringify({ ...center, positions: ['CTR', 'FROM_STATE'], positionClasses: { ...center.positionClasses, FROM_STATE: 'CIVIL_ATC' } }));
  const override = path.join(d.dir, 'override-center.json');
  fs.writeFileSync(override, JSON.stringify({ ...center, positions: ['CTR', 'FROM_OVERRIDE'], positionClasses: { ...center.positionClasses, FROM_OVERRIDE: 'CIVIL_ATC' } }));
  const r = inChild(d, posOf('CENTER'), { CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: override });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '["CTR","FROM_OVERRIDE"]');
});

test('load, branch 4: an override path that does not exist is read through to state/ then config/ (a write target, not a hard requirement)', () => {
  const d = scratchConfigDir();
  const r = inChild(d, posOf('CENTER'), { CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: path.join(d.dir, 'not-there.json') });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '["CTR"]');
});

test('a Facility file missing in the override, state/ and config/ is a loud startup error, never a fallback', () => {
  const d = scratchConfigDir();
  fs.rmSync(path.join(d.config, FILES[2]));
  const r = inChild(d, posOf());
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /\[efsp-facility-config\] TACTICAL: cannot read its facility file .*efsp-facility-tactical\.json/);
});

test('an invalid file is a startup error carrying the validation message, and does not fall back to the shipped copy', () => {
  const d = scratchConfigDir();
  fs.mkdirSync(d.state);
  const bad = JSON.parse(fs.readFileSync(path.join(d.config, FILES[0]), 'utf8'));
  bad.hiddenBlocks = { DEPARTURE: ['1'] };
  fs.writeFileSync(path.join(d.state, FILES[0]), JSON.stringify(bad));
  const r = inChild(d, posOf());
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /\[efsp-facility-config\] INCIRLIK: .*efsp-facility-incirlik\.json is not a valid facility config/);
});

test('a state/ copy is not merged with the shipped file: a partial copy fails on the keys it lacks', () => {
  const d = scratchConfigDir();
  fs.mkdirSync(d.state);
  fs.writeFileSync(path.join(d.state, FILES[1]), JSON.stringify({ facility: 'CENTER', positions: ['CTR'], bays: {} }));
  const r = inChild(d, posOf());
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /CENTER: .*missing required key/);
});

test('a file that is not JSON is a startup error', () => {
  const d = scratchConfigDir();
  fs.writeFileSync(path.join(d.config, FILES[3]), '{ not json');
  const r = inChild(d, posOf());
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /CARRIER: cannot read its facility file/);
});

test('a legacy blockVisibility list in a file is a startup error naming the file', () => {
  const d = scratchConfigDir();
  fs.mkdirSync(d.state);
  const c = JSON.parse(fs.readFileSync(path.join(d.config, FILES[1]), 'utf8'));
  fs.writeFileSync(path.join(d.state, FILES[1]), JSON.stringify({ ...c, blockVisibility: { DEPARTURE: ['1'] } }));
  const r = inChild(d, posOf('CENTER'));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /still has a "blockVisibility" list/);
  assert.ok(r.stderr.includes(FILES[1]), 'names the file');
});

test('setFacilityConfig writes the whole Facility to state/ (the override path), never into config/, and a restart reads it back', () => {
  const d = scratchConfigDir();
  const before = fs.readFileSync(path.join(d.config, FILES[1]), 'utf8');
  const r = inChild(d, `const c = fc.getFacilityConfig('CENTER'); c.aitAuthorized = true;
    console.log(fc.setFacilityConfig(c, 'CENTER'));`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'true');
  assert.equal(JSON.parse(fs.readFileSync(path.join(d.state, FILES[1]), 'utf8')).aitAuthorized, true);
  assert.equal(fs.readFileSync(path.join(d.config, FILES[1]), 'utf8'), before, 'config/ is never written');
  const again = inChild(d, `console.log(fc.getFacilityConfig('CENTER').aitAuthorized)`);
  assert.equal(again.stdout.trim(), 'true');
});

test('setFacilityConfig takes the whole file: a partial one is rejected, not merged with the shipped copy', () => {
  const d = scratchConfigDir();
  const r = inChild(d, `console.log(JSON.stringify(fc.setFacilityConfig({ aitAuthorized: true }, 'CENTER')))`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"ok":false.*missing required key/);
  assert.equal(fs.existsSync(path.join(d.state, FILES[1])), false);
});

test('the file for a Facility must say it is that Facility', () => {
  const d = scratchConfigDir();
  const c = JSON.parse(fs.readFileSync(path.join(d.config, FILES[1]), 'utf8'));
  fs.writeFileSync(path.join(d.config, FILES[1]), JSON.stringify({ ...c, facility: 'ELSEWHERE' }));
  const r = inChild(d, posOf());
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /CENTER: .*facility is "ELSEWHERE", expected "CENTER"/);
});
