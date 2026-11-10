// Which audio device to use (pure; S-RADIO-1 RQ9): the saved id if it is present, else a device with the saved label,
// else the default with a note. Chromium device ids are hashed per origin, so a changed port changes every id and the
// label is the fallback.

/**
 * @param {Array<{deviceId:string, label:string, kind:string}>} devices from navigator.mediaDevices.enumerateDevices()
 * @param {'audioinput'|'audiooutput'} kind
 * @param {{id?:string|null, label?:string|null}} saved
 * @returns {{deviceId:string|null, note:string|null}} null deviceId means the default device
 */
export function pickDevice(devices, kind, saved) {
  const id = saved && saved.id, label = saved && saved.label;
  if (!id || id === 'default') return { deviceId: null, note: null };
  const mine = (devices || []).filter(d => d.kind === kind);
  if (mine.some(d => d.deviceId === id)) return { deviceId: id, note: null };
  const byLabel = label ? mine.find(d => d.label === label) : null;
  if (byLabel) return { deviceId: byLabel.deviceId, note: null };
  return { deviceId: null, note: kind === 'audioinput' ? 'saved microphone not present' : 'saved speaker not present' };
}
