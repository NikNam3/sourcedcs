'use strict';

// The ATC Position family (authority registry, S3-2): Incirlik's OPS, CD, GC,
// LC and AP, and CENTER's CTR (guide §4.1). Moved from permission.js. PAR
// is incirlik-military.js, which also adds AP's L18 columns.

const { OP_KINDS, COORDINATION_OP_KINDS, COORDINATION_STEP_OP_KINDS, AP_CTR_ONLY_OP_KINDS, AIRSPACE_ENTRY_OP_KINDS, TOFI_OP_KINDS, FORMATION_OP_KINDS, PATTERN_OP_KINDS, NON_CREATE_OPS } = require('../op-kinds');

const PERMISSIONS = {
  OPS: new Set([...OP_KINDS.filter(k => !COORDINATION_OP_KINDS.includes(k) && !COORDINATION_STEP_OP_KINDS.includes(k) && !AP_CTR_ONLY_OP_KINDS.includes(k) && !TOFI_OP_KINDS.includes(k) && !AIRSPACE_ENTRY_OP_KINDS.includes(k)), ...FORMATION_OP_KINDS]),
  CD:  new Set([...NON_CREATE_OPS, 'CreateStrip', ...FORMATION_OP_KINDS]), // H164 FT-Q2 a: CD originates a DEPARTURE
  GC: new Set([...NON_CREATE_OPS, ...FORMATION_OP_KINDS]),
  LC: new Set([...NON_CREATE_OPS, ...FORMATION_OP_KINDS, ...PATTERN_OP_KINDS]), // docs/adr/0126: the tower works the pattern
  // AP deliberately excludes TOFI even though it otherwise gets the full
  // OP_KINDS set — guide §4.1's own Position table lists TOFI only for CTR
  // among the ATC Positions built so far; AP is not on TOFI's ATC side.
  AP: new Set([...OP_KINDS.filter(k => !TOFI_OP_KINDS.includes(k)), ...FORMATION_OP_KINDS]),
  // CTR gets CreateStrip too — it self-originates ARRIVAL Strips as the new
  // terminus stub (docs/adr/0014, mirroring the same "nothing further
  // upstream is built yet" shape as docs/adr/0008's original AP stub),
  // since no third Facility exists upstream of CENTER this slice. CTR also
  // gets TOFI (WP4A second slice) — the full OP_KINDS set already includes it.
  CTR: new Set([...OP_KINDS, ...FORMATION_OP_KINDS]),
};

// Which strip type(s) a Position may originate via CreateStrip. Every
// Position in PERMISSIONS with CreateStrip in its op-kind set MUST have an
// entry here (even if empty) — see the "every CreateStrip-eligible
// Position has a CREATE_STRIP_TYPE_PERMISSIONS entry" test.
const CREATE_STRIP_TYPE_PERMISSIONS = {
  OPS: new Set(['DEPARTURE']),
  // H164 FT-Q2 a: Clearance Delivery originates a DEPARTURE too, for a pilot who calls for a clearance with nothing
  // on file at OPS. It starts in PENDING_CLEARANCE in CD's own Bay (the client's origin passes that state), since
  // PROPOSED belongs to OPS (DEPARTURE_STATE_OWNERS) and a CD-created Strip parked there could never move.
  CD: new Set(['DEPARTURE']),
  // docs/adr/0023 reopens this — ADR 0014 had deliberately emptied it,
  // reasoning ARRIVAL Strips at AP should only ever arrive via the real
  // CTR->AP HANDOFF, never local self-creation. Live testing against real
  // ATC scenarios (a VFR aircraft picking up an IFR clearance airborne, an
  // aircraft from an uncontrolled field with no flight plan on file, ...)
  // found that reasoning too narrow: guide §4.1's own Position table lists
  // AP's strip types as "all", and none of those pop-up scenarios have a
  // sending Facility to HANDOFF from — the flight simply isn't in the
  // system yet until whichever Position takes the radio call originates
  // it directly. ARRIVAL Strips can now originate BOTH ways: via a real
  // cross-Facility HANDOFF, or via AP self-originating one directly, same
  // as CTR already could.
  AP: new Set(['ARRIVAL', 'OVERFLIGHT']),
  // CTR self-originates ARRIVAL Strips (docs/adr/0014) — now also
  // OVERFLIGHT (docs/adr/0023), for a flight transiting Center's airspace
  // without landing or departing at Incirlik at all (guide §2/§6.3).
  CTR: new Set(['ARRIVAL', 'OVERFLIGHT']),
};

