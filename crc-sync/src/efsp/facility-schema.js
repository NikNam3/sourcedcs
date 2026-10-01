'use strict';

// The Facility config schema: what a facility JSON must say and how its parts refer to one another
// (docs/wip/DATA-1.md; guide §8.3). Pure: facility-config.js loads the files, this module judges them.
// validateConfig is the shape check every caller already used; validateFacilityConfig adds the
// required keys and the cross-references a complete file must satisfy.

const blockMap = require('./block-map');
const fieldState = require('./field-state'); // pure, requires nothing back (docs/adr/0061)
const { validateAlertPadConfig } = require('./alert-scramble'); // pure (docs/adr/0070)

/**
 * Validates a candidate facility config (guide §8.3): every required Block
 * for each role in `blockVisibility` MUST stay visible, and every Bay's
 * owning Position MUST exist in the Position set (rule 3). Facility-
 * agnostic — operates on whichever candidate object is passed in. Returns
 * {ok:true} or {ok:false, reason:'VALIDATION_ERROR', detail}.
 */
function validateConfig(candidate) {
  // The doctrinal check is unchanged (guide §8.3: every REQUIRED Block MUST
  // stay visible) — only the direction it reads from. What a Facility hides
  // is subtracted from the Block Map, and the remainder still has to contain
  // every required Block.
  for (const role of Object.keys(candidate.hiddenBlocks || {})) {
    const all = Object.keys(blockMap.BLOCK_MAPS[role] || {});
    const visibleBlocks = all.filter(b => !candidate.hiddenBlocks[role].includes(b));
    const result = blockMap.validateFacilityConfig({ role, visibleBlocks });
    if (!result.ok) return result;
  }
  for (const positionId of Object.keys(candidate.bays || {})) {
    if (!(candidate.positions || []).includes(positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `Bay set references unknown Position ${positionId}` };
    }
  }
  for (const [positionId, letter] of Object.entries(candidate.positionLetters || {})) {
    if (!(candidate.positions || []).includes(positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionLetters references unknown Position ${positionId}` };
    }
    if (typeof letter !== 'string' || !/^[A-Z0-9]$/.test(letter)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionLetters.${positionId} must be one character A-Z or 0-9` };
    }
  }
  for (const positionId of Object.keys(candidate.positionClasses || {})) {
    if (!(candidate.positions || []).includes(positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionClasses references unknown Position ${positionId}` };
    }
  }
  // Radar selectors are checked for SHAPE only, not for resolving to anything.
  // A selector naming an airfield this theater does not have is legitimate —
  // the same config has to work across theaters — so an unresolvable selector
  // is a startup warning (index.js's _validateRadarSelectors, following
  // _validateAirspaceReferences), never a config rejection. A malformed one is
  // a different matter: it can never resolve in any theater.
  for (const [positionId, selectors] of Object.entries(candidate.positionRadars || {})) {
    if (!(candidate.positions || []).includes(positionId)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionRadars references unknown Position ${positionId}` };
    }
    if (!Array.isArray(selectors)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionRadars.${positionId} must be an array of selectors` };
    }
    for (const selector of selectors) {
      const problem = validateRadarSelector(selector);
      if (problem) {
        return { ok: false, reason: 'VALIDATION_ERROR', detail: `positionRadars.${positionId}: ${problem}` };
      }
    }
  }
  const bayProblem = validateBayDescriptors(candidate);
  if (bayProblem) return { ok: false, reason: 'VALIDATION_ERROR', detail: bayProblem };
  if (candidate.singleFrequencyApproach !== undefined) {
    const problem = validateSingleFrequencyApproach(candidate.singleFrequencyApproach, candidate);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
  }
  // The runway inventory (guide §9.7, docs/adr/0061): malformed can never work
  // anywhere, so it is rejected like a malformed radar selector. How it lines
  // up with the Bays only warns — see _loadOne.
  if (candidate.fieldState !== undefined) {
    const problem = fieldState.validateFieldStateInventory(candidate.fieldState, candidate.positions || []);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
  }
  if (candidate.fieldState && candidate.fieldState.pads) {
    const problem = validateAlertPadConfig(candidate.fieldState.pads.alert);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
  }
  return { ok: true };
}

// The Bay descriptor flags (docs/adr/0093). Only these keys beyond bayId/rackIds/
// impliesState exist, so a typo in a config can never silently mount nothing.
const BAY_VIEWS = Object.freeze(['pattern', 'final', 'sfa-freqs']);
// `holdsRole` is L28's (docs/adr/0087): a Bay that files its Role's Strips whatever their state.
const BAY_DESCRIPTOR_KEYS = Object.freeze(['bayId', 'rackIds', 'impliesState', 'view', 'replacesRacks', 'capacity', 'holdsRole']);

/** A human problem string for a malformed Bay descriptor flag (`view`, `capacity`), or null. */
function validateBayDescriptors(candidate) {
  for (const [positionId, bays] of Object.entries(candidate.bays || {})) {
    for (const bay of bays) {
      if (bay.view !== undefined && !BAY_VIEWS.includes(bay.view)) {
        return `bays.${positionId}.${bay.bayId}: unknown view ${JSON.stringify(bay.view)} (one of ${BAY_VIEWS.join(', ')})`;
      }
      if (bay.capacity !== undefined && !(Number.isInteger(bay.capacity) && bay.capacity >= 1)) {
        return `bays.${positionId}.${bay.bayId}: capacity must be a whole number of at least 1`;
      }
      if (bay.replacesRacks !== undefined && (typeof bay.replacesRacks !== 'boolean' || !bay.view)) {
        return `bays.${positionId}.${bay.bayId}: replacesRacks is true or false and needs a view`;
      }
      if (bay.holdsRole !== undefined && (typeof bay.holdsRole !== 'string' || !bay.holdsRole)) {
        return `bays.${positionId}.${bay.bayId}: holdsRole is a Role name`;
      }
      const stray = Object.keys(bay).find(k => !BAY_DESCRIPTOR_KEYS.includes(k));
      if (stray) return `bays.${positionId}.${bay.bayId}: unknown Bay descriptor key ${JSON.stringify(stray)}`;
    }
  }
  return null;
}

// UHF, [SOURCE-DEFINED]: guide §4.7 says "UHF", the squadron's pool lives in 225.000 to 399.975.
const SFA_MIN_MHZ = 225;
const SFA_MAX_MHZ = 399.975;
const SFA_MIN_POOL = 5; // guide §4.7: "at least five discrete UHF frequencies"

/**
 * Guide §4.7's pool, checked as a unit: at least five unique frequencies whose
 * Racks are exactly the SFA Bay's, a rotation smaller than the pool, and APP-style
 * jurisdiction held by a Position of this Facility. Returns a problem string or null.
 */
function validateSingleFrequencyApproach(sfa, candidate) {
  if (!sfa || typeof sfa !== 'object') return 'singleFrequencyApproach must be an object';
  const positions = candidate.positions || [];
  if (!positions.includes(sfa.jurisdiction)) return `singleFrequencyApproach.jurisdiction ${JSON.stringify(sfa.jurisdiction)} is not a Position of this Facility`;
  if (!Array.isArray(sfa.pool) || sfa.pool.length < SFA_MIN_POOL) {
    return `singleFrequencyApproach.pool needs at least ${SFA_MIN_POOL} frequencies (guide §4.7), has ${Array.isArray(sfa.pool) ? sfa.pool.length : 0}`;
  }
  if (!Number.isInteger(sfa.rotationSize) || sfa.rotationSize < 1 || sfa.rotationSize >= sfa.pool.length) {
    return 'singleFrequencyApproach.rotationSize must be a whole number of at least 1 and smaller than the pool';
  }
  const ids = new Set();
  const mhzs = new Set();
  for (const entry of sfa.pool) {
    if (!entry || typeof entry.rackId !== 'string' || !entry.rackId) return 'every singleFrequencyApproach.pool entry needs a rackId';
    if (ids.has(entry.rackId)) return `singleFrequencyApproach.pool repeats rackId ${entry.rackId}`;
    ids.add(entry.rackId);
    if (typeof entry.mhz !== 'number' || !Number.isFinite(entry.mhz) || entry.mhz < SFA_MIN_MHZ || entry.mhz > SFA_MAX_MHZ) {
      return `singleFrequencyApproach.pool ${entry.rackId}: mhz must be a UHF number from ${SFA_MIN_MHZ} to ${SFA_MAX_MHZ}`;
    }
    if (mhzs.has(entry.mhz)) return `singleFrequencyApproach.pool repeats ${entry.mhz} MHz`;
    mhzs.add(entry.mhz);
  }
  const sfaBays = [];
  for (const bays of Object.values(candidate.bays || {})) for (const b of bays) if (b.view === 'sfa-freqs') sfaBays.push(b);
  if (sfaBays.length !== 1) return `exactly one Bay must have view 'sfa-freqs', found ${sfaBays.length}`;
  const bayRacks = sfaBays[0].rackIds || [];
  if (bayRacks.length !== ids.size || !bayRacks.every(r => ids.has(r))) {
    return `the SFA Bay's Racks (${bayRacks.join(', ')}) must be exactly the pool's rackIds (${[...ids].join(', ')})`;
  }
  if (sfa.initialRotation !== undefined) {
    const problem = validateSfaRotationRecord(sfa.initialRotation, sfa, positions);
    if (problem) return `singleFrequencyApproach.initialRotation: ${problem}`;
  }
  return null;
}

/**
 * A rotation record `{ rackId: positionId }` against its config: frequencies
 * from the pool, Positions of the Facility, no more entries than the rotation
 * holds, and one Position on one frequency at a time. Pure; sfa-store.js uses it too.
 */
function validateSfaRotationRecord(record, sfa, positions) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return 'must be an object of rackId to Position';
  const pool = new Set(sfa.pool.map(p => p.rackId));
  const entries = Object.entries(record);
  if (entries.length > sfa.rotationSize) return `at most ${sfa.rotationSize} frequencies are in rotation, got ${entries.length}`;
  const held = new Set();
  for (const [rackId, positionId] of entries) {
    if (!pool.has(rackId)) return `${rackId} is not a pool frequency`;
    if (!positions.includes(positionId)) return `${positionId} is not a Position of this Facility`;
    if (held.has(positionId)) return `${positionId} cannot be on two frequencies at once`;
    held.add(positionId);
  }
  return null;
}

// `datalink` is not a radar: it grants the datalink feed (docs/adr/0059).
const RADAR_SELECTOR_KINDS = new Set(['airport', 'approach', 'awacs', 'fighter', 'carrier', 'datalink']);

/** Returns a human problem string, or null when the selector is well formed. */
function validateRadarSelector(selector) {
  if (!selector || typeof selector !== 'object') return 'a selector must be an object';
  if (!RADAR_SELECTOR_KINDS.has(selector.kind)) {
    return `unknown radar kind ${JSON.stringify(selector.kind)} (one of ${[...RADAR_SELECTOR_KINDS].join(', ')})`;
  }
  if (selector.airport !== undefined && typeof selector.airport !== 'string') {
    return 'airport must be an ICAO/name string, or "*"';
  }
  if (selector.coalition !== undefined && selector.coalition !== 'own' && selector.coalition !== 'any') {
    return 'coalition must be "own" or "any"';
  }
  // An airport selector against an airborne kind cannot mean anything, and a
  // config that says it is confused about what it is asking for.
  if (selector.radar !== undefined && (selector.kind !== 'carrier' || (selector.radar !== 'search' && selector.radar !== 'approach'))) {
    return 'radar ("search" or "approach") applies to a carrier selector only';
  }
  if (selector.hull !== undefined && (selector.kind !== 'carrier' || typeof selector.hull !== 'string')) {
    return 'hull (a hull id string) applies to a carrier selector only';
  }
  if (selector.airport && (selector.kind === 'awacs' || selector.kind === 'fighter' || selector.kind === 'datalink')) {
    return selector.kind === 'datalink'
      ? 'the datalink is a network — an airport selector cannot match it'
      : `${selector.kind} radars are airborne — an airport selector cannot match one`;
  }
  return null;
}

const fail = (detail) => ({ ok: false, reason: 'VALIDATION_ERROR', detail });
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Keys every facility file must carry (a shipped file is complete: nothing is merged in from the code).
// `singleFrequencyApproach` and `fieldState` are the only optional ones: a Facility without those Bays has none.
const REQUIRED_KEYS = Object.freeze({
  facility: 'string', positions: 'array', positionClasses: 'object', positionLetters: 'object', coveringChain: 'object',
  positionRadars: 'object', hiddenBlocks: 'object', bays: 'object', dataOnly: 'boolean', standingReleases: 'array', aitAuthorized: 'boolean',
});

/**
 * A complete facility file: every required key present with the right type, then validateConfig's checks,
 * then the cross-references. Bays point to Racks they name themselves (non-empty, no repeats), a bayId is
 * unique in the Facility, `holdsRole` names a Role the Block Map knows, every Position has a class, and the
 * covering chain joins Positions of this Facility and has no loop.
 * Returns {ok:true} or {ok:false, reason:'VALIDATION_ERROR', detail}.
 */
function validateFacilityConfig(candidate, expectedFacilityId) {
  if (!isPlainObject(candidate)) return fail('a facility config must be an object');
  for (const [key, type] of Object.entries(REQUIRED_KEYS)) {
    const v = candidate[key];
    const okType = type === 'array' ? Array.isArray(v) : type === 'object' ? isPlainObject(v) : typeof v === type;
    if (v === undefined) return fail(`missing required key ${key}`);
    if (!okType) return fail(`${key} must be ${type === 'array' ? 'an array' : type === 'object' ? 'an object' : `a ${type}`}`);
  }
  if (expectedFacilityId !== undefined && candidate.facility !== expectedFacilityId) {
    return fail(`facility is ${JSON.stringify(candidate.facility)}, expected ${JSON.stringify(expectedFacilityId)}`);
  }
  if (!candidate.positions.length || candidate.positions.some(p => typeof p !== 'string' || !p) || new Set(candidate.positions).size !== candidate.positions.length) {
    return fail('positions must be a non-empty list of unique Position ids');
  }
  const base = validateConfig(candidate);
  if (!base.ok) return base;
  const positions = new Set(candidate.positions);
  for (const positionId of candidate.positions) {
    if (typeof candidate.positionClasses[positionId] !== 'string') return fail(`positionClasses has no class for Position ${positionId}`);
  }
  for (const [from, to] of Object.entries(candidate.coveringChain)) {
    if (!positions.has(from)) return fail(`coveringChain names unknown Position ${from}`);
    if (!positions.has(to)) return fail(`coveringChain.${from} names unknown Position ${to}`);
  }
  for (const start of Object.keys(candidate.coveringChain)) {
    const seen = new Set([start]);
    for (let at = candidate.coveringChain[start]; at !== undefined; at = candidate.coveringChain[at]) {
      if (seen.has(at)) return fail(`coveringChain loops back to ${at}`);
      seen.add(at);
    }
  }
  const bayIds = new Set();
  for (const [positionId, bays] of Object.entries(candidate.bays)) {
    if (!Array.isArray(bays)) return fail(`bays.${positionId} must be an array of Bays`);
    for (const bay of bays) {
      if (!bay || typeof bay.bayId !== 'string' || !bay.bayId) return fail(`bays.${positionId} has a Bay with no bayId`);
      if (bayIds.has(bay.bayId)) return fail(`bayId ${bay.bayId} is used twice`);
      bayIds.add(bay.bayId);
      const racks = bay.rackIds;
      if (!Array.isArray(racks) || !racks.length || racks.some(r => typeof r !== 'string' || !r) || new Set(racks).size !== racks.length) {
        return fail(`bays.${positionId}.${bay.bayId}: rackIds must be a non-empty list of unique Rack ids`);
      }
      if (bay.impliesState !== undefined && (typeof bay.impliesState !== 'string' || !bay.impliesState)) return fail(`bays.${positionId}.${bay.bayId}: impliesState is a state name`);
      if (bay.holdsRole !== undefined && !Object.prototype.hasOwnProperty.call(blockMap.BLOCK_MAPS, bay.holdsRole)) {
        return fail(`bays.${positionId}.${bay.bayId}: holdsRole ${JSON.stringify(bay.holdsRole)} is not a Role (one of ${Object.keys(blockMap.BLOCK_MAPS).join(', ')})`);
      }
    }
  }
  for (const role of Object.keys(candidate.hiddenBlocks)) {
    if (!Object.prototype.hasOwnProperty.call(blockMap.BLOCK_MAPS, role)) return fail(`hiddenBlocks names unknown Role ${role}`);
  }
  return { ok: true };
}

module.exports = { validateConfig, validateFacilityConfig, validateRadarSelector, validateSfaRotationRecord, BAY_VIEWS, REQUIRED_KEYS };
