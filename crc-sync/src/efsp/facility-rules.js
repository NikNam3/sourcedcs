'use strict';

// The `rules` one Facility's Board is built with (board-store.js, required-rules.js): what the Board asks of everything
// outside it. Most entries forward to a module (`permission`, `blockMap`, `nla`, the Facility's config view) with this
// Facility's id filled in; the rest are closures over the shared stores (one per process) and over `facilities`, which is
// filled in as the Facilities are built, so a cross-Facility lookup reads it at call time, never at build time.
// Moved out of createEfsp (index.js) so that function keeps only the order things are built in (ARCH-S #9).

const carrierModel = require('./carrier');
const sfaModel = require('./sfa');
const parFinal = require('./par-final');
const permission = require('./permission');
const authority = require('./authority');
const nla = require('./nla');
const blockMap = require('./block-map');
const coordination = require('./coordination');
const { createDivertDestinations } = require('./divert-destination');
const icaoByName = require('../../data/icao.json');

/**
 * @param {object} deps
 * @param {string} deps.facilityId
 * @param {object} deps.facilityConfig
 * @param {object} deps.permissionRules `permission.createPermission({ classOf })`
 * @param {object} deps.positionStore this Facility's PositionStore
 * @param {Map<string, {boardStore:object}>} deps.facilities every Facility's Board, filled in as they are built
 * @param {{airspaceStore:object, marsaStore:object, runwayStatusStore:object, carrierStore:object}} deps.stores the shared stores
 * @param {(flightDataId:string, forFacilityId:string) => object} deps.regimeLocator the TOFI regime locator (regime-locator.js)
 */
