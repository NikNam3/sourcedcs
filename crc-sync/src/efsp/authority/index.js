'use strict';

// THE AUTHORITY REGISTRY (S3-2, docs/adr/0095; plan §2.4). Who may do what,
// and how each Role's lifecycle runs, in one place.
//
//  - A Role family (`strip-types/<role>.js`) is one Strip Role: its states, initial
//    state, NLA, state owners, countable states, replica state on receipt,
//    sender state on accept, and coordination/TOFI eligibility.
//  - A Position family (`positions/<family>.js`) is a group of Positions: their
//    op grants, the Roles they create, their capability columns and read scope.
//
// Families register by being listed below, as plain requires in a fixed order.
// There is no dynamic discovery. The doctrine tables stay in code (decisions.md
// H88); the facility JSON lists which Positions a Facility has, and
// tests/authority-coverage.test.mjs holds the two to each other.
//
// permission.js, nla.js and coordination.js are facades over this module and
// export exactly what they exported before it existed (the client's PARITY
// tests and the freeze tables read them).

const roleFamilies = new Map();
let sealed = false;

function _fail(what) { throw new Error(`authority registry: ${what}`); }

/**
 * @param {{role:string, states:string[], initialState:string, stateOwners:object, computeNla:Function,
 *   countablePreDropStates:string[], excludedWhenNotCountable:string, replicaStateOnReceipt:object|null,
 *   senderStateOnAccept:object|null, coordinationEligibleState?:string, tofiEligibleState?:string}} def
 */
function registerRoleFamily(def) {
  if (sealed) _fail(`Role family ${def && def.role} registered after the registry was sealed; list it in authority/index.js`);
  if (!def || typeof def.role !== 'string' || !def.role) _fail('a Role family needs a `role`');
  if (roleFamilies.has(def.role)) _fail(`Role ${def.role} is registered twice`);
  const states = def.states;
  if (!Array.isArray(states) || !states.includes('DROPPED')) _fail(`${def.role}: \`states\` must list the Role's states, DROPPED included`);
  if (!states.includes(def.initialState)) _fail(`${def.role}: initialState ${def.initialState} is not one of its states`);
  if (typeof def.computeNla !== 'function') _fail(`${def.role}: \`computeNla\` must be a function`);
  for (const s of Object.keys(def.stateOwners || {})) if (!states.includes(s)) _fail(`${def.role}: stateOwners names unknown state ${s}`);
  if (!Array.isArray(def.countablePreDropStates)) _fail(`${def.role}: \`countablePreDropStates\` must be an array (empty = never counted)`);
  for (const s of def.countablePreDropStates) if (!states.includes(s)) _fail(`${def.role}: countable state ${s} is not one of its states`);
  if (typeof def.excludedWhenNotCountable !== 'string') _fail(`${def.role}: \`excludedWhenNotCountable\` is required`);
  for (const k of ['coordinationEligibleState', 'tofiEligibleState']) {
    if (def[k] !== undefined && !states.includes(def[k])) _fail(`${def.role}: ${k} ${def[k]} is not one of its states`);
  }
  roleFamilies.set(def.role, def);
}

// ── Role families, in today's STATES_BY_ROLE order ─────────────────────────
registerRoleFamily(require('./strip-types/departure').family);
registerRoleFamily(require('./strip-types/arrival').family);
registerRoleFamily(require('./strip-types/overflight').family);
registerRoleFamily(require('./strip-types/mission').family);
registerRoleFamily(require('./strip-types/marshal').family);
registerRoleFamily(require('./strip-types/final').family);
registerRoleFamily(require('./strip-types/pattern').family);

const positionFamilies = [];
const positionOwner = new Map(); // positionId -> family name

