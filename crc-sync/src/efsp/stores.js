'use strict';

// The persisted-store registry. Adding a persisted store means appending one
// entry here: createEfsp builds every entry, _persist snapshots every entry and
// _restore restores every entry, each by looping over this list.
//
//   key       the key in the persisted body (and in ctx.stores)
//   build     (deps) -> instance | null. deps = { clock, transitionAltFt, onFlightDataWrite, currentTheater, codeAllocator, mutationLog,
//             facilities, stores }. `facilities` (facilityId -> { boardStore, positionStore, rules }) is
//             filled after the stores are built, so a closure may read it lazily, never at build time.
//             `stores` fills in registry order as each entry is built.
//   snapshot  (store, all) -> json. A null store (sfaRotation where no Facility has an SFA) is the entry's own
//             concern. The ARRAY ORDER is the persisted body's JSON key order.
//   restore   (store, data, all) -> void, `data` being that key's value in the saved body. Skipped for a null store.
//             all = { facilities, stores, saved } (saved: the whole saved body).
//
// The body is written in registry order; it is restored in RESTORE_ORDER, which differs on purpose (the Boards are
// written first, but restore after the flight data and airspaces they refer to). The restore steps that cross stores
// (_reconcileRestored, _reconcileLogTail) stay in index.js's _restore, after this loop.
//
// A future persisted-state `version` key and a per-store upgrade hook would go here (S3-4: not now).

const { FlightDataStore } = require('./flight-data-store');
const { AirspaceStore } = require('./airspace-store');
const { CorrelationStore } = require('./correlation-store');
const { MarsaStore } = require('./marsa-store');
const { RunwayStatusStore } = require('./runway-status-store');
const { CarrierStore } = require('./carrier-store');
const { SfaStore } = require('./sfa-store');
const authority = require('./authority');
const carrierHulls = require('./carrier/hull-config');
const { loadRecoveryTuning } = require('./carrier/recovery-tuning');
const log = require('../log').logger('efsp:stores');
const { anyOf, arrayOf, mapOf, checkShape } = require('../persisted-shape');

// The Blocks that held the assigned altitude and heading as Strip annotations before docs/adr/0058 moved them onto
// the flight record. A Strip that still has history in one is the old shape: the migration that moved it is gone
// (ARCH-D5), so it stops start-up instead of leaving a clearance silently invisible.
const PRE_0058_CLEARANCE_BLOCKS = {
  DEPARTURE: ['21', '20'],
  ARRIVAL: ['7', '9A-VECTOR'],
  OVERFLIGHT: ['7A', '9A-VECTOR'],
};

