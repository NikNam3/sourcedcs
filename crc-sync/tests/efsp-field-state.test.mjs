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

test("runwayRackFor files a Strip under its filed end, else the active end, else the Bay's first rack (decisions.md Q26)", () => {
  const queue = INCIRLIK.bays.TWR.find(b => b.bayId === 'twr-runway-queue');
  const view = viewWith('OPEN', { activeRunway: '23' });
  assert.equal(runwayRackFor(departure(), fdrFiled('05'), view, queue), 'rwy-05');
  assert.equal(runwayRackFor(departure(), fdrFiled(null), view, queue), 'rwy-23');
  assert.equal(runwayRackFor(departure(), fdrFiled(null), viewWith('OPEN', { activeRunway: null }), queue), 'rwy-05');
  assert.equal(runwayRackFor(departure(), fdrFiled('23'), null, queue), 'rwy-05'); // no field state: as before
  const other = { bayId: 'twr-final', rackIds: ['main'] };
  assert.equal(runwayRackFor(departure(), fdrFiled('05'), view, other), 'main');
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

// ── step 2 — the store, driven directly ─────────────────────────────────────

const { FieldStateStore } = await import('../src/efsp/field-state-store.js');
const { MutationLog } = await import('../src/efsp/mutation-log.js');

/** A facility-config stand-in over the SHIPPED INCIRLIK config (plus a runway-less CENTER), or an overridden inventory. */
function fixtureConfig(fieldStateOverride) {
  const incirlik = structuredClone(INCIRLIK);
  if (fieldStateOverride) incirlik.fieldState = fieldStateOverride;
  const center = facilityConfig.getFacilityConfig('CENTER');
  return {
    getFacilityIds: () => ['INCIRLIK', 'CENTER'],
    getFacilityConfig: (id) => structuredClone(id === 'INCIRLIK' ? incirlik : center),
  };
}

let logN = 0;
function freshStore({ fieldStateOverride, deps } = {}) {
  const logPath = path.join(tmpDir, `store-${++logN}.jsonl`);
  const store = new FieldStateStore(fixtureConfig(fieldStateOverride), deps);
  store.setMutationLog(new MutationLog(logPath));
  const log = () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  return { store, log };
}

function op(store, positionId, kind, fields = {}, { by = `c-${positionId}`, baseRev } = {}) {
  const rev = baseRev === undefined ? store.getFieldState('INCIRLIK').rev : baseRev;
  return store.apply({ clientMutationId: `m-${Math.random()}`, facilityId: 'INCIRLIK', baseRev: rev, op: { kind, ...fields } }, positionId, by);
}
function mustOp(store, positionId, kind, fields, opts) {
  const r = op(store, positionId, kind, fields, opts);
  assert.equal(r.ok, true, `${kind} as ${positionId}: ${JSON.stringify({ reason: r.reason, detail: r.detail })}`);
  return r.fieldState;
}
const rwy = (fs_) => fs_.runways.find(r => r.runwayId === '05/23');

test('the store seeds one record per Facility with an inventory, every runway OPEN, no active runway yet', () => {
  const { store } = freshStore();
  assert.equal(store.getAll().length, 1);
  assert.equal(store.getFieldState('CENTER'), null);
  assert.equal(store.statusView('CENTER'), null);
  const fsI = store.getFieldState('INCIRLIK');
  assert.equal(fsI.rev, 0);
  assert.equal(fsI.activeRunway, null);
  assert.equal(rwy(fsI).status, 'OPEN');
  assert.deepEqual(rwy(fsI).ends, ['05', '23']);
  assert.deepEqual(rwy(fsI).rackIds, { '05': 'rwy-05', '23': 'rwy-23' });
  assert.equal(fsI.runwayChange, null);
  assert.equal(fsI.runwayChangeInProgress, false);
  assert.deepEqual(fsI.hotCargoPad, { name: 'Hot cargo pad', occupied: false, occupantFdrId: null });
  assert.deepEqual(fsI.alertPad, { name: 'Alert pad', occupied: false, occupantFdrId: null });
});

test('TWR begins a barrier change: the whole pavement is suspended in one rev, with the kind and who', () => {
  const { store } = freshStore();
  const seq = store.currentSeq;
  const fsI = mustOp(store, 'TWR', 'BeginBarrierChange', { runwayId: '05/23', note: 'BAK-12 re-rig' });
  assert.equal(fsI.rev, 1);
  assert.equal(store.currentSeq, seq + 1);
  assert.equal(rwy(fsI).status, 'SUSPENDED_BARRIER_CHANGE');
  assert.equal(rwy(fsI).suspension.kind, 'BARRIER_CHANGE');
  assert.equal(rwy(fsI).suspension.positionId, 'TWR');
  assert.equal(rwy(fsI).suspension.by, 'c-TWR');
  assert.equal(rwy(fsI).suspension.note, 'BAK-12 re-rig');
});

test('OPS cannot begin a barrier change or close a runway itself — only TWR (decisions.md H18)', () => {
  const { store } = freshStore();
  for (const kind of ['BeginBarrierChange', 'CloseRunway']) {
    const r = op(store, 'OPS', kind, { runwayId: '05/23' });
    assert.equal(r.reason, 'PERMISSION_DENIED', kind);
    assert.equal(rwy(r.fieldState).status, 'OPEN');
  }
});

test('CompleteBarrierChange moves to SUSPENDED_INSPECTION, never to OPEN, and keeps the suspension', () => {
  const { store } = freshStore();
  mustOp(store, 'TWR', 'BeginBarrierChange', { runwayId: '05/23' });
  assert.equal(op(store, 'TWR', 'CompleteBarrierChange', { runwayId: '05/23' }).reason, 'PERMISSION_DENIED');
  const fsI = mustOp(store, 'OPS', 'CompleteBarrierChange', { runwayId: '05/23' });
  assert.equal(rwy(fsI).status, 'SUSPENDED_INSPECTION');
  assert.equal(rwy(fsI).suspension.kind, 'BARRIER_CHANGE');
});

test('OpenRunway cannot reopen a suspended runway (rule 2 has no side door), nor can CloseRunway', () => {
  const { store } = freshStore();
  mustOp(store, 'TWR', 'BeginBarrierChange', { runwayId: '05/23' });
  for (const kind of ['OpenRunway', 'CloseRunway']) {
    const r = op(store, 'TWR', kind, { runwayId: '05/23' });
    assert.equal(r.ok, false, kind);
    assert.equal(rwy(r.fieldState).status, 'SUSPENDED_BARRIER_CHANGE');
  }
  mustOp(store, 'OPS', 'CompleteBarrierChange', { runwayId: '05/23' });
  const r = op(store, 'TWR', 'OpenRunway', { runwayId: '05/23' });
  assert.match(r.detail, /only through an inspection/);
  assert.equal(rwy(r.fieldState).status, 'SUSPENDED_INSPECTION');
});

test('CompleteInspection reopens the runway and stamps lastInspection {by, positionId, at}', () => {
  const { store } = freshStore();
  mustOp(store, 'TWR', 'BeginBarrierChange', { runwayId: '05/23' });
  mustOp(store, 'OPS', 'CompleteBarrierChange', { runwayId: '05/23' });
  const fsI = mustOp(store, 'OPS', 'CompleteInspection', { runwayId: '05/23', note: 'cable tensioned, FOD walk done' });
  assert.equal(rwy(fsI).status, 'OPEN');
  assert.equal(rwy(fsI).suspension, null);
  assert.equal(rwy(fsI).lastInspection.positionId, 'OPS');
  assert.equal(rwy(fsI).lastInspection.by, 'c-OPS');
  assert.ok(Number.isFinite(rwy(fsI).lastInspection.at));
  assert.equal(rwy(fsI).lastInspection.note, 'cable tensioned, FOD walk done');
});

test('CompleteInspection is refused to a Position other than inspectionAuthorityPositionId, even one the table allows', () => {
  // Shipped config: the table ceiling is OPS and the config says OPS, so every
  // other Position is refused by the table.
  const { store } = freshStore();
  mustOp(store, 'TWR', 'BeginBarrierChange', { runwayId: '05/23' });
  mustOp(store, 'OPS', 'CompleteBarrierChange', { runwayId: '05/23' });
  for (const p of ['TWR', 'APP', 'GND', 'CD']) assert.equal(op(store, p, 'CompleteInspection', { runwayId: '05/23' }).reason, 'PERMISSION_DENIED', p);
  // A config naming another Position narrows OPS out too — it never widens.
  const narrowed = structuredClone(INVENTORY);
  narrowed.inspectionAuthorityPositionId = 'APP';
  const { store: s2 } = freshStore({ fieldStateOverride: narrowed });
  mustOp(s2, 'TWR', 'BeginBarrierChange', { runwayId: '05/23' });
  mustOp(s2, 'OPS', 'CompleteBarrierChange', { runwayId: '05/23' });
  const r = op(s2, 'OPS', 'CompleteInspection', { runwayId: '05/23' });
  assert.equal(r.reason, 'PERMISSION_DENIED');
  assert.match(r.detail, /only APP/);
  assert.equal(op(s2, 'APP', 'CompleteInspection', { runwayId: '05/23' }).reason, 'PERMISSION_DENIED'); // not widened
});

test('CloseRunway / OpenRunway round trip (TWR)', () => {
  const { store } = freshStore();
  let fsI = mustOp(store, 'TWR', 'CloseRunway', { runwayId: '05/23', reason: 'FOD' });
  assert.equal(rwy(fsI).status, 'CLOSED');
  assert.equal(rwy(fsI).closure.reason, 'FOD');
  assert.equal(rwy(fsI).closure.positionId, 'TWR');
  fsI = mustOp(store, 'TWR', 'OpenRunway', { runwayId: '05/23' });
  assert.equal(rwy(fsI).status, 'OPEN');
  assert.equal(rwy(fsI).closure, null);
});

test('OPS asks tower to close the runway; tower accepts and the closure names who asked (decisions.md H18)', () => {
  const { store } = freshStore();
  let fsI = mustOp(store, 'OPS', 'RequestRunwayStatus', { runwayId: '05/23', action: 'CLOSE', note: 'FOD reported' });
  assert.equal(rwy(fsI).status, 'OPEN');
  assert.equal(rwy(fsI).pendingRequest.action, 'CLOSE');
  assert.equal(rwy(fsI).pendingRequest.requestedPositionId, 'OPS');
  assert.equal(op(store, 'GND', 'RequestRunwayStatus', { runwayId: '05/23', action: 'CLOSE' }).detail, 'OPS already has a CLOSE request with tower for runway 05/23');
  assert.equal(op(store, 'OPS', 'AcceptRunwayRequest', { runwayId: '05/23' }).reason, 'PERMISSION_DENIED');
  fsI = mustOp(store, 'TWR', 'AcceptRunwayRequest', { runwayId: '05/23' });
  assert.equal(rwy(fsI).status, 'CLOSED');
  assert.equal(rwy(fsI).pendingRequest, null);
  assert.equal(rwy(fsI).closure.positionId, 'TWR');
  assert.equal(rwy(fsI).closure.requestedBy.positionId, 'OPS');
  assert.equal(rwy(fsI).closure.reason, 'FOD reported');
});

test('tower rejects a request; a request for what the runway already is, or from TWR itself, is refused', () => {
  const { store } = freshStore();
  assert.match(op(store, 'OPS', 'RequestRunwayStatus', { runwayId: '05/23', action: 'OPEN' }).detail, /nothing to ask/);
  assert.equal(op(store, 'OPS', 'RequestRunwayStatus', { runwayId: '05/23', action: 'PAINT' }).reason, 'VALIDATION_ERROR');
  assert.equal(op(store, 'TWR', 'RequestRunwayStatus', { runwayId: '05/23', action: 'CLOSE' }).reason, 'PERMISSION_DENIED');
  mustOp(store, 'APP', 'RequestRunwayStatus', { runwayId: '05/23', action: 'BARRIER_CHANGE' });
  const fsI = mustOp(store, 'TWR', 'RejectRunwayRequest', { runwayId: '05/23', note: 'recovery in progress' });
  assert.equal(rwy(fsI).status, 'OPEN');
  assert.equal(rwy(fsI).pendingRequest, null);
  const last = fsI.transitions.at(-1);
  assert.equal(last.op, 'RejectRunwayRequest');
  assert.equal(last.request.requestedPositionId, 'APP');
  assert.equal(last.note, 'recovery in progress');
});

test('a request made moot by a direct tower op is settled in the same transition', () => {
  const { store } = freshStore();
  mustOp(store, 'OPS', 'RequestRunwayStatus', { runwayId: '05/23', action: 'CLOSE' });
  const fsI = mustOp(store, 'TWR', 'BeginBarrierChange', { runwayId: '05/23' });
  assert.equal(rwy(fsI).pendingRequest, null);
  assert.equal(fsI.transitions.at(-1).settledRequest.action, 'CLOSE');
});

test('a stale baseRev is refused as STALE_REV, carries the record, and is audited', () => {
  const { store, log } = freshStore();
  mustOp(store, 'TWR', 'CloseRunway', { runwayId: '05/23' });
  const r = op(store, 'TWR', 'OpenRunway', { runwayId: '05/23' }, { baseRev: 0 });
  assert.equal(r.reason, 'STALE_REV');
  assert.equal(rwy(r.fieldState).status, 'CLOSED');
  const entry = log().at(-1);
  assert.equal(entry.reason, 'STALE_REV');
  assert.equal(entry.ok, false);
  assert.equal(entry.fieldStateFacilityId, 'INCIRLIK');
  assert.equal(entry.op, 'OpenRunway');
});

test('every refusal is audited (PERMISSION_DENIED, VALIDATION_ERROR, NOT_FOUND)', () => {
  const { store, log } = freshStore();
  op(store, 'OPS', 'CloseRunway', { runwayId: '05/23' });
  op(store, 'TWR', 'OpenRunway', { runwayId: '05/23' });
  op(store, 'TWR', 'CloseRunway', { runwayId: '17/35' });
  store.apply({ facilityId: 'CENTER', op: { kind: 'CloseRunway', runwayId: '05/23' } }, 'TWR', 'c-TWR');
  op(store, 'TWR', 'PaintRunway', { runwayId: '05/23' });
  const reasons = log().map(e => [e.op, e.reason, e.fieldStateFacilityId]);
  assert.deepEqual(reasons, [
    ['CloseRunway', 'PERMISSION_DENIED', 'INCIRLIK'],
    ['OpenRunway', 'VALIDATION_ERROR', 'INCIRLIK'],
    ['CloseRunway', 'NOT_FOUND', 'INCIRLIK'],
    ['CloseRunway', 'NOT_FOUND', 'CENTER'],
    ['PaintRunway', 'VALIDATION_ERROR', 'INCIRLIK'],
  ]);
  assert.ok(log().every(e => e.ok === false));
});

test('every success appends to transitions[], bumps rev and currentSeq exactly once, and is audited with before/after', () => {
  const { store, log } = freshStore();
  const steps = [
    ['TWR', 'BeginBarrierChange'], ['OPS', 'CompleteBarrierChange'], ['OPS', 'CompleteInspection'],
    ['TWR', 'CloseRunway'], ['TWR', 'OpenRunway'],
  ];
  for (const [i, [p, kind]] of steps.entries()) {
    const seq = store.currentSeq;
    const fsI = mustOp(store, p, kind, { runwayId: '05/23' });
    assert.equal(fsI.rev, i + 1);
    assert.equal(store.currentSeq, seq + 1);
    assert.equal(fsI.transitions.length, i + 1);
    assert.equal(fsI.transitions.at(-1).op, kind);
    assert.equal(fsI.transitions.at(-1).positionId, p);
    const entry = log().at(-1);
    assert.equal(entry.ok, true);
    assert.equal(entry.runwayId, '05/23');
    assert.equal(entry.before.rev, i);
    assert.equal(entry.after.rev, i + 1);
  }
});

test('the status view is cached and rebuilt only when the record changes; nothing reaches the store through it', () => {
  const { store } = freshStore();
  const v1 = store.statusView('INCIRLIK');
  assert.equal(store.statusView('INCIRLIK'), v1);
  assert.throws(() => { v1.runways[0].status = 'CLOSED'; });
  mustOp(store, 'TWR', 'CloseRunway', { runwayId: '05/23' });
  const v2 = store.statusView('INCIRLIK');
  assert.notEqual(v2, v1);
  assert.equal(v2.runways[0].status, 'CLOSED');
  const copy = store.getFieldState('INCIRLIK');
  copy.runways[0].status = 'OPEN';
  assert.equal(store.getFieldState('INCIRLIK').runways[0].status, 'CLOSED');
});

test('the mission wind sets the active end once per mission; a reconnect keeps what is there (decisions.md H22)', () => {
  const { store, log } = freshStore();
  let r = store.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 240, windKt: 12, missionKey: 'Syria:a' });
  assert.deepEqual([r.ok, r.activeRunway], [true, '23']);
  let fsI = store.getFieldState('INCIRLIK');
  assert.equal(fsI.activeRunway, '23');
  assert.equal(fsI.activeRunwaySource.kind, 'WIND');
  assert.equal(fsI.activeRunwaySource.windFromTrue, 240);
  assert.equal(log().at(-1).op, 'ActiveRunwayFromWind');
  assert.equal(log().at(-1).actorId, 'crc-sync');
  // Same mission again (a reconnect): nothing changes even if the wind reads differently.
  r = store.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 60, windKt: 3, missionKey: 'Syria:a' });
  assert.deepEqual([r.changed, store.getFieldState('INCIRLIK').activeRunway], [false, '23']);
  // A new mission re-derives.
  r = store.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 60, windKt: 8, missionKey: 'Syria:b' });
  assert.equal(store.getFieldState('INCIRLIK').activeRunway, '05');
  assert.equal(store.setActiveRunwayFromWind('CENTER', { windFromTrue: 60 }).reason, 'NOT_FOUND');
});

