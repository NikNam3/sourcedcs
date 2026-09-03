import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  COORDINATION_PRIMITIVES, COORDINATION_EFFECTS, isCoordinationPrimitive, coordinationEffect,
} = await import('../src/efsp/coordination.js');

// Guide §4.6's primitive table, reproduced exactly here so a transcription
// error in coordination.js's own table is caught byte-for-byte, not just
// "looks about right":
//
// | Primitive            | Radar ID  | Comms     | Jurisdiction (data/sep) | Accept                |
// |-----------------------|-----------|-----------|--------------------------|------------------------|
// | HANDOFF               | transfers | transfers | passes to receiver       | "RADAR CONTACT"        |
// | POINT_OUT              | transfers | does not  | data stays / sep passes  | "POINT OUT APPROVED"   |
// | TRAFFIC                | transfers | does not  | stays with initiator     | "TRAFFIC OBSERVED"     |
// | OPERATIONAL_REQUEST    | —         | —         | stays with requester     | "APPROVED"/"UNABLE"/"STAND BY" |
// | AIT                    | transfers | transfers | passes                   | silent                 |

test('every one of the 5 op-kind-level coordination primitives (permission.js\'s COORDINATION_OP_KINDS) has a COORDINATION_EFFECTS entry', () => {
  for (const primitive of ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT']) {
    assert.ok(COORDINATION_EFFECTS[primitive], primitive);
    assert.ok(COORDINATION_PRIMITIVES.has(primitive), primitive);
  }
});

test('HANDOFF: Radar ID transfers, Comms transfers, both data ownership and separation responsibility move to the receiver', () => {
  assert.deepEqual(coordinationEffect('HANDOFF'), {
    radarIdTransfers: true, commsTransfers: true,
    dataOwnershipMoves: true, separationResponsibilityMoves: true,
    acceptPhrase: 'RADAR CONTACT',
  });
});

test('POINT_OUT: the one primitive where jurisdiction SPLITS — data ownership stays with the initiator, separation responsibility moves (guide rule 1, the subtlest thing in the protocol)', () => {
  const effect = coordinationEffect('POINT_OUT');
  assert.equal(effect.dataOwnershipMoves, false);
  assert.equal(effect.separationResponsibilityMoves, true);
  assert.equal(effect.radarIdTransfers, true);
  assert.equal(effect.commsTransfers, false);
  assert.equal(effect.acceptPhrase, 'POINT OUT APPROVED');
});

test('TRAFFIC: Radar ID transfers, nothing else — jurisdiction stays entirely with the initiator', () => {
  assert.deepEqual(coordinationEffect('TRAFFIC'), {
    radarIdTransfers: true, commsTransfers: false,
    dataOwnershipMoves: false, separationResponsibilityMoves: false,
    acceptPhrase: 'TRAFFIC OBSERVED',
  });
});

test('OPERATIONAL_REQUEST: nothing transfers at all — no Radar ID/Comms column in the guide\'s table, jurisdiction stays with requester', () => {
  assert.deepEqual(coordinationEffect('OPERATIONAL_REQUEST'), {
    radarIdTransfers: false, commsTransfers: false,
    dataOwnershipMoves: false, separationResponsibilityMoves: false,
    acceptPhrase: 'APPROVED',
  });
});

test('AIT: transfers everything, silently — no accept phrase (guide rule 7: "requires a written directive")', () => {
  const effect = coordinationEffect('AIT');
  assert.equal(effect.radarIdTransfers, true);
  assert.equal(effect.commsTransfers, true);
  assert.equal(effect.dataOwnershipMoves, true);
  assert.equal(effect.separationResponsibilityMoves, true);
  assert.equal(effect.acceptPhrase, null);
});

test('isCoordinationPrimitive is true for exactly the 5 primitives, false for anything else including ordinary op kinds', () => {
  for (const primitive of ['HANDOFF', 'POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST', 'AIT']) {
    assert.equal(isCoordinationPrimitive(primitive), true, primitive);
  }
  for (const notPrimitive of ['TransferStrip', 'MoveStrip', 'TOFI', 'NOT_A_REAL_THING', '']) {
    assert.equal(isCoordinationPrimitive(notPrimitive), false, notPrimitive);
  }
});

test('coordinationEffect returns null for an unknown primitive, never a throw', () => {
  assert.equal(coordinationEffect('NOT_A_REAL_PRIMITIVE'), null);
  assert.equal(coordinationEffect(undefined), null);
});

test('only HANDOFF and AIT move BOTH data ownership and separation responsibility together — POINT_OUT/TRAFFIC/OPERATIONAL_REQUEST never move data ownership at all', () => {
  for (const primitive of ['HANDOFF', 'AIT']) {
    const effect = coordinationEffect(primitive);
    assert.equal(effect.dataOwnershipMoves, effect.separationResponsibilityMoves);
  }
  for (const primitive of ['POINT_OUT', 'TRAFFIC', 'OPERATIONAL_REQUEST']) {
    assert.equal(coordinationEffect(primitive).dataOwnershipMoves, false, primitive);
  }
});
