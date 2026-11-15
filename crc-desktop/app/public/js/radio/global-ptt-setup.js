'use strict';

// Global PTT's part of the SETUP section (docs/adr/0161 §3, S-RO-1 RO11–13): the enable checkbox, the bound input by
// name with a capture button (CONFIGURE on the portal, where the desktop owns the key), the same for the intercom PTT
// (docs/adr/0166 §1, none until set), and one grey line when there is something to say. It only reads and writes the prefs and asks for a capture; radio-ptt.js tells the main process what
// to listen for.

import { el } from './radio-dom.js';
import { globalPttBridge } from './global-ptt-bridge.js';
import { isRadioPanelClient } from './radio-ptt.js';
import {
  getRadioPrefs, globalPttEnabled, onRadioPrefsChanged, updateRadioPrefs, withGlobalIntercomBinding, withGlobalPtt,
} from './radio-prefs.js';

const WINDOW_ONLY = 'PTT works while this window has focus.';
const REASONS = {
  'no-session': `Global PTT is not available in this session. ${WINDOW_ONLY}`,
  'no-portal': `This desktop has no global shortcuts portal. ${WINDOW_ONLY}`,
  'no-native': `Global PTT could not load on this system. ${WINDOW_ONLY}`,
};
const NOT_AVAILABLE = `Global PTT is not available. ${WINDOW_ONLY}`;
const START_FAILED = `Global PTT could not start. ${WINDOW_ONLY}`;
const DESKTOP_OWNS = 'The desktop owns this key: keyboard only, and other programs may not receive it.';
const ASK_KEY = 'Choose a key to use Global PTT.';
const REFUSED = 'That input is used for typing or clicking. Use F1 to F24, Scroll Lock, Pause, Insert, a navigation key, Right Ctrl or mouse 3 to 5.';
const TAKEN = 'That input is already the other PTT. Choose another.';

/**
 * @param {(label:string, ...controls:HTMLElement[])=>HTMLElement} settingRow  the section's row builder
 * @param {object} [bridge]
 * @returns {{ element: HTMLElement, dispose(): void }}
 */
export function buildGlobalPttSetup(settingRow, bridge = globalPttBridge()) {
  const root = el('div', 'radio-global-ptt');
  if (!isRadioPanelClient()) { root.hidden = true; return { element: root, dispose() {} }; }
  const notAvailable = (text) => root.replaceChildren(el('div', 'radio-note', text));
  if (!bridge) { notAvailable(NOT_AVAILABLE); return { element: root, dispose() {} }; }

  const enable = el('input', null, null, { type: 'checkbox', 'aria-label': 'Global PTT' });
  const channels = {
    ptt: { name: el('span', 'radio-vol-lbl'), bind: el('button', 'radio-small-btn radio-ptt-key', null, { type: 'button' }) },
    intercom: { name: el('span', 'radio-vol-lbl'), bind: el('button', 'radio-small-btn radio-ptt-key', null, { type: 'button' }) },
  };
  const note = el('div', 'radio-note');
  let capturing = null, refused = null, failed = false, kind = null; // capturing: the channel being chosen
  const bindingOf = (prefs, channel) => (channel === 'intercom' ? prefs.globalPtt.intercom[kind] : prefs.globalPtt[kind]);

  function noteText(prefs, on) {
    if (failed) return START_FAILED;
    if (refused === 'taken') return TAKEN;
    if (kind === 'portal') return DESKTOP_OWNS;
    if (refused) return REFUSED;
    return on && !prefs.globalPtt[kind] && !prefs.globalPtt.intercom[kind] ? ASK_KEY : '';
  }

  function paint() {
    if (!kind) return;
    const prefs = getRadioPrefs();
    const on = globalPttEnabled(prefs);
    enable.checked = on;
    for (const [channel, { name, bind }] of Object.entries(channels)) {
      const binding = bindingOf(prefs, channel);
      const mine = capturing === channel;
      bind.disabled = !on || (!!capturing && !mine);
      bind.classList.toggle('radio-listening', mine);
      name.textContent = binding ? binding.label : '';
      if (mine) bind.textContent = kind === 'portal' ? 'see the desktop dialog' : 'press a key';
      else bind.textContent = kind === 'portal' ? 'CONFIGURE' : 'PRESS A KEY';
    }
    note.textContent = noteText(prefs, on);
    note.hidden = !note.textContent;
  }

  // After a change, whether the listener really started.
  const refreshFailed = () => Promise.resolve(bridge.status()).then((st) => { failed = !!(st && st.failed); paint(); }).catch(() => {});

  enable.addEventListener('change', () => updateRadioPrefs(p => withGlobalPtt(p, { enabled: enable.checked })));
  for (const [channel, { bind }] of Object.entries(channels)) {
    bind.addEventListener('click', () => {
      if (capturing) { bridge.cancelCapture(); return; }
      capturing = channel;
      refused = null;
      paint();
      Promise.resolve(bridge.capture(channel)).catch(() => null).then((got) => {
        capturing = null;
        refused = got && got.refused ? (got.taken ? 'taken' : 'refused') : null;
        if (got && !got.refused) {
          updateRadioPrefs(p => (channel === 'intercom' ? withGlobalIntercomBinding(p, kind, got) : withGlobalPtt(p, { [kind]: got })));
        }
        paint();
      });
    });
  }
  // While an input is being chosen, the window's own PTT does not see it.
  const holdKeys = (e) => { if (capturing) { e.preventDefault(); e.stopPropagation(); } };
  document.addEventListener('keydown', holdKeys, true);
  const offPrefs = onRadioPrefsChanged(() => { paint(); refreshFailed(); });

  Promise.resolve(bridge.status()).catch(() => null).then((st) => {
    if (!st || !st.available) { notAvailable((st && REASONS[st.reason]) || NOT_AVAILABLE); return; }
    kind = st.kind;
    failed = !!st.failed;
    root.replaceChildren(
      settingRow('Global PTT', enable),
      settingRow('Global PTT input', channels.ptt.name, channels.ptt.bind),
      settingRow('Global intercom PTT', channels.intercom.name, channels.intercom.bind),
      note,
    );
    paint();
  });

  return {
    element: root,
    dispose() {
      document.removeEventListener('keydown', holdKeys, true);
      offPrefs();
      if (capturing) bridge.cancelCapture();
    },
  };
}
