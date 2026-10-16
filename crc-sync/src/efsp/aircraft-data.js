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
// DOC 8643: the rest, each designator and its WTC read from ICAO Doc 8643's own list (doc8643.icao.int, the
// "external/aircrafttypes" data behind the Doc 8643 search, read 2026-10-16 by U-SMALL). A designator ICAO lists with
// a split category (HAWK, "L/M") is left out. Ours to maintain: a type not here gets no wake until a controller types one.
const WAKE_BY_TYPE = Object.freeze({
  // QUOTED (JO 7360.1K Appendix A)
  F16: 'M', K35R: 'H', B763: 'H', C130: 'M', T38: 'L', A10: 'M',
  // DOC 8643: fighters and attack
  F4: 'M', F5: 'M', F14: 'M', F15: 'M', F18H: 'M', F18S: 'M', F22: 'M', F35: 'M', F86: 'M', F117: 'M',
  A4: 'M', HAR: 'M', MG19: 'M', MG21: 'M', MG23: 'M', MG29: 'M', MG31: 'M', SU24: 'M', SU25: 'M', SU27: 'M',
  MIR2: 'M', MRF1: 'M', FC1: 'M', E2: 'M', C2: 'M', S3: 'M', AN26: 'M',
  // DOC 8643: heavies
  C17: 'H', C5M: 'H', B52: 'H', B1: 'H', DC10: 'H', E3TF: 'H', E3CF: 'H', B762: 'H', B742: 'H', A400: 'H',
  IL76: 'H', T160: 'H', TU95: 'H',
  A388: 'J',
  // DOC 8643: helicopters
  H60: 'M', H64: 'M', H47: 'M', MI8: 'M', MI24: 'M', KA50: 'M', UH1: 'L', GAZL: 'L',
  // DOC 8643: trainers, light and unmanned
  MG15: 'L', L39: 'L', C101: 'L', M339: 'L', YK52: 'L', P51: 'L', SPIT: 'L', TEX2: 'L', Q1: 'L', Q9: 'L',
});

// The names an ATO (MSNACFT) or a DD-1801 gives a military type, mapped to its ICAO Doc 8643 designator (S-ARCH-53:
// "F-16C" -> F16). Keyed by the name with spaces, hyphens and slants taken out and upper-cased ("F/A-18C" -> FA18C).
// Every target is a Doc 8643 designator (read as WAKE_BY_TYPE's DOC 8643 rows), and no key is itself a Doc 8643
// designator of another type (F1 is the Mitsubishi F-1 and T6 the Harvard, so neither is a key). A bare "E-3" is the
// TF33 Sentry (E3TF), the USAF's and NATO's; the CFM56 ones are named E-3D/E-3F. Ours to maintain.
const DESIGNATOR_BY_NAME = Object.freeze({
  F16A: 'F16', F16B: 'F16', F16C: 'F16', F16D: 'F16', F16CM: 'F16', F16CM50: 'F16', F16CBLK50: 'F16', F16C50: 'F16',
  F15A: 'F15', F15B: 'F15', F15C: 'F15', F15D: 'F15', F15E: 'F15', F15ESE: 'F15',
  F18: 'F18H', FA18: 'F18H', FA18A: 'F18H', FA18B: 'F18H', FA18C: 'F18H', FA18D: 'F18H', FA18CLOT20: 'F18H', CF18: 'F18H',
  FA18E: 'F18S', FA18F: 'F18S', EA18G: 'F18S',
  F14A: 'F14', F14B: 'F14', F4E: 'F4', F5E: 'F5', F5E3: 'F5', F22A: 'F22', F35A: 'F35', F35B: 'F35', F35C: 'F35',
  F86F: 'F86', F117A: 'F117', A10A: 'A10', A10C: 'A10', A10C2: 'A10', A4E: 'A4', AV8B: 'HAR', AV8BNA: 'HAR',
  MIG15: 'MG15', MIG15BIS: 'MG15', MIG19: 'MG19', MIG19P: 'MG19', MIG21: 'MG21', MIG21BIS: 'MG21', MIG23: 'MG23',
  MIG23MLD: 'MG23', MIG29: 'MG29', MIG29A: 'MG29', MIG29S: 'MG29', MIG29G: 'MG29', MIG31: 'MG31',
  SU24M: 'SU24', SU25T: 'SU25', SU25TM: 'SU25', SU30: 'SU27', SU33: 'SU27',
  SU34: 'SU27', JF17: 'FC1', M2000: 'MIR2', M2000C: 'MIR2', M20005: 'MIR2', MIRAGE2000: 'MIR2', MIRAGE2000C: 'MIR2',
  MIRAGEF1: 'MRF1', E2C: 'E2', E2D: 'E2', C2A: 'C2', S3B: 'S3', S3BTANKER: 'S3',
  KC135: 'K35R', KC135R: 'K35R', KC135MPRS: 'K35R', C130H: 'C130', C130J: 'C130', C17A: 'C17', B52H: 'B52',
  B1B: 'B1', KC10: 'DC10', KC10A: 'DC10', E3: 'E3TF', E3A: 'E3TF', E3G: 'E3TF', E3B: 'E3TF', E3C: 'E3TF', E3D: 'E3CF', E3F: 'E3CF',
  A400M: 'A400', IL76MD: 'IL76', IL78: 'IL76', IL78M: 'IL76', TU95MS: 'TU95', TU142: 'TU95',
  TU160: 'T160', AN26B: 'AN26', KC46: 'B762', KC767: 'B762',
  UH60A: 'H60', UH60L: 'H60', MH60R: 'H60', SH60B: 'H60', AH64A: 'H64', AH64D: 'H64', AH64DBLKII: 'H64', CH47D: 'H47',
  CH47F: 'H47', CH47FBL1: 'H47', MI8MT: 'MI8', MI8MTV2: 'MI8', MI17: 'MI8', MI24P: 'MI24',
  MI24V: 'MI24', MI35: 'MI24', KA503: 'KA50', UH1H: 'UH1', SA342: 'GAZL', SA342L: 'GAZL', SA342M: 'GAZL',
  L39C: 'L39', L39ZA: 'L39', C101CC: 'C101', C101EB: 'C101', MB339: 'M339', MB339A: 'M339', YAK52: 'YK52',
  P51D: 'P51', TF51D: 'P51', T6A: 'TEX2', T6B: 'TEX2', MQ1: 'Q1', RQ1: 'Q1', MQ9: 'Q9', T38A: 'T38', T38C: 'T38',
});

/**
 * An aircraft type as an ATO or a DD-1801 gives it, as the ICAO designator Block 3 takes (S-ARCH-53): a known military
 * name ("F-16C", "F/A-18C", "KC-135R") becomes its Doc 8643 designator, a designator stays as it is ("B738"), and
 * anything else is kept as given (upper-cased) for the controller to correct, never guessed. '' stays ''.
 */
function designatorFor(text) {
  const raw = String(text == null ? '' : text).trim().toUpperCase();
  if (raw === '') return '';
  if (WAKE_BY_TYPE[raw]) return raw;
  const compact = raw.replace(/[\s\-/]/g, '');
  if (DESIGNATOR_BY_NAME[compact]) return DESIGNATOR_BY_NAME[compact];
  if (WAKE_BY_TYPE[compact]) return compact;
  return raw;
}

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
  WAKE_CATEGORIES, WAKE_BY_TYPE, DESIGNATOR_BY_NAME, designatorFor, wakeCategoryForType, isWakeCategory, isDesignatorShape,
  normalizeAircraftType, normalizeWakeCategory, parseAircraftData,
};
