import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Military sorties — TOFI in its variations, and a mission run from tasking
// to RTB while the ATC side carries on independently.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-mil-scn-'));
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
const { crew, act, mustAct, jumpTo, DEPARTURE_FDR, airborneDeparture, handedToCenter } = await import('./helpers/efsp-scenario.mjs');

const ALL = {
  OPS: 'INCIRLIK', APP: 'INCIRLIK', CTR: 'CENTER',
  TAC_C2: 'TACTICAL', GCI: 'TACTICAL', AIC: 'TACTICAL', JTAC: 'TACTICAL',
};

function atCenter(efsp, c, callsign) {
  return handedToCenter(efsp, c, airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign }));
}
function tacticalStrip(efsp, id) { return efsp.boardStoreFor('TACTICAL').getStrip(id); }
function centerStrip(efsp, id) { return efsp.boardStoreFor('CENTER').getStrip(id); }

// ── 17. TOFI to GCI rather than TAC_C2 ──────────────────────────────────

test('SCENARIO tactical control handed to GCI, which is the other of Center\'s two counterparts', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ALL);

  let ctrStrip = mustAct(efsp, c.CTR, 'CTR', atCenter(efsp, c, 'GCI1'), {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'GCI',
  });
  const mission = tacticalStrip(efsp, ctrStrip.tofiCoordination.peerStripId);
  assert.equal(mission.ownerPositionId, 'GCI');
  assert.equal(mission.bayId, 'gci-coordination', 'lands in GCI\'s own Coordination Bay, not TAC_C2\'s');
  assert.equal(mission.role, 'MISSION');

  const accepted = mustAct(efsp, c.GCI, 'GCI', mission, { kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA' });
  assert.equal(accepted.tofiCoordination.state, 'ACTIVE');

  // And AIC, which works under TAC_C2's TOFI rather than holding one, is
  // never a counterpart in either direction (docs/adr/0025).
  const other = atCenter(efsp, c, 'GCI2');
  const toAic = act(efsp, c.CTR, 'CTR', other, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'AIC',
  });
  assert.equal(toAic.ok, false);
  assert.match(toAic.detail, /not a valid TOFI counterpart/);
});

// ── 18. a mission from tasking to RTB ───────────────────────────────────

test('SCENARIO a mission runs its own six states while the ATC side carries on', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ALL);

  let ctrStrip = mustAct(efsp, c.CTR, 'CTR', atCenter(efsp, c, 'MSN1'), {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });
  let mission = mustAct(efsp, c.TAC_C2, 'TAC_C2', tacticalStrip(efsp, ctrStrip.tofiCoordination.peerStripId), {
    kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA',
  });
  assert.equal(mission.state, 'TASKED');

  // The MISSION lifecycle is independent of the exchange (docs/adr/0026) —
  // it advances all the way to RTB with the TOFI link still ACTIVE.
  for (const state of ['AIRBORNE', 'ON_STATION', 'OFF_STATION', 'RTB']) {
    mission = jumpTo(efsp, c.TAC_C2, 'TAC_C2', mission, state);
    assert.equal(mission.tofiCoordination.state, 'ACTIVE', `still under tactical control at ${state}`);
  }

  // But it cannot END during one — RTB's next action is the terminal Drop,
  // and §4.6.3 rule 2 forbids dropping a Strip under tactical control.
  const early = act(efsp, c.TAC_C2, 'TAC_C2', mission, { kind: 'InvokeNla' });
  assert.equal(early.ok, false);
  assert.match(early.detail, /active tactical control/);

  // Exit properly, then it retires.
  ctrStrip = centerStrip(efsp, ctrStrip.stripId);
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'SetBlock', blockId: 'SREG', value: 'ATC' });
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' });
  mustAct(efsp, c.TAC_C2, 'TAC_C2', tacticalStrip(efsp, mission.stripId), { kind: 'TOFI', action: 'ACCEPT' });

  const retired = mustAct(efsp, c.TAC_C2, 'TAC_C2', tacticalStrip(efsp, mission.stripId), { kind: 'InvokeNla' });
  assert.equal(retired.state, 'DROPPED');
});

// ── 19. a refused entry ─────────────────────────────────────────────────

test('SCENARIO the MRU refuses tactical control, and the ATC side recovers', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ALL);

  const ctrStrip = mustAct(efsp, c.CTR, 'CTR', atCenter(efsp, c, 'REJ1'), {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });
  const mission = tacticalStrip(efsp, ctrStrip.tofiCoordination.peerStripId);
  mustAct(efsp, c.TAC_C2, 'TAC_C2', mission, { kind: 'TOFI', action: 'REJECT' });

  const afterReject = centerStrip(efsp, ctrStrip.stripId);
  assert.equal(afterReject.tofiCoordination.state, 'REJECTED');
  assert.equal(afterReject.state, 'HANDED_OFF', 'the ATC side never moved — jurisdiction never transfers');

  // A rejection is not a dead end: the same Strip can ask again.
  const retried = mustAct(efsp, c.CTR, 'CTR', afterReject, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'GCI',
  });
  assert.equal(retried.tofiCoordination.state, 'PROPOSED');
  assert.equal(retried.tofiCoordination.peerPositionId, 'GCI', 'and it may ask somebody else');
});

