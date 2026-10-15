// The HANDOFF's check-in and release, client rules (crc-sync docs/adr/0122; H142): the chips, the offered steps, the form
// ops, the attestation request, the obligation labels and the carrier target. Pure: no DOM.
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
      separationResponsibilityRef: { facilityId: 'CENTER', positionId: 'CTR' }, released: true, releaseRequest: null, repair: null,
      ...over,
    },
  };
}
const keys = (steps) => steps.map(s => s.key);
const OPEN = { note: null, requestedAt: NOW, requestedByPositionId: 'AP', answer: null };
const MOVED = { comms: { transferred: true, at: NOW }, control: { holder: 'RECEIVING', at: NOW }, separationResponsibilityRef: { facilityId: 'INCIRLIK', positionId: 'AP' } };

test('steps: the receiver has only Checked in on a released handoff; the handing-off station has nothing to press (H142)', () => {
  assert.deepEqual(keys(R.handoffSteps(strip('RECEIVING'), 'AP')), ['CHECKED_IN']);
  assert.equal(R.handoffSteps(strip('RECEIVING'), 'AP')[0].label, 'Checked in');
  assert.deepEqual(keys(R.handoffSteps(strip('TRANSFERRING'), 'CTR')), [], 'no Comms to …, no Control to …');
  assert.deepEqual(R.handoffSteps(strip('RECEIVING'), null), [], 'no acting Position, no steps');
});

test('steps: no "Control to me" and no "Comms to" anywhere, at any stage', () => {
  const stages = [{}, { released: false }, { comms: { transferred: true, at: NOW } }, { released: false, comms: { transferred: true, at: NOW } }, MOVED, { released: false, releaseRequest: OPEN }];
  for (const over of stages) {
    for (const [side, acting] of [['RECEIVING', 'AP'], ['TRANSFERRING', 'CTR']]) {
      for (const st of R.handoffSteps(strip(side, over), acting)) {
        assert.ok(!['TRANSFER_COMMS', 'TRANSFER_CONTROL', 'WITHDRAW'].includes(st.key), `${side} ${JSON.stringify(over)}: ${st.key}`);
        assert.ok(!/^(Comms|Control) to /.test(st.label), st.label);
      }
    }
  }
});

test('steps: Request release only on a not-released handoff, before control moves; never on a released one (U8)', () => {
  assert.deepEqual(keys(R.handoffSteps(strip('RECEIVING', { released: false }), 'AP')), ['CHECKED_IN', 'REQUEST']);
  assert.deepEqual(keys(R.handoffSteps(strip('RECEIVING', { released: false, comms: { transferred: true, at: NOW } }), 'AP')), ['REQUEST'], 'checked in, waiting for the airspace');
  const open = R.handoffSteps(strip('RECEIVING', { released: false, releaseRequest: OPEN }), 'AP').find(s => s.key === 'REQUEST');
  assert.equal(open.enabled, false, 'one open request');
  assert.ok(!keys(R.handoffSteps(strip('RECEIVING', { released: true }), 'AP')).includes('REQUEST'), 'released');
  assert.ok(!keys(R.handoffSteps(strip('RECEIVING', { released: false, ...MOVED }), 'AP')).includes('REQUEST'), 'control moved');
  assert.ok(!keys(R.handoffSteps(strip('RECEIVING', { released: true, releaseRequest: { ...OPEN, answer: 'GRANTED' } }), 'AP')).includes('REQUEST'), 'granted: gone');
});

test('steps: an open request gives the handing-off station Release and Unable; nothing otherwise', () => {
  assert.deepEqual(keys(R.handoffSteps(strip('TRANSFERRING', { released: false, releaseRequest: OPEN }), 'CTR')), ['GRANT', 'REFUSE']);
  assert.equal(R.handoffSteps(strip('TRANSFERRING', { released: false, releaseRequest: OPEN }), 'CTR')[0].form, undefined, 'Release is one click');
  assert.deepEqual(keys(R.handoffSteps(strip('TRANSFERRING', { released: false }), 'CTR')), []);
  assert.deepEqual(keys(R.handoffSteps(strip('TRANSFERRING', { released: false, releaseRequest: { ...OPEN, answer: 'REFUSED' } }), 'CTR')), []);
});

