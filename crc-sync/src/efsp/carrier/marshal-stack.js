'use strict';

// The marshal stack (guide §9.12, docs/adr/0064).
//
// §9.12: "Case III — one integer drives four displayed fields." The stored
// record holds ONLY authoritative values: which flight (fdrId) sits at which
// stack index, whether it has pushed, the Charlie time, the marshal radial
// the controller set (if any), and — Case I only — the squadron-assigned
// altitude. Angels, marshal DME, push time, the push window, the marshal
// radial actually flown and the expected final bearing are DERIVED, every
// time, by deriveEntry(); none of them can be stored (validateStack refuses
// them by name) and none of them has an op that writes it. That is WP7A
// acceptance bullet 2 as a property of the data, not a UI convention — the
// same move as block-map.js's resolveBlockTarget returning null for a
// `system` Block.
//
// Provenance:
//   §9.12 (binding)  — angels = 6 + stackIndex; marshalDme = angels + 15;
//                      pushTime = charlieTime + stackIndex minutes; arrive
//                      ±10 s; minimum 6,000 ft; 1,000 ft separation; Case I
//                      altitudes from 2,000 ft, within 5 NM, not push-timed.
//   decisions H27    — the marshal radial is settable by the Marshal
//                      controller and defaults to final bearing + 180. (The
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
// fdrIds whose derived display changed, in stack order — how L17 turns one
// gesture into one delta. Ops never read the Case: the stack is the same
// stack in every Case, and only the derivation reads it, so a Case change
// needs no stack op at all. Nothing here mutates its input or throws on bad
// input; a refusal is { ok:false, reason:'VALIDATION_ERROR'|'NOT_FOUND', detail }.

const { normDeg, reciprocal, angularDiff } = require('./angles');
const { isSequencedCase, isCase } = require('./recovery-case');

const ENTRY_KEYS = Object.freeze(['fdrId', 'stackIndex', 'status', 'caseIAngels']);
const STACK_KEYS = Object.freeze(['stackId', 'hullId', 'charlieTimeUtc', 'marshalRadialDeg', 'entries']);
const ENTRY_STATUSES = Object.freeze(['HOLDING', 'PUSHED']);
const STACK_DEFAULTS = Object.freeze({ maxIndex: 19 }); // [SOURCE-DEFINED] — L4 briefing Q4
const DEFAULT_STACK_ID = 'MAIN'; // [SOURCE-DEFINED] — decisions H29, one stack in v1

// §9.12 numbers.
const MIN_ANGELS = 6;
const DME_PLUS = 15;
const PUSH_SPACING_MS = 60_000;
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
  'InsertAt', 'Append', 'Move', 'Remove', 'CloseUp', 'MarkPushed',
  'SetCharlieTime', 'SetCaseIAngels', 'SetMarshalRadial',
]);

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
  return { stackId, hullId: hullId == null ? null : hullId, charlieTimeUtc: null, marshalRadialDeg: null, entries: [] };
}

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
  if (stack.charlieTimeUtc != null && !Number.isFinite(stack.charlieTimeUtc)) {
    return _fail('charlieTimeUtc must be epoch ms (mission Zulu) or null');
  }
  if (stack.marshalRadialDeg != null && (normDeg(stack.marshalRadialDeg) == null || normDeg(stack.marshalRadialDeg) !== stack.marshalRadialDeg)) {
    return _fail('marshalRadialDeg must be a bearing in [0, 360) degrees true, or null');
  }
  if (!Array.isArray(stack.entries)) return _fail('entries must be an array');
  const seenFdr = new Set();
  let prev = -1;
  for (const e of stack.entries) {
    if (!_isObj(e)) return _fail('every entry must be an object');
    for (const k of Object.keys(e)) {
      if (DERIVED_KEYS.includes(k)) return _fail(`entry ${e.fdrId}: '${k}' — ${DERIVED_DETAIL}`);
      if (!ENTRY_KEYS.includes(k)) return _fail(`entry ${e.fdrId}: unknown key '${k}'`);
    }
    if (typeof e.fdrId !== 'string' || !e.fdrId) return _fail('entry fdrId must be a non-empty string');
    if (seenFdr.has(e.fdrId)) return _fail(`fdrId ${e.fdrId} appears twice in the stack`);
    seenFdr.add(e.fdrId);
    if (!Number.isInteger(e.stackIndex) || e.stackIndex < 0 || e.stackIndex > maxIndex) {
      return _fail(`entry ${e.fdrId}: stackIndex must be an integer 0..${maxIndex}`);
    }
    if (e.stackIndex <= prev) return _fail(`entries must be in ascending, unique stackIndex order (at ${e.fdrId})`);
    prev = e.stackIndex;
    if (!ENTRY_STATUSES.includes(e.status)) return _fail(`entry ${e.fdrId}: status must be one of ${ENTRY_STATUSES.join(', ')}`);
    if (!_validCaseIAngels(e.caseIAngels)) {
      return _fail(`entry ${e.fdrId}: caseIAngels must be an integer ${CASE_I_MIN_ANGELS}..${CASE_I_MAX_ANGELS} or null`);
    }
  }
  return { ok: true, stack };
}

