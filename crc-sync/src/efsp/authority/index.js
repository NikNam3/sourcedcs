'use strict';

// THE AUTHORITY REGISTRY (S3-2, docs/adr/0095; plan §2.4). Who may do what,
// and how each strip type's lifecycle runs, in one place.
//
//  - A strip-type family (`strip-types/<type>.js`) is one strip type: its states, initial
//    state, NLA, state owners, countable states, replica state on receipt,
//    sender state on accept, and coordination/TOFI eligibility.
//  - A Position family (`positions/<family>.js`) is a group of Positions: their
//    op grants, the strip types they create, their capability columns and read scope.
//
// Families register by being listed below, as plain requires in a fixed order.
// There is no dynamic discovery. The doctrine tables stay in code (decisions.md
// H88); the facility JSON lists which Positions a Facility has, and
// tests/authority-coverage.test.mjs holds the two to each other.
//
// permission.js, nla.js and coordination.js are facades over this module and
// export exactly what they exported before it existed (the client's parity
// tests and the freeze tables read them).

const stripTypeFamilies = new Map();
let sealed = false;

function _fail(what) { throw new Error(`authority registry: ${what}`); }

/**
 * @param {{stripType:string, states:string[], initialState:string, stateOwners:object, computeNla:Function,
 *   countablePreDropStates:string[], excludedWhenNotCountable:string, replicaStateOnReceipt:object|null,
 *   senderStateOnAccept:object|null, coordinationEligibleState?:string, tofiEligibleState?:string}} def
 */
function registerStripTypeFamily(def) {
  if (sealed) _fail(`strip type family ${def && def.stripType} registered after the registry was sealed; list it in authority/index.js`);
  if (!def || typeof def.stripType !== 'string' || !def.stripType) _fail('a strip type family needs a `stripType`');
  if (stripTypeFamilies.has(def.stripType)) _fail(`strip type ${def.stripType} is registered twice`);
  const states = def.states;
  if (!Array.isArray(states) || !states.includes('DROPPED')) _fail(`${def.stripType}: \`states\` must list the strip type's states, DROPPED included`);
  if (!states.includes(def.initialState)) _fail(`${def.stripType}: initialState ${def.initialState} is not one of its states`);
  if (typeof def.computeNla !== 'function') _fail(`${def.stripType}: \`computeNla\` must be a function`);
  for (const s of Object.keys(def.stateOwners || {})) if (!states.includes(s)) _fail(`${def.stripType}: stateOwners names unknown state ${s}`);
  if (!Array.isArray(def.countablePreDropStates)) _fail(`${def.stripType}: \`countablePreDropStates\` must be an array (empty = never counted)`);
  for (const s of def.countablePreDropStates) if (!states.includes(s)) _fail(`${def.stripType}: countable state ${s} is not one of its states`);
  if (typeof def.excludedWhenNotCountable !== 'string') _fail(`${def.stripType}: \`excludedWhenNotCountable\` is required`);
  for (const k of ['coordinationEligibleState', 'tofiEligibleState']) {
    if (def[k] !== undefined && !states.includes(def[k])) _fail(`${def.stripType}: ${k} ${def[k]} is not one of its states`);
  }
  // docs/adr/0099 §4: a family without the formation keys is a start-up error (no silent default).
  for (const k of ['splitEligibleStates', 'joinEligibleStates', 'groundStates']) {
    if (!Array.isArray(def[k])) _fail(`${def.stripType}: \`${k}\` must be an array (empty = none)`);
    for (const s of def[k]) if (s === 'DROPPED' || !states.includes(s)) _fail(`${def.stripType}: ${k} names ${s}, which is not a live state`);
  }
  for (const s of def.groundStates) {
    if (!def.splitEligibleStates.includes(s)) _fail(`${def.stripType}: ground state ${s} is not split-eligible`);
  }
  stripTypeFamilies.set(def.stripType, def);
}

