'use strict';

// Link groups (docs/adr/0158 §2): the automatic Position group and the controller's own groups. Pure, a leaf.
//
// - The automatic group holds every POSITION radio that is not unlinked or moved elsewhere.
// - The controller creates, renames and deletes groups (A, B, C... by default) and moves any radio (Position, guard,
//   manual) into one group or out of all of them. A radio is in at most one group.
// - Membership is kept by radio identity (`POSITION:<positionId>:<band>`, `GUARD:<band>`, `MANUAL:<id>`), so a group
//   survives a retune, a restart and a Position being left and staffed again.
// - A frequency is in at most one group: when a second radio on a frequency already in another group would join, the
//   first keeps it and the second is left out of its group with `conflict` set (and `groupId` null, so the engine
//   treats it as unlinked). Its membership is kept, so it rejoins as soon as the conflict is gone.
//
// - A receive-only radio (an Observer's Position, S-RADIO-1 RQ14) and a radio that already carries a conflict (no SRS
//   slot, radio-set.js) are in no group, whatever the membership says.
//
// The stored membership is `{ [radioId]: groupId | null }` and holds only what differs from a kind's default: a
// POSITION radio defaults to the automatic group, a GUARD or MANUAL radio to none. An explicit null is "unlinked", so a
// Position radio taken out of the automatic group stays out across a restart and a re-staffing (RQ17).

export const AUTO_GROUP_ID = 'AUTO';
export const AUTO_GROUP_NAME = 'POSITIONS';
export const GROUP_NAME_MAX = 12;
/** SRS gives a client 11 radio slots (lxsrs_v2 models.py MAX_RADIOS, S-RADIO-1 RQ13). */
export const SRS_SLOTS = 11;
/** The conflict on a radio left without an SRS slot: tuned nowhere, linked nowhere, never keyed. */
export const NO_SLOT_CONFLICT = `no SRS slot (${SRS_SLOTS} in use)`;

const khzOf = (mhz) => Math.round(mhz * 1000);

function defaultGroupOf(kind) { return kind === 'POSITION' ? AUTO_GROUP_ID : null; }

/** The group a radio asks to be in, before the one-frequency rule: a group id, or null for none. */
export function intendedGroupOf(radio, membership = {}, groupIds = new Set([AUTO_GROUP_ID])) {
  if (radio.receiveOnly) return null;
  const want = Object.hasOwn(membership, radio.id) ? membership[radio.id] : defaultGroupOf(radio.kind);
  if (want == null) return null;
  return groupIds.has(want) ? want : null; // a group that no longer exists links nothing
}

/**
 * Puts each radio in its group. `radios` come in precedence order (the first radio on a frequency keeps it);
 * `groups` are the controller's groups `[{ id, name }]` in their order. Returns the radios with `groupId` and
 * `conflict` set, and the groups `[{ id, name, auto, radioIds }]`, the automatic group first.
 */
export function assignLinkGroups(radios, { groups = [], membership = {} } = {}) {
  const all = [{ id: AUTO_GROUP_ID, name: AUTO_GROUP_NAME, auto: true }, ...groups.map(g => ({ id: g.id, name: g.name, auto: false }))];
  const byId = new Map(all.map(g => [g.id, { ...g, radioIds: [] }]));
  const groupIds = new Set(byId.keys());
  const groupOfKhz = new Map(); // kHz -> the group id that holds it
  const out = radios.map((r) => {
    if (r.conflict) return { ...r, groupId: null }; // already refused (no SRS slot): tuned nowhere, linked nowhere
    const want = intendedGroupOf(r, membership, groupIds);
    if (want === null) return { ...r, groupId: null, conflict: null };
    const khz = khzOf(r.mhz);
    const holder = groupOfKhz.get(khz);
    if (holder !== undefined && holder !== want) {
      return { ...r, groupId: null, conflict: `frequency already in group ${byId.get(holder).name}` };
    }
    groupOfKhz.set(khz, want);
    byId.get(want).radioIds.push(r.id);
    return { ...r, groupId: want, conflict: null };
  });
  return { radios: out, groups: [...byId.values()] };
}

