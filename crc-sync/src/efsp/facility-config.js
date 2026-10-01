'use strict';

// Facility adaptation layer (EFSPImplementationGuide.md §8) — Position set,
// Bay/Rack definitions, the covering chain, and the Bay-implies-State
// mapping. Persisted JSON config, same pattern as theater-settings.js/
// apt-config.js: loaded once at require time, mutated and re-persisted
// through setters, survives a crc-sync restart. "The configurability is the
// specification" (§8.1) — even though this module ships no facility-config
// *editing* UI, the load/persist path exists from the start so a future
// editor is additive, not a retrofit.
//
// WP4A (docs/adr/0013) added a second Facility, `CENTER` (Ankara Center,
// Position `CTR`) — every exported function now takes an OPTIONAL trailing
// `facilityId` parameter defaulting to DEFAULT_FACILITY_ID ('INCIRLIK'), so
// every zero-arg call site that predates WP4A keeps compiling and behaving
// identically. `configs` is a Map keyed by facilityId rather than a single
// module-level object — see docs/adr/0013-facility-config-multi-facility.md.
//
// Bay sets below are the guide's own §4.2 defaults, restricted to the
// Positions each Facility actually has. Each ATC Position's `Coordination`
// Bay was present-but-inert through Phase 2 (guide §16's build-sequencing
// note: "an empty-but-present Coordination Bay" is the WP4A seam) — it's
// now genuinely used by the 5 new coordination-primitive Mutations
// (permission.js's OP_KINDS) to land a proposed cross-Facility Strip
// replica. `bayImpliesState` (guide §3.5 rule 4 / §2 "Bay membership
// expresses operational state") only covers Bays whose name cleanly maps to
// one EfspState — Filed/Taxi In/Arrivals/every Coordination Bay have none.

const fs = require('fs');
const blockMap = require('./block-map');
const fieldState = require('./field-state'); // pure, requires nothing back (docs/adr/0061)
const { validateAlertPadConfig } = require('./alert-scramble'); // pure (docs/adr/0070)
// Required BEFORE this module builds its configs Map: the RANGES Facility's
// Position set is derived from the airspace definitions (see
// DEFAULT_RANGES_CONFIG). airspace-config.js deliberately does not require
// this module back, so there is no cycle.
const airspaceConfig = require('./airspace-config');
const { readPath, writePath, ensureDirFor } = require('../state-paths');

const DEFAULT_FACILITY_ID = 'INCIRLIK';

// Overridable so tests exercise the mutate/persist path against a temp
// file — same pattern as theater-settings.js's CRCSYNC_THEATER_SETTINGS_PATH.
// One env var per Facility, so a test can override either (or both)
// independently without the two Facilities' on-disk state colliding.
// `setFacilityConfig` rewrites these, so each has a read path (data/ if a live
// copy exists, else the shipped default) and a write path (always data/) — see
// state-paths.js for why that split exists at all.
const FACILITY_CONFIG_FILES = {
  INCIRLIK: ['efsp-facility-incirlik.json', process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH],
  CENTER: ['efsp-facility-center.json', process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CENTER],
  // WP4A second slice — the TACTICAL Facility (docs/adr/0013's pattern
  // repeated for a third Facility).
  TACTICAL: ['efsp-facility-tactical.json', process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_TACTICAL],
  // docs/adr/0074 — the CARRIER Facility (docs/adr/0064 B1).
  CARRIER: ['efsp-facility-carrier.json', process.env.CRCSYNC_EFSP_FACILITY_CONFIG_PATH_CARRIER],
};

/** Kept as a name->path map for any existing reader; resolved fresh per call. */
const FACILITY_CONFIG_PATHS = new Proxy({}, {
  get: (_t, facilityId) => {
    const entry = FACILITY_CONFIG_FILES[facilityId];
    return entry ? writePath(entry[0], entry[1]) : undefined;
  },
  has: (_t, facilityId) => facilityId in FACILITY_CONFIG_FILES,
  ownKeys: () => Object.keys(FACILITY_CONFIG_FILES),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});

// RANGES is deliberately absent from the path table above: its Position set
// is DERIVED from airspace-config.js, so an on-disk override would freeze a
// `positions` array that then silently goes stale the moment an airspace is
// added or removed. Deriving it every boot is the whole point — there is
// nothing here a facility config could usefully say. Also spares a
// load-failure warning on every startup for a file that should never exist.
const DERIVED_FACILITY_IDS = new Set(['RANGES']);

