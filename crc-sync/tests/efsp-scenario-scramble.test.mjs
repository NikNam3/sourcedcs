import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* Alert and scramble sorties (guide §9.6, docs/adr/0070).
 *
 * §9.6's MUSTs are an indication and a flag; its [GAP] forbids any priority
 * ordering. So every sortie here asserts both halves: the scramble is seen
 * (activeScrambles, conflictingGroundStrips) AND nothing about any other
 * Strip moved — orderKey, Bay, Rack and NLA are snapshotted before and
 * compared after. The indication ends because the state changed, never
 * because anything reset alertStatus.
 *
 * Its own durable board, like every scenario file; each sortie sets its
 * scramble back to NONE (or flies it out) and leaves the board clean.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-scramble-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
  CRCSYNC_EFSP_TRAFFIC_COUNT_PATH: 'traffic-count.jsonl',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const { TrafficCount } = await import('../src/efsp/traffic-count.js');
const { activeScrambles, conflictingGroundStrips, alertPadConstraint } = await import('../src/efsp/alert-scramble.js');
const { crew, mustAct, act, jumpTo, advance, DEPARTURE_FDR } = await import('./helpers/efsp-scenario.mjs');

const efsp = createEfsp();
const c = crew(efsp, { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK' });
const counter = new TrafficCount({
  mutationLog: efsp.mutationLog,
  fdrStore: efsp.fdrStore,
  boardStoreFor: efsp.boardStoreFor,
  facilityIds: facilityConfig.getFacilityIds(),
  config: { retentionDays: 400, homeAirports: { INCIRLIK: ['LTAG'] } },
});

const board = efsp.boardStoreFor('INCIRLIK');
// The Strip as the wire carries it: facilityId and nla are stamped on at the
// edge (efsp-ws.js _stampStrip), not stored on the Board.
const live = () => board.getAll().filter(s => s.state !== 'DROPPED')
  .map(s => ({ ...s, facilityId: 'INCIRLIK', nla: board.nlaStatusFor(s) }));
const fdrOf = (id) => efsp.fdrStore.getFdr(id);
const scrambles = () => activeScrambles(live(), fdrOf, 'INCIRLIK');
const flagged = () => conflictingGroundStrips(live(), fdrOf, 'INCIRLIK').map(s => s.stripId).sort();
const fresh = (s) => board.getStrip(s.stripId);
let n = 0;

/** A departure created by OPS and pressed through NLA to CLEARED (CD owns it). */
async function clearedDeparture(callsign) {
  let s = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { ...DEPARTURE_FDR, callsign, aircraftType: 'F16' },
  });
  s = await advance(efsp, c.OPS, 'OPS', s);
  assert.equal(s.state, 'PENDING_CLEARANCE');
  s = await advance(efsp, c.CD, 'CD', s);
  assert.equal(s.state, 'CLEARED');
  return s;
}

/** Ground traffic to be flagged: a departure at TAXI (GND), one at RUNWAY_QUEUE (TWR), an arrival at TAXI_IN. */
function groundTraffic() {
  const dep = (state) => {
    let s = mustAct(efsp, c.OPS, 'OPS', null, {
      kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
      fdr: { ...DEPARTURE_FDR, callsign: `HAWK${++n}` },
    });
    s = jumpTo(efsp, c.OPS, 'OPS', s, state);
    return state === 'TAXI'
      ? mustAct(efsp, c.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: 'GND', bayId: 'gnd-taxi-out', rackId: 'main' })
      : mustAct(efsp, c.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: 'TWR', bayId: 'twr-runway-queue', rackId: 'rwy-05' });
  };
  const taxi = dep('TAXI');
  const queue = dep('RUNWAY_QUEUE');
  let arr = mustAct(efsp, c.APP, 'APP', null, {
    kind: 'CreateStrip', bayId: 'app-inbound', rackId: 'main', role: 'ARRIVAL',
    fdr: { callsign: `TANKER${++n}`, aircraftType: 'KC135', wakeCategory: 'H', originAirport: 'LTAG' },
  });
  arr = jumpTo(efsp, c.APP, 'APP', arr, 'HANDED_TO_TOWER');
  arr = mustAct(efsp, c.APP, 'APP', arr, { kind: 'TransferStrip', toPositionId: 'TWR', bayId: 'twr-arrivals', rackId: 'main' });
  arr = jumpTo(efsp, c.TWR, 'TWR', arr, 'TAXI_IN');
  return { taxi, queue, arr };
}

