import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* docs/adr/0126 (H149, H150 TWR-Q1 a): no RSU; the tower (LC) works the visual pattern on its ordinary Strips. The cells
 * PAT/STR (Block 9J-ENTRY) and T&G/FS/LA (Block 9J-OPTION) steer LC's NLA; TRAFFIC_PATTERN is the IN PATTERN state and
 * LC's Pattern Bay (`lc-pattern`); JoinPattern / LeavePattern change the strip type in place at the ¶3-8-2 boundary.
 *
 * Walked the way pilots disturb it: a pilot who SWITCHES (straight-in to the pattern, touch-and-go to full stop, a full
 * stop that goes round again), CANCELS (leaves the pattern to depart; a closed runway), and a local departure that never
 * goes to AP (stays in closed traffic).
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-twr-pattern-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER: 'carrier.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { createEfsp } = await import('../src/efsp/index.js');
const { freshEfsp, act, mustAct, advance, jumpTo, DEPARTURE_FLIGHT_DATA } = await import('./helpers/efsp-scenario.mjs');

const STAFFED = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK' };
const board = (efsp) => efsp.boardStoreFor('INCIRLIK');
const strip = (efsp, s) => board(efsp).getStrip(s.stripId);
const fd = (efsp, s) => efsp.flightDataStore.getFlightData(s.flightDataId);
const fresh = () => freshEfsp(createEfsp, STAFFED);
const mutations = () => fs.readFileSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l));
let n = 0;

const entry = (value) => ({ kind: 'SetBlock', blockId: '9J-ENTRY', value });
const option = (value) => ({ kind: 'SetBlock', blockId: '9J-OPTION', value });

function refused(ack, reason, detail, label = '') {
  assert.equal(ack.ok, false, `${label} should be refused: ${JSON.stringify(ack)}`);
  if (reason) assert.equal(ack.reason, reason, `${label}: ${JSON.stringify(ack)}`);
  if (detail) assert.match(ack.detail || '', detail, label);
}

/** An ARRIVAL with AP; `cells` are set by AP before the transfer (whoever holds the Strip sets them). */
function arrival(efsp, c, cells = {}) {
  let s = mustAct(efsp, c.AP, 'AP', null, {
    kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: `PAT${++n}`, aircraftType: 'T38', wakeCategory: 'L', originAirport: 'LTAG' },
  });
  s = mustAct(efsp, c.AP, 'AP', s, { kind: 'SetBlock', blockId: '8B', value: '23' }); // the landing runway, which the runway gate reads
  if (cells.entry) s = mustAct(efsp, c.AP, 'AP', s, entry(cells.entry));
  if (cells.option) s = mustAct(efsp, c.AP, 'AP', s, option(cells.option));
  return s;
}

const toTower = async (efsp, c, s) => advance(efsp, c.AP, 'AP', strip(efsp, s)); // INBOUND -> HANDED_TO_TOWER, to LC

/** A local DEPARTURE pressed through to LC and jumped to DEPARTED (in the air). */
async function localDeparture(efsp, c) {
  let s = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: `LCL${++n}` },
  });
  s = await advance(efsp, c.OPS, 'OPS', s);
  s = jumpTo(efsp, c.CD, 'CD', s, 'CLEARED');
  s = await advance(efsp, c.CD, 'CD', s);
  s = jumpTo(efsp, c.GC, 'GC', s, 'TAXI');
  s = await advance(efsp, c.GC, 'GC', s);
  return jumpTo(efsp, c.LC, 'LC', s, 'DEPARTED');
}

// ── the cells ───────────────────────────────────────────────────────────────

test('the cells are flight data enums: AP sets them before the transfer, LC after; anyone else, or a value outside the list, is refused', async () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c, { entry: 'PATTERN', option: 'TOUCH_AND_GO' });
  assert.deepEqual([fd(efsp, s).assigned.patternEntry, fd(efsp, s).assigned.patternOption], ['PATTERN', 'TOUCH_AND_GO']);
  refused(act(efsp, c.LC, 'LC', strip(efsp, s), option('FULL_STOP')), 'NOT_OWNER', null, 'LC before the transfer');
  await toTower(efsp, c, s);
  refused(act(efsp, c.AP, 'AP', strip(efsp, s), option('FULL_STOP')), 'NOT_OWNER', null, 'AP after the transfer');
  mustAct(efsp, c.LC, 'LC', strip(efsp, s), option('FULL_STOP'));
  assert.equal(fd(efsp, s).assigned.patternOption, 'FULL_STOP');
  refused(act(efsp, c.LC, 'LC', strip(efsp, s), option('STOP_AND_GO')), 'VALIDATION_ERROR', /T&G\/FS\/LA must be one of/, 'no stop-and-go (H147 RQ7)');
  refused(act(efsp, c.LC, 'LC', strip(efsp, s), entry('OVERHEAD')), 'VALIDATION_ERROR', /PAT\/STR must be one of/);
  mustAct(efsp, c.LC, 'LC', strip(efsp, s), entry(''));
  assert.equal(fd(efsp, s).assigned.patternEntry, null, 'an empty value clears the cell');
  const log = mutations().filter(m => m.op === 'SetBlock' && m.blockId === '9J-OPTION');
  assert.ok(log.length >= 2, 'every cell write is audited');
});