test('snapshot/restore round-trips a SUSPENDED_BARRIER_CHANGE runway intact', () => {
  const { store } = freshStore();
  store.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 60, missionKey: 'k' });
  mustOp(store, 'TWR', 'BeginBarrierChange', { runwayId: '05/23', note: 're-rig' });
  const snap = JSON.parse(JSON.stringify(store.snapshot()));
  const { store: reborn } = freshStore();
  reborn.restore(snap);
  const fsI = reborn.getFieldState('INCIRLIK');
  assert.equal(rwy(fsI).status, 'SUSPENDED_BARRIER_CHANGE');
  assert.equal(rwy(fsI).suspension.positionId, 'TWR');
  assert.equal(rwy(fsI).suspension.note, 're-rig');
  assert.equal(fsI.activeRunway, '05');
  assert.equal(fsI.rev, store.getFieldState('INCIRLIK').rev);
  assert.equal(reborn.statusView('INCIRLIK').runways[0].status, 'SUSPENDED_BARRIER_CHANGE');
  // No inventory in the snapshot — the gear comes from config.
  assert.ok(!('arrestingGear' in snap[0].runways[0]));
});

test('restore drops a runway no longer configured and seeds a newly configured one OPEN', () => {
  const { store } = freshStore();
  mustOp(store, 'TWR', 'CloseRunway', { runwayId: '05/23' });
  const snap = store.snapshot();
  const inv = structuredClone(INVENTORY);
  inv.runways = [{ runwayId: '17/35', ends: ['17', '35'], endHeadingsTrue: { '17': 170, '35': 350 }, arrestingGear: [] }];
  const { store: reborn } = freshStore({ fieldStateOverride: inv });
  reborn.restore(snap);
  const fsI = reborn.getFieldState('INCIRLIK');
  assert.deepEqual(fsI.runways.map(r => [r.runwayId, r.status]), [['17/35', 'OPEN']]);
  // A snapshot for a Facility with no inventory is skipped.
  reborn.restore([{ facilityId: 'CENTER', runways: [] }]);
  assert.equal(reborn.getFieldState('CENTER'), null);
});