// ── 20. a degraded track ────────────────────────────────────────────────

test('SCENARIO a flight with a degraded track cannot be coordinated silently', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ALL);

  let strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'DEGR1' });
  strip = mustAct(efsp, c.APP, 'APP', strip, { kind: 'SetBlock', blockId: '5A', value: 'CST' });

  // §4.6 rule 5 — a degraded track forces the verbal path, so the exchange
  // needs a note saying what was said out loud.
  const silent = act(efsp, c.APP, 'APP', strip, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
  });
  assert.equal(silent.ok, false);
  assert.match(silent.detail, /note/i);

  const spoken = mustAct(efsp, c.APP, 'APP', strip, {
    kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
    note: 'coordinated by landline, coast-tracking',
  });
  assert.equal(spoken.coordination.note, 'coordinated by landline, coast-tracking');

  // The same rule covers TOFI, which sits under it in the same table.
  let other = handedToCenter(efsp, c, airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'DEGR2' }));
  other = mustAct(efsp, c.CTR, 'CTR', other, { kind: 'SetBlock', blockId: '5A', value: 'FAIL' });
  const silentTofi = act(efsp, c.CTR, 'CTR', other, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });
  assert.equal(silentTofi.ok, false);
  assert.match(silentTofi.detail, /note/i);
});

// ── the D12 audit, as a sortie ──────────────────────────────────────────

test('SCENARIO a controller holding both CTR and TAC_C2 still cannot hand off a mission', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ALL);

  // Guide §13's own named acceptance test: "a HANDOFF attempted on a
  // TAC_C2-owned Strip is refused, even though the same controller holds
  // CTR." Combining Positions must not union their permissions (D21).
  const ctrStrip = mustAct(efsp, c.CTR, 'CTR', atCenter(efsp, c, 'D12A'), {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });
  const mission = tacticalStrip(efsp, ctrStrip.tofiCoordination.peerStripId);

  for (const kind of ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT']) {
    const ack = act(efsp, c.TAC_C2, 'TAC_C2', mission, {
      kind, action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR',
    });
    assert.equal(ack.ok, false, kind);
    assert.equal(ack.reason, 'PERMISSION_DENIED', kind);
  }

  // JTAC is read-only by having no grant at all, rather than by a flag.
  assert.equal(act(efsp, c.JTAC, 'JTAC', mission, { kind: 'SetState', toState: 'AIRBORNE' }).ok, false);
});

// ── 22. the military extension namespace, end to end (docs/adr/0052) ──────

test('SCENARIO a loaded flight declares a hung store and a hook requirement, on every ATC Role', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ALL);

  // The whole reason this reaches for the real wiring rather than a rules
  // fixture: the 'military' target kind has to survive block-map.js ->
  // board-store.js -> fdr-store.js's dedicated setter. Every hop is somewhere
  // a new target kind has been forgotten before.
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'HUNG11' });

  const loaded = mustAct(efsp, c.APP, 'APP', strip, { kind: 'SetBlock', blockId: '3G', value: 'LOADED' });
  assert.equal(efsp.fdrStore.getFdr(loaded.fdrId).military.ordnanceState, 'LOADED');

  const hooked = mustAct(efsp, c.APP, 'APP', loaded, { kind: 'SetBlock', blockId: '3F', value: true });
  const fdr = efsp.fdrStore.getFdr(hooked.fdrId);
  assert.equal(fdr.military.hookRequired, true);
  assert.equal(fdr.military.ordnanceState, 'LOADED', 'one Block\'s write does not clear the other\'s');
  assert.equal(fdr.provenance.military, 'CONTROLLER_ENTERED');

  // The bad value is refused with a reason, not silently coerced or stored.
  const bogus = act(efsp, c.APP, 'APP', hooked, { kind: 'SetBlock', blockId: '3G', value: 'ARMED' });
  assert.equal(bogus.ok, false);
  assert.match(bogus.detail, /invalid ordnance state/);
  assert.equal(efsp.fdrStore.getFdr(hooked.fdrId).military.ordnanceState, 'LOADED');

  // And the same Blocks work on an ARRIVAL, which is the Role that will
  // actually care (§9.7's gear check is on landing). docs/adr/0051's lesson:
  // check every Role, because the test that passes is not the one that matters.
  const arrival = mustAct(efsp, c.APP, 'APP', hooked, { kind: 'ConvertToArrival' });
  assert.equal(arrival.role, 'ARRIVAL');
  const expended = mustAct(efsp, c.APP, 'APP', arrival, { kind: 'SetBlock', blockId: '3G', value: 'EXPENDED' });
  assert.equal(efsp.fdrStore.getFdr(expended.fdrId).military.ordnanceState, 'EXPENDED');
  assert.equal(efsp.fdrStore.getFdr(expended.fdrId).military.hookRequired, true,
    'a Role change is not a reason for the airframe to stop needing a hook');
});

