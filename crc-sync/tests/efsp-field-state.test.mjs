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
  validateFieldStateInventory, runwayInventoryWarnings,
} = fieldState;

const INCIRLIK = facilityConfig.getFacilityConfig('INCIRLIK');
const INVENTORY = INCIRLIK.fieldState;

/** A view as the store would build it, with the pavement at `status`. */
function viewWith(status, { activeRunway = '05', kind = 'WORKS', inventory = INVENTORY } = {}) {
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

test('LEGAL_TRANSITIONS has no SUSPENDED_WORKS -> OPEN edge (rule 2, structurally)', () => {
  assert.equal(canGo('SUSPENDED_WORKS', 'OPEN'), false);
  assert.deepEqual(LEGAL_TRANSITIONS.SUSPENDED_WORKS, ['SUSPENDED_INSPECTION']);
});

test('every path from SUSPENDED_WORKS to OPEN passes through SUSPENDED_INSPECTION', () => {
  // Every simple path, by exhaustive search — the table is tiny.
  const paths = [];
  const walk = (at, seen) => {
    if (at === 'OPEN') { paths.push(seen); return; }
    for (const next of LEGAL_TRANSITIONS[at] || []) if (!seen.includes(next)) walk(next, [...seen, next]);
  };
  walk('SUSPENDED_WORKS', ['SUSPENDED_WORKS']);
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
  assert.equal(runwayInhibitFor(departure(), fdrFiled('05'), viewWith('SUSPENDED_WORKS')), 'runway 05/23 suspended — works in progress');
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

test('TWR begins runway works: the whole pavement is suspended in one rev, with the kind and who', () => {
  const { store } = freshStore();
  const seq = store.currentSeq;
  const fsI = mustOp(store, 'TWR', 'BeginRunwayWorks', { runwayId: '05/23', note: 'BAK-12 re-rig' });
  assert.equal(fsI.rev, 1);
  assert.equal(store.currentSeq, seq + 1);
  assert.equal(rwy(fsI).status, 'SUSPENDED_WORKS');
  assert.equal(rwy(fsI).suspension.kind, 'WORKS');
  assert.equal(rwy(fsI).suspension.positionId, 'TWR');
  assert.equal(rwy(fsI).suspension.by, 'c-TWR');
  assert.equal(rwy(fsI).suspension.note, 'BAK-12 re-rig');
});

test('OPS cannot begin runway works or close a runway itself — only TWR (decisions.md H18)', () => {
  const { store } = freshStore();
  for (const kind of ['BeginRunwayWorks', 'CloseRunway']) {
    const r = op(store, 'OPS', kind, { runwayId: '05/23' });
    assert.equal(r.reason, 'PERMISSION_DENIED', kind);
    assert.equal(rwy(r.fieldState).status, 'OPEN');
  }
});

test('CompleteRunwayWorks moves to SUSPENDED_INSPECTION, never to OPEN, and keeps the suspension', () => {
  const { store } = freshStore();
  mustOp(store, 'TWR', 'BeginRunwayWorks', { runwayId: '05/23' });
  assert.equal(op(store, 'TWR', 'CompleteRunwayWorks', { runwayId: '05/23' }).reason, 'PERMISSION_DENIED');
  const fsI = mustOp(store, 'OPS', 'CompleteRunwayWorks', { runwayId: '05/23' });
  assert.equal(rwy(fsI).status, 'SUSPENDED_INSPECTION');
  assert.equal(rwy(fsI).suspension.kind, 'WORKS');
});

test('OpenRunway cannot reopen a suspended runway (rule 2 has no side door), nor can CloseRunway', () => {
  const { store } = freshStore();
  mustOp(store, 'TWR', 'BeginRunwayWorks', { runwayId: '05/23' });
  for (const kind of ['OpenRunway', 'CloseRunway']) {
    const r = op(store, 'TWR', kind, { runwayId: '05/23' });
    assert.equal(r.ok, false, kind);
    assert.equal(rwy(r.fieldState).status, 'SUSPENDED_WORKS');
  }
  mustOp(store, 'OPS', 'CompleteRunwayWorks', { runwayId: '05/23' });
  const r = op(store, 'TWR', 'OpenRunway', { runwayId: '05/23' });
  assert.match(r.detail, /only through an inspection/);
  assert.equal(rwy(r.fieldState).status, 'SUSPENDED_INSPECTION');
});

test('CompleteInspection reopens the runway and stamps lastInspection {by, positionId, at}', () => {
  const { store } = freshStore();
  mustOp(store, 'TWR', 'BeginRunwayWorks', { runwayId: '05/23' });
  mustOp(store, 'OPS', 'CompleteRunwayWorks', { runwayId: '05/23' });
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
  mustOp(store, 'TWR', 'BeginRunwayWorks', { runwayId: '05/23' });
  mustOp(store, 'OPS', 'CompleteRunwayWorks', { runwayId: '05/23' });
  for (const p of ['TWR', 'APP', 'GND', 'CD']) assert.equal(op(store, p, 'CompleteInspection', { runwayId: '05/23' }).reason, 'PERMISSION_DENIED', p);
  // A config naming another Position narrows OPS out too — it never widens.
  const narrowed = structuredClone(INVENTORY);
  narrowed.inspectionAuthorityPositionId = 'APP';
  const { store: s2 } = freshStore({ fieldStateOverride: narrowed });
  mustOp(s2, 'TWR', 'BeginRunwayWorks', { runwayId: '05/23' });
  mustOp(s2, 'OPS', 'CompleteRunwayWorks', { runwayId: '05/23' });
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
  mustOp(store, 'APP', 'RequestRunwayStatus', { runwayId: '05/23', action: 'WORKS' });
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
  const fsI = mustOp(store, 'TWR', 'BeginRunwayWorks', { runwayId: '05/23' });
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
    ['TWR', 'BeginRunwayWorks'], ['OPS', 'CompleteRunwayWorks'], ['OPS', 'CompleteInspection'],
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
  let r = store.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 240, windKt: 12, missionSession: 1 });
  assert.deepEqual([r.ok, r.activeRunway], [true, '23']);
  let fsI = store.getFieldState('INCIRLIK');
  assert.equal(fsI.activeRunway, '23');
  assert.equal(fsI.activeRunwaySource.kind, 'WIND');
  assert.equal(fsI.activeRunwaySource.windFromTrue, 240);
  assert.equal(log().at(-1).op, 'ActiveRunwayFromWind');
  assert.equal(log().at(-1).actorId, 'crc-sync');
  // Same mission again (a reconnect): nothing changes even if the wind reads differently.
  r = store.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 60, windKt: 3, missionSession: 1 });
  assert.deepEqual([r.changed, store.getFieldState('INCIRLIK').activeRunway], [false, '23']);
  // A new mission re-derives.
  r = store.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 60, windKt: 8, missionSession: 2 });
  assert.equal(store.getFieldState('INCIRLIK').activeRunway, '05');
  assert.equal(store.setActiveRunwayFromWind('CENTER', { windFromTrue: 60 }).reason, 'NOT_FOUND');
});

