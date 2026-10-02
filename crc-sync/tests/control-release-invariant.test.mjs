import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { prologue, makeWorld, exchange, holders, fakeWallClock } from './helpers/control-release-fixture.mjs';

// The control invariant (docs/adr/0101, H100 DR-6): a live flight never has nobody holding comms and control. One scenario
// per path of the ADR's table; each asserts the invariant after every step (CRCSYNC_CONTROL_INVARIANT=throw makes a
// violation throw, so a path that would break it fails loudly). The bounded exhaustive walk (I11) is at the end.

prologue('control-release-inv-');
const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = await import('../src/efsp/facility-config.js');
const helpers = await import('./helpers/efsp-scenario.mjs');
const { ForwardingObligationMonitor } = await import('../src/efsp/forwarding-obligations.js');
const { controlInvariantRefusal } = (await import('../src/efsp/board/ops/undo.js')).default;
const { act, mustAct, hold } = helpers;

const world = (opts) => {
  const w = makeWorld(createEfsp, helpers, opts);
  w.base = w.efsp.mutationLog.readAll().length; // the log file outlives a world: a test reads only what its own world wrote
  return w;
};
const ex0 = (w, callsign, opts) => exchange(w, helpers, callsign, opts);
const asT = (w, ex, op) => act(w.efsp, w.c.CTR, 'CTR', ex.T(), op);
const asR = (w, ex, op) => act(w.efsp, w.c.AP, 'AP', ex.R(), op);
const mustT = (w, ex, op) => mustAct(w.efsp, w.c.CTR, 'CTR', ex.T(), op);
const mustR = (w, ex, op) => mustAct(w.efsp, w.c.AP, 'AP', ex.R(), op);
const log = (w) => w.efsp.mutationLog.readAll().slice(w.base || 0);
const DROP = { kind: 'DropStrip' };
const grantFull = { kind: 'ControlRelease', action: 'GRANT', scopes: ['FULL'] };
const repairs = (w) => log(w).filter(e => e.op === 'InterfacilityControlRepair' && e.source !== 'peer'); // the system entries; each has a peer mirror

/** Runs fn with the invariant in repair mode (production behaviour) instead of throwing. */
function repairMode(fn) {
  const was = process.env.CRCSYNC_CONTROL_INVARIANT;
  process.env.CRCSYNC_CONTROL_INVARIANT = 'repair';
  try { return fn(); } finally { process.env.CRCSYNC_CONTROL_INVARIANT = was; }
}

/** The exchange's violations, taken from whichever Strip is live (empty = the invariant holds). */
function problems(w, ex) {
  const t = ex.T(); const r = ex.R();
  const live = [t, r].find(s => s && s.state !== 'DROPPED' && s.coordination);
  if (!live) return [];
  const board = w.efsp.boardStoreFor(live === t ? 'CENTER' : 'INCIRLIK');
  return board.exchangeProblems(live.stripId);
}
const holds = (w, ex, label = '') => assert.deepEqual(problems(w, ex), [], `the control invariant holds ${label}`);

// ── I1: the transferring Strip is dropped ───────────────────────────────────────────────────────────────────────────

test('I1 transferring Strip dropped BEFORE ACCEPT: refused (an open proposal), nothing strands', () => {
  const w = world();
  const ex = ex0(w, 'I1A', { accept: false });
  const ack = asT(w, ex, DROP);
  assert.equal(ack.ok, false);
  assert.equal(ex.T().state, 'INBOUND');
  holds(w, ex);
});