const DEFAULT_CONFIG = {
  facility: 'INCIRLIK',
  positions: ['OPS', 'CD', 'GND', 'TWR', 'RSU', 'APP', 'SFA', 'PAR'],
  // WP4A second slice — every Position's doctrinal class (guide §4.1's own
  // Class column), read by permission.js's getPositionClass() to gate the
  // cross-Facility coordination primitives and TOFI structurally rather
  // than by a hand-maintained per-ID list alone (docs/adr/0020's own
  // directive). INCIRLIK has no MRU/NON_ATC Positions, so nothing here is
  // ever excluded from coordination by class — CD/GND/TWR/OPS are excluded
  // today purely because they don't sit on a Facility boundary, a
  // different, pre-existing reason (see permission.js).
  // RSU, SFA and PAR (docs/adr/0075, L18) are MILITARY_ATC too. RSU's "advisory,
  // no separation authority" is a permission matter (permission.js's
  // INCIRLIK_CAPABILITIES), never a new class: a new class would silently drop
  // STCA (station-coverage.js's ATC_CLASSES, docs/adr/0041's inclusion-list trap).
  positionClasses: { OPS: 'BASOPS', CD: 'MILITARY_ATC', GND: 'MILITARY_ATC', TWR: 'MILITARY_ATC', RSU: 'MILITARY_ATC', APP: 'MILITARY_ATC', SFA: 'MILITARY_ATC', PAR: 'MILITARY_ATC' },
  // The one character an ATC scope draws on a contact this Position owns
  // (docs/adr/0088, the STARS "position symbol"). [SOURCE-DEFINED].
  positionLetters: { OPS: 'O', CD: 'D', GND: 'G', TWR: 'T', RSU: 'R', APP: 'A', SFA: 'S', PAR: 'P' },
  // Still ends at APP, deliberately NOT extended to CTR — the covering
  // chain (guide §4.5 rule 3, §4.8.6) is an INTRAFACILITY occupancy-
  // fallback mechanism ("route to the covering Position within this
  // Facility"), a different thing from the cross-Facility HANDOFF
  // primitive's own PROPOSE/ACCEPT flow (§4.6). APP has no covering
  // Position within INCIRLIK, same as before WP4A. See
  // docs/adr/0013-facility-config-multi-facility.md.
  // SFA and PAR fall back to APP (guide §4.8.6). RSU is deliberately absent, as
  // OPS is and PriFly is on the carrier: a Strip must never strand on a
  // supervisory Position (docs/adr/0075).
  coveringChain: { CD: 'GND', GND: 'TWR', TWR: 'APP', SFA: 'APP', PAR: 'APP' },
  // Which radars each Position works through (docs/adr/0042, docs/adr/0043).
  // [SOURCE-DEFINED]: which scope sits at which console is squadron data, not
  // doctrine, and the guide says nothing about it.
  //
  // Selectors, never radar ids. A radar's id is derived from live mission data
  // (`apt:Incirlik` exists only while that theater is loaded), so a persisted
  // list of ids is the exact shape docs/adr/0041 condemned — right the day it
  // is written, silently empty the next time the data moves. A selector is
  // resolved against whatever radars the current mission actually produced.
  //
  // An empty array is a statement, not an omission: Operations, Clearance
  // Delivery and Ground have no scope, which is the fact docs/adr/0033 leans
  // on, and a controller holding only those correctly sees nothing.
  positionRadars: {
    OPS: [],
    CD: [],
    GND: [],
    TWR: [{ kind: 'airport', airport: 'LTAG' }],
    // [SOURCE-DEFINED] (docs/adr/0075): RSU watches the field and the visual
    // pattern, so the airport radar; SFA works the same picture as APP; PAR is
    // the precision approach radar alone.
    RSU: [{ kind: 'airport', airport: 'LTAG' }],
    APP: [{ kind: 'approach', airport: 'LTAG' }, { kind: 'airport', airport: 'LTAG' }],
    SFA: [{ kind: 'approach', airport: 'LTAG' }, { kind: 'airport', airport: 'LTAG' }],
    PAR: [{ kind: 'approach', airport: 'LTAG' }],
  },
  // Per-role visible-Block set (guide §8.2/§8.3) — defaults to "every Block
  // block-map.js defines for that role", i.e. nothing is hidden by default.
  // A facility MAY narrow this (e.g. omit optional 9A sub-fields), but
  // validateConfig() below enforces the doctrinal exceptions (every
  // required Block MUST stay visible) rather than just checking shape.
  // Blocks this Facility hides, by Role (guide §8.2's "a facility MAY narrow
  // this"). Empty by default — nothing is hidden anywhere, and a Block added
  // later stays visible without anyone regenerating a config file.
  hiddenBlocks: {},
  bays: {
    OPS: [
      // ops-proposed listed FIRST deliberately — it's what bayForImpliedState's
      // "no match, fall back to this Position's first Bay" default resolves
      // to, and what a Strip dropped on OPS's Position tab generally (not a
      // specific Bay tab) lands in via _defaultBayFor (crc-desktop's
      // bay-view.js). ops-filed is no longer an ordinary Strip-holding Bay
      // at all client-side (its content is the client-local filed-plan
      // queue, guide-analogous to the search pseudo-Bay — see
      // docs/efsp-usage-guide.md §4) — a Strip landing there by accident
      // would become invisible, so it must never be anyone's "default" Bay.
      { bayId: 'ops-proposed', rackIds: ['main'], impliesState: 'PROPOSED' },
      { bayId: 'ops-filed',    rackIds: ['main'] },
      { bayId: 'ops-field-state',   rackIds: ['main'] }, // an inert Strip container: the field-state BOARD is not Strips, it is its own dock panel (docs/adr/0061)
      { bayId: 'ops-coordination',  rackIds: ['main'] }, // no cross-Facility primitive reaches OPS this slice — inert
    ],
    CD: [
      { bayId: 'cd-pending-clearance', rackIds: ['main'], impliesState: 'PENDING_CLEARANCE' },
      { bayId: 'cd-cleared',           rackIds: ['main'], impliesState: 'CLEARED' },
      { bayId: 'cd-held',              rackIds: ['main'], impliesState: 'HELD' },
      { bayId: 'cd-coordination',      rackIds: ['main'] }, // inert this slice
    ],
    GND: [
      { bayId: 'gnd-pushback', rackIds: ['main'], impliesState: 'PUSHBACK' },
      { bayId: 'gnd-taxi-out', rackIds: ['main'], impliesState: 'TAXI' },
      { bayId: 'gnd-taxi-in',  rackIds: ['main'], impliesState: 'TAXI_IN' },
      { bayId: 'gnd-coordination', rackIds: ['main'] }, // inert this slice
    ],
    TWR: [
      { bayId: 'twr-runway-queue', rackIds: ['rwy-05', 'rwy-23'], impliesState: 'RUNWAY_QUEUE' }, // one Rack per runway, guide §4.2
      { bayId: 'twr-airborne',     rackIds: ['main'], impliesState: 'DEPARTED' },
      { bayId: 'twr-arrivals',     rackIds: ['main'], impliesState: 'HANDED_TO_TOWER' },
      // NOTE: EfspState 'FINAL' (this Bay's implied state, on strip.state)
      // is unrelated to Strip Role 'FINAL' (guide §7.10's PAR/carrier
      // role, WP7A, still unbuilt — lives on strip.role) — see nla.js's
      // module comment. Don't conflate them when WP7A eventually lands.
      { bayId: 'twr-final',        rackIds: ['main'], impliesState: 'FINAL' },
      { bayId: 'twr-landed',       rackIds: ['main'], impliesState: 'LANDED' },
      { bayId: 'twr-coordination', rackIds: ['main'] }, // inert this slice
    ],
    // The Bay descriptor flags (docs/adr/0093). `view` names the client component
    // a Bay mounts: 'pattern' = pattern-board.js, 'final' = final-panel.js,
    // 'sfa-freqs' = the rotation header over the frequency racks. `replacesRacks`
    // says the component IS the Bay's interface and its Strip racks are not drawn
    // (RSU and PAR; the carrier's Bays keep their racks, whose buttons are L17's).
    // `capacity` caps the Strips the Bay holds; the Bay refuses one more (§7.10).
    RSU: [
      // A leg is a Rack (ADR 0064: pattern legs are Racks, not states).
      { bayId: 'rsu-pattern', rackIds: ['closed', 'initial', 'base', 'final'], impliesState: 'IN_PATTERN', view: 'pattern', replacesRacks: true },
    ],
    APP: [
      { bayId: 'app-inbound',      rackIds: ['main'], impliesState: 'INBOUND' },   // receives ARRIVAL Strips via CTR's real HANDOFF (docs/adr/0014, superseding docs/adr/0008's local stub) AND self-originated pop-up ARRIVALs (docs/adr/0023)
      { bayId: 'app-departures',   rackIds: ['main'], impliesState: 'HANDED_OFF' }, // receives DEPARTURE Strips from TWR's real Hand Off (docs/adr/0007)
      // docs/adr/0023 — a flight transiting APP's delegated airspace
      // without landing or departing at Incirlik (guide §2's OVERFLIGHT
      // Strip Role), self-originated by APP directly (no sending Facility
      // to receive a coordination proposal from).
      { bayId: 'app-overflight',   rackIds: ['main'], holdsRole: 'OVERFLIGHT' }, // implies no state (docs/adr/0087): one Bay for every live overflight state
      // WP4A hook (APP<->CTR) — no longer inert: receives proposed
      // HANDOFF/POINT_OUT/TRAFFIC/AIT replicas from CTR (docs/adr/0015).
      { bayId: 'app-coordination', rackIds: ['main'] },
    ],
    // One Rack per assigned frequency (guide §4.2). A Strip's frequency is its
    // own attribute (the FDR's working frequency); the Rack it sits in is that
    // frequency, and the controller rotates onto it (§4.7, D17).
    SFA: [
      { bayId: 'sfa-frequencies', rackIds: ['freq-1', 'freq-2', 'freq-3', 'freq-4', 'freq-5'], impliesState: 'INBOUND', view: 'sfa-freqs' },
    ],
    PAR: [
      { bayId: 'par-final',  rackIds: ['main'], impliesState: 'ON_FINAL', view: 'final', replacesRacks: true, capacity: 1 }, // one Strip at a time (§7.10)
      { bayId: 'par-missed', rackIds: ['main'], impliesState: 'BOLTER_WAVEOFF' }, // "Missed approach": FINAL's own state, as the carrier's Bolter Bay
    ],
  },
  // Guide §4.7, docs/adr/0075: Single Frequency Approach. `jurisdiction` holds the
  // rotation of `rotationSize` frequencies out of `pool` (at least five discrete
  // UHF frequencies); the pool's rackIds ARE the SFA Bay's Racks. [SOURCE-DEFINED]:
  // the frequencies are placeholders, and so is who starts on which one. Read once
  // at startup, never written by code (P5); the live record is sfa-store.js's.
  singleFrequencyApproach: {
    jurisdiction: 'APP',
    rotationSize: 3,
    pool: [
      { rackId: 'freq-1', mhz: 232.1 },
      { rackId: 'freq-2', mhz: 233.1 },
      { rackId: 'freq-3', mhz: 234.1 },
      { rackId: 'freq-4', mhz: 235.1 },
      { rackId: 'freq-5', mhz: 236.1 },
    ],
    initialRotation: { 'freq-1': 'APP', 'freq-2': 'SFA', 'freq-3': 'PAR' },
  },
  // §4.6.1's data-only-facility 3-minute-verification obligation only
  // branches when the RECEIVING Facility is data-only — neither Facility
  // built this slice is (INCIRLIK/CENTER both have a real controller
  // interface), so this stays false on both, exercised only by a
  // synthetic test fixture. See docs/adr/0021-forwarding-obligations.md.
  dataOnly: false,
  // §4.6.2's standing-release envelopes — APP's own config (CTR has none;
  // a standing release is granted BY the delegating/center facility TO the
  // approach facility, guide §4.6.2's own wording: "the agreement normally
  // converts the per-flight call into a standing release for a named
  // envelope"). Empty by default; a real envelope is facility-config data,
  // not code (release-envelope.js's matchesStandingRelease()).
  standingReleases: [],
  // AIT is configuration, not a default (guide §4.6 rule 7) — false until
  // a real written directive is on file (docs/adr/0022).
  aitAuthorized: false,
  // Guide §9.7 field state — the runway INVENTORY only (docs/adr/0061). Which
  // runways, ends and gear exist is config, read once at startup and never
  // written by code (decisions.md P5); status, suspension, the active end and
  // any runway change are runtime state in field-state-store.js. Shape checked
  // by field-state.js's validateFieldStateInventory.
  //
  // [SOURCE-DEFINED] — every value below is squadron data, not doctrine:
  fieldState: {
    airportIcao: 'LTAG', // whose mission wind picks the active end at load (decisions.md H22)
    runways: [
      {
        // One record per PHYSICAL runway (decisions.md S-Q23): runway works
        // close the pavement in both directions.
        runwayId: '05/23',
        ends: ['05', '23'],
        // TRUE headings, because DCS reports wind in degrees true and an end's
        // number is magnetic. Approximate — the squadron should verify.
        endHeadingsTrue: { '05': 56, '23': 236 },
        rackIds: { '05': 'rwy-05', '23': 'rwy-23' }, // twr-runway-queue's one Rack per end
        // DCS does not simulate arresting wires (decisions.md H17): the gear is
        // the §9.7 data shape and nothing more. None shipped.
        arrestingGear: [],
      },
    ],
    // Guide §9.7 rule 3; OPS stands in for the SOF. Coordination, not
    // permission (decisions.md H20): an acknowledger nobody holds when the
    // change is proposed is skipped and audited — never a deadlock. No
    // cross-Facility reversion (decisions.md S-R2-15).
    runwayChangeAcknowledgers: ['OPS', 'APP'],
    // Narrows permission.js's CompleteInspection row; it can never widen it.
    inspectionAuthorityPositionId: 'OPS',
    // Named placeholders only, no geometry or preferred direction (decisions.md
    // H21). L12 (hot cargo) and L13 (alert pad) give them meaning.
    // alert.accessRoute: the route §9.6 keeps clear for alert scrambles, marked
    // constrained while one is active (docs/adr/0070). [SOURCE-DEFINED]
    // placeholder name (H21) — squadron data, not doctrine.
    pads: { hotCargo: { name: 'Hot cargo pad' }, alert: { name: 'Alert pad', accessRoute: 'ALERT ACCESS TAXIWAY' } },
  },
};

