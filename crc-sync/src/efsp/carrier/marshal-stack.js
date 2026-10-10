'use strict';

// The marshal stack (guide §9.12, docs/adr/0064).
//
// §9.12: "Case III — one integer drives four displayed fields." The stored
// record holds ONLY authoritative values: which flight (flightDataId) sits at which
// stack index, whether it has pushed, and — Case I only — the squadron-assigned
// altitude. The ramp time (Charlie), the marshal radial and the first fix are
// the SHIP's, not the stack's: carrier-state.js holds them with their sources
// (docs/adr/0113). Angels, marshal DME, push time (the EAT), the push window, the
// marshal radial actually flown and the expected final bearing are DERIVED, every
// time, by deriveEntry(); none of them can be stored (validateStack refuses
// them by name) and none of them has an op that writes it. That is WP7A
// acceptance bullet 2 as a property of the data, not a UI convention — the
// same move as block-map.js's resolveBlockTarget returning null for a
// `system` Block.
//
// Provenance:
//   §9.12 (binding)  — angels = 6 + stackIndex; marshalDme = angels + 15 (the
//                      first fix is 21 DME, overridable, ADR 0113); arrive
//                      ±10 s; minimum 6,000 ft; 1,000 ft separation; Case I
//                      altitudes from 2,000 ft, within 5 NM, not push-timed.
//   decisions H27    — the marshal radial is settable (by the Marshal or PriFly,
//                      carrier-state.js) and defaults to final bearing + 180. (The
//                      guide's text says "the 180 relative to BRC"; the human
//                      chose the final-bearing reciprocal, which differs by
//                      the angled-deck offset. docs/adr/0064 records it.)
//   decisions H28    — no automatic compression: removing an aircraft
//                      leaves a vacancy until the controller closes it up.
//   decisions H29    — one stack in v1, keyed by stackId.
//   [SOURCE-DEFINED] — maxIndex 19 (angels 25, DME 40); Case I angels 2..20;
//                      the 15° radial consistency tolerance; DEFAULT_STACK_ID;
//                      an insertion ripple stops at the first vacancy (a gap
//                      absorbs it, so no pilot above the gap is re-cleared).
//
// Every op is ONE call that returns the WHOLE new stack plus `changed`, the
// flightDataIds whose derived display changed, in stack order — how L17 turns one
// gesture into one delta. Ops never read the Case: the stack is the same
// stack in every Case, and only the derivation reads it, so a Case change
// needs no stack op at all. Nothing here mutates its input or throws on bad
// input; a refusal is { ok:false, reason:'VALIDATION_ERROR'|'NOT_FOUND', detail }.

const { normDeg, reciprocal, angularDiff } = require('./angles');
const { isSequencedCase, isCase } = require('./recovery-case');

// `pushedAtUtc` and `eatUtc` are written once, when the flight commences (MarkPushed), and cleared when it returns to the stack
// (BackToStack): the mission-clock moment it left its fix and the EAT it was working to then. They are FACTS OF A PAST EVENT,
// not derived values: a later ramp-time change or Delta moves a holding flight's EAT, never one that has pushed (docs/adr/0114).
// `deltaMs` is the stack's Delta (CV NATOPS 6.4.9): the delay added to every HOLDING flight's EAT.
const ENTRY_KEYS = Object.freeze(['flightDataId', 'stackIndex', 'status', 'caseIAngels', 'pushedAtUtc', 'eatUtc']);
const STACK_KEYS = Object.freeze(['stackId', 'hullId', 'entries', 'deltaMs']);
const ENTRY_STATUSES = Object.freeze(['HOLDING', 'PUSHED']);
const STACK_DEFAULTS = Object.freeze({ maxIndex: 19 }); // [SOURCE-DEFINED] — L4 briefing Q4
const DEFAULT_STACK_ID = 'MAIN'; // [SOURCE-DEFINED] — decisions H29, one stack in v1

// §9.12 numbers.
const MIN_ANGELS = 6;
const DME_PLUS = 15;
const PUSH_TOLERANCE_MS = 10_000;
// Case I: "from 2,000 ft AGL"; the ceiling of 20 is a sanity bound, [SOURCE-DEFINED].
const CASE_I_MIN_ANGELS = 2;
const CASE_I_MAX_ANGELS = 20;
const RADIAL_TOLERANCE_DEG = 15; // [SOURCE-DEFINED] — L4 briefing Q3

