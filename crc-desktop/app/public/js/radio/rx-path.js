// What happens to a received frame (ADR 0158 §1; S-RADIO-1 RQ6, RQ7): the RX lamps, one decoder per sender GUID, the
// playout schedule, the start and end tones, and the noise while a radio is receiving.
//
// A packet lights every radio it matched. It plays once, through the loudest unmuted of them (rx-mixer.js). While
// this client transmits on a radio, packets for that radio are not played (a set that is transmitting does not
// receive); the other radios keep playing. A sender silent for RX_TIMEOUT_MS has ended: its end tone plays and its
// decoder is freed, as lxsrs_v2's _run_rx_monitor.

import { RX_TIMEOUT_MS, SAMPLE_RATE } from './radio-audio-constants.js';
import { createPlayoutSchedule } from './playout-schedule.js';
import { createRxActivity } from './rx-activity.js';

/**
 * @param {object} o
 * @param {AudioContext} o.ctx
 * @param {ReturnType<import('./rx-mixer.js').createRxMixer>} o.mixer
 * @param {ReturnType<import('./radio-effects.js').createRadioEffects>} o.effects
 * @param {(onPcm:Function) => {decode:Function, close:Function}} o.createDecoder
 * @param {() => {soundSet:string, noise:boolean}} o.options
 * @param {() => Set<string>} o.txRadioIds
 * @param {(radioId:string) => string} o.modulationOf 'AM' | 'FM'
 * @param {() => number} [o.nowMs]
 */
export function createRxPath(o) {
  const nowMs = o.nowMs || (() => performance.now());
  const activity = createRxActivity();
  const senders = new Map(); // guid -> {decoder, schedule, radioId, lastMs}
  const noises = new Map();  // radioId -> stop()

  function updateNoise() {
    const busy = new Set([...senders.values()].map(s => s.radioId));
    for (const [id, stop] of noises) if (!busy.has(id) || !o.options().noise) { stop(); noises.delete(id); }
    if (!o.options().noise) return;
    for (const id of busy) if (!noises.has(id)) noises.set(id, o.effects.noise(o.mixer.input(id), o.modulationOf(id)));
  }

  function end(guid, s) {
    s.decoder.close();
    senders.delete(guid);
    o.effects.tone(o.mixer.input(s.radioId), o.options().soundSet, 'end');
  }

  return {
    /** @param {{radioIds:string[], guid:string, packetNumber:number}} header @param {Uint8Array} opus */
    receive(header, opus) {
      const ids = header.radioIds || [];
      activity.heard(ids, nowMs());
      const tx = o.txRadioIds();
      if (ids.some(id => tx.has(id))) return;
      let s = senders.get(header.guid);
      if (!s) {
        const radioId = o.mixer.pick(ids);
        if (!radioId) return;
        const schedule = createPlayoutSchedule();
        s = { radioId, schedule, lastMs: 0, decoder: null };
        s.decoder = o.createDecoder((pcm, n) => {
          const at = schedule.place(n, pcm.length / SAMPLE_RATE, o.ctx.currentTime);
          if (at !== null) o.mixer.play(s.radioId, pcm, at);
        });
        senders.set(header.guid, s);
        o.effects.tone(o.mixer.input(radioId), o.options().soundSet, 'start');
        updateNoise();
      }
      s.lastMs = nowMs();
      s.decoder.decode(opus, header.packetNumber);
    },
    /** Call every 50 ms or so: ends silent senders. */
    tick() {
      const now = nowMs();
      let changed = false;
      for (const [guid, s] of senders) if (now - s.lastMs > RX_TIMEOUT_MS) { end(guid, s); changed = true; }
      if (changed) updateNoise();
    },
    rxRadioIds: () => activity.active(nowMs()),
    /** The noise option changed. */
    updateNoise,
    close() { for (const [guid, s] of senders) { s.decoder.close(); senders.delete(guid); } updateNoise(); },
  };
}
