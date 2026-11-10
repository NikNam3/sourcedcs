'use strict';

// The radio relay's wire family (docs/adr/0160). Not an EFSP store family (no seq, no snapshot, no audit, no replay: the
// groups live in memory and a reconnecting client sends them again), so it is not in efsp/wire/families/ and is bound
// into the hub as `radioRelay`.
//
//   client -> server  {type:'radio-link-groups', clientMutationId, groups:[{id, channels:['251000:AM', ...]}]}
//                     every link group of the session now, whole; [] withdraws them all. The client leaves out the
//                     intercom, receive-only radios and unlinked ones.
//   server -> client  {type:'radio-link-groups-ack', clientMutationId, ok, reason?, detail?}   to the sender
//                     {type:'radio-relay-status', networks:[{channels}], connected, error?}    to the sender after
//                     every message, and to any session whose networks or relay state changed
//
// The frames are built in efsp/wire/frames.js and leave through the hub's directed send (ADR 0159 D2). Any connected
// session may send groups: a group can hold guards and manual radios, which no Position gates.

const { isChannelKey } = require('./link-networks');
const { linkGroupsAck } = require('../efsp/wire/frames');

const LINK_GROUPS = 'radio-link-groups';
/** Per session: a controller's panel has a handful of groups; an SRS client has 11 radios. */
const MAX_GROUPS = 16;
const MAX_CHANNELS = 11;

/** Null when `groups` is a valid list, else why not. */
function groupsProblem(groups) {
  if (!Array.isArray(groups)) return 'groups must be a list';
  if (groups.length > MAX_GROUPS) return `at most ${MAX_GROUPS} groups`;
  for (const g of groups) {
    if (!g || typeof g !== 'object') return 'a group must be an object';
    if (typeof g.id !== 'string' || !g.id || g.id.length > 64) return 'a group id is a string of 1 to 64 characters';
    if (!Array.isArray(g.channels)) return `group ${g.id}: channels must be a list`;
    if (g.channels.length > MAX_CHANNELS) return `group ${g.id}: at most ${MAX_CHANNELS} channels`;
    const bad = g.channels.find(c => !isChannelKey(c));
    if (bad !== undefined) return `group ${g.id}: not a channel: ${JSON.stringify(bad)} (kHz:AM or kHz:FM)`;
  }
  return null;
}

/**
 * @param {{service: ReturnType<import('./relay-service').createRelayService>}} o
 */
function createRadioRelayWire({ service }) {
  return {
    service,
    handles: (type) => type === LINK_GROUPS,
    /** @returns {Array<{session:object, frame:object}>} the frames to send, the sender's ack first */
    handle(session, msg) {
      const problem = groupsProblem(msg.groups);
      if (problem) return [{ session, frame: linkGroupsAck(msg, { ok: false, reason: 'VALIDATION_ERROR', detail: problem }) }];
      const groups = msg.groups.map(g => ({ id: g.id, channels: [...new Set(g.channels)].sort() }));
      return [{ session, frame: linkGroupsAck(msg, { ok: true }) }, ...service.setGroups(session, groups)];
    },
    /** A session closed: its groups go at once, no grace (a pilot must not go unheard). */
    close: (session) => service.close(session),
  };
}

module.exports = { createRadioRelayWire, groupsProblem, LINK_GROUPS, MAX_GROUPS, MAX_CHANNELS };
