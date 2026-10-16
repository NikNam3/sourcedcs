'use strict';

// The traffic model (briefing §5.2, as amended by decisions H46 and S-R2-6):
// profiles, crews and the flight scripts.
//
// A flight script is a generator. It yields an intent — create a Strip, act on
// one, walk one along its NLA chain, act on an airspace — and receives the
// outcome. The runner (driver.js) decides WHO acts (always the Strip's current
// owner, as the latest ack/broadcast/truth says, never an assumption), waits
// out disconnects, retries STALE_REV, and applies the intermediate edits and
// reorder storms. A script never asserts: a refusal is data, and the script
// simply ends; the janitor then drops whatever it left behind.

// SOURCE assumption, not a measured squadron figure (briefing §10 Q7):
// realistic = H46's 12 concurrent flights and 3 controllers; stress = 3x the
// rate with one controller signed on to every Position (H12's worst case).
const PROFILES = {
  realistic: {
    concurrentFlights: 12, spawnCheckS: [20, 60], thinkS: [15, 90],
    stormP: 0.2, stormMoves: [3, 6], stormPatterns: ['same-slot', 'top'],
    disconnectMeanMin: 45, disconnectsInRun: null, restarts: 1, reloadEveryMin: 120, reloadsInRun: null,
    conflictsPerHour: 2, manningChurnPerHour: 2, crew: 'three',
  },
  stress: {
    concurrentFlights: 36, spawnCheckS: [5, 20], thinkS: [0.5, 8],
    stormP: 0.4, stormMoves: [10, 30], stormPatterns: ['same-slot', 'top', 'ping-pong'],
    disconnectMeanMin: 5, disconnectsInRun: null, restarts: 3, reloadEveryMin: 20, reloadsInRun: null,
    conflictsPerHour: 4, manningChurnPerHour: 6, crew: 'solo',
  },
  smoke: {
    concurrentFlights: 10, spawnCheckS: [10, 30], thinkS: [2, 10],
    stormP: 0.3, stormMoves: [5, 5], stormPatterns: ['same-slot', 'top', 'ping-pong'],
    disconnectMeanMin: null, disconnectsInRun: 2, restarts: 1, reloadEveryMin: null, reloadsInRun: 1,
    conflictsPerHour: 3, manningChurnPerHour: 3, crew: 'three',
  },
};

const POSITION_FACILITY = {
  OPS: 'INCIRLIK', CD: 'INCIRLIK', GC: 'INCIRLIK', LC: 'INCIRLIK', AP: 'INCIRLIK',
  CTR: 'CENTER',
  TAC_C2: 'TACTICAL', AIC: 'TACTICAL', GCI: 'TACTICAL', JTAC: 'TACTICAL',
  SOUTH_RANGE: 'RANGES',
};

// Each member: { id, holds: { facilityId: [positionId...] }, observer? }.
// Declaration order matters: an observer must select after the Primary.
const CREWS = {
  three: [
    { id: 'ctl-cab', holds: { INCIRLIK: ['OPS', 'CD', 'GC', 'LC'] } },
    { id: 'ctl-radar', holds: { INCIRLIK: ['AP'], CENTER: ['CTR'] } },
    { id: 'ctl-tac', holds: { TACTICAL: ['TAC_C2'], RANGES: ['SOUTH_RANGE'] } },
  ],
  full: [
    { id: 'ctl-ops', holds: { INCIRLIK: ['OPS'] } },
    { id: 'ctl-cd', holds: { INCIRLIK: ['CD'] } },
    { id: 'ctl-gc', holds: { INCIRLIK: ['GC'] } },
    { id: 'ctl-lc', holds: { INCIRLIK: ['LC'] } },
    { id: 'ctl-ap', holds: { INCIRLIK: ['AP'] } },
    { id: 'ctl-ctr', holds: { CENTER: ['CTR'] } },
    { id: 'ctl-tac', holds: { TACTICAL: ['TAC_C2'] } },
    { id: 'ctl-range', holds: { RANGES: ['SOUTH_RANGE'] } },
    { id: 'obs-ap', holds: { INCIRLIK: ['AP'] }, observer: true },
  ],
  solo: [
    { id: 'ctl-solo', holds: { INCIRLIK: ['OPS', 'CD', 'GC', 'LC', 'AP'], CENTER: ['CTR'], TACTICAL: ['TAC_C2'], RANGES: ['SOUTH_RANGE'] } },
  ],
};

const SCRIPT_WEIGHTS = [
  ['civilRoundTrip', 30], ['departureOut', 20], ['popupArrival', 15],
  ['overflight', 10], ['militarySortie', 15], ['rangeVisit', 10],
];

