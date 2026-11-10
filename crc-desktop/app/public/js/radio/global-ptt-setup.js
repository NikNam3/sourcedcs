'use strict';

// Global PTT's part of the SETUP section (docs/adr/0161 §3): the enable checkbox, the capture button showing the bound
// input by name, and one grey line when this system has no listener. It only reads and writes the prefs and asks for a
// capture; radio-ptt.js tells the main process what to listen for.

import { el } from './radio-dom.js';
import { globalPttBridge } from './global-ptt-bridge.js';
import { isRadioPanelClient } from './radio-ptt.js';
import { getRadioPrefs, globalPttEnabled, onRadioPrefsChanged, updateRadioPrefs, withGlobalPtt } from './radio-prefs.js';

const NOT_AVAILABLE = 'Global PTT is not available on this system. PTT works while this window has focus.';
const UNBOUND = 'PRESS A KEY';

/**
 * @param {(label:string, ...controls:HTMLElement[])=>HTMLElement} settingRow  the section's row builder
 * @param {object} [bridge]
 * @returns {{ element: HTMLElement, dispose(): void }}
 */
export function buildGlobalPttSetup(settingRow, bridge = globalPttBridge()) {
  const root = el('div', 'radio-global-ptt');
  if (!isRadioPanelClient()) { root.hidden = true; return { element: root, dispose() {} }; }
  const notAvailable = () => root.replaceChildren(el('div', 'radio-note', NOT_AVAILABLE));
  if (!bridge) { notAvailable(); return { element: root, dispose() {} }; }

  const enable = el('input', null, null, { type: 'checkbox', 'aria-label': 'Global PTT' });
  const bind = el('button', 'radio-small-btn radio-ptt-key', UNBOUND, { type: 'button', title: 'Click, then press the key or mouse button (Esc cancels)' });
  let capturing = false;
  let kind = null;

  function paint() {
    const prefs = getRadioPrefs();
    const on = globalPttEnabled(prefs);
    enable.checked = on;
    bind.disabled = !on;
    bind.classList.toggle('radio-listening', capturing);
    if (capturing) bind.textContent = kind === 'portal' ? 'see the desktop dialog' : 'press a key';
    else bind.textContent = prefs.globalPtt.binding ? prefs.globalPtt.binding.name : UNBOUND;
  }

  enable.addEventListener('change', () => updateRadioPrefs(p => withGlobalPtt(p, { enabled: enable.checked })));
  bind.addEventListener('click', () => {
    if (capturing) { bridge.cancelCapture(); return; }
    capturing = true;
    paint();
    Promise.resolve(bridge.capture()).catch(() => null).then((binding) => {
      capturing = false;
      if (binding) updateRadioPrefs(p => withGlobalPtt(p, { binding }));
      paint();
    });
  });
  // While an input is being chosen, the window's own PTT does not see it.
  const holdKeys = (e) => { if (capturing) { e.preventDefault(); e.stopPropagation(); } };
  document.addEventListener('keydown', holdKeys, true);
  const offPrefs = onRadioPrefsChanged(paint);

  Promise.resolve(bridge.status()).catch(() => null).then((st) => {
    if (!st || !st.available) { notAvailable(); return; }
    kind = st.kind;
    root.replaceChildren(settingRow('Global PTT', enable), settingRow('Global PTT input', bind));
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