/**
 * @param {{family:string, positions:string[], extends?:string[], permissions:object, createRoles?:object,
 *   ownsStates?:object, fieldStateOwners?:object, fieldStateGrants?:object, nonOwnerBlockWrites?:object[],
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
  for (const key of ['permissions', 'createRoles', 'ownsStates', 'tofiCounterparts', 'capabilities']) {
    for (const id of Object.keys(def[key] || {})) if (!mine.has(id)) _fail(`${def.family}: ${key} names ${id}, which is not its Position`);
  }
  for (const id of def.positions) if (!(def.permissions[id] instanceof Set)) _fail(`${def.family}: ${id} has no op grant`);
  for (const [id, roles] of Object.entries(def.createRoles || {})) {
    for (const r of roles) if (!roleFamilies.has(r)) _fail(`${def.family}: ${id} creates unknown Role ${r}`);
  }
  for (const [id, byRole] of Object.entries(def.ownsStates || {})) {
    for (const [role, states] of Object.entries(byRole)) {
      const f = roleFamilies.get(role);
      if (!f) _fail(`${def.family}: ${id} owns states of unknown Role ${role}`);
      for (const s of states) if (!f.states.includes(s)) _fail(`${def.family}: ${id} owns ${role}.${s}, which is not a ${role} state`);
    }
  }
  for (const id of def.positions) positionOwner.set(id, def.family);
  positionFamilies.push(def);
}

// ── Position families. incirlik-military is last: it extends civil-atc's APP
// and the Role families' owner tables. This order also reproduces the key and
// array order every composed table below had when it was one file. ──────────
registerPositionFamily(require('./positions/civil-atc').family);
registerPositionFamily(require('./positions/tactical').family);
registerPositionFamily(require('./positions/carrier').family);
registerPositionFamily(require('./positions/incirlik-military').family);

sealed = true;

// ── Role tables, composed once ─────────────────────────────────────────────
const _byRole = (pick) => Object.fromEntries([...roleFamilies.values()].map(f => [f.role, pick(f)]));
const _byRoleWhere = (pick) => Object.fromEntries([...roleFamilies.values()].filter(f => pick(f) != null).map(f => [f.role, pick(f)]));

/** { role: states[] } — the same arrays the Role families own. */
const STATES_BY_ROLE = _byRole(f => f.states);
/** { role: { state: owners[] } } — the same objects the Role families own. */
const STATE_OWNERS_BY_ROLE = _byRole(f => f.stateOwners);
/** board-store.js's DEFAULT_INITIAL_STATE_BY_ROLE (BOARD-3 switches its reads here). */
const DEFAULT_INITIAL_STATE_BY_ROLE = _byRole(f => f.initialState);
/** board-store.js's REPLICA_STATE_ON_RECEIPT: { role: { senderState: replicaState } }; absent = the sender's state. */
const REPLICA_STATE_ON_RECEIPT = _byRoleWhere(f => f.replicaStateOnReceipt);
/** board-store.js's SENDER_STATE_ON_ACCEPT: { primitive: { role: { senderState: stateAfterAccept } } }. */
const SENDER_STATE_ON_ACCEPT = {};
for (const f of roleFamilies.values()) {
  for (const [primitive, byState] of Object.entries(f.senderStateOnAccept || {})) {
    (SENDER_STATE_ON_ACCEPT[primitive] = SENDER_STATE_ON_ACCEPT[primitive] || {})[f.role] = byState;
  }
}
/** traffic-count.js's two countability tables. */
const COUNTABLE_PRE_DROP_STATES = _byRole(f => f.countablePreDropStates);
const EXCLUDED_WHEN_NOT_COUNTABLE = _byRole(f => f.excludedWhenNotCountable);

// Which EfspState a Strip Role must be in to PROPOSE a coordination link —
// i.e. which (role, state) combo has a Bay configured to receive it on the
// OTHER side (facility-config.js's ARRIVAL app-inbound/ctr-enroute Bays and
// DEPARTURE app-departures/ctr-departures Bays all imply exactly these
// states). Gates ALL 5 primitives identically — POINT_OUT/TRAFFIC/
// OPERATIONAL_REQUEST/AIT conceptually apply to any traffic a Position
// holds, not just HANDOFF, so this is role-based, never primitive-based.
// Originally this slice only ever produced ARRIVAL/INBOUND replicas
// (docs/adr/0014's CTR->APP flow); docs/adr/0022 extends it to
// DEPARTURE/HANDED_OFF (APP->CTR) without inventing any new EfspState —
// CTR's terminus for a received DEPARTURE Strip is Drop-only, mirroring
// APP's own existing DEPARTURE terminus.
//
// docs/adr/0087 adds OVERFLIGHT at IN_SECTOR (F14: an overflight used to be
// unable to propose coordination at all), so a CTR overflight can be handed to
// APP. The receiving side mints it INBOUND (board-store.js's
// REPLICA_STATE_ON_RECEIPT).
const COORDINATION_ELIGIBLE_STATES = _byRoleWhere(f => f.coordinationEligibleState);