/**
 * Lenient — for restore (trap T9). Drops derived and unknown keys, drops
 * entries that cannot be kept (bad fdrId, duplicate fdrId, an index clash or
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
    charlieTimeUtc: Number.isFinite(src.charlieTimeUtc) ? src.charlieTimeUtc : null,
    marshalRadialDeg: normDeg(src.marshalRadialDeg),
    entries: [],
  };
  const rawEntries = Array.isArray(src.entries) ? src.entries.slice() : [];
  const cleaned = [];
  for (const e of rawEntries) {
    if (!_isObj(e) || typeof e.fdrId !== 'string' || !e.fdrId) {
      dropped.push({ fdrId: _isObj(e) ? e.fdrId ?? null : null, why: 'no fdrId' });
      continue;
    }
    if (!Number.isInteger(e.stackIndex) || e.stackIndex < 0 || e.stackIndex > max) {
      dropped.push({ fdrId: e.fdrId, why: `stackIndex out of range 0..${max}` });
      continue;
    }
    cleaned.push({
      fdrId: e.fdrId,
      stackIndex: e.stackIndex,
      status: ENTRY_STATUSES.includes(e.status) ? e.status : 'HOLDING',
      caseIAngels: _validCaseIAngels(e.caseIAngels) ? e.caseIAngels : null,
    });
  }
  cleaned.sort((a, b) => a.stackIndex - b.stackIndex);
  const seenFdr = new Set();
  const seenIdx = new Set();
  for (const e of cleaned) {
    if (seenFdr.has(e.fdrId)) { dropped.push({ fdrId: e.fdrId, why: 'duplicate fdrId' }); continue; }
    if (seenIdx.has(e.stackIndex)) { dropped.push({ fdrId: e.fdrId, why: `stackIndex ${e.stackIndex} already taken` }); continue; }
    seenFdr.add(e.fdrId);
    seenIdx.add(e.stackIndex);
    stack.entries.push(e);
  }
  return { ok: true, stack, dropped };
}

// ── Derivation ───────────────────────────────────────────────────────────────

/**
 * The displayed fields of one entry, as a pure function of the entry, the
 * Case, the stack's Charlie time and radial, and the ship state. Returns a new,
 * frozen object. The Case is a parameter: nothing stored carries it.
 *
 * All bearings are degrees TRUE (decisions H15); convert at display with
 * angles.toMagnetic().
 */
