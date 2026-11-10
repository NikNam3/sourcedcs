// Which radios are receiving right now (pure): a radio lights RX while a packet matched it in the last RX_TIMEOUT_MS,
// muted or not (dark cockpit: the controller sees traffic on a muted radio, S-RADIO-1 RQ6).

import { RX_TIMEOUT_MS } from './radio-audio-constants.js';

export function createRxActivity(timeoutMs = RX_TIMEOUT_MS) {
  const seen = new Map(); // radioId -> ms
  return {
    /** @param {string[]} radioIds @param {number} nowMs */
    heard(radioIds, nowMs) { for (const id of radioIds) seen.set(id, nowMs); },
    /** @returns {string[]} the radios still receiving; the expired ones are forgotten */
    active(nowMs) {
      for (const [id, t] of seen) if (nowMs - t > timeoutMs) seen.delete(id);
      return [...seen.keys()];
    },
  };
}