const REGISTRY = [
  {
    key: 'boards',
    // The per-Facility BoardStores (board-store.js) are built in createEfsp's Facility loop; the "store" here is that Map.
    build: ({ facilities }) => facilities,
    snapshot: (facilities) => {
      const boards = {};
      for (const [facilityId, { boardStore }] of facilities.entries()) boards[facilityId] = boardStore.snapshot();
      return boards;
    },
    restore: (facilities, data, { saved }) => {
      // Shape: { boards: { [facilityId]: boardSnapshot } }. Anything else is refused (ARCH-D5): the pre-WP4A
      // `board` key, a Facility this server does not have, a Strip in a state its strip type does not have.
      if (!data) {
        if (saved.board) throw new Error('[efsp] the Board snapshot is in the pre-WP4A shape (a top-level "board", no "boards"): delete state/efsp-board.json to start clean');
        return;
      }
      for (const [facilityId, boardData] of Object.entries(data)) {
        const f = facilities.get(facilityId);
        if (!f) throw new Error(`[efsp] the Board snapshot holds a Board for "${facilityId}", which is not a configured Facility (${[...facilities.keys()].join(', ')})`);
        for (const strip of (boardData && boardData.strips) || []) {
          if (!f.rules.isValidState(strip.state, strip.stripType)) {
            throw new Error(`[efsp] the Board snapshot holds Strip ${strip.stripId} (${facilityId}) in state "${strip.state}", which a ${strip.stripType} Strip does not have: delete state/efsp-board.json to start clean`);
          }
        }
        for (const strip of (boardData && boardData.strips) || []) {
          const old = (PRE_0058_CLEARANCE_BLOCKS[strip.stripType] || [])
            .filter(blockId => strip.annotations && strip.annotations[blockId] && (strip.annotations[blockId].entries || []).length);
          if (old.length) {
            throw new Error(`[efsp] the Board snapshot holds Strip ${strip.stripId} (${facilityId}) with its assigned altitude/heading as Strip annotations (Block ${old.join(', ')}; before docs/adr/0058): delete state/efsp-board.json to start clean`);
          }
        }
        f.boardStore.restore(boardData);
      }
    },
  },
  {
    key: 'flightData',
    build: ({ clock, transitionAltFt, codeAllocator, stereoRoutes, onFlightDataWrite }) => new FlightDataStore(codeAllocator, { clock, transitionAltFt, stereoRoutes, onWrite: onFlightDataWrite }),
    snapshot: (s) => s.snapshot(),
    restore: (s, data) => s.restore(data),
  },
  {
    key: 'airspaces',
    // The store's sync declaration (docs/adr/0106): `key` is its snapshot key, which is also the key of its heartbeat entry
    // and of its resync slice; `gapFromDeltas` says a delta moves seq by exactly one change, so a client may ask at once on a jump.
    sync: { key: 'airspaces', seqKey: 'airspaceSeq', epochKey: 'airspaceEpoch', deltaType: 'efsp-airspace-delta', gapFromDeltas: true },
    // The airspace REGISTRY (docs/adr/0098): definitions per theater and their state, one store for every Facility,
    // like flightDataStore. An airspace is a theater entity that NAMES its controlling Facility rather than being
    // replicated into each one, so there is no D13 replication question: the record has one home.
    build: ({ clock, currentTheater, facilities, stores, facilityConfig, mutationLog }) => {
      // The Strips working an AREA: non-DROPPED Strips whose `airspaceEntry` names it, on any Facility's Board.
      const occupantsFor = (airspaceId) => {
        const out = [];
        for (const { boardStore } of facilities.values()) {
          for (const s of boardStore.getAll()) {
            if (s.state === 'DROPPED' || !s.airspaceEntry || s.airspaceEntry.airspaceId !== airspaceId) continue;
            const fd = stores.flightData && stores.flightData.getFlightData(s.flightDataId);
            out.push({ stripId: s.stripId, callsign: (fd && fd.identity && fd.identity.callsign) || null, frequencyMhz: s.airspaceEntry.frequencyMhz ?? null });
          }
        }
        return out;
      };
      // A ROUTE's occupancy: the flights (distinct flight data: a handoff leaves a Strip on each Board for one flight)
      // with a non-DROPPED Strip whose flight data's MTR designator, normalised as flight-data-store writes it
      // (trimmed, upper case), is the route's id.
      const routeOccupancyFor = (airspaceId) => {
        const flights = new Set();
        for (const { boardStore } of facilities.values()) {
          for (const s of boardStore.getAll()) {
            if (s.state === 'DROPPED') continue;
            const fd = stores.flightData && stores.flightData.getFlightData(s.flightDataId);
            const d = fd && fd.military && fd.military.mtr && fd.military.mtr.designator;
            if (typeof d === 'string' && d.trim().toUpperCase() === airspaceId) flights.add(s.flightDataId);
          }
        }
        return flights.size;
      };
      return new AirspaceStore({
        clock, mutationLog, currentTheater, occupantsFor, routeOccupancyFor,
        facilityLookup: {
          hasFacility: (id) => facilityConfig.getFacilityIds().includes(id),
          positionsOf: (id) => (facilityConfig.getFacilityIds().includes(id) ? facilityConfig.getPositionSet(id) : []),
          facilityOfPosition: (positionId) => facilityConfig.getFacilityIds().find(f => facilityConfig.getPositionSet(f).includes(positionId)) || null,
        },
        authority: { rowOf: (positionId) => authority.airspaceRowFor(positionId, facilityConfig.getPositionClass) },
      });
    },
    snapshot: (s) => s.snapshot(),
    // Airspace definitions AND state are durable (ADR 0002, 0098): both come back from the one atomic snapshot, per
    // theater. The pre-0098 array shape is refused (R3-2). The standing list is applied after this, once per id.
    restore: (s, data) => s.restore(data),
  },
  {
    key: 'correlations',
    // The store's sync declaration (docs/adr/0106): `key` is its snapshot key, which is also the key of its heartbeat entry
    // and of its resync slice; `gapFromDeltas` says a delta moves seq by exactly one change, so a client may ask at once on a jump.
    sync: { key: 'correlations', seqKey: 'correlationSeq', epochKey: 'correlationEpoch', deltaType: 'efsp-correlation-delta', gapFromDeltas: false },
    // WP5 (docs/adr/0045) — keyed by flightDataId, and shared across every Facility for the same reason flightDataStore is:
    // a correlation is a fact about one airframe, and both halves of a cross-Facility exchange are looking at
    // the same one. There is no D13 replication question here either — the record has one home.
    build: ({ clock, stores, mutationLog }) => new CorrelationStore({
      mutationLog,
      clock,
      flightDataExists: (flightDataId) => !!stores.flightData.getFlightData(flightDataId),
    }),
    snapshot: (s) => s.snapshot(),
    // Correlation records after the flight data, since restore() skips any whose flight data
    // is gone. Every restored record comes back UNCORRELATED with its trackId
    // and its binding nulled — a persisted track id is a lie the moment the
    // process restarts, because DCS re-mints ids (docs/adr/0045).
    restore: (s, data) => s.restore(data),
  },
  {
    key: 'marsa',
    // The store's sync declaration (docs/adr/0106): `key` is its snapshot key, which is also the key of its heartbeat entry
    // and of its resync slice; `gapFromDeltas` says a delta moves seq by exactly one change, so a client may ask at once on a jump.
    sync: { key: 'marsa', seqKey: 'marsaSeq', epochKey: 'marsaEpoch', deltaType: 'efsp-marsa-delta', gapFromDeltas: false },
    // WP6 (docs/adr/0051) — shared across every Facility for the same reason flightDataStore and correlationStore
    // are: MARSA is a fact about a set of airframes, not about one Facility's Board, and both halves of a
    // cross-Facility exchange are looking at the same relation. There is no D13 replication question here
    // either — the record has one home, and its participants are flightDataIds, which are already theater-wide.
    //
    // setSeparationRegime is injected rather than reached for: the store must not
    // hold an FlightDataStore (correlation-store.js's flightDataExists precedent), and guide
    // §4.8.3 requires the regime to actually change when a flight enters a MARSA
    // block — "if a second controller takes TAC_C2 ten minutes later, the state
    // must already be correct, or they inherit a lie."
    build: ({ clock, stores, mutationLog }) => new MarsaStore({
      mutationLog,
      clock,
      flightDataExists: (flightDataId) => !!stores.flightData.getFlightData(flightDataId),
      setSeparationRegime: (flightDataId, separationRegime, { by } = {}) =>
        // A relation owns the regime (docs/adr/0051): whatever was waiting at a TOFI (docs/adr/0102) is dropped, never resurrected.
        stores.flightData.setTofi(flightDataId, { separationRegime, pendingSeparationRegime: null, pendingSince: null, pendingFacilityId: null, regimeEffective: null }, { by }),
    }),
    snapshot: (s) => s.snapshot(),
    // MARSA relations after the flight data too, and for the opposite reason to the
    // correlation case above: a relation comes back INTACT, state and all. A
    // persisted track id is a lie after a restart because DCS re-mints ids; a
    // persisted MARSA relation names flightDataIds and records a verbal declaration a
    // tanker crew made, which a crc-sync restart does not make untrue. Coming
    // back up with every AR silently reverted to ATC separation would be
    // §4.8.3's "second controller inherits a lie", caused by us.
    restore: (s, data) => s.restore(data),
  },
  {
    key: 'runwayStatuses',
    // The store's sync declaration (docs/adr/0106): `key` is its snapshot key, which is also the key of its heartbeat entry
    // and of its resync slice; `gapFromDeltas` says a delta moves seq by exactly one change, so a client may ask at once on a jump.
    sync: { key: 'runwayStatuses', seqKey: 'runwayStatusSeq', epochKey: 'runwayStatusEpoch', deltaType: 'efsp-runway-status-delta', gapFromDeltas: true },
    // WP6 (docs/adr/0061), §9.7 — runway status. One instance with
    // one record per Facility that has a runway inventory, for AirspaceStore's
    // reason — nothing about a runway is ever handed across a boundary.
    // Staffing is read lazily through `facilities`, the same
    // shape airspaceStore's occupancyFor has: an unstaffed acknowledger of a
    // runway change reverts or is skipped (decisions.md H20).
    build: ({ clock, facilities, facilityConfig, mutationLog }) => new RunwayStatusStore(facilityConfig, {
      clock, mutationLog,
      isStaffed: (facilityId, positionId) => {
        const f = facilities.get(facilityId);
        return !!f && f.positionStore.isStaffed(positionId);
      },
      primaryOf: (facilityId, positionId) => {
        const f = facilities.get(facilityId);
        return f ? f.positionStore.primaryOf(positionId) : null;
      },
    }),
    snapshot: (s) => s.snapshot(),
    // Runway status comes back INTACT for MARSA's reason (docs/adr/0061): a
    // runway suspended for runway works is still suspended after a
    // crc-sync restart, and coming back OPEN would hand the next controller a
    // lie. Reconciled against the inventory, like the airspaces.
    restore: (s, data) => s.restore(data),
  },
  {
    key: 'carriers',
    // The store's sync declaration (docs/adr/0106): `key` is its snapshot key, which is also the key of its heartbeat entry
    // and of its resync slice; `gapFromDeltas` says a delta moves seq by exactly one change, so a client may ask at once on a jump.
    sync: { key: 'carriers', seqKey: 'carrierSeq', epochKey: 'carrierEpoch', deltaType: 'efsp-carrier-delta', gapFromDeltas: false },
    // docs/adr/0074 (ADR 0064 B6), 0113 — the carrier's Case, Marshal
    // stack and the overrides over the ship's state, one record per hull. Shared across Facilities
    // like flightDataStore (there is exactly one CARRIER Facility; nothing is replicated).
    // Lane feeding reads CARRIER staffing lazily through `facilities`.
    build: ({ clock, facilities, stores, mutationLog }) => new CarrierStore({
      mutationLog,
      hulls: carrierHulls.getHulls(),
      tuning: loadRecoveryTuning(process.env.CRCSYNC_EFSP_CARRIER_RECOVERY_PATH),
      clock,
      flightDataExists: (flightDataId) => !!stores.flightData.getFlightData(flightDataId),
      isStaffed: (positionId) => {
        const f = facilities.get('CARRIER');
        return !!f && f.positionStore.isStaffed(positionId);
      },
    }),
    snapshot: (s) => s.snapshot(),
    // The carrier's Case and stack come back INTACT, MARSA's reasoning: they are
    // controller declarations, and a restart does not change what PriFly set.
    // The banner is derived, so it is not restored; a stack entry whose flight data is
    // gone is dropped without closing up (docs/adr/0074).
    restore: (s, data) => {
      s.restore(data);
      const gone = s.evictMissingFlightDataList();
      if (gone) log.warn('dropped restored Marshal stack entries whose flight data is gone', { dropped: gone });
    },
  },
  {
    key: 'sfaRotation',
    // The store's sync declaration (docs/adr/0106): `key` is its snapshot key, which is also the key of its heartbeat entry
    // and of its resync slice; `gapFromDeltas` says a delta moves seq by exactly one change, so a client may ask at once on a jump.
    sync: { key: 'sfaRotation', seqKey: 'sfaSeq', epochKey: 'sfaEpoch', deltaType: 'efsp-sfa-delta', gapFromDeltas: true },
    // docs/adr/0075, 0093 — which Position is on which Single
    // Frequency Approach frequency (guide §4.7). One record, for the Facility whose
    // config carries a `singleFrequencyApproach` (INCIRLIK); null where none does.
    build: ({ clock, facilityConfig, mutationLog }) => {
      const sfaConfig = facilityConfig.getSingleFrequencyApproach();
      return sfaConfig
        ? new SfaStore({ config: sfaConfig, positions: facilityConfig.getPositionSet(), facilityId: facilityConfig.DEFAULT_FACILITY_ID, clock, mutationLog })
        : null;
    },
    snapshot: (s) => (s ? s.snapshot() : null),
    // The SFA rotation comes back INTACT, for the carrier's reason: who is on which
    // frequency is a controller declaration, and a restart does not change it.
    restore: (s, data) => s.restore(data),
  },
];

