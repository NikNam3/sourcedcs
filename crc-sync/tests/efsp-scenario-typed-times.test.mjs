import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* Typed time Blocks — supervisor fix F4 (R2-17, S-R2-17).
 *
 * A controller types a release, void or slot time as four-digit Zulu ("1400")
 * into Blocks 6, 14, 14B–D and 16–18. Before F4 the string went into the FDR
 * as-is, so a typed void time never expired ("1400" + 30 min is the string
 * "14001800000") and a typed release time never held (`now < "1400"` is
 * false for any epoch). These sorties type the times the way the cell sends
 * them and let the mission clock run past them.
 *
 * The mission clock is injected and set by hand, on a date nothing else uses,
 * so a time dated by the wall clock would land visibly on the wrong day.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-typed-times-scn-'));
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
const facilityConfig = await import('../src/efsp/facility-config.js');
const { ForwardingObligationMonitor } = await import('../src/efsp/forwarding-obligations.js');
const { crew, act, mustAct, jumpTo, advance, DEPARTURE_FDR } = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK' };
const MINUTE = 60 * 1000;
const zulu = (hh, mm) => Date.UTC(2016, 5, 21, hh, mm);

/** A mission clock the scenario moves by hand. */
function missionClock(start) {
  let now = start;
  return { now: () => now, source: 'MISSION', set: (ms) => { now = ms; } };
}

function setup() {
  const clock = missionClock(zulu(13, 50));
  const efsp = createEfsp({ clock });
  const c = crew(efsp, ATC);
  const monitor = new ForwardingObligationMonitor({
    boardStoreFor: efsp.boardStoreFor, fdrStore: efsp.fdrStore, facilityConfig, airspaceStore: efsp.airspaceStore, clock,
  });
  return { clock, efsp, c, monitor };
}

async function cleared(efsp, c, callsign) {
  let strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { ...DEPARTURE_FDR, callsign },
  });
  strip = await advance(efsp, c.OPS, 'OPS', strip); // -> PENDING_CLEARANCE at CD
  return jumpTo(efsp, c.CD, 'CD', strip, 'CLEARED');
}

const fresh = (efsp, strip) => efsp.boardStore.getStrip(strip.stripId);

// ── 1. a typed void time expires ─────────────────────────────────────────

test('SCENARIO a void time typed as 1400 is dated on the mission day and actually expires at 1430', async () => {
  const { clock, efsp, c, monitor } = setup();
  let strip = await cleared(efsp, c, 'VOID9');

  strip = mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '14A', value: 'CLEARANCE_VOID_TIME' });
  strip = mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '14D', value: '1400' });
  strip = jumpTo(efsp, c.CD, 'CD', strip, 'HELD');

  const assigned = efsp.fdrStore.getFdr(strip.fdrId).assigned;
  assert.equal(assigned.voidTimeUtc, zulu(14, 0), 'epoch ms on the MISSION date, not the typed string');
  assert.equal(assigned.voidDeadlineUtc, zulu(14, 30), 'the derived deadline is arithmetic, not concatenation');

  // 1350Z: the clearance is still good, nobody is alerted.
  monitor.tick();
  assert.equal(monitor.getAll().some(a => a.stripId === strip.stripId), false, JSON.stringify(monitor.getAll()));

  // 1431Z: the deadline has passed with the flight still on the ground.
  clock.set(zulu(14, 31));
  const blocked = act(efsp, c.CD, 'CD', fresh(efsp, strip), { kind: 'InvokeNla' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.detail, /void time expired/);
  monitor.tick();
  const alert = monitor.getAll().find(a => a.stripId === strip.stripId && a.obligationType === 'VOID_TIME_EXPIRED');
  assert.ok(alert, JSON.stringify(monitor.getAll()));
  assert.equal(alert.severity, 'OVERDUE');
});

// ── 2. a typed release time gates the HELD NLA ───────────────────────────

test('SCENARIO a release time typed as 14:00Z holds the flight until 1400, then lets it push', async () => {
  const { clock, efsp, c } = setup();
  let strip = await cleared(efsp, c, 'RLS9');

  strip = mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '14A', value: 'RELEASE_TIME' });
  strip = mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '14', value: '14:00Z' });
  strip = jumpTo(efsp, c.CD, 'CD', strip, 'HELD');
  assert.equal(efsp.fdrStore.getFdr(strip.fdrId).assigned.releaseTimeUtc, zulu(14, 0));

  const early = act(efsp, c.CD, 'CD', fresh(efsp, strip), { kind: 'InvokeNla' });
  assert.equal(early.ok, false, 'ten minutes early: held');
  assert.match(early.detail, /release time not reached/);

  clock.set(zulu(14, 0));
  const pushed = await advance(efsp, c.CD, 'CD', fresh(efsp, strip));
  assert.equal(pushed.state, 'PUSHBACK');
  assert.equal(pushed.ownerPositionId, 'GND');
});