/** The next free default name: A, B, ... Z, then G27, G28, ... */
export function nextGroupName(groups = []) {
  const taken = new Set(groups.map(g => String(g.name).toUpperCase()));
  for (let i = 0; i < 26; i++) {
    const n = String.fromCharCode(65 + i);
    if (!taken.has(n)) return n;
  }
  for (let i = 27; ; i++) if (!taken.has(`G${i}`)) return `G${i}`;
}

/** Null when `name` may name a group (1 to 12 characters, not taken by another group), else why not. */
export function groupNameProblem(name, groups = [], exceptId = null) {
  const n = String(name == null ? '' : name).trim().toUpperCase();
  if (!n || n.length > GROUP_NAME_MAX) return `a name of 1 to ${GROUP_NAME_MAX} characters`;
  if (n === AUTO_GROUP_NAME) return `${AUTO_GROUP_NAME} is the automatic group`;
  if (groups.some(g => g.id !== exceptId && String(g.name).toUpperCase() === n)) return `${n} is already a group`;
  return null;
}

function nextGroupId(groups) {
  const used = new Set(groups.map(g => g.id));
  for (let i = 1; ; i++) if (!used.has(`G${i}`)) return `G${i}`;
}

/** A new group, named `name` or the next default name. `{ groups, id }` or `{ error }`. */
export function createGroup(groups = [], name) {
  const n = name == null || String(name).trim() === '' ? nextGroupName(groups) : String(name).trim().toUpperCase();
  const problem = groupNameProblem(n, groups);
  if (problem) return { error: problem };
  const id = nextGroupId(groups);
  return { groups: [...groups, { id, name: n }], id };
}

/** `{ groups }` with group `id` renamed, or `{ error }`. The automatic group is not renamed. */
export function renameGroup(groups = [], id, name) {
  if (!groups.some(g => g.id === id)) return { error: 'no such group' };
  const problem = groupNameProblem(name, groups, id);
  if (problem) return { error: problem };
  const n = String(name).trim().toUpperCase();
  return { groups: groups.map(g => (g.id === id ? { ...g, name: n } : g)) };
}

/**
 * Deletes group `id`. Its radios become unlinked, explicitly, so a Position radio that was in it does not fall back to
 * the automatic group. `{ groups, membership }`; the automatic group is never deleted.
 */
export function deleteGroup({ groups = [], membership = {} }, id) {
  if (id === AUTO_GROUP_ID) return { groups, membership };
  const next = { ...membership };
  for (const [radioId, g] of Object.entries(membership)) if (g === id) next[radioId] = null;
  return { groups: groups.filter(g => g.id !== id), membership: next };
}

/** The membership with `radio` (`{ id, kind }`) moved into group `groupId`, or out of every group when null. */
export function moveRadio(membership = {}, radio, groupId) {
  const next = { ...membership };
  const target = groupId == null ? null : groupId;
  if (target === defaultGroupOf(radio.kind)) delete next[radio.id];
  else next[radio.id] = target;
  return next;
}

/** The membership with a radio that no longer exists (a removed manual radio) forgotten. */
export function forgetRadio(membership = {}, radioId) {
  if (!Object.hasOwn(membership, radioId)) return membership;
  const next = { ...membership };
  delete next[radioId];
  return next;
}

/** The radios a transmission on `radioId` keys: its whole group, or the radio alone when it is unlinked. */
export function transmitRadioIds(set, radioId) {
  const r = set.radios.find(x => x.id === radioId);
  if (!mayTransmit(r)) return [];
  if (!r.groupId) return [r.id];
  return set.radios.filter(x => x.groupId === r.groupId).map(x => x.id);
}

/** A radio PTT may key: in the set, not receive-only, not refused a slot. */
export function mayTransmit(radio) { return !!radio && !radio.receiveOnly && radio.conflict !== NO_SLOT_CONFLICT; }

/**
 * The radio PTT transmits on (RQ17): the controller's choice while it exists and may transmit, else the automatic
 * group's first radio, else the first radio that may transmit, else none. The fallback is not saved.
 */
export function resolvePttTarget(set, wantedId) {
  const wanted = wantedId && set.radios.find(r => r.id === wantedId);
  if (mayTransmit(wanted)) return wanted.id;
  const auto = set.groups.find(g => g.auto);
  if (auto && auto.radioIds.length) return auto.radioIds[0];
  const first = set.radios.find(mayTransmit);
  return first ? first.id : null;
}
