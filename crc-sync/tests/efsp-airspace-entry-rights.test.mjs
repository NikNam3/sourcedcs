import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// docs/adr/0119 (H134 LT-RQ13 a, H136 VQ5 a): who approves and clears a flight's entry into an airspace. The Position
// working the Strip relays the using agency's permission (JO 7110.65BB para 9-3-1 NOTE); the using agency itself grants
// it (14 CFR 73.15 (c)(2), para 9-3-1 b), on a Strip of its own Facility it does not hold. Nobody else.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'efsp-entry-rights-'));
for (const [k, v] of Object.entries({
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH: 'incirlik.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER: 'center.json',
  CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL: 'tactical.json',
  CRCSYNC_EFSP_BOARD_SNAPSHOT_PATH: 'board.json',
  CRCSYNC_EFSP_MUTATION_LOG_PATH: 'mutations.jsonl',
  CRCSYNC_EFSP_AIRSPACES_PATH: 'airspaces.json',
})) process.env[k] = path.join(tmpDir, v);

fs.writeFileSync(process.env.CRCSYNC_EFSP_AIRSPACES_PATH, JSON.stringify({ Test: [
  // CENTER controls it, Incirlik uses it: OPS is its using agency.
  { airspaceId: 'MOA-INC', name: 'Incirlik MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', usingFacilityId: 'INCIRLIK', workingFrequencyMhz: 134.25 },
  // No using agency: the controlling Position acts for both sides.
  { airspaceId: 'MOA-CTR', name: 'Center MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 135.5 },
  // docs/adr/0125: whose airspace it is, never a block a flight is cleared into.
  { airspaceId: 'J-INC', name: 'Incirlik jurisdiction', kind: 'JURISDICTION', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', ownerPositionIds: ['AP'], airspaceClass: 'C', altUpperFt: 28000, geometry: { source: 'CIRCLE', centre: { lat: 37, lon: 35.4 }, radiusNm: 50 } },
] }));

const { createEfsp } = await import('../src/efsp/index.js');
const { crew, act, mustAct, airborneDeparture, DEPARTURE_FLIGHT_DATA } = await import('./helpers/efsp-scenario.mjs');

const ATC = { OPS: 'INCIRLIK', CD: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK', CTR: 'CENTER' };
let n = 0;
const fresh = () => {
  const efsp = createEfsp({ currentTheater: () => 'Test' });
  const c = crew(efsp, ATC);
  const strip = airborneDeparture(efsp, c, { ...DEPARTURE_FLIGHT_DATA, callsign: `RGT${++n}` });
  return { efsp, c, strip };
};

test('the using agency (OPS) approves entry on a Strip AP holds, and clears it again', () => {
  const { efsp, c, strip } = fresh();
  assert.equal(strip.ownerPositionId, 'AP');
  const approved = mustAct(efsp, c.OPS, 'OPS', strip, { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-INC' });
  assert.equal(approved.airspaceEntry.airspaceId, 'MOA-INC');
  assert.equal(approved.ownerPositionId, 'AP', 'the approval moves the radio, never the Strip');
  const cleared = mustAct(efsp, c.OPS, 'OPS', approved, { kind: 'ClearAirspaceEntry' });
  assert.equal(cleared.airspaceEntry, null);
});

test('the Position working the Strip relays the permission (para 9-3-1 NOTE)', () => {
  const { efsp, c, strip } = fresh();
  const approved = mustAct(efsp, c.AP, 'AP', strip, { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-INC' });
  assert.equal(approved.airspaceEntry.airspaceId, 'MOA-INC');
  mustAct(efsp, c.AP, 'AP', approved, { kind: 'ClearAirspaceEntry' });
});

test('a jurisdiction area is refused as an airspace entry (ADR 0125)', () => {
  const { efsp, c, strip } = fresh();
  const ack = act(efsp, c.AP, 'AP', strip, { kind: 'ApproveAirspaceEntry', airspaceId: 'J-INC' });
  assert.equal(ack.ok, false);
  assert.equal(ack.reason, 'VALIDATION_ERROR');
  assert.match(ack.detail, /jurisdiction area/);
});

test('OPS is no using agency for an airspace Incirlik does not use', () => {
  const { efsp, c, strip } = fresh();
  const ack = act(efsp, c.OPS, 'OPS', strip, { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-CTR' });
  assert.equal(ack.ok, false);
  assert.equal(ack.reason, 'PERMISSION_DENIED');
});

test('OPS may not clear an entry into an airspace it does not use', () => {
  const { efsp, c, strip } = fresh();
  const approved = mustAct(efsp, c.AP, 'AP', strip, { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-CTR' });
  const ack = act(efsp, c.OPS, 'OPS', approved, { kind: 'ClearAirspaceEntry' });
  assert.equal(ack.ok, false);
  assert.match(`${ack.reason} ${ack.detail || ''}`, /PERMISSION_DENIED|NOT_OWNER/);
  assert.equal(efsp.boardStoreFor('INCIRLIK').getStrip(strip.stripId).airspaceEntry.airspaceId, 'MOA-CTR');
});

test('a Position with neither the op nor the using agency is refused', () => {
  const { efsp, c, strip } = fresh();
  const ack = act(efsp, c.GC, 'GC', strip, { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-INC' });
  assert.equal(ack.ok, false);
  assert.equal(ack.reason, 'PERMISSION_DENIED');
});

test('the using agency still needs a live Strip of its own Facility', () => {
  const { efsp, c, strip } = fresh();
  const dropped = mustAct(efsp, c.AP, 'AP', strip, { kind: 'DropStrip' });
  const ack = act(efsp, c.OPS, 'OPS', dropped, { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-INC' });
  assert.equal(ack.ok, false);
});

test('an unknown airspace is refused before any rights question', () => {
  const { efsp, c, strip } = fresh();
  const ack = act(efsp, c.OPS, 'OPS', strip, { kind: 'ApproveAirspaceEntry', airspaceId: 'NOPE' });
  assert.equal(ack.ok, false);
  assert.equal(ack.reason, 'PERMISSION_DENIED', 'OPS is the using agency of no unknown airspace');
  const asAp = act(efsp, c.AP, 'AP', strip, { kind: 'ApproveAirspaceEntry', airspaceId: 'NOPE' });
  assert.equal(asAp.reason, 'VALIDATION_ERROR');
});