// ── The persisted shape (H88 item 8, decisions.md S-RENA2) ──────────────────────────────────────────────────────
// Every key the snapshot may hold, as one data structure next to the restore code: a key the build does not know is
// an unknown persisted shape and stops start-up, naming the file and the key path, before any store restores (the
// file is left untouched). It catches a snapshot written in the old vocabulary (`fdrs`, `fdrId`, `role`, ...), which
// would otherwise restore half-read. A future persisted `version` key (S3-4) would pick one of several such shapes.
// The shape notation (true, { k }, '[]', '*') is persisted-shape.js's.

const STRIP_HANDOFF = anyOf('at', 'by', 'from', 'fromStripType', 'kind', 'label', 'to', 'toStripType', 'trigger', 'frequencyRackId');
const STRIP_SHAPE = {
  ...anyOf('stripId', 'cid', 'flightDataId', 'rev', 'stripType', 'state', 'ownerPositionId', 'bayId', 'rackId', 'orderKey',
    'annotations', 'flags', 'createdAt', 'updatedAt', 'updatedBy', 'consolidatedFrom', 'diverts', 'endReason', 'joinedInto', 'splitFrom'),
  coordination: anyOf('primitive', 'state', 'note', 'peerFacilityId', 'peerPositionId', 'peerStripId', 'mintedForCoordination',
    'dataOwnerPositionRef', 'separationResponsibilityRef', 'radarIdTransferred', 'lastForwardedEtaUtc',
    'comms', 'control', 'release', 'releaseRequest', 'repair',
    'initiatedAt', 'initiatedBy', 'acceptedAt', 'acceptedBy', 'lastStandByAt'),
  tofiCoordination: anyOf('direction', 'state', 'note', 'peerFacilityId', 'peerPositionId', 'peerStripId', 'mintedForTofi',
    'initiatedAt', 'initiatedBy', 'acceptedAt', 'acceptedBy', 'commsTransferred', 'commsTransferredAt', 'commsTransferredBy'),
  airspaceEntry: anyOf('airspaceId', 'altitudeBlock', 'approvedAt', 'approvedBy', 'frequencyMhz'),
  carrierHandoff: STRIP_HANDOFF,
  sfaTransfer: STRIP_HANDOFF,
  previousLeg: anyOf('annotations', 'convertedAt', 'convertedBy', 'flags', 'stripType'),
};
const FLIGHT_DATA_SECTIONS = {
  identity: anyOf('aircraftType', 'beaconAssigned', 'beaconObserved', 'callsign', 'degradation', 'equipmentCodes',
    'equipmentSuffix', 'flightSize', 'homeStation', 'modeOne', 'modeTwo', 'splitFrom', 'tailNumber', 'trackDegradationFlag', 'unit', 'wakeCategory'),
  filed: anyOf('arrivalFix', 'departureAirport', 'departureRunway', 'destinationAirport', 'estimatedArrivalTimeUtc',
    'fullRouteClearance', 'originAirport', 'proposedDepartureTimeUtc', 'remarks', 'requestedAltitude', 'route', 'stereoRouteName'),
  assigned: anyOf('atisCode', 'callForReleaseTimeUtc', 'callForReleaseWindowEndUtc', 'callForReleaseWindowStartUtc',
    'clearedAltitude', 'clearedRoute', 'datalinkClearanceIndicator', 'delayInfo', 'departureRelease', 'edctTimeUtc',
    'edctWindowEndUtc', 'edctWindowStartUtc', 'landingRunway', 'movementAreaEntryTimeUtc', 'releaseTimeUtc', 'takeoffTimeUtc',
    'taxiTimeUtc', 'voidDeadlineUtc', 'voidTimeUtc'),
  military: {
    ...anyOf('alertStatus', 'altrvRef', 'carrier', 'fuelState', 'hookRequired', 'mtr', 'ordnanceState', 'releaseAuthority', 'scl'),
    arInfo: { ...anyOf('asReceiver', 'asTanker'),
      links: arrayOf(anyOf('arcp', 'peerCallsign', 'peerFlightDataId', 'peerLineId', 'peerMissionNumber', 'stripType', 'windows')) },
  },
  mission: anyOf('controllingAgency', 'missionNumber', 'packageId', 'vulWindowEndUtc', 'vulWindowStartUtc'),
  tofi: { ...anyOf('changedAt', 'changedBy', 'ifrActive', 'pendingFacilityId', 'pendingSeparationRegime', 'pendingSince', 'radarService', 'separationRegime'),
    regimeEffective: anyOf('airspaceId', 'at', 'by', 'facilityId', 'trigger') },
  comms: anyOf('airspaceId', 'changedAt', 'changedBy', 'transitions', 'workingFrequencyMhz'),
  airspace: anyOf('changedAt', 'changedBy', 'owner', 'transitions'),
  clearance: anyOf('altitude', 'heading', 'speed'),
  timeInputs: anyOf('flightPlanDepartureUtc', 'takeoffStampedUtc'),
};
// provenance is flat, keyed by the dotted path it records ('assigned.departureRelease', 'military.mtr.entryFix'), or by a
// whole section ('ato', 'tofi', 'military').
const MTR_FIELDS = ['designator', 'entryFix', 'entryTimeUtc', 'exitEstimateUtc', 'exitFix', 'requestedAltitudeAfterExit'];
const PROVENANCE_SHAPE = anyOf('ato', 'tofi',
  ...Object.entries(FLIGHT_DATA_SECTIONS).flatMap(([section, keys]) => [section, ...Object.keys(keys).map(k => `${section}.${k}`)]),
  ...MTR_FIELDS.map(k => `military.mtr.${k}`));