function deriveEntry(entry, { caseValue, charlieTimeUtc = null, marshalRadialDeg = null, shipState = null } = {}) {
  const e = _isObj(entry) ? entry : {};
  const fb = shipState && Number.isFinite(shipState.finalBearingDeg) ? normDeg(shipState.finalBearingDeg) : null;
  const base = {
    fdrId: e.fdrId ?? null,
    stackIndex: Number.isInteger(e.stackIndex) ? e.stackIndex : null,
    status: e.status ?? null,
    caseValue: isCase(caseValue) ? caseValue : null,
    expectedFinalBearingDeg: fb, // computed in ship-state.js, never here
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
      pushTimeUtc: null,
      pushWindowUtc: null,
      marshalRadialDeg: null,
      marshalRadialSource: null,
      minimumAltitudeOk: null,
    });
  }

  const angels = MIN_ANGELS + base.stackIndex;
  const marshalDme = angels + DME_PLUS;
  const pushTimeUtc = Number.isFinite(charlieTimeUtc) ? charlieTimeUtc + base.stackIndex * PUSH_SPACING_MS : null;
  const pushWindowUtc = pushTimeUtc == null
    ? null
    : Object.freeze([pushTimeUtc - PUSH_TOLERANCE_MS, pushTimeUtc + PUSH_TOLERANCE_MS]);
  const setRadial = normDeg(marshalRadialDeg);
  let radial = null;
  let radialSource = null;
  if (setRadial != null) {
    radial = setRadial;
    radialSource = 'SET';
  } else if (fb != null) {
    radial = reciprocal(fb); // decisions H27: default final bearing + 180
    radialSource = 'FINAL_BEARING';
  }
  return Object.freeze({
    ...base,
    angels,
    marshalDme,
    pushTimeUtc,
    pushWindowUtc,
    marshalRadialDeg: radial,
    marshalRadialSource: radialSource,
    minimumAltitudeOk: angels >= MIN_ANGELS,
  });
}

/** Every entry derived, in stackIndex order. A frozen array. */
function deriveStack(stack, { caseValue, shipState = null } = {}) {
  const s = _isObj(stack) ? stack : {};
  const entries = Array.isArray(s.entries) ? s.entries.slice().sort((a, b) => a.stackIndex - b.stackIndex) : [];
  return Object.freeze(entries.map((e) => deriveEntry(e, {
    caseValue,
    charlieTimeUtc: s.charlieTimeUtc,
    marshalRadialDeg: s.marshalRadialDeg,
    shipState,
  })));
}

/**
 * §9.12: "The panel SHOULD validate internal consistency — angels + 15 = DME,
 * and marshal radial roughly reciprocal to final bearing." The derivation can
 * never break the first; this exists to catch the day someone stores a DME
 * again. The second CAN fire: the Marshal controller may set a radial
 * (decisions H27) that is far from the final bearing's reciprocal.
 * @returns {Array<{fdrId, code, detail}>} empty when consistent
 */