test('the deferred half of the military namespace has no write path at all (§12)', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ALL);
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FDR, callsign: 'DEFER1' });

  // No Block routes to any of these, so SetBlock cannot reach them — which is
  // what "present and unpopulated" has to mean in practice, not just at seed
  // time. The 9G/9H ids are RESERVED for §9.4 and must not resolve yet.
  for (const blockId of ['9G', '9G-MTR', '9H', '9H-ALT', 'M16']) {
    const result = act(efsp, c.APP, 'APP', strip, { kind: 'SetBlock', blockId, value: 'X' });
    assert.equal(result.ok, false, blockId);
  }
  const fdr = efsp.fdrStore.getFdr(strip.fdrId);
  assert.equal(fdr.military.alertStatus, 'NONE');
  assert.equal(fdr.military.mtr.designator, null);
});

// ── 23. the mission line exists from tasking (docs/adr/0054) ─────────────

/** TAC_C2 tasks a mission line bound to an existing flight. No TOFI involved. */
function taskMissionLine(efsp, c, fdrId) {
  return mustAct(efsp, c.TAC_C2, 'TAC_C2', null, {
    kind: 'CreateStrip', bayId: 'tac-c2-tasked', rackId: 'main', role: 'MISSION', fdrId,
  });
}

test('SCENARIO a mission line is fragged before the jet moves, and both Strips run in parallel', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ALL);

  // The jet is still on the ramp at OPS — nowhere near TOFI-eligible.
  const dep = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main',
    fdr: { ...DEPARTURE_FDR, callsign: 'FRAG11' },
  });
  assert.equal(dep.state, 'PROPOSED');

  const mission = taskMissionLine(efsp, c, dep.fdrId);
  assert.equal(mission.state, 'TASKED', 'TASKED finally means something');
  assert.equal(mission.bayId, 'tac-c2-tasked');
  assert.equal(mission.fdrId, dep.fdrId, 'one flight, two Strips');

  // One FDR, so one beacon code — guide §9.8's bridge field, not a copy.
  const fdr = efsp.fdrStore.getFdr(dep.fdrId);
  assert.ok(fdr.identity.beaconAssigned);
  assert.equal(efsp.fdrStore.getAll().filter(f => f.identity.callsign === 'FRAG11').length, 1);

  // The mission line advances on the MRU's own schedule while the departure
  // is still sitting at PROPOSED. Nothing gates one on the other.
  const airborne = mustAct(efsp, c.TAC_C2, 'TAC_C2', mission, { kind: 'SetState', toState: 'AIRBORNE' });
  assert.equal(airborne.state, 'AIRBORNE');
  assert.equal(efsp.boardStoreFor('INCIRLIK').getStrip(dep.stripId).state, 'PROPOSED',
    'the ATC Strip is untouched — the lifecycles are independent by design');
});

test('SCENARIO TOFI later lands on the mission line that is already there', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ALL);

  const ctrStrip = atCenter(efsp, c, 'FRAG12');
  const mission = taskMissionLine(efsp, c, ctrStrip.fdrId);

  const proposed = mustAct(efsp, c.CTR, 'CTR', ctrStrip, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });
  assert.equal(proposed.tofiCoordination.peerStripId, mission.stripId,
    'the exchange points at the Strip TAC_C2 already had');

  const onTactical = efsp.boardStoreFor('TACTICAL').getAll()
    .filter(s => s.fdrId === ctrStrip.fdrId && s.state !== 'DROPPED');
  assert.equal(onTactical.length, 1, 'one airframe, one MRU record — never a second mission line');

  const accepted = mustAct(efsp, c.TAC_C2, 'TAC_C2', tacticalStrip(efsp, mission.stripId), {
    kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA',
  });
  assert.equal(accepted.tofiCoordination.state, 'ACTIVE');
  assert.equal(efsp.fdrStore.getFdr(ctrStrip.fdrId).tofi.separationRegime, 'MARSA');
});

// ── the pilot-request axis, which is where the defects live ─────────────