const FLIGHT_DATA_SHAPE = {
  ...anyOf('flightDataId', 'rev', 'createdAt', 'updatedAt', 'updatedBy', 'ato', 'trackRef', 'clearanceUpdatedAt', 'voided'),
  ...FLIGHT_DATA_SECTIONS,
  provenance: PROVENANCE_SHAPE,
};
const PAD_SHAPE = anyOf('name', 'accessRoute', 'occupied', 'occupantFlightDataId');
const ENTRY_SHAPES = {
  boards: mapOf({
    strips: arrayOf(STRIP_SHAPE),
    cidSeq: true,
    // [cmid, record] pairs; the record is sync/replay-cache.js's replayRecord
    replay: arrayOf(arrayOf(anyOf('ok', 'reason', 'detail', 'warnings', 'routedTo', 'selfCoordinated', 'stripId', 'flightDataId',
      'peerFacilityId', 'peerStripId', 'appliedWallAt'))),
    droppedWallAt: true,
  }),
  flightData: { flightDataList: arrayOf(FLIGHT_DATA_SHAPE), codes: true, codeCursor: true },
  airspaces: {
    byTheater: mapOf(arrayOf(anyOf('airspaceId', 'theater', 'definition', 'defRev', 'definitionHistory', 'lastDenial', 'pendingRequest',
      'rev', 'state', 'transitions', 'updatedAt', 'updatedBy', 'window'))),
    seeded: mapOf(true),
  },
  correlations: arrayOf(anyOf('binding', 'confidence', 'flightDataId', 'lastMatchedAt', 'matchedBy', 'observedBeacon', 'rev', 'state',
    'trackId', 'transitions', 'updatedAt', 'updatedBy', 'warning')),
  marsa: arrayOf(anyOf('declaredBy', 'declaredPositionId', 'declaringCallsign', 'endCondition', 'endedAt', 'endedBy', 'marsaId', 'note',
    'participants', 'rendezvousAt', 'rendezvousBy', 'rev', 'startEvent', 'startedAt', 'state', 'transitions', 'updatedAt', 'updatedBy',
    'voidedBy', 'voidedDetail')),
  runwayStatuses: arrayOf({
    ...anyOf('activeRunway', 'activeRunwaySource', 'facilityId', 'rev', 'runwayChange', 'runways', 'transitions', 'updatedAt',
      'updatedBy', 'windDerivedSession'),
    alertPad: PAD_SHAPE, hotCargoPad: PAD_SHAPE,
  }),
  carriers: arrayOf({
    ...anyOf('hullId', 'recoveryCase', 'rev', 'transitions'),
    overrides: anyOf('altimeterInHg', 'brcDeg', 'ceilingFt', 'finalBearingDeg', 'firstFixDme', 'marshalRadialDeg', 'rampTimeUtc',
      'tankerAltitudeFt', 'tankerGiveKlb', 'tankerOnStation', 'tankerPatternSide', 'tankerSideNumber', 'visibilityNm', 'windOverDeckKt'),
    stacks: mapOf({ ...anyOf('deltaMs', 'hullId', 'stackId'),
      entries: arrayOf(anyOf('caseIAngels', 'eatUtc', 'flightDataId', 'pushedAtUtc', 'stackIndex', 'status', 'unpassed')) }),
  }),
  sfaRotation: anyOf('facilityId', 'rev', 'rotation', 'transitions'),
};
// The top level is the registry's keys plus the write stamp _persist adds; nothing else.
const PERSISTED_SHAPE = { persistedWallAt: true, ...Object.fromEntries(REGISTRY.map(e => [e.key, ENTRY_SHAPES[e.key]])) };

