import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Departure and release sorties — the ways a flight can be stopped on the
// ground, and what it takes to let it go.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-release-scn-'));
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
const { crew, act, mustAct, jumpTo, advance, DEPARTURE_FDR, obligationAlerts } = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GND: 'INCIRLIK', TWR: 'INCIRLIK', APP: 'INCIRLIK' };
const MINUTE = 60 * 1000;

/** A cleared flight sitting at CD, which is where every release case begins. */
async function cleared(efsp, c, callsign) {
  let strip = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', role: 'DEPARTURE',
    fdr: { ...DEPARTURE_FDR, callsign },
  });
  strip = await advance(efsp, c.OPS, 'OPS', strip); // -> PENDING_CLEARANCE at CD
  return jumpTo(efsp, c.CD, 'CD', strip, 'CLEARED');
}

// ── 1. held for release ──────────────────────────────────────────────────

test('SCENARIO a flight held for release cannot push until somebody releases it', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  let strip = await cleared(efsp, c, 'HOLD1');

  strip = mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '14A', value: 'HOLD_FOR_RELEASE' });
  const blocked = act(efsp, c.CD, 'CD', strip, { kind: 'InvokeNla' });
  assert.equal(blocked.ok, false, 'a held flight does not push');
  assert.equal(blocked.reason, 'NLA_INHIBITED');

  strip = mustAct(efsp, c.CD, 'CD', efsp.boardStore.getStrip(strip.stripId), {
    kind: 'SetBlock', blockId: '14A', value: 'RELEASED',
  });
  const released = await advance(efsp, c.CD, 'CD', strip);
  assert.equal(released.state, 'PUSHBACK');
  assert.equal(released.ownerPositionId, 'GND');
});

// ── 2. clearance void time ───────────────────────────────────────────────

test('SCENARIO a clearance goes void while the flight is still on the ground', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);
  let strip = await cleared(efsp, c, 'VOID1');

  // A void time already 31 minutes old: the derived deadline (§3.8, 30 min
  // after the void time) has passed with the flight still sitting there.
  const voidTime = Date.now() - 31 * MINUTE;
  strip = mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '14A', value: 'CLEARANCE_VOID_TIME' });
  strip = mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '14D', value: voidTime });
  strip = jumpTo(efsp, c.CD, 'CD', strip, 'HELD');

  const fdr = efsp.fdrStore.getFdr(strip.fdrId);
  assert.equal(fdr.assigned.voidDeadlineUtc, voidTime + 30 * MINUTE, 'the deadline is derived, not entered');

  // Passive half: the release button refuses.
  const blocked = act(efsp, c.CD, 'CD', strip, { kind: 'InvokeNla' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.detail, /void time expired/);

  // Active half — the part §3.8 actually requires ("the system MUST alert"),
  // and the reason void expiry became an obligation rather than staying a
  // button check nobody would see until they went looking.
  const alerts = await obligationAlerts(efsp, facilityConfig);
  const alert = alerts.find(a => a.stripId === strip.stripId && a.obligationType === 'VOID_TIME_EXPIRED');
  assert.ok(alert, JSON.stringify(alerts));
  assert.equal(alert.severity, 'OVERDUE');
});

// ── 3. EDCT ──────────────────────────────────────────────────────────────

test('SCENARIO an EDCT slot: inside the window it goes, outside it waits', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  const onTime = await cleared(efsp, c, 'EDCT1');
  let strip = mustAct(efsp, c.CD, 'CD', onTime, { kind: 'SetBlock', blockId: '14A', value: 'EDCT' });
  strip = mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '14B', value: Date.now() });
  // Anything other than RELEASED holds the Strip at CLEARED, so the flight
  // goes to HELD — which is what HELD means (§3.4: "hold for release,
  // release time, or void time in force"). The windows are checked there.
  strip = jumpTo(efsp, c.CD, 'CD', strip, 'HELD');
  const window = efsp.fdrStore.getFdr(strip.fdrId).assigned;
  assert.equal(window.edctWindowStartUtc, window.edctTimeUtc - 5 * MINUTE, '±5 minutes, derived');
  assert.equal(window.edctWindowEndUtc, window.edctTimeUtc + 5 * MINUTE);
  assert.equal((await advance(efsp, c.CD, 'CD', strip)).state, 'PUSHBACK');

  // A second flight whose slot is an hour away is not going anywhere yet.
  const early = await cleared(efsp, c, 'EDCT2');
  let waiting = mustAct(efsp, c.CD, 'CD', early, { kind: 'SetBlock', blockId: '14A', value: 'EDCT' });
  waiting = mustAct(efsp, c.CD, 'CD', waiting, { kind: 'SetBlock', blockId: '14B', value: Date.now() + 60 * MINUTE });
  waiting = jumpTo(efsp, c.CD, 'CD', waiting, 'HELD');
  const tooEarly = act(efsp, c.CD, 'CD', waiting, { kind: 'InvokeNla' });
  assert.equal(tooEarly.ok, false);
  assert.match(tooEarly.detail, /EDCT window is not open yet/);

  // And a slot that has already gone needs a new one, rather than sliding
  // through silently.
  const missed = await cleared(efsp, c, 'EDCT3');
  let late = mustAct(efsp, c.CD, 'CD', missed, { kind: 'SetBlock', blockId: '14A', value: 'EDCT' });
  late = mustAct(efsp, c.CD, 'CD', late, { kind: 'SetBlock', blockId: '14B', value: Date.now() - 60 * MINUTE });
  late = jumpTo(efsp, c.CD, 'CD', late, 'HELD');
  assert.match(act(efsp, c.CD, 'CD', late, { kind: 'InvokeNla' }).detail, /window has passed/);
});

// ── 4. call for release ──────────────────────────────────────────────────

test('SCENARIO call for release: a tighter window than an EDCT, and it bites the same way', async () => {
  const efsp = createEfsp();
  const c = crew(efsp, ATC);

  const strip = await cleared(efsp, c, 'CFR1');
  let waiting = mustAct(efsp, c.CD, 'CD', strip, { kind: 'SetBlock', blockId: '14A', value: 'CALL_FOR_RELEASE' });
  waiting = mustAct(efsp, c.CD, 'CD', waiting, { kind: 'SetBlock', blockId: '14C', value: Date.now() + 30 * MINUTE });

  waiting = jumpTo(efsp, c.CD, 'CD', waiting, 'HELD');
  const assigned = efsp.fdrStore.getFdr(waiting.fdrId).assigned;
  assert.equal(assigned.callForReleaseWindowStartUtc, assigned.callForReleaseTimeUtc - 2 * MINUTE);
  assert.equal(assigned.callForReleaseWindowEndUtc, assigned.callForReleaseTimeUtc + 1 * MINUTE,
    'asymmetric on purpose — −2/+1, not ±5 like an EDCT');

  assert.match(act(efsp, c.CD, 'CD', waiting, { kind: 'InvokeNla' }).detail, /call-for-release window is not open yet/);
});