test('a new flight has neither cell set, and both cells sit on DEPARTURE and ARRIVAL only', async () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c);
  assert.deepEqual([fd(efsp, s).assigned.patternEntry, fd(efsp, s).assigned.patternOption], [null, null]);
  const blockMap = await import('../src/efsp/block-map.js');
  for (const t of ['DEPARTURE', 'ARRIVAL']) {
    assert.deepEqual(blockMap.resolveBlockTarget(t, '9J-ENTRY'), { kind: 'flightData', path: 'assigned.patternEntry' }, t);
    assert.deepEqual(blockMap.resolveBlockTarget(t, '9J-OPTION'), { kind: 'flightData', path: 'assigned.patternOption' }, t);
  }
  for (const t of ['OVERFLIGHT', 'MISSION', 'MARSHAL', 'FINAL', 'PATTERN']) assert.equal(blockMap.resolveBlockTarget(t, '9J-ENTRY'), null, t);
});

// ── the arrival in the pattern ─────────────────────────────────────────────

test('PAT + T&G: LC takes the arrival into the Pattern Bay, final, touch-and-go back into closed traffic, then a full stop goes to GC', async () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c, { entry: 'PATTERN', option: 'TOUCH_AND_GO' });
  await toTower(efsp, c, s);
  assert.equal(board(efsp).nlaStatusFor(strip(efsp, s)).toState, 'TRAFFIC_PATTERN', 'PAT: the NLA is the pattern');
  let t = await advance(efsp, c.LC, 'LC', strip(efsp, s));
  assert.deepEqual([t.stripType, t.state, t.bayId, t.ownerPositionId], ['ARRIVAL', 'TRAFFIC_PATTERN', 'lc-pattern', 'LC']);
  t = await advance(efsp, c.LC, 'LC', t);
  assert.deepEqual([t.state, t.bayId], ['FINAL', 'lc-final']);
  t = await advance(efsp, c.LC, 'LC', t);
  assert.deepEqual([t.state, t.bayId], ['TRAFFIC_PATTERN', 'lc-pattern'], 'touch-and-go: back in closed traffic (¶3-8-2, ¶3-10-11)');
  t = await advance(efsp, c.LC, 'LC', t);
  assert.equal(t.state, 'FINAL');
  t = mustAct(efsp, c.LC, 'LC', t, option('LOW_APPROACH'));
  t = await advance(efsp, c.LC, 'LC', t);
  assert.equal(t.state, 'TRAFFIC_PATTERN', 'low approach: also stays');
  t = mustAct(efsp, c.LC, 'LC', t, option('FULL_STOP'));
  t = await advance(efsp, c.LC, 'LC', t);
  t = await advance(efsp, c.LC, 'LC', t);
  assert.equal(t.state, 'LANDED', 'full stop');
  t = await advance(efsp, c.LC, 'LC', t);
  assert.deepEqual([t.state, t.ownerPositionId, t.bayId], ['TAXI_IN', 'GC', 'gc-taxi-in'], 'the ordinary taxi-in flow to GC');
});

test('STR (or nothing set) is the straight-in final as before; the pilot SWITCHES to the pattern by a drag into the Pattern Bay or a cell change', async () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c, { entry: 'STRAIGHT_IN', option: 'FULL_STOP' });
  await toTower(efsp, c, s);
  assert.equal(board(efsp).nlaStatusFor(strip(efsp, s)).toState, 'FINAL');
  const dragged = mustAct(efsp, c.LC, 'LC', strip(efsp, s), { kind: 'MoveStrip', bayId: 'lc-pattern', rackId: 'main' });
  assert.equal(dragged.state, 'TRAFFIC_PATTERN', 'the drag into the Pattern Bay is legal (alsoLegal)');
  const u = arrival(efsp, c);
  await toTower(efsp, c, u);
  mustAct(efsp, c.LC, 'LC', strip(efsp, u), entry('PATTERN'));
  assert.equal(board(efsp).nlaStatusFor(strip(efsp, u)).toState, 'TRAFFIC_PATTERN', 'the cell steers the NLA');
});

