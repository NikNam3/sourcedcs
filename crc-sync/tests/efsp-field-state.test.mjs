import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* Field state (guide §9.7, docs/adr/0061) — the pure module, the store driven
 * directly, and the wire. The two §13 acceptance lines are walked end to end in
 * efsp-scenario-field-state.test.mjs; this file pins each rule on its own.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-field-state-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const fieldState = await import('../src/efsp/field-state.js');
const facilityConfig = (await import('../src/efsp/facility-config.js')).default;

const {
  LEGAL_TRANSITIONS, RUNWAY_STATUSES, canGo, normalizeRunwayEnd, buildStatusView,
  resolveRunwayForStrip, runwayInhibitFor, runwayAdvisoryFor, runwayRackFor, activeEndIntoWind,
  missionKeyOf, validateFieldStateInventory, runwayInventoryWarnings,
} = fieldState;

const INCIRLIK = facilityConfig.getFacilityConfig('INCIRLIK');
const INVENTORY = INCIRLIK.fieldState;

/** A view as the store would build it, with the pavement at `status`. */
function viewWith(status, { activeRunway = '05', kind = 'BARRIER_CHANGE', inventory = INVENTORY } = {}) {
  return buildStatusView(inventory, {
    activeRunway,
    runways: inventory.runways.map(r => ({
      runwayId: r.runwayId, status,
      suspension: status.startsWith('SUSPENDED') ? { kind } : null,
    })),
  });
}

const departure = (over = {}) => ({ role: 'DEPARTURE', state: 'TAXI', bayId: 'gnd-taxi-out', rackId: 'main', ...over });
const arrival = (over = {}) => ({ role: 'ARRIVAL', state: 'HANDED_TO_TOWER', bayId: 'twr-arrivals', rackId: 'main', ...over });
const fdrFiled = (rwy) => ({ filed: { departureRunway: rwy }, assigned: { landingRunway: null } });
const fdrLanding = (rwy) => ({ filed: { departureRunway: null }, assigned: { landingRunway: rwy } });

// ── step 1 — config and the pure module ─────────────────────────────────────

test('LEGAL_TRANSITIONS has no SUSPENDED_BARRIER_CHANGE -> OPEN edge (rule 2, structurally)', () => {
  assert.equal(canGo('SUSPENDED_BARRIER_CHANGE', 'OPEN'), false);
  assert.deepEqual(LEGAL_TRANSITIONS.SUSPENDED_BARRIER_CHANGE, ['SUSPENDED_INSPECTION']);
});

test('every path from SUSPENDED_BARRIER_CHANGE to OPEN passes through SUSPENDED_INSPECTION', () => {
  // Every simple path, by exhaustive search — the table is tiny.
  const paths = [];
  const walk = (at, seen) => {
    if (at === 'OPEN') { paths.push(seen); return; }
    for (const next of LEGAL_TRANSITIONS[at] || []) if (!seen.includes(next)) walk(next, [...seen, next]);
  };
  walk('SUSPENDED_BARRIER_CHANGE', ['SUSPENDED_BARRIER_CHANGE']);
  assert.ok(paths.length > 0);
  for (const p of paths) assert.ok(p.includes('SUSPENDED_INSPECTION'), `path ${p.join(' -> ')} skips the inspection`);
});

test('no SUSPENDED_* status can reach CLOSED (no side door around the inspection)', () => {
  for (const s of RUNWAY_STATUSES.filter(x => x.startsWith('SUSPENDED'))) {
    assert.equal(canGo(s, 'CLOSED'), false, `${s} -> CLOSED`);
  }
});

