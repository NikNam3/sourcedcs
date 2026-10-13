'use strict';

// The Facility config schema: what a facility JSON must say and how its parts refer to one another
// (docs/wip/DATA-1.md; guide §8.3). Pure: facility-config.js loads the files, this module judges them.
// validateConfig is the shape check every caller already used; validateFacilityConfig adds the
// required keys and the cross-references a complete file must satisfy.

const blockMap = require('./block-map');
const runwayStatus = require('./runway-status'); // pure, requires nothing back (docs/adr/0061)
const { validateAlertPadConfig } = require('./alert-scramble'); // pure (docs/adr/0070)
const { isValidFrequency, MIN_FREQUENCY_MHZ, MAX_FREQUENCY_MHZ } = require('./airspace-schema'); // the one frequency check (docs/adr/0105)
const { validateParApproaches } = require('../surveillance/par'); // pure (docs/adr/0112)

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
  if (candidate.positionFrequencies !== undefined) {
    const problem = validatePositionFrequencies(candidate.positionFrequencies, candidate.positions || []);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
  }
  if (candidate.modeCIntruder !== undefined) {
    const problem = validateModeCIntruder(candidate.modeCIntruder, candidate.positions || []);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
  }
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
  // The PAR approaches (docs/adr/0112): one per runway end the inventory names, so a Facility without a runway inventory has none.
  if (candidate.parApproaches !== undefined) {
    const ends = ((candidate.runwayStatus && candidate.runwayStatus.runways) || []).flatMap(r => (Array.isArray(r.ends) ? r.ends : []));
    const problem = validateParApproaches(candidate.parApproaches, ends);
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
/**
 * `positionFrequencies` (docs/adr/0105): `{ <Position>: [ { label, mhz } ] }`. Every key is a Position of this Facility, a
 * label is a short non-empty string unique within the Position, and mhz is airspace-schema's isValidFrequency. Returns a
 * problem string or null.
 */
function validatePositionFrequencies(freqs, positions) {
  if (!freqs || typeof freqs !== 'object' || Array.isArray(freqs)) return 'positionFrequencies must be an object';
  for (const [positionId, list] of Object.entries(freqs)) {
    if (!positions.includes(positionId)) return `positionFrequencies names unknown Position ${positionId}`;
    if (!Array.isArray(list)) return `positionFrequencies.${positionId} must be an array of { label, mhz }`;
    const labels = new Set();
    for (const f of list) {
      if (!f || typeof f !== 'object' || Array.isArray(f)) return `positionFrequencies.${positionId} entries must be { label, mhz }`;
      const extra = Object.keys(f).filter(k => k !== 'label' && k !== 'mhz');
      if (extra.length) return `positionFrequencies.${positionId}: unknown key ${extra[0]}`;
      if (typeof f.label !== 'string' || !f.label.trim() || f.label.length > 12) return `positionFrequencies.${positionId}: label must be a string of 1 to 12 characters`;
      if (labels.has(f.label)) return `positionFrequencies.${positionId} repeats label ${f.label}`;
      labels.add(f.label);
      if (!isValidFrequency(f.mhz)) return `positionFrequencies.${positionId}.${f.label}: mhz must be a number between ${MIN_FREQUENCY_MHZ} and ${MAX_FREQUENCY_MHZ}`;
    }
  }
  return null;
}

// The Mode C Intruder setting (docs/adr/0118, H136 VQ7 a). JO 7210.3EE para 12-6-12 b (STARS): "MCI Alert base altitude
// must be set at any value between ground level and 500 feet AGL"; para 8-2-5 b (ERAM): "between ground level and 5,000
// feet MSL ... When a facility's or sector's ground level is above 5,000 feet MSL, base altitudes may be set to 1,500 AGL";
// para 12-6-12 d: "authorized to inhibit the display of MCI Alert at specified sectors/position".
const MCI_KEYS = Object.freeze(['baseAltitudeFt', 'reference', 'highTerrainAglFt', 'inhibitedPositions']);
const MCI_REFERENCES = Object.freeze(['AGL', 'MSL']);
/** The terminal default (STARS, para 12-6-12 b) for a Facility whose file has no `modeCIntruder`. */
const MCI_DEFAULT = Object.freeze({ baseAltitudeFt: 500, reference: 'AGL', highTerrainAglFt: null, inhibitedPositions: Object.freeze([]) });

/** `modeCIntruder` (docs/adr/0118): `{ baseAltitudeFt, reference: 'AGL'|'MSL', highTerrainAglFt?, inhibitedPositions? }`. A problem string or null. */
function validateModeCIntruder(mci, positions) {
  if (!isPlainObject(mci)) return 'modeCIntruder must be an object';
  const stray = Object.keys(mci).find(k => !MCI_KEYS.includes(k));
  if (stray) return `modeCIntruder: unknown key ${JSON.stringify(stray)}`;
  if (!MCI_REFERENCES.includes(mci.reference)) return `modeCIntruder.reference must be one of ${MCI_REFERENCES.join(', ')}`;
  const max = mci.reference === 'AGL' ? 500 : 5000;
  if (typeof mci.baseAltitudeFt !== 'number' || !Number.isFinite(mci.baseAltitudeFt) || mci.baseAltitudeFt < 0 || mci.baseAltitudeFt > max) {
    return `modeCIntruder.baseAltitudeFt must be a number from 0 to ${max} ft ${mci.reference} (JO 7210.3EE para ${mci.reference === 'AGL' ? '12-6-12 b' : '8-2-5 b'})`;
  }
  if (mci.highTerrainAglFt !== undefined && mci.highTerrainAglFt !== null) {
    if (mci.reference !== 'MSL') return 'modeCIntruder.highTerrainAglFt applies only to an MSL base altitude (JO 7210.3EE para 8-2-5 b)';
    if (typeof mci.highTerrainAglFt !== 'number' || !Number.isFinite(mci.highTerrainAglFt) || mci.highTerrainAglFt < 0) return 'modeCIntruder.highTerrainAglFt must be a number of feet';
  }
  if (mci.inhibitedPositions !== undefined) {
    if (!Array.isArray(mci.inhibitedPositions)) return 'modeCIntruder.inhibitedPositions must be a list of Positions';
    for (const p of mci.inhibitedPositions) if (!positions.includes(p)) return `modeCIntruder.inhibitedPositions names unknown Position ${p}`;
  }
  return null;
}

const SFA_MIN_POOL = 5; // JO 7610.14A para 7-1-5 b: "at least five discrete ultra-high frequency (UHF) frequencies"
const SFA_ROTATION_COUNT = 3; // para 7-1-5 c: "the rotation of three frequencies between himself and the GCA controller"
// What each pool frequency is for (docs/adr/0117, H134 LT-RQ5 a). ROTATION: one of the three that rotate between AP and PAR
// (para 7-1-5 c). INITIAL_CONTACT and SPARE are ours: the order leaves the other frequencies to the LOA (para 7-1-5 d).
const SFA_USES = Object.freeze(['ROTATION', 'INITIAL_CONTACT', 'SPARE']);
const SFA_KEYS = Object.freeze(['jurisdiction', 'pool']);
const SFA_POOL_KEYS = Object.freeze(['rackId', 'mhz', 'use']);

/**
 * The SFA pool, checked as a unit (docs/adr/0117): at least five unique UHF frequencies, exactly three of them marked
 * ROTATION, whose Racks are exactly the one `sfa-freqs` Bay's, that Bay being the jurisdiction Position's. Returns a
 * problem string or null.
 */
function validateSingleFrequencyApproach(sfa, candidate) {
  if (!isPlainObject(sfa)) return 'singleFrequencyApproach must be an object';
  const strayKey = Object.keys(sfa).find(k => !SFA_KEYS.includes(k));
  if (strayKey) return `singleFrequencyApproach: unknown key ${JSON.stringify(strayKey)}`;
  const positions = candidate.positions || [];
  if (!positions.includes(sfa.jurisdiction)) return `singleFrequencyApproach.jurisdiction ${JSON.stringify(sfa.jurisdiction)} is not a Position of this Facility`;
  if (!Array.isArray(sfa.pool) || sfa.pool.length < SFA_MIN_POOL) {
    return `singleFrequencyApproach.pool needs at least ${SFA_MIN_POOL} frequencies (JO 7610.14A para 7-1-5 b), has ${Array.isArray(sfa.pool) ? sfa.pool.length : 0}`;
  }
  const ids = new Set();
  const mhzs = new Set();
  for (const entry of sfa.pool) {
    if (!isPlainObject(entry) || typeof entry.rackId !== 'string' || !entry.rackId) return 'every singleFrequencyApproach.pool entry needs a rackId';
    const stray = Object.keys(entry).find(k => !SFA_POOL_KEYS.includes(k));
    if (stray) return `singleFrequencyApproach.pool ${entry.rackId}: unknown key ${JSON.stringify(stray)}`;
    if (ids.has(entry.rackId)) return `singleFrequencyApproach.pool repeats rackId ${entry.rackId}`;
    ids.add(entry.rackId);
    if (typeof entry.mhz !== 'number' || !Number.isFinite(entry.mhz) || entry.mhz < SFA_MIN_MHZ || entry.mhz > SFA_MAX_MHZ) {
      return `singleFrequencyApproach.pool ${entry.rackId}: mhz must be a UHF number from ${SFA_MIN_MHZ} to ${SFA_MAX_MHZ}`;
    }
    if (mhzs.has(entry.mhz)) return `singleFrequencyApproach.pool repeats ${entry.mhz} MHz`;
    mhzs.add(entry.mhz);
    if (!SFA_USES.includes(entry.use)) return `singleFrequencyApproach.pool ${entry.rackId}: use must be one of ${SFA_USES.join(', ')}`;
  }
  const rotating = sfa.pool.filter(e => e.use === 'ROTATION').length;
  if (rotating !== SFA_ROTATION_COUNT) {
    return `singleFrequencyApproach.pool marks ${rotating} frequencies ROTATION; JO 7610.14A para 7-1-5 c rotates ${SFA_ROTATION_COUNT}`;
  }
  const sfaBays = [];
  for (const [positionId, bays] of Object.entries(candidate.bays || {})) for (const b of bays) if (b.view === 'sfa-freqs') sfaBays.push({ positionId, bay: b });
  if (sfaBays.length !== 1) return `exactly one Bay must have view 'sfa-freqs', found ${sfaBays.length}`;
  if (sfaBays[0].positionId !== sfa.jurisdiction) {
    return `the SFA Bay ${sfaBays[0].bay.bayId} must be a Bay of ${sfa.jurisdiction}, which holds the rotation (JO 7610.14A para 7-1-5 c), not of ${sfaBays[0].positionId}`;
  }
  const bayRacks = sfaBays[0].bay.rackIds || [];
  if (bayRacks.length !== ids.size || !bayRacks.every(r => ids.has(r))) {
    return `the SFA Bay's Racks (${bayRacks.join(', ')}) must be exactly the pool's rackIds (${[...ids].join(', ')})`;
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
//    JO 7210.3 TBL 10-1-1 (LC, GC, AP; OPS, CD, RSU, PAR, CTR, and the tactical and carrier ids unchanged).
//    INCIRLIK's seven (no SFA Position since docs/adr/0117: a single frequency approach is a procedure between AP and
//    PAR, JO 7610.14A para 7-1-5), CENTER's CTR and TACTICAL's TAC_C2/AIC/GCI/JTAC are the guide's. [SOURCE-DEFINED]
//    (docs/adr/0074, 0075): the CARRIER Facility (CV_MARSHAL, CV_PRIFLY, CV_APP1, CV_APP2) and INCIRLIK's RSU
//    and PAR where the guide is silent on the Facility's own set. JTAC is read-only (guide §4.1: "MISSION
//    (read-only)"), enforced by authority/ never granting it ownership or Mutation rights, not by anything here.
//  positionClasses: every Position's doctrinal class (guide §4.1's Class column), which authority/classes.js reads
//    (through getPositionClass) so the cross-Facility coordination primitives and TOFI are gated by class, not by a hand-kept id list
//    (docs/adr/0020). Every Position needs one. RSU and PAR are MILITARY_ATC too: RSU's advisory role with no separation authority (guide §4.1) is a permission matter, never a new class, because a new class would silently drop
//    Conflict Alert (position-coverage.js's ATC_CLASSES, the inclusion-list trap of docs/adr/0041).
//    CARRIER's four Positions are all MILITARY_ATC for the same reason ("Military ATC afloat"); PriFly's
//    "supervisory, not radar control" is a permission matter too. [SOURCE-DEFINED] (docs/adr/0074) where the
//    guide is silent.
//  positionLetters: the one character an ATC scope draws on a contact this Position owns (docs/adr/0088, the
//    STARS "position symbol"). [SOURCE-DEFINED] (docs/adr/0088): the letters are ours; one A-Z or 0-9 each.
//    The whole tactical side shares `M`, shown on a flight under tactical control after TOFI (H48).
//  consolidation: who is OFFERED the hat of an unstaffed Position, in order: `{ CD: ['GC', 'LC', 'AP'] }` reads "when
//    CD is unstaffed, the first of GC, LC, AP that is staffed is offered CD" (docs/adr/0110; JO 7210.3 para 2-2-3,
//    2-6-5: one controller signed on and responsible for each open position, consolidated ones included). Nothing moves:
//    an unstaffed Position's Strips stay its own, and taking the hat is an ordinary sign-on (a combination, docs/adr/0105).
//    A list is read off the file, never walked: CV_APP1 and CV_APP2 name each other. Each list is non-empty, names
//    Positions of this Facility, not the Position itself, no repeats. Guide §4.8.6 rule 2's default chain is not
//    followed: the order is the squadron's (docs/parallel/decisions.md H111: AP last on every tower list; the carrier's
//    Marshal first, then the lanes, then PriFly; the other lane takes a lane's Position). [SOURCE-DEFINED] (docs/adr/0013)
//    there is no AP to CTR (nor TAC_C2 to CTR): consolidation is INTRAFACILITY, never crossing a Facility. OPS and AP have
//    no list (OPS is not a control position, guide §4.1 rule 3); CENTER's CTR and RANGES have none; so a sign-off there
//    warns `offeredTo: null` (guide §4.8.6 rule 3, defect D19: warn, do not block). A Position with NO list is also one an
//    unstaffed hand-off is refused at (NO_RECEIVING_POSITION): removing GC's line restores ADR 0105's behaviour for GC.
//  handBack: the TACTICAL reassignment, one hop: `{ AIC: 'TAC_C2' }` reads "AIC's Strips are handed back to TAC_C2 when AIC
//    is unstaffed and TAC_C2 is staffed" (docs/adr/0080 F10: a line TAC_C2 delegated goes back, and returns when AIC
//    is staffed again). TAC_C2 can work every MISSION state, which is why this one keeps moving Strips (docs/adr/0110
//    decision 7). Keeps the loop check; a Position is in `consolidation` or `handBack`, never both.
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
//    pattern (the airport radar), PAR the precision approach radar alone
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
//    centre", guide §9.13). One Rack per runway end in `lc-runway-queue` (guide §4.2); one Rack per SFA
//    frequency in AP's `ap-sfa` (docs/adr/0117); a pattern leg is a Rack (docs/adr/0064). The strip state a Bay
//    implies is the guide's §3.5 rule 4 / §2 "Bay membership expresses operational state"; the Bay a Strip
//    sits in for another strip type's state never lands on a `holdsStripType` Bay (docs/adr/0087). The
//    descriptor flags `view`, `replacesRacks`, `capacity` are docs/adr/0093 (a Bay's component and the
//    PAR Final Bay's one Strip at a time, guide §7.10). The strip state `FINAL` (LC's Bay) is unrelated to the
//    strip type `FINAL` (guide §7.10's PAR and carrier type): see nla.js's module comment.
//    `app-overflight` and `ctr-overflight` hold OVERFLIGHT Strips whatever their state (docs/adr/0023, 0087).
//  singleFrequencyApproach (optional): docs/adr/0117 (superseding 0075's and 0093's SFA parts). `jurisdiction` is the
//    radar approach controller (AP), who "retains jurisdiction over the rotation of three frequencies between himself
//    and the GCA controller" (JO 7610.14A para 7-1-5 c); `pool` is at least five discrete UHF frequencies (para 7-1-5 b),
//    each `{ rackId, mhz, use }`, `use` one of ROTATION (exactly three), INITIAL_CONTACT, SPARE. The pool's rackIds ARE
//    the Racks of the one `sfa-freqs` Bay, which is the jurisdiction Position's. Which three rotate and what the others
//    are for is the letter of agreement's (para 7-1-5 d): ours (H134 LT-RQ5 a) is the first AP's initial-contact
//    frequency, the last a spare. [SOURCE-DEFINED]: the frequencies are placeholders, "squadron data to verify". Read
//    once at start-up, never written by code (P5). Who is on a rotating frequency is not stored: it follows the flight
//    on it (PAR while PAR holds that flight's Strip, else AP; sfa.js).
//  positionFrequencies (optional): docs/adr/0105, H104 GCLC-4. `{ <Position>: [ { label, mhz } ] }`, the frequencies a
//    Position works, checked by validatePositionFrequencies (mhz by airspace-schema's isValidFrequency). A controller who
//    holds two Positions has both. [SOURCE-DEFINED]: the shipped Incirlik values are placeholders, squadron data to
//    confirm. Read once at start-up, never written by code (P5).
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

//  modeCIntruder (optional): docs/adr/0118 (H136 VQ7 a). The Mode C Intruder base altitude and the Positions MCI is
//    inhibited at. `baseAltitudeFt` with `reference` AGL (a terminal Facility, JO 7210.3EE para 12-6-12 b: ground to 500
//    ft AGL) or MSL (an en route Facility, para 8-2-5 b: ground to 5,000 ft MSL); `highTerrainAglFt` (MSL only) is para
//    8-2-5 b's "1,500 AGL" where the ground is above the MSL base, applied only where terrain is known; `inhibitedPositions`
//    is para 12-6-12 d / 8-2-5 c.3. Absent: 500 ft AGL, nothing inhibited (MCI_DEFAULT). Read once at start-up (P5).
//  parApproaches (optional): the PAR approach to each runway end (docs/adr/0112): threshold, final approach course
//    (true), TDZE (null: the DCS airfield elevation), TCH, decision height and the published glidepath angle (null:
//    none, the controller's default applies, H116). Shape checked by surveillance/par.js's validateParApproaches.
//    [SOURCE-DEFINED] until someone copies the plate. Read once at start-up, never written by code (P5).

// Keys every facility file must carry (a shipped file is complete: nothing is merged in from the code).
// `singleFrequencyApproach`, `runwayStatus`, `positionFrequencies` and `parApproaches` are optional: a Facility without those Bays has none.
// `modeCIntruder` is optional too: without it the terminal default applies (MCI_DEFAULT, docs/adr/0118).
const REQUIRED_KEYS = Object.freeze({
  facility: 'string', positions: 'array', positionClasses: 'object', positionLetters: 'object', consolidation: 'object', handBack: 'object',
  positionRadars: 'object', hiddenBlocks: 'object', bays: 'object', dataOnly: 'boolean', standingReleases: 'array', aitAuthorized: 'boolean',
});

/**
 * A complete facility file: every required key present with the right type, then validateConfig's checks,
 * then the cross-references. Bays point to Racks they name themselves (non-empty, no repeats), a bayId is
 * unique in the Facility, `holdsStripType` names a strip type the Block Map knows, every Position has a class, and the
 * consolidation lists and handBack join Positions of this Facility (handBack has no loop).
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
  for (const [from, list] of Object.entries(candidate.consolidation)) {
    if (!positions.has(from)) return fail(`consolidation names unknown Position ${from}`);
    if (!Array.isArray(list)) {
      return fail(`consolidation.${from} must be a list of Positions offered the hat, in order (docs/adr/0110), e.g. ${JSON.stringify([list])}; a one-hop move of Strips is handBack`);
    }
    if (!list.length) return fail(`consolidation.${from} must not be empty (leave ${from} out instead)`);
    const seen = new Set();
    for (const to of list) {
      if (!positions.has(to)) return fail(`consolidation.${from} names unknown Position ${to}`);
      if (to === from) return fail(`consolidation.${from} names itself`);
      if (seen.has(to)) return fail(`consolidation.${from} names ${to} twice`);
      seen.add(to);
    }
    if (Object.prototype.hasOwnProperty.call(candidate.handBack, from)) return fail(`${from} is in both consolidation and handBack`);
  }
  for (const [from, to] of Object.entries(candidate.handBack)) {
    if (!positions.has(from)) return fail(`handBack names unknown Position ${from}`);
    if (typeof to !== 'string' || !positions.has(to)) return fail(`handBack.${from} names unknown Position ${to}`);
  }
  for (const start of Object.keys(candidate.handBack)) {
    const seen = new Set([start]);
    for (let at = candidate.handBack[start]; at !== undefined; at = candidate.handBack[at]) {
      if (seen.has(at)) return fail(`handBack loops back to ${at}`);
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

module.exports = { validateConfig, validateFacilityConfig, validateRadarSelector, BAY_VIEWS, SFA_USES, REQUIRED_KEYS, MCI_DEFAULT };
