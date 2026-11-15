'use strict';

// Which of the two push-to-talks transmits (docs/adr/0166 §1). `ptt` keys the PTT target's group as before; `intercom`
// keys only the intercom, whatever the target is. One transmission at a time (an SRS packet carries the intercom alone,
// H183), so the one pressed first transmits and the other waits: a press never cuts a transmission already going out.
// When the first is let go and the other is still held, the other starts at once. A channel whose radio is missing
// (no PTT target, the intercom removed) keys nothing and does not hold the other back.
// Pure: no DOM, no timers. Each channel's ptt-controller.js calls `start` (again every repeat) and `stop`.

export const CHANNELS = Object.freeze(['ptt', 'intercom']);

/**
 * @param {object} o
 * @param {{setPtt:(down:boolean, radioId:string)=>void}} o.engine
 * @param {(channel:string)=>string|null} o.targetOf  the radio a channel keys now, or null
 */
export function createPttArbiter({ engine, targetOf }) {
  const held = { ptt: false, intercom: false };
  let active = null; // the channel transmitting
  let keyed = null;  // the radio it keyed: a release goes to the same one

  function start(channel) {
    held[channel] = true;
    if (active && active !== channel) return; // the other one is transmitting: wait
    if (!active) {
      const radioId = targetOf(channel);
      if (!radioId) return;
      active = channel;
      keyed = radioId;
    }
    engine.setPtt(true, keyed);
  }

  function stop(channel) {
    held[channel] = false;
    if (active !== channel) return;
    engine.setPtt(false, keyed);
    active = null;
    keyed = null;
    const other = CHANNELS.find(c => c !== channel);
    if (held[other]) start(other);
  }

  return { start, stop, active: () => active };
}
