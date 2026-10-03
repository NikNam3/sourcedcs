'use strict';

// A controller holding LC with GC or CD, and the frequencies of a Position (crc-sync docs/adr/0105, H104). Pure: no DOM,
// no state. The server sends each Position's `frequencies` and `combinedWith` (the other Positions whose Primary is the same
// controller); this turns them into the words the panel shows. Warn, never block. The wording is [SOURCE-DEFINED] and cites
// the FAA's JO 7210.3 by analogy.

export const LOCAL_POSITION = 'LC';
export const NON_LOCAL_TOWER = ['GC', 'CD'];
const LUAW_STATES = ['RUNWAY_QUEUE', 'LUAW'];

/** "GND 275.8" for one entry. */
export function formatFrequency(f) {
  return `${f.label} ${Number(f.mhz).toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0')}`;
}

/** "GND 275.8 · TWR 251.0", or '' when the Position has none. */
export function formatFrequencies(frequencies) {
  return (frequencies || []).map(formatFrequency).join(' · ');
}

/** True when a DEPARTURE of the Facility is in RUNWAY_QUEUE or LUAW (the EFSP's "LUAW in use"). */
export function luawInUse(strips, facilityId) {
  return (strips || []).some(s => s.stripType === 'DEPARTURE' && LUAW_STATES.includes(s.state) && (!facilityId || !s.facilityId || s.facilityId === facilityId));
}

/**
 * The combination this controller holds at a Facility, or null: LC with GC and/or CD, from the Positions the controller
 * acts at and what each says it is combined with.
 * @param {object[]} positions the Facility's Position entries ({positionId, frequencies, combinedWith})
 * @param {string[]} acting the Positions this controller holds
 * @returns {{positions:string[], with:string[], frequencies:object[]}|null} frequencies tagged with positionId
 */
export function combinationOf(positions, acting) {
  const byId = new Map((positions || []).map(p => [p.positionId, p]));
  const lc = byId.get(LOCAL_POSITION);
  if (!lc || !acting.includes(LOCAL_POSITION)) return null;
  const withIds = NON_LOCAL_TOWER.filter(id => acting.includes(id) && (lc.combinedWith || []).includes(id));
  if (withIds.length === 0) return null;
  const ids = [LOCAL_POSITION, ...withIds];
  const frequencies = [];
  for (const id of ids) for (const f of (byId.get(id) || {}).frequencies || []) frequencies.push({ positionId: id, ...f });
  return { positions: ids, with: withIds, frequencies };
}

/** The persistent line: what is combined, which frequencies to monitor, and the stronger wording while LUAW is in use. */
export function combinationLine(combo, luaw) {
  if (!combo) return null;
  const names = combo.positions.join(' + ');
  const freqs = combo.frequencies.length ? ` Monitor ${combo.frequencies.map(f => `${f.positionId} ${formatFrequency(f)}`).join(' and ')}.` : ' Monitor both frequencies.';
  const text = luaw
    ? `COMBINED ${names}. LUAW in use: LC must not be combined with a non-local position (JO 7210.3 ¶2-6-5c).${freqs}`
    : `COMBINED ${names}: only at significantly reduced traffic (JO 7210.3 ¶2-6-5b).${freqs}`;
  return { text, severe: !!luaw };
}

/** The offer to LC's Primary when GC is left with Strips: "GC is unstaffed with N Strips. Take GC as well?". */
export function offerText(offer) {
  const n = offer.count;
  return `${offer.offer} is unstaffed with ${n} Strip${n === 1 ? '' : 's'}. Take ${offer.offer} as well?`;
}

/** Whether an offer still stands: the offered Position is still empty and the offered controller does not hold it yet. */
export function offerStands(offer, positions, acting) {
  if (!offer || acting.includes(offer.offer)) return false;
  const p = (positions || []).find(x => x.positionId === offer.offer);
  return !!p && !p.primary;
}

/** The mutation-ack warning that goes with a Strip put into LUAW by a controller who is also GC or CD. */
export const LUAW_WHILE_COMBINED_TEXT = 'LUAW while LC is combined with GC/CD: not permitted at a LUAW tower (JO 7210.3 ¶2-6-5c, ¶10-3-8a4). Allowed here; consider splitting the positions.';
