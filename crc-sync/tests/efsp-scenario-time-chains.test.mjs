import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* §10.5's P-time chain through the real board (docs/adr/0073).
 *
 * OPS files from a DD1801 seed carrying item 13's departure time; the P-time
 * reads from the plan; a controller amends Block 6 and it reads CONTROLLER;
 * clearing the amendment falls back to the plan again. The chain writes
 * nothing, so the Mutation log holds only what the controller did.
 *
 * The mission clock is injected on a date years from the wall clock (T7, H11).
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-time-chains-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
  CRCSYNC_EFSP_STEREO_ROUTES_PATH: 'stereo.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '[]');
fs.writeFileSync(process.env.CRCSYNC_EFSP_STEREO_ROUTES_PATH, '[]');

const { createEfsp } = await import('../src/efsp/index.js');
const { toFdrFiledSeed } = await import('../src/efsp/flight-plan-lookup.js');
const { resolveTimeChain } = await import('../src/efsp/time-chains.js');
const { crew, act, mustAct, jumpTo, DEPARTURE_FDR } = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK' };
const zulu = (hh, mm) => Date.UTC(2016, 5, 21, hh, mm);

test('SCENARIO T1 OPS files from a DD1801; P-time falls back to the plan, a controller amendment wins, clearing it resumes the chain', () => {
  const clock = { now: () => zulu(13, 50), source: 'MISSION' };
  const efsp = createEfsp({ clock });
  const c = crew(efsp, ATC);

  // What the client spreads into op.fdr from the lookup (efsp-panel.js `...seed`).
  const seed = toFdrFiledSeed({ route: 'DCT', levelValue: '250', depAerodrome: 'LTAG', destAerodrome: 'LTAG', depTime: '1430' });
  const strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { ...DEPARTURE_FDR, ...seed, callsign: 'CHAIN1' },
  });
  const fdr = () => efsp.fdrStore.getFdr(strip.fdrId);
  assert.equal(fdr().timeInputs.flightPlanDepartureUtc, zulu(14, 30));
  assert.deepEqual(pick(resolveTimeChain('departure', fdr())), { valueUtc: zulu(14, 30), source: 'FLIGHT_PLAN' });
  assert.deepEqual(pick(resolveTimeChain('takeoff', fdr())), { valueUtc: zulu(14, 30), source: 'EST_OFF_BLOCK' });

  // "We're delayed, new P-time 1450."
  let s = efsp.boardStore.getStrip(strip.stripId);
  s = mustAct(efsp, c.OPS, 'OPS', s, { kind: 'SetBlock', blockId: '6', value: '1450' });
  assert.deepEqual(pick(resolveTimeChain('departure', fdr())), { valueUtc: zulu(14, 50), source: 'CONTROLLER' });
  assert.equal(resolveTimeChain('offBlock', fdr()).valueUtc, zulu(14, 50), 'the estimates follow the amendment');

  // Cleared: back to the plan, not lost.
  s = mustAct(efsp, c.OPS, 'OPS', s, { kind: 'SetBlock', blockId: '6', value: '' });
  assert.equal(fdr().filed.proposedDepartureTimeUtc, null);
  assert.deepEqual(pick(resolveTimeChain('departure', fdr())), { valueUtc: zulu(14, 30), source: 'FLIGHT_PLAN' });

  // The estimates were never written (T5), and the log shows only the controller.
  assert.equal(fdr().assigned.taxiTimeUtc, null);
  assert.equal(fdr().assigned.takeoffTimeUtc, null);
  const ours = efsp.mutationLog.readAll().filter(e => e.stripId === strip.stripId && e.ok !== false && !e.reason);
  assert.deepEqual(ours.map(e => [e.op, e.actingPositionId]), [['CreateStrip', 'OPS'], ['SetBlock', 'OPS'], ['SetBlock', 'OPS']]);
});

test('SCENARIO T2 an FDR carrying the ATO\'s departure time and no plan resolves to ATO (hand-built, contract C1)', () => {
  const T = zulu(13, 10);
  const fdr = { filed: { proposedDepartureTimeUtc: null }, assigned: {}, timeInputs: { flightPlanDepartureUtc: null }, ato: { departure: { timeUtc: T } } };
  assert.deepEqual(pick(resolveTimeChain('departure', fdr)), { valueUtc: T, source: 'ATO' });
  assert.equal(resolveTimeChain('takeoff', fdr).estimated, true);
});