// ── strip-type families, in today's STATES_BY_STRIP_TYPE order ─────────────────────────
registerStripTypeFamily(require('./strip-types/departure').family);
registerStripTypeFamily(require('./strip-types/arrival').family);
registerStripTypeFamily(require('./strip-types/overflight').family);
registerStripTypeFamily(require('./strip-types/mission').family);
registerStripTypeFamily(require('./strip-types/marshal').family);
registerStripTypeFamily(require('./strip-types/final').family);
registerStripTypeFamily(require('./strip-types/pattern').family);

const positionFamilies = [];
const positionOwner = new Map(); // positionId -> family name

/**
 * @param {{family:string, positions:string[], extends?:string[], permissions:object, createsStripTypes?:object, airspace?:object,
 *   ownsStates?:object, runwayStatusOwners?:object, runwayStatusGrants?:object, nonOwnerBlockWrites?:object[],
 *   tofiCounterparts?:object, capabilities?:object}} def
 */
function registerPositionFamily(def) {
  if (sealed) _fail(`Position family ${def && def.family} registered after the registry was sealed; list it in authority/index.js`);
  if (!def || typeof def.family !== 'string' || !def.family) _fail('a Position family needs a `family` name');
  if (positionFamilies.some(f => f.family === def.family)) _fail(`Position family ${def.family} is registered twice`);
  if (!Array.isArray(def.positions) || def.positions.length === 0) _fail(`${def.family}: \`positions\` must list its Position ids`);
  for (const id of def.positions) {
    if (positionOwner.has(id)) _fail(`${def.family}: Position ${id} already belongs to ${positionOwner.get(id)}`);
  }
  const ext = def.extends || [];
  for (const id of ext) if (!positionOwner.has(id)) _fail(`${def.family}: extends ${id}, which no earlier family registered`);
  const mine = new Set([...def.positions, ...ext]);
  for (const key of ['permissions', 'createsStripTypes', 'ownsStates', 'tofiCounterparts', 'capabilities', 'airspace']) {
    for (const id of Object.keys(def[key] || {})) if (!mine.has(id)) _fail(`${def.family}: ${key} names ${id}, which is not its Position`);
  }
  for (const id of def.positions) if (!(def.permissions[id] instanceof Set)) _fail(`${def.family}: ${id} has no op grant`);
  for (const [id, stripTypes] of Object.entries(def.createsStripTypes || {})) {
    for (const r of stripTypes) if (!stripTypeFamilies.has(r)) _fail(`${def.family}: ${id} creates unknown strip type ${r}`);
  }
  for (const [id, byStripType] of Object.entries(def.ownsStates || {})) {
    for (const [stripType, states] of Object.entries(byStripType)) {
      const f = stripTypeFamilies.get(stripType);
      if (!f) _fail(`${def.family}: ${id} owns states of unknown strip type ${stripType}`);
      for (const s of states) if (!f.states.includes(s)) _fail(`${def.family}: ${id} owns ${stripType}.${s}, which is not a ${stripType} state`);
    }
  }
  for (const id of def.positions) positionOwner.set(id, def.family);
  positionFamilies.push(def);
}

// ── Position families. incirlik-military is last: it extends civil-atc's AP
// and the strip-type families' owner tables. This order also reproduces the key and
// array order every composed table below had when it was one file. ──────────
registerPositionFamily(require('./positions/civil-atc').family);
registerPositionFamily(require('./positions/tactical').family);
registerPositionFamily(require('./positions/carrier').family);
registerPositionFamily(require('./positions/incirlik-military').family);

sealed = true;

// ── strip type tables, composed once ─────────────────────────────────────────────
const _byStripType = (pick) => Object.fromEntries([...stripTypeFamilies.values()].map(f => [f.stripType, pick(f)]));
const _byStripTypeWhere = (pick) => Object.fromEntries([...stripTypeFamilies.values()].filter(f => pick(f) != null).map(f => [f.stripType, pick(f)]));