const placement = () => Object.fromEntries(live().map(s => [s.stripId, { orderKey: s.orderKey, bayId: s.bayId, rackId: s.rackId, ownerPositionId: s.ownerPositionId, nla: s.nla }]));

function setAlert(who, s, value) {
  return mustAct(efsp, c[who], who, fresh(s), { kind: 'SetBlock', blockId: '14E', value });
}

/** Flies every live Strip at INCIRLIK out and drops it, so the next sortie starts clean. */
async function clearBoard() {
  for (let s of live().map(fresh)) {
    for (let i = 0; i < 14 && s.state !== 'DROPPED'; i++) {
      const owner = s.ownerPositionId;
      const ack = act(efsp, c[owner], owner, s, { kind: 'DropStrip' });
      if (ack.ok) { s = ack.strip; break; }
      s = await advance(efsp, c[owner], owner, fresh(s));
    }
  }
  assert.deepEqual(live(), []);
}

test('sortie: an alert pair scrambles past taxiing traffic — flagged, never reordered or held', async () => {
  const viper = await clearedDeparture('VIPER11');
  setAlert('CD', viper, 'ALERT');
  const { taxi, queue, arr } = groundTraffic();

  assert.deepEqual(scrambles(), [], 'ALERT is not a scramble');
  assert.deepEqual(flagged(), []);

  const before = placement();
  delete before[viper.stripId]; // its own rev/orderKey is untouched too, but its nla is re-stamped with the new rev
  setAlert('CD', viper, 'SCRAMBLE');

  assert.deepEqual(scrambles().map(s => [s.callsign, s.state]), [['VIPER11', 'CLEARED']]);
  assert.deepEqual(flagged(), [taxi.stripId, queue.stripId, arr.stripId].sort());
  const constraint = alertPadConstraint(efsp.fieldStateStore.getFieldState('INCIRLIK'), scrambles());
  assert.deepEqual(constraint, {
    route: 'ALERT ACCESS TAXIWAY',
    text: 'ACCESS ROUTE ALERT ACCESS TAXIWAY CONSTRAINED — scramble in progress (VIPER11)',
  });

  // The [GAP]: nothing else moved, reordered, changed hands or got an inhibit.
  const after = placement();
  for (const [id, was] of Object.entries(before)) assert.deepEqual(after[id], was, id);
  assert.equal(fresh(viper).orderKey, viper.orderKey);
  assert.equal(fresh(viper).bayId, viper.bayId);

  // The others carry on normally — a flag refuses nothing.
  const taxiNext = await advance(efsp, c.GND, 'GND', fresh(taxi));
  assert.equal(taxiNext.state, 'RUNWAY_QUEUE');
  assert.ok(flagged().includes(taxi.stripId), 'still on the movement area, still flagged');

  // VIPER11 flies. Pre-airborne it stays active; DEPARTED ends it.
  let v = fresh(viper);
  for (let i = 0; i < 8 && v.state !== 'DEPARTED'; i++) {
    const owner = v.ownerPositionId;
    v = await advance(efsp, c[owner], owner, v);
    if (v.state !== 'DEPARTED') assert.equal(scrambles().length, 1, `still active at ${v.state}`);
  }
  assert.equal(v.state, 'DEPARTED');
  assert.deepEqual(scrambles(), []);
  assert.deepEqual(flagged(), []);
  assert.equal(efsp.fdrStore.getFdr(v.fdrId).military.alertStatus, 'SCRAMBLE', 'nothing resets the field (T5)');

  // Both writes are logged Strip Mutations (decisions.md S-L5): the audit and
  // L5's latch see them. The log names the op kind, not the Block or value
  // ... except that the entry now names both (docs/adr/0083).
  const sets = efsp.mutationLog.readAll()
    .filter(e => e.stripId === viper.stripId && e.ok !== false && e.op === 'SetBlock');
  assert.equal(sets.length, 2, 'SetBlock 14E ALERT and SetBlock 14E SCRAMBLE');
  assert.deepEqual(sets.map(e => [e.blockId, e.value]), [['14E', 'ALERT'], ['14E', 'SCRAMBLE']]);
  assert.ok(sets.every(e => e.actingPositionId === 'CD'));

  // Traffic count: dropped after departure, it counts as an alert scramble.
  v = await advance(efsp, c.TWR, 'TWR', v); // DEPARTED -> HANDED_OFF, to APP
  mustAct(efsp, c.APP, 'APP', fresh(v), { kind: 'DropStrip' });
  const rec = counter.records().filter(r => r.stripId === viper.stripId);
  assert.equal(rec.length, 1);
  assert.equal(rec[0].alertScramble, true);

  await clearBoard();
});