test('steps: after control moved nothing; nothing before ACCEPT or on another primitive', () => {
  assert.deepEqual(keys(R.handoffSteps(strip('RECEIVING', MOVED), 'AP')), []);
  assert.deepEqual(R.handoffSteps(strip('RECEIVING', { state: 'INITIATED' }), 'AP'), []);
  assert.deepEqual(R.handoffSteps(strip('RECEIVING', { primitive: 'POINT_OUT' }), 'AP'), []);
  assert.deepEqual(R.handoffChips(strip('RECEIVING', { primitive: 'AIT' })), []);
});

test('chips (dark cockpit): grey holders, one grey word on the receiver, amber only for what needs the controller', () => {
  const t = strip('TRANSFERRING');
  assert.deepEqual(R.handoffChips(t).map(c => c.text), ['COMMS: CTR', 'CTRL: CTR'], 'the handing-off station sees no released word');
  assert.ok(R.handoffChips(t).every(c => c.mine), 'CTR holds both');
  assert.deepEqual(R.handoffChips(t).map(c => c.tone), ['quiet', 'quiet'], 'H138 U3: who holds comms and control is no problem');
  assert.deepEqual(R.handoffChips(strip('RECEIVING')).map(c => [c.text, c.tone]), [['COMMS: CTR', 'quiet'], ['CTRL: CTR', 'quiet'], ['RELEASED', 'quiet']]);
  assert.equal(R.handoffChips(strip('RECEIVING', { released: false, comms: { transferred: true, at: NOW } }))[2].text, 'NOT RELEASED');
  const q = R.handoffChips(strip('TRANSFERRING', { released: false, releaseRequest: { ...OPEN, note: 'for traffic' } }));
  assert.deepEqual([q[2].text, q[2].tone], ['RELEASE REQUESTED', 'attn'], 'the handing-off station must answer');
  assert.match(q[2].title, /for traffic/);
  const qr = R.handoffChips(strip('RECEIVING', { released: false, releaseRequest: OPEN }));
  assert.equal(qr.find(c => c.key === 'request').tone, 'quiet', 'the receiver waits: no colour');
  const f = R.handoffChips(strip('RECEIVING', { released: false, releaseRequest: { ...OPEN, answer: 'REFUSED', reason: 'traffic', answeredAt: NOW } }));
  assert.deepEqual([f.at(-1).text, f.at(-1).tone], ['RELEASE REFUSED: traffic', 'attn']);
  assert.equal(R.handoffChips(strip('TRANSFERRING', { released: false, releaseRequest: { ...OPEN, answer: 'REFUSED' } })).length, 2, 'its own refusal needs nothing from the handing-off station');
  const p = strip('RECEIVING', { repair: { at: NOW, axis: 'control', why: 'CTR was dropped' } });
  assert.equal(R.handoffChips(p).at(-1).text, 'CONTROL MOVED BY THE SYSTEM');
  assert.deepEqual(R.handoffChips(strip('RECEIVING', { ...MOVED, released: false, releaseRequest: { ...OPEN, answer: 'GRANTED' } })).map(c => c.key), ['comms', 'control'], 'nothing once control moved: no "release complete"');
});

test('form ops: Checked in and Release are HANDOFF / ControlRelease ops; a request has no scopes, only a note', () => {
  assert.deepEqual(R.buildStepOp('CHECKED_IN'), { kind: 'HANDOFF', action: 'CHECKED_IN' });
  assert.deepEqual(R.buildStepOp('GRANT'), { kind: 'ControlRelease', action: 'GRANT' });
  assert.deepEqual(R.buildRequestOp({ note: ' x ' }).op, { kind: 'ControlRelease', action: 'REQUEST', note: 'x' });
  assert.deepEqual(R.buildRequestOp({ note: '' }).op, { kind: 'ControlRelease', action: 'REQUEST' });
  assert.deepEqual(R.buildRefuseOp(' no '), { kind: 'ControlRelease', action: 'REFUSE', reason: 'no' });
  assert.deepEqual(R.buildRefuseOp(''), { kind: 'ControlRelease', action: 'REFUSE' });
  for (const gone of ['RELEASE_SCOPES', 'buildGrantOp', 'parseEffectiveAt', 'releaseSummary']) assert.equal(R[gone], undefined, gone);
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

test('obligation labels cover exactly the HANDOFF obligations the server raises', () => {
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