test('a full stop that goes round again (the pilot SWITCHES on final): a drag back into the Pattern Bay is legal, so is the landing after a T&G call', async () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c, { entry: 'STRAIGHT_IN', option: 'FULL_STOP' });
  await toTower(efsp, c, s);
  let t = await advance(efsp, c.LC, 'LC', strip(efsp, s));
  assert.equal(t.state, 'FINAL');
  t = mustAct(efsp, c.LC, 'LC', t, { kind: 'MoveStrip', bayId: 'lc-pattern', rackId: 'main' });
  assert.equal(t.state, 'TRAFFIC_PATTERN');
  t = mustAct(efsp, c.LC, 'LC', t, option('TOUCH_AND_GO'));
  t = await advance(efsp, c.LC, 'LC', t);
  t = mustAct(efsp, c.LC, 'LC', t, { kind: 'MoveStrip', bayId: 'lc-landed', rackId: 'main' });
  assert.equal(t.state, 'LANDED', 'it landed anyway: an observation, legal by drag');
});

test('only LC works the pattern state: GC and AP may not move a Strip there', async () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c, { entry: 'PATTERN' });
  refused(act(efsp, c.AP, 'AP', strip(efsp, s), { kind: 'MoveStrip', bayId: 'lc-pattern', rackId: 'main' }), null, null, 'AP into LC\'s Bay');
  await toTower(efsp, c, s);
  refused(act(efsp, c.GC, 'GC', strip(efsp, s), { kind: 'InvokeNla' }), 'NOT_OWNER', null, 'GC');
});

// ── the runway ─────────────────────────────────────────────────────────────

function runwayOp(efsp, c, kind) {
  const current = efsp.runwayStatusStore.getRunwayStatus('INCIRLIK');
  return efsp.handleMessage(c.LC.session, {
    version: 1, type: 'efsp-runway-status-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'INCIRLIK', baseRev: current.rev, actingPositionId: 'LC', op: { kind, runwayId: '05/23' },
  }).ack;
}

test('a closed runway (the pilot CANCELS nothing, the tower does): entering the pattern goes on, the final waits, a touch-and-go already flown is recorded', async () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c, { entry: 'PATTERN', option: 'TOUCH_AND_GO' });
  await toTower(efsp, c, s);
  const onFinal = arrival(efsp, c, { option: 'TOUCH_AND_GO' });
  await toTower(efsp, c, onFinal);
  await advance(efsp, c.LC, 'LC', strip(efsp, onFinal));
  assert.equal(runwayOp(efsp, c, 'CloseRunway').ok, true);
  try {
    const t = await advance(efsp, c.LC, 'LC', strip(efsp, s));
    assert.equal(t.state, 'TRAFFIC_PATTERN', 'joining the pattern is not a landing');
    assert.match(board(efsp).nlaStatusFor(t).inhibited, /closed/, 'no final onto a closed runway');
    const straight = arrival(efsp, c);
    await toTower(efsp, c, straight);
    assert.match(board(efsp).nlaStatusFor(strip(efsp, straight)).inhibited, /closed/, 'a straight-in waits as before');
    const back = await advance(efsp, c.LC, 'LC', strip(efsp, onFinal));
    assert.equal(back.state, 'TRAFFIC_PATTERN', 'what already happened on final is never refused');
  } finally {
    assert.equal(runwayOp(efsp, c, 'OpenRunway').ok, true);
  }
});

// ── local departure into closed traffic, and leaving the pattern ──────────

test('a local departure stays in closed traffic with LC, never going to AP: JoinPattern makes it an ARRIVAL in the Pattern Bay in place', async () => {
  const { efsp, c } = fresh();
  const d = await localDeparture(efsp, c);
  const code = fd(efsp, d).identity.beaconAssigned;
  refused(act(efsp, c.AP, 'AP', strip(efsp, d), { kind: 'JoinPattern' }), null, null, 'AP holds no JoinPattern');
  mustAct(efsp, c.LC, 'LC', strip(efsp, d), option('TOUCH_AND_GO'));
  const t = mustAct(efsp, c.LC, 'LC', strip(efsp, d), { kind: 'JoinPattern' });
  assert.deepEqual([t.stripId, t.flightDataId, t.stripType, t.state, t.bayId, t.ownerPositionId],
    [d.stripId, d.flightDataId, 'ARRIVAL', 'TRAFFIC_PATTERN', 'lc-pattern', 'LC']);
  assert.equal(fd(efsp, d).identity.beaconAssigned, code, 'same code');
  assert.equal(fd(efsp, d).filed.originAirport, 'LTAG', 'ARRIVAL Block 8 reads where it took off');
  assert.equal(fd(efsp, d).assigned.patternOption, 'TOUCH_AND_GO', 'the cells live on the flight data');
  assert.equal(t.previousLeg.stripType, 'DEPARTURE');
  refused(act(efsp, c.LC, 'LC', t, { kind: 'JoinPattern' }), 'VALIDATION_ERROR', /needs a DEPARTURE Strip at DEPARTED/, 'twice');
  const f = await advance(efsp, c.LC, 'LC', t);
  assert.equal(f.state, 'FINAL');
  assert.equal((await advance(efsp, c.LC, 'LC', f)).state, 'TRAFFIC_PATTERN');
});

