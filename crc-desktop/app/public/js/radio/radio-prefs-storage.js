'use strict';

// Binds radio-prefs.js to settings.js's one `radio` object (S-RADIO-1 RQ17). On the first load (no `radio` object yet)
// the PTT key and maximum transmit time the controller set in the old SRS panel carry over; its other keys stay where
// they are, for the old panel.

import { settings, saveSettings } from '../settings.js';
import { bindRadioPrefsStorage, normalizeRadioPrefs, seedFromOldPanel } from './radio-prefs.js';

function oldPref(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null || raw === 'null' ? null : JSON.parse(raw);
  } catch { return null; }
}

export function bindRadioPrefsToSettings() {
  bindRadioPrefsStorage({
    load: () => settings.radio || seedFromOldPanel(normalizeRadioPrefs(null), {
      pttKey: oldPref('srs_pref_ptt_key'), maxTxS: oldPref('srs_pref_ptt_max_tx_s'),
    }),
    save: (prefs) => { settings.radio = prefs; saveSettings(); },
  });
}
