import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* Coverage follows the Positions you hold (docs/adr/0042, docs/adr/0043).
 *
 * The load-bearing cases: a Position with no radar gives you nothing and says
 * so; an Observer sees the picture as well as a Primary; and selectors resolve
 * against whatever radars the loaded mission produced, so the same config
 * survives a theater change — which is the whole reason they are selectors and
 * not the radar ids docs/adr/0041 would have caught us writing down.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crcsync-stationcov-'));
// Point every facility config at files that do not exist, so _loadOne falls
// back to the defaults — the pattern every other EFSP test file uses.
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH = path.join(tmpDir, 'incirlik.json');
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER = path.join(tmpDir, 'center.json');
process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL = path.join(tmpDir, 'tactical.json');
process.env.CRCSYNC_EFSP_AIRSPACES_PATH = path.join(tmpDir, 'airspaces.json');

const facilityConfig = (await import('../src/efsp/facility-config.js')).default
  || await import('../src/efsp/facility-config.js');
const { PositionStore } = await import('../src/efsp/position-store.js');
const { StationCoverage, selectorMatches, resolveSelectors } = await import('../src/efsp/station-coverage.js');
const { USER_COALITION } = await import('../src/surveillance/iff.js');

const ENEMY_COALITION = USER_COALITION === 3 ? 2 : 3;

const RADARS = [
  { id: 'apt:Incirlik', type: 'airport', airport: 'Incirlik', airportIcao: 'LTAG', lat: 37, lon: 35 },
  { id: 'app:Incirlik', type: 'approach', airport: 'Incirlik', airportIcao: 'LTAG', lat: 37, lon: 35 },
  { id: 'apt:Adana', type: 'airport', airport: 'Adana', airportIcao: 'LTAF', lat: 36.9, lon: 35.2 },
  { id: 'app:Adana', type: 'approach', airport: 'Adana', airportIcao: 'LTAF', lat: 36.9, lon: 35.2 },
  { id: 'crc:11', type: 'awacs', coalition: USER_COALITION },
  { id: 'crc:12', type: 'fighter', coalition: USER_COALITION },
  { id: 'crc:13', type: 'awacs', coalition: ENEMY_COALITION },
  { id: 'carrier:30', type: 'carrier', coalition: USER_COALITION },
];

/** A StationCoverage over fresh PositionStores, plus the stores to drive them. */
function build(radars = RADARS) {
  const stores = new Map();
  for (const facilityId of facilityConfig.getFacilityIds()) {
    stores.set(facilityId, new PositionStore(
      facilityConfig.getPositionSet(facilityId),
      facilityConfig.getCoveringChain(facilityId),
    ));
  }
  const coverage = new StationCoverage({
    facilityConfig,
    positionStoreFor: (facilityId) => stores.get(facilityId) || null,
    radars: () => radars,
  });
  return { coverage, stores };
}

function hold(stores, facilityId, controllerId, held) {
  stores.get(facilityId).setHeldPositions(controllerId, controllerId, held);
}

// ── selector matching ──────────────────────────────────────────────────────

test('a selector matches on kind, and never on a radar id', () => {
  assert.equal(selectorMatches({ kind: 'approach' }, RADARS[1]), true);
  assert.equal(selectorMatches({ kind: 'airport' }, RADARS[1]), false);
});

test('an airport selector matches by ICAO or by raw mission name', () => {
  assert.equal(selectorMatches({ kind: 'approach', airport: 'LTAG' }, RADARS[1]), true);
  assert.equal(selectorMatches({ kind: 'approach', airport: 'ltag' }, RADARS[1]), true, 'case does not matter');
  assert.equal(selectorMatches({ kind: 'approach', airport: 'Incirlik' }, RADARS[1]), true);
  assert.equal(selectorMatches({ kind: 'approach', airport: 'LTAF' }, RADARS[1]), false);
});

