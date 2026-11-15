'use strict';

// The new radio panel's push-to-talk (S-RADIO-1 RQ12): the panel owns the PTT controller (ptt-controller.js: key,
// blur, visibility, maximum transmit time), and its `post` becomes `engine.setPtt(down, target)`. The key is bound
// only while this panel is the selected radio client (RQ11: `config.json` `radioClient`); until the supervisor joins
// it to that choice, it binds none, so it never fights the old SRS panel for the same key. The PTT button works
// either way. The intercom PTT key (docs/adr/0166 §1) has a controller of its own, keying only the intercom;
// radio-ptt-arbiter.js decides which of the two transmits when both are held.

import { createPttController, PTT_MAX_TX_DEFAULT_S } from '../ptt-controller.js';
import {
  getRadioPrefs, globalPttEnabled, onRadioPrefsChanged, updateRadioPrefs, withGlobalIntercomBinding, withGlobalPtt,
} from './radio-prefs.js';
import { globalPttBridge } from './global-ptt-bridge.js';
import { createPttArbiter } from './radio-ptt-arbiter.js';

let _isClient = false;

/** The supervisor calls this when the new client is the selected one (and with false when it is not). */
export function setRadioPanelIsClient(on) { _isClient = !!on; }
export function isRadioPanelClient() { return _isClient; }

function isTyping() {
  const tag = String((document.activeElement && document.activeElement.tagName) || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Joins the main process's global input to the controllers (docs/adr/0161 §3; `{ ptt, intercom }`, docs/adr/0166 §1:
 * an edge names its channel, none is `ptt`), and tells it what to listen for: nothing unless this panel is the radio
 * client and Global PTT is on. A release always passes, whatever the panel's state.
 * @returns the unsubscribe
 */
export function wireGlobalPtt(controllers, bridge = globalPttBridge()) {
  if (!bridge) return () => {};
  const offEdge = bridge.onEdge((down, channel) => {
    const controller = channel === 'intercom' ? controllers.intercom : controllers.ptt;
    if (!controller) return;
    if (!down) controller.up('global');
    else if (_isClient) controller.down('global');
  });
  let kind = null; // which listener this session has: its binding is the one that counts
  let sent = null;
  const sync = (prefs) => {
    if (!kind) return;
    const cfg = { enabled: _isClient && globalPttEnabled(prefs), binding: prefs.globalPtt[kind], intercom: prefs.globalPtt.intercom[kind] };
    const key = JSON.stringify(cfg);
    if (key === sent) return;
    sent = key;
    Promise.resolve(bridge.configure(cfg)).then((st) => {
      // A desktop's portal can rename the input (the controller changed it in the desktop's settings).
      const g = getRadioPrefs().globalPtt;
      const now = g[kind], icNow = g.intercom[kind];
      if (st && st.binding && now && st.binding.label !== now.label) updateRadioPrefs(p => withGlobalPtt(p, { [kind]: st.binding }));
      if (st && st.intercom && icNow && st.intercom.label !== icNow.label) updateRadioPrefs(p => withGlobalIntercomBinding(p, kind, st.intercom));
    }).catch(() => {});
  };
  Promise.resolve(bridge.status()).then((st) => {
    if (!st || !st.available) return;
    kind = st.kind;
    sync(getRadioPrefs());
  }).catch(() => {});
  const offPrefs = onRadioPrefsChanged(sync);
  return () => { offEdge(); offPrefs(); };
}

/**
 * @param {object} o  engine (setPtt), getTarget() -> radioId | null, getIntercomTarget() -> the intercom's radio id |
 *   null, setActive(on) (the PTT button: the main channel only)
 * @returns the main controller (`down`, `up`, `isHeld`), with the intercom's as `.intercom`
 */
export function createRadioPtt({ engine, getTarget, getIntercomTarget = () => null, setActive }) {
  const arbiter = createPttArbiter({ engine, targetOf: (channel) => (channel === 'intercom' ? getIntercomTarget() : getTarget()) });
  const make = (channel, getKey, paint) => createPttController({
    post: (path) => { if (path === '/ptt/start') arbiter.start(channel); else arbiter.stop(channel); },
    setActive: paint,
    getKey: () => (_isClient ? getKey() || '' : ''),
    isTyping,
    win: window,
    doc: document,
    getMaxTxSeconds: () => getRadioPrefs().maxTxS ?? PTT_MAX_TX_DEFAULT_S,
    log: (m) => console.warn(`[radio-ptt ${channel}] ${m}`),
    onFuse: () => { const b = globalPttBridge(); if (b) b.fuseFired(channel); },
  });
  const controller = make('ptt', () => getRadioPrefs().pttKey, setActive);
  const intercom = make('intercom', () => getRadioPrefs().intercomPttKey, () => {});
  wireGlobalPtt({ ptt: controller, intercom });
  return Object.assign(controller, { intercom });
}