test('apply never throws on garbage input', () => {
  const { store } = freshStore();
  for (const bad of [null, undefined, 7, {}, { facilityId: 'INCIRLIK' }, { facilityId: 'INCIRLIK', op: null },
    { facilityId: 'INCIRLIK', op: { kind: 'CloseRunway' } }, { facilityId: 'INCIRLIK', op: { kind: 'RequestRunwayStatus', runwayId: '05/23', action: {} } }]) {
    const r = store.apply(bad, 'TWR', 'c-TWR');
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  assert.equal(rwy(store.getFieldState('INCIRLIK')).status, 'OPEN');
});

// ── step 3 — the wire, permission and persistence ───────────────────────────

const { createEfsp } = await import('../src/efsp/index.js');
const { crew, hold } = await import('./helpers/efsp-scenario.mjs');

const efsp = createEfsp();
const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER' });

function fieldAct(e, member, positionId, op, { facilityId = 'INCIRLIK', baseRev } = {}) {
  const current = e.fieldStateStore.getFieldState(facilityId);
  return e.handleMessage(member.session, {
    version: 1, type: 'efsp-field-state-mutation', clientMutationId: `fs-${Math.random()}`,
    facilityId, baseRev: baseRev === undefined ? (current ? current.rev : undefined) : baseRev,
    actingPositionId: positionId, op,
  });
}
const mutationLog = () => fs.readFileSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l));

