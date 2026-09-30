'use strict';

// One pure extractor per USMTF ATO set: tokenised set → plain object +
// warnings (docs/adr/0063). Nothing here knows about missions, FDRs or Blocks.
//
// SOURCE CAVEAT (EFSPImplementationGuide.md §9.9, required to be carried into code):
// the detailed USMTF set-level breakdown this parser implements comes from a
// DCS community wiki — the 455 vAEW "ATO, ACO & SPINS Guide"
// (https://wiki.455aew.com/books/ato-aco-spins-guide/page/ato) — NOT from the
// official specification. Set names are consistent with real USMTF, but
// anything load-bearing MUST be verified against MIL-STD-6040 [Annex §14.3],
// which was not available when this was written (and the Annex itself is not
// in this repository). Every positional guess the parser makes where the wiki's
// field list and its own examples disagree is listed in docs/adr/0063 and is
// [SOURCE-DEFINED], not doctrine.
//
// [PROFILE] — the 11-field MSNACFT shape read below
// (`count/ACTYP:type/callsign/cfg1/cfg2/L16cs/TACAN/JU/M1/M2/M3`) is a SOURCE
// DCS convention defined in docs/parallel/research/usmtf-ato.md §1.5 so that
// atobrief's USMTF export (lane L11) and this parser agree by construction.
// It is not a claim about the standard; any other MSNACFT shape falls back to
// the shape-based IFF walk-back below.
//
// Lookups are descriptor-first, then positional. Every positional fallback
// is recorded in the result's `heuristics` array so the ADR can list where
// the parser guessed.
//
// Pure: requires only usmtf-time.js and ../code-allocator (itself pure).
// Deliberately NOT fdr-store.js — it reads config at require time.

const { isDtgShaped } = require('./usmtf-time');
const { isValidCodeFormat, isReserved, isSynthetic } = require('../code-allocator');

// Duplicates fdr-store.js:67's CALLSIGN_RE (§3.2 rule 1), after upper-casing.
// Not required from there (load-time I/O); the parity test in
// tests/efsp-ato-acceptance.test.mjs proves createFdr refuses what this refuses.
const CALLSIGN_RE = /^[A-Z0-9]{1,7}$/;

// Control agency type code → the kind EFSP shows. Decision H45 leaves the
// real-world vocabulary open (ABM / IC / RADAR are under research), so every
// accepted code lives in this ONE table: adding a type is a one-line change.
// L11 exports `OTR` + the callsign meanwhile. [SOURCE-DEFINED] (455 wiki).
const CONTROL_AGENCY_TYPES = Object.freeze({
  AWAC: 'AWACS',
  CRC: 'CRC',
  OTR: 'OTHER',
});

const AR_SYSTEMS = new Set(['BOM', 'CDT', 'BOOM', 'DROGUE']);
// An A/A TACAN pair (`18-81`) or a channel with its band (`38Y`, atobrief's `39X`).
const TACAN_RE = /^(?:\d{1,3}-\d{1,3}|\d{1,3}[XY])$/;
// A token that LOOKS like an IFF/SIF mode+code: mode digit 1–3, then 2 or 4
// digits. Validity (octal, the right length for the mode) is checked after,
// so a malformed code is reported rather than silently read as datalink.
const IFF_CANDIDATE_RE = /^[1-3]\d{2}(?:\d{2})?$/;

function W(set, code, severity, message, field = null) {
  return { code, severity, line: set ? set.line : null, set: set ? set.name : null, field, message };
}
function withLine(w, line) { return { ...w, line }; }

function val(f) { return f && !f.empty ? f.value : null; }
function at(fields, i) { return fields[i] || null; }
function findKey(fields, ...keys) { return fields.find((f) => f && keys.includes(f.key)) || null; }
function bare(f) { return f && !f.empty && !f.key ? f.value : null; }

/** Upper-case, drop spaces, `-` and `_`. Never abbreviates (defect D11). */
function normaliseCallsign(raw) {
  if (raw == null) return { raw: null, normalised: null, valid: false };
  const normalised = String(raw).toUpperCase().replace(/[\s\-_]/g, '');
  return { raw: String(raw), normalised: normalised || null, valid: CALLSIGN_RE.test(normalised) };
}

