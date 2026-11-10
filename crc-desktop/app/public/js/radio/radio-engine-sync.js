'use strict';

// Tells the radio engine what changed, and only that: the radios (whole, every time they change, as the contract
// says), each radio's volume/pan/mute when its radios are sent, and the audio options and the intercom unit (H183)
// when they change.

import { audioOptionsOf, radioAudioOf } from './radio-prefs.js';

export function createEngineSync(engine) {
  let radiosKey = null;
  let optionsKey = null;
  let intercomKey;
  return {
    /** After every recompute of the set. */
    push(set, prefs) {
      const rk = JSON.stringify(set.radios);
      if (rk !== radiosKey) {
        radiosKey = rk;
        engine.setRadios(set.radios);
        for (const r of set.radios) engine.setRadioAudio(r.id, radioAudioOf(prefs, r.id));
      }
      const opts = audioOptionsOf(prefs);
      const ok = JSON.stringify(opts);
      if (ok !== optionsKey) { optionsKey = ok; engine.setAudioOptions(opts); }
      const unit = prefs.intercom ? prefs.intercom.unitId : null;
      if (unit !== intercomKey) { intercomKey = unit; engine.setIntercomUnit(unit); }
    },
  };
}
