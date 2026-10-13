'use strict';

// Block 3, the aircraft data (live test T7, decisions.md H134 LT-RQ1 c / LT-RQ2 b).
//
// JO 7110.65BB TBL 2-3-3/2-3-4/2-3-5, Block 3: "Number of aircraft if more than one, wake category indicator, type of
// aircraft, and aircraft equipment suffix." The human chose the ICAO wake turbulence categories (L, M, H, J; JO 7360.1K
// ¶2-6, ICAO Doc 8643) over the FAA CWT letters A–I, written in ICAO order after the type: `F16/M`, `2/F16/M`.
// The equipment suffix is derived from the equipment codes (§3.3) and is never typed here.
//
// A controller types Block 3 as one field; parseAircraftData() splits it into count / type / wake. The wake may be
// typed first (`M/F16`): a designator is two to four characters, so a single letter is never a type and the two
// orders cannot be confused (default taken, docs/wip/LT-STRIP-FIELDS.md). Pure, no state.

const WAKE_CATEGORIES = Object.freeze(['L', 'M', 'H', 'J']);
const WAKE_SET = new Set(WAKE_CATEGORIES);

// JO 7360.1K ¶2-6 / ICAO Doc 8643: a type designator is two to four characters, letters and digits, the first a letter
// (F16, K35R, B763, C130). ¶2-3-6: "Use the approved aircraft type designator".
const DESIGNATOR_RE = /^[A-Z][A-Z0-9]{1,3}$/;

const MAX_COUNT = 99; // ICAO Item 9 carries the number in two digits; ours as a bound

// The ICAO wake turbulence category by type designator.
//
// QUOTED: from JO 7360.1K Appendix A (ICAO WTC column), as quoted in docs/parallel/research/live-test-faa.md Q4.
// OURS: the rest, placed by the ICAO Doc 8643 / Doc 4444 rule on maximum certificated take-off mass
// (L: 7,000 kg or less; M: more than 7,000 kg, less than 136,000 kg; H: 136,000 kg or more; J: A388 only) from each
// type's published MTOW. Ours to maintain: a type not here gets no wake until a controller types one.
const WAKE_BY_TYPE = Object.freeze({
  // QUOTED (JO 7360.1K Appendix A)
  F16: 'M', K35R: 'H', B763: 'H', C130: 'M', T38: 'L', A10: 'M',
  // OURS: fighters and attack (all above 7,000 kg MTOW)
  F4: 'M', F5: 'M', F14: 'M', F15: 'M', F15E: 'M', F18: 'M', F18H: 'M', F18S: 'M', F22: 'M', F35: 'M', F86: 'M', F117: 'M',
  A4: 'M', HAR: 'M', MG19: 'M', MG21: 'M', MG23: 'M', MG29: 'M', MG31: 'M', SU24: 'M', SU25: 'M', SU27: 'M',
  SU30: 'M', SU33: 'M', MIR2: 'M', MRF1: 'M', JF17: 'M', E2: 'M', C2: 'M', S3: 'M', AN26: 'M',
  // OURS: heavies (136,000 kg or more)
  C17: 'H', C5: 'H', C5M: 'H', B52: 'H', B1: 'H', DC10: 'H', E3TF: 'H', E3CF: 'H', B762: 'H', B742: 'H', A400: 'H',
  IL76: 'H', IL78: 'H', T160: 'H', T95: 'H',
  A388: 'J',
  // OURS: helicopters
  H60: 'M', H64: 'M', H47: 'M', MI8: 'M', MI24: 'M', KA50: 'M', UH1: 'L', GAZL: 'L',
  // OURS: trainers, light and unmanned (7,000 kg or less)
  MG15: 'L', L39: 'L', T45: 'L', C101: 'L', M339: 'L', YK52: 'L', P51: 'L', SPIT: 'L', TEX2: 'L', Q1: 'L', Q9: 'L',
});

/** The ICAO wake category the table gives this designator, or '' when it has none. */
function wakeCategoryForType(type) {
  const t = String(type == null ? '' : type).trim().toUpperCase();
  return WAKE_BY_TYPE[t] || '';
}

function isWakeCategory(value) {
  return WAKE_SET.has(value);
}

function isDesignatorShape(type) {
  return DESIGNATOR_RE.test(type);
}

const SHAPE_TEXT = 'Block 3 is TYPE/WAKE, e.g. F16/M, or 2/F16/M for two aircraft';
const DESIGNATOR_TEXT = 'a type designator is 2 to 4 letters or digits, starting with a letter (F16, K35R)';
const WAKE_TEXT = 'the wake category is L, M, H or J';

/** A typed aircraft type (3A) checked and normalised: { ok, value } or { ok: false, detail }. '' clears it. */
function normalizeAircraftType(value) {
  const t = String(value == null ? '' : value).trim().toUpperCase();
  if (t === '') return { ok: true, value: '' };
  if (!isDesignatorShape(t)) return { ok: false, detail: `${t} is not an aircraft type designator: ${DESIGNATOR_TEXT}` };
  return { ok: true, value: t };
}

/** A typed wake category (3B) checked and normalised: { ok, value } or { ok: false, detail }. '' clears it. */
function normalizeWakeCategory(value) {
  const w = String(value == null ? '' : value).trim().toUpperCase();
  if (w === '' || isWakeCategory(w)) return { ok: true, value: w };
  return { ok: false, detail: `${w} is not a wake category: ${WAKE_TEXT}` };
}

/**
 * Block 3 as typed → { ok: true, count, type, wake } (wake '' when none was typed) or { ok: false, detail }.
 * Accepts `F16`, `F16/M`, `M/F16`, `2/F16`, `2/F16/M`, `2/M/F16`, any case, spaces around the slants.
 */
function parseAircraftData(text) {
  const raw = String(text == null ? '' : text).trim().toUpperCase();
  if (raw === '') return { ok: false, detail: `Block 3 needs an aircraft type: ${SHAPE_TEXT}` };
  const parts = raw.split('/').map(s => s.trim());
  if (parts.some(p => p === '')) return { ok: false, detail: `${raw}: ${SHAPE_TEXT}` };
  let count = 1;
  if (/^\d+$/.test(parts[0])) {
    count = Number(parts.shift());
    if (!(count >= 1 && count <= MAX_COUNT)) return { ok: false, detail: `the number of aircraft is 1 to ${MAX_COUNT}, not ${count}` };
  }
  if (parts.length === 0) return { ok: false, detail: `Block 3 needs an aircraft type: ${SHAPE_TEXT}` };
  if (parts.length > 2) {
    return { ok: false, detail: `${raw}: ${SHAPE_TEXT} (the equipment suffix comes from the equipment codes)` };
  }
  let type = parts[0];
  let wake = '';
  if (parts.length === 2) {
    // One of the two is the wake: a single letter. The other is the type.
    if (parts[0].length === 1 && parts[1].length > 1) { wake = parts[0]; type = parts[1]; }
    else if (parts[1].length === 1) { wake = parts[1]; }
    else return { ok: false, detail: `${raw}: ${SHAPE_TEXT}` };
    if (!isWakeCategory(wake)) return { ok: false, detail: `${wake} is not a wake category: ${WAKE_TEXT}` };
  }
  if (!isDesignatorShape(type)) return { ok: false, detail: `${type} is not an aircraft type designator: ${DESIGNATOR_TEXT}` };
  return { ok: true, count, type, wake };
}

module.exports = {
  WAKE_CATEGORIES, WAKE_BY_TYPE, wakeCategoryForType, isWakeCategory, isDesignatorShape,
  normalizeAircraftType, normalizeWakeCategory, parseAircraftData,
};