test('JoinPattern only from DEPARTED: on the runway or once handed to AP it is refused', async () => {
  const { efsp, c } = fresh();
  const d = await localDeparture(efsp, c);
  const q = jumpTo(efsp, c.LC, 'LC', strip(efsp, d), 'DROPPED');
  assert.equal(q.state, 'DROPPED');
  const e = await localDeparture(efsp, c);
  const handed = await advance(efsp, c.LC, 'LC', strip(efsp, e));
  assert.equal(handed.ownerPositionId, 'AP');
  refused(act(efsp, c.AP, 'AP', handed, { kind: 'JoinPattern' }), null, null, 'at HANDED_OFF');
});

test('leaving the pattern to depart (the pilot CANCELS pattern work): LeavePattern makes it a DEPARTURE at DEPARTED, then the ordinary flow to AP', async () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c, { entry: 'PATTERN', option: 'TOUCH_AND_GO' });
  await toTower(efsp, c, s);
  const t = await advance(efsp, c.LC, 'LC', strip(efsp, s));
  assert.equal(t.state, 'TRAFFIC_PATTERN');
  const d = mustAct(efsp, c.LC, 'LC', t, { kind: 'LeavePattern' });
  assert.deepEqual([d.stripId, d.stripType, d.state, d.bayId, d.ownerPositionId], [s.stripId, 'DEPARTURE', 'DEPARTED', 'lc-airborne', 'LC']);
  assert.equal(fd(efsp, s).filed.departureAirport, 'LTAG', 'it departs the field whose pattern it was in');
  const ap = await advance(efsp, c.LC, 'LC', d);
  assert.deepEqual([ap.state, ap.ownerPositionId], ['HANDED_OFF', 'AP'], 'Hand Off to AP, the ordinary departure flow');
});

test('leaving from the final after the option, and a VFR flight that leaves the area is simply dropped by LC', async () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c, { option: 'LOW_APPROACH' });
  await toTower(efsp, c, s);
  const f = await advance(efsp, c.LC, 'LC', strip(efsp, s));
  assert.equal(f.state, 'FINAL');
  const d = mustAct(efsp, c.LC, 'LC', f, { kind: 'LeavePattern' });
  assert.equal(d.state, 'DEPARTED');
  const gone = mustAct(efsp, c.LC, 'LC', d, { kind: 'DropStrip' });
  assert.equal(gone.state, 'DROPPED');
});

test('LeavePattern is refused off the pattern (landed, still with AP) and by anyone but LC', async () => {
  const { efsp, c } = fresh();
  const s = arrival(efsp, c, { option: 'FULL_STOP' });
  refused(act(efsp, c.AP, 'AP', strip(efsp, s), { kind: 'LeavePattern' }), null, null, 'AP');
  await toTower(efsp, c, s);
  refused(act(efsp, c.LC, 'LC', strip(efsp, s), { kind: 'LeavePattern' }), 'VALIDATION_ERROR', /TRAFFIC_PATTERN or FINAL/, 'HANDED_TO_TOWER');
  await advance(efsp, c.LC, 'LC', strip(efsp, s));
  const l = await advance(efsp, c.LC, 'LC', strip(efsp, s));
  assert.equal(l.state, 'LANDED');
  refused(act(efsp, c.LC, 'LC', l, { kind: 'LeavePattern' }), 'VALIDATION_ERROR', null, 'LANDED');
});

test('Undo of JoinPattern puts the departure back as it was', async () => {
  const { efsp, c } = fresh();
  const d = await localDeparture(efsp, c);
  const ack = act(efsp, c.LC, 'LC', strip(efsp, d), { kind: 'JoinPattern' });
  assert.equal(ack.ok, true);
  assert.ok(ack.undoable && ack.undoable.actionId, 'JoinPattern is undoable');
  const undone = act(efsp, c.LC, 'LC', strip(efsp, d), { kind: 'Undo', actionId: ack.undoable.actionId });
  assert.equal(undone.ok, true, JSON.stringify(undone));
  const back = strip(efsp, d);
  assert.deepEqual([back.stripType, back.state], ['DEPARTURE', 'DEPARTED']);
});
