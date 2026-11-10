'use strict';

// One of the relay's SRS connections (docs/adr/0160): TCP sync plus UDP voice, its radios tuned to the channels the
// pool gave it (at most MAX_RADIOS). The protocol code is the hand copy in srs/ (crc-desktop's app/srs/, parity test).
//
// What the SRS server is told: the name RELAY_NAME, the own coalition (CRCSYNC_COALITION in SRS numbering), unit id 1,
// and no position (0/0/0). The SRS source (ciribob, read 2026-11-10, docs/wip/RADIO-SRELAY.md) applies no line of
// sight or range on the server; a receiving client checks both against the *sender's* position, and a sender whose
// position is lat 0 / lng 0 counts as having none (`LatLngPosition.IsValid`) and is heard at any range. So the relay
// gets no position on purpose: a relayed transmission is heard as far as the controller's own.
// Coalition 0 would be a spectator, whose audio the server drops under SPECTATORS_AUDIO_DISABLED, and under
// COALITION_AUDIO_SECURITY the server only routes between the same coalition: hence the own coalition.
//
// Reconnect and backoff are sync-link.js's (1, 2, 5, 10, 30 s); the UDP socket is re-opened on every sync connect, as
// crc-desktop's srs-session.js does.

const { createSyncLink } = require('./srs/sync-link');
const { createVoiceLink } = require('./srs/voice-link');
const { radioInfoDict, MAX_RADIOS } = require('./srs/sync-message');
const { encodeVoicePacket } = require('./srs/voice-packet');
const { makeSrsGuid } = require('./srs/srs-guid');
const { channelOf, RELAY_UNIT_ID } = require('./relay-decision');

const RELAY_NAME = 'CRC RELAY';

/** DCS-gRPC's coalition (2 RED, 3 BLUE; surveillance/iff.js ownCoalitionFrom) as SRS numbers it (1 red, 2 blue). */
const srsCoalitionOf = (dcsCoalition) => (dcsCoalition === 2 ? 1 : 2);

/**
 * @param {object} o
 * @param {string} o.host @param {number} o.port
 * @param {number} o.coalition the SRS coalition (srsCoalitionOf)
 * @param {(packet:object, conn:object) => void} o.onPacket every decoded voice packet this connection hears
 * @param {() => void} [o.onState] connected, UDP ready or the error changed
 * @param {object} [o.deps] {net, dgram, timers, now, guid} for tests
 * @param {(msg:string) => void} [o.log]
 */
function createRelaySrsClient(o) {
  const deps = o.deps || {};
  const guid = deps.guid || makeSrsGuid();
  let channels = [];
  let started = false;

  const radioInfo = () => radioInfoDict({
    radios: channels.map((key, i) => ({ ...channelOf(key), name: `relay${i + 1}`, model: 'crc' })),
    unit: RELAY_NAME, unitId: RELAY_UNIT_ID, selected: 0,
  });

  let lastConnected = false;
  const sync = createSyncLink({
    host: o.host, port: o.port, guid, name: RELAY_NAME, coalition: o.coalition, getRadioInfo: radioInfo,
    onState: (s) => {
      if (s.connected && !lastConnected) voice.reopen();
      lastConnected = s.connected;
      if (o.onState) o.onState();
    },
    net: deps.net, timers: deps.timers, now: deps.now, log: o.log,
  });
  const voice = createVoiceLink({
    host: o.host, port: o.port, guid, dgram: deps.dgram, timers: deps.timers, log: o.log,
    onReady: () => { if (o.onState) o.onState(); },
    onEcho: () => sync.heard(),
    onPacket: (p) => o.onPacket(p, conn),
  });

  const conn = {
    guid,
    /** The channels this connection's radios are tuned to (at most MAX_RADIOS). Starts the links on first use. */
    setChannels(next) {
      if (next.length > MAX_RADIOS) throw new Error(`an SRS client has ${MAX_RADIOS} radios`);
      channels = next.slice();
      if (!started) { started = true; sync.start(); return; }
      sync.radiosChanged();
    },
    channels: () => channels.slice(),
    /** @returns {boolean} false when UDP is not ready: nothing sent */
    send(packet) { return voice.send(encodeVoicePacket(packet)); },
    stop() { started = false; sync.stop(); voice.close(); },
    state() {
      const s = sync.state();
      return { connected: s.connected, udpReady: voice.isReady(), error: s.error || null };
    },
  };
  return conn;
}

module.exports = { createRelaySrsClient, srsCoalitionOf, RELAY_NAME };
