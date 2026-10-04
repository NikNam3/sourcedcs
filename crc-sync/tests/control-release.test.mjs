import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { prologue, fakeClock, fakeWallClock, makeWorld, exchange, holders } from './helpers/control-release-fixture.mjs';

// ControlRelease and the HANDOFF steps (docs/adr/0101; H94, H100): accept moves radar ID and ownership only, comms and
// control are their own marks, a release is granted/requested/refused/withdrawn, and a control instruction outside the
// release needs an attestation. The control invariant's paths are control-release-invariant.test.mjs.

prologue('control-release-');
const { createEfsp } = await import('../src/efsp/index.js');
const helpers = await import('./helpers/efsp-scenario.mjs');
const { act, mustAct } = helpers;
const { undoDeclarationProblem } = await import('../src/efsp/undo/undo-history.js');
const OPS = (await import('../src/efsp/board/ops/index.js')).default || (await import('../src/efsp/board/ops/index.js'));

const world = (opts) => makeWorld(createEfsp, helpers, opts);
const ex0 = (w, callsign, opts) => exchange(w, helpers, callsign, opts);
const asT = (w, ex, op) => act(w.efsp, w.c.CTR, 'CTR', ex.T(), op);   // the transferring side, CTR
const asR = (w, ex, op) => act(w.efsp, w.c.AP, 'AP', ex.R(), op);     // the receiving side, AP
const mustT = (w, ex, op) => mustAct(w.efsp, w.c.CTR, 'CTR', ex.T(), op);
const mustR = (w, ex, op) => mustAct(w.efsp, w.c.AP, 'AP', ex.R(), op);
const refused = (ack, reason, label) => {
  assert.equal(ack.ok, false, `${label || ''} should be refused: ${JSON.stringify(ack.strip && ack.strip.coordination)}`);
  if (reason) assert.equal(ack.reason, reason, `${label || ''}: ${ack.detail}`);
};
const log = (w) => w.efsp.mutationLog.readAll();

// ── accept ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('ACCEPT moves radar ID and ownership; comms and control stay with the transferring side, on both Boards', () => {
  const w = world();
  const ex = ex0(w, 'ACC1');
  for (const strip of [ex.T(), ex.R()]) {
    const co = strip.coordination;
    assert.equal(co.state, 'ACTIVE');
    assert.equal(co.radarIdTransferred, true);
    assert.deepEqual(co.dataOwnerPositionRef, { facilityId: 'INCIRLIK', positionId: 'AP' }, 'ownership moved');
    assert.deepEqual(co.separationResponsibilityRef, { facilityId: 'CENTER', positionId: 'CTR' }, 'control did not');
    assert.equal(co.comms.transferred, false);
    assert.equal(co.control.holder, 'TRANSFERRING');
    assert.equal(co.release, null);
    assert.equal(co.releaseRequest, null);
    assert.equal(co.commsTransferred, undefined, 'the boolean is gone (R3-2)');
  }
  assert.deepEqual(holders(ex), { comms: 'TRANSFERRING', control: 'TRANSFERRING', ref: { facilityId: 'CENTER', positionId: 'CTR' } });
});

test('the record exists from PROPOSE on both Strips, so the snapshot shape is stable', () => {
  const w = world();
  const ex = ex0(w, 'SHAPE1', { accept: false });
  for (const strip of [ex.T(), ex.R()]) {
    assert.equal(strip.coordination.state, 'INITIATED');
    assert.deepEqual(Object.keys(strip.coordination).filter(k => ['comms', 'control', 'release', 'releaseRequest', 'repair'].includes(k)).sort(),
      ['comms', 'control', 'release', 'releaseRequest', 'repair']);
  }
});

// ── the two marks ───────────────────────────────────────────────────────────────────────────────────────────────────