// When a state-only NLA stays inhibited, the controller does what the sortie
// tests do (efsp-scenarios.test.mjs's jumpTo): set the state by hand.
const NLA_FALLBACK = {
  DEPARTURE: { PENDING_CLEARANCE: 'CLEARED', HELD: 'CLEARED', PUSHBACK: 'TAXI', RUNWAY_QUEUE: 'DEPARTED', LUAW: 'DEPARTED' },
  ARRIVAL: { HANDED_TO_TOWER: 'LANDED', FINAL: 'LANDED' },
  MISSION: { TASKED: 'AIRBORNE', AIRBORNE: 'ON_STATION', ON_STATION: 'OFF_STATION', OFF_STATION: 'RTB' },
  OVERFLIGHT: {},
};

const create = (actor, op) => ({ kind: 'create', actor, facilityId: POSITION_FACILITY[actor], op });
const act = (facilityId, stripId, op) => ({ kind: 'op', facilityId, stripId, op });
const walk = (facilityId, stripId, until, max = 12) => ({ kind: 'walk', facilityId, stripId, until, max });
const think = () => ({ kind: 'think' });

const CALLSIGN_PREFIX = {
  civilRoundTrip: 'THY', departureOut: 'RCH', popupArrival: 'PGT', overflight: 'SXS', militarySortie: 'VIPER', rangeVisit: 'HAWG',
};

function callsignFor(script, n) { return `${CALLSIGN_PREFIX[script]}${10 + (n % 90)}`; }

function departureFlightData(f) {
  return {
    callsign: f.callsign, aircraftType: f.script === 'militarySortie' || f.script === 'rangeVisit' ? 'F16' : 'B738', wakeCategory: 'M',
    departureAirport: 'LTAG', destinationAirport: f.script === 'departureOut' ? 'OJAI' : 'LTAG', route: 'DCT', requestedAltitude: '250',
  };
}

function* outboundToCenter(f, x) {
  const r0 = yield create('OPS', {
    kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: departureFlightData(f),
    // Order-key stress (briefing §5.2): some creates insert after the FIRST
    // Strip of a busy Rack, so repeated creates hit the same slot.
    ...(x.sameSlotCreate ? { afterStripId: '@first' } : {}),
  });
  if (!r0.ok) return null;
  const dep = r0.strip.stripId;
  const r1 = yield walk('INCIRLIK', dep, s => s.state === 'HANDED_OFF' && s.ownerPositionId === 'AP', 14);
  if (!r1.ok) return null;
  yield think();
  const released = x.rng.chance(0.7); // docs/adr/0122: released by default, sometimes not
  const r2 = yield act('INCIRLIK', dep, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'CENTER', toPositionId: 'CTR', released });
  if (!r2.ok || !r2.strip.coordination) return null;
  const ctr = r2.strip.coordination.peerStripId;
  f.own(ctr, 'CENTER');
  yield think();
  const r3 = yield act('CENTER', ctr, { kind: 'HANDOFF', action: 'ACCEPT' });
  if (!r3.ok) return null;
  yield* checkIn(x, 'CENTER', ctr, 'INCIRLIK', dep, released);
  return { dep, ctr };
}

/**
 * The pilot calls the receiver (docs/adr/0122): CHECKED_IN, and on a not-released handoff the receiver asks for a release
 * and the handing-off station grants it (control moves then; the soak has no airspace geometry for the control tick) or,
 * one time in five, refuses it. A refused request holds nothing beyond its Strip's `coordination.releaseRequest`, which
 * goes with the Strip (docs/wip/U-SMALL.md item 2).
 */
function* checkIn(x, rFacility, rStrip, tFacility, tStrip, released) {
  yield think();
  yield act(rFacility, rStrip, { kind: 'HANDOFF', action: 'CHECKED_IN' });
  if (released) return;
  yield think();
  const rq = yield act(rFacility, rStrip, { kind: 'ControlRelease', action: 'REQUEST' });
  if (!rq.ok) return;
  yield think();
  yield act(tFacility, tStrip, { kind: 'ControlRelease', action: x.rng.chance(0.8) ? 'GRANT' : 'REFUSE' });
}

