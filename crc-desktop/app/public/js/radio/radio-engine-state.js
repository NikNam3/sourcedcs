// The built-in radio's state (leaf; ADR 0158 §6: no radio manager, the state is a leaf the others read and write).
// What onState() listeners get:
//   connected       the SRS sync link is up
//   udpReady        the SRS voice link has its echo (transmitting needs it)
//   enabled         the server runs the built-in client (config.json radioClient "node"); null until it says
//   error           the one thing wrong, in words, or null
//   rxRadioIds      radios receiving now (muted ones too)
//   txRadioIds      radios transmitting now
//   opusSupported   WebCodecs has Opus both ways; null until checked
//   deviceNote      a saved device that was not found, or null
//   overflowRadioIds, invalidRadioIds  radios the server could not tune
//   srsClients      the other SRS clients with a unit id, [{name, unitId}], for the intercom picker (H183)
//   intercomUnitId  the unit id we send (1, the shared default, until an intercom is joined)

const state = {
  connected: false, udpReady: false, enabled: null, error: null, rxRadioIds: [], txRadioIds: [], opusSupported: null,
  deviceNote: null, overflowRadioIds: [], invalidRadioIds: [], srsClients: [], intercomUnitId: 1,
};
const listeners = new Set();

const same = (a, b) => (Array.isArray(a) && Array.isArray(b) ? JSON.stringify(a) === JSON.stringify(b) : a === b);

export function getEngineState() { return { ...state }; }

export function setEngineState(partial) {
  let changed = false;
  for (const [k, v] of Object.entries(partial)) {
    if (!(k in state) || same(state[k], v)) continue;
    state[k] = v; changed = true;
  }
  if (!changed) return;
  const snap = getEngineState();
  for (const fn of listeners) fn(snap);
}

/** @returns {() => void} unsubscribe */
export function subscribeEngineState(fn) {
  listeners.add(fn);
  fn(getEngineState());
  return () => listeners.delete(fn);
}
