'use strict';
// One SRS client for one renderer connection (ADR 0158 §1): the sync link, the voice link and the radio slots,
// put together. It holds no audio: Opus frames come in from the renderer and go out to it as they are.
//
// Transmit: `ptt(true, radioIds)` names the radios; every Opus frame then goes out as one packet carrying every
// frequency of them (ADR 0158 §4, controller side), both GUIDs our own, retransmissionCount 0, as client.py. A press
// while UDP is not ready is refused in the state (S-RADIO-1 RQ4).
// Receive: a packet is handed on with the radios it matches (radio-slots.js). One that matches none is dropped and
// counted: the server sent something we did not tune.

const { createSyncLink } = require('./sync-link');
const { createVoiceLink } = require('./voice-link');
const { radioInfoDict } = require('./sync-message');
const { buildSlots, matchRadioIds, txChannels, selectedSlot } = require('./radio-slots');
const { encodeVoicePacket } = require('./voice-packet');

/** The unit id every CRC sends: client.py's fixed shared 1 (S-RADIO-1 RQ3). */
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
  let packetNumber = 0, unmatched = 0, pttError = null;

  const radioInfo = () => radioInfoDict({
    radios: slots.map(s => ({ hz: s.hz, modulation: s.modulation, name: s.name, model: 'crc' })),
    unit: o.name, unitId: UNIT_ID, selected: selectedSlot(slots, tx.radioIds),
  });

  let lastConnected = false;
  const sync = createSyncLink({
    host: o.host, port: o.port, guid: o.guid, name: o.name, coalition: o.coalition || 0, getRadioInfo: radioInfo,
    onState: (s) => { if (s.connected && !lastConnected) voice.reopen(); lastConnected = s.connected; emit(); },
    net: deps.net, timers: deps.timers, now: deps.now, log,
  });

  const voice = createVoiceLink({
    host: o.host, port: o.port, guid: o.guid, dgram: deps.dgram, timers: deps.timers, log,
    onReady: () => emit(),
    onEcho: () => sync.heard(),
    onPacket: (p) => {
      const radioIds = matchRadioIds(slots, p.frequencies, p.modulations, p.encryptions);
      if (!radioIds.length) { unmatched++; return; }
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
    /** One Opus frame from the renderer's encoder. Sent only while the key is down. */
    txFrame(opus) {
      if (!pttDown || !tx.frequencies.length) return false;
      packetNumber++;
      return voice.send(encodeVoicePacket({
        audio: opus, frequencies: tx.frequencies, modulations: tx.modulations, encryptions: tx.encryptions,
        unitId: UNIT_ID, packetNumber, retransmissionCount: 0, originalGuid: o.guid, guid: o.guid,
      }));
    },
    state,
  };
}

module.exports = { createSrsSession, UNIT_ID };