// [SOURCE-DEFINED] WP4A (docs/adr/0013) — the guide gives no published
// default Bay set for CENTER/CTR (only INCIRLIK's §4.2 table is grounded).
// docs/adr/0020 originally scoped CTR to ARRIVAL-shaped en-route strips
// only; docs/adr/0022 narrowly corrects that — CTR can now also RECEIVE a
// handed-off DEPARTURE Strip via APP's own HANDOFF (the mirror of CTR's
// existing ARRIVAL HANDOFF to APP), with a Drop-only terminus, same as
// APP's own DEPARTURE terminus today. No further DEPARTURE lifecycle
// stages exist at CTR beyond that — the TACTICAL Facility/MRU Positions/
// D12 audit/TOFI deferral from ADR 0012 still stands untouched.
const DEFAULT_CENTER_CONFIG = {
  facility: 'CENTER',
  positions: ['CTR'],
  positionClasses: { CTR: 'CIVIL_ATC' },
  // The one character an ATC scope draws on a contact this Position owns
  // (docs/adr/0088, the STARS "position symbol"). [SOURCE-DEFINED].
  positionLetters: { CTR: 'C' },
  // CTR has no covering Position this slice — mirrors OPS's "absent from
  // the chain" precedent (there is no second civil ATC Position upstream
  // of CTR built yet).
  coveringChain: {},
  // [SOURCE-DEFINED] — every airfield's approach radar in the theater, which
  // is how an en-route Position gets an en-route picture. `airport: '*'`
  // matches whatever airfields the loaded mission has, so this selector needs
  // no editing when the theater changes (docs/adr/0043).
  positionRadars: {
    CTR: [{ kind: 'approach', airport: '*' }],
  },
  // Blocks this Facility hides, by Role (guide §8.2's "a facility MAY narrow
  // this"). Empty by default — nothing is hidden anywhere, and a Block added
  // later stays visible without anyone regenerating a config file.
  hiddenBlocks: {},
  bays: {
    CTR: [
      { bayId: 'ctr-enroute',           rackIds: ['main'], impliesState: 'INBOUND' },
      // docs/adr/0022 — receives a DEPARTURE Strip handed off from APP;
      // mirrors app-departures' exact shape (INCIRLIK's own DEPARTURE
      // terminus Bay).
      { bayId: 'ctr-departures',        rackIds: ['main'], impliesState: 'HANDED_OFF' },
      // docs/adr/0023 — a flight transiting CENTER's airspace without
      // landing or departing at Incirlik at all (guide §2's OVERFLIGHT
      // Strip Role), self-originated by CTR directly.
      { bayId: 'ctr-overflight',        rackIds: ['main'], holdsRole: 'OVERFLIGHT' }, // implies no state (docs/adr/0087)
      { bayId: 'ctr-app-coordination',  rackIds: ['main'] }, // WP4A seam — proposed HANDOFF/POINT_OUT/TRAFFIC/OPERATIONAL_REQUEST/AIT replicas from APP land here
    ],
  },
  dataOnly: false,
  standingReleases: [],
  aitAuthorized: false, // docs/adr/0022 — configuration, not a default
};