test('efsp-field-state-mutation routes, applies, acks and broadcasts efsp-field-state-delta with its own fieldStateSeq', () => {
  const boardSeq = efsp.boardStore.currentSeq;
  const seq = efsp.fieldStateStore.currentSeq;
  const out = fieldAct(efsp, c.TWR, 'TWR', { kind: 'CloseRunway', runwayId: '05/23', reason: 'FOD' });
  assert.equal(out.ack.type, 'efsp-field-state-ack');
  assert.equal(out.ack.ok, true);
  assert.equal(out.ack.facilityId, 'INCIRLIK');
  assert.equal(out.ack.runwayId, '05/23');
  assert.equal(out.ack.fieldStateSeq, seq + 1);
  assert.equal(rwy(out.ack.fieldState).status, 'CLOSED');
  assert.equal(out.broadcast.type, 'efsp-field-state-delta');
  assert.equal(out.broadcast.fieldStateSeq, seq + 1);
  assert.equal(rwy(out.broadcast.fieldStates.updated[0]).status, 'CLOSED');
  // Rule 5's deviation: the Board sequence does not move.
  assert.equal(efsp.boardStore.currentSeq, boardSeq);
  const back = fieldAct(efsp, c.TWR, 'TWR', { kind: 'OpenRunway', runwayId: '05/23' });
  assert.equal(back.ack.ok, true);
});

