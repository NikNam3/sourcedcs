'use strict';

// The Facility config schema: what a facility JSON must say and how its parts refer to one another
// (docs/wip/DATA-1.md; guide §8.3). Pure: facility-config.js loads the files, this module judges them.
// validateConfig is the shape check every caller already used; validateFacilityConfig adds the
// required keys and the cross-references a complete file must satisfy.

const blockMap = require('./block-map');
const runwayStatus = require('./runway-status'); // pure, requires nothing back (docs/adr/0061)
const { validateAlertPadConfig } = require('./alert-scramble'); // pure (docs/adr/0070)

/**
 * Validates a candidate facility config (guide §8.3): every required Block
 * for each strip type in `hiddenBlocks` MUST stay visible, and every Bay's
 * owning Position MUST exist in the Position set (rule 3). Facility-
 * agnostic — operates on whichever candidate object is passed in. Returns
 * {ok:true} or {ok:false, reason:'VALIDATION_ERROR', detail}.
 */
function validateConfig(candidate) {
  // The doctrinal check is unchanged (guide §8.3: every REQUIRED Block MUST
  // stay visible) — only the direction it reads from. What a Facility hides
  // is subtracted from the Block Map, and the remainder still has to contain
  // every required Block.
  for (const stripType of Object.keys(candidate.hiddenBlocks || {})) {
    const all = Object.keys(blockMap.BLOCK_MAPS[stripType] || {});
    const visibleBlocks = all.filter(b => !candidate.hiddenBlocks[stripType].includes(b));
    const result = blockMap.validateFacilityConfig({ stripType, visibleBlocks });
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
  // is a startup warning (position-coverage.js's reportUnresolvedSelectors, like index.js's
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
  if (candidate.runwayStatus !== undefined) {
    const problem = runwayStatus.validateRunwayStatusInventory(candidate.runwayStatus, candidate.positions || []);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
  }
  if (candidate.runwayStatus && candidate.runwayStatus.pads) {
    const problem = validateAlertPadConfig(candidate.runwayStatus.pads.alert);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
  }
  return { ok: true };
}

// The Bay descriptor flags (docs/adr/0093). Only these keys beyond bayId/rackIds/
// impliesState exist, so a typo in a config can never silently mount nothing.
const BAY_VIEWS = Object.freeze(['pattern', 'final', 'sfa-freqs']);
// `holdsStripType` is L28's (docs/adr/0087): a Bay that files its strip type's Strips whatever their state.
const BAY_DESCRIPTOR_KEYS = Object.freeze(['bayId', 'rackIds', 'impliesState', 'view', 'replacesRacks', 'capacity', 'holdsStripType']);

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
      if (bay.holdsStripType !== undefined && (typeof bay.holdsStripType !== 'string' || !bay.holdsStripType)) {
        return `bays.${positionId}.${bay.bayId}: holdsStripType is a strip type name`;
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
 * Racks are exactly the SFA Bay's, a rotation smaller than the pool, and AP-style
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

// What each top-level key of a facility file means and where its value comes from. A facility JSON takes no
// comments (no `_comment` key, ever: the loader is not the tuning loader), so the notes live here, once per key.
// "Guide" is EFSPImplementationGuide.md; [SOURCE-DEFINED] marks a value that is SOURCE's own choice, not the
// guide's or a cited FAA/ICAO text (guide §13, docs/adr/0077). The values changed their ids since the notes were
// first written on the old literals (commit 8476c41^): LC/GC/AP (was TWR/GND/APP), `consolidation` (was
// coveringChain), `runwayStatus` (was fieldState), `holdsStripType` (was holdsRole); this is what is true now.
//
//  facility: the Facility's id (INCIRLIK, CENTER, TACTICAL, CARRIER). It must equal the file's expected id.
//    RANGES has no file: its Position set is derived from the airspace definitions, every boot (facility-config.js).
//  positions: the Facility's Position ids. Guide §4.1 names the Facilities and their Positions; the ids follow
//    JO 7210.3 TBL 10-1-1 (LC, GC, AP; OPS, CD, RSU, SFA, PAR, CTR, and the tactical and carrier ids unchanged).
//    INCIRLIK's eight, CENTER's CTR and TACTICAL's TAC_C2/AIC/GCI/JTAC are the guide's. [SOURCE-DEFINED]
//    (docs/adr/0074, 0075): the CARRIER Facility (CV_MARSHAL, CV_PRIFLY, CV_APP1, CV_APP2) and INCIRLIK's RSU, SFA
//    and PAR where the guide is silent on the Facility's own set. JTAC is read-only (guide §4.1: "MISSION
//    (read-only)"), enforced by authority/ never granting it ownership or Mutation rights, not by anything here.
//  positionClasses: every Position's doctrinal class (guide §4.1's Class column), which authority/classes.js reads
//    (through getPositionClass) so the cross-Facility coordination primitives and TOFI are gated by class, not by a hand-kept id list
//    (docs/adr/0020). Every Position needs one. RSU, SFA and PAR are MILITARY_ATC too: RSU's advisory role with no separation authority (guide §4.1) is a permission matter, never a new class, because a new class would silently drop
//    Conflict Alert (position-coverage.js's ATC_CLASSES, the inclusion-list trap of docs/adr/0041).
//    CARRIER's four Positions are all MILITARY_ATC for the same reason ("Military ATC afloat"); PriFly's
//    "supervisory, not radar control" is a permission matter too. [SOURCE-DEFINED] (docs/adr/0074) where the
//    guide is silent.
//  positionLetters: the one character an ATC scope draws on a contact this Position owns (docs/adr/0088, the
//    STARS "position symbol"). [SOURCE-DEFINED] (docs/adr/0088): the letters are ours; one A-Z or 0-9 each.
//    The whole tactical side shares `M`, shown on a flight under tactical control after TOFI (H48).
//  consolidation: where an unstaffed Position's Strips go, one hop: `{ CD: 'GC' }` reads "CD is consolidated at
//    GC" (guide §4.5 rule 3, §4.8.6; JO 7210.3 para 2-2-3, 2-6-5). Walked to the end by position-store.js (the
//    staffing fallback). Guide §4.8.6 rule 2 gives the default: CD, GC, LC, AP, then CTR; AIC and GCI to TAC_C2,
//    then CTR; CV_APP* to CV_MARSHAL to CV_PRIFLY; RSU to LC; SFA and PAR to AP. The shipped maps DEVIATE from it
//    in three places, and none of the three is the guide's: [SOURCE-DEFINED] (docs/adr/0013) there is no AP to
//    CTR (nor TAC_C2 to CTR): consolidation is INTRAFACILITY, never crossing a Facility, which is a different
//    thing from the cross-Facility handoff of §4.6 (position-store.js is scoped to one Facility's staffing).
//    [SOURCE-DEFINED] (docs/adr/0075) there is no RSU to LC: RSU is absent on purpose, as OPS is, so a Strip
//    never strands on a supervisory Position. [SOURCE-DEFINED] (docs/adr/0074) the carrier chain is CV_APP2 to
//    CV_APP1 to CV_MARSHAL and stops there, omitting CV_PRIFLY, for the same reason. The rest ships as the guide
//    has it: CD to GC to LC to AP, SFA and PAR to AP, AIC and GCI to TAC_C2. [SOURCE-DEFINED] (docs/adr/0080)
//    JTAC to TAC_C2 is ours, so a line stays with the Position that handed it over. CENTER's CTR and RANGES have
//    no entry: CTR is the Facility's only Position, so there is nowhere inside it to consolidate to (and it
//    owns Strips, `ctr-enroute`), and a RANGE Position owns no Strips at all (guide §4.1 rule 2). So AP, CTR,
//    TAC_C2 and CV_MARSHAL end their chains: guide §4.8.6 rule 3 calls a Strip left owned by an unstaffed
//    Position with no consolidation path defect D19, and the Facility boundary is what leaves it open here;
//    the mitigation is rule 5's "warn, do not block" (the controller is warned of the stranding before
//    leaving). Whether GC should consolidate into LC at all is open (decisions H101, RP-F1).
//  positionRadars: which radars each Position works through, as selectors, never radar ids (docs/adr/0042,
//    0043). [SOURCE-DEFINED] (docs/adr/0042, 0043): which scope sits at which console is squadron data, not
//    doctrine; the guide says nothing about it. A radar's id is derived from live mission data, so a stored id
//    would be right the day it is written and silently empty the next time the data moves (docs/adr/0041); a
//    selector resolves against whatever the current mission produced, and one naming an airfield the theater
//    lacks only warns (position-coverage.js's reportUnresolvedSelectors). An empty array is a statement, not an omission:
//    OPS, CD and GC have no scope (docs/adr/0033 leans on it), JTAC none (guide §4.1: read-only and non-ATC).
//    `airport: '*'` (CENTER's CTR: every airfield's approach radar) needs no editing when the theater changes.
//    TACTICAL's awacs/fighter/datalink selectors model a Military Radar Unit working the airborne picture, and
//    `coalition: 'own'` resolves against CRCSYNC_COALITION (docs/adr/0059). RSU watches the field and the visual
//    pattern (the airport radar), SFA works AP's picture, PAR the precision approach radar alone
//    (docs/adr/0075). The carrier's selectors name the radar and the hull (position-coverage.js).
//    INCIRLIK's `LTAG` is the airport-selector id of Incirlik. "Squadron data to verify" for any value we have
//    not checked against the mission.
//  hiddenBlocks: Blocks this Facility hides, by strip type (guide §8.2's "Strip layout" row: visibility is configurable). Empty
//    everywhere shipped, so a Block added later stays visible without anyone regenerating a file. Validated
//    against the Block Map's required Blocks (guide §8.3: every required Block MUST stay visible). The earlier
//    inclusion list `blockVisibility` was replaced by this (docs/adr/0041); a file that still has it is
//    refused at start-up.
//  bays: each Position's Bays, in order, each with its Racks and (optionally) the strip state it implies. The
//    Bay sets are the guide's §4.2 defaults, restricted to the Positions each Facility has. [SOURCE-DEFINED]
//    (docs/adr/0013, 0025, 0074): CENTER's and the carrier's Bay sets (the guide grounds only INCIRLIK's §4.2
//    table), TACTICAL's, which follows the guide's Bay names for TAC_C2/AIC/GCI verbatim plus a read-only
//    viewing Bay for JTAC. The first Bay of a Position is the "no match" fallback of placement (board/placement.js's
//    bayForNewOwner, bayForImpliedState): that is why `ops-proposed` is OPS's first, since `ops-filed` is the
//    client-local filed-plan queue and a Strip landing there would be invisible. `-coordination` Bays are
//    present for every Position that can receive a proposed replica (docs/adr/0015), and exist
//    on the carrier only as the "first Bay implying no state" fallback ("the carrier does not talk to the
//    centre", guide §9.13). One Rack per runway end in `lc-runway-queue` (guide §4.2); one Rack per assigned
//    frequency in `sfa-frequencies` (§4.2, §4.7); a pattern leg is a Rack (docs/adr/0064). The strip state a Bay
//    implies is the guide's §3.5 rule 4 / §2 "Bay membership expresses operational state"; the Bay a Strip
//    sits in for another strip type's state never lands on a `holdsStripType` Bay (docs/adr/0087). The
//    descriptor flags `view`, `replacesRacks`, `capacity` are docs/adr/0093 (a Bay's component and the
//    PAR Final Bay's one Strip at a time, guide §7.10). The strip state `FINAL` (LC's Bay) is unrelated to the
//    strip type `FINAL` (guide §7.10's PAR and carrier type): see nla.js's module comment.
//    `app-overflight` and `ctr-overflight` hold OVERFLIGHT Strips whatever their state (docs/adr/0023, 0087).
//  singleFrequencyApproach (optional): guide §4.7, docs/adr/0075. `jurisdiction` holds a rotation of
//    `rotationSize` frequencies out of `pool` (at least five discrete UHF frequencies, guide §4.7); the pool's
//    rackIds ARE the SFA Bay's Racks. [SOURCE-DEFINED] (docs/adr/0075): the frequencies are placeholders, and
//    so is who starts on which one. "Squadron data to verify." Read once at start-up, never written by code (P5);
//    the live record is sfa-store.js's.
//  dataOnly: whether this Facility is data-only. §4.6.1's 3-minute-verification obligation branches only when the
//    RECEIVING Facility is data-only; every shipped Facility has a real controller interface, so false
//    everywhere, exercised only by test fixtures (docs/adr/0021).
//  standingReleases: §4.6.2's standing-release envelopes, granted BY the delegating (center) Facility TO the
//    approach Facility, held in AP's own config. Empty by default: a real envelope is facility data, not
//    code (release-envelope.js's matchesStandingRelease).
//  aitAuthorized: AIT is configuration, not a default (guide §4.6 rule 7): false until a real written
//    directive is on file (docs/adr/0022).
//  runwayStatus (optional): the runway INVENTORY only, guide §9.7 (docs/adr/0061): which runways, ends and gear
//    exist. Read once at start-up and never written by code (decisions.md P5); status, suspension, the active
//    end and any runway change are runtime state in runway-status-store.js. Shape checked by runway-status.js's
//    validateRunwayStatusInventory. [SOURCE-DEFINED], squadron data to verify: every value is squadron data,
//    not doctrine. `airportIcao` (LTAG) is whose mission wind picks the active end at load (H22). One record per
//    PHYSICAL runway (S-Q23: runway works close the pavement in both directions). `endHeadingsTrue` (05 = 56,
//    23 = 236) are TRUE headings, because DCS reports wind in degrees true and an end's number is magnetic;
//    approximate, the squadron should verify (C-9). `rackIds` are lc-runway-queue's one Rack per end.
//    `arrestingGear` is `[]`: DCS does not simulate arresting wires (H17), so the gear is the §9.7 data shape and
//    nothing more. `runwayChangeAcknowledgers` (OPS, AP; guide §9.7 rule 3, OPS stands in for the SOF) is
//    coordination, not permission (H20): an acknowledger nobody has signed on when the change is proposed is
//    skipped and audited, never a deadlock, and there is no cross-Facility reversion (S-R2-15).
//    `inspectionAuthorityPositionId` (OPS) narrows the CompleteInspection row in authority/positions/incirlik-military.js; it can never widen
//    it. `pads` are named placeholders only, no geometry or preferred direction (H21); `pads.alert.accessRoute`
//    is the route §9.6 keeps clear for alert scrambles, marked constrained while a scramble is active
//    (docs/adr/0070), a [SOURCE-DEFINED] placeholder name.

// Keys every facility file must carry (a shipped file is complete: nothing is merged in from the code).
// `singleFrequencyApproach` and `runwayStatus` are the only optional ones: a Facility without those Bays has none.
const REQUIRED_KEYS = Object.freeze({
  facility: 'string', positions: 'array', positionClasses: 'object', positionLetters: 'object', consolidation: 'object',
  positionRadars: 'object', hiddenBlocks: 'object', bays: 'object', dataOnly: 'boolean', standingReleases: 'array', aitAuthorized: 'boolean',
});

/**
 * A complete facility file: every required key present with the right type, then validateConfig's checks,
 * then the cross-references. Bays point to Racks they name themselves (non-empty, no repeats), a bayId is
 * unique in the Facility, `holdsStripType` names a strip type the Block Map knows, every Position has a class, and the
 * consolidation joins Positions of this Facility and has no loop.
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
  for (const [from, to] of Object.entries(candidate.consolidation)) {
    if (!positions.has(from)) return fail(`consolidation names unknown Position ${from}`);
    if (!positions.has(to)) return fail(`consolidation.${from} names unknown Position ${to}`);
  }
  for (const start of Object.keys(candidate.consolidation)) {
    const seen = new Set([start]);
    for (let at = candidate.consolidation[start]; at !== undefined; at = candidate.consolidation[at]) {
      if (seen.has(at)) return fail(`consolidation loops back to ${at}`);
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
      if (bay.holdsStripType !== undefined && !Object.prototype.hasOwnProperty.call(blockMap.BLOCK_MAPS, bay.holdsStripType)) {
        return fail(`bays.${positionId}.${bay.bayId}: holdsStripType ${JSON.stringify(bay.holdsStripType)} is not a strip type (one of ${Object.keys(blockMap.BLOCK_MAPS).join(', ')})`);
      }
    }
  }
  for (const stripType of Object.keys(candidate.hiddenBlocks)) {
    if (!Object.prototype.hasOwnProperty.call(blockMap.BLOCK_MAPS, stripType)) return fail(`hiddenBlocks names unknown strip type ${stripType}`);
  }
  return { ok: true };
}

module.exports = { validateConfig, validateFacilityConfig, validateRadarSelector, validateSfaRotationRecord, BAY_VIEWS, REQUIRED_KEYS };