// [SOURCE-DEFINED] WP4A second slice (docs/adr/0025) — the TACTICAL
// Facility and its 4 MRU/non-ATC Positions (TAC_C2, AIC, GCI, JTAC), the
// deferred remainder of WP4A per docs/adr/0020. No guide-published default
// Bay set exists for TACTICAL (only INCIRLIK's §4.2 table is grounded) —
// this follows the guide's own §4.2 Bay-name table for TAC_C2/AIC/GCI
// verbatim, plus a read-only viewing Bay for JTAC (guide §4.1: "MISSION
// (read-only)" — enforced by JTAC never being granted ownership/mutation
// rights anywhere in permission.js, not by a separate mechanism here).
const DEFAULT_TACTICAL_CONFIG = {
  facility: 'TACTICAL',
  positions: ['TAC_C2', 'AIC', 'GCI', 'JTAC'],
  positionClasses: { TAC_C2: 'MRU', GCI: 'MRU', AIC: 'MRU_POSITION', JTAC: 'NON_ATC' },
  // One letter for the whole tactical side: an ATC scope shows `M` on a
  // flight under tactical control after TOFI (docs/adr/0088, H48).
  positionLetters: { TAC_C2: 'M', AIC: 'M', GCI: 'M', JTAC: 'M' },
  // AIC/GCI -> TAC_C2 is a legal INTRAFACILITY covering-chain entry (stays
  // inside this Facility's own PositionStore instance). TAC_C2 -> CTR is
  // deliberately NOT extended here, even though the guide's own §4.8.6
  // text writes it as one chain — that hop crosses a Facility boundary,
  // and position-store.js's coveringPositionFor() is structurally scoped
  // to one Facility's own PositionStore (ADR 0013 point 4 already rejected
  // extending APP -> CTR the identical way, after an earlier draft tried
  // it and was reverted). An unoccupied TAC_C2 with no successor is an
  // accepted "warn the controller, route nowhere" stranding case per guide
  // §4.8.6 rule 5 ("warn, do not block"), not a silent gap.
  // JTAC -> TAC_C2 too (docs/adr/0080): a JTAC who walks away leaves the line
  // with the Position that handed it over, not stranded with nobody.
  coveringChain: { AIC: 'TAC_C2', GCI: 'TAC_C2', JTAC: 'TAC_C2' },
  // [SOURCE-DEFINED] — a Military Radar Unit in DCS works off the airborne
  // picture: own-coalition AWACS and fighter radars, and the datalink, which
  // names its own aircraft without a radar return (docs/adr/0059).
  // `coalition: 'own'` resolves against CRCSYNC_COALITION.
  //
  // JTAC gets none: guide §4.1 makes it read-only and non-ATC, and nothing
  // about a JTAC implies a radar scope.
  positionRadars: {
    TAC_C2: [{ kind: 'awacs', coalition: 'own' }, { kind: 'fighter', coalition: 'own' }, { kind: 'datalink' }],
    AIC: [{ kind: 'awacs', coalition: 'own' }, { kind: 'fighter', coalition: 'own' }, { kind: 'datalink' }],
    GCI: [{ kind: 'awacs', coalition: 'own' }, { kind: 'fighter', coalition: 'own' }, { kind: 'datalink' }],
    JTAC: [],
  },
  // Blocks this Facility hides, by Role (guide §8.2's "a facility MAY narrow
  // this"). Empty by default — nothing is hidden anywhere, and a Block added
  // later stays visible without anyone regenerating a config file.
  hiddenBlocks: {},
  bays: {
    TAC_C2: [
      { bayId: 'tac-c2-tasked',       rackIds: ['main'], impliesState: 'TASKED' },
      { bayId: 'tac-c2-airborne',     rackIds: ['main'], impliesState: 'AIRBORNE' },
      { bayId: 'tac-c2-on-station',   rackIds: ['main'], impliesState: 'ON_STATION' },
      { bayId: 'tac-c2-tanker',       rackIds: ['main'] }, // guide's own Bay name — inert this slice, no AR-line/tanker join until WP7
      { bayId: 'tac-c2-coordination', rackIds: ['main'] }, // TOFI lands here — a genuinely used Coordination Bay
    ],
    AIC: [
      { bayId: 'aic-on-station',   rackIds: ['main'], impliesState: 'ON_STATION' },
      { bayId: 'aic-committed',    rackIds: ['main'] },
      { bayId: 'aic-coordination', rackIds: ['main'] }, // present but inert — AIC never holds a TOFI grant (permission.js)
    ],
    GCI: [
      { bayId: 'gci-on-station',   rackIds: ['main'], impliesState: 'ON_STATION' },
      { bayId: 'gci-committed',    rackIds: ['main'] },
      { bayId: 'gci-coordination', rackIds: ['main'] }, // TOFI lands here, same as TAC_C2's
    ],
    JTAC: [
      { bayId: 'jtac-mission', rackIds: ['main'] }, // read-only viewing Bay — ownership/permission alone enforces read-only
    ],
  },
  dataOnly: false,
  standingReleases: [],
  aitAuthorized: false,
};