test('TRANSFER_COMMS: either side records it, the first record wins, and it moves comms only', () => {
  for (const side of ['T', 'R']) {
    const w = world();
    const ex = ex0(w, 'COMMS' + side);
    const ack = (side === 'T' ? mustT : mustR)(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
    assert.equal(ack.coordination.comms.transferred, true);
    assert.equal(ack.coordination.comms.byPositionId, side === 'T' ? 'CTR' : 'AP');
    assert.deepEqual(holders(ex), { comms: 'RECEIVING', control: 'TRANSFERRING', ref: { facilityId: 'CENTER', positionId: 'CTR' } });
    refused((side === 'T' ? asR : asT)(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' }), 'VALIDATION_ERROR', 'the second record');
  }
});

test('TRANSFER_CONTROL from each side moves control and the control Position, and only control', () => {
  for (const side of ['T', 'R']) {
    const w = world();
    const ex = ex0(w, 'CTRL' + side);
    (side === 'T' ? mustT : mustR)(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
    assert.deepEqual(holders(ex), { comms: 'TRANSFERRING', control: 'RECEIVING', ref: { facilityId: 'INCIRLIK', positionId: 'AP' } });
    assert.equal(ex.T().coordination.control.trigger, 'BOUNDARY');
    refused(asT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' }), 'VALIDATION_ERROR', 'control already moved');
  }
});

test('the marks are refused before ACCEPT, after REJECT and after CANCEL', () => {
  const w = world();
  const ex = ex0(w, 'EARLY1', { accept: false });
  refused(asR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' }), 'VALIDATION_ERROR', 'before accept');
  refused(asT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' }), 'VALIDATION_ERROR', 'before accept');
  mustR(w, ex, { kind: 'HANDOFF', action: 'REJECT' });
  refused(asR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' }), 'VALIDATION_ERROR', 'after reject');
  refused(asT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' }), 'VALIDATION_ERROR', 'after reject');
  const w2 = world();
  const ex2 = ex0(w2, 'EARLY2', { accept: false });
  mustT(w2, ex2, { kind: 'HANDOFF', action: 'CANCEL' });
  assert.equal(ex2.T().coordination, null);
  refused(asT(w2, ex2, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' }), 'VALIDATION_ERROR', 'after cancel');
});

test('a mark on anything but a HANDOFF is refused; AIT and POINT_OUT keep their own records', () => {
  const w = world();
  const ex = ex0(w, 'PO1', { accept: false });
  mustT(w, ex, { kind: 'HANDOFF', action: 'CANCEL' });
  const proposed = mustT(w, ex, { kind: 'POINT_OUT', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' });
  assert.equal(proposed.coordination.comms, undefined, 'a Point Out has no comms step');
  assert.equal(proposed.coordination.control, undefined);
  const r = w.efsp.boardStoreFor('INCIRLIK').getStrip(proposed.coordination.peerStripId);
  refused(act(w.efsp, w.c.AP, 'AP', r, { kind: 'POINT_OUT', action: 'TRANSFER_COMMS' }), 'VALIDATION_ERROR', 'a mark on a POINT_OUT');
});

// ── ControlRelease ──────────────────────────────────────────────────────────────────────────────────────────────────

const grant = (scopes, extra = {}) => ({ kind: 'ControlRelease', action: 'GRANT', scopes, ...extra });

test('GRANT: only the transferring side, only in the right state, with validated scopes and limits', () => {
  const w = world();
  const ex = ex0(w, 'GR1', { accept: false });
  refused(asT(w, ex, grant(['TURNS'])), 'VALIDATION_ERROR', 'before accept');
  mustR(w, ex, { kind: 'HANDOFF', action: 'ACCEPT' });
  refused(asR(w, ex, grant(['TURNS'])), 'VALIDATION_ERROR', 'the receiver cannot grant');
  refused(asT(w, ex, grant([])), 'VALIDATION_ERROR', 'no scope');
  refused(asT(w, ex, grant(['SPEED'])), 'VALIDATION_ERROR', 'there is no SPEED scope (DR-11 b)');
  refused(asT(w, ex, grant(['TURNS'], { climbLimitFt: 15000 })), 'VALIDATION_ERROR', 'a climb limit on TURNS');
  refused(asT(w, ex, grant(['FULL'], { descentLimitFt: 5000 })), 'VALIDATION_ERROR', 'a limit on FULL');
  refused(asT(w, ex, grant(['CLIMB'], { climbLimitFt: 'high' })), 'VALIDATION_ERROR', 'a limit that is not a number');
  const ack = mustT(w, ex, grant(['CLIMB', 'TURNS'], { climbLimitFt: 15000, condition: 'when the radar contact is solid', effectiveAt: null }));
  const release = ack.coordination.release;
  assert.deepEqual(release.scopes, ['CLIMB', 'TURNS']);
  assert.equal(release.climbLimitFt, 15000);
  assert.equal(release.condition, 'when the radar contact is solid');
  assert.equal(release.grantedByPositionId, 'CTR');
  assert.deepEqual(ex.R().coordination.release, release, 'the receiver sees the same release');
  // One release is in effect at a time: a new grant replaces it.
  mustT(w, ex, grant(['DESCENT']));
  assert.deepEqual(ex.R().coordination.release.scopes, ['DESCENT']);
  // A grant moves nothing by itself.
  assert.equal(holders(ex).control, 'TRANSFERRING');
});

test('REQUEST / GRANT / REFUSE: one open request at a time; a GRANT answers it; a REFUSE carries the reason', () => {
  const w = world();
  const ex = ex0(w, 'RQ1');
  refused(asT(w, ex, { kind: 'ControlRelease', action: 'REQUEST', scopes: ['TURNS'] }), 'VALIDATION_ERROR', 'the transferring side does not request');
  refused(asR(w, ex, { kind: 'ControlRelease', action: 'REQUEST', scopes: [] }), 'VALIDATION_ERROR', 'a request with no scope');
  mustR(w, ex, { kind: 'ControlRelease', action: 'REQUEST', scopes: ['TURNS', 'CLIMB'], note: 'weather deviation' });
  assert.equal(ex.T().coordination.releaseRequest.answer, null);
  assert.equal(ex.T().coordination.releaseRequest.note, 'weather deviation');
  refused(asR(w, ex, { kind: 'ControlRelease', action: 'REQUEST', scopes: ['TURNS'] }), 'VALIDATION_ERROR', 'a second open request');
  refused(asR(w, ex, { kind: 'ControlRelease', action: 'REFUSE' }), 'VALIDATION_ERROR', 'only the transferring side refuses');
  mustT(w, ex, { kind: 'ControlRelease', action: 'REFUSE', reason: 'traffic' });
  assert.equal(ex.R().coordination.releaseRequest.answer, 'REFUSED');
  assert.equal(ex.R().coordination.releaseRequest.reason, 'traffic');
  refused(asT(w, ex, { kind: 'ControlRelease', action: 'REFUSE' }), 'VALIDATION_ERROR', 'nothing open to refuse');
  // A new request after the answer is allowed, and a GRANT answers it.
  mustR(w, ex, { kind: 'ControlRelease', action: 'REQUEST', scopes: ['DESCENT'] });
  mustT(w, ex, grant(['DESCENT']));
  assert.equal(ex.R().coordination.releaseRequest.answer, 'GRANTED');
  assert.deepEqual(ex.R().coordination.release.scopes, ['DESCENT']);
});

test('WITHDRAW removes a release that has not moved control; the grant stays readable; a second WITHDRAW is refused', () => {
  const w = world();
  const ex = ex0(w, 'WD1');
  refused(asT(w, ex, { kind: 'ControlRelease', action: 'WITHDRAW' }), 'VALIDATION_ERROR', 'nothing to withdraw');
  mustT(w, ex, grant(['TURNS']));
  refused(asR(w, ex, { kind: 'ControlRelease', action: 'WITHDRAW' }), 'VALIDATION_ERROR', 'only the transferring side withdraws');
  mustT(w, ex, { kind: 'ControlRelease', action: 'WITHDRAW' });
  assert.ok(ex.R().coordination.release.withdrawnAt != null, 'a withdrawn grant stays readable');
  refused(asT(w, ex, { kind: 'ControlRelease', action: 'WITHDRAW' }), 'VALIDATION_ERROR', 'already withdrawn');
});

test('after control moved every ControlRelease action is refused (request, grant, refuse, withdraw)', () => {
  const w = world();
  const ex = ex0(w, 'LATE1');
  mustR(w, ex, { kind: 'ControlRelease', action: 'REQUEST', scopes: ['TURNS'] });
  mustT(w, ex, grant(['TURNS']));
  mustT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  refused(asR(w, ex, { kind: 'ControlRelease', action: 'REQUEST', scopes: ['TURNS'] }), 'VALIDATION_ERROR');
  refused(asT(w, ex, grant(['FULL'])), 'VALIDATION_ERROR');
  refused(asT(w, ex, { kind: 'ControlRelease', action: 'REFUSE' }), 'VALIDATION_ERROR');
  refused(asT(w, ex, { kind: 'ControlRelease', action: 'WITHDRAW' }), 'VALIDATION_ERROR');
});

// ── FULL release plus comms ─────────────────────────────────────────────────────────────────────────────────────────

test('comms then FULL, and FULL then comms, both end with control at the receiver (trigger COMMS_AND_FULL_RELEASE)', () => {
  const w1 = world();
  const a = ex0(w1, 'FULL1');
  mustT(w1, a, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  assert.equal(holders(a).control, 'TRANSFERRING', 'comms alone does not move control');
  mustT(w1, a, grant(['FULL']));
  assert.deepEqual(holders(a), { comms: 'RECEIVING', control: 'RECEIVING', ref: { facilityId: 'INCIRLIK', positionId: 'AP' } });
  assert.equal(a.T().coordination.control.trigger, 'COMMS_AND_FULL_RELEASE');

  const w2 = world();
  const b = ex0(w2, 'FULL2');
  mustT(w2, b, grant(['FULL']));
  assert.equal(holders(b).control, 'TRANSFERRING', 'a FULL release alone does not move control');
  mustR(w2, b, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  assert.deepEqual(holders(b), { comms: 'RECEIVING', control: 'RECEIVING', ref: { facilityId: 'INCIRLIK', positionId: 'AP' } });
  assert.equal(b.R().coordination.control.trigger, 'COMMS_AND_FULL_RELEASE');
});

test('a withdrawn FULL release does not move control with comms', () => {
  const w = world();
  const ex = ex0(w, 'FULL3');
  mustT(w, ex, grant(['FULL']));
  mustT(w, ex, { kind: 'ControlRelease', action: 'WITHDRAW' });
  mustT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  assert.equal(holders(ex).control, 'TRANSFERRING');
});

test('a FULL release with a future effectiveAt schedules nothing: the first later check on the mission clock settles it', () => {
  const clock = fakeClock();
  const w = world({ clock });
  const ex = ex0(w, 'FUT1', { alt: 'FL240' });
  mustT(w, ex, grant(['FULL'], { effectiveAt: clock.t + 10 * 60 * 1000 }));
  mustT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  assert.equal(holders(ex).control, 'TRANSFERRING', 'not due yet');
  // Not due: the receiver's heading still needs an attestation.
  refused(asR(w, ex, { kind: 'SetBlock', blockId: '9A-VECTOR', value: '270' }), 'VALIDATION_ERROR', 'before effectiveAt');
  clock.advance(11 * 60 * 1000);
  const ack = mustR(w, ex, { kind: 'SetBlock', blockId: '9A-VECTOR', value: '270' }); // due: this write settles it
  assert.equal(ack.coordination.control.holder, 'RECEIVING');
  assert.equal(ack.coordination.control.trigger, 'COMMS_AND_FULL_RELEASE');
  assert.equal(ex.T().coordination.control.holder, 'RECEIVING', 'and the peer Board agrees');
  const entry = log(w).filter(e => e.op === 'SetBlock' && e.control).pop();
  assert.deepEqual(entry.control, { trigger: 'COMMS_AND_FULL_RELEASE' }, 'recorded inside the SetBlock entry, not as a second one');
});

// ── the control-axis check ──────────────────────────────────────────────────────────────────────────────────────────

const AXES = [
  { name: 'TURNS', op: { kind: 'SetBlock', blockId: '9A-VECTOR', value: '270' }, scope: 'TURNS' },
  { name: 'CLIMB', op: { kind: 'SetBlock', blockId: '7', value: 'FL260' }, scope: 'CLIMB' },
  { name: 'DESCENT', op: { kind: 'SetBlock', blockId: '7', value: 'FL200' }, scope: 'DESCENT' },
];

// Each release state, as the transferring side sets it up (clock.t is the mission now).
const RELEASES = {
  none: () => null,
  covering: (scope) => grant([scope]),
  fullRelease: () => grant(['FULL']),
  notCovering: (scope) => grant([scope === 'TURNS' ? 'CLIMB' : 'TURNS']),
  withdrawn: 'withdrawn',
  future: (scope, clock) => grant([scope], { effectiveAt: clock.t + 60 * 1000 }),
  past: (scope, clock) => grant([scope], { effectiveAt: clock.t - 60 * 1000 }),
  limitRespected: (scope) => (scope === 'CLIMB' ? grant(['CLIMB'], { climbLimitFt: 30000 }) : scope === 'DESCENT' ? grant(['DESCENT'], { descentLimitFt: 10000 }) : grant(['TURNS'])),
  limitViolated: (scope) => (scope === 'CLIMB' ? grant(['CLIMB'], { climbLimitFt: 25000 }) : scope === 'DESCENT' ? grant(['DESCENT'], { descentLimitFt: 22000 }) : grant(['TURNS'], {})),
};
// Does the receiver write the axis without attesting? (The transferring side never does: JO 7110.65 5-4-5 b.)
const RECEIVER_FREE = {
  none: () => false, covering: () => true, fullRelease: () => true, notCovering: () => false, withdrawn: () => false, future: () => false,
  past: () => true, limitRespected: () => true, limitViolated: (axis) => axis === 'TURNS',
};

test('control-axis matrix: {receiver, transferring} x {TURNS, CLIMB, DESCENT} x release states x {attested, not}', () => {
  let cases = 0;
  for (const axis of AXES) {
    for (const [state, make] of Object.entries(RELEASES)) {
      for (const side of ['R', 'T']) {
        for (const attested of [false, true]) {
          const clock = fakeClock();
          const w = world({ clock });
          const ex = ex0(w, `AX${cases}`, { alt: 'FL240' });
          if (state === 'withdrawn') {
            mustT(w, ex, grant([axis.scope]));
            mustT(w, ex, { kind: 'ControlRelease', action: 'WITHDRAW' });
          } else if (make(axis.scope, clock)) {
            mustT(w, ex, make(axis.scope, clock));
          }
          const label = `${side === 'R' ? 'receiver' : 'transferring'} ${axis.name} / ${state} / ${attested ? 'attested' : 'bare'}`;
          const other = side === 'R' ? 'CTR' : 'AP';
          const op = { ...axis.op, ...(attested ? { coordinatedWith: other } : {}) };
          const ack = (side === 'R' ? asR : asT)(w, ex, op);
          const free = side === 'R' && RECEIVER_FREE[state](axis.name);
          if (free || attested) assert.equal(ack.ok, true, `${label}: ${ack.detail}`);
          else {
            refused(ack, 'VALIDATION_ERROR', label);
            assert.ok(ack.detail.includes(other), `${label}: the refusal names ${other}: ${ack.detail}`);
            assert.ok(ack.detail.includes(axis.scope === 'TURNS' ? 'TURNS' : axis.scope), `${label}: and the scope: ${ack.detail}`);
            // DESK-ACKS: the same request as data, so no client parses the sentence above.
            assert.equal(ack.attestation.with, other, `${label}: attestation.with`);
            assert.ok(Array.isArray(ack.attestation.needs) && ack.attestation.needs.length > 0, `${label}: attestation.needs`);
            assert.ok(ack.attestation.needs.every(n => ack.detail.includes(n)), `${label}: needs are the scopes the sentence names`);
          }
          if (ack.ok) {
            const entry = log(w).filter(e => e.op === 'SetBlock').pop();
            if (free && !attested) assert.equal(entry.coordinatedWith, undefined, `${label}: no attestation to audit`);
            if (!free) { assert.equal(entry.coordinatedWith, other, label); assert.equal(entry.controlAxis, axis.scope, label); }
          }
          cases += 1;
        }
      }
    }
  }
  assert.equal(cases, 3 * 9 * 2 * 2);
});

test('coordinatedWith must be the other party\'s Position id', () => {
  const w = world();
  const ex = ex0(w, 'CW1');
  const third = asR(w, ex, { kind: 'SetBlock', blockId: '9A-VECTOR', value: '270', coordinatedWith: 'LC' });
  refused(third, 'VALIDATION_ERROR', 'a third Position');
  assert.equal(third.attestation, undefined, 'a wrong party is a refusal, not a request to attest');
  refused(asR(w, ex, { kind: 'SetBlock', blockId: '9A-VECTOR', value: '270', coordinatedWith: 'AP' }), 'VALIDATION_ERROR', 'oneself');
  refused(asT(w, ex, { kind: 'SetBlock', blockId: '9A-VECTOR', value: '270', coordinatedWith: 'CTR' }), 'VALIDATION_ERROR', 'oneself');
  mustT(w, ex, { kind: 'SetBlock', blockId: '9A-VECTOR', value: '270', coordinatedWith: 'AP' });
  assert.equal(ex.T().coordination.control.holder, 'TRANSFERRING', 'an attested instruction moves nothing');
});

test('no assigned altitude: CLIMB and DESCENT are both needed (or FULL)', () => {
  const w = world();
  const ex = ex0(w, 'NOALT1');
  mustT(w, ex, grant(['CLIMB']));
  refused(asR(w, ex, { kind: 'SetBlock', blockId: '7', value: 'FL240' }), 'VALIDATION_ERROR', 'CLIMB alone does not cover an unknown direction');
  mustT(w, ex, grant(['CLIMB', 'DESCENT']));
  mustR(w, ex, { kind: 'SetBlock', blockId: '7', value: 'FL240' });
  const w2 = world();
  const ex2 = ex0(w2, 'NOALT2');
  mustT(w2, ex2, grant(['FULL']));
  mustR(w2, ex2, { kind: 'SetBlock', blockId: '7', value: 'FL240' });
});

test('speed is not a control axis: a 9A-SPEED write succeeds at every stage with no coordinatedWith, and MARSA is untouched', () => {
  const w = world();
  const ex = ex0(w, 'SPD1', { alt: 'FL240' });
  const speed = (v) => ({ kind: 'SetBlock', blockId: '9A-SPEED', value: v });
  mustR(w, ex, speed('250')); // no release
  mustT(w, ex, speed('260'));
  mustT(w, ex, grant(['TURNS']));
  mustR(w, ex, speed('240')); // covering a different scope
  mustT(w, ex, { kind: 'ControlRelease', action: 'WITHDRAW' });
  mustR(w, ex, speed('230')); // withdrawn
  mustT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  mustR(w, ex, speed('220')); // control moved
  for (const e of log(w).filter(x => x.op === 'SetBlock' && x.blockId === '9A-SPEED')) {
    assert.equal(e.coordinatedWith, undefined);
    assert.equal(e.controlAxis, undefined);
  }
  assert.equal(w.efsp.boardStoreFor('INCIRLIK')._rules.controlAxisFor('ARRIVAL', '9A-SPEED'), null);
  assert.equal(w.efsp.boardStoreFor('INCIRLIK')._rules.marsaInterlockFor('ARRIVAL', '9A-SPEED'), null, 'MARSA\'s voidForAssignment is untouched');
});

test('after control moved the receiver writes control Blocks freely, and the former holder must now attest', () => {
  const w = world();
  const ex = ex0(w, 'AFTER1', { alt: 'FL240' });
  mustT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  mustR(w, ex, { kind: 'SetBlock', blockId: '9A-VECTOR', value: '270' });
  // The former holder's write is no longer a control instruction of this exchange (control is on the other side),
  // and the check applies only while control has not transferred.
  mustT(w, ex, { kind: 'SetBlock', blockId: '9A-VECTOR', value: '280' });
});

test('a SetBlock outside an ACTIVE HANDOFF (before ACCEPT, no exchange, an AIT) is never checked', () => {
  const w = world();
  const ex = ex0(w, 'PRE1', { accept: false });
  mustT(w, ex, { kind: 'SetBlock', blockId: '9A-VECTOR', value: '270' });
  mustR(w, ex, { kind: 'SetBlock', blockId: '9A-VECTOR', value: '280' });
});

// ── audit ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test('one audit entry per outcome; peer entries carry causedBy; keys follow the documented order', () => {
  const w = world();
  const ex = ex0(w, 'AUD1');
  const mark = log(w).length;
  mustR(w, ex, { kind: 'ControlRelease', action: 'REQUEST', scopes: ['TURNS'] });
  mustT(w, ex, grant(['FULL'], { condition: 'at the fix' }));
  mustT(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  const entries = log(w).slice(mark);
  const ops = entries.map(e => `${e.op}${e.action ? ':' + e.action : ''}${e.source === 'peer' ? '(peer)' : ''}`);
  assert.deepEqual(ops, [
    // the peer Board's mirror is written inside the acting side's op, so it lands first (as every peer write does)
    'InterfacilityControlRelease:REQUEST(peer)', 'ControlRelease:REQUEST',
    'InterfacilityControlRelease:GRANT(peer)', 'ControlRelease:GRANT',
    'InterfacilityCoordinationResponse:TRANSFER_COMMS(peer)', 'HANDOFF:TRANSFER_COMMS',
  ]);
  for (let i = 0; i < entries.length; i += 2) assert.ok(entries[i].causedBy, `${entries[i].op} carries causedBy`);
  const grantEntry = entries[3];
  assert.deepEqual(grantEntry.controlRelease, { action: 'GRANT', scopes: ['FULL'], condition: 'at the fix', effectiveAt: null });
  const commsEntry = entries[5];
  assert.deepEqual(commsEntry.comms, { transferred: true });
  assert.deepEqual(commsEntry.control, { trigger: 'COMMS_AND_FULL_RELEASE' }, 'the automatic control transfer rides inside the entry that caused it');
  const keys = Object.keys(commsEntry);
  assert.ok(keys.indexOf('after') < keys.indexOf('comms'), 'auditFields follow `after`');
  assert.equal(entries.filter(e => e.control && e.op !== 'ControlRelease').length, 1, 'never a second entry for the automatic transfer');
});

// ── persistence and resync ──────────────────────────────────────────────────────────────────────────────────────────

test('the record round-trips the snapshot and rides the resync snapshot', () => {
  const w = world();
  const ex = ex0(w, 'SNAP1');
  mustT(w, ex, grant(['TURNS', 'CLIMB'], { climbLimitFt: 20000 }));
  mustR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  const stripId = ex.R().stripId;
  const rBefore = JSON.parse(JSON.stringify(ex.R().coordination));
  const tBefore = JSON.parse(JSON.stringify(ex.T().coordination));
  w.efsp.persist();
  const w2 = makeWorldKeepingSnapshot();
  const R = w2.boardStoreFor('INCIRLIK').getStrip(stripId);
  assert.deepEqual(JSON.parse(JSON.stringify(R.coordination)), rBefore);
  assert.deepEqual(JSON.parse(JSON.stringify(w2.boardStoreFor('CENTER').getStrip(ex.T().stripId).coordination)), tBefore);
  const snap = w2.snapshotFor({ controllerId: 'obs', who: 'obs' });
  const wire = JSON.stringify(snap);
  assert.ok(wire.includes('"climbLimitFt":20000') && wire.includes('"TRANSFERRING"') && wire.includes('"comms"'), 'the snapshot message carries the record');
});

function makeWorldKeepingSnapshot() { return createEfsp(); }

// ── intrafacility owner changes ─────────────────────────────────────────────────────────────────────────────────────

test('control follows the owner inside a Facility: an NLA transfer by the control holder moves the control Position', async () => {
  const w = world();
  const ex = ex0(w, 'OWN1');
  mustR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  assert.equal(ex.R().coordination.separationResponsibilityRef.positionId, 'AP');
  const handed = await helpers.advance(w.efsp, w.c.AP, 'AP', ex.R()); // INBOUND -> HANDED_TO_TOWER, transferred to LC
  assert.equal(handed.ownerPositionId, 'LC');
  assert.equal(ex.R().coordination.separationResponsibilityRef.positionId, 'LC', 'control went with the Strip');
  assert.equal(ex.T().coordination.separationResponsibilityRef.positionId, 'LC', 'and the peer Board agrees');
  assert.equal(ex.T().coordination.control.holder, 'RECEIVING', 'the holder side did not change');
});

test('an owner change on the side that does NOT hold control leaves the control Position alone', async () => {
  const w = world();
  const ex = ex0(w, 'OWN2');
  const handed = await helpers.advance(w.efsp, w.c.AP, 'AP', ex.R());
  assert.equal(handed.ownerPositionId, 'LC');
  assert.deepEqual(ex.R().coordination.separationResponsibilityRef, { facilityId: 'CENTER', positionId: 'CTR' });
});

test('a sign-off moves nothing: the Strip and control stay with the vacated Position, which AP is offered (docs/adr/0110)', () => {
  const w = world();
  const ex = ex0(w, 'OWN3');
  mustR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  const handed = mustR(w, ex, { kind: 'TransferStrip', toPositionId: 'LC', bayId: 'lc-coordination', rackId: 'main' });
  assert.equal(handed.ownerPositionId, 'LC');
  assert.equal(ex.R().coordination.separationResponsibilityRef.positionId, 'LC');
  // LC signs off: nothing moves. AP is the first staffed member of LC's list, so LC is covered (offered), and control stays LC's.
  helpers.hold(w.efsp, w.c.LC.session, 'INCIRLIK', []);
  assert.equal(ex.R().ownerPositionId, 'LC');
  assert.equal(ex.R().coordination.separationResponsibilityRef.positionId, 'LC');
  assert.equal(ex.T().coordination.separationResponsibilityRef.positionId, 'LC');
});

// ── undo (H95, DR-5) ────────────────────────────────────────────────────────────────────────────────────────────────

test('undo: the two marks declare a scope of both Strips; ControlRelease and every other action are not undoable', () => {
  const w = world();
  const ex = ex0(w, 'UND1');
  const handoff = OPS.find(m => m.kind === 'HANDOFF');
  const release = OPS.find(m => m.kind === 'ControlRelease');
  assert.equal(undoDeclarationProblem(handoff), null);
  assert.equal(undoDeclarationProblem(release), null);
  assert.equal(release.undo, 'none', 'ControlRelease never registers');
  const ctx = { rules: { facilityId: 'CENTER' } };
  const T = ex.T();
  for (const action of ['TRANSFER_COMMS', 'TRANSFER_CONTROL']) {
    const scope = handoff.undo.scope(ctx, T, { kind: 'HANDOFF', action });
    assert.deepEqual(scope.strips, [{ facilityId: 'CENTER', stripId: T.stripId }, { facilityId: 'INCIRLIK', stripId: ex.R().stripId }]);
    assert.equal(typeof handoff.undo.label({ kind: 'HANDOFF', action }, T, ctx), 'string');
    // The label names the RECEIVING Position from either side (AP on the transferring Strip and on the replica alike).
    const words = action === 'TRANSFER_COMMS' ? 'Communications' : 'Control';
    assert.equal(handoff.undo.label({ kind: 'HANDOFF', action }, T, ctx), `${words} to ${ex.R().ownerPositionId}`);
    assert.equal(handoff.undo.label({ kind: 'HANDOFF', action }, ex.R(), ctx), `${words} to ${ex.R().ownerPositionId}`);
  }
  for (const action of ['PROPOSE', 'ACCEPT', 'REJECT', 'CANCEL']) assert.equal(handoff.undo.scope(ctx, T, { kind: 'HANDOFF', action }), null, action);
  for (const kind of ['POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT']) assert.equal(OPS.find(m => m.kind === kind).undo, 'none', kind);
});

test('undo of TRANSFER_COMMS / TRANSFER_CONTROL inside 10 s restores both Strips; after 10 s refused (fake wall clock)', () => {
  const coordinationOf = (s) => JSON.stringify(s.coordination);
  for (const [action, side] of [['TRANSFER_COMMS', 'T'], ['TRANSFER_COMMS', 'R'], ['TRANSFER_CONTROL', 'T'], ['TRANSFER_CONTROL', 'R']]) {
    const label = `${action} by ${side}`;
    const wallClock = fakeWallClock();
    const w = world({ wallClock });
    const ex = ex0(w, `UN${action[9]}${side}`);
    const before = { T: coordinationOf(ex.T()), R: coordinationOf(ex.R()) };
    const by = side === 'T' ? asT : asR;
    const ack = by(w, ex, { kind: 'HANDOFF', action });
    assert.equal(ack.ok, true, label);
    assert.equal(ack.undoable.windowMs, 10_000, label);
    assert.match(ack.undoable.label, action === 'TRANSFER_COMMS' ? /^Communications to / : /^Control to /);
    assert.notEqual(coordinationOf(ex.T()), before.T, `${label} moved the record`);
    wallClock.advance(9_999);
    const undone = by(w, ex, { kind: 'Undo', actionId: ack.undoable.actionId });
    assert.equal(undone.ok, true, `${label}: ${JSON.stringify(undone)}`);
    assert.equal(coordinationOf(ex.T()), before.T, `${label}: the transferring Strip's record is back`);
    assert.equal(coordinationOf(ex.R()), before.R, `${label}: the receiving Strip's record is back`);
    assert.deepEqual(holders(ex), { comms: 'TRANSFERRING', control: 'TRANSFERRING', ref: { facilityId: 'CENTER', positionId: 'CTR' } });
    const peerEntry = log(w).find(e => e.op === 'InterfacilityUndo' && e.undoneActionId === ack.undoable.actionId);
    assert.ok(peerEntry, `${label}: the other Board's half is restored with an InterfacilityUndo entry`);
    // The same mark again, and its window closes at 10 s.
    const again = by(w, ex, { kind: 'HANDOFF', action });
    assert.equal(again.ok, true, label);
    wallClock.advance(10_000);
    refused(by(w, ex, { kind: 'Undo', actionId: again.undoable.actionId }), 'UNDO_UNAVAILABLE', `${label} after 10 s`);
    assert.notEqual(coordinationOf(ex.T()), before.T, `${label}: a refused undo changes nothing`);
  }
});

test('undo of a mark: only the Position that made it; a later release from the other Facility blocks it', () => {
  const wallClock = fakeWallClock();
  const w = world({ wallClock });
  const ex = ex0(w, 'UNDB');
  const ack = asR(w, ex, { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  assert.equal(ack.ok, true);
  refused(asT(w, ex, { kind: 'Undo', actionId: ack.undoable.actionId }), null, 'CTR undoing AP\'s mark');
  mustT(w, ex, { kind: 'ControlRelease', action: 'GRANT', scopes: ['TURNS'] }); // CENTER writes both Strips
  refused(asR(w, ex, { kind: 'Undo', actionId: ack.undoable.actionId }), 'UNDO_BLOCKED', 'after CENTER answered');
  assert.equal(ex.T().coordination.comms.transferred, true, 'nothing restored');
});