test("INCIRLIK's shipped inventory is one pavement whose ends name both twr-runway-queue racks, and validates", () => {
  assert.equal(validateFieldStateInventory(INVENTORY, INCIRLIK.positions), null);
  assert.equal(INVENTORY.runways.length, 1);
  const [rwy] = INVENTORY.runways;
  assert.equal(rwy.runwayId, '05/23');
  assert.deepEqual(rwy.ends, ['05', '23']);
  const queue = INCIRLIK.bays.TWR.find(b => b.bayId === 'twr-runway-queue');
  assert.deepEqual(Object.values(rwy.rackIds).sort(), [...queue.rackIds].sort());
  assert.deepEqual(runwayInventoryWarnings(INCIRLIK), []);
  // Gear is the data shape only (decisions.md H17) — none shipped.
  assert.deepEqual(rwy.arrestingGear, []);
});

test('the shipped config holds no runtime state — no status, no active runway (decisions.md H22, P5)', () => {
  const text = JSON.stringify(INVENTORY);
  for (const key of ['"status"', '"activeRunway"', '"suspension"', '"runwayChange"']) {
    assert.ok(!text.includes(key), `${key} is runtime state and must not be in config`);
  }
});

test('validateConfig rejects a malformed runway inventory', () => {
  const bad = (mutate) => {
    const candidate = structuredClone(INCIRLIK);
    mutate(candidate.fieldState);
    const r = facilityConfig.validateConfig(candidate);
    assert.equal(r.ok, false, JSON.stringify(candidate.fieldState));
    assert.equal(r.reason, 'VALIDATION_ERROR');
    return r.detail;
  };
  assert.match(bad(fs => { fs.runways = 'nope'; }), /array/);
  assert.match(bad(fs => { fs.runways.push(structuredClone(fs.runways[0])); }), /duplicate runwayId/);
  assert.match(bad(fs => { fs.runways[0].ends = ['05', 'X9']; }), /not a runway end/);
  assert.match(bad(fs => { delete fs.runways[0].endHeadingsTrue['23']; }), /true heading/);
  assert.match(bad(fs => { fs.runways[0].rackIds = { '18': 'rwy-18' }; }), /not one of its ends/);
  assert.match(bad(fs => {
    fs.runways[0].arrestingGear = [{ end: '05', position: 'APPROACH_END', type: 'BAK_13', state: 'UP', distanceFt: 1500 }];
  }), /type must be one of/);
  assert.match(bad(fs => {
    fs.runways[0].arrestingGear = [{ end: '05', position: 'APPROACH_END', type: 'BAK_12', state: 'RIGGED', distanceFt: 1500 }];
  }), /state must be one of/);
  assert.match(bad(fs => { fs.runwayChangeAcknowledgers = ['OPS', 'SOF']; }), /unknown Position SOF/);
  assert.match(bad(fs => { fs.inspectionAuthorityPositionId = 'AMOPS'; }), /unknown Position AMOPS/);
  assert.match(bad(fs => { fs.acknowledgerReversion = { TWR: { facilityId: 'CENTER', positionId: 'CTR' } }; }), /not an acknowledger/);
  assert.match(bad(fs => { fs.pads = { hotCargo: 7 }; }), /pads\.hotCargo/);
});

test('a well-formed gear entry validates (the shape is kept even though none ships)', () => {
  const inv = structuredClone(INVENTORY);
  inv.runways[0].arrestingGear = [{ end: '05', position: 'APPROACH_END', type: 'BAK_12', state: 'UP', distanceFt: 1500 }];
  assert.equal(validateFieldStateInventory(inv, INCIRLIK.positions), null);
});

test('a rackId mismatch is a warning, never a rejection — and so is a runway-queue rack no runway names', () => {
  const candidate = structuredClone(INCIRLIK);
  candidate.fieldState.runways[0].rackIds = { '05': 'rwy-5' };
  assert.equal(facilityConfig.validateConfig(candidate).ok, true);
  const warnings = runwayInventoryWarnings(candidate);
  assert.ok(warnings.some(w => /rwy-5\b.*no RUNWAY_QUEUE Bay/.test(w)), warnings.join('\n'));
  assert.ok(warnings.some(w => /rwy-05 is not mapped/.test(w)), warnings.join('\n'));
  assert.ok(warnings.some(w => /rwy-23 is not mapped/.test(w)), warnings.join('\n'));
});

