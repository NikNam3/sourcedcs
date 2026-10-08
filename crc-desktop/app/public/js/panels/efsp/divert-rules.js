'use strict';

// Divert, the pure half (crc-sync docs/adr/0111): who may, on which Strips, and the form's fields. No DOM and no sockets.
// The server is the gate; this decides what to offer and why an item is greyed. DIVERT_POSITIONS and DIVERTABLE_STATES
// mirror crc-sync's AP_CTR_ONLY_OP_KINDS grant and board/ops/divert.js; crc-desktop/tests/efsp-divert-rules.test.mjs holds them.

export const DIVERT_POSITIONS = ['AP', 'CTR'];

/** Per strip type, the states a Divert applies to (crc-sync board/ops/divert.js's DIVERTABLE). */
export const DIVERTABLE_STATES = { OVERFLIGHT: ['INBOUND', 'IN_SECTOR'], ARRIVAL: ['INBOUND'] };

// The clearance fields, in the order of FAA JO 7110.65 ¶4-2-1 (clearance limit, route of flight, altitude data, holding
// instructions, any special information), with ¶4-2-5's "restate all applicable altitude restrictions" beside the altitude.
// Frequency, beacon code, SID/vectors and Mach are not part of an amended clearance here (crc-sync docs/adr/0111 §2).
export const DIVERT_FIELDS = [
  { key: 'destination', label: 'Destination', placeholder: 'airport or ship', required: true },
  { key: 'route', label: 'Route', placeholder: 'as it now stands' },
  { key: 'altitude', label: 'Maintain', placeholder: 'altitude' },
  { key: 'restrictions', label: 'Restrictions', placeholder: 'altitude restrictions' },
  { key: 'holding', label: 'Holding', placeholder: 'holding instructions' },
  { key: 'special', label: 'Special', placeholder: 'special information' },
];

/**
 * What the Strip menu does with Divert for this Strip: null (not offered), or `{ enabled, reason }`.
 * A departure is listed greyed with its reason; an open exchange greys it with the way out.
 */
export function divertOffer(strip) {
  if (!strip || !DIVERT_POSITIONS.includes(strip.ownerPositionId)) return null;
  if (strip.stripType === 'DEPARTURE') {
    return strip.state === 'DROPPED' ? null : { enabled: false, reason: 'a departure does not divert' };
  }
  const states = DIVERTABLE_STATES[strip.stripType];
  if (!states || !states.includes(strip.state)) return null;
  const link = strip.coordination;
  if (link && link.state === 'INITIATED') return { enabled: false, reason: 'answer or cancel the open proposal first' };
  if (link && link.state === 'ACTIVE' && link.primitive === 'HANDOFF' && !link.mintedForCoordination) {
    return { enabled: false, reason: 'the flight is with the receiving Position' };
  }
  const tofi = strip.tofiCoordination;
  if (tofi && (tofi.state === 'INITIATED' || tofi.state === 'ACTIVE')) return { enabled: false, reason: 'resolve the TOFI exchange first' };
  return { enabled: true, reason: '' };
}

/** The Divert op from the form's values, or `{ ok:false, error }`. Blank optional fields are left out (blank means unchanged). */
export function buildDivertOp(values) {
  const op = { kind: 'Divert' };
  for (const f of DIVERT_FIELDS) {
    const v = String((values && values[f.key]) || '').trim();
    if (v === '') {
      if (f.required) return { ok: false, error: `${f.label.toLowerCase()} is needed` };
      continue;
    }
    op[f.key] = v;
  }
  return { ok: true, op };
}

/** The chip the latest divert leaves on a Strip: `{ from, to, title }`, or null. The old destination is shown struck through. */
export function divertChipFor(strip, formatZulu = (ms) => String(ms)) {
  const list = strip && Array.isArray(strip.diverts) ? strip.diverts : [];
  if (list.length === 0) return null;
  const last = list[list.length - 1];
  const lines = [];
  for (const [label, key] of [['route', 'route'], ['maintain', 'altitude'], ['restrictions', 'restrictions'], ['holding', 'holding'], ['special', 'special']]) {
    if (last.to[key]) lines.push(`${label}: ${last.to[key]}`);
  }
  const history = list.map(d => `${formatZulu(d.at)} ${d.by || ''} ${d.from.destination || '-'} to ${d.to.destination}`.replace(/\s+/g, ' ')).join('\n');
  return { from: last.from.destination || '', to: last.to.destination, title: [...lines, history].join('\n') };
}
