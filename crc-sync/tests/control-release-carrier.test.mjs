import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { prologue } from './helpers/control-release-fixture.mjs';

// A HANDOFF into the CARRIER Facility (docs/adr/0101, H100 DR-3): APP or CTR hands an ARRIVAL at INBOUND to CV_MARSHAL,
// the replica is a MARSHAL Strip at IN_STACK, ACCEPT joins the Marshal stack like a recovery check-in, and the carrier's own
// handoffs then carry control with the owner. The Marshal receives and never proposes.

prologue('control-release-cv-');
const { createEfsp } = await import('../src/efsp/index.js');
const helpers = await import('./helpers/efsp-scenario.mjs');
const { crew, act, mustAct, mustCarrierAct } = helpers;

const STAFFED = { OPS: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER', CV_MARSHAL: 'CARRIER', CV_PRIFLY: 'CARRIER', CV_APP1: 'CARRIER', CV_APP2: 'CARRIER' };
const cv = (efsp) => efsp.boardStoreFor('CARRIER');
const stack = (efsp) => efsp.carrierStore.getRecord().stacks.MAIN.entries;
const grantFull = { kind: 'ControlRelease', action: 'GRANT', scopes: ['FULL'] };

function world() {
  fs.rmSync(process.env.CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH, { force: true });
  const efsp = createEfsp();
  return { efsp, c: crew(efsp, STAFFED) };
}

/** An ARRIVAL at INBOUND at `from` ('CTR' or 'AP'), proposed to the Marshal. */
function toMarshal({ efsp, c }, callsign, from = 'CTR') {
  const [facilityId, bayId] = from === 'CTR' ? ['CENTER', 'ctr-enroute'] : ['INCIRLIK', 'ap-inbound'];
  const strip = mustAct(efsp, c[from], from, null, {
    kind: 'CreateStrip', bayId, rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign, aircraftType: 'F-18C', wakeCategory: 'M', originAirport: 'LTAC' },
  });
  const proposed = mustAct(efsp, c[from], from, strip, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CARRIER', toPositionId: 'CV_MARSHAL' });
  return {
    T: () => efsp.boardStoreFor(facilityId).getStrip(strip.stripId),
    R: () => cv(efsp).getStrip(proposed.coordination.peerStripId),
    facilityId,
  };
}

test('CTR and APP both hand an ARRIVAL at INBOUND to CV_MARSHAL: the replica is a MARSHAL Strip at IN_STACK in the Coordination Bay', () => {
  for (const from of ['CTR', 'AP']) {
    const w = world();
    const ex = toMarshal(w, 'CVIN' + from, from);
    const r = ex.R();
    assert.equal(r.stripType, 'MARSHAL');
    assert.equal(r.state, 'IN_STACK');
    assert.equal(r.ownerPositionId, 'CV_MARSHAL');
    assert.equal(r.bayId, 'cv-marshal-coordination');
    assert.equal(stack(w.efsp).length, 0, 'not in the stack until ACCEPT');
    assert.equal(ex.T().stripType, 'ARRIVAL', 'the sender keeps its own strip type');
  }
});

test('ACCEPT appends to the Marshal stack at the next free slot, through the check-in path', () => {
  const w = world();
  const a = toMarshal(w, 'CVA1');
  const accepted = mustAct(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', a.R(), { kind: 'HANDOFF', action: 'ACCEPT' });
  assert.equal(accepted.bayId, 'cv-marshal-stack');
  assert.equal(accepted.state, 'IN_STACK');
  assert.equal(stack(w.efsp).length, 1);
  assert.equal(stack(w.efsp)[0].flightDataId, accepted.flightDataId);
  const b = toMarshal(w, 'CVA2', 'AP');
  mustAct(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', b.R(), { kind: 'HANDOFF', action: 'ACCEPT' });
  assert.deepEqual(stack(w.efsp).map(e => e.flightDataId), [a.R().flightDataId, b.R().flightDataId], 'the second one takes the next slot');
  // ACCEPT moved radar ID and ownership only (decision 1): control and comms are still the sender\'s.
  assert.equal(a.R().coordination.control.holder, 'TRANSFERRING');
  assert.equal(a.R().coordination.comms.transferred, false);
});

test('the Marshal receives and never proposes: PROPOSE and CANCEL are refused, and the Marshal takes no other primitive', () => {
  const w = world();
  const own = mustAct(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', null, {
    kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'MARSHAL', flightData: { callsign: 'CVOWN1', aircraftType: 'F-18C' },
  });
  for (const op of [
    { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' },
    { kind: 'HANDOFF', action: 'CANCEL' },
    { kind: 'POINT_OUT', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR' },
    { kind: 'ControlRelease', action: 'GRANT', scopes: ['FULL'] },
  ]) {
    const ack = act(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', own, op);
    assert.equal(ack.ok, false, JSON.stringify(op));
    assert.equal(ack.reason, 'PERMISSION_DENIED', JSON.stringify(op));
  }
  // Another primitive proposed TO the Marshal would mint a replica nobody could answer: refused at the proposer.
  const arr = mustAct(w.efsp, w.c.CTR, 'CTR', null, { kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', stripType: 'ARRIVAL', flightData: { callsign: 'CVPO1', aircraftType: 'F-18C' } });
  const po = act(w.efsp, w.c.CTR, 'CTR', arr, { kind: 'POINT_OUT', action: 'PROPOSE', toFacilityId: 'CARRIER', toPositionId: 'CV_MARSHAL' });
  assert.equal(po.ok, false);
  assert.match(po.detail, /does not take a POINT_OUT/);
  const other = act(w.efsp, w.c.CTR, 'CTR', arr, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CARRIER', toPositionId: 'CV_APP1' });
  assert.equal(other.ok, false, 'a lane Position takes no HANDOFF');
});

test('ControlRelease applies to the Marshal like any HANDOFF: REQUEST from the Marshal, GRANT FULL plus comms moves control', () => {
  const w = world();
  const ex = toMarshal(w, 'CVREL1');
  mustAct(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', ex.R(), { kind: 'HANDOFF', action: 'ACCEPT' });
  mustAct(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', ex.R(), { kind: 'ControlRelease', action: 'REQUEST', scopes: ['TURNS'] });
  mustAct(w.efsp, w.c.CTR, 'CTR', ex.T(), grantFull);
  mustAct(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', ex.R(), { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  assert.equal(ex.R().coordination.control.holder, 'RECEIVING');
  assert.deepEqual(ex.T().coordination.separationResponsibilityRef, { facilityId: 'CARRIER', positionId: 'CV_MARSHAL' });
});

test('I9 the Marshal Strip retired (drop) after control moved: the exchange ends, the stack entry leaves, the sender holds the flight', () => {
  const w = world();
  const ex = toMarshal(w, 'CVI9A');
  mustAct(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', ex.R(), { kind: 'HANDOFF', action: 'ACCEPT' });
  mustAct(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', ex.R(), { kind: 'HANDOFF', action: 'TRANSFER_COMMS' });
  mustAct(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', ex.R(), { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  assert.equal(stack(w.efsp).length, 1);
  mustAct(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', ex.R(), { kind: 'DropStrip' });
  assert.equal(stack(w.efsp).length, 0, 'carrierRetireFlight took it out of the stack');
  assert.equal(ex.T().coordination, null, 'RECEIVING_RETIRED: the exchange ends on the sender');
  assert.equal(ex.T().state, 'INBOUND');
  const end = w.efsp.mutationLog.readAll().filter(e => e.op === 'SystemCoordinationEnd' && e.stripId === ex.T().stripId).pop();
  assert.deepEqual(end.control, { trigger: 'RECEIVING_RETIRED', returned: ['comms', 'control'] });
});

test('I9 the Marshal Strip retired by carrierRetireFlight / recovery path: same outcome through the stack hook', () => {
  const w = world();
  const ex = toMarshal(w, 'CVI9B');
  mustAct(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', ex.R(), { kind: 'HANDOFF', action: 'ACCEPT' });
  mustAct(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', ex.R(), { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  const result = cv(w.efsp)._stripOps.retire(ex.R(), 'recovery');
  assert.equal(result.ok, true);
  assert.equal(ex.T().coordination, null);
});

test('I9 CarrierHandoff after control moved: control follows the owner (Marshal -> lane), on both Boards', () => {
  const w = world();
  const ex = toMarshal(w, 'CVI9C');
  mustCarrierAct(w.efsp, w.c.CV_PRIFLY, 'CV_PRIFLY', { kind: 'SetCarrierState', field: 'case', value: 'II' });
  mustAct(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', ex.R(), { kind: 'HANDOFF', action: 'ACCEPT' });
  mustAct(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', ex.R(), { kind: 'HANDOFF', action: 'TRANSFER_CONTROL' });
  assert.equal(ex.T().coordination.separationResponsibilityRef.positionId, 'CV_MARSHAL');
  const handed = mustAct(w.efsp, w.c.CV_MARSHAL, 'CV_MARSHAL', ex.R(), { kind: 'CarrierHandoff', transfer: 'MARSHAL_TO_APPROACH', toPositionId: 'CV_APP1' });
  assert.equal(handed.ownerPositionId, 'CV_APP1');
  assert.equal(ex.R().coordination.separationResponsibilityRef.positionId, 'CV_APP1');
  assert.equal(ex.T().coordination.separationResponsibilityRef.positionId, 'CV_APP1');
  assert.equal(ex.T().coordination.control.holder, 'RECEIVING');
});
