'use strict';

// The linked-frequency relay, server-side (docs/adr/0160, H186): crc-sync is the one relay node on the SRS server.
// This file wires the parts: each session's link groups (relay-wire.js hands them in) are merged into networks
// (link-networks.js), the pool (relay-pool.js) is tuned to every network channel, and each packet the pool hears is
// decided on (relay-decision.js) and, when relayed, sent back out by the connection that heard it.
//
// Status: each session that told us its groups gets `radio-relay-status` with the networks that include one of its
// channels, whether the relay is connected, and why not. A frame goes out only when what that session would be told
// changed. Sessions are opaque (the hub's session objects).

const { buildNetworks, indexNetworks, allChannels } = require('./link-networks');
const { decideRelay } = require('./relay-decision');
const { createRelayPool } = require('./relay-pool');
const { createRelaySrsClient, srsCoalitionOf } = require('./relay-srs-client');
const { relayStatusFrame } = require('../efsp/wire/frames');

/**
 * @param {object} o
 * @param {{host:string, port:number}} o.endpoint the SRS server (srs-client.js endpointOf(env))
 * @param {number} o.ownCoalition DCS-gRPC numbering (surveillance/iff.js ownCoalitionFrom)
 * @param {(out:Array<{session:object, frame:object}>) => void} o.deliver directed frames (the hub)
 * @param {Function} [o.createConnection] tests: replaces relay-srs-client.js
 * @param {() => number} [o.now] wall clock
 * @param {(msg:string) => void} [o.log]
 */
function createRelayService(o) {
  const groupsBySession = new Map();
  const lastSent = new Map(); // session -> JSON of the last status frame
  let networks = [];
  let index = new Map();
  let relayed = 0;
  let quiet = false; // while a change is applied: its caller returns the frames, after its ack

  const createConnection = o.createConnection || (({ onPacket, onState }) => createRelaySrsClient({
    host: o.endpoint.host, port: o.endpoint.port, coalition: srsCoalitionOf(o.ownCoalition), onPacket, onState, log: o.log,
  }));
  const pool = createRelayPool({ createConnection, onPacket, onState: () => { if (!quiet) o.deliver(statusFrames()); }, now: o.now });

  function onPacket(packet, conn) {
    const d = decideRelay(packet, { ownGuids: pool.guids(), sendGuid: conn.guid, networks, index });
    if (d.relay && conn.send(d.out)) relayed++;
  }

  function statusFor(session) {
    const mine = new Set((groupsBySession.get(session) || []).flatMap(g => g.channels));
    const s = pool.status();
    return relayStatusFrame({ networks: networks.filter(n => n.channels.some(c => mine.has(c))), connected: s.connected, error: s.error });
  }

  /** The status frames whose content changed since last sent. */
  function statusFrames() {
    const out = [];
    for (const session of groupsBySession.keys()) {
      const frame = statusFor(session);
      const json = JSON.stringify(frame);
      if (lastSent.get(session) === json) continue;
      lastSent.set(session, json);
      out.push({ session, frame });
    }
    return out;
  }

  function recompute() {
    networks = buildNetworks(groupsBySession.values());
    index = indexNetworks(networks);
    quiet = true;
    try { pool.setChannels(allChannels(networks)); } finally { quiet = false; }
  }

  return {
    /** `session`'s link groups now, whole ([{id, channels}], validated by relay-wire.js). Returns the status frames. */
    setGroups(session, groups) {
      groupsBySession.set(session, groups);
      lastSent.delete(session); // the sender always gets one status back
      const before = JSON.stringify(networks);
      if (JSON.stringify(buildNetworks(groupsBySession.values())) !== before) recompute();
      return statusFrames();
    },
    /** The session closed: its groups go at once. The status frames for the others whose networks changed. */
    close(session) {
      lastSent.delete(session);
      if (!groupsBySession.delete(session)) return [];
      recompute();
      return statusFrames();
    },
    networks: () => networks.map(n => ({ channels: n.channels.slice() })),
    relayedPackets: () => relayed,
    status: () => pool.status(),
    stop: () => pool.stop(),
  };
}

module.exports = { createRelayService };
