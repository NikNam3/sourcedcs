import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// UI-B: (1) RUNWAY_CHANGE has its own suspension wording; (2) an OBSERVED
// departure may be recorded while the runway is suspended (S-L19's open point,
// H19), and only that: the claim must be vouched for by the server's own
// observer, only for DEPARTED, only on a DEPARTURE, audited with its reason.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-ui-b-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');

const { createEfsp } = await import('../src/efsp/index.js');
const fieldState = await import('../src/efsp/field-state.js');
const { crew, mustAct, jumpTo, DEPARTURE_FDR } = await import('./helpers/efsp-scenario.mjs');

test('RUNWAY_CHANGE has its own label in the inhibit reason; WORKS and unknown kinds read as before', () => {
  const rw = (kind) => ({ runwayId: '05/23', status: 'SUSPENDED_WORKS', suspension: kind ? { kind } : null });
  assert.equal(fieldState.runwayStatusReason(rw('RUNWAY_CHANGE')), 'runway 05/23 suspended — runway change in progress');
  assert.equal(fieldState.runwayStatusReason(rw('WORKS')), 'runway 05/23 suspended — works in progress');
  assert.equal(fieldState.runwayStatusReason(rw(null)), 'runway 05/23 suspended — works in progress');
  for (const kind of fieldState.SUSPENSION_KINDS) assert.ok(fieldState.SUSPENSION_LABELS[kind], `${kind} has a label`);
});

const efsp = createEfsp();
const c = crew(efsp, { OPS: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK' });
const RWY = '05/23';
const fs1 = (member, positionId, op) => {
  const cur = efsp.fieldStateStore.getFieldState('INCIRLIK');
  const ack = efsp.handleMessage(member.session, { version: 1, type: 'efsp-field-state-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'INCIRLIK', baseRev: cur.rev, actingPositionId: positionId, op }).ack;
  assert.equal(ack.ok, true, JSON.stringify(ack));
};
let n = 0;
function taxiing() {
  let s = mustAct(efsp, c.OPS, 'OPS', null, { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, callsign: `OBS${++n}`, departureRunway: '05' } });
  s = jumpTo(efsp, c.OPS, 'OPS', s, 'RUNWAY_QUEUE');
  return mustAct(efsp, c.OPS, 'OPS', s, { kind: 'TransferStrip', toPositionId: 'TWR', bayId: 'twr-runway-queue', rackId: 'rwy-05' });
}
const strip = (s) => efsp.boardStore.getStrip(s.stripId);
const setState = (s, extra = {}, toState = 'DEPARTED') => efsp.handleMessage(c.TWR.session, { version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
  facilityId: 'INCIRLIK', actingPositionId: 'TWR', stripId: s.stripId, baseRev: strip(s).rev, op: { kind: 'SetState', toState, ...extra } }).ack;
const log = () => fs.readFileSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l));

const queuedA = taxiing(); // queued before any suspension, as in life
const queuedB = taxiing();

test('an observed departure may be recorded while the runway is suspended; a typed SetState may not', () => {
  fs1(c.OPS, 'OPS', { kind: 'RequestRunwayStatus', runwayId: RWY, action: 'WORKS', note: 'BAK-12' });
  fs1(c.TWR, 'TWR', { kind: 'AcceptRunwayRequest', runwayId: RWY });
  const vouched = new Set();
  efsp.boardStore.setAirborneObserver((s) => vouched.has(s.stripId));

  const s = queuedA;
  // typed: refused, whatever flag it carries when nobody vouches
  assert.equal(setState(s).reason, 'NLA_INHIBITED');
  assert.equal(setState(s, { observedAirborne: true }).reason, 'NLA_INHIBITED', 'a client claim alone is not evidence');
  // vouched, but typed (no flag): still refused (H19)
  vouched.add(s.stripId);
  assert.equal(setState(s).reason, 'NLA_INHIBITED');
  // the flag only ever opens DEPARTED
  assert.equal(setState(s, { observedAirborne: true }, 'LUAW').reason, 'NLA_INHIBITED');
  // vouched and flagged: recorded, audited with its reason
  const ack = setState(s, { observedAirborne: true });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(strip(s).state, 'DEPARTED');
  const entry = log().filter(e => e.op === 'SetState' && e.stripId === s.stripId).at(-1);
  assert.equal(entry.bypass.reason, 'OBSERVED_AIRBORNE');
  assert.equal(entry.bypass.gate, 'RUNWAY_INHIBIT');
  assert.match(entry.bypass.inhibit, /suspended/);
});

test('the bypass never skips the owner check, and a Strip that waits for no inhibit carries no bypass', () => {
  efsp.boardStore.setAirborneObserver(() => true);
  const s = queuedB;
  const wrong = efsp.handleMessage(c.GND.session, { version: 1, type: 'efsp-mutation', clientMutationId: crypto.randomUUID(),
    facilityId: 'INCIRLIK', actingPositionId: 'GND', stripId: s.stripId, baseRev: strip(s).rev, op: { kind: 'SetState', toState: 'DEPARTED', observedAirborne: true } }).ack;
  assert.equal(wrong.ok, false);
  // reopen the runway: the same flagged SetState is an ordinary one, no bypass recorded
  const cur = efsp.fieldStateStore.getFieldState('INCIRLIK');
  assert.equal(cur.runways.find(r => r.runwayId === RWY).status, 'SUSPENDED_WORKS');
  fs1(c.OPS, 'OPS', { kind: 'CompleteRunwayWorks', runwayId: RWY });
  fs1(c.OPS, 'OPS', { kind: 'CompleteInspection', runwayId: RWY });
  const ok = setState(s, { observedAirborne: true });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const entry = log().filter(e => e.op === 'SetState' && e.stripId === s.stripId).at(-1);
  assert.equal(entry.bypass, undefined);
});
