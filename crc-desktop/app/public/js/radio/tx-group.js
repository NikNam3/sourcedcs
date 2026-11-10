// Which radios a press of the key transmits on (pure; ADR 0158 §2, docs/parallel/radio/README.md): the pressed radio's
// whole link group, or the radio alone when it is unlinked. A receive-only radio (an Observer's, S-RADIO-1 RQ14) never
// transmits, whether pressed or in the group. The intercom is never linked (H183): pressed, it transmits alone, and it
// never rides along with a group.

const isIntercom = (r) => String(r.modulation || '').toUpperCase() === 'INTERCOM';

/**
 * @param {Array<{id:string, modulation?:string, groupId?:string|null, receiveOnly?:boolean}>} radios
 * @param {string} radioId
 * @returns {string[]}
 */
export function txRadioIdsFor(radios, radioId) {
  const pressed = (radios || []).find(r => r.id === radioId);
  if (!pressed || pressed.receiveOnly) return [];
  if (isIntercom(pressed)) return [pressed.id];
  const members = pressed.groupId ? radios.filter(r => r.groupId === pressed.groupId) : [pressed];
  return members.filter(r => !r.receiveOnly && !isIntercom(r)).map(r => r.id);
}
