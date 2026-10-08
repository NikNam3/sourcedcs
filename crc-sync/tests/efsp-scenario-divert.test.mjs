import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

/* ADR 0111: Divert. The destination decides the strip type; same Strip, same flight data; an audited amendment; refused for
 * departures and while an exchange is open; undone within 10 s. Walked the way pilots disturb it: diverted back, diverted
 * during a hand-off, diverted by a controller holding both AP and CTR.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-divert-scn-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER: 'carrier.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);
fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, '{}');

const { createEfsp } = await import('../src/efsp/index.js');
const { crew, hold, freshEfsp, act, mustAct, DEPARTURE_FLIGHT_DATA, airborneDeparture, handedToCenter } = await import('./helpers/efsp-scenario.mjs');

const STAFFED = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER', CV_MARSHAL: 'CARRIER' };
const world = () => freshEfsp(createEfsp, STAFFED);
const ctrBoard = (efsp) => efsp.boardStoreFor('CENTER');
const apBoard = (efsp) => efsp.boardStoreFor('INCIRLIK');

function overflightAt(efsp, c, position, callsign = 'OVR1') {
  const bay = position === 'CTR' ? 'ctr-overflight' : 'ap-overflight';
  return mustAct(efsp, c[position], position, null, {
    kind: 'CreateStrip', bayId: bay, rackId: 'main', stripType: 'OVERFLIGHT',
    flightData: { callsign, aircraftType: 'C-130', departureAirport: 'LLRD', destinationAirport: 'OSDI', route: 'DCT', requestedAltitude: '250' },
  });
}

test('an OVERFLIGHT diverted to Incirlik becomes an ARRIVAL at INBOUND on the same Strip and is handed to AP', () => {
  const { efsp, c } = world();
  const o = overflightAt(efsp, c, 'CTR');
  const d = mustAct(efsp, c.CTR, 'CTR', o, { kind: 'Divert', destination: 'incirlik', route: 'DCT LTAG', altitude: '90', holding: 'HOLD AT LTAG', special: 'RWY 05' });
  assert.equal(d.stripId, o.stripId);
  assert.equal(d.flightDataId, o.flightDataId);
  assert.equal(d.stripType, 'ARRIVAL');
  assert.equal(d.state, 'INBOUND');
  assert.equal(d.bayId, 'ctr-enroute');
  assert.equal(d.diverts.length, 1);
  assert.equal(d.diverts[0].from.destination, 'OSDI');
  assert.equal(d.diverts[0].to.destination, 'INCIRLIK');
  assert.equal(d.diverts[0].to.holding, 'HOLD AT LTAG');
  const fd = efsp.flightDataStore.getFlightData(d.flightDataId);
  assert.equal(fd.filed.destinationAirport, 'INCIRLIK');
  assert.equal(fd.filed.route, 'DCT LTAG');
  assert.equal(fd.filed.originAirport, 'LLRD');
  assert.equal(fd.clearance.altitude.entries.at(-1).parsed, 9000);
  const proposed = mustAct(efsp, c.CTR, 'CTR', d, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' });
  const replica = apBoard(efsp).getStrip(proposed.coordination.peerStripId);
  assert.equal(replica.stripType, 'ARRIVAL');
  const log = fs.readFileSync(process.env.CRCSYNC_EFSP_MUTATION_LOG_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(e => e.op === 'Divert');
  assert.equal(log.length, 1);
  assert.equal(log[0].divert.from.destination, 'OSDI');
  assert.equal(log[0].divert.to.destination, 'INCIRLIK');
});

test('an OVERFLIGHT diverted to the carrier becomes an ARRIVAL that CV_MARSHAL takes', () => {
  const { efsp, c } = world();
  const o = overflightAt(efsp, c, 'CTR', 'OVR2');
  const d = mustAct(efsp, c.CTR, 'CTR', o, { kind: 'Divert', destination: 'CVN-72' });
  assert.equal(d.stripType, 'ARRIVAL');
  const proposed = mustAct(efsp, c.CTR, 'CTR', d, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CARRIER', toPositionId: 'CV_MARSHAL' });
  const accepted = mustAct(efsp, c.CV_MARSHAL, 'CV_MARSHAL', efsp.boardStoreFor('CARRIER').getStrip(proposed.coordination.peerStripId), { kind: 'HANDOFF', action: 'ACCEPT' });
  assert.equal(accepted.ownerPositionId, 'CV_MARSHAL');
});

test('an OVERFLIGHT diverted to an untowered field stays an OVERFLIGHT, keeps its state, and is terminated by the holder', () => {
  const { efsp, c } = world();
  const o = overflightAt(efsp, c, 'CTR', 'OVR3');
  const d = mustAct(efsp, c.CTR, 'CTR', o, { kind: 'Divert', destination: 'LTAI' });
  assert.equal(d.stripType, 'OVERFLIGHT');
  assert.equal(d.state, 'INBOUND');
  assert.equal(d.ownerPositionId, 'CTR');
  const t = mustAct(efsp, c.CTR, 'CTR', d, { kind: 'DropStrip' });
  assert.equal(t.state, 'DROPPED');
});

test('an ARRIVAL diverts to another field we run, and to an untowered one (becoming an OVERFLIGHT at IN_SECTOR)', () => {
  const { efsp, c } = world();
  const a = mustAct(efsp, c.CTR, 'CTR', null, {
    kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', stripType: 'ARRIVAL',
    flightData: { callsign: 'ARR9', aircraftType: 'F-16C', wakeCategory: 'D', originAirport: 'LLRD' },
  });
  const toShip = mustAct(efsp, c.CTR, 'CTR', a, { kind: 'Divert', destination: 'CVN-72', altitude: 'FL100' });
  assert.equal(toShip.stripType, 'ARRIVAL');
  const away = mustAct(efsp, c.CTR, 'CTR', toShip, { kind: 'Divert', destination: 'LTAI', route: 'DCT LTAI' });
  assert.equal(away.stripType, 'OVERFLIGHT');
  assert.equal(away.state, 'IN_SECTOR');
  assert.equal(away.diverts.length, 2);
  const fd = efsp.flightDataStore.getFlightData(away.flightDataId);
  assert.equal(fd.filed.departureAirport, 'LLRD');
  // back: diverted back to Incirlik is an ordinary second divert
  const back = mustAct(efsp, c.CTR, 'CTR', away, { kind: 'Divert', destination: 'LTAG' });
  assert.equal(back.stripType, 'ARRIVAL');
  assert.equal(back.diverts.length, 3);
});

test('a DEPARTURE is refused, with its reason', () => {
  const { efsp, c } = world();
  const dep = airborneDeparture(efsp, c, { ...DEPARTURE_FLIGHT_DATA, callsign: 'DEP1' });
  const ack = act(efsp, c.AP, 'AP', dep, { kind: 'Divert', destination: 'LTAC' });
  assert.equal(ack.ok, false);
  assert.match(ack.detail, /departure does not divert/);
  const handed = handedToCenter(efsp, c, dep);
  const ack2 = act(efsp, c.CTR, 'CTR', handed, { kind: 'Divert', destination: 'LTAC' });
  assert.equal(ack2.ok, false);
});

test('only AP and CTR may divert; a blank destination is refused', () => {
  const { efsp, c } = world();
  const o = overflightAt(efsp, c, 'CTR', 'OVR4');
  assert.equal(act(efsp, c.OPS, 'OPS', o, { kind: 'Divert', destination: 'LTAG' }).ok, false);
  const blank = act(efsp, c.CTR, 'CTR', o, { kind: 'Divert', destination: '  ' });
  assert.equal(blank.ok, false);
  assert.match(blank.detail, /new destination/);
  const bad = act(efsp, c.CTR, 'CTR', o, { kind: 'Divert', destination: 'LTAG', altitude: 'banana' });
  assert.equal(bad.ok, false);
  assert.equal(ctrBoard(efsp).getStrip(o.stripId).stripType, 'OVERFLIGHT', 'a refusal changes nothing');
});

test('a divert is refused while a hand-off proposal is open, and allowed again once it is cancelled', () => {
  const { efsp, c } = world();
  const o = overflightAt(efsp, c, 'CTR', 'OVR5');
  const atSector = mustAct(efsp, c.CTR, 'CTR', o, { kind: 'SetState', toState: 'IN_SECTOR' });
  const proposed = mustAct(efsp, c.CTR, 'CTR', atSector, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' });
  const refused = act(efsp, c.CTR, 'CTR', proposed, { kind: 'Divert', destination: 'LTAG' });
  assert.equal(refused.ok, false);
  assert.match(refused.detail, /open coordination proposal/);
  const cancelled = mustAct(efsp, c.CTR, 'CTR', proposed, { kind: 'HANDOFF', action: 'CANCEL' });
  mustAct(efsp, c.CTR, 'CTR', cancelled, { kind: 'Divert', destination: 'LTAG' });
});

test('a controller holding both AP and CTR diverts a Strip as the acting owner only', () => {
  const { efsp, c } = world();
  hold(efsp, c.CTR.session, 'CENTER', ['CTR']);
  const both = { session: c.AP.session, facilityId: 'INCIRLIK' };
  hold(efsp, both.session, 'INCIRLIK', ['AP']);
  const o = overflightAt(efsp, c, 'AP', 'OVR6');
  assert.equal(act(efsp, c.CTR, 'CTR', o, { kind: 'Divert', destination: 'LTAG' }).ok, false, 'CTR does not own the AP Strip');
  const d = mustAct(efsp, c.AP, 'AP', o, { kind: 'Divert', destination: 'LTAG' });
  assert.equal(d.stripType, 'ARRIVAL');
  assert.equal(d.ownerPositionId, 'AP');
  assert.equal(d.bayId, 'ap-inbound');
});

test('Divert is undoable: strip type, state, destination and the altitude history come back', () => {
  const { efsp, c } = world();
  const o = overflightAt(efsp, c, 'CTR', 'OVR7');
  const ack = act(efsp, c.CTR, 'CTR', o, { kind: 'Divert', destination: 'LTAG', altitude: '90' });
  assert.equal(ack.ok, true);
  assert.ok(ack.undoable, 'the ack offers an undo');
  const d = ack.strip;
  const actionId = efsp.undoHistory.latestActionFor({ facilityId: 'CENTER', stripId: d.stripId });
  const undone = mustAct(efsp, c.CTR, 'CTR', d, { kind: 'Undo', actionId });
  assert.equal(undone.stripType, 'OVERFLIGHT');
  assert.equal(undone.bayId, 'ctr-overflight');
  assert.equal(undone.diverts, undefined);
  const fd = efsp.flightDataStore.getFlightData(undone.flightDataId);
  assert.equal(fd.filed.destinationAirport, 'OSDI');
  assert.deepEqual(fd.clearance.altitude.entries.map(e => e.status), ['VOIDED'], 'append-only: voided, not erased');
});
