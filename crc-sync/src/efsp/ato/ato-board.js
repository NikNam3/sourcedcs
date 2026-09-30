'use strict';

// USMTF ATO → the Board (EFSPImplementationGuide.md §9.8, §9.9 part 2, WP7;
// docs/adr/0071). L3's parser (ato-ingest.js, docs/adr/0063) turns text into
// mission lines; this module decides what each line becomes on TACTICAL's
// Board — a new flight, a Strip bound to a flight already filed, an update of
// a flight an earlier ATO tasked, or nothing — and builds the tasking that
// fdr-store.js's applyAtoTasking() writes onto the flight. It parses nothing
// itself and it never trusts a client's parse: the server re-reads the text on
// import (efsp-ws.js _handleAtoMutation).
//
// SOURCE CAVEAT (EFSPImplementationGuide.md §9.9, required to be carried into code):
// the detailed USMTF set-level breakdown this parser implements comes from a
// DCS community wiki — the 455 vAEW "ATO, ACO & SPINS Guide"
// (https://wiki.455aew.com/books/ato-aco-spins-guide/page/ato) — NOT from the
// official specification. Set names are consistent with real USMTF, but
// anything load-bearing MUST be verified against MIL-STD-6040 [Annex §14.3].
// Everything below that reads an ATO field inherits that caveat, and every
// constant marked [SOURCE-DEFINED] is a SOURCE DCS choice, not doctrine.
//
// Pure apart from executeImport(), which drives the stores it is handed.
// Every time a controller reads comes from the injected mission clock (H11);
// nothing here reads the wall clock.

const crypto = require('crypto');
const { ingestAtoText } = require('./ato-ingest');
const { fitCallsign } = require('./callsign-fit');
const { MAX_INPUT_BYTES } = require('./usmtf-tokenize');
const { isValidCodeFormat, isReserved, isSynthetic } = require('../code-allocator');

// [SOURCE-DEFINED] — where an ATO lands. Guide §9.8: "TAC_C2 works mission
// lines". Tanker lines land here too; `tac-c2-tanker` stays inert (Q-L14-7).
const ATO_IMPORT_ORIGIN = Object.freeze({ facilityId: 'TACTICAL', positionId: 'TAC_C2', bayId: 'tac-c2-tasked', rackId: 'main' });

// [SOURCE-DEFINED] — L3's own input cap, reused so the two never disagree.
const MAX_ATO_TEXT_BYTES = MAX_INPUT_BYTES;

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIONS = new Set(['CREATE', 'BIND', 'UPDATE', 'SKIP']);
const CALLSIGN_RE = /^[A-Z0-9]{1,7}$/;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// The seed-owned FDR paths: filled from the ATO, but a controller may type
// over them (WRITABLE_PATHS), and a re-import then keeps the controller's
// value (§10.2 rule 3). Mirrored by fdr-store.js's ATO_SEED_PATHS.
const SEED_PATH_OF = Object.freeze({
  missionNumber: 'mission.missionNumber',
  packageId: 'mission.packageId',
  controllingAgency: 'mission.controllingAgency',
  vulWindowStartUtc: 'mission.vulWindowStartUtc',
  vulWindowEndUtc: 'mission.vulWindowEndUtc',
  flightSize: 'identity.flightSize',
  aircraftType: 'identity.aircraftType',
  unit: 'identity.unit',
  homeStation: 'identity.homeStation',
});

function sha1(text) { return crypto.createHash('sha1').update(String(text), 'utf8').digest('hex'); }

function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }

function fmtDate(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ── Dates: the ATO's date is the planner's, the mission's date wins (H68) ────
//
// L3 dates every DTG against the ATO's own TIMEFRAM, and that date is the
// real-world date the planner wrote the ATO on (atobrief's `ato_date`), while
// its times of day are in-game. Decision H68: ignore the ATO's date and use the
// mission's, keeping each DTG's day within the ATO and its time of day.
//
// Done as ONE whole-day shift for the whole document, so every time keeps its
// place relative to every other — the second day of a 0600Z–0559Z ATO stays
// the second day. The shift puts the middle of the ATO's period on the
// mission's calendar as near the mission clock's now as whole days allow, so a
// mission flown inside the ATO period sees that period around it whichever
// calendar day of the period it is in.

/** The instant the ATO's period is centred on: TIMEFRAM's middle, else the middle of every time the lines carry, else null. */
function atoAnchorUtc(doc) {
  const tf = doc && doc.header && doc.header.timeframe;
  if (tf && Number.isFinite(tf.fromUtc) && Number.isFinite(tf.toUtc)) return tf.fromUtc + (tf.toUtc - tf.fromUtc) / 2;
  if (tf && Number.isFinite(tf.fromUtc)) return tf.fromUtc;
  const times = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (/Utc$/.test(k) && Number.isFinite(v)) times.push(v);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  for (const l of (doc && doc.missionLines) || []) walk(l);
  if (times.length === 0) return null;
  return Math.min(...times) + (Math.max(...times) - Math.min(...times)) / 2;
}

/**
 * @returns {{ shiftMs:number, warning:object|null }} whole days to add to every ATO time
 */
function atoDateShift(doc, missionNowMs) {
  const anchor = atoAnchorUtc(doc);
  if (anchor === null || !Number.isFinite(missionNowMs)) return { shiftMs: 0, warning: null };
  const days = Math.round((missionNowMs - anchor) / DAY_MS) || 0; // never -0
  const shiftMs = days * DAY_MS;
  if (days === 0) return { shiftMs, warning: null };
  const tf = doc.header && doc.header.timeframe;
  const atoDay = tf && Number.isFinite(tf.fromUtc) ? tf.fromUtc : anchor;
  return {
    shiftMs,
    warning: {
      code: 'ATO_DATE_DIFFERS', severity: 'info', line: null, set: 'TIMEFRAM', field: null,
      message: `ATO dated ${fmtDate(atoDay)}; its times are placed on the mission's calendar from ${fmtDate(atoDay + shiftMs)}. The ATO's date is the planner's; its times of day are in-game.`,
    },
  };
}

/** One ATO time on the mission's calendar. null stays null. */
function redateAtoTime(utc, shiftMs) {
  return Number.isFinite(utc) ? utc + (shiftMs || 0) : (utc == null ? null : utc);
}

/** A deep copy of `value` with every `…Utc` number re-dated. Raw DTGs are left as the ATO wrote them. */
function redateDeep(value, shiftMs) {
  if (Array.isArray(value)) return value.map((v) => redateDeep(v, shiftMs));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = (/Utc$/.test(k) && Number.isFinite(v)) ? redateAtoTime(v, shiftMs) : redateDeep(v, shiftMs);
  }
  return out;
}

// ── Bind candidates: the Mode 3/A first, the callsign as the fallback (H1) ────

/** A Mode 3 the allocator could ever accept: four octal digits, not reserved, not the AI block. */
function isAssignableModeThree(code) {
  return isValidCodeFormat(code) && !isReserved(code) && !isSynthetic(code);
}

function _stripsByFdr(liveStrips) {
  const by = new Map();
  for (const s of liveStrips || []) {
    if (!s || s.state === 'DROPPED') continue;
    if (!by.has(s.fdrId)) by.set(s.fdrId, []);
    by.get(s.fdrId).push(s);
  }
  return by;
}

function _hasLiveMissionOnTactical(strips) {
  return (strips || []).some((s) => s.role === 'MISSION' && s.facilityId === ATO_IMPORT_ORIGIN.facilityId && s.state !== 'DROPPED');
}

/**
 * The flights a line could bind to. Looks at every live non-MISSION Strip on
 * every Board (FDRs are shared, docs/adr/0013) and their FDRs; a flight that
 * already has a live MISSION Strip on TACTICAL is excluded (one mission line
 * per flight — board-store would refuse it anyway).
 *
 * @param {object} line an analysed line ({ callsign, modeThree })
 * @param {object[]} fdrs every FDR
 * @param {object[]} liveStrips every live Strip, each stamped with its facilityId
 * @returns {{fdrId,key:'MODE3'|'CALLSIGN',callsign,beaconAssigned,strips:object[]}[]}
 */
