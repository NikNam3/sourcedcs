'use strict';

// §10.5's provenance fallback chains for the three times a Strip carries more
// than one source for (docs/adr/0073).
//
// The guide: "Where a time or value has multiple possible sources, implement
// an explicit ordered fallback and record which source was used ... Apply the
// same shape to departure time, off-block time and takeoff time. The chosen
// source MUST be visible on hover." The shape is ATD-2's UOBT: the first
// source in a fixed order that has a value wins.
//
// Computed at READ, never stored. The inputs are stored (the controller's
// field, the filed DD-1801's departure time in fdr.timeInputs, the ATO's in
// fdr.ato); the answer is a pure function of them, so "which source was used"
// is recorded by being deterministic from recorded inputs, and no writer has
// to remember to recompute anything. Above all, a stored actual-time field
// (assigned.taxiTimeUtc, assigned.takeoffTimeUtc) never holds an estimate a
// later reader could mistake for an actual.
//
// An estimate is always ANOTHER source's value, never arithmetic on one: no
// taxi or climb-out duration is added anywhere (defect D11, invented doctrine).
//
// Two byte-identical copies: crc-sync/src/efsp/time-chains.js and
// crc-desktop/app/public/js/panels/efsp/time-chains.js — the two packages
// never share code (docs/adr/0001). crc-sync/tests/fixtures/time-chains.json
// holds both to the same answers, and the parity tests hold the files equal.
// No requires, no clock: nothing here is a time of its own. In the browser
// this is a classic script, so its top-level names are globals.

// [SOURCE-DEFINED] order (docs/adr/0073), ATD-2's shape per guide §10.5.
// A controller's entry always wins and stops the fallback (§10.2 rule 3);
// clearing it resumes the chain. Departure: the pilot's own filing is the
// later and more specific document than the tasking (Q-L16-6).
const TIME_CHAINS = {
  departure: { blockId: '6',  path: 'filed.proposedDepartureTimeUtc', sources: ['CONTROLLER', 'FLIGHT_PLAN', 'ATO'] },
  offBlock:  { blockId: '17', path: 'assigned.taxiTimeUtc',           sources: ['CONTROLLER', 'EST_DEPARTURE'] },
  takeoff:   { blockId: '18', path: 'assigned.takeoffTimeUtc',        sources: ['CONTROLLER', 'STATE_CHANGE', 'EST_OFF_BLOCK'] },
};

// STATE_CHANGE is the takeoff chain's observed source (docs/adr/0076, Q-L16-3):
// the mission-clock time a DEPARTURE Strip entered DEPARTED, stamped by
// board-store.js into fdr.timeInputs.takeoffStampedUtc. It is an actual, so it
// is never `estimated`, and it sits below CONTROLLER so a typed time still wins.

// Which chain an EST_* source reads.
const ESTIMATE_SOURCES = { EST_DEPARTURE: 'departure', EST_OFF_BLOCK: 'offBlock' };

function _timeChainEpoch(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function _timeChainRead(fdr, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), fdr);
}

/** The value one source gives for a chain, or null. `via` is the upstream chain's source, for an EST_*. */
function _timeChainSourceValue(source, chain, fdr) {
  if (!fdr) return { valueUtc: null, via: null };
  if (source === 'CONTROLLER') return { valueUtc: _timeChainEpoch(_timeChainRead(fdr, chain.path)), via: null };
  if (source === 'FLIGHT_PLAN') return { valueUtc: _timeChainEpoch(fdr.timeInputs && fdr.timeInputs.flightPlanDepartureUtc), via: null };
  if (source === 'STATE_CHANGE') return { valueUtc: _timeChainEpoch(fdr.timeInputs && fdr.timeInputs.takeoffStampedUtc), via: null };
  if (source === 'ATO') return { valueUtc: _timeChainEpoch(fdr.ato && fdr.ato.departure && fdr.ato.departure.timeUtc), via: null };
  if (ESTIMATE_SOURCES[source]) {
    const upstream = resolveTimeChain(ESTIMATE_SOURCES[source], fdr);
    return { valueUtc: upstream.valueUtc, via: upstream.source };
  }
  return { valueUtc: null, via: null };
}

/**
 * The answer to one chain for one flight.
 *
 * @param {'departure'|'offBlock'|'takeoff'} name
 * @param {object|null} fdr — may be null, and may predate fdr.timeInputs or fdr.ato
 * @returns {{ valueUtc: number|null, source: string|null, via: string|null, estimated: boolean,
 *   candidates: Array<{ source: string, valueUtc: number|null, via: string|null }> }}
 *   `candidates` is every source in order with what it gives, so a reader can
 *   say what would apply next. Never throws.
 */
function resolveTimeChain(name, fdr) {
  const chain = TIME_CHAINS[name];
  const none = { valueUtc: null, source: null, via: null, estimated: false, candidates: [] };
  if (!chain) return none;
  const candidates = chain.sources.map((source) => ({ source, ..._timeChainSourceValue(source, chain, fdr) }));
  const chosen = candidates.find(c => c.valueUtc != null);
  if (!chosen) return { ...none, candidates };
  return {
    valueUtc: chosen.valueUtc,
    source: chosen.source,
    via: chosen.via,
    // A planning value standing in for an actual that has not happened yet.
    // Departure's own sources are all plans, so it is never "estimated".
    estimated: !!ESTIMATE_SOURCES[chosen.source],
    candidates,
  };
}

/** The chain name whose Block this is on a DEPARTURE Strip, or null. */
function timeChainForBlock(blockId) {
  return Object.keys(TIME_CHAINS).find(n => TIME_CHAINS[n].blockId === blockId) || null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TIME_CHAINS, ESTIMATE_SOURCES, resolveTimeChain, timeChainForBlock };
}
