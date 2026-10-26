// A registry store wired to a fake Facility lookup and the REAL authority rows, for the airspace tests (ADR 0098).
// RANGE_* Positions are class USING_AGENCY, standing in for the derived RANGES Facility.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { AirspaceStore } = require('../../src/efsp/airspace-store.js');
const authority = require('../../src/efsp/authority');

export const FACILITIES = {
  INCIRLIK: ['OPS', 'CD', 'GC', 'LC', 'AP', 'SFA', 'PAR'],
  CENTER: ['CTR'],
  TACTICAL: ['TAC_C2', 'AIC', 'GCI', 'JTAC'],
  CARRIER: ['CV_MARSHAL'],
  RANGES: ['RANGE_1_CONTROL'],
};

export const lookup = {
  hasFacility: (id) => id in FACILITIES,
  positionsOf: (id) => FACILITIES[id] || [],
  facilityOfPosition: (p) => Object.keys(FACILITIES).find(f => FACILITIES[f].includes(p)) || null,
};

const rowOf = (id) => authority.airspaceAuthority.rowFor(id, {
  familyRows: authority.AIRSPACE_ROWS,
  classOf: (p) => ((p || '').startsWith('RANGE_') ? 'USING_AGENCY' : null),
});

// The Position classes the transit decider reads (docs/adr/0128): an MRU using agency decides, a BASOPS one does not.
export const CLASSES = { TAC_C2: 'MRU', GCI: 'MRU', AIC: 'MRU_POSITION', OPS: 'BASOPS', CTR: 'CIVIL_ATC', AP: 'MILITARY_ATC' };

export const THEATER = 'Test';

export const MOA = { airspaceId: 'MOA-1', name: 'Test MOA', type: 'MOA', controllingFacilityId: 'CENTER', controllingPositionId: 'CTR', workingFrequencyMhz: 134.25 };
export const RANGE = { airspaceId: 'RANGE-1', name: 'Test Range', type: 'RESTRICTED', controllingFacilityId: 'INCIRLIK', controllingPositionId: 'AP', usingPositionId: 'RANGE_1_CONTROL', controlFrequencyMhz: 283.5 };
export const SQUARE = { source: 'POLYGON', points: [[36.0, 35.0], [36.0, 36.0], [37.0, 36.0], [37.0, 35.0]] };

/**
 * @param {{defs?:object[], theater?:string|null, occupants?:object, routeCount?:number, clock?:object,
 *   flights?:Object<string, {callsign:string|null, ifr:boolean, holders:{facilityId:string, positionId:string}[]}>}} [o]
 *   `flights` is what a transit op sees of each flight (docs/adr/0128 `transitFlight`); `state.flights` may change later.
 */
export function makeRegistry({ defs = [MOA, RANGE], theater = THEATER, occupants = {}, routeCount = 0, clock, mutationLog = null, flights = {} } = {}) {
  const state = { theater, occupants, routeCount, flights };
  const store = new AirspaceStore({
    ...(clock ? { clock } : {}),
    currentTheater: () => state.theater,
    occupantsFor: (id) => state.occupants[id] || [],
    routeOccupancyFor: () => state.routeCount,
    facilityLookup: lookup,
    authority: { rowOf, classOf: (p) => CLASSES[p] || null },
    mutationLog,
    transitFlight: (id) => state.flights[id] || null,
  });
  if (defs.length) {
    const r = store.apply({ op: { kind: 'ImportAirspaces', theater: THEATER, source: 'STANDING', definitions: defs } },
      { service: 'SQUADRON_ADMIN', via: 'WEB', controllerId: 'seed', positionId: null });
    if (!r.ok) throw new Error(r.detail);
  }
  return { store, state };
}

export const panel = (positionId, controllerId = 'c1') => ({ positionId, controllerId, via: 'PANEL' });
export const admin = (controllerId = 'web-user') => ({ service: 'SQUADRON_ADMIN', via: 'WEB', controllerId, actorName: 'Web User', positionId: null });

/** A state op the way the old tests drove it: baseRev = the current one. */
export function stateOp(store, airspaceId, op, positionId, by = 'c1') {
  const record = store.getAirspace(airspaceId);
  return store.apply({ airspaceId, baseRev: record ? record.rev : 0, op }, panel(positionId, by));
}