function bindCandidatesFor(line, fdrs, liveStrips) {
  const byFdr = _stripsByFdr(liveStrips);
  const eligible = (fdrs || []).filter((f) => {
    const strips = byFdr.get(f.fdrId) || [];
    return strips.some((s) => s.role !== 'MISSION') && !_hasLiveMissionOnTactical(strips);
  });
  const describe = (f, key) => ({
    fdrId: f.fdrId, key, callsign: f.identity.callsign, beaconAssigned: f.identity.beaconAssigned,
    strips: (byFdr.get(f.fdrId) || []).map((s) => ({ stripId: s.stripId, facilityId: s.facilityId, role: s.role, ownerPositionId: s.ownerPositionId })),
  });
  const m3 = line.modeThree;
  if (isAssignableModeThree(m3)) {
    const hits = eligible.filter((f) => f.identity.beaconAssigned === m3);
    if (hits.length) return hits.map((f) => describe(f, 'MODE3'));
  }
  if (!line.callsign) return [];
  return eligible.filter((f) => f.identity.callsign === line.callsign).map((f) => describe(f, 'CALLSIGN'));
}

/** The flight an earlier ATO tasked on this line and that still has a live MISSION Strip on TACTICAL — a re-import's UPDATE target. */
function _existingFdrFor(l3line, fdrs, byFdr) {
  const hits = (fdrs || []).filter((f) => f.ato && (f.ato.lineId === l3line.lineId) && _hasLiveMissionOnTactical(byFdr.get(f.fdrId)));
  if (hits.length === 0) return null;
  return hits.reduce((a, b) => ((b.updatedAt || 0) > (a.updatedAt || 0) ? b : a));
}

function _humanWarnings(ws) {
  return (ws || []).map((w) => ({ code: w.code, severity: w.severity, line: w.line == null ? null : w.line, message: w.message }));
}

// ── The seed and the tasking ─────────────────────────────────────────────────

/** createFdr's seed for a line: L3's fdrSeed, re-dated, with the fitted (or typed) callsign. */
function seedFor(line, callsign) {
  return { ...line.fdrSeed, callsign };
}

/**
 * What fdrStore.applyAtoTasking() writes for one line.
 * @param {object} line an analysed line (re-dated)
 * @param {{mode:'CREATE'|'BIND'|'UPDATE', atoRef:object, links:object[]}} opts
 */
function atoTaskingFor(line, { mode, atoRef, links }) {
  const l3 = line.l3;
  const ato = { ...l3.extras.ato };
  delete ato.callsign; delete ato.seedable;
  const seed = {};
  for (const [k, path] of Object.entries(SEED_PATH_OF)) seed[path] = l3.fdrSeed[k] === undefined ? null : l3.fdrSeed[k];
  const arInfo = l3.military.arInfo || (links && links.length ? { asReceiver: [], asTanker: null } : null);
  return {
    mode,
    identity: { modeOne: l3.extras.identityAto.modeOne || null, modeTwo: l3.extras.identityAto.modeTwo || null },
    modeThree: l3.extras.identityAto.modeThree || null,
    military: {
      scl: l3.military.scl || null,
      arInfo: arInfo ? { ...arInfo, links: links || [] } : null,
      alertStatus: l3.military.alertStatus === 'ALERT' ? 'ALERT' : 'NONE',
    },
    seed,
    ato: {
      ...ato,
      lineId: l3.lineId,
      callsignRaw: l3.extras.ato.callsignRaw,
      atoRef,
      iff: { modeThree: l3.extras.identityAto.modeThree || null },
      datalink: l3.extras.identityAto.datalink || null,
      warnings: line.warnings.map((w) => ({ code: w.code, message: w.message })),
    },
  };
}

// ── The preview ──────────────────────────────────────────────────────────────

const CHANGE_PATHS = [
  ...Object.values(SEED_PATH_OF),
  'identity.modeOne', 'identity.modeTwo', 'ato.iff.modeThree', 'ato.departure.timeUtc',
];