function* homeFromCenter(f, x, ctr) {
  let r = yield act('CENTER', ctr, { kind: 'ConvertToArrival' });
  if (!r.ok) return false;
  yield think();
  const released = x.rng.chance(0.7);
  r = yield act('CENTER', ctr, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP', released });
  if (!r.ok || !r.strip.coordination) return false;
  const arr = r.strip.coordination.peerStripId;
  f.own(arr, 'INCIRLIK');
  yield think();
  r = yield act('INCIRLIK', arr, { kind: 'HANDOFF', action: 'ACCEPT' });
  if (!r.ok) return false;
  yield* checkIn(x, 'INCIRLIK', arr, 'CENTER', ctr, released);
  r = yield walk('INCIRLIK', arr, s => s.state === 'DROPPED', 10);
  return r.ok;
}

const SCRIPTS = {
  * civilRoundTrip(f, x) {
    const legs = yield* outboundToCenter(f, x);
    if (!legs) return;
    if (x.rng.chance(0.5)) yield act('INCIRLIK', legs.dep, { kind: 'DropStrip', reason: 'stale after handoff' });
    yield think();
    if (x.rng.chance(0.3)) {
      const r = yield act('CENTER', legs.ctr, { kind: 'ApproveAirspaceEntry', airspaceId: 'MOA-EAST' });
      if (r.ok) { yield think(); yield act('CENTER', legs.ctr, { kind: 'ClearAirspaceEntry' }); }
    }
    yield act('CENTER', legs.ctr, { kind: 'SetBlock', blockId: '24A', value: 'USING_AGENCY' });
    yield think();
    yield act('CENTER', legs.ctr, { kind: 'SetBlock', blockId: '24A', value: 'CONTROLLING_AGENCY' });
    yield think();
    const home = yield* homeFromCenter(f, x, legs.ctr);
    if (!home) return;
    yield act('CENTER', legs.ctr, { kind: 'DropStrip', reason: 'handed back' });
  },

  * departureOut(f, x) {
    const legs = yield* outboundToCenter(f, x);
    if (!legs) return;
    yield act('INCIRLIK', legs.dep, { kind: 'DropStrip', reason: 'handed to Center' });
    yield think();
    yield act('CENTER', legs.ctr, { kind: 'SetBlock', blockId: '21', value: `FL${x.rng.int(20, 36)}0` });
    yield think();
    yield act('CENTER', legs.ctr, { kind: 'SetBlock', blockId: '20', value: String(x.rng.int(1, 36) * 10).padStart(3, '0') });
    yield think();
    yield think();
    // CTR's replica sits at HANDED_OFF, whose NLA is the terminal Drop.
    const r = yield walk('CENTER', legs.ctr, s => s.state === 'DROPPED', 2);
    if (!r.ok) yield act('CENTER', legs.ctr, { kind: 'DropStrip', reason: 'left the airspace' });
  },

  * popupArrival(f, x) {
    if (x.rng.chance(0.5)) {
      // Pop-up: nobody handed it over, so AP originates it (coordination :154).
      const r = yield create('AP', {
        kind: 'CreateStrip', bayId: 'ap-inbound', rackId: 'main', stripType: 'ARRIVAL',
        flightData: { callsign: f.callsign, aircraftType: 'C130', wakeCategory: 'M', originAirport: 'LTAC', destinationAirport: 'LTAG' },
      });
      if (!r.ok) return;
      yield think();
      yield walk('INCIRLIK', r.strip.stripId, s => s.state === 'DROPPED', 10);
      return;
    }
    // Properly: CTR has it inbound, may point it out or call traffic to AP
    // first, then hands it across (board/coordination.js's `_applyCoordinationAccept`). An INBOUND ARRIVAL
    // is the one strip type/state CTR can propose coordination from besides a
    // HANDED_OFF departure (board/coordination.js's `_applyCoordinationPropose`, the (stripType, state) check).
    const r = yield create('CTR', {
      kind: 'CreateStrip', bayId: 'ctr-enroute', rackId: 'main', stripType: 'ARRIVAL',
      flightData: { callsign: f.callsign, aircraftType: 'C130', wakeCategory: 'M', originAirport: 'LTAC', destinationAirport: 'LTAG' },
    });
    if (!r.ok) return;
    const enroute = r.strip.stripId;
    yield think();
    if (x.rng.chance(0.4)) {
      const primitive = x.rng.chance(0.5) ? 'POINT_OUT' : 'TRAFFIC';
      const p = yield act('CENTER', enroute, { kind: primitive, action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' });
      if (p.ok && p.strip.coordination) {
        const replica = p.strip.coordination.peerStripId;
        f.own(replica, 'INCIRLIK');
        yield think();
        yield act('INCIRLIK', replica, { kind: primitive, action: x.rng.chance(0.75) ? 'ACCEPT' : 'REJECT' });
        yield think();
        yield act('INCIRLIK', replica, { kind: 'DropStrip', reason: 'point-out complete' });
      }
      yield think();
    }
    const h = yield act('CENTER', enroute, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' });
    if (!h.ok || !h.strip.coordination) return;
    const arr = h.strip.coordination.peerStripId;
    f.own(arr, 'INCIRLIK');
    yield think();
    const a = yield act('INCIRLIK', arr, { kind: 'HANDOFF', action: 'ACCEPT' });
    if (!a.ok) return;
    yield* checkIn(x, 'INCIRLIK', arr, 'CENTER', enroute, true);
    yield walk('INCIRLIK', arr, s => s.state === 'DROPPED', 10);
    yield act('CENTER', enroute, { kind: 'DropStrip', reason: 'handed to AP' });
  },

  * overflight(f, x) {
    // The guide's four states (docs/adr/0087): INBOUND -> IN_SECTOR -> HANDED_OFF
    // -> DROPPED. Half the flights are handed CTR -> AP by HANDOFF (F14 is
    // fixed: an IN_SECTOR overflight may propose coordination, and arrives
    // INBOUND at AP); the rest leave our airspace by NLA and are dropped.
    const r = yield create('CTR', {
      kind: 'CreateStrip', bayId: 'ctr-overflight', rackId: 'main', stripType: 'OVERFLIGHT',
      flightData: { callsign: f.callsign, aircraftType: 'A320', wakeCategory: 'M', originAirport: 'LTBA', destinationAirport: 'OJAI' },
    });
    if (!r.ok) return;
    const ctr = r.strip.stripId;
    yield think();
    yield walk('CENTER', ctr, s => s.state === 'IN_SECTOR', 2);
    yield think();
    if (x.rng.chance(0.5)) {
      const h = yield act('CENTER', ctr, { kind: 'HANDOFF', action: 'PROPOSE', toFacilityId: 'INCIRLIK', toPositionId: 'AP' });
      if (h.ok && h.strip.coordination) {
        const replica = h.strip.coordination.peerStripId;
        f.own(replica, 'INCIRLIK');
        yield think();
        const a = yield act('INCIRLIK', replica, { kind: 'HANDOFF', action: 'ACCEPT' });
        if (a.ok) {
          yield* checkIn(x, 'INCIRLIK', replica, 'CENTER', ctr, true);
          yield think();
          yield walk('INCIRLIK', replica, s => s.state === 'DROPPED', 4);
        }
      }
    }
    yield think();
    yield walk('CENTER', ctr, s => s.state === 'DROPPED', 3);
  },

  * militarySortie(f, x) {
    const legs = yield* outboundToCenter(f, x);
    if (!legs) return;
    yield think();
    let r = yield act('CENTER', legs.ctr, { kind: 'TOFI', action: 'PROPOSE', direction: 'ENTRY', toFacilityId: 'TACTICAL', toPositionId: 'TAC_C2' });
    if (!r.ok || !r.strip.tofiCoordination) return;
    const msn = r.strip.tofiCoordination.peerStripId;
    f.own(msn, 'TACTICAL');
    yield think();
    r = yield act('TACTICAL', msn, { kind: 'TOFI', action: 'ACCEPT', separationRegime: 'MARSA' });
    if (!r.ok) return;
    yield walk('TACTICAL', msn, s => s.state === 'ON_STATION', 3);
    yield think();
    yield act('TACTICAL', msn, { kind: 'TOFI', action: 'TRANSFER_COMMS' });
    yield think();
    yield think();
    r = yield act('CENTER', legs.ctr, { kind: 'TOFI', action: 'PROPOSE', direction: 'EXIT' });
    if (!r.ok) return;
    yield act('CENTER', legs.ctr, { kind: 'SetBlock', blockId: 'SREG', value: 'ATC' });
    yield think();
    r = yield act('TACTICAL', msn, { kind: 'TOFI', action: 'ACCEPT' });
    if (!r.ok) return;
    yield act('TACTICAL', msn, { kind: 'DropStrip', reason: 'mission complete' });
    yield think();
    const home = yield* homeFromCenter(f, x, legs.ctr);
    yield act('INCIRLIK', legs.dep, { kind: 'DropStrip', reason: 'stale after handoff' });
    if (home) yield act('CENTER', legs.ctr, { kind: 'DropStrip', reason: 'handed back' });
  },

  * rangeVisit(f, x) {
    yield { kind: 'ensureRangeActive' };
    const r0 = yield create('OPS', { kind: 'CreateStrip', bayId: 'ops-proposed', rackId: 'main', stripType: 'DEPARTURE', flightData: departureFlightData(f) });
    if (!r0.ok) return;
    const dep = r0.strip.stripId;
    const r1 = yield walk('INCIRLIK', dep, s => s.state === 'HANDED_OFF' && s.ownerPositionId === 'AP', 14);
    if (!r1.ok) return;
    yield think();
    const r2 = yield act('INCIRLIK', dep, { kind: 'ApproveAirspaceEntry', airspaceId: 'RANGE-SOUTH' });
    if (r2.ok) {
      yield think(); yield think();
      yield act('INCIRLIK', dep, { kind: 'ClearAirspaceEntry' });
    }
    yield think();
    yield walk('INCIRLIK', dep, s => s.state === 'DROPPED', 2);
  },
};

module.exports = { PROFILES, CREWS, POSITION_FACILITY, SCRIPT_WEIGHTS, SCRIPTS, NLA_FALLBACK, callsignFor };
