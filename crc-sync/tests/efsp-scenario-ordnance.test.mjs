import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* Hung ordnance sorties (guide §9.5, docs/adr/0069).
 *
 * §9.5's one MUST — "HUNG MUST propagate to runway status" — is read as an
 * advisory on runway assignment plus a routing constraint toward the hot cargo
 * pad (WP6 plan Phase 4; decisions.md H21). These walk it on a real Board: the
 * pilot reports the hung store, whoever is talking to them records it (H55),
 * the advisory names the pad, and the flight lands exactly as a clean one does.
 *
 * Its own durable board, like every scenario file (ADR 0002), so every test
 * puts the ordnance back to CLEAN and the field back as it found it.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-ordnance-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { createEfsp } = await import('../src/efsp/index.js');
const { hungOrdnanceAdvisoryFor } = await import('../src/efsp/runway-status.js');
const { crew, act, mustAct, jumpTo, advance, DEPARTURE_FLIGHT_DATA } = await import('./helpers/efsp-scenario.mjs');

const efsp = createEfsp();
const c = crew(efsp, {
  OPS: 'INCIRLIK', CD: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER', TAC_C2: 'TACTICAL',
});

const fresh = (s) => efsp.boardStoreFor(s.facilityId || 'INCIRLIK').getStrip(s.stripId);
const flightDataOf = (s) => efsp.flightDataStore.getFlightData(s.flightDataId);
const runwayStatus = () => efsp.runwayStatusStore.getRunwayStatus('INCIRLIK');
const advisory = (s) => hungOrdnanceAdvisoryFor(fresh(s), flightDataOf(s), runwayStatus());
const mutations = () => fs.readFileSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l));

function runwayStatusAct(member, positionId, op) {
  return efsp.handleMessage(member.session, {
    version: 1, type: 'efsp-runway-status-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'INCIRLIK', baseRev: runwayStatus().rev, actingPositionId: positionId, op,
  }).ack;
}
function mustRunwayStatusAct(member, positionId, op) {
  const ack = runwayStatusAct(member, positionId, op);
  assert.equal(ack.ok, true, `${op.kind} as ${positionId}: ${JSON.stringify({ reason: ack.reason, detail: ack.detail })}`);
  return ack.runwayStatus;
}

let n = 0;
/** CTR hands an ARRIVAL to AP, which accepts it — the flight as it really comes in. */
function inboundFromCenter() {
  const enroute = mustAct(efsp, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: `HUNG${++n}`, aircraftType: 'F16', wakeCategory: 'M', originAirport: 'LTAG' },
  });
  const handed = mustAct(efsp, c.CTR, 'CTR', enroute, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' });
  return mustAct(efsp, c.AP, 'AP', efsp.boardStoreFor('INCIRLIK').getStrip(handed.coordination.peerStripId), { kind: 'HANDOFF', action: 'ACCEPT' });
}

/** A DEPARTURE queued in a runway rack, owned by LC. */
function queued(rackId) {
  let s = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE',
    flightData: { ...DEPARTURE_FLIGHT_DATA, callsign: `QUE${++n}`, departureRunway: rackId === 'rwy-23' ? '23' : '05' },
  });
  s = jumpTo(efsp, c.OPS, 'OPS', s, 'RUNWAY_QUEUE');
  return mustAct(efsp, c.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: 'LC', bayId: 'lc-runway-queue', rackId });
}

test('sortie: an arrival reports hung ordnance, is advised toward the hot cargo pad, and lands unhindered', async () => {
  let s = inboundFromCenter();
  assert.equal(advisory(s), null, 'a CLEAN flight has nothing to say (docs/adr/0058)');

  s = await advance(efsp, c.AP, 'AP', s);
  assert.equal(s.state, 'HANDED_TO_TOWER');
  assert.equal(s.ownerPositionId, 'LC');
  s = mustAct(efsp, c.LC, 'LC', s, { kind: 'SetBlock', blockId: '8B', value: '05' });
  s = mustAct(efsp, c.LC, 'LC', s, { kind: 'SetBlock', blockId: '3G', value: 'HUNG' });
  assert.equal(flightDataOf(s).military.ordnanceState, 'HUNG');
  // The write is audited. The entry carries the Strip before/after but not the flight data value it
  // changed — an audit gap for L26 (docs/wip/L12.md "Findings"), so it is found by op and rev.
  const logged = mutations().filter(m => m.stripId === s.stripId && m.op === 'SetBlock' && m.actingPositionId === 'LC');
  assert.ok(logged.some(m => m.after && m.after.rev === s.rev), 'the 3G write is in the Mutation log');

  const a = advisory(s);
  assert.equal(a.text, 'HUNG');
  assert.equal(a.padName, 'Hot cargo pad');
  assert.equal(a.runway, '05/23');
  assert.equal(a.end, '05');
  assert.equal(a.runwaySource, 'FLIGHT_DATA');
  assert.match(a.reason, /taxi to Hot cargo pad/);

  // Exactly the chain a CLEAN arrival walks — the advisory inhibits nothing.
  for (const expected of ['FINAL', 'LANDED', 'TAXI_IN']) {
    assert.equal(efsp.boardStoreFor('INCIRLIK').nlaStatusFor(fresh(s)).inhibited, undefined, `${expected}: no inhibit`);
    s = await advance(efsp, c[fresh(s).ownerPositionId], fresh(s).ownerPositionId, fresh(s));
    assert.equal(s.state, expected);
    assert.ok(advisory(s), `the advisory stays up at ${expected}`);
  }
  assert.equal(s.ownerPositionId, 'GC');

  // At the pad, the store is safed: CLEAN clears it.
  s = mustAct(efsp, c.GC, 'GC', fresh(s), { kind: 'SetBlock', blockId: '3G', value: 'CLEAN' });
  assert.equal(advisory(s), null);
});