function number(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// A frequency slot: `PFREQ:251.0` / bare `251.0` → { freqMhz }, `PDESIG:GREEN`
// / bare `GREEN` → { designator }. Not airspace-config.isValidFrequency: that
// module reads config at require time.
function freqOf(f, set, warnings, fieldNo) {
  if (!f || f.empty) return null;
  const isDesig = f.key && /DESIG$/.test(f.key);
  if (isDesig) return { designator: f.value };
  const looksNumeric = /^[0-9.]+$/.test(f.value);
  if (f.key || looksNumeric) {
    const n = Number(f.value);
    if (!Number.isFinite(n) || f.value === '.') {
      warnings.push(W(set, 'BAD_FREQUENCY', 'warning', `${set.name}: "${f.value}" is not a frequency.`, fieldNo));
      return null;
    }
    return { freqMhz: n };
  }
  return { designator: f.value };
}

function timeOf(ctx, set, raw, warnings, fieldNo) {
  const r = ctx.resolve(raw);
  for (const w of r.warnings) warnings.push(W(set, w.code, w.severity, `${set.name}: ${w.message}`, fieldNo));
  return { utc: r.utc, raw: r.raw };
}

function klb(f) {
  const v = val(f);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Header sets ──────────────────────────────────────────────────────────

function extractOper(set) {
  return { value: { kind: set.name, name: val(at(set.fields, 0)) }, warnings: [], heuristics: [] };
}

function extractMsgId(set) {
  const f = set.fields;
  const warnings = [];
  const formatId = val(at(f, 0));
  if (formatId === 'ATOCONF') {
    warnings.push(W(set, 'ATOCONF_FORMAT', 'warning', 'MSGID says ATOCONF, the pre-2000 ATO format; it was read as a USMTF 2000 ATO.', 1));
  } else if (formatId !== 'ATO') {
    warnings.push(W(set, 'MSGID_NOT_ATO', 'warning', `MSGID says "${formatId || ''}", not ATO; it was read as an ATO anyway.`, 1));
  }
  const value = {
    formatId,
    originator: val(at(f, 1)),
    serial: val(at(f, 2)),
    month: val(at(f, 3)),
    qualifier: val(at(f, 4)),
    qualifierSerial: val(at(f, 5)),
  };
  if (value.qualifier === 'CHG') {
    // Amendment semantics need the Board, which is L14's (briefing trap 17).
    warnings.push(W(set, 'ATO_CHANGE_MESSAGE', 'info', 'This ATO is a change (CHG) to an earlier one; it was read as a complete ATO.', 5));
  }
  return { value, warnings, heuristics: [] };
}

function extractAknldg(set) {
  return { value: { required: val(at(set.fields, 0)), instructions: val(at(set.fields, 1)) }, warnings: [], heuristics: [] };
}

/** TIMEFRAM (and its aliases PERIOD / PERID). Needs no resolver: FROM/TO carry the year. */
function extractTimeframe(set, ctx) {
  const warnings = [];
  const heuristics = [];
  if (set.name !== 'TIMEFRAM') {
    warnings.push(W(set, 'TIMEFRAM_ALIAS', 'info', `${set.name} was read as TIMEFRAM.`));
  }
  const pick = (key, i) => {
    const byKey = findKey(set.fields, key);
    if (byKey) return val(byKey);
    const b = bare(at(set.fields, i));
    if (b) heuristics.push(`TIMEFRAM.${key}_POSITIONAL`);
    return b;
  };
  const fromRaw = pick('FROM', 0); const toRaw = pick('TO', 1); const asOfRaw = pick('ASOF', 2);
  const from = timeOf(ctx, set, fromRaw, warnings, 1);
  const to = timeOf(ctx, set, toRaw, warnings, 2);
  const asOf = timeOf(ctx, set, asOfRaw, warnings, 3);
  return {
    value: { fromUtc: from.utc, toUtc: to.utc, asOfUtc: asOf.utc, fromRaw, toRaw, asOfRaw },
    warnings, heuristics,
  };
}

// ── Tasking hierarchy ────────────────────────────────────────────────────

function extractTaskUnit(set) {
  const loc = at(set.fields, 1);
  return {
    value: {
      unit: val(at(set.fields, 0)),
      location: val(loc),
      locationKind: loc && !loc.empty ? (loc.key || 'NAME') : null,
      comments: val(at(set.fields, 2)),
    },
    warnings: [], heuristics: [],
  };
}

function extractGrouping(set) {
  return { value: { name: set.name, value: val(at(set.fields, 0)) }, warnings: [], heuristics: [] };
}

// ── Mission sets ─────────────────────────────────────────────────────────

/**
 * AMSNDAT. Variant B (12 fields, leading residual indicator; [AFIT], [CO],
 * the 455 wiki's multi-set example) is the recommended reading; variant A
 * (the 455 field list, 9 fields) is the fallback when field 1 is not a single
 * letter. DEPLOC/ARRLOC are always found by key, and the DTG right after
 * each is taken when it is DTG-shaped.
 */
function extractAmsndat(set, ctx) {
  const f = set.fields;
  const warnings = [];
  const heuristics = [];
  const first = val(at(f, 0));
  const variant = first && /^[A-Z]$/.test(first) ? 'B' : 'A';
  const o = variant === 'B' ? 1 : 0;
  if (variant === 'A') {
    heuristics.push('AMSNDAT_VARIANT_A');
    warnings.push(W(set, 'AMSNDAT_VARIANT_A', 'info', 'AMSNDAT has no residual-mission indicator; read with the 9-field layout.'));
  }
  const missionNumber = val(at(f, o + 0));
  if (!missionNumber) {
    warnings.push(W(set, 'MISSING_MISSION_NUMBER', 'error', 'AMSNDAT has no mission number; the mission was skipped.', o + 1));
  }
  const place = (key) => {
    const idx = f.findIndex((x) => x && x.key === key);
    if (idx === -1) return { location: null, timeUtc: null, raw: null };
    const next = at(f, idx + 1);
    const nextRaw = next && !next.key ? val(next) : null;
    const hasTime = nextRaw && isDtgShaped(nextRaw);
    const t = hasTime ? timeOf(ctx, set, nextRaw, warnings, idx + 2) : { utc: null, raw: null };
    return { location: val(f[idx]), timeUtc: t.utc, raw: t.raw };
  };
  const mc = val(at(f, o + 3));
  return {
    value: {
      variant,
      residual: variant === 'B' ? first : null,
      missionNumber,
      amcMissionNumber: val(at(f, o + 1)),
      packageId: val(at(f, o + 2)),
      isPackageCommander: mc === 'MC',
      missionType: { primary: val(at(f, o + 4)), secondary: val(at(f, o + 5)) },
      alertStatusRaw: val(at(f, o + 6)),
      departure: place('DEPLOC'),
      recovery: place('ARRLOC'),
    },
    warnings, heuristics,
  };
}

function isIffCandidate(field) {
  return !!field && !field.empty && (!field.key || field.key.length <= 2) && IFF_CANDIDATE_RE.test(field.value);
}

/**
 * MSNACFT. f1–f5 by position. IFF: the [PROFILE] shape when the set has
 * exactly 11 fields and f9/f10/f11 hold Mode 1/2/3 tokens or `-`; otherwise
 * [SOURCE-DEFINED] walk-back — up to 3 trailing fields that are empty or
 * IFF-shaped. The fields between the configuration codes and the IFF slots are
 * the datalink fields.
 */
function extractMsnacft(set, ctx) {
  const f = set.fields;
  const warnings = [];
  const heuristics = [];
  const opts = ctx.opts || {};

  const countRaw = val(at(f, 0));
  let count = /^\d+$/.test(countRaw || '') ? Number(countRaw) : NaN;
  if (!Number.isInteger(count) || count < 1) {
    warnings.push(W(set, 'BAD_AIRCRAFT_COUNT', 'warning', `MSNACFT: "${countRaw || ''}" is not an aircraft count; 1 was used.`, 1));
    count = 1;
  }
  const typeField = findKey(f, 'ACTYP', 'OTHAC');
  let aircraftType = val(typeField);
  if (!typeField) {
    aircraftType = bare(at(f, 1));
    if (aircraftType) heuristics.push('MSNACFT_TYPE_POSITIONAL');
  }
  const cs = normaliseCallsign(val(at(f, 2)));

  // IFF slots.
  let iffStart;
  let profile = false;
  const modeAt = (i, mode) => {
    const x = at(f, i);
    return x && (x.empty || (isIffCandidate(x) && x.value[0] === String(mode)));
  };
  if (f.length === 11 && modeAt(8, 1) && modeAt(9, 2) && modeAt(10, 3)) {
    profile = true;
    iffStart = 8;
  } else {
    heuristics.push('MSNACFT_IFF_WALKBACK');
    iffStart = f.length;
    while (iffStart > 5 && f.length - iffStart < 3) {
      const x = f[iffStart - 1];
      if (x.empty || isIffCandidate(x)) iffStart--; else break;
    }
  }
  const iff = { modeOne: null, modeTwo: null, modeThree: null };
  const modeKey = { 1: 'modeOne', 2: 'modeTwo', 3: 'modeThree' };
  const seen = new Set();
  for (let i = iffStart; i < f.length; i++) {
    const x = f[i];
    if (!x || x.empty) continue;
    const mode = Number(x.value[0]);
    const code = x.value.slice(1);
    if (seen.has(mode)) {
      warnings.push(W(set, 'IFF_DUPLICATE_MODE', 'warning', `MSNACFT: a second Mode ${mode} code "${x.value}" was ignored.`, i + 1));
      continue;
    }
    seen.add(mode);
    const wantLen = mode === 1 ? 2 : 4;
    if (code.length !== wantLen || !/^[0-7]+$/.test(code)) {
      warnings.push(W(set, 'IFF_MALFORMED', 'warning', `MSNACFT: "${x.value}" is not a valid Mode ${mode} code (${wantLen} octal digits after the mode digit).`, i + 1));
      continue;
    }
    if (mode === 1 && opts.modeOneMax === '73' && Number(code[1]) > 3) {
      // Guide §3.10.3 rule 5: the range is disputed and belongs in facility
      // config, which is not this lane's. A hook only; the value is kept.
      warnings.push(W(set, 'MODE1_OUT_OF_RANGE', 'warning', `MSNACFT: Mode 1 "${code}" is outside 00–73.`, i + 1));
    }
    if (mode === 3) {
      if (isValidCodeFormat(code) && isReserved(code)) {
        warnings.push(W(set, 'MODE3_RESERVED', 'warning', `MSNACFT: Mode 3 "${code}" is a reserved code; kept as the ATO wrote it.`, i + 1));
      } else if (isSynthetic(code)) {
        warnings.push(W(set, 'MODE3_SYNTHETIC', 'warning', `MSNACFT: Mode 3 "${code}" is in the 6000–6777 block crc-sync gives AI transponders; it can never be assigned.`, i + 1));
      }
    }
    iff[modeKey[mode]] = code;
  }

  // Datalink (EFSP guide M5).
  const between = f.slice(5, iffStart).map((x) => val(x));
  let datalink;
  if (profile) {
    datalink = { profile: true, l16Callsign: between[0] ?? null, tacan: between[1] ?? null, ju: between[2] ?? null, code: null, raw: between };
  } else {
    const nonEmpty = between.filter((v) => v != null);
    if (nonEmpty.length > 1) {
      warnings.push(W(set, 'DATALINK_AMBIGUOUS', 'info', `MSNACFT: several datalink fields (${nonEmpty.join(', ')}); the last was taken as the datalink code.`));
    }
    datalink = { profile: false, l16Callsign: null, tacan: null, ju: null, code: nonEmpty.length ? nonEmpty[nonEmpty.length - 1] : null, raw: between };
  }

  return {
    value: {
      count, aircraftType,
      callsignRaw: cs.raw, callsign: cs.normalised, callsignValid: cs.valid,
      config: { primary: val(at(f, 3)), secondary: val(at(f, 4)) },
      datalink, iff,
    },
    warnings, heuristics,
  };
}

/** Altitude in hundreds of feet MSL; also FL260 and a 240-260 block, with a warning. */
function altitudeOf(raw, set, warnings, fieldNo) {
  if (raw == null) return { altitudeFt: null, blockFt: null };
  if (/^\d{1,3}$/.test(raw)) return { altitudeFt: Number(raw) * 100, blockFt: null };
  let m = /^FL(\d{1,3})$/.exec(raw);
  if (m) {
    warnings.push(W(set, 'ALTITUDE_FORM', 'info', `${set.name}: "${raw}" read as ${Number(m[1]) * 100} ft.`, fieldNo));
    return { altitudeFt: Number(m[1]) * 100, blockFt: null };
  }
  m = /^(\d{1,3})-(\d{1,3})$/.exec(raw);
  if (m) {
    warnings.push(W(set, 'ALTITUDE_BLOCK', 'warning', `${set.name}: "${raw}" is an altitude block; no single altitude was taken.`, fieldNo));
    return { altitudeFt: null, blockFt: { low: Number(m[1]) * 100, high: Number(m[2]) * 100 } };
  }
  warnings.push(W(set, 'BAD_ALTITUDE', 'warning', `${set.name}: "${raw}" is not an altitude in hundreds of feet.`, fieldNo));
  return { altitudeFt: null, blockFt: null };
}

function extractAmsnloc(set, ctx) {
  const f = set.fields;
  const warnings = [];
  const start = timeOf(ctx, set, val(at(f, 0)), warnings, 1);
  const stop = timeOf(ctx, set, val(at(f, 1)), warnings, 2);
  if (start.utc != null && stop.utc != null && stop.utc < start.utc) {
    warnings.push(W(set, 'VUL_END_BEFORE_START', 'warning', `AMSNLOC: the window ends (${stop.raw}) before it starts (${start.raw}); both kept as written.`));
  }
  const alt = altitudeOf(val(at(f, 3)), set, warnings, 4);
  return {
    value: {
      start, stop,
      locationName: val(at(f, 2)),
      altitudeFt: alt.altitudeFt, altitudeBlockFt: alt.blockFt,
      priority: val(at(f, 4)),
      location: val(at(f, 5)),
    },
    warnings, heuristics: [],
  };
}

/** GTGTLOC: only TOT/NET/NLT/ID/DMPIS by key (research §1.5); the name is f5 when bare. */
function extractGtgtloc(set, ctx) {
  const f = set.fields;
  const warnings = [];
  const t = (key, no) => { const x = findKey(f, key); return timeOf(ctx, set, val(x), warnings, no); };
  return {
    value: {
      designator: val(at(f, 0)),
      tot: t('TOT', 2), net: t('NET', 3), nlt: t('NLT', 4),
      name: bare(at(f, 4)),
      targetId: val(findKey(f, 'ID')),
      dmpis: val(findKey(f, 'DMPIS', 'DMPI')),
    },
    warnings, heuristics: [],
  };
}

/**
 * CONTROLA. f1 agency type, f2 callsign, f3/f4 primary/secondary (by
 * descriptor, or a bare frequency), f5 report-in point, f6 comments. The RIP
 * is f5 by position (the research note's reading of the 455 example); a
 * `NAME:` elsewhere is the fallback. [COMMUNITY] reading.
 */
function extractControla(set) {
  const f = set.fields;
  const warnings = [];
  const heuristics = [];
  const typeRaw = val(at(f, 0));
  const kind = typeRaw && Object.prototype.hasOwnProperty.call(CONTROL_AGENCY_TYPES, typeRaw) ? CONTROL_AGENCY_TYPES[typeRaw] : null;
  if (!kind) {
    warnings.push(W(set, 'UNKNOWN_AGENCY_TYPE', 'warning', `CONTROLA: agency type "${typeRaw || ''}" is not one of ${Object.keys(CONTROL_AGENCY_TYPES).join('/')}; kept as written.`, 1));
  }
  const cs = normaliseCallsign(val(at(f, 1)));
  const slot = (keys, i) => {
    const k = findKey(f, ...keys);
    if (k) return k;
    const x = at(f, i);
    if (x && !x.key && !x.empty) { heuristics.push(`CONTROLA.F${i + 1}_BARE`); return x; }
    return null;
  };
  const primary = freqOf(slot(['PFREQ', 'PDESIG'], 2), set, warnings, 3);
  const secondary = freqOf(slot(['SFREQ', 'SDESIG'], 3), set, warnings, 4);
  let reportInPoint = val(at(f, 4));
  if (!reportInPoint) reportInPoint = val(findKey(f, 'NAME'));
  const comments = f.slice(5).map(val).filter((v) => v != null).join(' ') || null;
  return {
    value: {
      typeRaw, type: kind, callsignRaw: cs.raw, callsign: cs.normalised,
      primary, secondary, reportInPoint, comments,
    },
    warnings, heuristics,
  };
}

function tacanOf(fields) {
  const x = fields.find((y) => y && !y.empty && !y.key && TACAN_RE.test(y.value));
  return x ? x.value : null;
}

/**
 * ARINFO, in the receiver's mission. By descriptor: NAME, ARCT, NDAR, KLBS,
 * PFREQ/PDESIG, SFREQ/SDESIG, ACTYP. By position: 1 callsign, 2 tanker
 * mission number, 3 tanker IFF (descriptor allowed; Mode 3 only), 5 altitude.
 * The 455 list and its example are off by one from position 11 on
 * ([SOURCE-DEFINED]); everything else is ignored.
 */
function extractArinfo(set, ctx) {
  const f = set.fields;
  const warnings = [];
  const cs = normaliseCallsign(val(at(f, 0)));
  const iffF = at(f, 2);
  let tankerModeThree = null;
  if (iffF && !iffF.empty) {
    if (isIffCandidate(iffF) && iffF.value[0] === '3' && iffF.value.length === 5 && /^[0-7]{4}$/.test(iffF.value.slice(1))) {
      tankerModeThree = iffF.value.slice(1);
    } else {
      warnings.push(W(set, 'IFF_MALFORMED', 'warning', `ARINFO: tanker IFF "${iffF.value}" is not a Mode 3 code.`, 3));
    }
  }
  const alt = altitudeOf(bare(at(f, 4)), set, warnings, 5);
  const arct = timeOf(ctx, set, val(findKey(f, 'ARCT')), warnings, null);
  const endAr = timeOf(ctx, set, val(findKey(f, 'NDAR')), warnings, null);
  const sys = f.find((x) => x && !x.key && !x.empty && AR_SYSTEMS.has(x.value));
  return {
    value: {
      tankerCallsignRaw: cs.raw, tankerCallsign: cs.normalised,
      tankerMissionNumber: bare(at(f, 1)),
      tankerModeThree,
      arcp: val(findKey(f, 'NAME')),
      altitudeFt: alt.altitudeFt,
      arctUtc: arct.utc, arctRaw: arct.raw,
      endArUtc: endAr.utc, endArRaw: endAr.raw,
      offloadKlb: klb(findKey(f, 'KLBS')),
      primary: freqOf(findKey(f, 'PFREQ', 'PDESIG'), set, warnings, null),
      secondary: freqOf(findKey(f, 'SFREQ', 'SDESIG'), set, warnings, null),
      tankerType: val(findKey(f, 'ACTYP', 'OTHAC')),
      system: sys ? sys.value : null,
      tacan: tacanOf(f),
    },
    warnings, heuristics: ['ARINFO_POSITIONS_1_2_3_5'],
  };
}

/** REFTSK, in the tanker's mission. The first KLBS is the total, the second the alert offload. */
function extractReftsk(set) {
  const f = set.fields;
  const warnings = [];
  const klbs = f.filter((x) => x && x.key === 'KLBS');
  return {
    value: {
      system: val(at(f, 0)),
      totalOffloadKlb: klb(klbs[0]),
      alertOffloadKlb: klb(klbs[1]),
      primary: freqOf(findKey(f, 'PFREQ', 'PDESIG'), set, warnings, null),
      secondary: freqOf(findKey(f, 'SFREQ', 'SDESIG'), set, warnings, null),
      tacan: tacanOf(f),
    },
    warnings, heuristics: [],
  };
}

// Columnar sets: columns by header name, positional fallback in this order.
function columns(set, names, heuristics) {
  const hdr = set.header;
  const idx = names.map((n, i) => {
    const h = hdr ? hdr.indexOf(n) : -1;
    if (h === -1) { heuristics.push(`${set.name}.${n}_POSITIONAL`); return i; }
    return h;
  });
  return (row) => {
    const o = {};
    names.forEach((n, i) => { o[n] = row.fields[idx[i]] || null; });
    return o;
  };
}
function dedupe(a) { return [...new Set(a)]; }

function extract5Refuel(set, ctx) {
  const warnings = [];
  const heuristics = [];
  const get = columns(set, ['MSNNO', 'RECCS', 'NO', 'ACTYPE', 'OFLD', 'ARCT', 'SEQ', 'TYP', 'ARS'], heuristics);
  const rows = (set.rows || []).map((row) => {
    const c = get(row);
    const rw = [];
    const cs = normaliseCallsign(val(c.RECCS));
    const arct = timeOf(ctx, set, val(c.ARCT), rw, null);
    warnings.push(...rw.map((w) => withLine(w, row.line)));
    const n = Number(val(c.NO));
    return {
      line: row.line,
      receiverMissionNumber: val(c.MSNNO),
      receiverCallsignRaw: cs.raw, receiverCallsign: cs.normalised,
      count: Number.isInteger(n) && n > 0 ? n : null,
      aircraftType: val(c.ACTYPE),
      offloadKlb: klb(c.OFLD),
      arctUtc: arct.utc, arctRaw: arct.raw,
      sequence: val(c.SEQ),
      fuelType: val(c.TYP),
      system: val(c.ARS),
    };
  });
  return { value: { rows }, warnings, heuristics: dedupe(heuristics) };
}

function extract7Control(set, ctx) {
  const warnings = [];
  const heuristics = [];
  const get = columns(set, ['MSNNO', 'ACSIGN', 'NO', 'ACTYPE', 'MSNTY', 'TOSTA', 'RIP'], heuristics);
  const rows = (set.rows || []).map((row) => {
    const c = get(row);
    const rw = [];
    const cs = normaliseCallsign(val(c.ACSIGN));
    const tosta = timeOf(ctx, set, val(c.TOSTA), rw, null);
    warnings.push(...rw.map((w) => withLine(w, row.line)));
    const n = Number(val(c.NO));
    return {
      line: row.line,
      missionNumber: val(c.MSNNO),
      callsignRaw: cs.raw, callsign: cs.normalised,
      count: Number.isInteger(n) && n > 0 ? n : null,
      aircraftType: val(c.ACTYPE),
      missionType: val(c.MSNTY),
      onStationUtc: tosta.utc, onStationRaw: tosta.raw,
      reportInPoint: val(c.RIP),
    };
  });
  return { value: { rows }, warnings, heuristics: dedupe(heuristics) };
}

function extract9Pkgdat(set) {
  const heuristics = [];
  const get = columns(set, ['PKGID', 'UNIT', 'MSNNO', 'PMSN', 'NO', 'ACTYPE', 'ACSIGN'], heuristics);
  const rows = (set.rows || []).map((row) => {
    const c = get(row);
    const cs = normaliseCallsign(val(c.ACSIGN));
    const n = Number(val(c.NO));
    return {
      line: row.line,
      packageId: val(c.PKGID),
      unit: val(c.UNIT),
      missionNumber: val(c.MSNNO),
      primaryMissionType: val(c.PMSN),
      count: Number.isInteger(n) && n > 0 ? n : null,
      aircraftType: val(c.ACTYPE),
      callsignRaw: cs.raw, callsign: cs.normalised,
    };
  });
  return { value: { rows }, warnings: [], heuristics: dedupe(heuristics) };
}

function extractPkgcmd(set) {
  const f = set.fields;
  const cs = normaliseCallsign(val(at(f, 3)));
  return {
    value: {
      packageId: val(at(f, 0)), unit: val(at(f, 1)), missionNumber: val(at(f, 2)),
      callsignRaw: cs.raw, callsign: cs.normalised,
    },
    warnings: [], heuristics: [],
  };
}

function extractFreeText(set) {
  return { value: { set: set.name, text: val(at(set.fields, 0)) }, warnings: [], heuristics: [] };
}

const EXTRACTORS = {
  OPER: extractOper, EXER: extractOper,
  MSGID: extractMsgId, AKNLDG: extractAknldg,
  TIMEFRAM: extractTimeframe, PERIOD: extractTimeframe, PERID: extractTimeframe,
  TSKCNTRY: extractGrouping, SVCTASK: extractGrouping, TASKUNIT: extractTaskUnit,
  AMSNDAT: extractAmsndat, MSNACFT: extractMsnacft, AMSNLOC: extractAmsnloc, GTGTLOC: extractGtgtloc,
  CONTROLA: extractControla, ARINFO: extractArinfo, REFTSK: extractReftsk,
  '5REFUEL': extract5Refuel, '7CONTROL': extract7Control, '9PKGDAT': extract9Pkgdat, PKGCMD: extractPkgcmd,
  AMPN: extractFreeText, NARR: extractFreeText, GENTEXT: extractFreeText, RMKS: extractFreeText,
};

module.exports = {
  EXTRACTORS, CALLSIGN_RE, CONTROL_AGENCY_TYPES, AR_SYSTEMS, TACAN_RE,
  normaliseCallsign,
  extractOper, extractMsgId, extractAknldg, extractTimeframe, extractTaskUnit, extractGrouping,
  extractAmsndat, extractMsnacft, extractAmsnloc, extractGtgtloc, extractControla, extractArinfo,
  extractReftsk, extract5Refuel, extract7Control, extract9Pkgdat, extractPkgcmd, extractFreeText,
};
