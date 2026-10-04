import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { prologue, makeWorld, exchange, holders, fakeWallClock } from './helpers/control-release-fixture.mjs';

// The control invariant (docs/adr/0101, H100 DR-6): a live flight never has nobody holding comms and control. One scenario
// per path of the ADR's table; each asserts the invariant after every step (CRCSYNC_CONTROL_INVARIANT=throw makes a
// violation throw, so a path that would break it fails loudly). The bounded exhaustive walk (I11) is at the end.

prologue('control-release-inv-');
const { createEfsp } = await import('../src/efsp/index.js');
const facilityConfig = (await import('../src/efsp/facility-config.js')).createFacilityConfig();
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
  assert.deepEqual(ack.warnings.map(w => w.code), ['COMMS_MOVED_BY_DROP']);
  assert.match(ack.warnings[0].detail, /communications moved to AP by the drop/);
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
  assert.equal(ack.warnings, undefined);
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

/** An ARRIVAL AP originates in its inbound Bay: a formation lead (or joiner) on the receiving Board. */
const apArrival = (w, callsign) => mustAct(w.efsp, w.c.AP, 'AP', null, {
  kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL',
  flightData: { callsign, aircraftType: 'C130', wakeCategory: 'M', originAirport: 'LTAC' },
});
const joinOp = (lead) => ({ kind: 'JoinFormation', leadStripId: lead.stripId, leadBaseRev: lead.rev });

test('I3 JoinFormation and a HANDOFF: a joiner whose exchange is live is refused; a replica holding both joins through retire() and the invariant holds', () => {
  const wallClock = fakeWallClock();
  const w = world({ wallClock });
  const ex = ex0(w, 'I3J');
  mustR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  const lead = apArrival(w, 'I3L');
  // While the transferring Strip is live the flight has two live Strips: the join is refused and nothing moves.
  const before = JSON.stringify([ex.T().coordination, ex.R().coordination]);
  const refusedJoin = asR(w, ex, joinOp(lead));
  assert.equal(refusedJoin.ok, false);
  assert.match(refusedJoin.detail, /another live Strip/);
  assert.equal(JSON.stringify([ex.T().coordination, ex.R().coordination]), before);
  holds(w, ex, 'after the refused join');
  // The transferring Strip drops (control moves to the replica, TRANSFERRING_RETIRED); the replica then joins the lead.
  mustT(w, ex, DROP);
  assert.deepEqual(holders(ex), { comms: 'RECEIVING', control: 'RECEIVING', ref: { facilityId: 'INCIRLIK', positionId: 'AP' } });
  const leadNow = w.efsp.boardStoreFor('INCIRLIK').getStrip(lead.stripId);
  const joined = asR(w, ex, joinOp(leadNow)); // CRCSYNC_CONTROL_INVARIANT=throw: the assertion after retire() throws on a violation
  assert.equal(joined.ok, true, JSON.stringify(joined));
  assert.equal(ex.R().state, 'DROPPED');
  assert.equal(ex.R().endReason, 'JOINED');
  assert.equal(ex.T().coordination, null, 'the replica retired through retire(): the proposer\'s link ends (U7)');
  holds(w, ex, 'after the join');
  assert.equal(repairs(w).length, 0, 'nothing for the safety net');
  // Undone: the replica is back holding both, beside the dropped proposer that holds nothing (not UNDO_BLOCKED).
  const undone = asR(w, ex, { kind: 'Undo', actionId: joined.undoable.actionId });
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(ex.R().state, 'INBOUND');
  assert.equal(ex.R().coordination.control.holder, 'RECEIVING');
  assert.equal(ex.T().coordination.state, 'ACTIVE', 'the proposer\'s link is back too');
  holds(w, ex, 'after the undo of the join');
});

