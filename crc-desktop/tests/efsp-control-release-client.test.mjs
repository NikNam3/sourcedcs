// ControlRelease on a HANDOFF, client rules (crc-sync docs/adr/0101): the chips, the offered steps, the form ops, the
// attestation request, the obligation labels and the carrier target. Pure: no DOM.
import './helpers/client-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as R from '../app/public/js/panels/efsp/control-release-rules.js';
import { CARRIER_HANDOFF_TARGET, canHandOffToCarrier } from '../app/public/js/panels/efsp/bay/authority-mirror.js';

const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);

function strip(side, over = {}) {
  const receiving = side === 'RECEIVING';
  return {
    stripId: `S-${side}`, ownerPositionId: receiving ? 'AP' : 'CTR', stripType: 'ARRIVAL', state: 'INBOUND', bayId: 'b',
    coordination: {
      primitive: 'HANDOFF', state: 'ACTIVE', peerPositionId: receiving ? 'CTR' : 'AP', mintedForCoordination: receiving,
      comms: { transferred: false, at: null }, control: { holder: 'TRANSFERRING', at: null },
      separationResponsibilityRef: { facilityId: 'CENTER', positionId: 'CTR' }, release: null, releaseRequest: null, repair: null,
      ...over,
    },
  };
}
const keys = (steps) => steps.map(s => s.key);

test('steps: the transferring side offers comms, control and release; the receiving side comms, control and a request', () => {
  assert.deepEqual(keys(R.handoffSteps(strip('TRANSFERRING'), 'CTR')), ['TRANSFER_COMMS', 'TRANSFER_CONTROL', 'GRANT']);
  assert.deepEqual(keys(R.handoffSteps(strip('RECEIVING'), 'AP')), ['TRANSFER_COMMS', 'TRANSFER_CONTROL', 'REQUEST']);
  assert.deepEqual(R.handoffSteps(strip('RECEIVING'), null), [], 'no acting Position, no steps');
});

test('steps: Comms to the receiving Position from both sides; no comms step once moved', () => {
  assert.equal(R.handoffSteps(strip('TRANSFERRING'), 'CTR')[0].label, 'Comms to AP');
  assert.equal(R.handoffSteps(strip('RECEIVING'), 'AP')[0].label, 'Comms to AP');
  const moved = strip('TRANSFERRING', { comms: { transferred: true, at: NOW } });
  assert.ok(!keys(R.handoffSteps(moved, 'CTR')).includes('TRANSFER_COMMS'));
});

test('steps: an open request offers Unable, an open request disables Request, a release offers Withdraw', () => {
  const open = { scopes: ['CLIMB'], note: null, requestedAt: NOW, answer: null };
  assert.deepEqual(keys(R.handoffSteps(strip('TRANSFERRING', { releaseRequest: open }), 'CTR')), ['TRANSFER_COMMS', 'TRANSFER_CONTROL', 'GRANT', 'REFUSE']);
  const req = R.handoffSteps(strip('RECEIVING', { releaseRequest: open }), 'AP').find(s => s.key === 'REQUEST');
  assert.equal(req.enabled, false);
  const rel = { scopes: ['TURNS'], condition: null, effectiveAt: null, grantedAt: NOW };
  assert.ok(keys(R.handoffSteps(strip('TRANSFERRING', { release: rel }), 'CTR')).includes('WITHDRAW'));
  assert.ok(!keys(R.handoffSteps(strip('TRANSFERRING', { release: { ...rel, withdrawnAt: NOW } }), 'CTR')).includes('WITHDRAW'));
});

test('steps: after control moved only the comms step can remain; nothing before ACCEPT or on another primitive', () => {
  const moved = strip('RECEIVING', { control: { holder: 'RECEIVING', at: NOW }, separationResponsibilityRef: { facilityId: 'INCIRLIK', positionId: 'AP' } });
  assert.deepEqual(keys(R.handoffSteps(moved, 'AP')), ['TRANSFER_COMMS']);
  assert.deepEqual(R.handoffSteps(strip('RECEIVING', { state: 'INITIATED' }), 'AP'), []);
  assert.deepEqual(R.handoffSteps(strip('RECEIVING', { primitive: 'POINT_OUT' }), 'AP'), []);
  assert.deepEqual(R.handoffChips(strip('RECEIVING', { primitive: 'AIT' })), []);
});