/** { stripType: states[] } — the same arrays the strip-type families own. */
const STATES_BY_STRIP_TYPE = _byStripType(f => f.states);
/** { stripType: { state: owners[] } } — the same objects the strip-type families own. */
const STATE_OWNERS_BY_STRIP_TYPE = _byStripType(f => f.stateOwners);
/** { stripType: initial state }, read through initialStateFor(). */
const DEFAULT_INITIAL_STATE_BY_STRIP_TYPE = _byStripType(f => f.initialState);
/** The replica's state on receipt (board/coordination.js): { stripType: { senderState: replicaState } }; absent = the sender's state. */
const REPLICA_STATE_ON_RECEIPT = _byStripTypeWhere(f => f.replicaStateOnReceipt);
/** The sender's state after an accept (board/coordination.js): { primitive: { stripType: { senderState: stateAfterAccept } } }. */
const SENDER_STATE_ON_ACCEPT = {};
for (const f of stripTypeFamilies.values()) {
  for (const [primitive, byState] of Object.entries(f.senderStateOnAccept || {})) {
    (SENDER_STATE_ON_ACCEPT[primitive] = SENDER_STATE_ON_ACCEPT[primitive] || {})[f.stripType] = byState;
  }
}
/** traffic-count.js's two countability tables. */
const COUNTABLE_PRE_DROP_STATES = _byStripType(f => f.countablePreDropStates);
const EXCLUDED_WHEN_NOT_COUNTABLE = _byStripType(f => f.excludedWhenNotCountable);

// Which EfspState a strip type must be in to PROPOSE a coordination link —
// i.e. which (stripType, state) combo has a Bay configured to receive it on the
// OTHER side (facility-config.js's ARRIVAL ap-inbound/ctr-enroute Bays and
// DEPARTURE ap-departures/ctr-departures Bays all imply exactly these
// states). Gates ALL 5 primitives identically — POINT_OUT/TRAFFIC/
// OPERATIONAL_REQUEST/AIT conceptually apply to any traffic a Position
// holds, not just HANDOFF, so this is role-based, never primitive-based.
// Originally this slice only ever produced ARRIVAL/INBOUND replicas
// (docs/adr/0014's CTR->AP flow); docs/adr/0022 extends it to
// DEPARTURE/HANDED_OFF (AP->CTR) without inventing any new EfspState —
// CTR's terminus for a received DEPARTURE Strip is Drop-only, mirroring
// AP's own existing DEPARTURE terminus.
//
// docs/adr/0087 adds OVERFLIGHT at IN_SECTOR (F14: an overflight used to be
// unable to propose coordination at all), so a CTR overflight can be handed to
// AP. The receiving side mints it INBOUND (board/coordination.js
// via replicaStateOnReceipt, REPLICA_STATE_ON_RECEIPT here).
const COORDINATION_ELIGIBLE_STATES = _byStripTypeWhere(f => f.coordinationEligibleState);

// Which EfspState an ATC-side strip type must be in to open a TOFI ENTRY —
// TOFI's own analogue of COORDINATION_ELIGIBLE_STATES above, and added for
// the same reason: without it, the TOFI button rendered (and the mutation
// succeeded) on ANY Strip the acting Position owned, in any state, including
// one that had not been worked yet.
//
// A flight can only enter tactically controlled airspace once it is actually
// airborne and enroute, which is the same set of states the 5 primitives
// already recognise as "airborne, being worked by an enroute Position" —
// plus OVERFLIGHT (IN_SECTOR, docs/adr/0087 — the flight being worked). MISSION
// is deliberately absent: it is the MRU-side strip type TOFI *creates*, never a
// strip type that opens an exchange of its own (docs/adr/0026).
const TOFI_ELIGIBLE_STATES = _byStripTypeWhere(f => f.tofiEligibleState);