// The RANGES Facility (guide §4.1's fifth Facility, §4.1 rule 2). Unlike
// every Facility above it, this one's Position set is DERIVED rather than
// listed: a `RANGE` Position exists only for an airspace that has real
// control of its own (airspace-config.js's usingPositionId). An ordinary MOA
// contributes no Position at all — a flight working inside one is approved
// onto a working frequency by whichever ATC Position owns the airspace, and
// there is nobody else to be.
//
// `bays` is empty and stays empty. §4.1: "RANGE works no Strips... Give it a
// Field State board", §4.2: "Airspace board (not a strip rack)". Its board is
// airspace-store.js, which is not a Bay of Strips, so there is nothing for
// getAllBays() to return here — and because the client builds its Position
// tabs from Bays, a range Position correctly never grows a strip-rack tab.
//
// Absent from `coveringChain` deliberately: the chain exists to re-route
// Strips away from a vacated Position (defect D19), and a Position that owns
// no Strips has none to strand.
// The CARRIER Facility (docs/adr/0064 B1, docs/adr/0074; guide §4.1, §9.12).
// [SOURCE-DEFINED] where the guide is silent.
//  - All four Positions are MILITARY_ATC ("Military ATC afloat"): a new class
//    would silently lose STCA (station-coverage.js's ATC_CLASSES) and has to be
//    added to every class set (docs/adr/0041's inclusion-list trap). PriFly's
//    "supervisory, not radar control" is a permission matter, not a class.
//  - The covering chain ends at the Marshal and deliberately omits PriFly, so
//    Strips never strand on a Position that cannot advance them.
//  - No coordination Bays: "the carrier does not talk to the centre" (§9.13).
//    Each Position has a `-coordination` Bay anyway only where it is needed as
//    the "first Bay implying no state" fallback (_bayForNewOwner).
//  - Radar selectors name the radar and the hull (station-coverage.js).
const _CVN = { kind: 'carrier', coalition: 'own', hull: 'CVN-72' };
const DEFAULT_CARRIER_CONFIG = {
  facility: 'CARRIER',
  positions: ['CV_MARSHAL', 'CV_PRIFLY', 'CV_APP1', 'CV_APP2'],
  positionClasses: { CV_MARSHAL: 'MILITARY_ATC', CV_PRIFLY: 'MILITARY_ATC', CV_APP1: 'MILITARY_ATC', CV_APP2: 'MILITARY_ATC' },
  positionLetters: { CV_MARSHAL: 'V', CV_PRIFLY: 'P', CV_APP1: '1', CV_APP2: '2' },
  coveringChain: { CV_APP2: 'CV_APP1', CV_APP1: 'CV_MARSHAL' },
  positionRadars: {
    CV_MARSHAL: [{ ..._CVN }],
    CV_PRIFLY:  [{ ..._CVN, radar: 'search' }],
    CV_APP1:    [{ ..._CVN }],
    CV_APP2:    [{ ..._CVN }],
  },
  hiddenBlocks: {},
  bays: {
    CV_MARSHAL: [
      { bayId: 'cv-marshal-stack',        rackIds: ['main'], impliesState: 'IN_STACK' }, // ordered by stackIndex on the client
      { bayId: 'cv-marshal-departures',   rackIds: ['main'], impliesState: 'LAUNCH' },
      { bayId: 'cv-marshal-coordination', rackIds: ['main'] },
    ],
    CV_PRIFLY: [
      { bayId: 'cv-prifly-pattern', rackIds: ['initial', 'break', 'downwind', 'groove'], impliesState: 'IN_PATTERN', view: 'pattern' },
      { bayId: 'cv-prifly-deck',    rackIds: ['main'] }, // the deck-state board: inert until designed (ADR 0064 B8)
    ],
    CV_APP1: [
      { bayId: 'cv-app1-lane',   rackIds: ['main'], impliesState: 'COMMENCED' },
      { bayId: 'cv-app1-final',  rackIds: ['main'], impliesState: 'ON_FINAL', view: 'final' }, // one Strip at a time (§7.10), not enforced here (L18's finding: `capacity`)
      { bayId: 'cv-app1-bolter', rackIds: ['main'], impliesState: 'BOLTER_WAVEOFF' },
    ],
    CV_APP2: [
      { bayId: 'cv-app2-lane',   rackIds: ['main'], impliesState: 'COMMENCED' },
      { bayId: 'cv-app2-final',  rackIds: ['main'], impliesState: 'ON_FINAL', view: 'final' },
      { bayId: 'cv-app2-bolter', rackIds: ['main'], impliesState: 'BOLTER_WAVEOFF' },
    ],
  },
  dataOnly: false,
  standingReleases: [],
  aitAuthorized: false,
};

const DEFAULT_RANGES_CONFIG = {
  facility: 'RANGES',
  positions: airspaceConfig.getRangePositionIds(),
  positionClasses: Object.fromEntries(
    airspaceConfig.getRangePositionIds().map(id => [id, 'USING_AGENCY'])
  ),
  coveringChain: {},
  positionLetters: {},
  // `hiddenBlocks`, not the `blockVisibility` inclusion list docs/adr/0041
  // replaced — this config is derived and never persisted, so the stale key
  // was inert, but leaving it here invited the next reader to copy it.
  hiddenBlocks: {},
  // §4.1 rule 2: a range Position is the using agency and owns airspace state,
  // not a scope. No selectors, and none derived either — unlike `positions`,
  // there is nothing in the airspace config that describes a radar.
  positionRadars: {},
  bays: {},
  dataOnly: false,
  standingReleases: [],
  aitAuthorized: false,
};

const DEFAULT_CONFIGS = {
  INCIRLIK: DEFAULT_CONFIG,
  CENTER: DEFAULT_CENTER_CONFIG,
  TACTICAL: DEFAULT_TACTICAL_CONFIG,
  CARRIER: DEFAULT_CARRIER_CONFIG,
  RANGES: DEFAULT_RANGES_CONFIG,
};

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

/**
 * Validates a candidate facility config (guide §8.3): every required Block
 * for each role in `blockVisibility` MUST stay visible, and every Bay's
 * owning Position MUST exist in the Position set (rule 3). Facility-
 * agnostic — operates on whichever candidate object is passed in. Returns
 * {ok:true} or {ok:false, reason:'VALIDATION_ERROR', detail}.
 */
function validateConfig(candidate) {
  // The doctrinal check is unchanged (guide §8.3: every REQUIRED Block MUST
  // stay visible) — only the direction it reads from. What a Facility hides
  // is subtracted from the Block Map, and the remainder still has to contain
  // every required Block.
  for (const role of Object.keys(candidate.hiddenBlocks || {})) {
    const all = Object.keys(blockMap.BLOCK_MAPS[role] || {});
    const visibleBlocks = all.filter(b => !candidate.hiddenBlocks[role].includes(b));
    const result = blockMap.validateFacilityConfig({ role, visibleBlocks });
    if (!result.ok) return result;
  }
  for (const positionId of Object.keys(candidate.bays || {})) {
    if (!(candidate.positions || []).includes(positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `Bay set references unknown Position ${positionId}` };
    }
  }
  for (const [positionId, letter] of Object.entries(candidate.positionLetters || {})) {
    if (!(candidate.positions || []).includes(positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionLetters references unknown Position ${positionId}` };
    }
    if (typeof letter !== 'string' || !/^[A-Z0-9]$/.test(letter)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionLetters.${positionId} must be one character A-Z or 0-9` };
    }
  }
  for (const positionId of Object.keys(candidate.positionClasses || {})) {
    if (!(candidate.positions || []).includes(positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionClasses references unknown Position ${positionId}` };
    }
  }
  // Radar selectors are checked for SHAPE only, not for resolving to anything.
  // A selector naming an airfield this theater does not have is legitimate —
  // the same config has to work across theaters — so an unresolvable selector
  // is a startup warning (index.js's _validateRadarSelectors, following
  // _validateAirspaceReferences), never a config rejection. A malformed one is
  // a different matter: it can never resolve in any theater.
  for (const [positionId, selectors] of Object.entries(candidate.positionRadars || {})) {
    if (!(candidate.positions || []).includes(positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionRadars references unknown Position ${positionId}` };
    }
    if (!Array.isArray(selectors)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionRadars.${positionId} must be an array of selectors` };
    }
    for (const selector of selectors) {
      const problem = validateRadarSelector(selector);
      if (problem) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionRadars.${positionId}: ${problem}` };
      }
    }
  }
  const bayProblem = validateBayDescriptors(candidate);
  if (bayProblem) return { ok: false, reason: 'VALIDATION_ERROR', detail: bayProblem };
  if (candidate.singleFrequencyApproach !== undefined) {
    const problem = validateSingleFrequencyApproach(candidate.singleFrequencyApproach, candidate);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
  }
  // The runway inventory (guide §9.7, docs/adr/0061): malformed can never work
  // anywhere, so it is rejected like a malformed radar selector. How it lines
  // up with the Bays only warns — see _loadOne.
  if (candidate.fieldState !== undefined) {
    const problem = fieldState.validateFieldStateInventory(candidate.fieldState, candidate.positions || []);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
  }
  if (candidate.fieldState && candidate.fieldState.pads) {
    const problem = validateAlertPadConfig(candidate.fieldState.pads.alert);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
  }
  return { ok: true };
}