test('a field-state op from a session not Primary at that Position AT THAT FACILITY is refused NOT_HOLDING_POSITION', () => {
  // OPS's controller naming TWR.
  let out = fieldAct(efsp, c.OPS, 'TWR', { kind: 'CloseRunway', runwayId: '05/23' });
  assert.equal(out.ack.reason, 'NOT_HOLDING_POSITION');
  // Primary at CTR at CENTER, naming OPS: not Primary at OPS at INCIRLIK.
  out = fieldAct(efsp, c.CTR, 'OPS', { kind: 'CompleteInspection', runwayId: '05/23' });
  assert.equal(out.ack.reason, 'NOT_HOLDING_POSITION');
  // Primary at CTR, acting CTR, against INCIRLIK's field.
  out = fieldAct(efsp, c.CTR, 'CTR', { kind: 'CloseRunway', runwayId: '05/23' });
  assert.equal(out.ack.reason, 'NOT_HOLDING_POSITION');
  assert.equal(out.broadcast, undefined);
  assert.equal(rwy(out.ack.fieldState).status, 'OPEN');
});

test('a refused field-state op returns only an ack, with the current record, and does not persist', () => {
  const before = fs.existsSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH) ? fs.readFileSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, 'utf8') : null;
  const out = fieldAct(efsp, c.OPS, 'OPS', { kind: 'CloseRunway', runwayId: '05/23' });
  assert.equal(out.ack.ok, false);
  assert.equal(out.ack.reason, 'PERMISSION_DENIED');
  assert.equal(out.broadcast, undefined);
  assert.equal(rwy(out.ack.fieldState).status, 'OPEN');
  const after = fs.existsSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH) ? fs.readFileSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, 'utf8') : null;
  assert.equal(after, before);
});

