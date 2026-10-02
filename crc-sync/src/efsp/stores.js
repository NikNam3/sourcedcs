'use strict';

// The persisted-store registry. Adding a persisted store means appending one
// entry here: createEfsp builds every entry, _persist snapshots every entry and
// _restore restores every entry, each by looping over this list.
//
//   key       the key in the persisted body (and in ctx.stores)
//   build     (deps) -> instance | null. deps = { clock, transitionAltFt, codeAllocator, mutationLog,
//             facilities, stores }. `facilities` (facilityId -> { boardStore, positionStore, rules }) is
//             filled after the stores are built, so a closure may read it lazily, never at build time.
//             `stores` fills in registry order as each entry is built.
//   audited   true: createEfsp hands the instance the Mutation log (setMutationLog)
//   snapshot  (store, all) -> json. A null store (sfaRotation where no Facility has an SFA) is the entry's own
//             concern. The ARRAY ORDER is the persisted body's JSON key order.
//   restore   (store, data, all) -> void, `data` being that key's value in the saved body. Skipped for a null store.
//             all = { facilities, stores, saved } (saved: the whole saved body).
//
// The body is written in registry order; it is restored in RESTORE_ORDER, which differs on purpose (the Boards are
// written first, but restore after the FDRs and airspaces they refer to). The restore steps that cross stores
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
const airspaceConfig = require('./airspace-config');
const carrierHulls = require('./carrier/hull-config');
const facilityConfig = require('./facility-config');
const log = require('../log').logger('efsp:stores');

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
    // The per-Facility BoardStores are built in createEfsp's Facility loop; the "store" here is that Map.
    build: ({ facilities }) => facilities,
    snapshot: (facilities) => {
      const boards = {};
      for (const [facilityId, { boardStore }] of facilities.entries()) boards[facilityId] = boardStore.snapshot();
      return boards;
    },
    restore: (facilities, data, { saved }) => {
      // Shape: { boards: { [facilityId]: boardSnapshot } }. Anything else is refused (ARCH-D5): the pre-WP4A
      // `board` key, a Facility this server does not have, a Strip in a state its Role does not have.
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
    build: ({ clock, transitionAltFt, codeAllocator }) => new FlightDataStore(codeAllocator, { clock, transitionAltFt }),
    snapshot: (s) => s.snapshot(),
    restore: (s, data) => s.restore(data),
  },
  {
    key: 'airspaces',
    audited: true,
    // One store for every Facility, like flightDataStore — an airspace is a theater
    // entity that NAMES its controlling Facility rather than being replicated
    // into each one. There is no D13 replication question here because nothing
    // is ever handed across a boundary; the record has exactly one home.
    build: ({ clock, facilities }) => new AirspaceStore(airspaceConfig, {
      clock,
      occupancyFor: (airspaceId) => {
        let n = 0;
        for (const { boardStore } of facilities.values()) {
          for (const s of boardStore.getAll()) {
            if (s.state !== 'DROPPED' && s.airspaceEntry && s.airspaceEntry.airspaceId === airspaceId) n++;
          }
        }
        return n;
      },
    }),
    snapshot: (s) => s.snapshot(),
    // Airspace STATE is durable (ADR 0002); the definitions come from config
    // on every boot, so restore() skips anything no longer configured and a
    // newly configured airspace simply starts available. No migration either
    // way — the same reasoning that keeps facility config out of the snapshot.
    restore: (s, data) => s.restore(data),
  },
  {
    key: 'correlations',
    audited: true,
    // WP5 (docs/adr/0045) — keyed by flightDataId, and shared across every Facility for the same reason flightDataStore is:
    // a correlation is a fact about one airframe, and both halves of a cross-Facility exchange are looking at
    // the same one. There is no D13 replication question here either — the record has one home.
    build: ({ clock, stores }) => new CorrelationStore({
      clock,
      flightDataExists: (flightDataId) => !!stores.flightData.getFlightData(flightDataId),
    }),
    snapshot: (s) => s.snapshot(),
    // Correlation records after the FDRs, since restore() skips any whose FDR
    // is gone. Every restored record comes back UNCORRELATED with its trackId
    // and its binding nulled — a persisted track id is a lie the moment the
    // process restarts, because DCS re-mints ids (docs/adr/0045).
    restore: (s, data) => s.restore(data),
  },
  {
    key: 'marsa',
    audited: true,
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
    build: ({ clock, stores }) => new MarsaStore({
      clock,
      flightDataExists: (flightDataId) => !!stores.flightData.getFlightData(flightDataId),
      setSeparationRegime: (flightDataId, separationRegime, { by } = {}) =>
        stores.flightData.setTofi(flightDataId, { separationRegime }, { by }),
    }),
    snapshot: (s) => s.snapshot(),
    // MARSA relations after the FDRs too, and for the opposite reason to the
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
    audited: true,
    // WP6 (docs/adr/0061), §9.7 — field state. One instance with
    // one record per Facility that has a runway inventory, for AirspaceStore's
    // reason — nothing about a runway is ever handed across a boundary.
    // Staffing is read lazily through `facilities`, the same
    // shape airspaceStore's occupancyFor has: an unstaffed acknowledger of a
    // runway change reverts or is skipped (decisions.md H20).
    build: ({ clock, facilities }) => new RunwayStatusStore(facilityConfig, {
      clock,
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
    // Field state comes back INTACT for MARSA's reason (docs/adr/0061): a
    // runway suspended for runway works is still suspended after a
    // crc-sync restart, and coming back OPEN would hand the next controller a
    // lie. Reconciled against the inventory, like the airspaces.
    restore: (s, data) => s.restore(data),
  },
  {
    key: 'carriers',
    audited: true,
    // docs/adr/0074 (ADR 0064 B6) — the carrier's Case, Marshal
    // stack and altimeter input, one record per hull. Shared across Facilities
    // like flightDataStore (there is exactly one CARRIER Facility; nothing is replicated).
    // Lane feeding reads CARRIER staffing lazily through `facilities`.
    build: ({ clock, facilities, stores }) => new CarrierStore({
      hulls: carrierHulls.getHulls(),
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
    // The banner is derived, so it is not restored; a stack entry whose FDR is
    // gone is dropped without closing up (docs/adr/0074).
    restore: (s, data) => {
      s.restore(data);
      const gone = s.evictMissingFlightDataList();
      if (gone) log.warn('dropped restored Marshal stack entries whose FDR is gone', { dropped: gone });
    },
  },
  {
    key: 'sfaRotation',
    audited: true,
    // docs/adr/0075, 0093 — which Position is on which Single
    // Frequency Approach frequency (guide §4.7). One record, for the Facility whose
    // config carries a `singleFrequencyApproach` (INCIRLIK); null where none does.
    build: ({ clock }) => {
      const sfaConfig = facilityConfig.getSingleFrequencyApproach();
      return sfaConfig
        ? new SfaStore({ config: sfaConfig, positions: facilityConfig.getPositionSet(), facilityId: facilityConfig.DEFAULT_FACILITY_ID, clock })
        : null;
    },
    snapshot: (s) => (s ? s.snapshot() : null),
    // The SFA rotation comes back INTACT, for the carrier's reason: who is on which
    // frequency is a controller declaration, and a restart does not change it.
    restore: (s, data) => s.restore(data),
  },
];

// The order the saved body is restored in (it is not the order it is written in, see above).
const RESTORE_ORDER = ['flightData', 'airspaces', 'boards', 'correlations', 'marsa', 'runwayStatuses', 'carriers', 'sfaRotation'];

module.exports = { REGISTRY, RESTORE_ORDER };
