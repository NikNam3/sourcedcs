'use strict';
// One SRS client for one renderer connection (ADR 0158 §1): the sync link, the voice link and the radio slots,
// put together. It holds no audio: Opus frames come in from the renderer and go out to it as they are.
//
// Transmit: `ptt(true, radioIds)` names the radios; every Opus frame then goes out as one packet carrying every
// frequency of them (ADR 0158 §4, controller side), both GUIDs our own, retransmissionCount 0, as client.py. A press
// while UDP is not ready is refused in the state (S-RADIO-1 RQ4).
// Receive: a packet is handed on with the radios it matches (radio-slots.js). One that matches none is dropped and
// counted: the server sent something we did not tune.
// Intercom (H183, client.py add_intercom/set_intercom_unit): SRS routes an intercom packet to the clients with the
// sender's unit id. Joining another client's intercom is taking its unit id as our own, `setIntercomUnit(id)`; null
// goes back to the shared 1. The SRS client list (other clients with a unit id, as client.py's snapshot) is in the
// state as `srsClients`, for the picker.
// The relay is crc-sync's (docs/adr/0160), not ours. Two things on receive come from it: a packet whose
// `originalGuid` is ours is our own voice relayed onto a frequency we also listen on, and is dropped (no echo); and
// the relay's copy of a pilot we already heard directly (same original, same packet number) is dropped by
// rx-dedupe.js, so a controller tuned to two frequencies of one network hears the pilot once.

const { createSyncLink } = require('./sync-link');
const { createVoiceLink } = require('./voice-link');
const { radioInfoDict, MsgType, Modulation } = require('./sync-message');
const { buildSlots, matchRadioIds, txChannels, selectedSlot } = require('./radio-slots');
const { encodeVoicePacket } = require('./voice-packet');
const { createRxDedupe } = require('./rx-dedupe');

/** The unit id every CRC sends unless it joined an intercom: client.py's fixed shared 1 (S-RADIO-1 RQ3). */
const UNIT_ID = 1;

/**
 * @param {object} o
 * @param {string} o.host @param {number} o.port @param {string} o.guid one per app run
 * @param {string} o.name @param {number} [o.coalition]
 * @param {(state:object) => void} o.onState
 * @param {(rx:{header:object, opus:Buffer}) => void} o.onRx
 * @param {object} [o.deps] {net, dgram, timers, now} for tests
 * @param {(msg:string) => void} [o.log]
 */