// ── strip type accessors ─────────────────────────────────────────────────────────
const _own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** @returns {object|null} the registered strip-type family, or null. */
function stripTypeFamily(stripType) { return (typeof stripType === 'string' && stripTypeFamilies.get(stripType)) || null; }
/** @returns {string[]} every registered strip type, in registration order. */
function stripTypeNames() { return [...stripTypeFamilies.keys()]; }
/** @returns {string[]} who works `stripType` while it is in `state` (guide §3.4), or [] */
function stateOwners(stripType, state) {
  const table = _own(STATE_OWNERS_BY_STRIP_TYPE, stripType) ? STATE_OWNERS_BY_STRIP_TYPE[stripType] : null;
  return (table && _own(table, state) && table[state]) || [];
}
/**
 * docs/adr/0099 §4: which states of a strip type may split or join, and which of those are on the ground (a split needs no
 * assignment there). Null for an unknown strip type.
 * @returns {{split:string[], join:string[], ground:string[]}|null}
 */
function formationEligibility(stripType) {
  const f = stripTypeFamily(stripType);
  return f ? { split: f.splitEligibleStates, join: f.joinEligibleStates, ground: f.groundStates } : null;
}
/** @returns {string|undefined} */
function initialStateFor(stripType) { return _own(DEFAULT_INITIAL_STATE_BY_STRIP_TYPE, stripType) ? DEFAULT_INITIAL_STATE_BY_STRIP_TYPE[stripType] : undefined; }
/** The state a coordination replica of a `stripType` Strip at `senderState` is minted in. */
function replicaStateOnReceipt(stripType, senderState) { return ((REPLICA_STATE_ON_RECEIPT[stripType] || {})[senderState]) || senderState; }
/**
 * What the replica of a `stripType` Strip at `senderState` is minted as at Position `toPositionId`: a Position family's
 * `replicaOnReceipt` row (a carrier Marshal mints a MARSHAL Strip, docs/adr/0101), else the sender's strip type with the
 * strip type family's `replicaStateOnReceipt`.
 * @returns {{stripType:string, state:string}}
 */
function replicaOnReceipt(toPositionId, stripType, senderState) {
  for (const f of positionFamilies) {
    const row = f.replicaOnReceipt && _own(f.replicaOnReceipt, toPositionId) ? f.replicaOnReceipt[toPositionId] : null;
    const hit = row && _own(row, stripType) && _own(row[stripType], senderState) ? row[stripType][senderState] : null;
    if (hit) return { stripType: hit.stripType, state: hit.state };
  }
  return { stripType, state: replicaStateOnReceipt(stripType, senderState) };
}
/** @returns {string|undefined} the sender's state once the receiver ACCEPTs `primitive`, or undefined (unchanged). */
function senderStateOnAccept(primitive, stripType, senderState) { return ((SENDER_STATE_ON_ACCEPT[primitive] || {})[stripType] || {})[senderState]; }

// ── Position tables, composed once ─────────────────────────────────────────
const { COORDINATION_OP_KINDS, COORDINATION_STEP_OP_KINDS } = require('./op-kinds');
const { _isMruOrNonAtc } = require('./classes');

// The coarse "may this Position class ever perform this KIND of op at
// all" gate — CreateStrip is included here for OPS/AP (both originate
// Strips, just for different roles) but the role itself is gated
// separately by canCreateStripType(), which board/ops/create-strip.js
// calls in addition to this. The 5 COORDINATION_OP_KINDS
// are included only for AP/CTR (guide §4.6: only ATC⇄ATC Positions that
// actually sit on a Facility boundary get these — WP4A's deferred MRU
// Positions, docs/adr/0020, get none at all, which is D12's refusal case).
// ConvertToArrival is restricted the same way, for the same underlying
// reason (only AP/CTR ever hold a DEPARTURE Strip at its HANDED_OFF
// terminus in a position to convert it).
const PERMISSIONS = {};
const CREATE_STRIP_TYPE_PERMISSIONS = {};
/** { positionId: { opKind: actions[] } }: where a grant is narrower than the op kind (docs/adr/0101). */
const COORDINATION_ACTIONS = {};
for (const f of positionFamilies) {
  Object.assign(COORDINATION_ACTIONS, f.coordinationActions || {});
  Object.assign(PERMISSIONS, f.permissions);
  Object.assign(CREATE_STRIP_TYPE_PERMISSIONS, f.createsStripTypes || {});
}