/** Throws naming `file` and the first key path the shape does not know. */
function checkPersistedShape(data, file, shape = PERSISTED_SHAPE) {
  const fix = 'delete state/efsp-board.json and state/efsp-mutations.jsonl to start clean';
  checkShape(data, shape, {
    // An array where the shape expects an object is an older shape (e.g. the pre-ADR-0098 airspaces array): refused, never half read.
    arrayWhereObject: (at) => new Error(`[efsp] the Board snapshot ${file} holds an array at "${at}", which this build keeps as an object (an unknown persisted shape, H88; an older build's?): ${fix}`),
    unknownKey: (at) => new Error(`[efsp] the Board snapshot ${file} has an unknown key "${at}" (an unknown persisted shape, H88; an older build's names?): ${fix}`),
  });
}

// The stores that resync by snapshot slice (docs/adr/0106): the registry entries with a `sync` declaration, with the
// registry key to find the instance in `ctx.stores`.
const STORE_SYNC = REGISTRY.filter(e => e.sync).map(e => ({ registryKey: e.key, ...e.sync }));

// The order the saved body is restored in (it is not the order it is written in, see above).
const RESTORE_ORDER = ['flightData', 'airspaces', 'boards', 'correlations', 'marsa', 'runwayStatuses', 'carriers', 'sfaRotation'];

module.exports = { STORE_SYNC, REGISTRY, RESTORE_ORDER, PERSISTED_SHAPE, checkPersistedShape };
