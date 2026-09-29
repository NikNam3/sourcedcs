'use strict';

// Tokenised sets → AtoDocument: header, task units, missions, and the sets
// each mission carries (docs/adr/0063). No FDR, no Board, no mapping — that
// is ato-mapping.js.
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
// Scoping rule (docs/parallel/research/usmtf-ato.md §1.3): every set belongs
// to the mission opened by the most recent AMSNDAT. A mission ends at the
// next AMSNDAT, TASKUNIT, SVCTASK or TSKCNTRY. The package sets PKGCMD (in
// each member mission) and 9PKGDAT (in the package commander's mission)
// belong to the open mission like any other; they do NOT close it.

const { tokenize } = require('./usmtf-tokenize');
const { makeResolver } = require('./usmtf-time');
const { EXTRACTORS } = require('./ato-sets');

const HEADER_SETS = new Set(['OPER', 'EXER', 'MSGID', 'AKNLDG', 'TIMEFRAM', 'PERIOD', 'PERID']);
const TIMEFRAM_NAMES = ['TIMEFRAM', 'PERIOD', 'PERID'];
const GROUPING_SETS = new Set(['TSKCNTRY', 'SVCTASK', 'TASKUNIT']);
const FREE_TEXT = new Set(['AMPN', 'NARR', 'GENTEXT', 'RMKS']);
// Mission-scoped sets this parser maps.
const MISSION_SETS = new Set(['MSNACFT', 'AMSNLOC', 'GTGTLOC', 'CONTROLA', 'ARINFO', 'REFTSK',
  '5REFUEL', '7CONTROL', '9PKGDAT', 'PKGCMD']);
// Sets this parser recognises but deliberately does not map (ACO, targets
// other than GTGTLOC's times, routes, AIRMOVE — out of this lane's scope).
const KNOWN_UNMAPPED = new Set(['MTGTLOC', 'SHIPTGT', 'ESCDATA', 'RECCEDAT', 'PTRCPLOT', 'AIRMOVE',
  'ASUPTFOR', 'ASUPTBY', 'FACINFOR', 'URMKREF', '6ROUTE', 'REF', 'DECL']);
// The "exactly one location set" every mission should have ([455]).
const LOCATION_SETS = new Set(['GTGTLOC', 'MTGTLOC', 'SHIPTGT', 'ESCDATA', 'RECCEDAT', 'AIRMOVE', 'AMSNLOC']);
// Sets of which a mission holds one; a second one warns and the first wins.
// GTGTLOC is exempt: one per timed target is legal (decision S-L3a).
const SINGLE_PER_MISSION = new Set(['AMSNLOC', 'CONTROLA', 'REFTSK', 'PKGCMD']);

function W(code, severity, line, set, message) {
  return { code, severity, line, set, field: null, message };
}

function newMission(amsndat, set, taskUnit, key) {
  return {
    missionNumber: amsndat.missionNumber,
    missionKey: key,
    line: set.line,
    amsndat,
    taskUnit,
    aircraft: [],
    location: null,
    targets: [],
    control: null,
    arReceiving: [],
    tanker: { reftsk: null, receivers: [] },
    controlledRows: [],
    packageRows: [],
    packageCommand: null,
    remarks: [],
    locationSets: [],
    lines: { AMSNDAT: set.line },
    warnings: [],
    heuristics: [],
  };
}

/**
 * @param {string} text
 * @param {{ referenceUtc?: number, modeOneMax?: '73'|'77' }} [opts]
 * @returns {object} AtoDocument
 */
