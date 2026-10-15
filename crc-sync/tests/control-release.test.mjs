import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { prologue, fakeClock, fakeWallClock, makeWorld, exchange, holders } from './helpers/control-release-fixture.mjs';

// The HANDOFF steps and ControlRelease (docs/adr/0122, replacing ADR 0101's release model; H142, H141 U-RQ2 c): accept
// moves radar ID and ownership only; the receiver's CHECKED_IN moves comms, and control with it when the handoff is
// released; a not-released handoff's receiver may request a release, the handing-off station grants or refuses; a
// control instruction before control moves needs an attestation. The control tick (a not-released handoff inside the
// receiver's airspace) is control-release-boundary.test.mjs; the control invariant's paths control-release-invariant.test.mjs.

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
    assert.equal(co.released, true, 'released is the default (H142)');
    assert.equal(co.release, undefined, 'the partial-scope record is gone (ADR 0122)');
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
    assert.deepEqual(Object.keys(strip.coordination).filter(k => ['comms', 'control', 'release', 'released', 'releaseRequest', 'repair'].includes(k)).sort(),
      ['comms', 'control', 'releaseRequest', 'released', 'repair']);
  }
});

test('PROPOSE carries the one switch: released (default) or not, on both Strips; nothing else is accepted', () => {
  const w = world();
  const ex = ex0(w, 'SW1', { released: false, accept: false });
  assert.equal(ex.T().coordination.released, false);
  assert.equal(ex.R().coordination.released, false);
  mustT(w, ex, { kind: 'HANDOFF', action: 'CANCEL' });
  refused(asT(w, ex, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP', released: 'no' }), 'VALIDATION_ERROR', 'a released that is not a boolean');
  refused(asT(w, ex, { kind: 'POINT_OUT', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP', released: false }), 'VALIDATION_ERROR', 'released on a POINT_OUT');
  const w2 = world();
  const ex2 = ex0(w2, 'SW2', { released: true });
  assert.equal(ex2.R().coordination.released, true);
});

// ── check-in (H142) ─────────────────────────────────────────────────────────────────────────────────────────────────

test('released + CHECKED_IN: comms and control move at once (trigger CHECKED_IN), on both Boards', () => {
  const w = world();
  const ex = ex0(w, 'CI1');
  const ack = mustR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
  assert.equal(ack.coordination.comms.transferred, true);
  assert.equal(ack.coordination.comms.byPositionId, 'AP');
  assert.deepEqual(holders(ex), { comms: 'RECEIVING', control: 'RECEIVING', ref: { facilityId: 'INCIRLIK', positionId: 'AP' } });
  assert.equal(ex.T().coordination.control.trigger, 'CHECKED_IN');
  refused(asR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' }), 'VALIDATION_ERROR', 'a second check-in');
});

test('not released + CHECKED_IN: comms move, control stays with the transferring side', () => {
  const w = world();
  const ex = ex0(w, 'CI2', { released: false });
  mustR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
  assert.deepEqual(holders(ex), { comms: 'RECEIVING', control: 'TRANSFERRING', ref: { facilityId: 'CENTER', positionId: 'CTR' } });
});

test('only the receiver marks CHECKED_IN; the handing-off station has no comms step of its own', () => {
  const w = world();
  const ex = ex0(w, 'CI3');
  refused(asT(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' }), 'VALIDATION_ERROR', 'the transferring side');
  assert.equal(holders(ex).comms, 'TRANSFERRING');
});

test('the receiver never takes control by hand: TRANSFER_COMMS and TRANSFER_CONTROL are unknown actions, at every stage', () => {
  for (const released of [true, false]) {
    const w = world();
    const ex = ex0(w, `TK${released ? 'R' : 'N'}`, { released });
    for (const action of ['TRANSFER_COMMS', 'TRANSFER_CONTROL']) {
      for (const by of [asR, asT]) {
        const ack = by(w, ex, { kind: 'HANDOFF', action });
        refused(ack, 'VALIDATION_ERROR', `${action} before check-in`);
        assert.match(ack.detail, /unknown/);
      }
    }
    mustR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
    for (const action of ['TRANSFER_COMMS', 'TRANSFER_CONTROL']) refused(asR(w, ex, { kind: 'HANDOFF', action }), 'VALIDATION_ERROR', `${action} after check-in`);
    assert.equal(holders(ex).control, released ? 'RECEIVING' : 'TRANSFERRING');
  }
});

test('the mark is refused before ACCEPT, after REJECT and after CANCEL', () => {
  const w = world();
  const ex = ex0(w, 'EARLY1', { accept: false });
  refused(asR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' }), 'VALIDATION_ERROR', 'before accept');
  mustR(w, ex, { kind: 'HANDOFF', action: 'REJECT' });
  refused(asR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' }), 'VALIDATION_ERROR', 'after reject');
  const w2 = world();
  const ex2 = ex0(w2, 'EARLY2', { accept: false });
  mustT(w2, ex2, { kind: 'HANDOFF', action: 'CANCEL' });
  assert.equal(ex2.T().coordination, null);
  refused(asT(w2, ex2, { kind: 'HANDOFF', action: 'CHECKED_IN' }), 'VALIDATION_ERROR', 'after cancel');
});

test('a mark on anything but a HANDOFF is refused; AIT and POINT_OUT keep their own records', () => {
  const w = world();
  const ex = ex0(w, 'PO1', { accept: false });
  mustT(w, ex, { kind: 'HANDOFF', action: 'CANCEL' });
  const proposed = mustT(w, ex, { kind: 'POINT_OUT', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' });
  assert.equal(proposed.coordination.comms, undefined, 'a Point Out has no comms step');
  assert.equal(proposed.coordination.control, undefined);
  assert.equal(proposed.coordination.released, undefined);
  const r = w.efsp.boardStoreFor('INCIRLIK').getStrip(proposed.coordination.peerStripId);
  refused(act(w.efsp, w.c.AP, 'AP', r, { kind: 'POINT_OUT', action: 'CHECKED_IN' }), 'VALIDATION_ERROR', 'a mark on a POINT_OUT');
});

test('after check-in the exchange cannot be cancelled (the receiver drops instead)', () => {
  const w = world();
  const ex = ex0(w, 'CXL1', { released: false });
  mustR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
  refused(asT(w, ex, { kind: 'HANDOFF', action: 'CANCEL' }), 'VALIDATION_ERROR', 'cancel after check-in');
});

// ── Request release (a not-released handoff only) ───────────────────────────────────────────────────────────────────

const RQ = (extra = {}) => ({ kind: 'ControlRelease', action: 'REQUEST', ...extra });
const GRANT = { kind: 'ControlRelease', action: 'GRANT' };

test('REQUEST is refused on a released handoff, before and after check-in (U8)', () => {
  const w = world();
  const ex = ex0(w, 'U8A');
  refused(asR(w, ex, RQ()), 'VALIDATION_ERROR', 'a released handoff');
  mustR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
  refused(asR(w, ex, RQ()), 'VALIDATION_ERROR', 'after control moved');
});

test('REQUEST / REFUSE / GRANT on a not-released handoff: one open request, REFUSE keeps it not released, GRANT releases it', () => {
  const w = world();
  const ex = ex0(w, 'RQ1', { released: false });
  refused(asT(w, ex, RQ()), 'VALIDATION_ERROR', 'the transferring side does not request');
  refused(asT(w, ex, GRANT), 'VALIDATION_ERROR', 'nothing open to grant');
  mustR(w, ex, RQ({ note: 'weather deviation' }));
  assert.equal(ex.T().coordination.releaseRequest.answer, null);
  assert.equal(ex.T().coordination.releaseRequest.note, 'weather deviation');
  assert.equal(ex.T().coordination.releaseRequest.scopes, undefined, 'no scopes (H142)');
  refused(asR(w, ex, RQ()), 'VALIDATION_ERROR', 'a second open request');
  refused(asR(w, ex, { kind: 'ControlRelease', action: 'REFUSE' }), 'VALIDATION_ERROR', 'only the transferring side refuses');
  refused(asR(w, ex, GRANT), 'VALIDATION_ERROR', 'only the transferring side grants');
  mustT(w, ex, { kind: 'ControlRelease', action: 'REFUSE', reason: 'traffic' });
  assert.equal(ex.R().coordination.releaseRequest.answer, 'REFUSED');
  assert.equal(ex.R().coordination.releaseRequest.reason, 'traffic');
  assert.equal(ex.R().coordination.released, false, 'a refusal leaves it not released');
  refused(asT(w, ex, { kind: 'ControlRelease', action: 'REFUSE' }), 'VALIDATION_ERROR', 'nothing open to refuse');
  // A new request after the answer is allowed, and a GRANT answers it and makes the handoff released.
  mustR(w, ex, RQ());
  mustT(w, ex, GRANT);
  assert.equal(ex.R().coordination.releaseRequest.answer, 'GRANTED');
  assert.equal(ex.R().coordination.released, true);
  assert.equal(ex.T().coordination.released, true);
  assert.equal(holders(ex).control, 'TRANSFERRING', 'not checked in yet: control waits');
  refused(asR(w, ex, RQ()), 'VALIDATION_ERROR', 'released now: no request');
  mustR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
  assert.equal(holders(ex).control, 'RECEIVING', 'released: control moves at check-in');
  assert.equal(ex.T().coordination.control.trigger, 'CHECKED_IN');
});

test('GRANT after check-in moves control at once (trigger RELEASED), inside the GRANT entry', () => {
  const w = world();
  const ex = ex0(w, 'RQ2', { released: false });
  mustR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
  mustR(w, ex, RQ());
  mustT(w, ex, GRANT);
  assert.deepEqual(holders(ex), { comms: 'RECEIVING', control: 'RECEIVING', ref: { facilityId: 'INCIRLIK', positionId: 'AP' } });
  assert.equal(ex.R().coordination.control.trigger, 'RELEASED');
  const entry = log(w).filter(e => e.op === 'ControlRelease' && e.action === 'GRANT').pop();
  assert.deepEqual(entry.control, { trigger: 'RELEASED' });
  for (const a of ['REQUEST', 'GRANT', 'REFUSE']) refused((a === 'REQUEST' ? asR : asT)(w, ex, { kind: 'ControlRelease', action: a }), 'VALIDATION_ERROR', `${a} after control moved`);
});

test('there is no WITHDRAW (H141 U-RQ2 c), nor any scope', () => {
  const w = world();
  const ex = ex0(w, 'WD1', { released: false });
  mustR(w, ex, RQ());
  mustT(w, ex, GRANT);
  const ack = asT(w, ex, { kind: 'ControlRelease', action: 'WITHDRAW' });
  refused(ack, 'VALIDATION_ERROR', 'WITHDRAW');
  assert.match(ack.detail, /unknown/);
  assert.equal(ex.R().coordination.released, true, 'the grant stands');
});

// ── the control-axis check ──────────────────────────────────────────────────────────────────────────────────────────

const AXES = [
  { name: 'TURNS', op: { kind: 'SetBlock', blockId: '9A-VECTOR', value: '270' }, scope: 'TURNS' },
  { name: 'CLIMB', op: { kind: 'SetBlock', blockId: '7', value: 'FL260' }, scope: 'CLIMB' },
  { name: 'DESCENT', op: { kind: 'SetBlock', blockId: '7', value: 'FL200' }, scope: 'DESCENT' },
];

// Until control moves, every heading or altitude from either side needs an attestation, released or not, checked in or
// not (ADR 0122: there is no partial release left to waive it).
const STAGES = {
  releasedAccepted: { released: true, checkIn: false },
  notReleasedAccepted: { released: false, checkIn: false },
  notReleasedCheckedIn: { released: false, checkIn: true },
};

test('control-axis matrix: {receiver, transferring} x {TURNS, CLIMB, DESCENT} x stages before control x {attested, not}', () => {
  let cases = 0;
  for (const axis of AXES) {
    for (const [stage, how] of Object.entries(STAGES)) {
      for (const side of ['R', 'T']) {
        for (const attested of [false, true]) {
          const w = world();
          const ex = ex0(w, `AX${cases}`, { alt: 'FL240', released: how.released });
          if (how.checkIn) mustR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
          const label = `${side === 'R' ? 'receiver' : 'transferring'} ${axis.name} / ${stage} / ${attested ? 'attested' : 'bare'}`;
          const other = side === 'R' ? 'CTR' : 'AP';
          const op = { ...axis.op, ...(attested ? { coordinatedWith: other } : {}) };
          const ack = (side === 'R' ? asR : asT)(w, ex, op);
          if (attested) {
            assert.equal(ack.ok, true, `${label}: ${ack.detail}`);
            const entry = log(w).filter(e => e.op === 'SetBlock').pop();
            assert.equal(entry.coordinatedWith, other, label);
            assert.equal(entry.controlAxis, axis.scope, label);
          } else {
            refused(ack, 'VALIDATION_ERROR', label);
            assert.ok(ack.detail.includes(other), `${label}: the refusal names ${other}: ${ack.detail}`);
            assert.ok(ack.detail.includes(axis.scope), `${label}: and the axis: ${ack.detail}`);
            // DESK-ACKS: the same request as data, so no client parses the sentence above.
            assert.equal(ack.attestation.with, other, `${label}: attestation.with`);
            assert.ok(Array.isArray(ack.attestation.needs) && ack.attestation.needs.length > 0, `${label}: attestation.needs`);
            assert.ok(ack.attestation.needs.every(n => ack.detail.includes(n)), `${label}: needs are the axes the sentence names`);
          }
          cases += 1;
        }
      }
    }
  }
  assert.equal(cases, 3 * 3 * 2 * 2);
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

test('no assigned altitude: an altitude write names both CLIMB and DESCENT', () => {
  const w = world();
  const ex = ex0(w, 'NOALT1');
  const ack = asR(w, ex, { kind: 'SetBlock', blockId: '7', value: 'FL240' });
  refused(ack, 'VALIDATION_ERROR', 'no assigned altitude');
  assert.deepEqual([...ack.attestation.needs].sort(), ['CLIMB', 'DESCENT']);
});

test('speed is not a control axis: a 9A-SPEED write succeeds at every stage with no coordinatedWith, and MARSA is untouched', () => {
  const w = world();
  const ex = ex0(w, 'SPD1', { alt: 'FL240', released: false });
  const speed = (v) => ({ kind: 'SetBlock', blockId: '9A-SPEED', value: v });
  mustR(w, ex, speed('250')); // accepted
  mustT(w, ex, speed('260'));
  mustR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
  mustR(w, ex, speed('240')); // checked in, not released
  mustR(w, ex, RQ());
  mustR(w, ex, speed('230')); // a request open
  mustT(w, ex, GRANT);
  mustR(w, ex, speed('220')); // control moved
  for (const e of log(w).filter(x => x.op === 'SetBlock' && x.blockId === '9A-SPEED')) {
    assert.equal(e.coordinatedWith, undefined);
    assert.equal(e.controlAxis, undefined);
  }
  assert.equal(w.efsp.boardStoreFor('INCIRLIK')._rules.controlAxisFor('ARRIVAL', '9A-SPEED'), null);
  assert.equal(w.efsp.boardStoreFor('INCIRLIK')._rules.marsaInterlockFor('ARRIVAL', '9A-SPEED'), null, 'MARSA\'s voidForAssignment is untouched');
});

test('after control moved the receiver writes control Blocks freely, and so does the former holder (no longer an exchange instruction)', () => {
  const w = world();
  const ex = ex0(w, 'AFTER1', { alt: 'FL240' });
  mustR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
  mustR(w, ex, { kind: 'SetBlock', blockId: '9A-VECTOR', value: '270' });
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
  const ex = ex0(w, 'AUD1', { released: false });
  const mark = log(w).length;
  mustR(w, ex, RQ());
  mustT(w, ex, { kind: 'ControlRelease', action: 'REFUSE', reason: 'traffic' });
  mustR(w, ex, RQ());
  mustT(w, ex, GRANT);
  mustR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
  const entries = log(w).slice(mark);
  const ops = entries.map(e => `${e.op}${e.action ? ':' + e.action : ''}${e.source === 'peer' ? '(peer)' : ''}`);
  assert.deepEqual(ops, [
    // the peer Board's mirror is written inside the acting side's op, so it lands first (as every peer write does)
    'InterfacilityControlRelease:REQUEST(peer)', 'ControlRelease:REQUEST',
    'InterfacilityControlRelease:REFUSE(peer)', 'ControlRelease:REFUSE',
    'InterfacilityControlRelease:REQUEST(peer)', 'ControlRelease:REQUEST',
    'InterfacilityControlRelease:GRANT(peer)', 'ControlRelease:GRANT',
    'InterfacilityCoordinationResponse:CHECKED_IN(peer)', 'HANDOFF:CHECKED_IN',
  ]);
  for (let i = 0; i < entries.length; i += 2) assert.ok(entries[i].causedBy, `${entries[i].op} carries causedBy`);
  assert.deepEqual(entries[3].controlRelease, { action: 'REFUSE', reason: 'traffic' });
  assert.deepEqual(entries[7].controlRelease, { action: 'GRANT' });
  const checkIn = entries[9];
  assert.deepEqual(checkIn.comms, { transferred: true });
  assert.deepEqual(checkIn.control, { trigger: 'CHECKED_IN' }, 'the control move rides inside the entry that caused it');
  const keys = Object.keys(checkIn);
  assert.ok(keys.indexOf('after') < keys.indexOf('comms'), 'auditFields follow `after`');
  assert.equal(entries.filter(e => e.control && e.op !== 'ControlRelease').length, 1, 'never a second entry for the control move');
});

// ── persistence and resync ──────────────────────────────────────────────────────────────────────────────────────────

test('the record round-trips the snapshot and rides the resync snapshot', () => {
  const w = world();
  const ex = ex0(w, 'SNAP1', { released: false });
  mustR(w, ex, RQ({ note: 'shortcut' }));
  mustR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
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
  assert.ok(wire.includes('"released":false') && wire.includes('"shortcut"') && wire.includes('"TRANSFERRING"') && wire.includes('"comms"'), 'the snapshot message carries the record');
});

function makeWorldKeepingSnapshot() { return createEfsp(); }

// ── intrafacility owner changes ─────────────────────────────────────────────────────────────────────────────────────

test('control follows the owner inside a Facility: an NLA transfer by the control holder moves the control Position', async () => {
  const w = world();
  const ex = ex0(w, 'OWN1');
  mustR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
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
  mustR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
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

test('undo: the mark declares a scope of both Strips; ControlRelease and every other action are not undoable', () => {
  const w = world();
  const ex = ex0(w, 'UND1');
  const handoff = OPS.find(m => m.kind === 'HANDOFF');
  const release = OPS.find(m => m.kind === 'ControlRelease');
  assert.equal(undoDeclarationProblem(handoff), null);
  assert.equal(undoDeclarationProblem(release), null);
  assert.equal(release.undo, 'none', 'ControlRelease never registers');
  const ctx = { rules: { facilityId: 'CENTER' } };
  const T = ex.T();
  const scope = handoff.undo.scope(ctx, T, { kind: 'HANDOFF', action: 'CHECKED_IN' });
  assert.deepEqual(scope.strips, [{ facilityId: 'CENTER', stripId: T.stripId }, { facilityId: 'INCIRLIK', stripId: ex.R().stripId }]);
  // The label names the RECEIVING Position from either side (AP on the transferring Strip and on the replica alike).
  assert.equal(handoff.undo.label({ kind: 'HANDOFF', action: 'CHECKED_IN' }, T, ctx), `Checked in with ${ex.R().ownerPositionId}`);
  assert.equal(handoff.undo.label({ kind: 'HANDOFF', action: 'CHECKED_IN' }, ex.R(), ctx), `Checked in with ${ex.R().ownerPositionId}`);
  for (const action of ['PROPOSE', 'ACCEPT', 'REJECT', 'CANCEL', 'TRANSFER_COMMS', 'TRANSFER_CONTROL']) assert.equal(handoff.undo.scope(ctx, T, { kind: 'HANDOFF', action }), null, action);
  for (const kind of ['POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT']) assert.equal(OPS.find(m => m.kind === kind).undo, 'none', kind);
});

test('undo of CHECKED_IN inside 10 s restores both Strips (and control, when it moved); after 10 s refused (fake wall clock)', () => {
  const coordinationOf = (s) => JSON.stringify(s.coordination);
  for (const released of [true, false]) {
    const label = released ? 'released' : 'not released';
    const wallClock = fakeWallClock();
    const w = world({ wallClock });
    const ex = ex0(w, `UN${released ? 'R' : 'N'}`, { released });
    const before = { T: coordinationOf(ex.T()), R: coordinationOf(ex.R()) };
    const ack = asR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
    assert.equal(ack.ok, true, label);
    assert.equal(ack.undoable.windowMs, 10_000, label);
    assert.match(ack.undoable.label, /^Checked in with /);
    assert.notEqual(coordinationOf(ex.T()), before.T, `${label} moved the record`);
    wallClock.advance(9_999);
    const undone = asR(w, ex, { kind: 'Undo', actionId: ack.undoable.actionId });
    assert.equal(undone.ok, true, `${label}: ${JSON.stringify(undone)}`);
    assert.equal(coordinationOf(ex.T()), before.T, `${label}: the transferring Strip's record is back`);
    assert.equal(coordinationOf(ex.R()), before.R, `${label}: the receiving Strip's record is back`);
    assert.deepEqual(holders(ex), { comms: 'TRANSFERRING', control: 'TRANSFERRING', ref: { facilityId: 'CENTER', positionId: 'CTR' } });
    const peerEntry = log(w).find(e => e.op === 'InterfacilityUndo' && e.undoneActionId === ack.undoable.actionId);
    assert.ok(peerEntry, `${label}: the other Board's half is restored with an InterfacilityUndo entry`);
    // The same mark again, and its window closes at 10 s.
    const again = asR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
    assert.equal(again.ok, true, label);
    wallClock.advance(10_000);
    refused(asR(w, ex, { kind: 'Undo', actionId: again.undoable.actionId }), 'UNDO_UNAVAILABLE', `${label} after 10 s`);
    assert.notEqual(coordinationOf(ex.T()), before.T, `${label}: a refused undo changes nothing`);
  }
});

test('undo of a mark: only the Position that made it; a later write from the other Facility blocks it', () => {
  const wallClock = fakeWallClock();
  const w = world({ wallClock });
  const ex = ex0(w, 'UNDB', { released: false });
  mustR(w, ex, RQ());
  const ack = asR(w, ex, { kind: 'HANDOFF', action: 'CHECKED_IN' });
  assert.equal(ack.ok, true);
  refused(asT(w, ex, { kind: 'Undo', actionId: ack.undoable.actionId }), null, 'CTR undoing AP\'s mark');
  mustT(w, ex, GRANT); // CENTER writes both Strips (and control moves)
  refused(asR(w, ex, { kind: 'Undo', actionId: ack.undoable.actionId }), 'UNDO_BLOCKED', 'after CENTER answered');
  assert.equal(ex.T().coordination.comms.transferred, true, 'nothing restored');
});