test('CENTER, TACTICAL and RANGES have no runway inventory', () => {
  for (const id of ['CENTER', 'TACTICAL', 'RANGES']) {
    assert.equal(facilityConfig.getFacilityConfig(id).fieldState, undefined, id);
  }
});

test("normalizeRunwayEnd: '5', 'RWY 05', 'rw23', ' 23 ', '5L' resolve; garbage resolves to null", () => {
  assert.equal(normalizeRunwayEnd('5'), '05');
  assert.equal(normalizeRunwayEnd('RWY 05'), '05');
  assert.equal(normalizeRunwayEnd('rw23'), '23');
  assert.equal(normalizeRunwayEnd(' 23 '), '23');
  assert.equal(normalizeRunwayEnd('5L'), '05L');
  for (const junk of ['', 'abc', '37', '0', '05/23', null, undefined, {}]) assert.equal(normalizeRunwayEnd(junk), null, String(junk));
});

test('runwayIdForStrip prefers the rack the Strip sits in over the filed runway, and records the source', () => {
  const view = viewWith('OPEN');
  const r = resolveRunwayForStrip(departure({ state: 'RUNWAY_QUEUE', bayId: 'twr-runway-queue', rackId: 'rwy-23' }), fdrFiled('05'), view);
  assert.deepEqual(r, { runwayId: '05/23', end: '23', source: 'RACK' });
});

test('on the drag path the target rack wins over the rack the Strip is in (decisions.md Q27)', () => {
  const view = viewWith('OPEN');
  const r = resolveRunwayForStrip(departure(), fdrFiled('05'), view, { targetRackId: 'rwy-23' });
  assert.deepEqual(r, { runwayId: '05/23', end: '23', source: 'TARGET_RACK' });
  // A target rack that is no runway's changes nothing.
  assert.equal(resolveRunwayForStrip(departure(), fdrFiled('05'), view, { targetRackId: 'main' }).source, 'FDR');
});

test('runwayIdForStrip falls back to filed.departureRunway (DEPARTURE) and assigned.landingRunway (ARRIVAL)', () => {
  const view = viewWith('OPEN');
  assert.deepEqual(resolveRunwayForStrip(departure(), fdrFiled('rwy 23'), view), { runwayId: '05/23', end: '23', source: 'FDR' });
  assert.deepEqual(resolveRunwayForStrip(arrival(), fdrLanding('5'), view), { runwayId: '05/23', end: '05', source: 'FDR' });
  // A whole-runway designator names the pavement but no direction.
  assert.deepEqual(resolveRunwayForStrip(arrival(), fdrLanding('05/23'), view), { runwayId: '05/23', end: null, source: 'FDR' });
});

test('then to the active runway, then nothing (decisions.md S-Q25)', () => {
  assert.deepEqual(resolveRunwayForStrip(departure(), fdrFiled(null), viewWith('OPEN')), { runwayId: '05/23', end: '05', source: 'ACTIVE_RUNWAY' });
  assert.deepEqual(resolveRunwayForStrip(departure(), fdrFiled('99'), viewWith('OPEN')), { runwayId: '05/23', end: '05', source: 'ACTIVE_RUNWAY' });
  assert.equal(resolveRunwayForStrip(departure(), fdrFiled(null), viewWith('OPEN', { activeRunway: null })), null);
  assert.equal(resolveRunwayForStrip(departure(), null, viewWith('OPEN', { activeRunway: null })), null);
});

test('OVERFLIGHT and MISSION Strips have no runway', () => {
  const view = viewWith('CLOSED');
  assert.equal(resolveRunwayForStrip({ role: 'OVERFLIGHT', rackId: 'rwy-05' }, fdrFiled('05'), view), null);
  assert.equal(resolveRunwayForStrip({ role: 'MISSION', rackId: 'rwy-05' }, fdrFiled('05'), view), null);
});