test('airport "*" matches every airfield radar and no airborne one', () => {
  assert.equal(selectorMatches({ kind: 'approach', airport: '*' }, RADARS[1]), true);
  assert.equal(selectorMatches({ kind: 'approach', airport: '*' }, RADARS[3]), true);
  assert.equal(selectorMatches({ kind: 'awacs', airport: '*' }, RADARS[4]), false, 'an AWACS has no airfield');
});

test('coalition "own" narrows an airborne radar to CRCSYNC_COALITION', () => {
  assert.equal(selectorMatches({ kind: 'awacs', coalition: 'own' }, RADARS[4]), true);
  assert.equal(selectorMatches({ kind: 'awacs', coalition: 'own' }, RADARS[6]), false);
  assert.equal(selectorMatches({ kind: 'awacs' }, RADARS[6]), true, 'without the narrowing, either side matches');
});

test('resolveSelectors returns ids, de-duplicated across overlapping selectors', () => {
  const ids = resolveSelectors(
    [{ kind: 'approach', airport: '*' }, { kind: 'approach', airport: 'LTAG' }],
    RADARS,
  );
  assert.deepEqual([...ids].sort(), ['app:Adana', 'app:Incirlik']);
});

test('a selector that resolves to nothing in this theater is simply empty, not an error', () => {
  const ids = resolveSelectors([{ kind: 'approach', airport: 'EGLL' }], RADARS);
  assert.equal(ids.size, 0);
});

// ── the shipped defaults ───────────────────────────────────────────────────

test('APP at INCIRLIK is the RAPCON: it gets the approach radar and the field surveillance radar', () => {
  const { coverage, stores } = build();
  hold(stores, 'INCIRLIK', 'c1', ['APP']);
  const result = coverage.forController('c1');
  assert.deepEqual(result.radars.map(r => r.id), ['app:Incirlik', 'apt:Incirlik']);
  assert.deepEqual(result.radars[0].grantedBy, ['APP'], 'a radar says which Position put it there');
});

test('TWR gets the field surveillance radar only — the 80nm approach picture is not its job', () => {
  const { coverage, stores } = build();
  hold(stores, 'INCIRLIK', 'c1', ['TWR']);
  assert.deepEqual(coverage.forController('c1').radars.map(r => r.id), ['apt:Incirlik']);
});

test('Ground, Clearance Delivery and Operations have no scope, and the answer is empty rather than everything', () => {
  for (const positionId of ['GND', 'CD', 'OPS']) {
    const { coverage, stores } = build();
    hold(stores, 'INCIRLIK', 'c1', [positionId]);
    const result = coverage.forController('c1');
    assert.equal(result.radars.length, 0, `${positionId} should have no coverage`);
    assert.deepEqual(result.radarBearingPositions, [], `${positionId} is not a radar Position`);
    assert.equal(result.heldPositions.length, 1, 'but they are still holding it');
  }
});

test('a controller holding nothing at all sees nothing', () => {
  const { coverage } = build();
  const result = coverage.forController('nobody');
  assert.equal(result.radars.length, 0);
  assert.equal(result.heldPositions.length, 0);
});

test('CTR gets every airfield approach radar in the theater — an en-route picture with no per-theater editing', () => {
  const { coverage, stores } = build();
  hold(stores, 'CENTER', 'c1', ['CTR']);
  assert.deepEqual(coverage.forController('c1').radars.map(r => r.id).sort(), ['app:Adana', 'app:Incirlik']);
});

test('an MRU works the own-coalition airborne picture, and never the enemy one', () => {
  const { coverage, stores } = build();
  hold(stores, 'TACTICAL', 'c1', ['GCI']);
  const ids = coverage.forController('c1').radars.map(r => r.id).sort();
  assert.deepEqual(ids, ['crc:11', 'crc:12']);
  assert.ok(!ids.includes('crc:13'), 'the enemy AWACS is not ours to look through');
});

test('JTAC is read-only and gets no scope', () => {
  const { coverage, stores } = build();
  hold(stores, 'TACTICAL', 'c1', ['JTAC']);
  assert.equal(coverage.forController('c1').radars.length, 0);
});

