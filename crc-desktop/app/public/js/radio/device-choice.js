'use strict';

// Which audio device a saved choice means now (S-RADIO-1 RQ9). A choice is saved as `{ deviceId, label }`: it is found
// by id, else by the same label (a Chromium device id is per origin and can change), else the system default is used
// and the panel says, once and in grey, that the saved device is not present. Pure, a leaf.

/** `{ deviceId: string | null, missing: boolean }`; `devices` are `[{ deviceId, label }]` of one kind. */
export function resolveDevice(saved, devices = []) {
  if (!saved || !saved.deviceId) return { deviceId: null, missing: false };
  if (devices.some(d => d.deviceId === saved.deviceId)) return { deviceId: saved.deviceId, missing: false };
  const byLabel = saved.label ? devices.find(d => d.label && d.label === saved.label) : null;
  if (byLabel) return { deviceId: byLabel.deviceId, missing: false };
  return { deviceId: null, missing: true };
}

/** `enumerateDevices()`'s list split by kind, without the browser's own "default" and "communications" entries. */
export function devicesByKind(list = []) {
  const real = (d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications';
  const pick = (kind) => list.filter(d => d.kind === kind && real(d)).map(d => ({ deviceId: d.deviceId, label: d.label || '' }));
  return { inputs: pick('audioinput'), outputs: pick('audiooutput') };
}

/** The engine's `setDevices` argument from the saved choices and the present devices, and what is missing. */
export function deviceSelection(prefsDevices, present) {
  const input = resolveDevice(prefsDevices.input, present.inputs);
  const output = resolveDevice(prefsDevices.output, present.outputs);
  return {
    engine: { inputId: input.deviceId, outputId: output.deviceId },
    notes: [input.missing ? 'saved microphone not present: using the default' : '', output.missing ? 'saved speaker not present: using the default' : ''].filter(Boolean),
  };
}