function _atoValueAt(l3, path) {
  const seedKey = Object.keys(SEED_PATH_OF).find((k) => SEED_PATH_OF[k] === path);
  if (seedKey) return l3.fdrSeed[seedKey] === undefined ? null : l3.fdrSeed[seedKey];
  if (path === 'identity.modeOne') return l3.extras.identityAto.modeOne || null;
  if (path === 'identity.modeTwo') return l3.extras.identityAto.modeTwo || null;
  if (path === 'ato.iff.modeThree') return l3.extras.identityAto.modeThree || null;
  if (path === 'ato.departure.timeUtc') return l3.extras.ato.departure ? l3.extras.ato.departure.timeUtc : null;
  return null;
}

function _changesFor(l3, fdr) {
  const out = [];
  for (const path of CHANGE_PATHS) {
    const from = getPath(fdr, path);
    const to = _atoValueAt(l3, path);
    if ((from == null ? null : from) === (to == null ? null : to)) continue;
    if ((from === '' || from == null) && to == null) continue;
    const prov = fdr.provenance ? fdr.provenance[path] : undefined;
    // The same rule applyAtoTasking() applies: a seed path is the ATO's while
    // its provenance says so (or the flight has nothing there yet); a
    // controller's value, or the filed flight's own, is kept.
    let ownedBy = 'ATO';
    if (SEED_PATH_OF_VALUES.has(path) && prov !== 'ATO' && !(prov === undefined && (from == null || from === ''))) {
      ownedBy = prov === 'CONTROLLER_ENTERED' ? 'CONTROLLER' : 'FLIGHT';
    }
    out.push({ path, from: from == null ? null : from, to, ownedBy });
  }
  return out;
}
const SEED_PATH_OF_VALUES = new Set(Object.values(SEED_PATH_OF));

/**
 * Parses the text and says what an import would do. Never throws, no side effects.
 *
 * @param {{text:string, fdrs:object[], liveStrips:object[], nowUtc:number}} args
 *   liveStrips — every live Strip on every Board, each carrying its facilityId;
 *   nowUtc — the mission clock (H11), used for L3's fallback reference and the date shift (H68)
 * @returns {{ preview:object, lines:Map<string,object>, doc:object, shiftMs:number }}
 */