function createSrsSession(o) {
  const deps = o.deps || {};
  const log = o.log || (() => {});
  let slots = [], slotError = null, invalid = [], overflow = [];
  let pttDown = false, tx = { frequencies: [], modulations: [], encryptions: [], radioIds: [] };
  let packetNumber = 0, unmatched = 0, pttError = null, unitId = UNIT_ID, duplicates = 0;
  const now = deps.now || Date.now; // housekeeping: the dedupe window
  const dedupe = createRxDedupe();
  // CRC_SRS_DEBUG=1 (server.js): one log line per received transmission, to see whose audio arrives on what.
  const traced = new Map();
  function traceRx(p) {
    const key = `${p.originalGuid}|${p.guid}`, t = now();
    if (t - (traced.get(key) || 0) > 2000) {
      log(`rx from=${p.guid} original=${p.originalGuid}${p.originalGuid === o.guid ? ' (OURS)' : ''} rt=${p.retransmissionCount} unit=${p.unitId} freqs=${p.frequencies.map(f => (f / 1e6).toFixed(3)).join(',')}`);
    }
    traced.set(key, t);
  }
  const clients = new Map(); // guid -> {name, unitId}

  const radioInfo = () => radioInfoDict({
    radios: slots.map(s => ({
      hz: s.hz, modulation: s.modulation, name: s.name, model: 'crc',
      intercomUnitId: s.modulation === Modulation.INTERCOM ? unitId : 0,
    })),
    unit: o.name, unitId, selected: selectedSlot(slots, tx.radioIds),
  });

  function noteClient(c) {
    if (!c || !c.ClientGuid || c.ClientGuid === o.guid) return false;
    const next = { name: c.Name || '', unitId: (c.RadioInfo && c.RadioInfo.unitId) || 0 };
    const prev = clients.get(c.ClientGuid);
    if (prev && prev.name === next.name && prev.unitId === next.unitId) return false;
    clients.set(c.ClientGuid, next);
    return true;
  }
  function onMessage(m) {
    let changed = false;
    if (m.MsgType === MsgType.CLIENT_DISCONNECT) changed = clients.delete(m.Client && m.Client.ClientGuid);
    else if ([MsgType.UPDATE, MsgType.RADIO_UPDATE, MsgType.SYNC].includes(m.MsgType)) {
      changed = noteClient(m.Client);
      for (const c of m.Clients || []) changed = noteClient(c) || changed;
    }
    if (changed) emit();
  }

  let lastConnected = false;
  const sync = createSyncLink({
    host: o.host, port: o.port, guid: o.guid, name: o.name, coalition: o.coalition || 0, getRadioInfo: radioInfo,
    onState: (s) => {
      if (s.connected && !lastConnected) voice.reopen();
      if (!s.connected) clients.clear();
      lastConnected = s.connected; emit();
    },
    onMessage,
    net: deps.net, timers: deps.timers, now: deps.now, log,
  });

  const voice = createVoiceLink({
    host: o.host, port: o.port, guid: o.guid, dgram: deps.dgram, timers: deps.timers, log,
    onReady: () => emit(),
    onEcho: () => sync.heard(),
    onPacket: (p) => {
      if (o.debug) traceRx(p);
      if (p.originalGuid === o.guid) return; // our own voice, relayed by crc-sync onto another frequency we hear
      const radioIds = matchRadioIds(slots, p.frequencies, p.modulations, p.encryptions);
      if (!radioIds.length) { unmatched++; return; }
      if (!dedupe.first(p, now())) { duplicates++; return; }
      o.onRx({
        header: { radioIds, guid: p.guid, originalGuid: p.originalGuid, packetNumber: p.packetNumber, retransmissionCount: p.retransmissionCount },
        opus: p.audio,
      });
    },
  });

  function state() {
    const s = sync.state();
    return {
      connected: s.connected,
      udpReady: voice.isReady(),
      versionMismatch: s.versionMismatch,
      error: slotError || pttError || s.error || null,
      invalidRadioIds: invalid,
      overflowRadioIds: overflow,
      txRadioIds: pttDown ? tx.radioIds : [],
      unmatchedPackets: unmatched,
      droppedPackets: voice.droppedPackets(),
      duplicatePackets: duplicates,
      unitId,
      srsClients: [...clients.values()].filter(c => c.unitId > 0).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  function emit() { o.onState(state()); }

  return {
    start() { sync.start(); },
    stop() { sync.stop(); voice.close(); },
    /** @param {Array<{id:string, mhz:number, modulation?:string, label?:string}>} radios */
    setRadios(radios) {
      const b = buildSlots(radios);
      slots = b.slots; slotError = b.error; invalid = b.invalid; overflow = b.overflow;
      if (pttDown) tx = txChannels(slots, tx.radioIds);
      sync.radiosChanged();
      emit();
    },
    ptt(down, radioIds) {
      if (down) {
        tx = txChannels(slots, radioIds || []);
        pttError = !voice.isReady() ? 'SRS voice link not ready: not transmitting' : (!tx.frequencies.length ? 'no tuned radio to transmit on' : null);
        pttDown = !pttError;
      } else {
        pttDown = false; pttError = null;
      }
      sync.radiosChanged();
      emit();
    },
    /** Join another client's intercom by taking its unit id; null for the shared default. */
    setIntercomUnit(id) {
      const next = Number.isInteger(id) && id > 0 ? id : UNIT_ID;
      if (next === unitId) return;
      unitId = next;
      sync.radiosChanged();
      emit();
    },
    /** One Opus frame from the renderer's encoder. Sent only while the key is down. */
    txFrame(opus) {
      if (!pttDown || !tx.frequencies.length) return false;
      packetNumber++;
      return voice.send(encodeVoicePacket({
        audio: opus, frequencies: tx.frequencies, modulations: tx.modulations, encryptions: tx.encryptions,
        unitId, packetNumber, retransmissionCount: 0, originalGuid: o.guid, guid: o.guid,
      }));
    },
    state,
  };
}

module.exports = { createSrsSession, UNIT_ID };