test('chips: who holds comms and control, the release in effect, withdrawn, requested, refused, repaired', () => {
  const t = strip('TRANSFERRING');
  assert.deepEqual(R.handoffChips(t).map(c => c.text), ['COMMS: CTR', 'CTRL: CTR']);
  assert.ok(R.handoffChips(t).every(c => c.held), 'CTR holds both');
  const r = strip('RECEIVING', { comms: { transferred: true, at: NOW }, release: { scopes: ['TURNS', 'CLIMB'], climbLimitFt: 24000, condition: 'after DME', effectiveAt: null, grantedAt: NOW } });
  assert.deepEqual(R.handoffChips(r).map(c => c.text), ['COMMS: AP', 'CTRL: CTR', 'RELEASE: Turns + Climb ≤ 24000 ft · after DME']);
  const w = strip('RECEIVING', { release: { scopes: ['FULL'], condition: null, effectiveAt: null, withdrawnAt: NOW } });
  assert.equal(R.handoffChips(w)[2].text, 'RELEASE WITHDRAWN');
  const q = strip('TRANSFERRING', { releaseRequest: { scopes: ['DESCENT'], note: 'for traffic', requestedAt: NOW, answer: null } });
  assert.equal(R.handoffChips(q)[2].text, 'RELEASE REQUESTED: Descent · for traffic');
  const f = strip('RECEIVING', { releaseRequest: { scopes: ['DESCENT'], requestedAt: NOW, answer: 'REFUSED', reason: 'traffic' } });
  assert.equal(R.handoffChips(f)[2].text, 'RELEASE REFUSED: traffic');
  const p = strip('RECEIVING', { repair: { at: NOW, axis: 'control', why: 'CTR was dropped' } });
  assert.equal(R.handoffChips(p).at(-1).text, 'CONTROL MOVED BY THE SYSTEM');
  const done = strip('RECEIVING', { control: { holder: 'RECEIVING' }, separationResponsibilityRef: { positionId: 'AP' }, release: { scopes: ['FULL'] } });
  assert.deepEqual(R.handoffChips(done).map(c => c.key), ['comms', 'control'], 'a release is moot once control moved');
});