// The Bay descriptor flags (docs/adr/0093). Only these keys beyond bayId/rackIds/
// impliesState exist, so a typo in a config can never silently mount nothing.
const BAY_VIEWS = Object.freeze(['pattern', 'final', 'sfa-freqs']);
// `holdsRole` is L28's (docs/adr/0087): a Bay that files its Role's Strips whatever their state.
const BAY_DESCRIPTOR_KEYS = Object.freeze(['bayId', 'rackIds', 'impliesState', 'view', 'replacesRacks', 'capacity', 'holdsRole']);

/** A human problem string for a malformed Bay descriptor flag (`view`, `capacity`), or null. */
function validateBayDescriptors(candidate) {
  for (const [positionId, bays] of Object.entries(candidate.bays || {})) {
    for (const bay of bays) {
      if (bay.view !== undefined && !BAY_VIEWS.includes(bay.view)) {
        return `bays.${positionId}.${bay.bayId}: unknown view ${JSON.stringify(bay.view)} (one of ${BAY_VIEWS.join(', ')})`;
      }
      if (bay.capacity !== undefined && !(Number.isInteger(bay.capacity) && bay.capacity >= 1)) {
        return `bays.${positionId}.${bay.bayId}: capacity must be a whole number of at least 1`;
      }
      if (bay.replacesRacks !== undefined && (typeof bay.replacesRacks !== 'boolean' || !bay.view)) {
        return `bays.${positionId}.${bay.bayId}: replacesRacks is true or false and needs a view`;
      }
      if (bay.holdsRole !== undefined && (typeof bay.holdsRole !== 'string' || !bay.holdsRole)) {
        return `bays.${positionId}.${bay.bayId}: holdsRole is a Role name`;
      }
      const stray = Object.keys(bay).find(k => !BAY_DESCRIPTOR_KEYS.includes(k));
      if (stray) return `bays.${positionId}.${bay.bayId}: unknown Bay descriptor key ${JSON.stringify(stray)}`;
    }
  }
  return null;
}

// UHF, [SOURCE-DEFINED]: guide §4.7 says "UHF", the squadron's pool lives in 225.000 to 399.975.
const SFA_MIN_MHZ = 225;
const SFA_MAX_MHZ = 399.975;
const SFA_MIN_POOL = 5; // guide §4.7: "at least five discrete UHF frequencies"

/**
 * Guide §4.7's pool, checked as a unit: at least five unique frequencies whose
 * Racks are exactly the SFA Bay's, a rotation smaller than the pool, and APP-style
 * jurisdiction held by a Position of this Facility. Returns a problem string or null.
 */
function validateSingleFrequencyApproach(sfa, candidate) {
  if (!sfa || typeof sfa !== 'object') return 'singleFrequencyApproach must be an object';
  const positions = candidate.positions || [];
  if (!positions.includes(sfa.jurisdiction)) return `singleFrequencyApproach.jurisdiction ${JSON.stringify(sfa.jurisdiction)} is not a Position of this Facility`;
  if (!Array.isArray(sfa.pool) || sfa.pool.length < SFA_MIN_POOL) {
    return `singleFrequencyApproach.pool needs at least ${SFA_MIN_POOL} frequencies (guide §4.7), has ${Array.isArray(sfa.pool) ? sfa.pool.length : 0}`;
  }
  if (!Number.isInteger(sfa.rotationSize) || sfa.rotationSize < 1 || sfa.rotationSize >= sfa.pool.length) {
    return 'singleFrequencyApproach.rotationSize must be a whole number of at least 1 and smaller than the pool';
  }
  const ids = new Set();
  const mhzs = new Set();
  for (const entry of sfa.pool) {
    if (!entry || typeof entry.rackId !== 'string' || !entry.rackId) return 'every singleFrequencyApproach.pool entry needs a rackId';
    if (ids.has(entry.rackId)) return `singleFrequencyApproach.pool repeats rackId ${entry.rackId}`;
    ids.add(entry.rackId);
    if (typeof entry.mhz !== 'number' || !Number.isFinite(entry.mhz) || entry.mhz < SFA_MIN_MHZ || entry.mhz > SFA_MAX_MHZ) {
      return `singleFrequencyApproach.pool ${entry.rackId}: mhz must be a UHF number from ${SFA_MIN_MHZ} to ${SFA_MAX_MHZ}`;
    }
    if (mhzs.has(entry.mhz)) return `singleFrequencyApproach.pool repeats ${entry.mhz} MHz`;
    mhzs.add(entry.mhz);
  }
  const sfaBays = [];
  for (const bays of Object.values(candidate.bays || {})) for (const b of bays) if (b.view === 'sfa-freqs') sfaBays.push(b);
  if (sfaBays.length !== 1) return `exactly one Bay must have view 'sfa-freqs', found ${sfaBays.length}`;
  const bayRacks = sfaBays[0].rackIds || [];
  if (bayRacks.length !== ids.size || !bayRacks.every(r => ids.has(r))) {
    return `the SFA Bay's Racks (${bayRacks.join(', ')}) must be exactly the pool's rackIds (${[...ids].join(', ')})`;
  }
  if (sfa.initialRotation !== undefined) {
    const problem = validateSfaRotationRecord(sfa.initialRotation, sfa, positions);
    if (problem) return `singleFrequencyApproach.initialRotation: ${problem}`;
  }
  return null;
}

/**
 * A rotation record `{ rackId: positionId }` against its config: frequencies
 * from the pool, Positions of the Facility, no more entries than the rotation
 * holds, and one Position on one frequency at a time. Pure; sfa-store.js uses it too.
 */