// D12, enforced structurally rather than merely by careful hand-authoring
// above (docs/adr/0020's own directive — see MRU_OR_NON_ATC_CLASSES'
// comment). Any Position whose facility-config class is MRU/MRU_POSITION/
// NON_ATC loses every one of the 5 COORDINATION_OP_KINDS, regardless
// of what PERMISSIONS[positionId] was constructed with above. The classes live in
// the facility config, which is built at start and not required here, so the strip-back
// is a function of a `classOf` and permission.js's createPermission() applies it.
/**
 * @param {(positionId:string) => string|null} classOf facility-config's getPositionClass
 * @returns {Record<string, Set<string>>} a copy of PERMISSIONS with the D12 strip-back applied
 */
function permissionsFor(classOf) {
  const out = {};
  for (const [positionId, ops] of Object.entries(PERMISSIONS)) {
    out[positionId] = new Set(ops);
    if (_isMruOrNonAtc(classOf, positionId)) {
      for (const opKind of [...COORDINATION_OP_KINDS, ...COORDINATION_STEP_OP_KINDS]) out[positionId].delete(opKind);
    }
  }
  return out;
}

// A family's `ownsStates` column (incirlik-military.js: RSU and PAR),
// merged here with FRESH arrays: FINAL's rows share CV_LANES, so a push would
// also hand PAR the carrier Marshal's COMMENCED.
for (const f of positionFamilies) {
  for (const [positionId, byStripType] of Object.entries(f.ownsStates || {})) {
    for (const [stripType, byState] of Object.entries(byStripType)) {
      const table = STATE_OWNERS_BY_STRIP_TYPE[stripType];
      for (const state of byState) {
        const owners = table[state] || [];
        if (!owners.includes(positionId)) table[state] = [...owners, positionId];
      }
    }
  }
}

/** Runway status (guide §9.7): the owning family's rows, then each later family's grants appended. */
const RUNWAY_STATUS_OP_OWNERS = {};
for (const f of positionFamilies) Object.assign(RUNWAY_STATUS_OP_OWNERS, f.runwayStatusOwners || {});
for (const f of positionFamilies) {
  for (const [opKind, ids] of Object.entries(f.runwayStatusGrants || {})) {
    if (!RUNWAY_STATUS_OP_OWNERS[opKind]) _fail(`${f.family}: grants ${opKind}, which no family owns`);
    RUNWAY_STATUS_OP_OWNERS[opKind] = [...RUNWAY_STATUS_OP_OWNERS[opKind], ...ids];
  }
}

/** The airspace rows (docs/adr/0098 §11, authority/airspace.js): { positionId: { create, edit, delete, use } }. */
const AIRSPACE_ROWS = {};
for (const f of positionFamilies) Object.assign(AIRSPACE_ROWS, f.airspace || {});
const airspaceAuthority = require('./airspace');
/** @returns {{create:string|null, edit:string|null, delete:string|null, use:boolean}} a Position's airspace row (its class's row when no family lists it). */
function airspaceRowFor(positionId, classOf) {
  return airspaceAuthority.rowFor(positionId, { familyRows: AIRSPACE_ROWS, classOf });
}

/** permission.js's mayActBesideOwner: every family's non-owner Block writes. */
const NON_OWNER_BLOCK_WRITES = positionFamilies.flatMap(f => f.nonOwnerBlockWrites || []);