test('snapshot/restore round-trips a SUSPENDED_WORKS runway intact', () => {
  const { store } = freshStore();
  store.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 60, missionSession: 1 });
  mustOp(store, 'TWR', 'BeginRunwayWorks', { runwayId: '05/23', note: 're-rig' });
  const snap = JSON.parse(JSON.stringify(store.snapshot()));
  const { store: reborn } = freshStore();
  reborn.restore(snap);
  const fsI = reborn.getFieldState('INCIRLIK');
  assert.equal(rwy(fsI).status, 'SUSPENDED_WORKS');
  assert.equal(rwy(fsI).suspension.positionId, 'TWR');
  assert.equal(rwy(fsI).suspension.note, 're-rig');
  assert.equal(fsI.activeRunway, '05');
  assert.equal(fsI.rev, store.getFieldState('INCIRLIK').rev);
  assert.equal(reborn.statusView('INCIRLIK').runways[0].status, 'SUSPENDED_WORKS');
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

test('a suspension persists and a fresh createEfsp() restores it SUSPENDED_WORKS', () => {
  assert.equal(fieldAct(efsp, c.TWR, 'TWR', { kind: 'BeginRunwayWorks', runwayId: '05/23' }).ack.ok, true);
  const reborn = createEfsp();
  const fsI = reborn.fieldStateStore.getFieldState('INCIRLIK');
  assert.equal(rwy(fsI).status, 'SUSPENDED_WORKS');
  assert.equal(rwy(fsI).suspension.positionId, 'TWR');
  // Drive the shared field back to OPEN for whoever runs next.
  assert.equal(fieldAct(efsp, c.OPS, 'OPS', { kind: 'CompleteRunwayWorks', runwayId: '05/23' }).ack.ok, true);
  assert.equal(fieldAct(efsp, c.OPS, 'OPS', { kind: 'CompleteInspection', runwayId: '05/23' }).ack.ok, true);
});

