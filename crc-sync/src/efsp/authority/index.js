'use strict';

// THE AUTHORITY REGISTRY (S3-2, docs/adr/0095; plan §2.4). Who may do what,
// and how each Role's lifecycle runs, in one place.
//
//  - A Role family (`roles/<role>.js`) is one Strip Role: its states, initial
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
registerRoleFamily(require('./roles/departure').family);
registerRoleFamily(require('./roles/arrival').family);
registerRoleFamily(require('./roles/overflight').family);
registerRoleFamily(require('./roles/mission').family);
registerRoleFamily(require('./roles/marshal').family);
registerRoleFamily(require('./roles/final').family);
registerRoleFamily(require('./roles/pattern').family);

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

module.exports = {
  registerRoleFamily,
  roleFamily, roleNames, stateOwners, initialStateFor, replicaStateOnReceipt, senderStateOnAccept,
  STATES_BY_ROLE, STATE_OWNERS_BY_ROLE, DEFAULT_INITIAL_STATE_BY_ROLE, REPLICA_STATE_ON_RECEIPT, SENDER_STATE_ON_ACCEPT,
  COUNTABLE_PRE_DROP_STATES, EXCLUDED_WHEN_NOT_COUNTABLE, COORDINATION_ELIGIBLE_STATES, TOFI_ELIGIBLE_STATES,
};