function buildFacilityRules({ facilityId, facilityConfig, permissionRules, positionStore, facilities, stores, regimeLocator }) {
  const { airspaceStore, marsaStore, runwayStatusStore, carrierStore } = stores;
  // docs/adr/0111 §3: a field we run is one a Facility config names, or a carrier hull.
  const divertDestinationFor = createDivertDestinations({
    airportIcaos: () => facilityConfig.getFacilityIds().map(id => (facilityConfig.getFacilityConfig(id).runwayStatus || {}).airportIcao).filter(Boolean),
    hullIds: () => carrierStore.hullIds(),
    icaoByName,
  });
  return {
    divertDestinationFor,
    resolveBlockTarget:  (blockId, stripType) => blockMap.resolveBlockTarget(stripType, blockId),
    isBlockVisible:      (stripType, blockId) => facilityConfig.isBlockVisible(stripType, blockId, facilityId),
    bayImpliesState:     (bayId) => facilityConfig.bayImpliesState(bayId, facilityId),
    bayHoldsStripType:        (bayId) => facilityConfig.bayHoldsStripType(bayId, facilityId),
    bayExists:           (bayId) => facilityConfig.bayExists(bayId, facilityId),
    bayForImpliedState:  (positionId, state) => facilityConfig.bayForImpliedState(positionId, state, facilityId),
    coordinationBayFor:  (positionId) => facilityConfig.coordinationBayFor(positionId, facilityId),
    computeNla:          (strip, flightData, now, ctx) => nla.computeNla(strip, flightData, now, ctx),
    isValidState:        (state, stripType) => nla.isValidState(state, stripType),
    isValidStripType:         (stripType) => blockMap.isValidStripType(stripType),
    isStaffed:          (positionId) => positionStore.isStaffed(positionId),
    consolidatedAt: (positionId) => positionStore.consolidatedAt(positionId),
    handBackTo: (positionId) => positionStore.handBackTo(positionId),
    canMutate:           (actingPositionId, opKind) => permissionRules.canMutate(actingPositionId, opKind),
    canMutateAction:     (actingPositionId, opKind, action) => permissionRules.canMutateAction(actingPositionId, opKind, action),
    // docs/adr/0101 — which control axis (TURNS, ALTITUDE) a Block write is, from the Block Map's own tags.
    controlAxisFor:      (stripType, blockId) => blockMap.controlAxisFor(stripType, blockId),
    canCreateStripType:  (actingPositionId, stripType) => permission.canCreateStripType(actingPositionId, stripType),
    canActOnState:       (actingPositionId, stripType, state) => permission.canActOnState(actingPositionId, stripType, state),
    isSelfCoordinated:   (controllerId, positionId) => positionStore.isSelfCoordinated(controllerId, positionId),
    // docs/adr/0080 — the tactical capability table and the Bay lookups the
    // ownership, hand-back and consolidation rules read.
    baysFor:             (positionId) => facilityConfig.getBaysFor(positionId, facilityId),
    handBackTargetsFor:  (positionId) => permission.handBackTargetsFor(positionId),
    mayActBesideOwner:   (actingPositionId, strip, op) => permission.mayActBesideOwner(actingPositionId, strip, op),
    // WP4A (docs/adr/0015) — this Facility's own id, and a lazy accessor
    // to the OTHER Facility's BoardStore instance for cross-Facility
    // coordination. Lazy (a closure over `facilities`, resolved at call
    // time, not at construction time) because both Facilities'
    // BoardStore instances don't exist yet on the first iteration of
    // this loop — see the wiring loop below.
    facilityId,
    // WP4A (docs/adr/0017) — this Facility's own standing-release
    // envelopes (facility-config.js data, §4.6.2), a plain array rather
    // than a function since it's cheap, small config, not derived state.
    standingReleases: facilityConfig.getFacilityConfig(facilityId).standingReleases || [],
    // WP4A gap-closure (docs/adr/0022) — is a written directive on file
    // for AIT at this Facility? Guide §4.6 rule 7: "configuration, not a
    // default." Plain config value, same shape as standingReleases above.
    aitAuthorized: !!facilityConfig.getFacilityConfig(facilityId).aitAuthorized,
    peerBoard: (otherFacilityId) => {
      const other = facilities.get(otherFacilityId);
      return other ? other.boardStore : null;
    },
    // How many live (non-DROPPED) Strips still reference this flight data, across
    // EVERY Facility, excluding one Strip by id. Deliberately global rather
    // than this Facility's own Board: the FlightDataStore and its CodeAllocator
    // are shared across all Facilities (see this file's module comment),
    // so "is anyone still using this beacon code" is only answerable by
    // looking at all of them. Same lazy-closure-over-`facilities` shape as
    // peerBoard above, for the same construction-order reason.
    liveStripsForFlightData: (flightDataId, excludeStripId) => {
      let n = 0;
      for (const { boardStore } of facilities.values()) {
        for (const s of boardStore.getAll()) {
          if (s.flightDataId === flightDataId && s.stripId !== excludeStripId && s.state !== 'DROPPED') n++;
        }
      }
      return n;
    },
    formationEligibility: (stripType) => authority.formationEligibility(stripType),
    coordinationEffect: (primitive) => coordination.coordinationEffect(primitive),
    // WP4A gap-closure (docs/adr/0022) — which EfspState a strip type
    // must be in to PROPOSE a coordination link (see coordination.js).
    coordinationEligibleState: (stripType) => coordination.coordinationEligibleState(stripType),
    tofiEligibleState: (stripType) => coordination.tofiEligibleState(stripType),
    // WP4A second slice — TOFI's target resolution (permission.js).
    tofiCounterparts: (actingPositionId) => permission.tofiCounterparts(actingPositionId),
    // The RANGE slice — the airspace an entry approval names, so the Strip
    // op can default the frequency from it and see whether it is active.
    // The store is shared across every Facility, so this rule is the same
    // function for all of them.
    airspaceFor: (airspaceId) => airspaceStore.getAirspace(airspaceId),
    // WP6 (docs/adr/0051), §9.2 — the three hooks MARSA needs inside a Strip
    // Mutation. All three are plain closures over the one shared store, with
    // no per-Facility scoping, because a relation is not a Facility's
    // property: a tanker worked by CENTER and a receiver worked by INCIRLIK
    // are in one relation, and a clearance issued at either end must void it.
    //
    // marsaInterlockFor is the Block Map lookup rather than a list of Block
    // ids held in the Board — see block-map.js's interlockFor() for why
    // that separation matters (the same Block id means opposite things on
    // different strip types).
    marsaInterlockFor:       (stripType, blockId) => blockMap.interlockFor(stripType, blockId),
    voidMarsaForAssignment:  (flightDataId, ctx) => marsaStore.voidForAssignment(flightDataId, ctx),
    activeMarsaFor:          (flightDataId) => marsaStore.activeFor(flightDataId),
    regimeLocation:          (flightDataId, forFacilityId) => regimeLocator(flightDataId, forFacilityId),
    retireMarsaForFlightData:       (flightDataId, by) => marsaStore.onFlightDataRetired(flightDataId, by),
    // Ending or voiding a relation writes `tofi.separationRegime` back to
    // ATC on every participant. Those flight data writes are real changes no
    // marsa-delta can carry (a relation is not flight data), so the Board drains
    // them onto its own result and efsp-ws.js puts them in the board-delta's
    // `flightDataList.updated` — see marsa-store.js's drainRegimeWrites() (F-111).
    drainMarsaRegimeWrites:  () => marsaStore.drainRegimeWrites(),
    // WP6 (docs/adr/0061), §9.7 rule 1 — this Facility's runway status view
    // (null where there are no runways, which never inhibits). Cached in the
    // store, so every NLA stamp can afford to ask.
    runwayStatusFor:           () => runwayStatusStore.statusView(facilityId),
    // docs/adr/0074 — the carrier hooks the Board reads (board/strip-ops.js). The NLA out of
    // IN_STACK depends on the Case and on the staffed lane the stack feeds.
    carrierCase:             () => carrierStore.caseValue(),
    carrierLaneFor:          (strip) => carrierStore.laneFor(strip.flightDataId),
    carrierInStack:          (strip) => carrierStore.inStack(strip.flightDataId),
    canRecordCarrierHandoff: (actingPositionId, kind) => permission.canRecordCarrierHandoff(actingPositionId, kind),
    validateCarrierHandoff: (kind, args) => carrierModel.validateCarrierHandoff(kind, args),
    carrierHandoffs:        carrierModel.CARRIER_HANDOFFS,
    carrierApplyEffect:      (effect, flightDataId, meta) => carrierStore.applyEffect(effect, flightDataId, meta),
    carrierAppendFlight:     (flightDataId, meta) => carrierStore.appendFlight(flightDataId, meta),
    carrierRetireFlight:     (flightDataId, by) => carrierStore.onFlightDataRetired(flightDataId, by),
    // docs/adr/0093 — Bay descriptor flags (`capacity`, `view`); docs/adr/0117 — the single frequency approach and the
    // PAR final. All plain reads of the one Facility config or the capability table, so they are the same functions for
    // every Facility (a Facility without an SFA Bay or a final controller answers null).
    bayDescriptor:           (bayId) => facilityConfig.getBay(bayId, facilityId),
    sfaFrequencyFor:         (bayId, rackId) => sfaModel.frequencyForRack(facilityConfig.getBay(bayId, facilityId), facilityConfig.getSingleFrequencyApproach(facilityId), rackId),
    sfaRackFor:              (bayId, mhz) => sfaModel.rackForFrequency(facilityConfig.getBay(bayId, facilityId), facilityConfig.getSingleFrequencyApproach(facilityId), mhz),
    conversionFor:           (strip, targetBayId) => parFinal.conversionFor(strip, facilityConfig.bayImpliesState(targetBayId, facilityId), facilityId),
    finalReceiver:           () => permission.finalReceiver(),
    canHandOffToFinal:       (actingPositionId) => permission.canHandOffToFinal(actingPositionId),
    canRecordFinalCall:      (actingPositionId) => permission.canRecordFinalCall(actingPositionId),
  };
}

module.exports = { buildFacilityRules };