test('a handler with no field-state store answers, never throws (a hand-built ctx)', async () => {
  const { handleMessage } = await import('../src/efsp/efsp-ws.js');
  const out = handleMessage({ facilityConfig: { DEFAULT_FACILITY_ID: 'INCIRLIK' } }, { controllerId: 'x' },
    { type: 'efsp-field-state-mutation', actingPositionId: 'TWR', op: { kind: 'CloseRunway', runwayId: '05/23' } }, () => {});
  assert.equal(out.ack.ok, false);
  assert.equal(out.ack.detail, 'no field-state store');
});

// ── step 4 — rule 1: NLA is inhibited on a runway that is not usable ────────

const nla = await import('../src/efsp/nla.js');
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const everyoneHome = { isOccupied: () => true, coveringPositionFor: () => null };
const ctxWith = (view, extra = {}) => ({ ...everyoneHome, fieldStateFor: () => view, ...extra });
const readyFdr = (over = {}) => ({
  identity: { beaconAssigned: '4001' },
  filed: { route: 'DCT', requestedAltitude: '250', departureAirport: 'LTAG', destinationAirport: 'LTAG', departureRunway: '05', ...over.filed },
  assigned: { releaseState: 'RELEASED', landingRunway: '05', ...over.assigned },
});

test('TAXI, RUNWAY_QUEUE and LUAW are inhibited on a suspended runway, with the runway named in the reason', () => {
  const view = viewWith('SUSPENDED_WORKS');
  for (const [state, rackId] of [['TAXI', 'main'], ['RUNWAY_QUEUE', 'rwy-05'], ['LUAW', 'rwy-05']]) {
    const r = nla.computeNla({ role: 'DEPARTURE', state, rackId }, readyFdr(), NOW, ctxWith(view));
    assert.deepEqual(r, { inhibited: 'runway 05/23 suspended — works in progress' }, state);
  }
});

test('HANDED_TO_TOWER -> FINAL is inhibited on a suspended runway', () => {
  const r = nla.computeNla({ role: 'ARRIVAL', state: 'HANDED_TO_TOWER', rackId: 'main' }, readyFdr(), NOW, ctxWith(viewWith('SUSPENDED_INSPECTION')));
  assert.deepEqual(r, { inhibited: 'runway 05/23 suspended — awaiting inspection' });
});

test('FINAL -> LANDED is never inhibited — touchdown is an observation, not a clearance', () => {
  for (const status of ['SUSPENDED_WORKS', 'SUSPENDED_INSPECTION', 'CLOSED']) {
    const r = nla.computeNla({ role: 'ARRIVAL', state: 'FINAL', rackId: 'main' }, readyFdr(), NOW, ctxWith(viewWith(status)));
    assert.deepEqual(r, { toState: 'LANDED' }, status);
  }
});

test('a CLOSED runway inhibits too (decisions.md Q28)', () => {
  const r = nla.computeNla({ role: 'DEPARTURE', state: 'LUAW', rackId: 'rwy-23' }, readyFdr(), NOW, ctxWith(viewWith('CLOSED')));
  assert.deepEqual(r, { inhibited: 'runway 05/23 closed' });
});