function checkConsistency(derived, { radialToleranceDeg = RADIAL_TOLERANCE_DEG } = {}) {
  const list = Array.isArray(derived) ? derived : [derived];
  const out = [];
  for (const d of list) {
    if (!_isObj(d) || !isSequencedCase(d.caseValue)) continue;
    if (!(Number.isFinite(d.angels) && Number.isFinite(d.marshalDme) && d.angels + DME_PLUS === d.marshalDme)) {
      out.push({ fdrId: d.fdrId, code: 'DME_NOT_ANGELS_PLUS_15', detail: `angels ${d.angels} + 15 ≠ DME ${d.marshalDme}` });
    }
    if (!(Number.isFinite(d.angels) && d.angels >= MIN_ANGELS)) {
      out.push({ fdrId: d.fdrId, code: 'BELOW_MINIMUM_ALTITUDE', detail: `angels ${d.angels} is below the §9.12 minimum of ${MIN_ANGELS}` });
    }
    const diff = angularDiff(d.marshalRadialDeg, reciprocal(d.expectedFinalBearingDeg));
    if (diff != null && diff > radialToleranceDeg) {
      out.push({
        fdrId: d.fdrId,
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
  // `changed` in stack order; an fdrId that left the stack keeps its old place.
  const order = new Map(stack.entries.map((e) => [e.fdrId, e.stackIndex]));
  for (const e of sorted) order.set(e.fdrId, e.stackIndex);
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
    return _fail(`cannot place at ${index}: ${pushed.fdrId} at ${hp} has already pushed, and renumbering it would rewrite a push time in the past`);
  }
  const byIndex = new Map(entries.map((e) => [e.stackIndex, e]));
  // The run of occupied slots starting at `index`; it ends at the first vacancy.
  const run = [];
  for (let i = index; byIndex.has(i); i++) run.push(byIndex.get(i));
  const topAfter = run.length ? run[run.length - 1].stackIndex + 1 : index;
  if (topAfter > maxIndex) {
    const top = run.length ? run[run.length - 1] : null;
    return _fail(top
      ? `the stack is full: ${top.fdrId} at ${top.stackIndex} would move above the top slot ${maxIndex}`
      : `stackIndex ${index} is above the top slot ${maxIndex}`);
  }
  const shiftedIds = new Set(run.map((e) => e.fdrId));
  const out = entries.map((e) => (shiftedIds.has(e.fdrId) ? { ...e, stackIndex: e.stackIndex + 1 } : e));
  out.push({ ...newEntry, stackIndex: index });
  return { ok: true, entries: out, shifted: [...shiftedIds] };
}

function _checkFdrId(fdrId) {
  return typeof fdrId === 'string' && fdrId.length > 0;
}

/**
 * Insert a flight at `stackIndex`. Everyone at or above moves up one slot
 * together — altitude, DME and push time as one (§9.12 rule 2) — until a
 * vacancy absorbs the ripple.
 */
function insertAt(stack, { fdrId, stackIndex, caseIAngels = null } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  if (!_checkFdrId(fdrId)) return _fail('fdrId must be a non-empty string');
  if (stack.entries.some((e) => e.fdrId === fdrId)) return _fail(`${fdrId} is already in the stack — use Move to re-sequence it`);
  if (!_validCaseIAngels(caseIAngels)) return _fail(`caseIAngels must be an integer ${CASE_I_MIN_ANGELS}..${CASE_I_MAX_ANGELS} or null`);
  const placed = _placeAt(_copyEntries(stack), { fdrId, status: 'HOLDING', caseIAngels }, stackIndex, _maxIndex(opts));
  if (!placed.ok) return placed;
  return _result(stack, placed.entries, new Set([fdrId, ...placed.shifted]));
}

/** Insert at the next free slot above the highest entry. */
function append(stack, { fdrId, caseIAngels = null } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  return insertAt(stack, { fdrId, stackIndex: _highest(stack.entries) + 1, caseIAngels }, opts);
}

/**
 * Re-sequence — THE cheap gesture (§9.12 rule 2). Atomically: take the entry
 * out (leaving its slot vacant, decisions H28) and place it at `toIndex`
 * with insertAt's rules and refusals. Moving DOWN renumbers exactly the
 * entries it passes (the vacancy it left absorbs the ripple).
 */
function move(stack, { fdrId, toIndex } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  const entry = stack.entries.find((e) => e.fdrId === fdrId);
  if (!entry) return _fail(`${fdrId} is not in the stack`, 'NOT_FOUND');
  if (entry.status === 'PUSHED') return _fail(`${fdrId} has already pushed and cannot be re-sequenced`);
  if (toIndex === entry.stackIndex) return _fail(`${fdrId} is already at ${toIndex}`);
  const rest = _copyEntries(stack).filter((e) => e.fdrId !== fdrId);
  const placed = _placeAt(rest, { ...entry }, toIndex, _maxIndex(opts));
  if (!placed.ok) return placed;
  return _result(stack, placed.entries, new Set([fdrId, ...placed.shifted]));
}

function _closeUpEntries(entries, gapIndex) {
  const above = entries.filter((e) => e.stackIndex > gapIndex);
  const pushed = above.find((e) => e.status === 'PUSHED');
  if (pushed) {
    return _fail(`cannot close up: ${pushed.fdrId} at ${pushed.stackIndex} has already pushed, and renumbering it would rewrite a push time in the past`);
  }
  const ids = new Set(above.map((e) => e.fdrId));
  return {
    ok: true,
    entries: entries.map((e) => (ids.has(e.fdrId) ? { ...e, stackIndex: e.stackIndex - 1 } : e)),
    shifted: [...ids],
  };
}

/**
 * Take a flight out of the stack (diverted, bingo, dropped, trapped). By
 * default its slot stays VACANT and nobody above moves (decisions H28);
 * `closeUp: true` shifts every entry above the gap down one, in the same op.
 */
function remove(stack, { fdrId, closeUp = false } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  const entry = stack.entries.find((e) => e.fdrId === fdrId);
  if (!entry) return _fail(`${fdrId} is not in the stack`, 'NOT_FOUND');
  let entries = _copyEntries(stack).filter((e) => e.fdrId !== fdrId);
  const changed = new Set([fdrId]);
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
function markPushed(stack, { fdrId } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  const entry = stack.entries.find((e) => e.fdrId === fdrId);
  if (!entry) return _fail(`${fdrId} is not in the stack`, 'NOT_FOUND');
  if (entry.status === 'PUSHED') return _fail(`${fdrId} has already pushed`);
  const entries = _copyEntries(stack).map((e) => (e.fdrId === fdrId ? { ...e, status: 'PUSHED' } : e));
  return _result(stack, entries, new Set([fdrId]));
}

/**
 * Charlie time — when stack index 0 is due to push. Mission Zulu epoch ms
 * (decisions H11), or null to clear. Shifts every push time together; changes
 * nothing else. `changed` = every HOLDING entry.
 */
function setCharlieTime(stack, { charlieTimeUtc } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  if (charlieTimeUtc !== null && !Number.isFinite(charlieTimeUtc)) {
    return _fail('charlieTimeUtc must be epoch ms (mission Zulu) or null');
  }
  if (charlieTimeUtc === stack.charlieTimeUtc) return _fail('Charlie time is unchanged');
  const changed = new Set(stack.entries.filter((e) => e.status === 'HOLDING').map((e) => e.fdrId));
  return _result(stack, _copyEntries(stack), changed, { charlieTimeUtc });
}

/** Case I only: the squadron-assigned altitude — the one per-entry value a controller types. */
function setCaseIAngels(stack, { fdrId, caseIAngels } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  const entry = stack.entries.find((e) => e.fdrId === fdrId);
  if (!entry) return _fail(`${fdrId} is not in the stack`, 'NOT_FOUND');
  if (caseIAngels === undefined || !_validCaseIAngels(caseIAngels)) {
    return _fail(`caseIAngels must be an integer ${CASE_I_MIN_ANGELS}..${CASE_I_MAX_ANGELS} (§9.12: from 2,000 ft) or null`);
  }
  const entries = _copyEntries(stack).map((e) => (e.fdrId === fdrId ? { ...e, caseIAngels } : e));
  return _result(stack, entries, new Set([fdrId]));
}

/**
 * The marshal radial, set by the Marshal controller (decisions H27), degrees
 * TRUE; null returns to the default, final bearing + 180. One value for the
 * stack, so every entry's message changes. Out-of-range input is refused, not
 * wrapped: 360 is not a radial anyone typed on purpose into a true field.
 */
function setMarshalRadial(stack, { marshalRadialDeg } = {}, opts = STACK_DEFAULTS) {
  const v = validateStack(stack, opts);
  if (!v.ok) return v;
  if (marshalRadialDeg !== null
      && !(typeof marshalRadialDeg === 'number' && Number.isFinite(marshalRadialDeg) && marshalRadialDeg >= 0 && marshalRadialDeg < 360)) {
    return _fail('marshalRadialDeg must be a bearing in [0, 360) degrees true, or null for the default (final bearing + 180)');
  }
  if (marshalRadialDeg === stack.marshalRadialDeg) return _fail('marshal radial is unchanged');
  const changed = new Set(stack.entries.map((e) => e.fdrId));
  return _result(stack, _copyEntries(stack), changed, { marshalRadialDeg });
}

const _DISPATCH = {
  InsertAt: (s, op, o) => insertAt(s, op, o),
  Append: (s, op, o) => append(s, op, o),
  Move: (s, op, o) => move(s, op, o),
  Remove: (s, op, o) => remove(s, op, o),
  CloseUp: (s, op, o) => closeUp(s, op, o),
  MarkPushed: (s, op, o) => markPushed(s, op, o),
  SetCharlieTime: (s, op, o) => setCharlieTime(s, op, o),
  SetCaseIAngels: (s, op, o) => setCaseIAngels(s, op, o),
  SetMarshalRadial: (s, op, o) => setMarshalRadial(s, op, o),
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
  setCharlieTime,
  setCaseIAngels,
  setMarshalRadial,
  applyStackOp,
};
