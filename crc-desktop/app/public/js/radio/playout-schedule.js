// When each received frame plays (pure; S-RADIO-1 RQ7). One schedule per sender: a transmission starts
// PLAYOUT_DELAY_MS after its first frame arrives, and every frame then plays at its packet number's slot, so frames
// play back to back, a reordered frame lands in its place, a lost one leaves silence, and a frame that arrives after
// its slot is dropped. A stream that falls behind the clock or runs ahead of it by MAX_DRIFT_MS restarts.
//
// Times are in seconds on the AudioContext clock. The frame length is each frame's own decoded duration: a sender may
// use 20 or 40 ms frames (SRS sends 40).

import { PLAYOUT_DELAY_MS, MAX_DRIFT_MS, RX_TIMEOUT_MS } from './radio-audio-constants.js';

export function createPlayoutSchedule({ delayMs = PLAYOUT_DELAY_MS, maxDriftMs = MAX_DRIFT_MS, gapMs = RX_TIMEOUT_MS } = {}) {
  let base = null; // { time, packet } : packet `packet` plays at `time`
  let lastArrival = -Infinity;
  const delay = delayMs / 1000, drift = maxDriftMs / 1000, gap = gapMs / 1000;
  const restart = (packet, now) => { base = { time: now + delay, packet }; };

  return {
    /**
     * @param {number} packet the frame's packet number
     * @param {number} duration seconds
     * @param {number} now the context clock
     * @returns {number|null} when to start it, or null to drop it (late)
     */
    place(packet, duration, now) {
      if (!base || now - lastArrival > gap) restart(packet, now);
      lastArrival = now;
      let at = base.time + (packet - base.packet) * duration;
      if (at < now - drift || at > now + delay + drift) { restart(packet, now); at = base.time; }
      if (at < now) return null;
      return at;
    },
    /** Has this sender been silent long enough that its transmission has ended? */
    ended(now) { return now - lastArrival > gap; },
  };
}
