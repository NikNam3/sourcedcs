'use strict';

// An assigned altitude as a band in feet (docs/adr/0091, docs/adr/0163): its parsing and its one canonical text.
// A single altitude is a zero-width band, a block a closed one, a limit ("<080", ">FL240") a band with one open end
// (`lowFt` or `highFt` null). Pure: no store, no clock; the transition altitude is passed in.

/**
 * An altitude as a strip carries it, in feet. "FL180" / "F180" is a flight
 * level; "A050" and a bare three-or-fewer-digit number are hundreds of feet
 * (the strip convention: "050" is 5,000 ft, "180" is FL180's 18,000 ft); four
 * or more digits are feet. Null when it is not an altitude at all.
 */
function parseAltitudeFt(text) {
  const t = String(text == null ? '' : text).trim().toUpperCase().replace(/\s+/g, '');
  let m = /^F(?:L)?(\d{1,3})$/.exec(t);
  if (m) return Number(m[1]) * 100;
  m = /^A(\d{1,3})$/.exec(t);
  if (m) return Number(m[1]) * 100;
  m = /^(\d{1,5})$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return m[1].length <= 3 ? n * 100 : n;
}

/**
 * A flight level at and above the theater's transition altitude, feet below it,
 * as the canonical block text writes an end. Only the text depends on the
 * transition altitude (docs/wip/TA.md): a stored band is always feet, and
 * parseAltitudeFt() reads "FL100" as 10,000 ft in every theater.
 */
function formatAltitudeEnd(ft, transitionAltFt) {
  return ft >= transitionAltFt && ft % 100 === 0 ? `FL${String(ft / 100).padStart(3, '0')}` : String(ft);
}

/**
 * A block in its one canonical text, `FL220-FL240` / `5000-8000` (docs/adr/0091). `transitionAltFt` is the theater's.
 * A limit (one open end, docs/adr/0163) is `<` or `>` and its altitude: `typedEnd` (the altitude as the controller
 * typed it) below the transition altitude, a flight level at and above it (`<080`, `>FL240`); feet when no text is given.
 */
function formatAltitudeBlock(band, transitionAltFt, typedEnd = null) {
  if (band.lowFt == null || band.highFt == null) {
    const ft = band.lowFt == null ? band.highFt : band.lowFt;
    const end = ft >= transitionAltFt || !typedEnd ? formatAltitudeEnd(ft, transitionAltFt) : typedEnd;
    return `${band.lowFt == null ? '<' : '>'}${end}`;
  }
  return `${formatAltitudeEnd(band.lowFt, transitionAltFt)}-${formatAltitudeEnd(band.highFt, transitionAltFt)}`;
}

/** True when the band is a limit, at or below (`lowFt: null`) or at or above (`highFt: null`) one altitude (docs/adr/0163). */
function isAltitudeLimit(band) {
  return !!band && (band.lowFt == null) !== (band.highFt == null);
}

/** Splits "FL220B240" / "FL220-FL240" / "220TO240" into its two ends in feet, unordered; null when it is not one. */
function splitAltitudeBlock(t) {
  for (let i = 1; i < t.length - 1; i += 1) {
    for (const sep of ['-', 'B', 'TO']) {
      if (!t.startsWith(sep, i)) continue;
      const low = parseAltitudeFt(t.slice(0, i));
      const high = parseAltitudeFt(t.slice(i + sep.length));
      if (low != null && high != null) return { lowFt: low, highFt: high };
    }
  }
  return null;
}

function altitudeKey(text) {
  return String(text == null ? '' : text).trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * An assigned altitude as a band in feet (docs/adr/0091): `{ lowFt, highFt }`.
 * A single altitude is a zero-width band (`lowFt === highFt`). A block is two
 * altitudes joined by `-`, `B` or `TO` ("FL220-FL240", "FL220B240", "220B240",
 * "5000-8000"), low first. A limit (docs/adr/0163) is `<` or `>` before one
 * altitude: `<080` is at or below 8,000 ft (`{ lowFt: null, highFt: 8000 }`),
 * `>FL240` at or above FL240 (`{ lowFt: 24000, highFt: null }`). Null when it is
 * none of these, and for a block whose low end is not below its high end.
 */
function parseAltitude(text) {
  const t = altitudeKey(text);
  const limit = /^([<>])(.+)$/.exec(t);
  if (limit) {
    const ft = parseAltitudeFt(limit[2]);
    if (ft == null) return null;
    return limit[1] === '<' ? { lowFt: null, highFt: ft } : { lowFt: ft, highFt: null };
  }
  const single = parseAltitudeFt(t);
  if (single != null) return { lowFt: single, highFt: single };
  const block = splitAltitudeBlock(t);
  return block && block.lowFt < block.highFt ? block : null;
}

/** True when the text is two readable altitudes in the wrong order (or equal), for a precise refusal. */
function isMisorderedBlock(text) {
  const block = splitAltitudeBlock(altitudeKey(text));
  return !!block && block.lowFt >= block.highFt;
}

/**
 * The band's two ends as numbers, an open end as -Infinity / Infinity (docs/adr/0163), for comparisons only:
 * never store or send the result (JSON writes an infinity as null).
 */
function bandEnds(band) {
  return { low: band.lowFt == null ? -Infinity : band.lowFt, high: band.highFt == null ? Infinity : band.highFt };
}

/**
 * The band an ACTIVE clearance altitude entry stands for: its `block` (a closed block or a limit), else its single
 * `parsed` altitude as a zero-width band; null with neither.
 */
function entryBand(entry) {
  if (!entry) return null;
  if (entry.block) return { lowFt: entry.block.lowFt ?? null, highFt: entry.block.highFt ?? null };
  if (Number.isFinite(entry.parsed)) return { lowFt: entry.parsed, highFt: entry.parsed };
  return null;
}

module.exports = {
  parseAltitudeFt, formatAltitudeEnd, formatAltitudeBlock, isAltitudeLimit, splitAltitudeBlock, altitudeKey,
  parseAltitude, isMisorderedBlock, bandEnds, entryBand,
};