test('I1 transferring Strip dropped AFTER ACCEPT: control and comms both move to the receiver, with a warning and one entry', () => {
  const w = world();
  const ex = ex0(w, 'I1B');
  const mark = log(w).length;
  const ack = asT(w, ex, DROP);
  assert.equal(ack.ok, true);
  assert.equal(ex.T().state, 'DROPPED');
  assert.match(ack.warning || '', /communications moved to AP by the drop/);
  const co = ex.R().coordination;
  assert.equal(co.comms.transferred, true);
  assert.equal(co.comms.trigger, 'TRANSFERRING_RETIRED');
  assert.equal(co.control.holder, 'RECEIVING');
  assert.equal(co.control.trigger, 'TRANSFERRING_RETIRED');
  assert.deepEqual(co.separationResponsibilityRef, { facilityId: 'INCIRLIK', positionId: 'AP' });
  holds(w, ex, 'after the drop');
  const dropEntry = log(w).slice(mark).find(e => e.op === 'DropStrip');
  assert.deepEqual(dropEntry.control, { trigger: 'TRANSFERRING_RETIRED' });
  assert.deepEqual(dropEntry.comms, { transferred: true, trigger: 'TRANSFERRING_RETIRED' });
  assert.equal(log(w).slice(mark).filter(e => e.op === 'InterfacilityCoordinationResponse').length, 1, 'one mirror on the receiver Board');
  assert.equal(repairs(w).length, 0, 'the primary mechanism did it, not the safety net');
});

test('I1 transferring Strip dropped AFTER comms moved: only control moves, no warning', () => {
  const w = world();
  const ex = ex0(w, 'I1C');
  mustR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  const ack = mustT(w, ex, DROP);
  assert.equal(ack.warning, undefined);
  assert.equal(ex.R().coordination.control.holder, 'RECEIVING');
  assert.equal(ex.R().coordination.control.trigger, 'TRANSFERRING_RETIRED');
  assert.equal(ex.R().coordination.comms.trigger, undefined, 'comms were already the receiver\'s');
  holds(w, ex);
});