function analyseAto({ text, fdrs, liveStrips, nowUtc }) {
  const doc = ingestAtoText(text, { referenceUtc: nowUtc });
  const byFdr = _stripsByFdr(liveStrips);
  const fdrById = new Map((fdrs || []).map((f) => [f.fdrId, f]));
  const { shiftMs, warning: dateWarning } = atoDateShift(doc, nowUtc);

  const lines = new Map();
  const previewLines = [];
  for (const raw of doc.missionLines || []) {
    const l3 = redateDeep(raw, shiftMs);
    const own = [];
    const atoCallsign = l3.extras.ato.callsign;
    let callsign = l3.fdrSeed.callsign;
    if (!callsign) {
      const fitted = fitCallsign(atoCallsign);
      if (fitted) {
        callsign = fitted;
        own.push({ code: 'CALLSIGN_SHORTENED', severity: 'info', line: l3.sourceLines ? l3.sourceLines.MSNACFT || null : null,
          message: `Callsign ${atoCallsign} is over 7 characters; it becomes ${fitted} (vowels cut from the back).` });
      }
    }
    const modeThree = l3.extras.identityAto.modeThree || null;
    if (modeThree && !isAssignableModeThree(modeThree)) {
      own.push({ code: 'MODE3_NOT_ADOPTED', severity: 'warning', line: null,
        message: `The ATO's Mode 3 ${modeThree} can never be assigned${isSynthetic(modeThree) ? ' (it is in the 6000–6777 block crc-sync gives AI aircraft)' : ''}; a new flight keeps the code crc-sync mints.` });
    }
    const line = { l3, callsign: callsign || null, modeThree, warnings: [..._humanWarnings(l3.warnings), ...own] };
    const existing = _existingFdrFor(l3, fdrs, byFdr);
    const candidates = existing ? [] : bindCandidatesFor(line, fdrs, liveStrips);
    let action = 'CREATE';
    if (existing) action = 'UPDATE';
    else if (candidates.length === 1 && (candidates[0].key === 'CALLSIGN' || candidates[0].callsign === line.callsign)) action = 'BIND';
    // A squawk match on a flight with ANOTHER callsign is offered, never
    // preselected: it is as likely a code clash as the same flight, and only
    // the controller can tell (ambiguity is an answer, docs/adr/0046).
    for (const cand of candidates) {
      if (cand.key === 'MODE3' && cand.callsign !== line.callsign) {
        line.warnings.push({ code: 'MODE3_HELD_BY_OTHER', severity: 'warning', line: null,
          message: `The ATO's Mode 3 ${modeThree} is already assigned to ${cand.callsign}; bind to it only if that is this flight.` });
      }
    }
    const missing = [...(l3.extras.ato.missingAcceptanceFields || [])].filter((f) => !(f === 'callsign' && callsign));
    line.existingFdrId = existing ? existing.fdrId : null;
    line.bindCandidates = candidates;
    line.defaultAction = action;
    lines.set(l3.lineId, line);
    previewLines.push({
      lineId: l3.lineId,
      missionNumber: l3.extras.ato.missionNumber,
      callsign: line.callsign,
      callsignRaw: l3.extras.ato.callsignRaw,
      atoCallsign,
      seedable: !!line.callsign,
      action,
      bindCandidates: candidates,
      existingFdrId: line.existingFdrId,
      changes: existing ? _changesFor(l3, existing) : [],
      missing,
      warnings: line.warnings,
      summary: {
        packageId: l3.fdrSeed.packageId,
        missionType: l3.extras.ato.missionType,
        aircraftType: l3.fdrSeed.aircraftType,
        flightSize: l3.fdrSeed.flightSize,
        vul: { startUtc: l3.fdrSeed.vulWindowStartUtc, endUtc: l3.fdrSeed.vulWindowEndUtc },
        agency: l3.fdrSeed.controllingAgency,
        iff: { modeOne: l3.extras.identityAto.modeOne, modeTwo: l3.extras.identityAto.modeTwo, modeThree },
      },
    });
  }

  // Flights an earlier ATO tasked that this one does not mention: listed,
  // never dropped (Q55(a), H65's "replaces").
  const inThisAto = new Set(lines.keys());
  const notInThisAto = [];
  for (const f of fdrById.values()) {
    if (!f.ato || inThisAto.has(f.ato.lineId)) continue;
    if (!_hasLiveMissionOnTactical(byFdr.get(f.fdrId))) continue;
    notInThisAto.push({ fdrId: f.fdrId, lineId: f.ato.lineId, missionNumber: f.mission && f.mission.missionNumber, callsign: f.identity.callsign });
  }

  const header = doc.header || {};
  const preview = {
    ok: !!doc.ok,
    textSha1: sha1(text),
    header: { operation: header.operation || null, msgId: header.msgId || null, timeframe: header.timeframe ? redateDeep(header.timeframe, shiftMs) : null },
    lines: previewLines,
    arLinks: redateDeep(doc.arLinks || [], shiftMs),
    packages: doc.packages || [],
    notInThisAto,
    warnings: _humanWarnings([...(dateWarning ? [dateWarning] : []), ...(doc.warnings || [])]),
  };
  return { preview, lines, doc, shiftMs };
}

function previewAto(args) { return analyseAto(args).preview; }

// ── The plan ─────────────────────────────────────────────────────────────────

/**
 * Validates the controller's choices against the server's own re-parse.
 * A line with no choice takes the preview's preselected action.
 *
 * @returns {{ok:true, steps:object[]}|{ok:false, reason, detail}}
 */