test('an unresolvable runway, a runway not in the inventory, and a Facility with no field state all fail open', () => {
  const noActive = viewWith('CLOSED', { activeRunway: null });
  const fdrNoRunway = readyFdr({ filed: { departureRunway: null }, assigned: { landingRunway: null } });
  assert.deepEqual(nla.computeNla({ role: 'DEPARTURE', state: 'RUNWAY_QUEUE', rackId: 'main' }, fdrNoRunway, NOW, ctxWith(noActive)), { toState: 'LUAW' });
  const fdrOther = readyFdr({ filed: { departureRunway: '17' } });
  assert.deepEqual(nla.computeNla({ role: 'DEPARTURE', state: 'RUNWAY_QUEUE', rackId: 'main' }, fdrOther, NOW, ctxWith(noActive)), { toState: 'LUAW' });
  assert.deepEqual(nla.computeNla({ role: 'DEPARTURE', state: 'RUNWAY_QUEUE', rackId: 'rwy-05' }, readyFdr(), NOW, ctxWith(null)), { toState: 'LUAW' });
});

test('a ctx with no fieldStateFor at all behaves exactly as before (every pre-L1 caller)', () => {
  assert.deepEqual(nla.computeNla({ role: 'DEPARTURE', state: 'TAXI', rackId: 'main' }, readyFdr(), NOW, everyoneHome), { toState: 'RUNWAY_QUEUE', transferTo: 'TWR' });
  assert.deepEqual(nla.computeNla({ role: 'DEPARTURE', state: 'LUAW', rackId: 'rwy-05' }, readyFdr(), NOW, everyoneHome), { toState: 'DEPARTED' });
  assert.deepEqual(nla.computeNla({ role: 'ARRIVAL', state: 'HANDED_TO_TOWER', rackId: 'main' }, readyFdr(), NOW, everyoneHome), { toState: 'FINAL' });
});

test('OVERFLIGHT and MISSION are never inhibited by field state', () => {
  const view = viewWith('CLOSED');
  assert.deepEqual(nla.computeNla({ role: 'OVERFLIGHT', state: 'TRANSITING', rackId: 'rwy-05' }, readyFdr(), NOW, ctxWith(view)), { toState: 'DROPPED' });
  assert.deepEqual(nla.computeNla({ role: 'MISSION', state: 'TASKED', rackId: 'rwy-05' }, readyFdr(), NOW, ctxWith(view)), { toState: 'AIRBORNE' });
});

test('the inhibit follows the rack a Strip is in, at a field with two independent runways', () => {
  // Two surfaces, not two ends of one: 05/23 closed, 17/35 open. A Strip
  // queued at 17 goes; the same Strip queued at 05 does not; dragged onto 17's
  // rack it is judged against 17 (decisions.md Q27).
  const inv = {
    runways: [
      { runwayId: '05/23', ends: ['05', '23'], endHeadingsTrue: { '05': 56, '23': 236 }, rackIds: { '05': 'rwy-05', '23': 'rwy-23' }, arrestingGear: [] },
      { runwayId: '17/35', ends: ['17', '35'], endHeadingsTrue: { '17': 175, '35': 355 }, rackIds: { '17': 'rwy-17', '35': 'rwy-35' }, arrestingGear: [] },
    ],
  };
  const view = buildStatusView(inv, { activeRunway: '05', runways: [{ runwayId: '05/23', status: 'CLOSED' }, { runwayId: '17/35', status: 'OPEN' }] });
  const at = (rackId) => nla.computeNla({ role: 'DEPARTURE', state: 'RUNWAY_QUEUE', rackId }, readyFdr(), NOW, ctxWith(view));
  assert.deepEqual(at('rwy-17'), { toState: 'LUAW' });
  assert.deepEqual(at('rwy-05'), { inhibited: 'runway 05/23 closed' });
  const taxi = (targetRackId) => nla.computeNla({ role: 'DEPARTURE', state: 'TAXI', rackId: 'main' }, readyFdr(), NOW, ctxWith(view, { targetRackId }));
  assert.deepEqual(taxi('rwy-35'), { toState: 'RUNWAY_QUEUE', transferTo: 'TWR' });
  assert.deepEqual(taxi('rwy-23'), { inhibited: 'runway 05/23 closed' });
  assert.deepEqual(taxi(undefined), { inhibited: 'runway 05/23 closed' }); // filed 8A = 05
});

// ── step 5 — rule 3: the runway change and its acknowledgements ─────────────