test('runwayInhibitFor fails open: no field state, unknown runway, OPEN runway -> null', () => {
  assert.equal(runwayInhibitFor(departure(), fdrFiled('05'), null), null);
  assert.equal(runwayInhibitFor(departure(), fdrFiled('05'), viewWith('OPEN')), null);
  assert.equal(runwayInhibitFor(departure(), fdrFiled('17'), viewWith('CLOSED', { activeRunway: null })), null);
  const empty = buildStatusView({ runways: [] }, { activeRunway: null, runways: [] });
  assert.equal(runwayInhibitFor(departure(), fdrFiled('05'), empty), null);
});

test('runwayInhibitFor names the runway and the cause for each unusable status', () => {
  assert.equal(runwayInhibitFor(departure(), fdrFiled('05'), viewWith('SUSPENDED_BARRIER_CHANGE')), 'runway 05/23 suspended — barrier change');
  assert.equal(runwayInhibitFor(departure(), fdrFiled('05'), viewWith('SUSPENDED_INSPECTION')), 'runway 05/23 suspended — awaiting inspection');
  assert.equal(runwayInhibitFor(departure(), fdrFiled('05'), viewWith('SUSPENDED_INSPECTION', { kind: 'RUNWAY_CHANGE' })), 'runway 05/23 suspended — awaiting inspection');
  assert.equal(runwayInhibitFor(departure(), fdrFiled('05'), viewWith('CLOSED')), 'runway 05/23 closed');
});

test('runwayAdvisoryFor flags a Strip queued for the inactive end, and nothing else (decisions.md Q30)', () => {
  const view = viewWith('OPEN', { activeRunway: '23' });
  assert.equal(runwayAdvisoryFor(departure({ bayId: 'twr-runway-queue', rackId: 'rwy-05' }), view), 'queued for inactive runway 05');
  assert.equal(runwayAdvisoryFor(departure({ bayId: 'twr-runway-queue', rackId: 'rwy-23' }), view), null);
  assert.equal(runwayAdvisoryFor(departure(), view), null);
});

test('runwayRackFor files a Strip under its filed end, else the active end, else leaves it to the caller (decisions.md Q26)', () => {
  const queue = INCIRLIK.bays.TWR.find(b => b.bayId === 'twr-runway-queue');
  const view = viewWith('OPEN', { activeRunway: '23' });
  assert.equal(runwayRackFor(queue, departure(), fdrFiled('05'), view), 'rwy-05');
  assert.equal(runwayRackFor(queue, departure(), fdrFiled(null), view), 'rwy-23');
  assert.equal(runwayRackFor(queue, departure(), fdrFiled(null), viewWith('OPEN', { activeRunway: null })), null);
  const other = { bayId: 'twr-final', rackIds: ['main'] };
  assert.equal(runwayRackFor(other, departure(), fdrFiled('05'), view), null);
});

test('the active end is the one most into the TRUE wind (decisions.md H22)', () => {
  // Incirlik's ends are 056 and 236 true.
  assert.equal(activeEndIntoWind(INVENTORY, 60), '05');
  assert.equal(activeEndIntoWind(INVENTORY, 230), '23');
  assert.equal(activeEndIntoWind(INVENTORY, 300), '23'); // 64 degrees off 236, 116 off 056
  assert.equal(activeEndIntoWind(INVENTORY, 140), '05'); // 84 degrees off 056, 96 off 236
  // A pure crosswind is a tie, and a tie goes to inventory order.
  assert.equal(activeEndIntoWind(INVENTORY, 146), '05');
  assert.equal(activeEndIntoWind(INVENTORY, NaN), null);
  assert.equal(activeEndIntoWind({ runways: [] }, 60), null);
});

test('missionKeyOf is stable for the same mission and differs for another', () => {
  const m = { theatre: 'Syria', waypoints: [{ name: 'A' }, { name: 'B' }], drawings: [{ name: 'X' }] };
  assert.equal(missionKeyOf(m), missionKeyOf(structuredClone(m)));
  assert.notEqual(missionKeyOf(m), missionKeyOf({ ...m, drawings: [] }));
  assert.equal(missionKeyOf(null), null);
});