test('sortie: the scramble is cancelled on the ground', async () => {
  const viper = await clearedDeparture('VIPER21');
  const { taxi } = groundTraffic();
  setAlert('CD', viper, 'SCRAMBLE');
  assert.equal(scrambles().length, 1);
  assert.ok(flagged().includes(taxi.stripId));

  // "Scramble cancelled, return to alert."
  setAlert('CD', viper, 'ALERT');
  assert.deepEqual(scrambles(), []);
  assert.deepEqual(flagged(), []);
  setAlert('CD', viper, 'NONE');
  assert.equal(fdrOf(viper.fdrId).military.alertStatus, 'NONE');
  await clearBoard();
});

test('sortie: two scramblers at once — both listed, each ground Strip flagged once', async () => {
  const a = await clearedDeparture('VIPER31');
  const b = await clearedDeparture('VIPER32');
  const { taxi, queue, arr } = groundTraffic();
  setAlert('CD', a, 'SCRAMBLE');
  setAlert('CD', b, 'SCRAMBLE');
  assert.deepEqual(scrambles().map(s => s.callsign), ['VIPER31', 'VIPER32']);
  assert.deepEqual(flagged(), [taxi.stripId, queue.stripId, arr.stripId].sort());
  setAlert('CD', a, 'NONE');
  setAlert('CD', b, 'NONE');
  await clearBoard();
});

test('sortie: a scramble called off after departure was flown, and the drop counts it (S-L13)', async () => {
  const s0 = await clearedDeparture('VIPER52');
  setAlert('CD', s0, 'SCRAMBLE');
  let v = fresh(s0);
  for (let i = 0; i < 8 && v.state !== 'DEPARTED'; i++) {
    const owner = v.ownerPositionId;
    v = await advance(efsp, c[owner], owner, v);
  }
  assert.equal(v.state, 'DEPARTED');
  setAlert('OPS', v, 'ALERT');
  v = await advance(efsp, c.TWR, 'TWR', fresh(v));
  mustAct(efsp, c.APP, 'APP', fresh(v), { kind: 'DropStrip' });
  const rec = counter.records().filter(r => r.stripId === s0.stripId);
  assert.equal(rec.length, 1);
  assert.equal(rec[0].alertScramble, true);
  await clearBoard();
});

test('OPS owns 14E on a departure at every state, whoever holds the Strip (H56, S-L13)', async () => {
  let s = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { ...DEPARTURE_FDR, callsign: 'COLT41' },
  });
  s = setAlert('OPS', s, 'ALERT');
  assert.equal(fdrOf(s.fdrId).military.alertStatus, 'ALERT');
  s = await advance(efsp, c.OPS, 'OPS', s);
  // CD holds it now, and OPS still sets the alert status.
  const scrambled = act(efsp, c.OPS, 'OPS', fresh(s), { kind: 'SetBlock', blockId: '14E', value: 'SCRAMBLE' });
  assert.equal(scrambled.ok, true, JSON.stringify(scrambled));
  assert.equal(fdrOf(s.fdrId).military.alertStatus, 'SCRAMBLE');
  // Any other Block is still the owner's: the exception is 14E only.
  const other = act(efsp, c.OPS, 'OPS', fresh(s), { kind: 'SetBlock', blockId: '8A', value: 'X' });
  assert.equal(other.reason, 'NOT_OWNER');
  assert.match(other.detail, /CD holds this Strip/);
  // The exception is for OPS: CD's own write, and no other Position's.
  const bad = act(efsp, c.CD, 'CD', fresh(s), { kind: 'SetBlock', blockId: '14E', value: 'LAUNCH' });
  assert.equal(bad.ok, false, 'setMilitary validates the enum');
  setAlert('CD', s, 'NONE');
  await clearBoard();
});

test('sortie: a scramble cancelled on the ground is the Strip\'s ordinary operation (S-L13, ADR 0083)', async () => {
  // SCRAMBLE set, then set back while the Strip is still pre-airborne: it
  // never flew, so the drop is not an alert scramble. The log entry names the
  // Block and value, which is how the latch is cleared.
  const s = await clearedDeparture('VIPER51');
  setAlert('CD', s, 'SCRAMBLE');
  setAlert('CD', s, 'NONE');
  mustAct(efsp, c.CD, 'CD', fresh(s), { kind: 'DropStrip' });
  const rec = counter.records().filter(r => r.stripId === s.stripId);
  assert.equal(rec.length, 1);
  assert.equal(rec[0].alertScramble, false);
  await clearBoard();
});