test('form ops: GRANT scopes, limits only with their scope, FULL replaces the rest, effective time', () => {
  assert.match(R.buildGrantOp({ scopes: [] }, NOW).error, /pick what/);
  const g = R.buildGrantOp({ scopes: ['TURNS', 'CLIMB'], climbLimit: '24000', descentLimit: '5000', condition: ' after DME ', effectiveAt: '1230' }, NOW);
  assert.deepEqual(g.op, { kind: 'ControlRelease', action: 'GRANT', scopes: ['TURNS', 'CLIMB'], climbLimitFt: 24000, condition: 'after DME', effectiveAt: Date.UTC(2026, 5, 1, 12, 30) });
  assert.deepEqual(R.buildGrantOp({ scopes: ['FULL', 'TURNS'], climbLimit: '3' }, NOW).op, { kind: 'ControlRelease', action: 'GRANT', scopes: ['FULL'] });
  assert.match(R.buildGrantOp({ scopes: ['CLIMB'], climbLimit: 'high' }, NOW).error, /not a number/);
  assert.match(R.buildGrantOp({ scopes: ['TURNS'], effectiveAt: '9999' }, NOW).error, /HHMM/);
  assert.deepEqual(R.buildRequestOp({ scopes: ['DESCENT'], note: 'x' }).op, { kind: 'ControlRelease', action: 'REQUEST', scopes: ['DESCENT'], note: 'x' });
  assert.deepEqual(R.buildRefuseOp(' no '), { kind: 'ControlRelease', action: 'REFUSE', reason: 'no' });
  assert.deepEqual(R.buildRefuseOp(''), { kind: 'ControlRelease', action: 'REFUSE' });
  assert.deepEqual(R.buildStepOp('TRANSFER_COMMS'), { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  assert.deepEqual(R.buildStepOp('WITHDRAW'), { kind: 'ControlRelease', action: 'WITHDRAW' });
});

test('effective time: HHMM on the mission day, a time over 12 h past rolls to tomorrow', () => {
  assert.equal(R.parseEffectiveAt('12:45z', NOW), Date.UTC(2026, 5, 1, 12, 45));
  assert.equal(R.parseEffectiveAt('1130', NOW), Date.UTC(2026, 5, 1, 11, 30));
  assert.equal(R.parseEffectiveAt('0030', NOW), Date.UTC(2026, 5, 1, 0, 30), 'less than 12 h ago: already effective');
  assert.equal(R.parseEffectiveAt('0030', Date.UTC(2026, 5, 1, 23, 0)), Date.UTC(2026, 5, 2, 0, 30), 'past midnight');
  assert.equal(R.parseEffectiveAt('2460', NOW), null);
});

test('attestation request: read from the ack\'s structured field, never from the server\'s sentence', () => {
  const op = { kind: 'SetBlock', blockId: '9A-HDG', value: '270' };
  const turns = { with: 'AP', needs: ['TURNS'] };
  assert.deepEqual(R.attestationRequest(turns, op), { needs: 'TURNS', with: 'AP' });
  assert.equal(R.attestationRequest({ with: 'CTR', needs: ['CLIMB', 'DESCENT'] }, op).needs, 'CLIMB and DESCENT');
  assert.equal(R.attestationRequest(turns, { ...op, coordinatedWith: 'AP' }), null, 'already attested');
  assert.equal(R.attestationRequest(undefined, op), null, 'a refusal without the field is an ordinary refusal');
  assert.equal(R.attestationRequest({ with: 'AP', needs: [] }, op), null);
  assert.equal(R.attestationRequest(turns, { kind: 'HANDOFF' }), null);
  // No regex over server prose anywhere in the module.
  const rules = fs.readFileSync(new URL('../app/public/js/panels/efsp/control-release-rules.js', import.meta.url), 'utf8');
  assert.ok(!/is a control instruction/.test(rules), 'the server sentence is not matched on the client');
});

test('obligation labels cover exactly the control-invariant obligations the server raises', () => {
  const source = fs.readFileSync(new URL('../../crc-sync/src/efsp/forwarding-obligations.js', import.meta.url), 'utf8');
  for (const type of Object.keys(R.OBLIGATION_LABELS)) assert.ok(source.includes(`obligationType: '${type}'`), type);
});

test('the carrier target: CV_MARSHAL in CARRIER, offered only to AP and CTR for an ARRIVAL at INBOUND', () => {
  assert.deepEqual(CARRIER_HANDOFF_TARGET, { facilityId: 'CARRIER', positionId: 'CV_MARSHAL' });
  assert.equal(canHandOffToCarrier({ ownerPositionId: 'CTR', stripType: 'ARRIVAL', state: 'INBOUND' }), true);
  assert.equal(canHandOffToCarrier({ ownerPositionId: 'AP', stripType: 'ARRIVAL', state: 'INBOUND' }), true);
  assert.equal(canHandOffToCarrier({ ownerPositionId: 'CTR', stripType: 'ARRIVAL', state: 'ON_FINAL' }), false);
  assert.equal(canHandOffToCarrier({ ownerPositionId: 'CTR', stripType: 'DEPARTURE', state: 'INBOUND' }), false);
  assert.equal(canHandOffToCarrier({ ownerPositionId: 'TWR', stripType: 'ARRIVAL', state: 'INBOUND' }), false);
});

test('the attestation line holds the refused write and re-sends it only on the click', async () => {
  const A = await import('../app/public/js/panels/efsp/panel/control-attest.js');
  A._resetControlAttestForTest();
  const pending = { stripId: 'S1', actingPositionId: 'CTR', facilityId: 'CENTER', op: { kind: 'SetBlock', blockId: '9A-HDG', value: '270' } };
  assert.equal(A.noteAttestationRefusal({ ok: false, reason: 'STALE_REV', pending }), false);
  assert.equal(A.noteAttestationRefusal({ ok: false, reason: 'VALIDATION_ERROR', detail: 'TURNS is a control instruction ...', pending }), false, 'the sentence alone asks nothing');
  assert.equal(A.getControlAttestation(), null);
  assert.equal(A.noteAttestationRefusal({ ok: false, reason: 'VALIDATION_ERROR', attestation: { with: 'AP', needs: ['TURNS'] }, pending }), true);
  assert.equal(A.getControlAttestation().with, 'AP');
  A.dismissControlAttestation();
  assert.equal(A.getControlAttestation(), null);
});