function validateSfaRotationRecord(record, sfa, positions) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return 'must be an object of rackId to Position';
  const pool = new Set(sfa.pool.map(p => p.rackId));
  const entries = Object.entries(record);
  if (entries.length > sfa.rotationSize) return `at most ${sfa.rotationSize} frequencies are in rotation, got ${entries.length}`;
  const held = new Set();
  for (const [rackId, positionId] of entries) {
    if (!pool.has(rackId)) return `${rackId} is not a pool frequency`;
    if (!positions.includes(positionId)) return `${positionId} is not a Position of this Facility`;
    if (held.has(positionId)) return `${positionId} cannot be on two frequencies at once`;
    held.add(positionId);
  }
  return null;
}

// `datalink` is not a radar: it grants the datalink feed (docs/adr/0059).
const RADAR_SELECTOR_KINDS = new Set(['airport', 'approach', 'awacs', 'fighter', 'carrier', 'datalink']);

/** Returns a human problem string, or null when the selector is well formed. */
function validateRadarSelector(selector) {
  if (!selector || typeof selector !== 'object') return 'a selector must be an object';
  if (!RADAR_SELECTOR_KINDS.has(selector.kind)) {
    return `unknown radar kind ${JSON.stringify(selector.kind)} (one of ${[...RADAR_SELECTOR_KINDS].join(', ')})`;
  }
  if (selector.airport !== undefined && typeof selector.airport !== 'string') {
    return 'airport must be an ICAO/name string, or "*"';
  }
  if (selector.coalition !== undefined && selector.coalition !== 'own' && selector.coalition !== 'any') {
    return 'coalition must be "own" or "any"';
  }
  // An airport selector against an airborne kind cannot mean anything, and a
  // config that says it is confused about what it is asking for.
  if (selector.radar !== undefined && (selector.kind !== 'carrier' || (selector.radar !== 'search' && selector.radar !== 'approach'))) {
    return 'radar ("search" or "approach") applies to a carrier selector only';
  }
  if (selector.hull !== undefined && (selector.kind !== 'carrier' || typeof selector.hull !== 'string')) {
    return 'hull (a hull id string) applies to a carrier selector only';
  }
  if (selector.airport && (selector.kind === 'awacs' || selector.kind === 'fighter' || selector.kind === 'datalink')) {
    return selector.kind === 'datalink'
      ? 'the datalink is a network — an airport selector cannot match it'
      : `${selector.kind} radars are airborne — an airport selector cannot match one`;
  }
  return null;
}

function _loadOne(facilityId) {
  const defaults = DEFAULT_CONFIGS[facilityId];
  let config = deepClone(defaults);
  if (DERIVED_FACILITY_IDS.has(facilityId)) return config;
  try {
    const [name, override] = FACILITY_CONFIG_FILES[facilityId];
    const onDisk = JSON.parse(fs.readFileSync(readPath(name, override), 'utf8'));
    // A `blockVisibility` inclusion list from before this was an exclusion
    // list. Dropped rather than converted: every shipped one was a full set
    // for its day, so it expressed no narrowing at all — converting it would
    // faithfully preserve the accidental hiding of every Block added since,
    // which is the bug. Any genuine narrowing has to be restated as
    // `hiddenBlocks`, and the warning says so.
    if (onDisk.blockVisibility) {
      console.warn(`[efsp-facility-config] ${facilityId}: ignoring a legacy blockVisibility list — express any narrowing as hiddenBlocks instead`);
      delete onDisk.blockVisibility;
    }
    const merged = { ...deepClone(defaults), ...onDisk };
    const check = validateConfig(merged);
    if (!check.ok) {
      console.warn(`[efsp-facility-config] ${facilityId} on-disk config failed validation, using defaults:`, check.detail);
    } else {
      config = merged;
    }
  } catch (e) {
    console.warn(`[efsp-facility-config] failed to load ${facilityId} config, using defaults:`, e.message);
  }
  // After the merged config is chosen, so the shipped defaults are checked too.
  for (const warning of fieldState.runwayInventoryWarnings(config)) {
    console.warn(`[efsp-facility-config] ${facilityId}: ${warning}`);
  }
  return config;
}

const configs = new Map(Object.keys(DEFAULT_CONFIGS).map(id => [id, _loadOne(id)]));

function _persist(facilityId) {
  if (DERIVED_FACILITY_IDS.has(facilityId)) return; // see DERIVED_FACILITY_IDS
  try {
    const target = FACILITY_CONFIG_PATHS[facilityId];
    ensureDirFor(target);
    fs.writeFileSync(target, JSON.stringify(configs.get(facilityId), null, 2));
  } catch (e) {
    console.warn(`[efsp-facility-config] failed to persist ${facilityId} config:`, e.message);
  }
}

/** Every Facility this server knows about — index.js's composition root iterates this to build one {boardStore, positionStore} pair per Facility, generically (no hard-coded facility count). */
function getFacilityIds() { return [...configs.keys()]; }

function getFacilityConfig(facilityId = DEFAULT_FACILITY_ID) { return deepClone(configs.get(facilityId)); }

function getPositionSet(facilityId = DEFAULT_FACILITY_ID) { return [...(configs.get(facilityId).positions)]; }

function getCoveringChain(facilityId = DEFAULT_FACILITY_ID) { return { ...(configs.get(facilityId).coveringChain) }; }

/**
 * WP4A second slice — a Position's doctrinal class (guide §4.1's own Class
 * column: MILITARY_ATC/CIVIL_ATC/BASOPS/MRU/MRU_POSITION/NON_ATC/...),
 * permission.js's structural basis for D12 (an MRU/non-ATC Position must
 * never be granted a cross-Facility ATC coordination primitive, regardless
 * of any other Position the same controller also holds). Searches every
 * known Facility's own positionClasses map, not just one — Position IDs
 * are globally unique across Facilities in this slice (permission.js's own
 * header comment), so a caller never needs to know which Facility a
 * Position belongs to just to ask its class. Returns null for a Position
 * with no class recorded anywhere (not an error — a config predating this
 * field, or a genuinely classless test fixture).
 */
function getPositionClass(positionId) {
  for (const config of configs.values()) {
    const classes = config.positionClasses || {};
    if (Object.prototype.hasOwnProperty.call(classes, positionId)) return classes[positionId];
  }
  return null;
}

/** The one character an ATC scope draws for a contact this Position owns (docs/adr/0088); null when none is configured. */
function getPositionLetter(positionId) {
  for (const config of configs.values()) {
    const letters = config.positionLetters || {};
    if (Object.prototype.hasOwnProperty.call(letters, positionId)) return letters[positionId];
  }
  return null;
}

/** Every Facility's position letters, `{ facilityId: { positionId: letter } }` — sent in the EFSP snapshot (docs/adr/0088). */
function allPositionLetters() {
  const out = {};
  for (const [facilityId, config] of configs) out[facilityId] = { ...(config.positionLetters || {}) };
  return out;
}

/**
 * A Position's radar selectors (docs/adr/0043). Empty for a Position with no
 * scope — Ground and Clearance Delivery genuinely have none, and that is the
 * answer, not a gap.
 */