// ── 3. the slot windows derive from a typed time ─────────────────────────

test('SCENARIO an EDCT typed as 1355 opens its window at 1350 and a CFR typed as 1400 opens at 1358', async () => {
  const { clock, efsp, c } = setup();

  let edct = await cleared(efsp, c, 'EDCT9');
  edct = mustAct(efsp, c.CD, 'CD', edct, { kind: 'SetBlock', blockId: '14A', value: 'EDCT' });
  edct = mustAct(efsp, c.CD, 'CD', edct, { kind: 'SetBlock', blockId: '14B', value: '1355' });
  edct = jumpTo(efsp, c.CD, 'CD', edct, 'HELD');
  const e = efsp.fdrStore.getFdr(edct.fdrId).assigned;
  assert.deepEqual([e.edctTimeUtc, e.edctWindowStartUtc, e.edctWindowEndUtc], [zulu(13, 55), zulu(13, 50), zulu(14, 0)]);

  let cfr = await cleared(efsp, c, 'CFR9');
  cfr = mustAct(efsp, c.CD, 'CD', cfr, { kind: 'SetBlock', blockId: '14A', value: 'CALL_FOR_RELEASE' });
  cfr = mustAct(efsp, c.CD, 'CD', cfr, { kind: 'SetBlock', blockId: '14C', value: '1400' });
  cfr = jumpTo(efsp, c.CD, 'CD', cfr, 'HELD');
  assert.match(act(efsp, c.CD, 'CD', fresh(efsp, cfr), { kind: 'InvokeNla' }).detail, /call-for-release window is not open yet/);

  clock.set(zulu(13, 58));
  assert.equal((await advance(efsp, c.CD, 'CD', fresh(efsp, cfr))).state, 'PUSHBACK');
  assert.equal((await advance(efsp, c.CD, 'CD', fresh(efsp, edct))).state, 'PUSHBACK');
});

// ── 4. a typo is refused, never stored ───────────────────────────────────

test('SCENARIO a typo\'d void time (1472) is refused and the FDR is unchanged; an empty cell clears the time', async () => {
  const { efsp, c } = setup();
  let strip = await cleared(efsp, c, 'TYPO9');
  strip = mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '14A', value: 'CLEARANCE_VOID_TIME' });
  strip = mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '14D', value: '1400' });
  const before = structuredClone(efsp.fdrStore.getFdr(strip.fdrId));

  const typo = act(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '14D', value: '1472' });
  assert.equal(typo.ok, false);
  assert.equal(typo.reason, 'VALIDATION_ERROR');
  assert.match(typo.detail, /void time must be a UTC time as HHMM/);
  assert.deepEqual(efsp.fdrStore.getFdr(strip.fdrId), before, 'no partial write, no rev bump');

  mustAct(efsp, c.CD, 'CD', fresh(efsp, strip), { kind: 'SetBlock', blockId: '14D', value: '' });
  const assigned = efsp.fdrStore.getFdr(strip.fdrId).assigned;
  assert.equal(assigned.voidTimeUtc, null);
  assert.equal(assigned.voidDeadlineUtc, null);
});

// ── 5. every other typed time Block takes the same rule ──────────────────

test('SCENARIO Blocks 6, 16, 17 and 18 store epoch ms on the mission date; an ETA typed across midnight is tomorrow', async () => {
  const { clock, efsp, c } = setup();
  let strip = await cleared(efsp, c, 'TIME9');
  for (const [blockId, typed, expected] of [['6', '1345', zulu(13, 45)], ['16', '1352', zulu(13, 52)], ['17', '1355', zulu(13, 55)], ['18', '1405', zulu(14, 5)]]) {
    strip = mustAct(efsp, c.CD, 'CD', fresh(efsp, strip), { kind: 'SetBlock', blockId, value: typed });
    const fdr = efsp.fdrStore.getFdr(strip.fdrId);
    const value = { '6': fdr.filed.proposedDepartureTimeUtc, '16': fdr.assigned.movementAreaEntryTimeUtc, '17': fdr.assigned.taxiTimeUtc, '18': fdr.assigned.takeoffTimeUtc }[blockId];
    assert.equal(value, expected, blockId);
  }

  // An ARRIVAL filed at 2350Z with a 0010 ETA arrives tomorrow, not 23 h ago.
  clock.set(zulu(23, 50));
  const arrival = efsp.fdrStore.createFdr({ callsign: 'ARR9', estimatedArrivalTimeUtc: '0010' }, { by: 'test' });
  assert.equal(arrival.ok, true);
  assert.equal(arrival.fdr.filed.estimatedArrivalTimeUtc, Date.UTC(2016, 5, 22, 0, 10));
  const bad = efsp.fdrStore.createFdr({ callsign: 'ARR8', estimatedArrivalTimeUtc: 'soon' }, { by: 'test' });
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /estimated arrival time must be a UTC time as HHMM/);
});
