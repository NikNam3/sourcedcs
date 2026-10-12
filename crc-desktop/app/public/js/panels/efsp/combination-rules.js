'use strict';

// A controller holding LC with GC or CD, and the frequencies of a Position (crc-sync docs/adr/0105, H104). Pure: no DOM,
// no state. The server sends each Position's `frequencies` and `combinedWith` (the other Positions whose Primary is the same
// controller); this turns them into the words the panel shows. Warn, never block. The rules behind it (FAA JO 7210.3
// ¶2-6-5b/c, ¶2-6-12, by analogy) are in ADR 0105 and the usage guide; the screen shows only frequencies and problems (T26).

export const LOCAL_POSITION = 'LC';
// docs/adr/0110: every Incirlik Position but LC and RSU (crc-sync's combination.js NON_LOCAL; a parity test keeps them equal).
// OPS, CD and GC are the tower's non-local functions (¶2-6-5b); AP, SFA and PAR are radar approach (¶2-6-12).
export const NON_LOCAL = ['OPS', 'CD', 'GC', 'AP', 'SFA', 'PAR'];
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
 * The combination this controller holds at a Facility, or null: LC with any non-local Position, from the Positions the controller
 * acts at and what each says it is combined with.
 * @param {object[]} positions the Facility's Position entries ({positionId, frequencies, combinedWith})
 * @param {string[]} acting the Positions this controller holds
 * @returns {{positions:string[], with:string[], frequencies:object[]}|null} frequencies tagged with positionId
 */
export function combinationOf(positions, acting) {
  const byId = new Map((positions || []).map(p => [p.positionId, p]));
  const lc = byId.get(LOCAL_POSITION);
  if (!lc || !acting.includes(LOCAL_POSITION)) return null;
  const withIds = NON_LOCAL.filter(id => acting.includes(id) && (lc.combinedWith || []).includes(id));
  if (withIds.length === 0) return null;
  const ids = [LOCAL_POSITION, ...withIds];
  const frequencies = [];
  for (const id of ids) for (const f of (byId.get(id) || {}).frequencies || []) frequencies.push({ positionId: id, ...f });
  return { positions: ids, with: withIds, frequencies };
}

/**
 * The line while this controller holds a combination: the frequencies to monitor, and nothing else (live test T26, dark
 * cockpit: the JO 7210.3 paragraphs stay in the docs, not on the screen). Stronger while LUAW is in use, which ¶2-6-5c does
 * not allow at a combined LC (a problem, so it is said). `key` names the combination: an acknowledged line comes back when it
 * changes. Null when there is nothing to monitor and no problem.
 */
export function combinationLine(combo, luaw) {
  if (!combo) return null;
  const freqs = combo.frequencies.length ? `Monitor ${combo.frequencies.map(formatFrequency).join(', ')}` : '';
  const key = `${combo.positions.join('+')}|${luaw ? 'LUAW' : ''}`;
  if (luaw) return { text: `LUAW in use while LC is combined.${freqs ? ` ${freqs}` : ''}`, severe: true, key };
  return freqs ? { text: freqs, severe: false, key } : null;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const live = (strips, positionId) => (strips || []).filter(s => s.ownerPositionId === positionId && s.state !== 'DROPPED');

/**
 * The hat rows for this controller (crc-sync docs/adr/0110 §3, §6): one "Take Q as well?" for each entry of a Position's
 * `hatOffers` where `self` is that Position's Primary (an Observer is never offered it), and one "Take it?" for each
 * Position this controller observes that has no Primary and still owns Strips. A row hidden by `hidden` (Position -> the
 * count and runway count it was hidden at) comes back when either grows.
 * @param {object[]} positions every Position entry ({positionId, facilityId, primary, observers, hatOffers})
 * @param {string|null} selfId this session's controllerId (the snapshot's `self`)
 * @param {object[]} strips every Strip ({ownerPositionId, state, stripType, flightDataId})
 * @param {string[]} acting the Positions this controller acts at
 * @param {{hidden?:Map, callsignOf?:Function}} [opts]
 * @returns {{kind:'take'|'observer', facilityId:string, positionId:string, count:number, onRunway:number, severe:boolean, text:string, label:string}[]}
 */
export function hatRows(positions, selfId, strips, acting, { hidden = new Map(), callsignOf = (s) => s.stripId } = {}) {
  if (!selfId) return [];
  const rows = [];
  const grown = (q, count, onRunway) => { const h = hidden.get(q); return !h || count > h.count || onRunway > h.onRunway; };
  const names = (q) => {
    const list = live(strips, q).map(callsignOf).filter(Boolean);
    return list.length ? ` (${list.slice(0, 6).join(', ')}${list.length > 6 ? ', …' : ''})` : '';
  };
  const luaw = luawInUse(strips);
  for (const p of positions || []) {
    if (!p.primary || p.primary.controllerId !== selfId) continue;
    for (const o of p.hatOffers || []) {
      if ((acting || []).includes(o.positionId) || !grown(o.positionId, o.count, o.onRunway)) continue;
      // The combination this would make, if it is one: LC with a non-local Position, either way round.
      const holdsLc = (acting || []).includes(LOCAL_POSITION);
      const nonLocal = o.positionId === LOCAL_POSITION ? (acting || []).filter(id => NON_LOCAL.includes(id))
        : holdsLc && NON_LOCAL.includes(o.positionId) ? [o.positionId] : [];
      const severe = o.onRunway > 0 || (nonLocal.length > 0 && luaw);
      let text = `${o.positionId} is unstaffed with ${plural(o.count, 'Strip')}${o.onRunway ? ` (${o.onRunway} on the runway)` : ''}${names(o.positionId)}. Take ${o.positionId} as well?`;
      if (o.observersFirst) text += ` It has Observers, who are offered Primary first.`;
      rows.push({ kind: 'take', facilityId: p.facilityId, positionId: o.positionId, count: o.count, onRunway: o.onRunway, severe, text, label: `Take ${o.positionId}` });
    }
  }
  for (const p of positions || []) {
    if (p.primary || !(p.observers || []).some(o => o.controllerId === selfId)) continue;
    const owned = live(strips, p.positionId);
    if (owned.length === 0 || !grown(p.positionId, owned.length, 0)) continue;
    rows.push({
      kind: 'observer', facilityId: p.facilityId, positionId: p.positionId, count: owned.length, onRunway: 0, severe: false,
      text: `${p.positionId} has no Primary and ${plural(owned.length, 'Strip')}${names(p.positionId)}. Take ${p.positionId}?`, label: `Take ${p.positionId}`,
    });
  }
  return rows;
}

/** The Positions in `before` and not in `after`, per Facility: what this controller just left. */
export function vacatedBetween(before, after) {
  const out = [];
  for (const [f, ids] of Object.entries(before || {})) for (const id of ids) if (!((after || {})[f] || []).includes(id)) out.push(id);
  return out;
}

/** The mutation-ack warning that goes with a Strip put into LUAW by a controller who is also GC or CD. */
export const LUAW_WHILE_COMBINED_TEXT = 'LUAW while LC is combined with a non-local Position: not permitted at a LUAW tower (JO 7210.3 ¶2-6-5c, ¶10-3-8a4). Allowed here; consider splitting the positions.';