test('sortie: hung ordnance does not change the runway queue', () => {
  const first = queued('rwy-05');
  const second = queued('rwy-05');
  const before = [fresh(first), fresh(second)].map(x => ({ rackId: x.rackId, orderKey: x.orderKey, bayId: x.bayId, owner: x.ownerPositionId }));
  mustAct(efsp, c.LC, 'LC', fresh(second), { kind: 'SetBlock', blockId: '3G', value: 'HUNG' });
  const after = [fresh(first), fresh(second)].map(x => ({ rackId: x.rackId, orderKey: x.orderKey, bayId: x.bayId, owner: x.ownerPositionId }));
  assert.deepEqual(after, before, 'no reordering, no auto-move (§10.3)');
  assert.ok(advisory(second), 'a departure that may return with it carries the advisory (Q1)');
  assert.match(advisory(second).reason, /if it returns/);
  assert.equal(advisory(second).runwaySource, 'RACK');
  mustAct(efsp, c.LC, 'LC', fresh(second), { kind: 'SetBlock', blockId: '3G', value: 'CLEAN' });
  for (const s of [first, second]) mustAct(efsp, c.LC, 'LC', fresh(s), { kind: 'SetState', toState: 'DROPPED' });
});

test('sortie: a runway change re-states the runway and does not re-point the pad', () => {
  efsp.runwayStatusStore.setActiveRunwayFromWind('INCIRLIK', { windFromTrue: 60, windKt: 8, missionSession: 1 });
  assert.equal(runwayStatus().activeRunway, '05');
  let s = inboundFromCenter();
  s = mustAct(efsp, c.AP, 'AP', s, { kind: 'SetBlock', blockId: '3G', value: 'HUNG' });
  assert.equal(advisory(s).end, '05');
  assert.equal(advisory(s).runwaySource, 'ACTIVE_RUNWAY');

  mustRunwayStatusAct(c.LC, 'LC', { kind: 'ProposeRunwayChange', toRunwayId: '23' });
  mustRunwayStatusAct(c.OPS, 'OPS', { kind: 'AckRunwayChange' });
  mustRunwayStatusAct(c.AP, 'AP', { kind: 'AckRunwayChange' });
  mustRunwayStatusAct(c.LC, 'LC', { kind: 'BeginRunwayChange' });
  mustRunwayStatusAct(c.LC, 'LC', { kind: 'CompleteRunwayChange' });
  mustRunwayStatusAct(c.OPS, 'OPS', { kind: 'CompleteInspection', runwayId: '05/23' });

  const a = advisory(s);
  assert.equal(a.end, '23', 'the runway it states follows the field');
  assert.equal(a.padName, 'Hot cargo pad', 'the pad is a place, not a direction (H21)');
  assert.doesNotMatch(a.reason, /\b(prefer|recommend|closer|nearer|use runway)\b/i);

  mustAct(efsp, c.AP, 'AP', fresh(s), { kind: 'SetBlock', blockId: '3G', value: 'CLEAN' });
  mustAct(efsp, c.AP, 'AP', fresh(s), { kind: 'SetState', toState: 'DROPPED' });
});

test('an invalid ordnance state is refused, and the advisory never appears for it', () => {
  const s = inboundFromCenter();
  const bad = act(efsp, c.AP, 'AP', s, { kind: 'SetBlock', blockId: '3G', value: 'HUNG ' });
  assert.equal(bad.ok, false);
  assert.equal(flightDataOf(s).military.ordnanceState, 'CLEAN');
  assert.equal(advisory(s), null);
  mustAct(efsp, c.AP, 'AP', fresh(s), { kind: 'SetState', toState: 'DROPPED' });
});

test('sortie: the tactical Position the pilot reports to records HUNG on the mission line, and the ATC twin is advised (H55)', () => {
  const arr = inboundFromCenter();
  const line = mustAct(efsp, c.TAC_C2, 'TAC_C2', null, {
    kind: 'CreateStrip', bayId: 'tac-c2-tasked', rackId: 'main', stripType: 'MISSION', flightDataId: arr.flightDataId,
  });
  mustAct(efsp, c.TAC_C2, 'TAC_C2', line, { kind: 'SetBlock', blockId: '3G', value: 'HUNG' });
  assert.equal(flightDataOf(arr).military.ordnanceState, 'HUNG', 'one field, reached from the mission line');
  // The MISSION Strip itself carries no advisory (it has no runway); its ATC twin does.
  const tacLine = efsp.boardStoreFor('TACTICAL').getStrip(line.stripId);
  assert.equal(hungOrdnanceAdvisoryFor(tacLine, flightDataOf(arr), runwayStatus()), null);
  assert.equal(hungOrdnanceAdvisoryFor(tacLine, flightDataOf(arr), null), null, 'TACTICAL has no field state');
  assert.equal(advisory(arr).padName, 'Hot cargo pad');
  // Cleared the same way from the ATC side.
  mustAct(efsp, c.AP, 'AP', fresh(arr), { kind: 'SetBlock', blockId: '3G', value: 'CLEAN' });
  assert.equal(advisory(arr), null);
  mustAct(efsp, c.TAC_C2, 'TAC_C2', efsp.boardStoreFor('TACTICAL').getStrip(line.stripId), { kind: 'DropStrip' });
  mustAct(efsp, c.AP, 'AP', fresh(arr), { kind: 'SetState', toState: 'DROPPED' });
});