function planImport(analysis, choices, { textSha1 } = {}) {
  if (textSha1 !== undefined && textSha1 !== analysis.preview.textSha1) {
    return { ok: false, reason: 'STALE_REV', detail: 'the ATO changed since the preview — preview it again' };
  }
  if (!analysis.preview.ok) return { ok: false, reason: 'VALIDATION_ERROR', detail: 'nothing in this text could be read as an ATO mission line' };
  const byLine = new Map();
  for (const c of Array.isArray(choices) ? choices : []) {
    if (!c || typeof c !== 'object' || typeof c.lineId !== 'string') return { ok: false, reason: 'VALIDATION_ERROR', detail: 'every choice names a lineId' };
    if (!analysis.lines.has(c.lineId)) return { ok: false, reason: 'VALIDATION_ERROR', detail: `${c.lineId} is not a line of this ATO` };
    if (byLine.has(c.lineId)) return { ok: false, reason: 'VALIDATION_ERROR', detail: `${c.lineId} is chosen twice` };
    byLine.set(c.lineId, c);
  }
  const steps = [];
  for (const [lineId, line] of analysis.lines) {
    const c = byLine.get(lineId) || { action: line.defaultAction };
    const action = c.action;
    if (!ACTIONS.has(action)) return { ok: false, reason: 'VALIDATION_ERROR', detail: `${lineId}: unknown action ${JSON.stringify(action)}` };
    if (action === 'SKIP') { steps.push({ lineId, action, line }); continue; }
    if (action === 'UPDATE') {
      if (!line.existingFdrId) return { ok: false, reason: 'VALIDATION_ERROR', detail: `${lineId}: no flight from an earlier ATO to update` };
      steps.push({ lineId, action, line, fdrId: line.existingFdrId });
      continue;
    }
    if (action === 'BIND') {
      const fdrId = c.fdrId !== undefined ? c.fdrId : (line.bindCandidates.length === 1 ? line.bindCandidates[0].fdrId : undefined);
      if (!line.bindCandidates.some((b) => b.fdrId === fdrId)) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `${lineId}: that flight is not one this line can bind to` };
      }
      steps.push({ lineId, action, line, fdrId });
      continue;
    }
    // CREATE
    const typed = c.callsignOverride == null || c.callsignOverride === '' ? null : String(c.callsignOverride).toUpperCase().replace(/\s/g, '');
    const callsign = typed || line.callsign;
    if (!callsign || !CALLSIGN_RE.test(callsign)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${lineId}: type a callsign of 1–7 letters and digits for ${line.l3.extras.ato.callsignRaw || 'this line'}` };
    }
    steps.push({ lineId, action, line, callsign });
  }
  return { ok: true, steps };
}

// ── The AR join ──────────────────────────────────────────────────────────────

/**
 * Per line, the AR links it takes part in, each peer resolved to the flight
 * this import created, bound or updated for that line (or, for a line this
 * import skipped, the flight an earlier ATO tasked on it). The join is data on
 * each flight; it is not MARSA and says nothing about separation (T2).
 */
function arLinksByLine(analysis, fdrIdByLineId, fdrs) {
  const earlier = new Map();
  for (const f of fdrs || []) if (f.ato && f.ato.lineId) earlier.set(f.ato.lineId, f.fdrId);
  const peer = (lineId) => (lineId ? (fdrIdByLineId.get(lineId) || earlier.get(lineId) || null) : null);
  const out = new Map();
  const push = (lineId, link) => {
    if (!lineId) return;
    if (!out.has(lineId)) out.set(lineId, []);
    out.get(lineId).push(link);
  };
  const callsignOf = (lineId, fallback) => {
    const l = lineId ? analysis.lines.get(lineId) : null;
    return (l && l.callsign) || fallback || null;
  };
  for (const a of analysis.preview.arLinks) {
    push(a.tankerLineId, {
      role: 'TANKER', peerFdrId: peer(a.receiverLineId), peerLineId: a.receiverLineId || null,
      peerMissionNumber: a.receiverMissionNumber || null, peerCallsign: callsignOf(a.receiverLineId, a.receiverCallsign),
      arcp: a.arcp || null, windows: a.windows || [],
    });
    push(a.receiverLineId, {
      role: 'RECEIVER', peerFdrId: peer(a.tankerLineId), peerLineId: a.tankerLineId || null,
      peerMissionNumber: a.tankerMissionNumber || null, peerCallsign: callsignOf(a.tankerLineId, a.tankerCallsign),
      arcp: a.arcp || null, windows: a.windows || [],
    });
  }
  return out;
}

// ── Execution ────────────────────────────────────────────────────────────────

/**
 * Applies a plan through the EXISTING Board path: one CreateStrip per CREATE
 * or BIND line (ADR 0054), with a clientMutationId derived per line so a
 * replayed import is idempotent line by line (T6), then one applyAtoTasking()
 * per touched flight. Best effort: a refused line is reported and the others
 * go on (Q-L14-8).
 *
 * @returns {{ results:object[], strips:object[], fdrIds:string[], applied:boolean }}
 */
function executeImport({ analysis, plan, boardStore, fdrStore, clientMutationId, actingPositionId, by, atoRef }) {
  const results = [];
  const strips = [];
  const fdrIdByLineId = new Map();
  const modeByLineId = new Map();
  let applied = false;

  for (const step of plan.steps) {
    if (step.action === 'SKIP') { results.push({ lineId: step.lineId, ok: true, action: 'SKIP' }); continue; }
    if (step.action === 'UPDATE') {
      fdrIdByLineId.set(step.lineId, step.fdrId);
      modeByLineId.set(step.lineId, 'UPDATE');
      results.push({ lineId: step.lineId, ok: true, action: 'UPDATE', fdrId: step.fdrId });
      continue;
    }
    const op = { kind: 'CreateStrip', bayId: ATO_IMPORT_ORIGIN.bayId, rackId: ATO_IMPORT_ORIGIN.rackId, role: 'MISSION' };
    if (step.action === 'BIND') op.fdrId = step.fdrId;
    else op.fdr = seedFor(step.line.l3, step.callsign);
    const r = boardStore.applyMutation({ clientMutationId: `${clientMutationId}#${step.lineId}`, op }, actingPositionId, by);
    if (!r.ok) {
      results.push({ lineId: step.lineId, ok: false, action: step.action, reason: r.reason, detail: r.detail });
      continue;
    }
    applied = true;
    strips.push(r.strip);
    fdrIdByLineId.set(step.lineId, r.fdr.fdrId);
    modeByLineId.set(step.lineId, step.action);
    results.push({ lineId: step.lineId, ok: true, action: step.action, stripId: r.strip.stripId, fdrId: r.fdr.fdrId });
  }

  const links = arLinksByLine(analysis, fdrIdByLineId, fdrStore.getAll());
  const fdrIds = [];
  for (const res of results) {
    if (!res.ok || res.action === 'SKIP') continue;
    const line = analysis.lines.get(res.lineId);
    const fdr = fdrStore.getFdr(res.fdrId);
    // A replayed line answered from board-store's cache already carries this
    // import's tasking; writing it again would be a second rev bump for nothing.
    if (fdr && fdr.ato && fdr.ato.atoRef && fdr.ato.atoRef.importId === atoRef.importId) { fdrIds.push(res.fdrId); continue; }
    const tasking = atoTaskingFor(line, { mode: modeByLineId.get(res.lineId), atoRef, links: links.get(res.lineId) || [] });
    const t = fdrStore.applyAtoTasking(res.fdrId, tasking, { by });
    if (!t.ok) { res.ok = false; res.reason = t.reason; res.detail = t.detail; continue; }
    applied = true;
    fdrIds.push(res.fdrId);
    if (t.kept && t.kept.length) res.kept = t.kept;
    if (t.beacon) res.beacon = t.beacon;
  }
  return { results, strips, fdrIds, applied };
}

module.exports = {
  ATO_IMPORT_ORIGIN, MAX_ATO_TEXT_BYTES, SEED_PATH_OF,
  analyseAto, previewAto, planImport, bindCandidatesFor, atoTaskingFor, arLinksByLine, executeImport,
  atoDateShift, redateAtoTime, redateDeep, isAssignableModeThree, sha1,
};