test('SCENARIO T3 the takeoff is stamped by the state change, wins over the off-block estimate, loses to a typed time (docs/adr/0076)', async () => {
  let now = zulu(14, 20);
  const clock = { now: () => now, source: 'MISSION' };
  const efsp = createEfsp({ clock });
  const c = crew(efsp, ATC);
  const seed = toFdrFiledSeed({ route: 'DCT', levelValue: '250', depAerodrome: 'LTAG', destAerodrome: 'LTAG', depTime: '1430' });
  let strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE', fdr: { ...DEPARTURE_FDR, ...seed, callsign: 'STAMP1', departureRunway: '05' },
  });
  const fdr = () => efsp.fdrStore.getFdr(strip.fdrId);
  assert.equal(resolveTimeChain('takeoff', fdr()).source, 'EST_OFF_BLOCK');

  strip = jumpTo(efsp, c.OPS, 'OPS', strip, 'RUNWAY_QUEUE');
  strip = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'TransferStrip', toPositionId: 'TWR', bayId: 'twr-runway-queue', rackId: 'rwy-05' });
  strip = jumpTo(efsp, c.TWR, 'TWR', strip, 'LUAW');
  assert.equal(fdr().timeInputs.takeoffStampedUtc, null, 'lining up is not taking off');

  // TWR presses Airborne: the NLA.
  now = zulu(14, 33);
  await new Promise(r => setTimeout(r, 410)); // the double-tap guard
  const ack = act(efsp, c.TWR, 'TWR', strip, { kind: 'InvokeNla' });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.equal(ack.strip.state, 'DEPARTED');
  assert.equal(ack.fdr.timeInputs.takeoffStampedUtc, zulu(14, 33), 'the ack carries the FDR, so it is broadcast');
  assert.deepEqual(pick(resolveTimeChain('takeoff', fdr())), { valueUtc: zulu(14, 33), source: 'STATE_CHANGE' });
  assert.equal(resolveTimeChain('takeoff', fdr()).estimated, false);
  assert.equal(fdr().assigned.takeoffTimeUtc, null, 'never written into the controller\'s own field');
  strip = efsp.boardStore.getStrip(strip.stripId);

  // Undo within its window: the takeoff did not happen.
  const undone = act(efsp, c.TWR, 'TWR', strip, { kind: 'Undo' });
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(fdr().timeInputs.takeoffStampedUtc, null);
  assert.equal(resolveTimeChain('takeoff', fdr()).source, 'EST_OFF_BLOCK');
  strip = efsp.boardStore.getStrip(strip.stripId);

  // Again, later; a later state change does not restamp it.
  now = zulu(14, 35);
  strip = jumpTo(efsp, c.TWR, 'TWR', strip, 'DEPARTED');
  assert.equal(fdr().timeInputs.takeoffStampedUtc, zulu(14, 35));
  now = zulu(14, 40);
  strip = mustAct(efsp, c.TWR, 'TWR', strip, { kind: 'TransferStrip', toPositionId: 'APP', bayId: 'app-departures', rackId: 'main' });
  assert.equal(fdr().timeInputs.takeoffStampedUtc, zulu(14, 35), 'handing off does not restamp');

  // A controller's typed time wins; clearing it resumes the stamp.
  strip = mustAct(efsp, c.APP, 'APP', strip, { kind: 'SetBlock', blockId: '18', value: '1436' });
  assert.deepEqual(pick(resolveTimeChain('takeoff', fdr())), { valueUtc: zulu(14, 36), source: 'CONTROLLER' });
  strip = mustAct(efsp, c.APP, 'APP', strip, { kind: 'SetBlock', blockId: '18', value: '' });
  assert.equal(resolveTimeChain('takeoff', fdr()).source, 'STATE_CHANGE');

  // A drop after takeoff keeps it.
  mustAct(efsp, c.APP, 'APP', strip, { kind: 'DropStrip' });
  assert.equal(fdr().timeInputs.takeoffStampedUtc, zulu(14, 35));
});

function pick(r) { return { valueUtc: r.valueUtc, source: r.source }; }