/** A store with every Position manned and a known active end (05). */
function manned({ occupied = ['OPS', 'CD', 'GND', 'TWR', 'APP'], primaryOf = (f, p) => `c-${p}`, fieldStateOverride } = {}) {
  const r = freshStore({ fieldStateOverride, deps: { isOccupied: (f, p) => f === 'INCIRLIK' && occupied.includes(p), primaryOf } });
  r.store.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 60, missionSession: 1 });
  return r;
}
const change = (store) => store.getFieldState('INCIRLIK').runwayChange;

test('BeginRunwayChange is refused in every state but ACKNOWLEDGED', () => {
  const { store } = manned();
  const begin = () => op(store, 'TWR', 'BeginRunwayChange');
  // null — no change at all
  assert.equal(begin().ok, false);
  assert.equal(change(store), null);
  // PROPOSED, no acks
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  assert.equal(change(store).state, 'PROPOSED');
  assert.equal(begin().ok, false);
  // PROPOSED, one ack
  mustOp(store, 'APP', 'AckRunwayChange');
  assert.equal(change(store).state, 'PROPOSED');
  assert.equal(begin().ok, false);
  // ACKNOWLEDGED — the only state it goes from
  mustOp(store, 'OPS', 'AckRunwayChange');
  assert.equal(change(store).state, 'ACKNOWLEDGED');
  mustOp(store, 'TWR', 'BeginRunwayChange');
  // IN_PROGRESS
  assert.equal(change(store).state, 'IN_PROGRESS');
  assert.equal(begin().ok, false);
  // PENDING_INSPECTION
  mustOp(store, 'TWR', 'CompleteRunwayChange');
  assert.equal(change(store).state, 'PENDING_INSPECTION');
  assert.equal(begin().ok, false);
  mustOp(store, 'OPS', 'CompleteInspection', { runwayId: '05/23' });
  // REJECTED
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '05' });
  mustOp(store, 'APP', 'RejectRunwayChange', { note: 'recovery inbound' });
  assert.equal(change(store).state, 'REJECTED');
  assert.equal(begin().ok, false);
});

test('acknowledgement order is irrelevant: APP then OPS, and OPS then APP, both reach ACKNOWLEDGED', () => {
  for (const order of [['APP', 'OPS'], ['OPS', 'APP']]) {
    const { store } = manned();
    mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
    mustOp(store, order[0], 'AckRunwayChange');
    assert.equal(change(store).state, 'PROPOSED');
    mustOp(store, order[1], 'AckRunwayChange');
    assert.equal(change(store).state, 'ACKNOWLEDGED', order.join(' then '));
  }
});

test('a second ack from the same acknowledger is refused, not double-counted', () => {
  const { store } = manned();
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  mustOp(store, 'APP', 'AckRunwayChange');
  const again = op(store, 'APP', 'AckRunwayChange');
  assert.equal(again.ok, false);
  assert.match(again.detail, /already acknowledged/);
  assert.equal(change(store).state, 'PROPOSED');
});

test('an ack sent as TWR never counts as an acknowledger (the D21 guard at the store)', () => {
  const { store } = manned();
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  assert.equal(op(store, 'TWR', 'AckRunwayChange').reason, 'PERMISSION_DENIED');
  assert.deepEqual(change(store).acks, { OPS: null, APP: null });
});

test("an acknowledger set of ['OPS'] (a Facility without APP) cannot deadlock", () => {
  const inv = structuredClone(INVENTORY);
  inv.runwayChangeAcknowledgers = ['OPS'];
  const { store } = manned({ fieldStateOverride: inv });
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  mustOp(store, 'OPS', 'AckRunwayChange');
  assert.equal(change(store).state, 'ACKNOWLEDGED');
  // APP was never asked, so it cannot answer either.
  assert.equal(op(store, 'APP', 'AckRunwayChange').reason, 'VALIDATION_ERROR');
});