test('I1 transferring Strip dropped AFTER control moved: nothing to move, no entry', () => {
  const w = world();
  const ex = ex0(w, 'I1D');
  mustT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  const mark = log(w).length;
  mustT(w, ex, DROP);
  // comms were still with the transferring side, so only comms move
  assert.equal(ex.R().coordination.comms.transferred, true);
  const w2 = world();
  const ex2 = ex0(w2, 'I1E');
  mustT(w2, ex2, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  mustT(w2, ex2, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  const mark2 = log(w2).length;
  mustT(w2, ex2, DROP);
  assert.equal(log(w2).slice(mark2).filter(e => e.source === 'peer').length, 0, 'nothing held, nothing moved, no mirror');
  holds(w2, ex2);
  assert.ok(mark >= 0);
});

// ── I2: the receiver drops its replica ──────────────────────────────────────────────────────────────────────────────

test('I2 receiver drops its replica after ACCEPT / after comms / after control moved: what it held goes back, the exchange ends', () => {
  const cases = [
    { name: 'after ACCEPT', steps: [], returned: undefined },
    { name: 'after comms', steps: [{ kind: 'HANDOFF', action: 'TRANSFER_COMMS' }], returned: ['comms'] },
    { name: 'after control', steps: [{ kind: 'HANDOFF', action: 'TRANSFER_CONTROL' }], returned: ['control'] },
    { name: 'after both', steps: [{ kind: 'HANDOFF', action: 'TRANSFER_COMMS' }, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' }], returned: ['comms', 'control'] },
  ];
  for (const k of cases) {
    const w = world();
    const ex = ex0(w, 'I2');
    for (const step of k.steps) mustT(w, ex, step);
    mustR(w, ex, DROP);
    assert.equal(ex.R().state, 'DROPPED');
    assert.equal(ex.T().coordination, null, `${k.name}: the exchange ends on the proposer's Strip`);
    assert.equal(ex.T().state, 'INBOUND', `${k.name}: the proposer's Strip is live and is the flight's`);
    holds(w, ex, k.name);
    const end = log(w).filter(e => e.op === 'SystemCoordinationEnd').pop();
    assert.deepEqual(end.control && end.control.returned, k.returned, k.name);
    if (k.returned) assert.equal(end.control.trigger, 'RECEIVING_RETIRED');
  }
});

// ── I3 / I4: joined away, archived ──────────────────────────────────────────────────────────────────────────────────

test('I3 a transferring Strip retired by any path (the join of SJ-S calls the same retire) while holding control', () => {
  const w = world();
  const ex = ex0(w, 'I3');
  const T = ex.T();
  const result = w.efsp.boardStoreFor('CENTER')._stripOps.retire(T, 'tester'); // what JoinFormation calls with endReason 'JOINED'
  assert.equal(result.ok, true);
  assert.equal(ex.R().coordination.control.holder, 'RECEIVING');
  assert.equal(ex.R().coordination.comms.transferred, true);
  holds(w, ex);
});

test('I4 a transferring Strip archived while the exchange is ACTIVE, and the mission-change variant', () => {
  for (const variant of ['sweep', 'missionChange']) {
    const w = world();
    const ex = ex0(w, 'I4');
    const T = ex.T();
    // A DROPPED Strip that reached it without the retire path (a refused TOFI's minted Strip, a SetState on an old build):
    T.state = 'DROPPED';
    const board = w.efsp.boardStoreFor('CENTER');
    board.droppedWallAtOf(T.stripId);
    if (variant === 'sweep') board.archiveStrip(T.stripId, 'AGE');
    else w.efsp.archiver.onMissionSessionChange({ seq: 2, reason: 'test' });
    assert.equal(board.getStrip(T.stripId), null, 'archived');
    assert.equal(ex.R().coordination.control.holder, 'RECEIVING', `${variant}: the receiver holds control`);
    assert.equal(ex.R().coordination.comms.transferred, true, `${variant}: and comms`);
    holds(w, ex, variant);
  }
});

// ── I5: a Position signs off while owning an exchange Strip ─────────────────────────────────────────────────────────

test('I5 sign-off with a covering Position: the Strip follows consolidation to a staffed Position; nothing is repaired', () => {
  const w = world();
  const ex = ex0(w, 'I5A');
  mustR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  mustR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  mustR(w, ex, { kind: 'TransferStrip', toPositionId: 'LC', bayId: 'lc-coordination', rackId: 'main' });
  hold(w.efsp, w.c.LC.session, 'INCIRLIK', []);
  assert.equal(ex.R().ownerPositionId, 'AP');
  holds(w, ex);
  assert.equal(repairs(w).length, 0);
  assert.equal(ex.R().coordination.separationResponsibilityRef.positionId, 'AP');
});

test('I5 sign-off with nobody to cover: the sign-off is not blocked; the holder moves to the live, staffed side and both panels say so', () => repairMode(() => {
  const w = world();
  const ex = ex0(w, 'I5B');
  mustR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  mustR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  assert.deepEqual(holders(ex), { comms: 'RECEIVING', control: 'RECEIVING', ref: { facilityId: 'INCIRLIK', positionId: 'AP' } });
  const ack = hold(w.efsp, w.c.AP.session, 'INCIRLIK', []); // AP has no consolidation: nobody covers it
  assert.ok(ack, 'the sign-off went through');
  assert.deepEqual(holders(ex), { comms: 'TRANSFERRING', control: 'TRANSFERRING', ref: { facilityId: 'CENTER', positionId: 'CTR' } });
  holds(w, ex, 'after the repair');
  const r = repairs(w);
  assert.equal(r.length, 2, 'every repair is its own Mutation-log entry (comms and control)');
  assert.deepEqual(r.map(e => e.axis).sort(), ['comms', 'control']);
  assert.ok(r.every(e => e.repaired === true && e.from === 'RECEIVING' && e.to === 'TRANSFERRING' && e.actorId === 'system'));
  // The alert, on both Facilities' panels, naming the flight and what moved:
  const monitor = new ForwardingObligationMonitor({ boardStoreFor: w.efsp.boardStoreFor, flightDataStore: w.efsp.flightDataStore, facilityConfig, airspaceStore: w.efsp.airspaceStore });
  monitor.tick();
  const repaired = monitor.getAll().filter(o => o.obligationType === 'CONTROL_REPAIRED');
  assert.deepEqual(repaired.map(o => o.facilityId).sort(), ['CENTER', 'INCIRLIK']);
  assert.equal(ex.T().coordination.repair.from, 'RECEIVING');
  assert.ok(ex.T().coordination.repair.why.includes('AP'));
  // The notice stands until the holders next move.
  hold(w.efsp, w.c.AP.session, 'INCIRLIK', ['AP']);
  monitor.tick();
  assert.equal(monitor.getAll().filter(o => o.obligationType === 'CONTROL_REPAIRED').length, 2, 'still shown after the Position is staffed again');
  mustR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  monitor.tick();
  assert.equal(monitor.getAll().filter(o => o.obligationType === 'CONTROL_REPAIRED').length, 0, 'a controller\'s own move ends the notice');
}));

test('I5 sign-off where NO repair is possible: the CONTROL_UNCOVERED alert persists on both panels until someone signs on', () => repairMode(() => {
  const w = world();
  const ex = ex0(w, 'I5C');
  const monitor = new ForwardingObligationMonitor({ boardStoreFor: w.efsp.boardStoreFor, flightDataStore: w.efsp.flightDataStore, facilityConfig, airspaceStore: w.efsp.airspaceStore });
  const uncovered = () => monitor.getAll().filter(o => o.obligationType === 'CONTROL_UNCOVERED');
  monitor.tick();
  assert.equal(uncovered().length, 0, 'staffed: nothing to say');
  hold(w.efsp, w.c.AP.session, 'INCIRLIK', []);
  hold(w.efsp, w.c.CTR.session, 'CENTER', []); // both sides unstaffed, the transferring side holds both
  assert.ok(problems(w, ex).length > 0, 'the invariant cannot hold: nobody is there');
  assert.ok(repairs(w).some(e => e.repaired === false), 'the failed repair is audited too');
  monitor.tick();
  assert.deepEqual(uncovered().map(o => o.facilityId).sort(), ['CENTER', 'INCIRLIK'], 'on both Facilities\' panels');
  assert.ok(uncovered().every(o => o.severity === 'OVERDUE'), 'in the attention colour');
  // It is a standing state: ticks and unrelated Mutations do not clear it.
  for (let i = 0; i < 3; i++) monitor.tick();
  assert.equal(uncovered().length, 2, 'still there after more ticks');
  const w2 = { efsp: w.efsp }; // an unrelated sign-on elsewhere does not clear it either
  hold(w2.efsp, w.c.OPS.session, 'INCIRLIK', ['OPS']);
  monitor.tick();
  assert.equal(uncovered().length, 2);
  // Someone signs on: it clears.
  hold(w.efsp, w.c.CTR.session, 'CENTER', ['CTR']);
  monitor.tick();
  assert.equal(uncovered().length, 0, 'cleared once a Position is staffed');
}));

// ── I6: marks toward an unstaffed receiver ──────────────────────────────────────────────────────────────────────────

test('I6 TRANSFER_COMMS / TRANSFER_CONTROL / a FULL grant toward an unstaffed receiver: NOT_STAFFED, nothing moves', () => {
  const w = world();
  const ex = ex0(w, 'I6');
  hold(w.efsp, w.c.AP.session, 'INCIRLIK', []);
  const before = JSON.stringify(ex.T().coordination);
  for (const op of [{ kind: 'HANDOFF', action: 'TRANSFER_COMMS' }, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' }]) {
    const ack = asT(w, ex, op);
    assert.equal(ack.ok, false);
    assert.equal(ack.reason, 'NOT_STAFFED', op.action);
  }
  assert.equal(JSON.stringify(ex.T().coordination), before, 'nothing moved');
  holds(w, ex);
  hold(w.efsp, w.c.AP.session, 'INCIRLIK', ['AP']);
  mustT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
});

// ── I7: WITHDRAW ────────────────────────────────────────────────────────────────────────────────────────────────────

test('I7 WITHDRAW before control moved changes no holder; after control moved it is refused', () => {
  const w = world();
  const ex = ex0(w, 'I7');
  mustT(w, ex, grantFull);
  const before = holders(ex);
  mustT(w, ex, { kind: 'ControlRelease', action: 'WITHDRAW' });
  assert.deepEqual(holders(ex), before);
  holds(w, ex);
  mustT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  const ack = asT(w, ex, { kind: 'ControlRelease', action: 'WITHDRAW' });
  assert.equal(ack.ok, false);
  holds(w, ex);
});

// ── I8: undo ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('I8 a restored record that names a retired holder is a violation the undo executor must refuse (UNDO_BLOCKED)', () => {
  const w = world();
  const ex = ex0(w, 'I8');
  mustT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  const beforeImage = JSON.parse(JSON.stringify(ex.T().coordination)); // what an undo of the drop would restore on T
  mustR(w, ex, DROP);                                                  // the receiver (the holder) retires
  assert.equal(ex.T().coordination, null);
  const T = ex.T();
  T.coordination = beforeImage;                                        // the restore of a before-image naming the retired holder
  const found = w.efsp.boardStoreFor('CENTER').exchangeProblems(T.stripId);
  assert.ok(found.length > 0, 'exchangeProblems names the retired holder');
  assert.throws(() => w.efsp.boardStoreFor('CENTER')._control.assertControlInvariant(T), /control invariant/);
  T.coordination = null;
});

test.todo('I8 undo of a mark, and undo of the drop that caused TRANSFERRING_RETIRED (Strip and holders back together): needs the UNDO-S executor');

test('I8 the executor refuses a restore while the exchange has nobody covering it (exchangeProblems, CONTROL_UNCOVERED): UNDO_BLOCKED', () => repairMode(() => {
  const wallClock = fakeWallClock();
  const w = world({ wallClock });
  const ex = ex0(w, 'I8U');
  const ack = asT(w, ex, DROP); // the replica holds both
  hold(w.efsp, w.c.AP.session, 'INCIRLIK', []); // AP leaves, nobody covers, and the dropped proposer cannot take them: unrepairable
  assert.ok(problems(w, ex).length > 0, 'the standing alert');
  const blocked = asT(w, ex, { kind: 'Undo', actionId: ack.undoable.actionId });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'UNDO_BLOCKED');
  assert.match(blocked.detail, /nobody covering/);
  assert.equal(ex.T().state, 'DROPPED', 'nothing restored');
  hold(w.efsp, w.c.AP.session, 'INCIRLIK', ['AP']); // someone signs on: the exchange is whole again, and the undo goes through
  assert.equal(asT(w, ex, { kind: 'Undo', actionId: ack.undoable.actionId }).ok, true);
  holds(w, ex);
}));

test('I8 controlInvariantRefusal reads ADR 0101\'s holder fields: a retired or unstaffed holder blocks, a retired side holding nothing does not', () => {
  const link = (over) => ({
    primitive: 'HANDOFF', state: 'ACTIVE', peerFacilityId: 'CENTER', peerStripId: 'T1', mintedForCoordination: true,
    comms: { transferred: true }, control: { holder: 'RECEIVING' }, separationResponsibilityRef: { facilityId: 'INCIRLIK', positionId: 'AP' }, ...over,
  });
  const image = (coordination) => [{ facilityId: 'INCIRLIK', stripId: 'R1', strip: { stripId: 'R1', state: 'INBOUND', ownerPositionId: 'AP', coordination } }];
  const envFor = ({ peer, apCovered = true }) => ({
    boardFor: (f) => (f === 'CENTER'
      ? { getStrip: () => peer, stripOwnerCovered: () => true }
      : { getStrip: () => ({ stripId: 'R1', state: 'INBOUND', ownerPositionId: 'AP' }), stripOwnerCovered: () => apCovered }),
  });
  const T = (state, owner = 'CTR') => ({ stripId: 'T1', state, ownerPositionId: owner });
  const cases = [
    ['receiver holds both, proposer retired', link(), { peer: T('DROPPED') }, null],
    ['proposer holds comms and is retired', link({ comms: { transferred: false } }), { peer: T('DROPPED') }, /communications holder/],
    ['proposer holds control and is gone', link({ control: { holder: 'TRANSFERRING' }, separationResponsibilityRef: { facilityId: 'CENTER', positionId: 'CTR' } }), { peer: null }, /control holder/],
    ['receiver holds both and AP is not staffed', link(), { peer: T('INBOUND'), apCovered: false }, /not staffed/],
    ['control Position moved on the Strip not restored', link({ control: { holder: 'TRANSFERRING' }, comms: { transferred: false }, separationResponsibilityRef: { facilityId: 'CENTER', positionId: 'CTR' } }), { peer: T('INBOUND', 'CTR2') }, /control Position/],
    ['all live and staffed', link(), { peer: T('INBOUND') }, null],
    ['an INITIATED proposal needs its peer live', link({ state: 'INITIATED' }), { peer: T('DROPPED') }, /retired/],
  ];
  for (const [name, coordination, env, expected] of cases) {
    const r = controlInvariantRefusal(envFor(env), image(coordination), new Map());
    if (!expected) assert.equal(r, null, name);
    else { assert.equal(r && r.reason, 'UNDO_BLOCKED', name); assert.match(r.detail, expected, name); }
  }
});

// ── I10: restart ────────────────────────────────────────────────────────────────────────────────────────────────────

test('I10 restart: a snapshot whose record names a retired holder is repaired with an entry; a clean snapshot is untouched', () => {
  const w = world();
  const ex = ex0(w, 'I10');
  mustT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  const R = ex.R();
  R.state = 'DROPPED'; // the receiver's Strip is retired but the proposer's record still says it holds control
  w.efsp.boardStoreFor('INCIRLIK').droppedWallAtOf(R.stripId);
  w.efsp.persist();
  const tId = ex.T().stripId;
  const w2 = repairMode(() => ({ efsp: createEfsp() }));
  const T = w2.efsp.boardStoreFor('CENTER').getStrip(tId);
  assert.equal(T.coordination.control.holder, 'TRANSFERRING', 'control is back with the live side');
  assert.equal(T.coordination.control.trigger, 'REPAIR');
  const entries = w2.efsp.mutationLog.readAll().filter(e => e.op === 'InterfacilityControlRepair' && e.stripId === tId && e.source !== 'peer');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].repaired, true);
  assert.equal(entries[0].axis, 'control');
  assert.ok(T.coordination.repair, 'and the standing notice is set, which the alert reads');
  // A clean snapshot is untouched: nothing at a restart repairs a healthy exchange, staffed or not.
  const clean = world();
  const cx = ex0(clean, 'I10B');
  mustT(clean, cx, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  clean.efsp.persist();
  const cid = cx.R().stripId;
  const before = JSON.stringify(clean.efsp.boardStoreFor('INCIRLIK').getStrip(cid).coordination);
  const restarted = createEfsp();
  assert.equal(JSON.stringify(restarted.boardStoreFor('INCIRLIK').getStrip(cid).coordination), before);
  assert.equal(restarted.mutationLog.readAll().filter(e => e.op === 'InterfacilityControlRepair' && e.stripId === cx.T().stripId).length, 0);
});

// ── I11: the bounded exhaustive walk ────────────────────────────────────────────────────────────────────────────────

const ACTIONS = {
  ACCEPT:      (w, ex) => ex.R() && ex.R().state !== 'DROPPED' && asR(w, ex, { kind: 'HANDOFF', action: 'ACCEPT' }),
  COMMS:       (w, ex) => ex.R() && ex.R().state !== 'DROPPED' && asR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' }),
  CONTROL:     (w, ex) => ex.T().state !== 'DROPPED' && asT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' }),
  GRANT_FULL:  (w, ex) => ex.T().state !== 'DROPPED' && asT(w, ex, grantFull),
  WITHDRAW:    (w, ex) => ex.T().state !== 'DROPPED' && asT(w, ex, { kind: 'ControlRelease', action: 'WITHDRAW' }),
  DROP_T:      (w, ex) => ex.T().state !== 'DROPPED' && asT(w, ex, DROP),
  DROP_R:      (w, ex) => ex.R() && ex.R().state !== 'DROPPED' && asR(w, ex, DROP),
  SIGNOFF_T:   (w) => hold(w.efsp, w.c.CTR.session, 'CENTER', []),
  SIGNOFF_R:   (w) => hold(w.efsp, w.c.AP.session, 'INCIRLIK', []),
  SIGNON_T:    (w) => hold(w.efsp, w.c.CTR.session, 'CENTER', ['CTR']),
  SIGNON_R:    (w) => hold(w.efsp, w.c.AP.session, 'INCIRLIK', ['AP']),
};
const NAMES = Object.keys(ACTIONS);

function signature(w, ex) {
  const side = (s) => (s ? { state: s.state, owner: s.ownerPositionId, co: s.coordination && {
    st: s.coordination.state, comms: s.coordination.comms && s.coordination.comms.transferred,
    ctl: s.coordination.control && s.coordination.control.holder, ref: s.coordination.separationResponsibilityRef && s.coordination.separationResponsibilityRef.positionId,
    rel: s.coordination.release ? [s.coordination.release.scopes.join(), !!s.coordination.release.withdrawnAt] : null, rep: !!s.coordination.repair } } : null);
  return JSON.stringify([side(ex.T()), side(ex.R()), w.efsp.positionStoreFor('CENTER').isStaffed('CTR'), w.efsp.positionStoreFor('INCIRLIK').isStaffed('AP')]);
}

/** After a step: the invariant holds, or it cannot (no live, staffed side exists to hold what is uncovered). */
function checkInvariant(w, ex, path) {
  const t = ex.T(); const r = ex.R();
  const live = [t, r].find(s => s && s.state !== 'DROPPED' && s.coordination && s.coordination.state === 'ACTIVE' && s.coordination.control);
  if (!live) return;
  const here = live === t ? 'CENTER' : 'INCIRLIK';
  const found = w.efsp.boardStoreFor(here).exchangeProblems(live.stripId);
  for (const p of found) {
    const otherLiveCovered = [[t, 'CENTER'], [r, 'INCIRLIK']].some(([s, f]) => s && s.state !== 'DROPPED' && w.efsp.boardStoreFor(f).stripOwnerCovered(s.stripId)
      && ((p.side === 'TRANSFERRING') === (s === r)));
    assert.equal(otherLiveCovered, false, `[${path.join(' > ')}] ${p.axis} held by ${p.side} (${p.why}) while the other side could take it`);
  }
  if (found.length === 0) return;
}

function run(path) {
  const w = world();
  const ex = ex0(w, 'WALK', { accept: false });
  let repairCount = 0;
  let seenRepairs = 0; // counted as they are recorded: re-reading the whole log file per step is what made the walk slow
  w.efsp.mutationLog.onRecord((e) => { if (e.op === 'InterfacilityControlRepair' && e.source !== 'peer') seenRepairs += 1; });
  let staffingChanged = false; // once a Position has signed off, a later step can meet an uncovered holder it did not cause
  path.forEach((name, i) => {
    ACTIONS[name](w, ex);
    checkInvariant(w, ex, path.slice(0, i + 1));
    if (name.startsWith('SIGN')) staffingChanged = true;
    if (!staffingChanged) assert.equal(seenRepairs, repairCount, `[${path.slice(0, i + 1).join(' > ')}] only a change of staffing needs the safety net`);
    repairCount = seenRepairs;
  });
  return { w, ex };
}

test('I11 bounded exhaustive walk: every sequence of up to 4 steps of ACCEPT, comms, control, FULL, WITHDRAW, drops and staffing keeps the invariant', () => repairMode(() => {
  // Breadth first, one representative per distinct state (a sequence reaching a state already seen adds nothing new at
  // the same depth). Every refused step leaves the invariant holding, and so is checked like any other.
  const seen = new Set();
  let frontier = [[]];
  let sequences = 0;
  for (let depth = 1; depth <= 4; depth++) {
    const next = [];
    for (const path of frontier) {
      for (const name of NAMES) {
        const p = [...path, name];
        sequences += 1;
        const { w, ex } = run(p);
        const sig = signature(w, ex) + `|${depth}`;
        const stateOnly = signature(w, ex);
        if (!seen.has(stateOnly)) { seen.add(stateOnly); next.push(p); }
        void sig;
      }
    }
    frontier = next;
  }
  assert.ok(sequences > 100, `walked ${sequences} sequences over ${seen.size} distinct states`);
  console.log(`# I11 walked ${sequences} sequences over ${seen.size} distinct states`);
}));