// Which EfspState an ATC-side Strip Role must be in to open a TOFI ENTRY —
// TOFI's own analogue of COORDINATION_ELIGIBLE_STATES above, and added for
// the same reason: without it, the TOFI button rendered (and the mutation
// succeeded) on ANY Strip the acting Position owned, in any state, including
// one that had not been worked yet.
//
// A flight can only enter tactically controlled airspace once it is actually
// airborne and enroute, which is the same set of states the 5 primitives
// already recognise as "airborne, being worked by an enroute Position" —
// plus OVERFLIGHT (IN_SECTOR, docs/adr/0087 — the flight being worked). MISSION
// is deliberately absent: it is the MRU-side Role TOFI *creates*, never a
// Role that opens an exchange of its own (docs/adr/0026).
const TOFI_ELIGIBLE_STATES = _byRoleWhere(f => f.tofiEligibleState);

// ── Role accessors ─────────────────────────────────────────────────────────
const _own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** @returns {object|null} the registered Role family, or null. */
function roleFamily(role) { return (typeof role === 'string' && roleFamilies.get(role)) || null; }
/** @returns {string[]} every registered Role, in registration order. */
function roleNames() { return [...roleFamilies.keys()]; }
/** @returns {string[]} who works `role` while it is in `state` (guide §3.4), or [] */
function stateOwners(role, state) {
  const table = _own(STATE_OWNERS_BY_ROLE, role) ? STATE_OWNERS_BY_ROLE[role] : null;
  return (table && _own(table, state) && table[state]) || [];
}
/** @returns {string|undefined} */
function initialStateFor(role) { return _own(DEFAULT_INITIAL_STATE_BY_ROLE, role) ? DEFAULT_INITIAL_STATE_BY_ROLE[role] : undefined; }
/** The state a coordination replica of a `role` Strip at `senderState` is minted in. */
function replicaStateOnReceipt(role, senderState) { return ((REPLICA_STATE_ON_RECEIPT[role] || {})[senderState]) || senderState; }
/** @returns {string|undefined} the sender's state once the receiver ACCEPTs `primitive`, or undefined (unchanged). */
function senderStateOnAccept(primitive, role, senderState) { return ((SENDER_STATE_ON_ACCEPT[primitive] || {})[role] || {})[senderState]; }

// ── Position tables, composed once ─────────────────────────────────────────
const { COORDINATION_OP_KINDS } = require('./op-kinds');
const { _isMruOrNonAtc } = require('./classes');

// The coarse "may this Position class ever perform this KIND of op at
// all" gate — CreateStrip is included here for OPS/APP (both originate
// Strips, just for different roles) but the role itself is gated
// separately by canCreateStripRole(), which board-store.js's
// _applyCreateStrip calls in addition to this. The 5 COORDINATION_OP_KINDS
// are included only for APP/CTR (guide §4.6: only ATC⇄ATC Positions that
// actually sit on a Facility boundary get these — WP4A's deferred MRU
// Positions, docs/adr/0020, get none at all, which is D12's refusal case).
// ConvertToArrival is restricted the same way, for the same underlying
// reason (only APP/CTR ever hold a DEPARTURE Strip at its HANDED_OFF
// terminus in a position to convert it).
const PERMISSIONS = {};
const CREATE_ROLE_PERMISSIONS = {};
for (const f of positionFamilies) {
  Object.assign(PERMISSIONS, f.permissions);
  Object.assign(CREATE_ROLE_PERMISSIONS, f.createRoles || {});
}

// D12, enforced structurally rather than merely by careful hand-authoring
// above (docs/adr/0020's own directive — see MRU_OR_NON_ATC_CLASSES'
// comment). Any Position whose facility-config class is MRU/MRU_POSITION/
// NON_ATC loses every one of the 5 COORDINATION_OP_KINDS here, regardless
// of what PERMISSIONS[positionId] was constructed with above.
for (const [positionId, ops] of Object.entries(PERMISSIONS)) {
  if (_isMruOrNonAtc(positionId)) {
    for (const opKind of COORDINATION_OP_KINDS) ops.delete(opKind);
  }
}