test('an acknowledger nobody holds is skipped and recorded, never a deadlock (decisions.md H20)', () => {
  const { store, log } = manned({ occupied: ['OPS', 'TWR'] });
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  const ch = change(store);
  assert.equal(ch.acks.APP.skipped, true);
  assert.equal(ch.acks.APP.reason, 'UNMANNED');
  assert.equal(ch.state, 'PROPOSED');
  assert.deepEqual(store.getFieldState('INCIRLIK').transitions.at(-1).skippedAcknowledgers, ['APP']);
  assert.equal(log().at(-1).after.runwayChange.acks.APP.skipped, true);
  mustOp(store, 'OPS', 'AckRunwayChange');
  assert.equal(change(store).state, 'ACKNOWLEDGED');
  // Nobody at all but tower: straight to ACKNOWLEDGED, both skips on record.
  const { store: alone } = manned({ occupied: ['TWR'] });
  mustOp(alone, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  assert.equal(change(alone).state, 'ACKNOWLEDGED');
  assert.deepEqual(Object.keys(change(alone).acks).filter(p => change(alone).acks[p].skipped), ['OPS', 'APP']);
});

test('the acknowledger set is frozen at propose time', () => {
  let occupied = ['OPS', 'TWR'];
  const r = freshStore({ deps: { isOccupied: (f, p) => occupied.includes(p) } });
  r.store.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 60, missionSession: 1 });
  mustOp(r.store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  occupied = ['OPS', 'TWR', 'APP']; // APP arrives after the proposal
  assert.match(op(r.store, 'APP', 'AckRunwayChange').detail, /skipped/);
  mustOp(r.store, 'OPS', 'AckRunwayChange');
  assert.equal(change(r.store).state, 'ACKNOWLEDGED');
  assert.deepEqual(change(r.store).acknowledgers, ['OPS', 'APP']);
});

test('RejectRunwayChange ends the change REJECTED; a new proposal may replace it', () => {
  const { store } = manned();
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  mustOp(store, 'OPS', 'AckRunwayChange');
  const fsI = mustOp(store, 'APP', 'RejectRunwayChange', { note: 'recovery inbound on 05' });
  assert.equal(fsI.runwayChange.state, 'REJECTED');
  assert.deepEqual([fsI.runwayChange.rejected.positionId, fsI.runwayChange.rejected.cause, fsI.runwayChange.rejected.note], ['APP', 'REJECTED', 'recovery inbound on 05']);
  assert.equal(fsI.runwayChangeInProgress, false);
  const oldId = fsI.runwayChange.changeId;
  const next = mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  assert.equal(next.runwayChange.state, 'PROPOSED');
  assert.notEqual(next.runwayChange.changeId, oldId);
  assert.equal(next.transitions.at(-1).replaced.changeId, oldId);
});

test('WithdrawRunwayChange lets TWR retract before Begin, recorded as WITHDRAWN — and not after', () => {
  const { store } = manned();
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  assert.equal(op(store, 'OPS', 'WithdrawRunwayChange').reason, 'PERMISSION_DENIED');
  const fsI = mustOp(store, 'TWR', 'WithdrawRunwayChange', { note: 'wind backed' });
  assert.deepEqual([fsI.runwayChange.state, fsI.runwayChange.rejected.cause], ['REJECTED', 'WITHDRAWN']);
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  mustOp(store, 'OPS', 'AckRunwayChange');
  mustOp(store, 'APP', 'AckRunwayChange');
  mustOp(store, 'TWR', 'BeginRunwayChange');
  assert.match(op(store, 'TWR', 'WithdrawRunwayChange').detail, /under way/);
  assert.match(op(store, 'APP', 'RejectRunwayChange').detail, /under way/);
});