/**
 * Runway status (guide §9.7, docs/adr/0061) — who may do what to a runway. An
 * explicit table with its own predicate, NOT entries in OP_KINDS: every
 * PERMISSIONS row built with a `.filter()` over OP_KINDS would pick a new kind
 * up silently (this module's header, and D21). A Position absent from a row —
 * a range Position, an MRU, anything unknown — is refused by that absence.
 *
 * [SOURCE-DEFINED] where the guide is silent:
 *   - Tower is the sole authority over the runways (decisions.md H18): only LC
 *     closes, opens, or takes a runway out for runway works. Everyone else
 *     ASKS (RequestRunwayStatus), and LC accepts or rejects.
 *   - OPS completes the runway works and performs the inspection (guide §9.7
 *     rule 2: "by default OPS (AMOPS)").
 *   - LC proposes, begins and completes a runway change; OPS and AP
 *     acknowledge it (rule 3; OPS stands in for the SOF). An acknowledger
 *     nobody holds is skipped and audited by the store (decisions.md H20),
 *     never answered from another Facility (S-R2-15).
 *
 * Two rows are CEILINGS the store narrows further from config, never widens:
 * CompleteInspection (to `runwayStatus.inspectionAuthorityPositionId`) and
 * Ack/RejectRunwayChange (to the change's frozen acknowledger set). Inspection
 * authority is therefore NOT configurable wider than OPS — widening it needs
 * config-derived permissions (docs/adr/0035's shape), a bigger change than
 * this deliverable.
 */
const RUNWAY_STATUS_OP_OWNERS = {
  CloseRunway:                ['LC'],
  OpenRunway:                 ['LC'],
  BeginRunwayWorks:           ['LC'],
  CompleteRunwayWorks:        ['OPS'],
  CompleteInspection:         ['OPS'],
  RequestRunwayStatus:        ['OPS', 'CD', 'GC'], // plus every Position with INCIRLIK_CAPABILITIES' requestsRunwayStatus (positions/incirlik-military.js): AP
  AcceptRunwayRequest:        ['LC'],
  RejectRunwayRequest:        ['LC'],
  ProposeRunwayChange:        ['LC'],
  SelfCoordinateRunwayChange: ['LC'],
  WithdrawRunwayChange:       ['LC'],
  BeginRunwayChange:          ['LC'],
  CompleteRunwayChange:       ['LC'],
  AckRunwayChange:            ['OPS', 'AP'],
  RejectRunwayChange:         ['OPS', 'AP'],
};

// The non-owner Block writes (docs/adr/0080; see permission.js's
// mayActBesideOwner): OPS alert status (S-L13, H56): OPS owns Block 14E on a
// DEPARTURE at every state until it is DROPPED, whoever holds the Strip.
// Likewise 3G ORDNANCE (UI-A U1).
const NON_OWNER_BLOCK_WRITES = [
  { blockId: '14E', stripType: 'DEPARTURE', positions: ['OPS'] },
  // UI-A U1 (H55): OPS records the ordnance state (CLEAN / HUNG ...) on a departure whoever holds it.
  { blockId: '3G', stripType: 'DEPARTURE', positions: ['OPS'] },
];

const family = {
  family: 'civil-atc',
  positions: ['OPS', 'CD', 'GC', 'LC', 'AP', 'CTR'],
  permissions: PERMISSIONS,
  createsStripTypes: CREATE_STRIP_TYPE_PERMISSIONS,
  runwayStatusOwners: RUNWAY_STATUS_OP_OWNERS,
  // ADR 0098 §11, amended by docs/adr/0119 (H134 LT-RQ13 a): only the controlling Position defines an airspace (create,
  // edit, delete; AIRSP-2): JO 7400.2R ¶21-1-10 names the controlling agency, and definition is the FAA's approval, not
  // the using agency's. OPS is Incirlik's USING agency (¶21-1-11; 14 CFR 73.15 (c)): it schedules, requests activation,
  // releases and approves entry for an airspace whose using Facility is INCIRLIK (`use`), and defines none (R3-11 gone).
  airspace: {
    OPS: { create: null, edit: null, delete: null, use: true },
    ...Object.fromEntries(['CD', 'GC', 'LC', 'AP', 'CTR'].map(id => [id, { create: 'OWN', edit: 'OWN', delete: 'OWN', use: false }])),
  },
  nonOwnerBlockWrites: NON_OWNER_BLOCK_WRITES,
  // TOFI's ATC side (guide §4.1): CTR only, not AP.
  tofiCounterparts: {
    CTR: [{ facilityId: 'TACTICAL', positionId: 'TAC_C2' }, { facilityId: 'TACTICAL', positionId: 'GCI' }],
  },
};

module.exports = { family };