// Keys that are derived and must never ride on a stored entry. Named so the
// refusal can say which one it saw.
const DERIVED_KEYS = Object.freeze([
  'angels', 'marshalDme', 'pushTimeUtc', 'pushWindowUtc', 'marshalRadialDeg',
  'expectedFinalBearingDeg', 'finalBearingDeg', 'caseValue',
]);
const DERIVED_DETAIL = 'angels/DME/push time are derived from the stack index (§9.12) and cannot be set';

const STACK_OP_KINDS = Object.freeze([
  'InsertAt', 'Append', 'Move', 'Remove', 'CloseUp', 'MarkPushed', 'SetCaseIAngels', 'Delta', 'BackToStack',
]);

// CV NATOPS 6.4.9 (p. 6-17): "the number of minutes of delay (even increments but never less than four)".
const DELTA_MIN_MINUTES = 4;
const DELTA_MAX_MINUTES = 60; // [SOURCE-DEFINED] sanity bound; NATOPS sets none

function _fail(detail, reason = 'VALIDATION_ERROR') {
  return { ok: false, reason, detail };
}

function _isObj(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function _maxIndex(opts) {
  const m = _isObj(opts) ? opts.maxIndex : undefined;
  return Number.isInteger(m) && m >= 0 ? m : STACK_DEFAULTS.maxIndex;
}

function _validCaseIAngels(v) {
  return v === null || (Number.isInteger(v) && v >= CASE_I_MIN_ANGELS && v <= CASE_I_MAX_ANGELS);
}

// ── Shape ────────────────────────────────────────────────────────────────────

function emptyStack({ stackId = DEFAULT_STACK_ID, hullId } = {}) {
  return { stackId, hullId: hullId == null ? null : hullId, entries: [], deltaMs: 0 };
}

function _validTime(v) { return v === null || (Number.isFinite(v) && v >= 0); }
function _validDelta(v) { return Number.isFinite(v) && v >= 0 && v % 60_000 === 0; }

/**
 * Strict — for mutations. Refuses any entry key outside ENTRY_KEYS (derived
 * values by name), any stack key outside STACK_KEYS, duplicates, bad indices,
 * and entries out of stackIndex order.
 */
function validateStack(stack, opts = STACK_DEFAULTS) {
  const maxIndex = _maxIndex(opts);
  if (!_isObj(stack)) return _fail('stack must be an object');
  for (const k of Object.keys(stack)) {
    if (!STACK_KEYS.includes(k)) return _fail(`unknown stack key '${k}'`);
  }
  if (typeof stack.stackId !== 'string' || !stack.stackId) return _fail('stackId must be a non-empty string');
  if (stack.hullId != null && typeof stack.hullId !== 'string') return _fail('hullId must be a string or null');
  if (!Array.isArray(stack.entries)) return _fail('entries must be an array');
  if (stack.deltaMs !== undefined && !_validDelta(stack.deltaMs)) return _fail('deltaMs must be a whole number of minutes in ms, 0 or more');
  const seenFlightData = new Set();
  let prev = -1;
  for (const e of stack.entries) {
    if (!_isObj(e)) return _fail('every entry must be an object');
    for (const k of Object.keys(e)) {
      if (DERIVED_KEYS.includes(k)) return _fail(`entry ${e.flightDataId}: '${k}' — ${DERIVED_DETAIL}`);
      if (!ENTRY_KEYS.includes(k)) return _fail(`entry ${e.flightDataId}: unknown key '${k}'`);
    }
    if (typeof e.flightDataId !== 'string' || !e.flightDataId) return _fail('entry flightDataId must be a non-empty string');
    if (seenFlightData.has(e.flightDataId)) return _fail(`flightDataId ${e.flightDataId} appears twice in the stack`);
    seenFlightData.add(e.flightDataId);
    if (!Number.isInteger(e.stackIndex) || e.stackIndex < 0 || e.stackIndex > maxIndex) {
      return _fail(`entry ${e.flightDataId}: stackIndex must be an integer 0..${maxIndex}`);
    }
    if (e.stackIndex <= prev) return _fail(`entries must be in ascending, unique stackIndex order (at ${e.flightDataId})`);
    prev = e.stackIndex;
    if (!ENTRY_STATUSES.includes(e.status)) return _fail(`entry ${e.flightDataId}: status must be one of ${ENTRY_STATUSES.join(', ')}`);
    if (!_validCaseIAngels(e.caseIAngels)) {
      return _fail(`entry ${e.flightDataId}: caseIAngels must be an integer ${CASE_I_MIN_ANGELS}..${CASE_I_MAX_ANGELS} or null`);
    }
    if (e.pushedAtUtc !== undefined && !_validTime(e.pushedAtUtc)) return _fail(`entry ${e.flightDataId}: pushedAtUtc must be epoch ms or null`);
    if (e.eatUtc !== undefined && !_validTime(e.eatUtc)) return _fail(`entry ${e.flightDataId}: eatUtc must be epoch ms or null`);
    if (e.status === 'HOLDING' && (e.pushedAtUtc != null || e.eatUtc != null)) {
      return _fail(`entry ${e.flightDataId}: a holding flight has no push time on record`);
    }
  }
  return { ok: true, stack };
}

/**
 * Lenient — for restore (trap T9). Drops derived and unknown keys, drops
 * entries that cannot be kept (bad flightDataId, duplicate flightDataId, an index clash or
 * out of range), sorts the rest, and reports what it dropped. Never refuses:
 * a restart that comes up with one stray key removed beats one that comes up
 * with an empty carrier.
 */
function normalizeStack(raw, { stackId = DEFAULT_STACK_ID, hullId = null, maxIndex } = {}) {
  const max = _maxIndex({ maxIndex });
  const src = _isObj(raw) ? raw : {};
  const dropped = [];
  const stack = {
    stackId: typeof src.stackId === 'string' && src.stackId ? src.stackId : stackId,
    hullId: typeof src.hullId === 'string' ? src.hullId : hullId,
    entries: [],
    deltaMs: _validDelta(src.deltaMs) ? src.deltaMs : 0,
  };
  const rawEntries = Array.isArray(src.entries) ? src.entries.slice() : [];
  const cleaned = [];
  for (const e of rawEntries) {
    if (!_isObj(e) || typeof e.flightDataId !== 'string' || !e.flightDataId) {
      dropped.push({ flightDataId: _isObj(e) ? e.flightDataId ?? null : null, why: 'no flightDataId' });
      continue;
    }
    if (!Number.isInteger(e.stackIndex) || e.stackIndex < 0 || e.stackIndex > max) {
      dropped.push({ flightDataId: e.flightDataId, why: `stackIndex out of range 0..${max}` });
      continue;
    }
    const status = ENTRY_STATUSES.includes(e.status) ? e.status : 'HOLDING';
    cleaned.push({
      flightDataId: e.flightDataId,
      stackIndex: e.stackIndex,
      status,
      caseIAngels: _validCaseIAngels(e.caseIAngels) ? e.caseIAngels : null,
      pushedAtUtc: status === 'PUSHED' && _validTime(e.pushedAtUtc) ? (e.pushedAtUtc ?? null) : null,
      eatUtc: status === 'PUSHED' && _validTime(e.eatUtc) ? (e.eatUtc ?? null) : null,
    });
  }
  cleaned.sort((a, b) => a.stackIndex - b.stackIndex);
  const seenFlightData = new Set();
  const seenIdx = new Set();
  for (const e of cleaned) {
    if (seenFlightData.has(e.flightDataId)) { dropped.push({ flightDataId: e.flightDataId, why: 'duplicate flightDataId' }); continue; }
    if (seenIdx.has(e.stackIndex)) { dropped.push({ flightDataId: e.flightDataId, why: `stackIndex ${e.stackIndex} already taken` }); continue; }
    seenFlightData.add(e.flightDataId);
    seenIdx.add(e.stackIndex);
    stack.entries.push(e);
  }
  return { ok: true, stack, dropped };
}

// ── Derivation ───────────────────────────────────────────────────────────────

/**
 * The displayed fields of one entry, as a pure function of the entry and the recovery's inputs (carrier-state.js
 * `recoveryInputs`): the Case, the ramp time, the final bearing, the marshal radial in force and where it came from, the
 * first fix, and the two tuned durations. Returns a new, frozen object. The Case is a parameter: nothing stored carries it.
 *
 * Push time is the EAT (docs/adr/0113, CV NATOPS glossary: "the future time at which an aircraft is cleared to depart inbound
 * ... from a preassigned fix"). It is worked BACK from the ramp time: slot N is expected at the ramp N * pushSpacing after
 * the first aircraft (NATOPS 6.4.5, one minute apart), and leaves its fix `fixToRamp` earlier than that.
 *
 * All bearings are degrees TRUE (decisions H15); convert at display with angles.toMagnetic().
 */
function deriveEntry(entry, inputs = {}) {
  const { caseValue, rampTimeUtc = null, finalBearingDeg = null, marshalRadialDeg = null, marshalRadialSource = null,
    firstFixDme = null, fixToRampMs = 0, pushSpacingMs = 60_000, deltaMs = 0 } = _isObj(inputs) ? inputs : {};
  const e = _isObj(entry) ? entry : {};
  const fb = Number.isFinite(finalBearingDeg) ? normDeg(finalBearingDeg) : null;
  const base = {
    flightDataId: e.flightDataId ?? null,
    stackIndex: Number.isInteger(e.stackIndex) ? e.stackIndex : null,
    status: e.status ?? null,
    pushedAtUtc: Number.isFinite(e.pushedAtUtc) ? e.pushedAtUtc : null,
    caseValue: isCase(caseValue) ? caseValue : null,
    expectedFinalBearingDeg: fb, // computed in carrier-state.js, never here
  };

  if (!isSequencedCase(caseValue) || base.stackIndex == null) {
    // Case I (§9.12 rule 3): an altitude-keyed list. No DME ("within 5 NM" —
    // render "≤5 NM"), no push time ("Do not build Case I around push times"),
    // no radial (overhead holding). Angels is the squadron-assigned value, and
    // may be null: the Strip shows "assign altitude".
    return Object.freeze({
      ...base,
      angels: _validCaseIAngels(e.caseIAngels) ? e.caseIAngels : null,
      marshalDme: null,
      firstFixDme: null,
      pushTimeUtc: null,
      rampEtaUtc: null,
      pushWindowUtc: null,
      marshalRadialDeg: null,
      marshalRadialSource: null,
      minimumAltitudeOk: null,
    });
  }

  const angels = MIN_ANGELS + base.stackIndex;
  // Slot 0 holds at the first fix; each slot above it is one mile and 1,000 ft higher (NATOPS 6.4.1.1: angels + 15, with the
  // base altitude 6,000 ft, is 21 DME; the first fix is the Marshal's to change, ADR 0113).
  const marshalDme = Number.isFinite(firstFixDme) ? firstFixDme + base.stackIndex : angels + DME_PLUS;
  // A flight that has commenced keeps the EAT it worked to and the moment it left (docs/adr/0114): a later ramp-time change or
  // Delta never rewrites a push time in the past. A holding flight's EAT follows the ramp time and the stack's Delta.
  const pushed = e.status === 'PUSHED';
  const holdRampEta = Number.isFinite(rampTimeUtc) ? rampTimeUtc + base.stackIndex * pushSpacingMs + (Number.isFinite(deltaMs) ? deltaMs : 0) : null;
  const rampEtaUtc = pushed
    ? (Number.isFinite(e.pushedAtUtc) ? e.pushedAtUtc + fixToRampMs : holdRampEta)
    : holdRampEta;
  const pushTimeUtc = pushed && Number.isFinite(e.eatUtc) ? e.eatUtc : (rampEtaUtc == null ? null : rampEtaUtc - fixToRampMs);
  const pushWindowUtc = pushTimeUtc == null
    ? null
    : Object.freeze([pushTimeUtc - PUSH_TOLERANCE_MS, pushTimeUtc + PUSH_TOLERANCE_MS]);
  const radial = normDeg(marshalRadialDeg);
  return Object.freeze({
    ...base,
    angels,
    marshalDme,
    firstFixDme: Number.isFinite(firstFixDme) ? firstFixDme : DME_PLUS + MIN_ANGELS,
    pushTimeUtc,
    rampEtaUtc,
    pushWindowUtc,
    marshalRadialDeg: radial,
    marshalRadialSource: radial == null ? null : marshalRadialSource,
    minimumAltitudeOk: angels >= MIN_ANGELS,
  });
}

/** Every entry derived, in stackIndex order. A frozen array. */
function deriveStack(stack, inputs = {}) {
  const s = _isObj(stack) ? stack : {};
  const entries = Array.isArray(s.entries) ? s.entries.slice().sort((a, b) => a.stackIndex - b.stackIndex) : [];
  const withDelta = { ...(_isObj(inputs) ? inputs : {}), deltaMs: Number.isFinite(s.deltaMs) ? s.deltaMs : 0 };
  return Object.freeze(entries.map((e) => deriveEntry(e, withDelta)));
}

/**
 * §9.12: "The panel SHOULD validate internal consistency — angels + 15 = DME,
 * and marshal radial roughly reciprocal to final bearing." The derivation can
 * never break the first; this exists to catch the day someone stores a DME
 * again. The second CAN fire: the Marshal controller may set a radial
 * (decisions H27) that is far from the final bearing's reciprocal.
 * @returns {Array<{flightDataId, code, detail}>} empty when consistent
 */
function checkConsistency(derived, { radialToleranceDeg = RADIAL_TOLERANCE_DEG } = {}) {
  const list = Array.isArray(derived) ? derived : [derived];
  const out = [];
  for (const d of list) {
    if (!_isObj(d) || !isSequencedCase(d.caseValue)) continue;
    const fixOffset = Number.isFinite(d.firstFixDme) ? d.firstFixDme - MIN_ANGELS : DME_PLUS; // 15 unless the Marshal moved the first fix
    if (!(Number.isFinite(d.angels) && Number.isFinite(d.marshalDme) && d.angels + fixOffset === d.marshalDme)) {
      out.push({ flightDataId: d.flightDataId, code: 'DME_NOT_ANGELS_PLUS_15', detail: `angels ${d.angels} + ${fixOffset} ≠ DME ${d.marshalDme}` });
    }
    if (!(Number.isFinite(d.angels) && d.angels >= MIN_ANGELS)) {
      out.push({ flightDataId: d.flightDataId, code: 'BELOW_MINIMUM_ALTITUDE', detail: `angels ${d.angels} is below the §9.12 minimum of ${MIN_ANGELS}` });
    }
    const diff = angularDiff(d.marshalRadialDeg, reciprocal(d.expectedFinalBearingDeg));
    if (diff != null && diff > radialToleranceDeg) {
      out.push({
        flightDataId: d.flightDataId,
        code: 'RADIAL_NOT_RECIPROCAL_OF_FINAL_BEARING',
        detail: `marshal radial ${Math.round(d.marshalRadialDeg)} is ${Math.round(diff)}° from the reciprocal of final bearing ${Math.round(d.expectedFinalBearingDeg)}`,
      });
    }
  }
  return out;
}

// ── Operations ───────────────────────────────────────────────────────────────

function _copyEntries(stack) {
  return stack.entries.map((e) => ({ ...e }));
}

function _result(stack, entries, changedSet, extra = {}) {
  const sorted = entries.slice().sort((a, b) => a.stackIndex - b.stackIndex);
  const next = { ...stack, ...extra, entries: sorted };
  // `changed` in stack order; an flightDataId that left the stack keeps its old place.
  const order = new Map(stack.entries.map((e) => [e.flightDataId, e.stackIndex]));
  for (const e of sorted) order.set(e.flightDataId, e.stackIndex);
  const changed = [...changedSet].sort((a, b) => order.get(a) - order.get(b) || (a < b ? -1 : 1));
  return { ok: true, stack: next, changed };
}

function _highest(entries) {
  return entries.reduce((m, e) => Math.max(m, e.stackIndex), -1);
}

function _highestPushed(entries) {
  return entries.reduce((m, e) => (e.status === 'PUSHED' ? Math.max(m, e.stackIndex) : m), -1);
}

/**
 * Place `newEntry` at `index` in `entries` (which must not contain it),
 * rippling occupied slots upward until the first vacancy absorbs the shift.
 * Returns { entries, shifted } or a refusal.
 */
function _placeAt(entries, newEntry, index, maxIndex) {
  if (!Number.isInteger(index)) return _fail('stackIndex must be an integer');
  if (index < 0) return _fail('stackIndex must be ≥ 0');
  const highest = _highest(entries);
  if (index > highest + 1) {
    return _fail(`stackIndex ${index} would leave a gap — the next free slot above the stack is ${highest + 1}`);
  }
  const hp = _highestPushed(entries);
  if (index <= hp) {
    const pushed = entries.find((e) => e.stackIndex === hp);
    return _fail(`cannot place at ${index}: ${pushed.flightDataId} at ${hp} has already pushed, and renumbering it would rewrite a push time in the past`);
  }
  const byIndex = new Map(entries.map((e) => [e.stackIndex, e]));
  // The run of occupied slots starting at `index`; it ends at the first vacancy.
  const run = [];
  for (let i = index; byIndex.has(i); i++) run.push(byIndex.get(i));
  const topAfter = run.length ? run[run.length - 1].stackIndex + 1 : index;
  if (topAfter > maxIndex) {
    const top = run.length ? run[run.length - 1] : null;
    return _fail(top
      ? `the stack is full: ${top.flightDataId} at ${top.stackIndex} would move above the top slot ${maxIndex}`
      : `stackIndex ${index} is above the top slot ${maxIndex}`);
  }
  const shiftedIds = new Set(run.map((e) => e.flightDataId));
  const out = entries.map((e) => (shiftedIds.has(e.flightDataId) ? { ...e, stackIndex: e.stackIndex + 1 } : e));
  out.push({ ...newEntry, stackIndex: index });
  return { ok: true, entries: out, shifted: [...shiftedIds] };
}

function _checkFlightDataId(flightDataId) {
  return typeof flightDataId === 'string' && flightDataId.length > 0;
}

/**
 * Insert a flight at `stackIndex`. Everyone at or above moves up one slot
 * together — altitude, DME and push time as one (§9.12 rule 2) — until a
 * vacancy absorbs the ripple.
 */
function insertAt(stack, { flightDataId, stackIndex, caseIAngels = null } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  if (!_checkFlightDataId(flightDataId)) return _fail('flightDataId must be a non-empty string');
  if (stack.entries.some((e) => e.flightDataId === flightDataId)) return _fail(`${flightDataId} is already in the stack — use Move to re-sequence it`);
  if (!_validCaseIAngels(caseIAngels)) return _fail(`caseIAngels must be an integer ${CASE_I_MIN_ANGELS}..${CASE_I_MAX_ANGELS} or null`);
  const placed = _placeAt(_copyEntries(stack), { flightDataId, status: 'HOLDING', caseIAngels, pushedAtUtc: null, eatUtc: null }, stackIndex, _maxIndex(opts));
  if (!placed.ok) return placed;
  return _result(stack, placed.entries, new Set([flightDataId, ...placed.shifted]));
}

/** Insert at the next free slot above the highest entry. */
function append(stack, { flightDataId, caseIAngels = null } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  return insertAt(stack, { flightDataId, stackIndex: _highest(stack.entries) + 1, caseIAngels }, opts);
}

/**
 * Re-sequence — THE cheap gesture (§9.12 rule 2). Atomically: take the entry
 * out (leaving its slot vacant, decisions H28) and place it at `toIndex`
 * with insertAt's rules and refusals. Moving DOWN renumbers exactly the
 * entries it passes (the vacancy it left absorbs the ripple).
 */
function move(stack, { flightDataId, toIndex } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  const entry = stack.entries.find((e) => e.flightDataId === flightDataId);
  if (!entry) return _fail(`${flightDataId} is not in the stack`, 'NOT_FOUND');
  if (entry.status === 'PUSHED') return _fail(`${flightDataId} has already pushed and cannot be re-sequenced`);
  if (toIndex === entry.stackIndex) return _fail(`${flightDataId} is already at ${toIndex}`);
  const rest = _copyEntries(stack).filter((e) => e.flightDataId !== flightDataId);
  const placed = _placeAt(rest, { ...entry }, toIndex, _maxIndex(opts));
  if (!placed.ok) return placed;
  return _result(stack, placed.entries, new Set([flightDataId, ...placed.shifted]));
}

function _closeUpEntries(entries, gapIndex) {
  const above = entries.filter((e) => e.stackIndex > gapIndex);
  const pushed = above.find((e) => e.status === 'PUSHED');
  if (pushed) {
    return _fail(`cannot close up: ${pushed.flightDataId} at ${pushed.stackIndex} has already pushed, and renumbering it would rewrite a push time in the past`);
  }
  const ids = new Set(above.map((e) => e.flightDataId));
  return {
    ok: true,
    entries: entries.map((e) => (ids.has(e.flightDataId) ? { ...e, stackIndex: e.stackIndex - 1 } : e)),
    shifted: [...ids],
  };
}

/**
 * Take a flight out of the stack (diverted, bingo, dropped, trapped). By
 * default its slot stays VACANT and nobody above moves (decisions H28);
 * `closeUp: true` shifts every entry above the gap down one, in the same op.
 */
function remove(stack, { flightDataId, closeUp = false } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  const entry = stack.entries.find((e) => e.flightDataId === flightDataId);
  if (!entry) return _fail(`${flightDataId} is not in the stack`, 'NOT_FOUND');
  let entries = _copyEntries(stack).filter((e) => e.flightDataId !== flightDataId);
  const changed = new Set([flightDataId]);
  if (closeUp === true) {
    const c = _closeUpEntries(entries, entry.stackIndex);
    if (!c.ok) return c;
    entries = c.entries;
    for (const id of c.shifted) changed.add(id);
  }
  return _result(stack, entries, changed);
}

/** Explicit "close up the stack" over a vacant slot: everyone above moves down one. */
function closeUp(stack, { fromIndex } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  if (!Number.isInteger(fromIndex) || fromIndex < 0) return _fail('fromIndex must be an integer ≥ 0');
  if (stack.entries.some((e) => e.stackIndex === fromIndex)) return _fail(`slot ${fromIndex} is occupied — there is no gap to close`);
  if (fromIndex > _highest(stack.entries)) return _fail(`slot ${fromIndex} is above the stack — there is nothing to close up`);
  const c = _closeUpEntries(_copyEntries(stack), fromIndex);
  if (!c.ok) return c;
  return _result(stack, c.entries, new Set(c.shifted));
}

/**
 * The flight has commenced. Status only — NOTHING is renumbered (trap T4).
 * Aircraft push bottom-up at their own times; if a push shifted everyone
 * above down a slot, every other push time would jump a minute earlier —
 * D16's drift arriving by a side door.
 */
function markPushed(stack, { flightDataId } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  const entry = stack.entries.find((e) => e.flightDataId === flightDataId);
  if (!entry) return _fail(`${flightDataId} is not in the stack`, 'NOT_FOUND');
  if (entry.status === 'PUSHED') return _fail(`${flightDataId} has already pushed`);
  // The moment it left, and the EAT it was working to (the store reads both from the mission clock and the derivation):
  // kept on the entry so a later ramp-time change or Delta cannot rewrite them (docs/adr/0114).
  const pushedAtUtc = _isObj(opts) && Number.isFinite(opts.nowMs) ? opts.nowMs : null;
  const eatUtc = _isObj(opts) && Number.isFinite(opts.eatUtc) ? opts.eatUtc : null;
  const entries = _copyEntries(stack).map((e) => (e.flightDataId === flightDataId ? { ...e, status: 'PUSHED', pushedAtUtc, eatUtc } : e));
  return _result(stack, entries, new Set([flightDataId]));
}

/**
 * Back to stack (decisions H117; CV NATOPS 6.4.9 item 2 does it for commenced aircraft above 7,000 ft, here it is the Marshal's
 * manual call): a commenced flight returns to marshal at the next free slot at the TOP of the stack, the slot above the highest
 * entry. Nobody else moves. Its push time on record is cleared; the derivation gives it the EAT of its new slot.
 */
function backToStack(stack, { flightDataId } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  const entry = stack.entries.find((e) => e.flightDataId === flightDataId);
  if (!entry) return _fail(`${flightDataId} is not in the stack`, 'NOT_FOUND');
  if (entry.status !== 'PUSHED') return _fail(`${flightDataId} has not commenced, so there is nothing to send back`);
  const rest = _copyEntries(stack).filter((e) => e.flightDataId !== flightDataId);
  const index = _highest(rest) + 1;
  if (index > _maxIndex(opts)) return _fail(`the stack is full: there is no slot above ${_highest(rest)}`);
  rest.push({ ...entry, stackIndex: index, status: 'HOLDING', pushedAtUtc: null, eatUtc: null });
  return _result(stack, rest, new Set([flightDataId]));
}

/**
 * Delta (CV NATOPS 6.4.9, p. 6-17): "the number of minutes of delay (even increments but never less than four)". Moves the EATs
 * of the HOLDING flights by that much and nobody else: the stack's `deltaMs` grows, the derivation adds it to a holding flight's
 * EAT, and a flight that has pushed keeps the EAT on record. Each Delta adds to the last (Delta 4 then Delta 6 is ten minutes).
 * `changed` is the holding flights, TOP of the stack first: NATOPS issues the new EATs "from the latest to the earliest (i.e.,
 * top of the holding pattern to the bottom)" so no two aircraft ever hold the same EAT.
 */
function delta(stack, { minutes } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  if (!Number.isInteger(minutes) || minutes < DELTA_MIN_MINUTES || minutes % 2 !== 0) {
    return _fail(`Delta is an even number of minutes, never less than ${DELTA_MIN_MINUTES} (CV NATOPS 6.4.9)`);
  }
  if (minutes > DELTA_MAX_MINUTES) return _fail(`Delta ${minutes} is more than ${DELTA_MAX_MINUTES} minutes`);
  const holding = stack.entries.filter((e) => e.status === 'HOLDING');
  if (holding.length === 0) return _fail('nobody is holding in the stack, so there is no EAT to move');
  const total = (Number.isFinite(stack.deltaMs) ? stack.deltaMs : 0) + minutes * 60_000;
  const next = { ...stack, deltaMs: total, entries: _copyEntries(stack) };
  const changed = holding.slice().sort((a, b) => b.stackIndex - a.stackIndex).map((e) => e.flightDataId);
  return { ok: true, stack: next, changed };
}

/** Case I only: the squadron-assigned altitude — the one per-entry value a controller types. */
function setCaseIAngels(stack, { flightDataId, caseIAngels } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  const entry = stack.entries.find((e) => e.flightDataId === flightDataId);
  if (!entry) return _fail(`${flightDataId} is not in the stack`, 'NOT_FOUND');
  if (caseIAngels === undefined || !_validCaseIAngels(caseIAngels)) {
    return _fail(`caseIAngels must be an integer ${CASE_I_MIN_ANGELS}..${CASE_I_MAX_ANGELS} (§9.12: from 2,000 ft) or null`);
  }
  const entries = _copyEntries(stack).map((e) => (e.flightDataId === flightDataId ? { ...e, caseIAngels } : e));
  return _result(stack, entries, new Set([flightDataId]));
}

const _DISPATCH = {
  InsertAt: (s, op, o) => insertAt(s, op, o),
  Append: (s, op, o) => append(s, op, o),
  Move: (s, op, o) => move(s, op, o),
  Remove: (s, op, o) => remove(s, op, o),
  CloseUp: (s, op, o) => closeUp(s, op, o),
  MarkPushed: (s, op, o) => markPushed(s, op, o),
  Delta: (s, op, o) => delta(s, op, o),
  BackToStack: (s, op, o) => backToStack(s, op, o),
  SetCaseIAngels: (s, op, o) => setCaseIAngels(s, op, o),
};

/**
 * The dispatcher L17's store calls from apply(). There is no op that names
 * angels, DME or push time — SetAngels / SetDme / SetPushTime and anything
 * else unknown is a VALIDATION_ERROR (WP7A bullet 2, D16).
 */
function applyStackOp(stack, op, opts = STACK_DEFAULTS) {
  if (!_isObj(op) || typeof op.kind !== 'string') return _fail('op must be an object with a string kind');
  const fn = Object.prototype.hasOwnProperty.call(_DISPATCH, op.kind) ? _DISPATCH[op.kind] : null;
  if (!fn) {
    return _fail(`unknown stack op '${op.kind}' — ${DERIVED_DETAIL}; re-sequence with Move`);
  }
  return fn(stack, op, opts);
}

module.exports = {
  ENTRY_KEYS,
  STACK_KEYS,
  ENTRY_STATUSES,
  STACK_DEFAULTS,
  DEFAULT_STACK_ID,
  STACK_OP_KINDS,
  RADIAL_TOLERANCE_DEG,
  CASE_I_MIN_ANGELS,
  CASE_I_MAX_ANGELS,
  emptyStack,
  validateStack,
  normalizeStack,
  deriveEntry,
  deriveStack,
  checkConsistency,
  insertAt,
  append,
  move,
  remove,
  closeUp,
  markPushed,
  backToStack,
  delta,
  DELTA_MIN_MINUTES,
  setCaseIAngels,
  applyStackOp,
};