test('a second proposal while one is open is refused; a proposal for the active end, a closed runway or an unknown end is refused', () => {
  const { store } = manned();
  assert.match(op(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '05' }).detail, /already the active runway/);
  assert.equal(op(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '17' }).reason, 'NOT_FOUND');
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  assert.match(op(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' }).detail, /already PROPOSED/);
  mustOp(store, 'TWR', 'WithdrawRunwayChange');
  mustOp(store, 'TWR', 'CloseRunway', { runwayId: '05/23' });
  assert.match(op(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' }).detail, /closed/);
});

test('CompleteRunwayChange sets the active runway, suspends the pavement for inspection, and it inhibits until inspected', () => {
  const { store } = manned();
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  mustOp(store, 'OPS', 'AckRunwayChange');
  mustOp(store, 'APP', 'AckRunwayChange');
  mustOp(store, 'TWR', 'BeginRunwayChange');
  // IN_PROGRESS changes no runway status (decisions.md Q29).
  assert.equal(rwy(store.getFieldState('INCIRLIK')).status, 'OPEN');
  const fsI = mustOp(store, 'TWR', 'CompleteRunwayChange');
  assert.equal(fsI.activeRunway, '23');
  assert.equal(fsI.activeRunwaySource.kind, 'RUNWAY_CHANGE');
  assert.equal(rwy(fsI).status, 'SUSPENDED_INSPECTION');
  assert.equal(rwy(fsI).suspension.kind, 'RUNWAY_CHANGE');
  assert.deepEqual(fsI.runwayChange.pendingInspection, ['05/23']);
  assert.equal(runwayInhibitFor(departure({ rackId: 'rwy-23' }), fdrFiled('23'), store.statusView('INCIRLIK')), 'runway 05/23 suspended — awaiting inspection');
});

test('the change record clears only when every runway in pendingInspection has been inspected', () => {
  // Two surfaces: a change from 05 to 17 has to inspect both.
  const inv = structuredClone(INVENTORY);
  inv.runways.push({ runwayId: '17/35', ends: ['17', '35'], endHeadingsTrue: { '17': 175, '35': 355 }, arrestingGear: [] });
  const { store } = manned({ fieldStateOverride: inv });
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '17' });
  mustOp(store, 'OPS', 'AckRunwayChange');
  mustOp(store, 'APP', 'AckRunwayChange');
  mustOp(store, 'TWR', 'BeginRunwayChange');
  let fsI = mustOp(store, 'TWR', 'CompleteRunwayChange');
  assert.deepEqual(fsI.runwayChange.pendingInspection.sort(), ['05/23', '17/35']);
  fsI = mustOp(store, 'OPS', 'CompleteInspection', { runwayId: '17/35' });
  assert.deepEqual(fsI.runwayChange.pendingInspection, ['05/23']);
  assert.equal(fsI.runwayChangeInProgress, true);
  fsI = mustOp(store, 'OPS', 'CompleteInspection', { runwayId: '05/23' });
  assert.equal(fsI.runwayChange, null);
  assert.equal(fsI.runwayChangeInProgress, false);
  assert.equal(fsI.transitions.at(-1).runwayChangeCompleted.toRunwayId, '17');
  assert.equal(fsI.activeRunway, '17');
});

test('CompleteRunwayChange is refused while a runway in the set is mid runway works', () => {
  const { store } = manned();
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  mustOp(store, 'OPS', 'AckRunwayChange');
  mustOp(store, 'APP', 'AckRunwayChange');
  mustOp(store, 'TWR', 'BeginRunwayChange');
  mustOp(store, 'TWR', 'BeginRunwayWorks', { runwayId: '05/23' });
  const r = op(store, 'TWR', 'CompleteRunwayChange');
  assert.match(r.detail, /runway 05\/23 is SUSPENDED_WORKS/);
  assert.equal(r.fieldState.activeRunway, '05');
  // Once the gear work is done and awaiting its inspection, the change can
  // complete, and one inspection signs off both.
  mustOp(store, 'OPS', 'CompleteRunwayWorks', { runwayId: '05/23' });
  let fsI = mustOp(store, 'TWR', 'CompleteRunwayChange');
  assert.equal(rwy(fsI).suspension.kind, 'WORKS');
  fsI = mustOp(store, 'OPS', 'CompleteInspection', { runwayId: '05/23' });
  assert.equal(rwy(fsI).status, 'OPEN');
  assert.equal(fsI.runwayChange, null);
});

test('runwayChangeInProgress is true exactly in IN_PROGRESS and PENDING_INSPECTION', () => {
  const { store } = manned();
  const inProgress = () => store.getFieldState('INCIRLIK').runwayChangeInProgress;
  assert.equal(inProgress(), false);
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  assert.equal(inProgress(), false);
  mustOp(store, 'OPS', 'AckRunwayChange');
  mustOp(store, 'APP', 'AckRunwayChange');
  assert.equal(inProgress(), false);
  mustOp(store, 'TWR', 'BeginRunwayChange');
  assert.equal(inProgress(), true);
  mustOp(store, 'TWR', 'CompleteRunwayChange');
  assert.equal(inProgress(), true);
  mustOp(store, 'OPS', 'CompleteInspection', { runwayId: '05/23' });
  assert.equal(inProgress(), false);
});