// WP4A second slice — TOFI's target resolution (guide §4.6.3, ATC<->MRU).
// Per guide §4.1's own Position table, TOFI is listed only for CTR among
// the ATC Positions built so far (not AP) — so the ATC side is CTR only,
// but the MRU side has two candidates (TAC_C2, GCI), and this table
// resolves which counterpart(s) are valid for a given acting Position
// rather than assuming a fixed 1:1 pair the way the older, narrower
// COORDINATION_TARGETS-style stub could. Small and static (not full
// dynamic discovery) — board/tofi.js's TOFI propose validates a
// proposal's target against this for defense in depth, and
// crc-desktop's TOFI popover mirrors it to build its target picker.
const TOFI_COUNTERPARTS = {};
for (const f of positionFamilies) Object.assign(TOFI_COUNTERPARTS, f.tofiCounterparts || {});

// ── Position accessors ─────────────────────────────────────────────────────

/** @returns {string|null} the family a Position id belongs to, or null when none registered it. */
function positionFamilyOf(positionId) { return positionOwner.get(positionId) || null; }
/** @returns {object|null} a registered Position family by name. */
function positionFamily(name) { return positionFamilies.find(f => f.family === name) || null; }
/** @returns {string[]} every registered Position id, in registration order. */
function positionIds() { return [...positionOwner.keys()]; }
/**
 * Everything the registry knows a Position may do, for reading (never for a
 * gate: permission.js's one-Position predicates are the gates, D21).
 * @returns {{family:string, ops:Set<string>, createsStripTypes:Set<string>|null, capabilities:object}|null}
 */
function capabilitiesFor(positionId, classOf = null) {
  const family = positionFamilyOf(positionId);
  if (!family) return null;
  const capabilities = {};
  for (const f of positionFamilies) {
    const row = f.capabilities && _own(f.capabilities, positionId) ? f.capabilities[positionId] : null;
    if (row) Object.assign(capabilities, row);
  }
  return {
    family,
    ops: (classOf ? permissionsFor(classOf) : PERMISSIONS)[positionId] || new Set(),
    createsStripTypes: CREATE_STRIP_TYPE_PERMISSIONS[positionId] || null,
    capabilities,
  };
}
/** @returns {string[]} the Positions that may CreateStrip a `stripType` Strip, in registration order. */
function creatorsOf(stripType) {
  return Object.keys(CREATE_STRIP_TYPE_PERMISSIONS).filter(p => CREATE_STRIP_TYPE_PERMISSIONS[p].has(stripType));
}

const { runwayInspectionRefusal, selfCoordinationRefusal } = require('./narrowing');

module.exports = {
  runwayInspectionRefusal, selfCoordinationRefusal,
  registerStripTypeFamily, registerPositionFamily,
  positionFamilyOf, positionFamily, positionIds, capabilitiesFor, creatorsOf,
  airspaceRowFor, airspaceAuthority, AIRSPACE_ROWS, permissionsFor,
  PERMISSIONS, CREATE_STRIP_TYPE_PERMISSIONS, COORDINATION_ACTIONS, replicaOnReceipt, RUNWAY_STATUS_OP_OWNERS, NON_OWNER_BLOCK_WRITES, TOFI_COUNTERPARTS,
  stripTypeFamily, stripTypeNames, formationEligibility, stateOwners, initialStateFor, replicaStateOnReceipt, senderStateOnAccept,
  STATES_BY_STRIP_TYPE, STATE_OWNERS_BY_STRIP_TYPE, DEFAULT_INITIAL_STATE_BY_STRIP_TYPE, REPLICA_STATE_ON_RECEIPT, SENDER_STATE_ON_ACCEPT,
  COUNTABLE_PRE_DROP_STATES, EXCLUDED_WHEN_NOT_COUNTABLE, COORDINATION_ELIGIBLE_STATES, TOFI_ELIGIBLE_STATES,
};