test('the snapshot carries fieldStates; efsp-resync has no field-state branch', () => {
  const snap = efsp.snapshotFor();
  assert.equal(snap.fieldStates.length, 1);
  assert.equal(snap.fieldStates[0].facilityId, 'INCIRLIK');
  assert.equal(rwy(snap.fieldStates[0]).status, 'OPEN');
  // A delta-served resync carries Strips only; field state comes with a snapshot.
  const resync = efsp.handleMessage(c.TWR.session, { type: 'efsp-resync', facilityId: 'INCIRLIK', lastBoardSeq: efsp.boardStore.currentSeq });
  assert.equal(resync.ack.type, 'efsp-board-delta');
  assert.equal(JSON.stringify(resync).includes('fieldState'), false);
});

test('a field-state op writes the Mutation log with fieldStateFacilityId and runwayId', () => {
  fieldAct(efsp, c.OPS, 'OPS', { kind: 'RequestRunwayStatus', runwayId: '05/23', action: 'CLOSE', note: 'bird strike debris' });
  const entry = mutationLog().at(-1);
  assert.equal(entry.op, 'RequestRunwayStatus');
  assert.equal(entry.fieldStateFacilityId, 'INCIRLIK');
  assert.equal(entry.runwayId, '05/23');
  assert.equal(entry.actingPositionId, 'OPS');
  assert.equal(entry.actorId, 'c-OPS');
  assert.equal(entry.ok, true);
  assert.equal(fieldAct(efsp, c.TWR, 'TWR', { kind: 'RejectRunwayRequest', runwayId: '05/23' }).ack.ok, true);
});