// ── combination, across Facilities ─────────────────────────────────────────

test('holding Positions at two Facilities unions their coverage, and records both grantors', () => {
  const { coverage, stores } = build();
  hold(stores, 'INCIRLIK', 'c1', ['APP']);
  hold(stores, 'CENTER', 'c1', ['CTR']);
  const result = coverage.forController('c1');
  assert.deepEqual(result.radars.map(r => r.id).sort(), ['app:Adana', 'app:Incirlik', 'apt:Incirlik']);
  const incirlikApproach = result.radars.find(r => r.id === 'app:Incirlik');
  assert.deepEqual(incirlikApproach.grantedBy.sort(), ['APP', 'CTR'], 'both hats grant it');
});

test('a radar-bearing Position held alongside a scopeless one still gives its picture', () => {
  const { coverage, stores } = build();
  hold(stores, 'INCIRLIK', 'c1', ['GND', 'TWR']);
  assert.deepEqual(coverage.forController('c1').radars.map(r => r.id), ['apt:Incirlik']);
  assert.deepEqual(coverage.forController('c1').radarBearingPositions, ['TWR']);
});

test('releasing a Position takes its coverage away on the next ask', () => {
  const { coverage, stores } = build();
  hold(stores, 'INCIRLIK', 'c1', ['APP']);
  assert.equal(coverage.forController('c1').radars.length, 2);
  hold(stores, 'INCIRLIK', 'c1', []);
  assert.equal(coverage.forController('c1').radars.length, 0);
});

// ── Primary versus Observer ────────────────────────────────────────────────

test('an Observer sees the picture too — holding a Position is what grants it, not being Primary', () => {
  const { coverage, stores } = build();
  hold(stores, 'INCIRLIK', 'first', ['APP']);
  hold(stores, 'INCIRLIK', 'second', ['APP']);
  const primary = coverage.forController('first');
  const observer = coverage.forController('second');
  assert.equal(primary.heldPositions[0].isPrimary, true);
  assert.equal(observer.heldPositions[0].isPrimary, false, 'the second controller is an Observer');
  assert.deepEqual(
    observer.radars.map(r => r.id), primary.radars.map(r => r.id),
    'and sees exactly the same radars',
  );
});

// ── the union the sweep actually runs over ─────────────────────────────────

test('activeRadars is only what somebody is looking through, so an unattended airfield costs nothing', () => {
  const { coverage, stores } = build();
  assert.deepEqual(coverage.activeRadars(), [], 'nobody on position, nothing to sweep');
  hold(stores, 'INCIRLIK', 'c1', ['TWR']);
  assert.deepEqual(coverage.activeRadars().map(r => r.id), ['apt:Incirlik']);
  hold(stores, 'CENTER', 'c2', ['CTR']);
  assert.deepEqual(
    coverage.activeRadars().map(r => r.id).sort(),
    ['app:Adana', 'app:Incirlik', 'apt:Incirlik'],
  );
});

test('the radar list is read live, so an AWACS taking off appears without rebuilding anything', () => {
  let radars = RADARS.filter(r => r.id !== 'crc:11');
  const stores = new Map();
  for (const facilityId of facilityConfig.getFacilityIds()) {
    stores.set(facilityId, new PositionStore(
      facilityConfig.getPositionSet(facilityId), facilityConfig.getCoveringChain(facilityId),
    ));
  }
  const coverage = new StationCoverage({
    facilityConfig,
    positionStoreFor: (id) => stores.get(id) || null,
    radars: () => radars,
  });
  hold(stores, 'TACTICAL', 'c1', ['TAC_C2']);
  assert.deepEqual(coverage.forController('c1').radars.map(r => r.id), ['crc:12']);
  radars = RADARS;
  assert.deepEqual(coverage.forController('c1').radars.map(r => r.id).sort(), ['crc:11', 'crc:12']);
});

