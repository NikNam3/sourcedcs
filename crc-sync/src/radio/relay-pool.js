'use strict';

// The relay's SRS connections (docs/adr/0160). SRS gives one client MAX_RADIOS (11) radios, so the relay opens as many
// connections as its channels need, each tuned to its share. No channels, no connection.
//
// The split keeps a channel on the connection it is already on (no retune for a pilot mid-transmission when another
// network grows), fills the first connection with room, and closes a connection left with nothing. Past
// MAX_CONNECTIONS connections the rest of the channels are not tuned, and the status says so.
//
// A controller's packet on two channels that sit on two connections reaches the relay twice, once per connection: the
// pool lets one copy of each packet through (same sender, same packet number, within DEDUPE_MS).

const { MAX_RADIOS } = require('./srs/sync-message');

const MAX_CONNECTIONS = 8;
const DEDUPE_MS = 2_000;

/**
 * The channels per connection. Pure.
 * @param {string[][]} prev what each connection is tuned to now
 * @param {string[]} channels every channel wanted, sorted
 * @param {{perConnection?:number, maxConnections?:number}} [o]
 * @returns {{split:string[][], untuned:string[]}} `split[i]` is connection i's; an empty entry is a connection to close
 */
function splitChannels(prev, channels, o = {}) {
  const per = o.perConnection ?? MAX_RADIOS;
  const max = o.maxConnections ?? MAX_CONNECTIONS;
  const want = new Set(channels);
  const split = prev.map(cs => cs.filter(c => want.has(c)));
  const placed = new Set(split.flat());
  const untuned = [];
  for (const c of channels) {
    if (placed.has(c)) continue;
    let i = split.findIndex(cs => cs.length < per);
    if (i < 0 && split.length < max) { split.push([]); i = split.length - 1; }
    if (i < 0) { untuned.push(c); continue; }
    split[i].push(c);
    placed.add(c);
  }
  for (const cs of split) cs.sort();
  return { split, untuned };
}

/**
 * @param {object} o
 * @param {(o:{index:number, onPacket:Function, onState:Function}) => object} o.createConnection relay-srs-client.js
 * @param {(packet:object, conn:object) => void} o.onPacket one copy of every packet the relay hears
 * @param {() => void} [o.onState] a connection's state changed
 * @param {() => number} [o.now] wall clock (housekeeping: the dedupe window)
 */
function createRelayPool(o) {
  const now = o.now || Date.now;
  let conns = []; // [{conn, channels}] in split order; a closed slot is null
  let untuned = [];
  const seen = new Map(); // `${guid}|${packetNumber}` -> at

  function firstCopy(p) {
    const t = now();
    const key = `${p.guid}|${p.packetNumber}`;
    const at = seen.get(key);
    seen.set(key, t);
    if (seen.size > 512) for (const [k, v] of seen) if (t - v > DEDUPE_MS) seen.delete(k);
    return at === undefined || t - at > DEDUPE_MS;
  }
  const onPacket = (p, conn) => { if (firstCopy(p)) o.onPacket(p, conn); };
  const onState = () => { if (o.onState) o.onState(); };

  return {
    /** Every channel the relay must hear and send on, sorted. */
    setChannels(channels) {
      const r = splitChannels(conns.map(c => (c ? c.channels : [])), channels);
      untuned = r.untuned;
      const next = [];
      r.split.forEach((cs, i) => {
        const had = conns[i] || null;
        if (!cs.length) { if (had) had.conn.stop(); next.push(null); return; }
        const conn = had ? had.conn : o.createConnection({ index: i, onPacket, onState });
        if (!had || had.channels.join(',') !== cs.join(',')) conn.setChannels(cs);
        next.push({ conn, channels: cs });
      });
      while (next.length && next[next.length - 1] === null) next.pop();
      conns = next;
      onState();
    },
    /** The GUIDs of every open connection (relay-decision.js check OWN). */
    guids: () => new Set(conns.filter(Boolean).map(c => c.conn.guid)),
    connectionCount: () => conns.filter(Boolean).length,
    /** {connected, error}: connected when every connection is up and UDP-ready; false with no connection. */
    status() {
      const open = conns.filter(Boolean);
      const states = open.map(c => c.conn.state());
      const down = states.find(s => !(s.connected && s.udpReady));
      const error = untuned.length
        ? `more than ${MAX_CONNECTIONS * MAX_RADIOS} linked frequencies; not relayed: ${untuned.join(', ')}`
        : (down ? (down.error || (down.connected ? 'SRS voice link not ready' : 'not connected to SRS')) : null);
      return { connected: open.length > 0 && !down, error: open.length ? error : null };
    },
    stop() { for (const c of conns) if (c) c.conn.stop(); conns = []; },
  };
}

module.exports = { createRelayPool, splitChannels, MAX_CONNECTIONS, DEDUPE_MS };