test('a suspension persists and a fresh createEfsp() restores it SUSPENDED_BARRIER_CHANGE', () => {
  assert.equal(fieldAct(efsp, c.TWR, 'TWR', { kind: 'BeginBarrierChange', runwayId: '05/23' }).ack.ok, true);
  const reborn = createEfsp();
  const fsI = reborn.fieldStateStore.getFieldState('INCIRLIK');
  assert.equal(rwy(fsI).status, 'SUSPENDED_BARRIER_CHANGE');
  assert.equal(rwy(fsI).suspension.positionId, 'TWR');
  // Drive the shared field back to OPEN for whoever runs next.
  assert.equal(fieldAct(efsp, c.OPS, 'OPS', { kind: 'CompleteBarrierChange', runwayId: '05/23' }).ack.ok, true);
  assert.equal(fieldAct(efsp, c.OPS, 'OPS', { kind: 'CompleteInspection', runwayId: '05/23' }).ack.ok, true);
});

test('a handler with no field-state store answers, never throws (a hand-built ctx)', async () => {
  const { handleMessage } = await import('../src/efsp/efsp-ws.js');
  const out = handleMessage({ facilityConfig: { DEFAULT_FACILITY_ID: 'INCIRLIK' } }, { controllerId: 'x' },
    { type: 'efsp-field-state-mutation', actingPositionId: 'TWR', op: { kind: 'CloseRunway', runwayId: '05/23' } }, () => {});
  assert.equal(out.ack.ok, false);
  assert.equal(out.ack.detail, 'no field-state store');
});