// A family's `ownsStates` column (incirlik-military.js: RSU, SFA and PAR),
// merged here with FRESH arrays: FINAL's rows share CV_LANES, so a push would
// also hand PAR the carrier Marshal's COMMENCED.
for (const f of positionFamilies) {
  for (const [positionId, byRole] of Object.entries(f.ownsStates || {})) {
    for (const [role, byState] of Object.entries(byRole)) {
      const table = STATE_OWNERS_BY_ROLE[role];
      for (const state of byState) {
        const owners = table[state] || [];
        if (!owners.includes(positionId)) table[state] = [...owners, positionId];
      }
    }
  }
}

/** Field state (guide §9.7): the owning family's rows, then each later family's grants appended. */
const FIELD_STATE_OP_OWNERS = {};
for (const f of positionFamilies) Object.assign(FIELD_STATE_OP_OWNERS, f.fieldStateOwners || {});
for (const f of positionFamilies) {
  for (const [opKind, ids] of Object.entries(f.fieldStateGrants || {})) {
    if (!FIELD_STATE_OP_OWNERS[opKind]) _fail(`${f.family}: grants ${opKind}, which no family owns`);
    FIELD_STATE_OP_OWNERS[opKind] = [...FIELD_STATE_OP_OWNERS[opKind], ...ids];
  }
}

/** permission.js's mayActBesideOwner: every family's non-owner Block writes. */
const NON_OWNER_BLOCK_WRITES = positionFamilies.flatMap(f => f.nonOwnerBlockWrites || []);

// WP4A second slice — TOFI's target resolution (guide §4.6.3, ATC<->MRU).
// Per guide §4.1's own Position table, TOFI is listed only for CTR among
// the ATC Positions built so far (not APP) — so the ATC side is CTR only,
// but the MRU side has two candidates (TAC_C2, GCI), and this table
// resolves which counterpart(s) are valid for a given acting Position
// rather than assuming a fixed 1:1 pair the way the older, narrower
// COORDINATION_TARGETS-style stub could. Small and static (not full
// dynamic discovery) — board-store.js's _applyTofiPropose validates a
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
 * @returns {{family:string, ops:Set<string>, createsRoles:Set<string>|null, capabilities:object}|null}
 */
function capabilitiesFor(positionId) {
  const family = positionFamilyOf(positionId);
  if (!family) return null;
  const capabilities = {};
  for (const f of positionFamilies) {
    const row = f.capabilities && _own(f.capabilities, positionId) ? f.capabilities[positionId] : null;
    if (row) Object.assign(capabilities, row);
  }
  return {
    family,
    ops: PERMISSIONS[positionId] || new Set(),
    createsRoles: CREATE_ROLE_PERMISSIONS[positionId] || null,
    capabilities,
  };
}
/** @returns {string[]} the Positions that may CreateStrip a `role` Strip, in registration order. */
function creatorsOf(role) {
  return Object.keys(CREATE_ROLE_PERMISSIONS).filter(p => CREATE_ROLE_PERMISSIONS[p].has(role));
}

module.exports = {
  registerRoleFamily, registerPositionFamily,
  positionFamilyOf, positionFamily, positionIds, capabilitiesFor, creatorsOf,
  PERMISSIONS, CREATE_ROLE_PERMISSIONS, FIELD_STATE_OP_OWNERS, NON_OWNER_BLOCK_WRITES, TOFI_COUNTERPARTS,
  roleFamily, roleNames, stateOwners, initialStateFor, replicaStateOnReceipt, senderStateOnAccept,
  STATES_BY_ROLE, STATE_OWNERS_BY_ROLE, DEFAULT_INITIAL_STATE_BY_ROLE, REPLICA_STATE_ON_RECEIPT, SENDER_STATE_ON_ACCEPT,
  COUNTABLE_PRE_DROP_STATES, EXCLUDED_WHEN_NOT_COUNTABLE, COORDINATION_ELIGIBLE_STATES, TOFI_ELIGIBLE_STATES,
};