test('I3 a lead in an ACTIVE HANDOFF absorbs a joiner: its exchange record and holders are unchanged and the invariant is asserted', () => {
  const w = world();
  const ex = ex0(w, 'I3K');
  mustR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  const holdersBefore = holders(ex);
  const joiner = apArrival(w, 'I3M');
  const ack = act(w.efsp, w.c.AP, 'AP', joiner, joinOp(ex.R()));
  assert.equal(ack.ok, true, JSON.stringify(ack));
  assert.deepEqual(holders(ex), holdersBefore);
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

test('I5 sign-off with a staffed Position offered the hat: the Strip stays, the Position counts as covered; nothing is repaired (docs/adr/0110)', () => {
  const w = world();
  const ex = ex0(w, 'I5A');
  mustR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  mustR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  mustR(w, ex, { kind: 'TransferStrip', toPositionId: 'LC', bayId: 'lc-coordination', rackId: 'main' });
  hold(w.efsp, w.c.LC.session, 'INCIRLIK', []);
  assert.equal(ex.R().ownerPositionId, 'LC');
  holds(w, ex);
  assert.equal(repairs(w).length, 0);
  assert.equal(ex.R().coordination.separationResponsibilityRef.positionId, 'LC');
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

test('I8 undo of a mark: both Strips\' records and the holders go back together, and the invariant holds', () => {
  const wallClock = fakeWallClock();
  const w = world({ wallClock });
  const ex = ex0(w, 'I8M');
  mustR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  const ack = asT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  assert.deepEqual(holders(ex), { comms: 'RECEIVING', control: 'RECEIVING', ref: { facilityId: 'INCIRLIK', positionId: 'AP' } });
  const undone = asT(w, ex, { kind: 'Undo', actionId: ack.undoable.actionId });
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.deepEqual(holders(ex), { comms: 'RECEIVING', control: 'TRANSFERRING', ref: { facilityId: 'CENTER', positionId: 'CTR' } });
  holds(w, ex, 'after the undo');
});

test('I8 undo of the drop that caused TRANSFERRING_RETIRED: the Strip and the holders come back together', () => {
  const wallClock = fakeWallClock();
  const w = world({ wallClock });
  const ex = ex0(w, 'I8D');
  const before = { T: JSON.stringify(ex.T().coordination), R: JSON.stringify(ex.R().coordination) };
  const ack = asT(w, ex, DROP);
  assert.equal(ack.ok, true);
  assert.equal(ack.undoable.label, 'Drop I8D', 'the drop is undoable: its scope holds the receiving Strip it hands the holders to');
  assert.equal(ex.R().coordination.control.trigger, 'TRANSFERRING_RETIRED');
  const undone = asT(w, ex, { kind: 'Undo', actionId: ack.undoable.actionId });
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(ex.T().state, 'INBOUND');
  assert.equal(JSON.stringify(ex.T().coordination), before.T);
  assert.equal(JSON.stringify(ex.R().coordination), before.R, 'the receiving Strip no longer holds what the drop gave it');
  assert.deepEqual(holders(ex), { comms: 'TRANSFERRING', control: 'TRANSFERRING', ref: { facilityId: 'CENTER', positionId: 'CTR' } });
  holds(w, ex, 'after the undo');
});

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

test('I8 HandoffControl writes reach the undo history: a repair after a mark touches both Strips and blocks its undo as a system change', () => repairMode(() => {
  const wallClock = fakeWallClock();
  const w = world({ wallClock });
  const ex = ex0(w, 'I8R');
  const ack = asT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  const revs = { T: ex.T().rev, R: ex.R().rev };
  hold(w.efsp, w.c.AP.session, 'INCIRLIK', []); // AP leaves with nobody to cover: control is repaired back to CTR
  assert.equal(ex.T().coordination.control.trigger, 'REPAIR');
  assert.ok(ex.T().rev > revs.T && ex.R().rev > revs.R, `both halves of the repair are bumped (T ${revs.T}->${ex.T().rev}, R ${revs.R}->${ex.R().rev})`);
  const blocked = asT(w, ex, { kind: 'Undo', actionId: ack.undoable.actionId });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'UNDO_BLOCKED');
  assert.match(blocked.detail, /system change/);
  assert.equal(ex.T().coordination.control.trigger, 'REPAIR', 'the undo did not move the record back over the repair');
  holds(w, ex);
}));

test('I8 a FULL release settled by a control Block write that is then refused is bumped and blocks an open undo of that Strip', () => {
  const wallClock = fakeWallClock();
  const clock = { t: Date.now(), source: 'test', now: () => clock.t };
  const w = world({ wallClock, clock });
  const ex = ex0(w, 'I8S');
  mustT(w, ex, { kind: 'ControlRelease', action: 'GRANT', scopes: ['FULL'], effectiveAt: clock.t + 60_000 });
  const comms = asT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' }); // comms at CENTER, after the grant: undoable
  assert.equal(ex.T().coordination.control.holder, 'TRANSFERRING', 'the release is not due yet');
  clock.t += 120_000; // due: the first control check settles it (ADR 0101 decision 4)
  const rev = ex.T().rev;
  const write = asT(w, ex, { kind: 'SetBlock', blockId: '7', value: 'NOT AN ALTITUDE' });
  assert.equal(write.ok, false, 'the write itself is refused');
  assert.equal(ex.T().coordination.control.holder, 'RECEIVING', 'but the due release moved control');
  assert.ok(ex.T().rev > rev, 'the settle is a change of its own (bumped)');
  const undo = asT(w, ex, { kind: 'Undo', actionId: comms.undoable.actionId });
  assert.equal(undo.ok, false);
  assert.equal(undo.reason, 'UNDO_BLOCKED');
  assert.match(undo.detail, /SetBlock \(refused\)/);
  assert.equal(ex.T().coordination.control.holder, 'RECEIVING', 'the undo never reverts over the settle');
  holds(w, ex);
});

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
  // The last undoable action, undone by the Position that made it (docs/adr/0100; ADR 0101 I8). Refused once its window or
  // its record is gone, or when a later change blocks it; either way the invariant must still hold.
  UNDO_LAST:   (w, ex) => w.lastUndoable && act(w.efsp, w.c[w.lastUndoable.positionId], w.lastUndoable.positionId,
    w.lastUndoable.positionId === 'CTR' ? ex.T() : ex.R(), { kind: 'Undo', actionId: w.lastUndoable.actionId }),
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

const ACTOR = { ACCEPT: 'AP', COMMS: 'AP', CONTROL: 'CTR', GRANT_FULL: 'CTR', WITHDRAW: 'CTR', DROP_T: 'CTR', DROP_R: 'AP' };

function run(path) {
  const w = world({ wallClock: fakeWallClock() }); // the wall clock stands still: every undo is inside its window
  const ex = ex0(w, 'WALK', { accept: false });
  let repairCount = 0;
  let seenRepairs = 0; // counted as they are recorded: re-reading the whole log file per step is what made the walk slow
  w.efsp.mutationLog.onRecord((e) => { if (e.op === 'InterfacilityControlRepair' && e.source !== 'peer') seenRepairs += 1; });
  let staffingChanged = false; // once a Position has signed off, a later step can meet an uncovered holder it did not cause
  path.forEach((name, i) => {
    const ack = ACTIONS[name](w, ex);
    if (ack && ack.ok && ack.undoable) w.lastUndoable = { actionId: ack.undoable.actionId, positionId: ACTOR[name] };
    checkInvariant(w, ex, path.slice(0, i + 1));
    if (name.startsWith('SIGN')) staffingChanged = true;
    if (!staffingChanged) assert.equal(seenRepairs, repairCount, `[${path.slice(0, i + 1).join(' > ')}] only a change of staffing needs the safety net`);
    repairCount = seenRepairs;
  });
  return { w, ex };
}

// Depth 3 is the default (`npm test`); the full depth-4 walk is opt-in: `npm run walk` (CRCSYNC_WALK_DEPTH=4).
const WALK_DEPTH = Number(process.env.CRCSYNC_WALK_DEPTH) || 3;

test(`I11 bounded exhaustive walk: every sequence of up to ${WALK_DEPTH} steps of ACCEPT, comms, control, FULL, WITHDRAW, drops, undo last and staffing keeps the invariant`, () => repairMode(() => {
  // Breadth first, one representative per distinct state (a sequence reaching a state already seen adds nothing new at
  // the same depth). Every refused step leaves the invariant holding, and so is checked like any other.
  const seen = new Set();
  let frontier = [[]];
  let sequences = 0;
  for (let depth = 1; depth <= WALK_DEPTH; depth++) {
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
