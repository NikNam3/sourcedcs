'use strict';

// The new radio panel's push-to-talk (S-RADIO-1 RQ12): the panel owns the PTT controller (ptt-controller.js: key,
// blur, visibility, maximum transmit time), and its `post` becomes `engine.setPtt(down, target)`. The key is bound
// only while this panel is the selected radio client (RQ11: `config.json` `radioClient`); until the supervisor joins
// it to that choice, it binds none, so it never fights the old SRS panel for the same key. The PTT button works
// either way.

import { createPttController, PTT_MAX_TX_DEFAULT_S } from '../ptt-controller.js';
import { getRadioPrefs, globalPttEnabled, onRadioPrefsChanged, updateRadioPrefs, withGlobalPtt } from './radio-prefs.js';
import { globalPttBridge } from './global-ptt-bridge.js';

let _isClient = false;

/** The supervisor calls this when the new client is the selected one (and with false when it is not). */
export function setRadioPanelIsClient(on) { _isClient = !!on; }
export function isRadioPanelClient() { return _isClient; }

function isTyping() {
  const tag = String((document.activeElement && document.activeElement.tagName) || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Joins the main process's global input to the controller (docs/adr/0161 §3), and tells it what to listen for: nothing
 * unless this panel is the radio client and Global PTT is on. A release always passes, whatever the panel's state.
 * @returns the unsubscribe
 */
export function wireGlobalPtt(controller, bridge = globalPttBridge()) {
  if (!bridge) return () => {};
  const offEdge = bridge.onEdge((down) => {
    if (!down) controller.globalUp();
    else if (_isClient) controller.globalDown();
  });
  let sent = null;
  const sync = (prefs) => {
    const cfg = { enabled: _isClient && globalPttEnabled(prefs), binding: prefs.globalPtt.binding };
    const key = JSON.stringify(cfg);
    if (key === sent) return;
    sent = key;
    Promise.resolve(bridge.configure(cfg)).then((st) => {
      // A desktop's portal can rename the input (the controller changed it in the desktop's settings).
      const now = getRadioPrefs().globalPtt.binding;
      if (st && st.binding && now && st.binding.name !== now.name) updateRadioPrefs(p => withGlobalPtt(p, { binding: st.binding }));
    }).catch(() => {});
  };
  sync(getRadioPrefs());
  const offPrefs = onRadioPrefsChanged(sync);
  return () => { offEdge(); offPrefs(); };
}

/**
 * @param {object} o  engine (setPtt), getTarget() -> radioId | null, setActive(on)
 * @returns the controller (`down`, `up`, `globalDown`, `globalUp`, `isHeld`)
 */
export function createRadioPtt({ engine, getTarget, setActive }) {
  let keyed = null; // the radio the current transmission was keyed on: a release goes to the same one
  const controller = createPttController({
    post: (path) => {
      if (path === '/ptt/start') {
        keyed = keyed || getTarget();
        if (keyed) engine.setPtt(true, keyed);
      } else {
        if (keyed) engine.setPtt(false, keyed);
        keyed = null;
      }
    },
    setActive,
    getKey: () => (_isClient ? getRadioPrefs().pttKey : ''),
    isTyping,
    win: window,
    doc: document,
    getMaxTxSeconds: () => getRadioPrefs().maxTxS ?? PTT_MAX_TX_DEFAULT_S,
    log: (m) => console.warn('[radio-ptt] ' + m),
  });
  wireGlobalPtt(controller);
  return controller;
}