test('SCENARIO the flight cancels after it was fragged, and the beacon is not released early', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ALL);

  const dep = mustAct(efsp, c.OPS, 'OPS', null, {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main',
    fdr: { ...DEPARTURE_FDR, callsign: 'CNX11' },
  });
  const mission = taskMissionLine(efsp, c, dep.fdrId);
  const code = efsp.fdrStore.getFdr(dep.fdrId).identity.beaconAssigned;

  // OPS drops the departure. The mission line is still live, so the code the
  // MRU is still looking at must not go back to the pool.
  mustAct(efsp, c.OPS, 'OPS', dep, { kind: 'DropStrip' });
  assert.equal(efsp.fdrStore.codeAllocator.holderOf(code), dep.fdrId,
    'a live mission line keeps the flight alive');

  mustAct(efsp, c.TAC_C2, 'TAC_C2', tacticalStrip(efsp, mission.stripId), { kind: 'DropStrip' });
  assert.notEqual(efsp.fdrStore.codeAllocator.holderOf(code), dep.fdrId,
    'and the last Strip out releases it');
});

test('SCENARIO a second mission line for one flight is refused, and a mis-bind is recoverable', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ALL);

  const right = atCenter(efsp, c, 'BIND11');
  const wrong = atCenter(efsp, c, 'BIND12');

  // The mis-pick this whole affordance has to survive: two adjacent callsigns
  // in one package, and the controller takes the wrong one.
  const mistake = taskMissionLine(efsp, c, wrong.fdrId);
  assert.equal(efsp.fdrStore.getFdr(mistake.fdrId).identity.callsign, 'BIND12',
    'the mission line renders the bound flight\'s callsign, so the error is visible at once');

  const dupe = act(efsp, c.TAC_C2, 'TAC_C2', null, {
    kind: 'CreateStrip', bayId: 'tac-c2-tasked', rackId: 'main', role: 'MISSION', fdrId: wrong.fdrId,
  });
  assert.equal(dupe.ok, false);
  assert.match(dupe.detail, /already has a live MISSION Strip/);

  // Unbind is Drop: nothing on a wrongly-bound mission line is worth keeping.
  mustAct(efsp, c.TAC_C2, 'TAC_C2', tacticalStrip(efsp, mistake.stripId), { kind: 'DropStrip' });
  const redone = taskMissionLine(efsp, c, right.fdrId);
  assert.equal(efsp.fdrStore.getFdr(redone.fdrId).identity.callsign, 'BIND11');
});

test('SCENARIO a bound pair under ACTIVE tactical control cannot be dropped from either side, and the way out is EXIT', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ALL);

  let ctrStrip = atCenter(efsp, c, 'FRZ11');
  const mission = taskMissionLine(efsp, c, ctrStrip.fdrId);
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', ctrStrip, {
    kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2',
  });
  mustAct(efsp, c.TAC_C2, 'TAC_C2', tacticalStrip(efsp, mission.stripId), {
    kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA',
  });

  // Documented, pre-existing, and now reachable far more often: while the
  // exchange is ACTIVE neither Strip can be retired. Written down here so it
  // is a known property rather than a 0200 surprise.
  assert.equal(act(efsp, c.CTR, 'CTR', centerStrip(efsp, ctrStrip.stripId), { kind: 'DropStrip' }).ok, false);
  assert.equal(act(efsp, c.TAC_C2, 'TAC_C2', tacticalStrip(efsp, mission.stripId), { kind: 'DropStrip' }).ok, false);

  // The way out. Note the EXIT gate needs SREG back at ATC — which is only
  // answerable because accepting made somebody state it in the first place.
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', centerStrip(efsp, ctrStrip.stripId), { kind: 'SetBlock', blockId: 'SREG', value: 'ATC' });
  ctrStrip = mustAct(efsp, c.CTR, 'CTR', ctrStrip, { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' });
  mustAct(efsp, c.TAC_C2, 'TAC_C2', tacticalStrip(efsp, mission.stripId), { kind: 'TOFI', action: 'ACCEPT' });
  assert.equal(act(efsp, c.CTR, 'CTR', centerStrip(efsp, ctrStrip.stripId), { kind: 'DropStrip' }).ok, true);
});

test('SCENARIO a crc-sync restart leaves the two Strips still bound to one flight', () => {
  const efsp = createEfsp();
  const c = crew(efsp, ALL);
  const ctrStrip = atCenter(efsp, c, 'RST11');
  const mission = taskMissionLine(efsp, c, ctrStrip.fdrId);

  const tac = efsp.boardStoreFor('TACTICAL');
  const snapshot = JSON.parse(JSON.stringify(tac.snapshot()));
  tac.restore(snapshot);

  const back = tac.getStrip(mission.stripId);
  assert.equal(back.fdrId, ctrStrip.fdrId, 'the binding is the shared fdrId, so it survives by construction');
  assert.equal(back.role, 'MISSION');
  assert.equal(back.state, 'TASKED');
});