test('the tactical Positions are on the datalink; the ATC Positions are not (docs/adr/0059)', () => {
  const { coverage, stores } = build();
  hold(stores, 'TACTICAL', 'c1', ['GCI']);
  hold(stores, 'INCIRLIK', 'c2', ['APP']);
  assert.equal(coverage.forController('c1').datalink, true);
  assert.equal(coverage.forController('c2').datalink, false);
  assert.equal(coverage.forController('nobody').datalink, false);
});

// ── config validation ──────────────────────────────────────────────────────

test('the shipped configs all validate, and every Position with a scope exists', () => {
  for (const facilityId of facilityConfig.getFacilityIds()) {
    const config = facilityConfig.getFacilityConfig(facilityId);
    const check = facilityConfig.validateConfig(config);
    assert.equal(check.ok, true, `${facilityId}: ${check.detail}`);
  }
});

test('positionRadars naming an unknown Position is refused', () => {
  const candidate = {
    ...facilityConfig.getFacilityConfig('INCIRLIK'),
    positionRadars: { NOPE: [{ kind: 'airport', airport: 'LTAG' }] },
  };
  const check = facilityConfig.validateConfig(candidate);
  assert.equal(check.ok, false);
  assert.match(check.detail, /unknown Position NOPE/);
});

test('a malformed selector is refused, because it can never resolve in any theater', () => {
  const base = facilityConfig.getFacilityConfig('INCIRLIK');
  const cases = [
    [{ kind: 'sideways' }, /unknown radar kind/],
    [{ kind: 'airport', airport: 42 }, /must be an ICAO/],
    [{ kind: 'approach', coalition: 'blue' }, /coalition must be/],
    [{ kind: 'fighter', airport: 'LTAG' }, /airborne/],
    [{ kind: 'datalink', airport: 'LTAG' }, /network/],
    ['app:Incirlik', /must be an object/],
  ];
  for (const [selector, pattern] of cases) {
    const check = facilityConfig.validateConfig({ ...base, positionRadars: { APP: [selector] } });
    assert.equal(check.ok, false, `${JSON.stringify(selector)} should have been refused`);
    assert.match(check.detail, pattern);
  }
});

test('positionRadars that is not an array is refused', () => {
  const base = facilityConfig.getFacilityConfig('INCIRLIK');
  const check = facilityConfig.validateConfig({ ...base, positionRadars: { APP: 'app:Incirlik' } });
  assert.equal(check.ok, false);
  assert.match(check.detail, /must be an array/);
});

test('an unresolvable-but-well-formed selector is accepted — the same config has to work across theaters', () => {
  const base = facilityConfig.getFacilityConfig('INCIRLIK');
  const check = facilityConfig.validateConfig({
    ...base, positionRadars: { APP: [{ kind: 'approach', airport: 'EGLL' }] },
  });
  assert.equal(check.ok, true);
});

test('radarBearingPositionIds names the Positions that have a scope at all', () => {
  const ids = facilityConfig.radarBearingPositionIds();
  for (const positionId of ['TWR', 'APP', 'CTR', 'TAC_C2', 'AIC', 'GCI']) {
    assert.ok(ids.includes(positionId), `${positionId} should be a radar Position`);
  }
  for (const positionId of ['OPS', 'CD', 'GND', 'JTAC']) {
    assert.ok(!ids.includes(positionId), `${positionId} should not be a radar Position`);
  }
});

test('conflict alerting is for the ATC Positions only (docs/adr/0059)', () => {
  const { coverage, stores } = build();
  hold(stores, 'TACTICAL', 'c1', ['GCI']);
  hold(stores, 'INCIRLIK', 'c2', ['TWR']);
  hold(stores, 'CENTER', 'c3', ['CTR']);
  assert.equal(coverage.forController('c1').stca, false);
  assert.equal(coverage.forController('c2').stca, true);
  assert.equal(coverage.forController('c3').stca, true);
});