function getPositionRadars(positionId, facilityId = DEFAULT_FACILITY_ID) {
  const config = configs.get(facilityId);
  if (!config) return [];
  return deepClone((config.positionRadars || {})[positionId] || []);
}

/** Every Position, anywhere, that has at least one radar selector — what the coverage panel calls a "radar Position". */
function radarBearingPositionIds() {
  const out = [];
  for (const config of configs.values()) {
    for (const [positionId, selectors] of Object.entries(config.positionRadars || {})) {
      if (Array.isArray(selectors) && selectors.length) out.push(positionId);
    }
  }
  return out;
}

function getBaysFor(positionId, facilityId = DEFAULT_FACILITY_ID) {
  return deepClone(configs.get(facilityId).bays[positionId] || []);
}

/**
 * May this Facility write this Block on this Role? (guide §8.1 — "the
 * configurability is the specification.")
 *
 * Expressed as what a Facility HIDES, not what it shows. The original shape
 * was an inclusion list, which looked equivalent and was not: a persisted
 * list is a snapshot of "everything that existed the day it was written", so
 * every Block invented afterwards silently fell outside it. The shipped
 * configs had frozen lists from before the separation-model Blocks existed,
 * which meant `IFR`/`RSVC`/`SREG` were unwritable on the real server — and
 * since completing a TOFI exit requires setting `SREG` to ATC, tactical
 * control could be entered and never left. The release Blocks 14A/14D and
 * the frequency Block 22 were caught the same way. Tests never saw it
 * because they build config from the defaults, which are derived from the
 * Block Map and so are always current.
 *
 * An exclusion list cannot drift that way: a new Block is visible until
 * somebody deliberately hides it.
 */
function isBlockVisible(role, blockId, facilityId = DEFAULT_FACILITY_ID) {
  const config = configs.get(facilityId);
  if (!config) return true;
  const hidden = (config.hiddenBlocks || {})[role];
  return !hidden || !hidden.includes(blockId);
}

// Includes each Bay's owning positionId — lost by a plain Object.values()
// flatten otherwise, and the client needs it to keep Bays "grouped by
// Position, never merged into one undifferentiated pile" (guide §4.8.5
// rule 2). Also stamps facilityId, since a client can now hold Positions
// across both Facilities and needs to know which Board a Bay belongs to.
function getAllBays(facilityId = DEFAULT_FACILITY_ID) {
  const out = [];
  for (const [positionId, bays] of Object.entries(configs.get(facilityId).bays)) {
    for (const bay of bays) out.push({ ...deepClone(bay), positionId, facilityId });
  }
  return out;
}

/**
 * Is this a Bay this Facility actually has?
 *
 * Nothing checked until a scenario created a Strip in `ctr-overflights` when
 * the Bay is `ctr-overflight`: the Strip was created, took a beacon code, and
 * appeared in no Rack on any Board — invisible and unrecoverable, because
 * every read path goes through a Bay. A typo in a client, or a stale bayId
 * after a config change, produced a ghost.
 */
function bayExists(bayId, facilityId = DEFAULT_FACILITY_ID) {
  return getAllBays(facilityId).some(b => b.bayId === bayId);
}

/** One Bay's descriptor (bayId, rackIds, impliesState, and the `view` / `capacity` flags), with its positionId, or null. */
function getBay(bayId, facilityId = DEFAULT_FACILITY_ID) {
  return getAllBays(facilityId).find(b => b.bayId === bayId) || null;
}

/** A Facility's SFA pool config (guide §4.7), or null when it has none (every Facility but INCIRLIK). */
function getSingleFrequencyApproach(facilityId = DEFAULT_FACILITY_ID) {
  const config = configs.get(facilityId);
  return config && config.singleFrequencyApproach ? deepClone(config.singleFrequencyApproach) : null;
}

/** A Bay's configured implied EfspState (guide §3.5 rule 4), or null if the Bay doesn't imply one. */
function bayImpliesState(bayId, facilityId = DEFAULT_FACILITY_ID) {
  const bay = getAllBays(facilityId).find(b => b.bayId === bayId);
  return (bay && bay.impliesState) || null;
}

/**
 * Replaces one Facility's whole config (an explicit reload step, guide
 * §8.4 — "a live Board MUST NOT be mutated by a configuration change
 * without an explicit reload"). No editing UI calls this yet; it exists so
 * one is additive later, and so tests can exercise the persist path.
 */
function setFacilityConfig(next, facilityId = DEFAULT_FACILITY_ID) {
  if (!next || typeof next !== 'object') return false;
  if (DERIVED_FACILITY_IDS.has(facilityId)) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: `${facilityId}'s Positions are derived from the airspace config — edit that instead` };
  }
  if (!DEFAULT_CONFIGS[facilityId]) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown facilityId ${facilityId}` };
  const merged = { ...deepClone(DEFAULT_CONFIGS[facilityId]), ...deepClone(next) };
  const check = validateConfig(merged);
  if (!check.ok) return check; // {ok:false, reason:'VALIDATION_ERROR', detail} — rejected, not persisted
  configs.set(facilityId, merged);
  _persist(facilityId);
  return true;
}

/** The Bay whose configured impliesState matches `state` for a Position, or that Position's first Bay as a defensive fallback (guide §3.5 rule 4 accelerator target). */
function bayForImpliedState(positionId, state, facilityId = DEFAULT_FACILITY_ID) {
  const bays = getBaysFor(positionId, facilityId);
  return bays.find(b => b.impliesState === state) || bays[0] || null;
}

/**
 * The Bay a proposed cross-Facility coordination replica lands in for a
 * Position (WP4A, docs/adr/0015) — the Bay whose id ends '-coordination',
 * present-but-inert for every Position since Phase 2 (guide §16's build-
 * sequencing note) and now genuinely used by HANDOFF/POINT_OUT/TRAFFIC/
 * OPERATIONAL_REQUEST/AIT's PROPOSE action. Returns null if the Position
 * has no Coordination Bay configured (board-store.js treats that as "this
 * Position cannot receive a coordination proposal at all").
 */
function coordinationBayFor(positionId, facilityId = DEFAULT_FACILITY_ID) {
  const bays = getBaysFor(positionId, facilityId);
  return bays.find(b => b.bayId.endsWith('-coordination')) || null;
}

module.exports = {
  DEFAULT_FACILITY_ID, getFacilityIds,
  getFacilityConfig, getPositionSet, getPositionClass, getPositionLetter, allPositionLetters, getCoveringChain, getBaysFor, getAllBays, isBlockVisible,
  getPositionRadars, radarBearingPositionIds, validateRadarSelector, RADAR_SELECTOR_KINDS,
  bayImpliesState, bayForImpliedState, bayExists, coordinationBayFor, setFacilityConfig, validateConfig,
  getBay, getSingleFrequencyApproach, validateSfaRotationRecord, BAY_VIEWS, BAY_DESCRIPTOR_KEYS,
  DEFAULT_CONFIG, DEFAULT_CENTER_CONFIG, DEFAULT_TACTICAL_CONFIG, DEFAULT_CARRIER_CONFIG, DEFAULT_CONFIGS,
};