function parseStructure(text, opts = {}) {
  const tok = tokenize(text);
  const doc = {
    source: 'USMTF',
    fatal: tok.warnings.some((w) => w.severity === 'error'),
    header: { classification: tok.classification, operation: null, msgId: null, acknowledge: null, timeframe: null, remarks: [] },
    missions: [],
    unmappedSets: [],
    warnings: [],
    heuristics: [],
  };
  const heur = new Set();
  const referenceUtc = Number.isFinite(opts.referenceUtc) ? opts.referenceUtc : null;

  // Tokenizer warnings about a particular set follow that set to its mission.
  const tokBySet = new Map();
  for (const w of tok.warnings) {
    if (w.set) {
      if (!tokBySet.has(w.set)) tokBySet.set(w.set, []);
      tokBySet.get(w.set).push(w);
    } else {
      doc.warnings.push(w);
    }
  }
  const claim = (set) => {
    const list = tokBySet.get(set.name);
    if (!list) return [];
    const mine = list.filter((w) => w.line >= set.line && w.line <= set.endLine);
    if (mine.length) tokBySet.set(set.name, list.filter((w) => !mine.includes(w)));
    return mine;
  };

  // Pre-pass: TIMEFRAM first, wherever it sits, so every DTG resolves against it.
  const tfSet = tok.sets.find((s) => TIMEFRAM_NAMES.includes(s.name));
  const baseCtx = { resolve: makeResolver({ referenceUtc }), opts };
  let resolver = baseCtx.resolve;
  if (tfSet) {
    const tf = EXTRACTORS[tfSet.name](tfSet, baseCtx);
    if (tf.value.fromUtc != null || tf.value.toUtc != null) {
      resolver = makeResolver({ fromUtc: tf.value.fromUtc, toUtc: tf.value.toUtc });
    }
  } else if (tok.sets.length) {
    doc.warnings.push(W('NO_TIMEFRAM', 'info', null, null,
      referenceUtc != null
        ? 'The ATO has no TIMEFRAM; dates without a month or year were placed near the reference time given.'
        : 'The ATO has no TIMEFRAM; dates without a month or year cannot be resolved.'));
  }
  const ctx = { resolve: resolver, opts };

  const SKIPPED = { skipped: true };
  let current = null;     // the open mission, SKIPPED, or null
  let taskUnit = null;
  const grouping = { country: null, service: null };
  const seenHeader = new Set();
  const close = () => { current = null; };

  for (const set of tok.sets) {
    const name = set.name;
    const tw = claim(set);
    const extractor = EXTRACTORS[name];

    if (HEADER_SETS.has(name)) {
      doc.warnings.push(...tw);
      const key = TIMEFRAM_NAMES.includes(name) ? 'TIMEFRAM' : (name === 'EXER' ? 'OPER' : name);
      if (seenHeader.has(key)) {
        doc.warnings.push(W('DUPLICATE_SET', 'warning', set.line, name, `A second ${name} was ignored.`));
        continue;
      }
      seenHeader.add(key);
      const r = extractor(set, ctx);
      doc.warnings.push(...r.warnings);
      r.heuristics.forEach((h) => heur.add(h));
      if (key === 'OPER') doc.header.operation = r.value;
      else if (key === 'MSGID') doc.header.msgId = r.value;
      else if (key === 'AKNLDG') doc.header.acknowledge = r.value;
      else doc.header.timeframe = r.value;
      continue;
    }

    if (GROUPING_SETS.has(name)) {
      doc.warnings.push(...tw);
      close();
      const r = extractor(set, ctx);
      if (name === 'TSKCNTRY') { grouping.country = r.value.value; grouping.service = null; taskUnit = null; }
      else if (name === 'SVCTASK') { grouping.service = r.value.value; taskUnit = null; }
      else taskUnit = { ...r.value, country: grouping.country, service: grouping.service, line: set.line };
      continue;
    }

    if (name === 'AMSNDAT') {
      close();
      const r = extractor(set, ctx);
      r.heuristics.forEach((h) => heur.add(h));
      if (!r.value.missionNumber) {
        doc.warnings.push(...tw, ...r.warnings);
        current = SKIPPED;
        continue;
      }
      const same = doc.missions.filter((m) => m.missionNumber === r.value.missionNumber).length;
      const key = same ? `${r.value.missionNumber}~${same + 1}` : r.value.missionNumber;
      current = newMission(r.value, set, taskUnit, key);
      current.warnings.push(...tw, ...r.warnings);
      if (same) {
        current.warnings.push(W('DUPLICATE_MISSION_NUMBER', 'warning', set.line, name,
          `Mission ${r.value.missionNumber} appears more than once; this one is ${key}.`));
      }
      doc.missions.push(current);
      continue;
    }

    const known = MISSION_SETS.has(name) || FREE_TEXT.has(name);
    if (!known) {
      doc.unmappedSets.push({ name, line: set.line });
      const sink = current && !current.skipped ? current.warnings : doc.warnings;
      sink.push(...tw);
      if (KNOWN_UNMAPPED.has(name)) {
        if (current && !current.skipped && LOCATION_SETS.has(name)) current.locationSets.push(name);
      } else {
        sink.push(W('UNKNOWN_SET', 'info', set.line, name, `${name} is not an ATO set this parser knows; it was ignored.`));
      }
      continue;
    }

    if (current && current.skipped) continue; // belongs to a mission that was already refused

    if (FREE_TEXT.has(name)) {
      const r = extractor(set, ctx);
      const remark = { set: name, text: r.value.text, line: set.line };
      if (current) { current.remarks.push(remark); current.warnings.push(...tw); } else { doc.header.remarks.push(remark); doc.warnings.push(...tw); }
      continue;
    }

    if (!current) {
      doc.warnings.push(...tw);
      doc.warnings.push(W('SET_OUTSIDE_MISSION', 'warning', set.line, name,
        `${name} is not inside a mission (no AMSNDAT before it); it was ignored.`));
      continue;
    }

    const m = current;
    if (name !== 'MSNACFT') m.warnings.push(...tw);
    if (SINGLE_PER_MISSION.has(name) && m.lines[name] != null) {
      m.warnings.push(W('DUPLICATE_SET', 'warning', set.line, name,
        `Mission ${m.missionKey} has a second ${name}; the first (line ${m.lines[name]}) was kept.`));
      continue;
    }
    const r = extractor(set, ctx);
    // An MSNACFT's own warnings belong to its flight line only, not to every
    // line of the mission (ato-mapping.js merges the two).
    if (name !== 'MSNACFT') m.warnings.push(...r.warnings);
    r.heuristics.forEach((h) => { heur.add(h); if (!m.heuristics.includes(h)) m.heuristics.push(h); });
    if (m.lines[name] == null) m.lines[name] = set.line;
    else if (!Array.isArray(m.lines[name])) m.lines[name] = [m.lines[name], set.line];
    else m.lines[name].push(set.line);
    if (LOCATION_SETS.has(name)) m.locationSets.push(name);

    switch (name) {
      case 'MSNACFT': m.aircraft.push({ ...r.value, line: set.line, warnings: [...tw, ...r.warnings] }); break;
      case 'AMSNLOC': m.location = { ...r.value, line: set.line }; break;
      case 'GTGTLOC': m.targets.push({ ...r.value, line: set.line }); break;
      case 'CONTROLA': m.control = { ...r.value, line: set.line }; break;
      case 'ARINFO': m.arReceiving.push({ ...r.value, line: set.line }); break;
      case 'REFTSK': m.tanker.reftsk = { ...r.value, line: set.line }; break;
      case '5REFUEL': m.tanker.receivers.push(...r.value.rows); break;
      case '7CONTROL': m.controlledRows.push(...r.value.rows); break;
      case '9PKGDAT': m.packageRows.push(...r.value.rows); break;
      case 'PKGCMD': m.packageCommand = { ...r.value, line: set.line }; break;
      default: break;
    }
  }

  for (const m of doc.missions) {
    if (m.aircraft.length === 0) {
      m.warnings.push(W('MISSING_MSNACFT', 'warning', m.line, 'AMSNDAT',
        `Mission ${m.missionKey} has no MSNACFT, so it has no flight to show.`));
    }
    if (m.locationSets.length === 0) {
      m.warnings.push(W('NO_LOCATION_SET', 'info', m.line, 'AMSNDAT',
        `Mission ${m.missionKey} has none of AMSNLOC/GTGTLOC/MTGTLOC/SHIPTGT/ESCDATA/RECCEDAT/AIRMOVE.`));
    }
    // Warnings in line order, per mission.
    m.warnings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  }
  // Any tokenizer warning not claimed by a set (should not happen) stays visible.
  for (const list of tokBySet.values()) doc.warnings.push(...list);
  doc.warnings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  doc.heuristics = [...heur];
  return doc;
}

module.exports = { parseStructure, MISSION_SETS, KNOWN_UNMAPPED, LOCATION_SETS, SINGLE_PER_MISSION };