test('SelfCoordinateRunwayChange: one input from a controller Primary on TWR and every manned acknowledger (decisions.md S-Q24)', () => {
  const solo = (f, p) => 'c-solo';
  const { store } = manned({ primaryOf: solo });
  const fsI = mustOp(store, 'TWR', 'SelfCoordinateRunwayChange', { toRunwayId: '23' }, { by: 'c-solo' });
  assert.equal(fsI.runwayChange.state, 'ACKNOWLEDGED');
  assert.equal(fsI.runwayChange.selfCoordinated, true);
  for (const p of ['OPS', 'APP']) assert.deepEqual([fsI.runwayChange.acks[p].positionId, fsI.runwayChange.acks[p].selfCoordinated, fsI.runwayChange.acks[p].by], [p, true, 'c-solo']);
  assert.deepEqual(fsI.transitions.at(-1).acknowledgedAs, ['OPS', 'APP']);
  assert.equal(fsI.rev, 2); // wind + this: one input, one rev
  // Not Primary on APP: refused, naming it.
  const { store: s2 } = manned({ primaryOf: (f, p) => (p === 'APP' ? 'c-someone-else' : 'c-solo') });
  const r = op(s2, 'TWR', 'SelfCoordinateRunwayChange', { toRunwayId: '23' }, { by: 'c-solo' });
  assert.equal(r.reason, 'PERMISSION_DENIED');
  assert.match(r.detail, /Primary at APP/);
  assert.equal(r.fieldState.runwayChange, null);
});

test('the wind never moves the active runway while a change is open', () => {
  const { store } = manned();
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  const r = store.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 240, missionSession: 2 });
  assert.equal(r.changed, false);
  assert.equal(store.getFieldState('INCIRLIK').activeRunway, '05');
});

test('a reconnect in the same mission session keeps the end TWR changed to; a new session is considered again (ADR 0086)', () => {
  const { store } = manned(); // session 1's wind set 05
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  mustOp(store, 'OPS', 'AckRunwayChange');
  mustOp(store, 'APP', 'AckRunwayChange');
  mustOp(store, 'TWR', 'BeginRunwayChange');
  mustOp(store, 'TWR', 'CompleteRunwayChange');
  assert.equal(store.getFieldState('INCIRLIK').activeRunwaySource.kind, 'RUNWAY_CHANGE');
  // A gRPC reconnect or crc-sync restart onto session 1: the wind (still from 060) is not re-applied.
  const { store: reborn } = freshStore();
  reborn.restore(JSON.parse(JSON.stringify(store.snapshot())));
  const r = reborn.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 60, missionSession: 1 });
  assert.deepEqual([r.ok, r.changed, r.skipped], [true, false, true]);
  assert.equal(reborn.getFieldState('INCIRLIK').activeRunway, '23');
  // Session 2 (the same .miz restarted) is considered afresh — here held by the
  // change still pending its inspection; the H22 test above shows it re-deriving.
  assert.notEqual(reborn.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 60, missionSession: 2 }).skipped, true);
});

test('a runway change survives a restart mid-way (PROPOSED with one ack comes back PROPOSED with one ack)', () => {
  const { store } = manned();
  mustOp(store, 'TWR', 'ProposeRunwayChange', { toRunwayId: '23' });
  mustOp(store, 'APP', 'AckRunwayChange');
  const { store: reborn } = manned();
  reborn.restore(JSON.parse(JSON.stringify(store.snapshot())));
  const ch = change(reborn);
  assert.equal(ch.state, 'PROPOSED');
  assert.equal(ch.acks.APP.positionId, 'APP');
  assert.equal(ch.acks.OPS, null);
  mustOp(reborn, 'OPS', 'AckRunwayChange');
  assert.equal(change(reborn).state, 'ACKNOWLEDGED');
});
