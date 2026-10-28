'use strict';

// The runtime frequency table (docs/adr/0131, decisions.md H154): the station frequencies the controllers set at run time,
// over the shipped defaults in the facility files (`positionFrequencies`, docs/adr/0105, and the single frequency approach
// pool, `singleFrequencyApproach.pool`, docs/adr/0117). The facility files stay read-only (P5); what a controller sets
// lives in state/efsp-frequencies.json, written by this module alone, and only the frequencies that differ from the
// default are kept there (setting a frequency back to its default removes the entry).
//
// Every consumer reads the effective value through facility-config.js (getPositionFrequencies, getSingleFrequencyApproach,
// getAllBays' `sfaPool`), which holds this table's values as its frequency overlay: the PositionStore's frequencies (the
// positions frames, the combination's "Monitor" list), the SFA Bay's pool (the Racks, sfa.js's rack <-> frequency lookup,
// the client's rotation rows). A change reaches every client at once (wire/families/frequency.js).
//
// An assignment is not rewritten: a flight already given a frequency keeps it (it is a clearance fact on its flight data,
// Block 22); the table changes only what is offered from now on. So an SFA frequency with a flight on it cannot be
// changed (FREQUENCY_IN_USE): the Rack IS that frequency (sfa.js), and a flight on it would otherwise sit on a Rack that
// no longer says its frequency.
//
// Rows are added and removed at run time too (docs/adr/0138, H156 FQ-Q3 b): AddFrequency gives a Position another
// frequency or the SFA pool another (SPARE) frequency and Rack; RemoveFrequency takes away only such an added row. A
// shipped row is never removed, only reset to its default (removing a shipped Position's frequency could leave a Position
// with none). An added SFA frequency with a flight on it is not removed (FREQUENCY_IN_USE, as for a change).
//
// Who may edit: a controller Primary at a Position of the Facility whose frequencies they are (docs/adr/0138, H156 FQ-Q2 b;
// the wire family's gate checks Primary, this table the Facility of the one acting Position, ADR 0132 §3:
// FACILITY_MISMATCH). Every change is audited in the Mutation log (who, when on the mission clock, before -> after). Undo
// is setting it back; ResetFrequency returns a row to its default. Last write wins (no rev): two controllers editing one
// row see the second value, both in the log.
//
// The file is strict, like every state/ file that holds controller data (docs/adr/0095): invalid JSON, an unknown key, a
// Facility, Position, label or Rack the shipped files do not have, or a frequency these rules would refuse stops start-up
// naming the file. Nothing is migrated: correct or delete it.

const fs = require('fs');
const path = require('path');
const { internalError, partialAuditTail } = require('./store-throw');
const { statePaths, ensureDirFor } = require('../state-paths');
const { isValidFrequency, MIN_FREQUENCY_MHZ, MAX_FREQUENCY_MHZ } = require('./airspace-schema');
const { SFA_MIN_MHZ, SFA_MAX_MHZ } = require('./facility-schema');
const { anyOf, mapOf, checkShape } = require('../persisted-shape');
const { WALL_CLOCK } = require('../mission-clock');
const log = require('../log').logger('efsp:frequency-table');

const FILE_NAME = 'efsp-frequencies.json';
const ENTRY = anyOf('mhz', 'setAt', 'setBy');
// `added` holds the run-time rows (docs/adr/0138): a Position's added frequencies by label, the SFA pool's added Racks.
const FILE_SHAPE = { facilities: mapOf({ positions: mapOf(mapOf(ENTRY)), sfa: mapOf(ENTRY), added: { positions: mapOf(mapOf(ENTRY)), sfa: mapOf(ENTRY) } }) };

const OP_KINDS = Object.freeze(['SetFrequency', 'ResetFrequency', 'AddFrequency', 'RemoveFrequency']);

// What an added SFA frequency is for: a spare. The pool rotates exactly three (JO 7610.14A para 7-1-5 c) and the
// initial-contact frequency is the shipped one (docs/adr/0117 decision 2), so an added one is neither (docs/adr/0138).
const ADDED_SFA_USE = 'SPARE';
// An added SFA Rack's id: the shipped pool's naming, the next free number (docs/adr/0138).
const SFA_RACK_PREFIX = 'freq-';
// facility-schema.js validatePositionFrequencies' label rule.
const LABEL_MAX = 12;

/** Null when `label` may name a Position frequency (facility-schema.js's rule: 1 to 12 characters, not blank), else why not. */
function labelProblem(label) {
  if (typeof label !== 'string' || !label.trim() || label !== label.trim() || label.length > LABEL_MAX) return `a frequency label is 1 to ${LABEL_MAX} characters`;
  return null;
}

/** Whether `row` (rowsFor's) is the one `op` names. An AddFrequency of an SFA frequency names it by its frequency. */
function rowMatchesOp(row, op) {
  if (!row || !op) return false;
  if (op.kind === 'AddFrequency' && op.sfa === true) return row.kind === 'SFA' && row.mhz === op.mhz;
  if (op.rackId !== undefined) return row.kind === 'SFA' && row.rackId === op.rackId;
  return row.kind === 'POSITION' && row.positionId === op.positionId && row.label === op.label;
}

// The VHF aeronautical band, where 8.33 kHz channels exist. [OURS] from the 8.33 kHz channel naming: within each 25 kHz
// block the channel names end .x00, .x05, .x10, .x15 (the fifth, .x20, is not a channel name). Elsewhere (VHF FM, UHF) a
// frequency is on the 25 kHz grid, which every shipped value and the DCS radios we use keep. SRS itself tunes any value.
const VHF_AIRBAND_MIN_MHZ = 118;
const VHF_AIRBAND_MAX_MHZ = 137;

/** Null when `mhz` is on a channel, else why not. */
function channelProblem(mhz) {
  const khz = Math.round(mhz * 1000);
  if (Math.abs(mhz * 1000 - khz) > 1e-6) return `${mhz} is not a whole kHz`;
  const offset = khz % 25;
  if (mhz >= VHF_AIRBAND_MIN_MHZ && mhz < VHF_AIRBAND_MAX_MHZ) {
    return [0, 5, 10, 15].includes(offset) ? null : `${mhz.toFixed(3)} is not a 25 or 8.33 kHz channel`;
  }
  return offset === 0 ? null : `${mhz.toFixed(3)} is not on the 25 kHz grid`;
}

/** Null when `mhz` may be a Position's frequency (docs/adr/0105's range, a channel), else the problem. */
function positionFrequencyProblem(mhz) {
  if (!isValidFrequency(mhz)) return `a frequency is a number from ${MIN_FREQUENCY_MHZ} to ${MAX_FREQUENCY_MHZ} MHz`;
  return channelProblem(mhz);
}

/** Null when `mhz` may be an SFA pool frequency (UHF, docs/adr/0117, a channel), else the problem. */
function sfaFrequencyProblem(mhz) {
  if (typeof mhz !== 'number' || !Number.isFinite(mhz) || mhz < SFA_MIN_MHZ || mhz > SFA_MAX_MHZ) {
    return `an SFA frequency is UHF, ${SFA_MIN_MHZ} to ${SFA_MAX_MHZ} MHz`;
  }
  return channelProblem(mhz);
}

// Not a SyncedStore: it has no seq and no epoch (the delta is whole, ADR 0131 §6), and an epoch nobody reads would still
// draw a crypto.randomUUID() and move every later id in the seeded soak and freeze hosts (sync/sync-log.js).
class FrequencyTable {
  /**
   * @param {object} deps
   * @param {object} deps.facilityConfig facility-config.js's instance: the shipped defaults, and the overlay this table sets
   * @param {{read:string, write:string}} [deps.paths] the state file (default state/efsp-frequencies.json, CRCSYNC_EFSP_FREQUENCIES_PATH)
   * @param {(facilityId:string, mhz:number) => boolean} [deps.inUse] whether a live Strip of the Facility has a flight on `mhz`
   * @param {{now:()=>number}} [deps.clock] the mission clock (docs/adr/0079): `setAt` and the audit's `at`
   * @param {{now:()=>number}} [deps.wallClock] the file's write stamp
   * @param {object|null} [deps.mutationLog]
   */
  constructor({ facilityConfig, paths, env = process.env, inUse = () => false, clock = WALL_CLOCK, wallClock = WALL_CLOCK, mutationLog = null } = {}) {
    this._clock = clock;
    this._mutationLog = mutationLog;
    this._facilityConfig = facilityConfig;
    this._paths = paths || statePaths(FILE_NAME, env.CRCSYNC_EFSP_FREQUENCIES_PATH, env);
    this._inUse = inUse;
    this._wallClock = wallClock;
    this._overrides = {}; // facilityId -> { positions: { <Position>: { <label>: entry } }, sfa: { <rackId>: entry } }
    this._load();
  }

  // ── the defaults ──────────────────────────────────────────────────────────────────────────────────────────────

  _shippedPosition(facilityId, positionId, label) {
    const list = this._facilityConfig.getShippedPositionFrequencies(facilityId)[positionId] || [];
    return list.find(f => f.label === label) || null;
  }

  _shippedSfa(facilityId, rackId) {
    const sfa = this._facilityConfig.getShippedSingleFrequencyApproach(facilityId);
    return sfa ? sfa.pool.find(p => p.rackId === rackId) || null : null;
  }

  // ── load, persist ─────────────────────────────────────────────────────────────────────────────────────────────

  _load() {
    const file = this._paths.read;
    if (!fs.existsSync(file)) { this._applyAll(); return; }
    const fail = (why) => new Error(`[efsp] the frequency table ${file} ${why}: correct it or delete it to use the facility files' frequencies (docs/adr/0131)`);
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw fail(`is not valid JSON (${e.message})`); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail('is not an object');
    checkShape({ facilities: data.facilities }, FILE_SHAPE, {
      unknownKey: (at) => fail(`has an unknown key "${at}"`),
      arrayWhereObject: (at) => fail(`holds an array at "${at}"`),
    });
    const stray = Object.keys(data).find(k => k !== 'facilities' && k !== 'persistedWallAt');
    if (stray) throw fail(`has an unknown key "${stray}"`);
    const facilityIds = this._facilityConfig.getFacilityIds();
    for (const [facilityId, f] of Object.entries(data.facilities || {})) {
      if (!facilityIds.includes(facilityId)) throw fail(`names Facility ${facilityId}, which this server does not have`);
      for (const [positionId, labels] of Object.entries(f.positions || {})) {
        for (const [label, entry] of Object.entries(labels)) {
          if (!this._shippedPosition(facilityId, positionId, label)) throw fail(`sets ${facilityId} ${positionId} ${label}, which the facility file does not have`);
          const problem = positionFrequencyProblem(entry.mhz);
          if (problem) throw fail(`sets ${facilityId} ${positionId} ${label}: ${problem}`);
        }
      }
      for (const [rackId, entry] of Object.entries(f.sfa || {})) {
        if (!this._shippedSfa(facilityId, rackId)) throw fail(`sets SFA Rack ${facilityId} ${rackId}, which the facility file's pool does not have`);
        const problem = sfaFrequencyProblem(entry.mhz);
        if (problem) throw fail(`sets SFA Rack ${facilityId} ${rackId}: ${problem}`);
      }
      this._checkAdded(facilityId, f.added || {}, fail);
    }
    this._overrides = data.facilities || {};
    this._applyAll();
    for (const facilityId of Object.keys(this._overrides)) {
      const dup = this._duplicateSfa(facilityId);
      if (dup) throw fail(`gives the ${facilityId} SFA pool ${dup} MHz twice`);
    }
  }

  /** The strict check of one Facility's added rows (docs/adr/0138): a real Position, a new label, a new Rack, valid values. */
  _checkAdded(facilityId, added, fail) {
    const positionSet = this._facilityConfig.getPositionSet(facilityId);
    for (const [positionId, labels] of Object.entries(added.positions || {})) {
      if (!positionSet.includes(positionId)) throw fail(`adds a frequency to ${facilityId} ${positionId}, which is not a Position of ${facilityId}`);
      for (const [label, entry] of Object.entries(labels)) {
        const problem = labelProblem(label) || (this._shippedPosition(facilityId, positionId, label) ? `the facility file already has ${label}` : null) || positionFrequencyProblem(entry.mhz);
        if (problem) throw fail(`adds ${facilityId} ${positionId} ${label}: ${problem}`);
      }
    }
    const rackIds = Object.keys(added.sfa || {});
    if (rackIds.length && !this._facilityConfig.getShippedSingleFrequencyApproach(facilityId)) throw fail(`adds SFA frequencies to ${facilityId}, which has no single frequency approach`);
    for (const rackId of rackIds) {
      const problem = (this._shippedSfa(facilityId, rackId) ? 'the facility file already has that Rack' : null) || sfaFrequencyProblem(added.sfa[rackId].mhz);
      if (problem) throw fail(`adds SFA Rack ${facilityId} ${rackId}: ${problem}`);
    }
  }

  _persist() {
    const target = this._paths.write;
    const body = JSON.stringify({ facilities: this._overrides, persistedWallAt: this._wallClock.now() }, null, 2);
    ensureDirFor(target);
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, target);
  }

  /** The overlay facility-config.js reads, for every Facility. */
  _applyAll() {
    for (const facilityId of this._facilityConfig.getFacilityIds()) this._apply(facilityId);
  }

  _apply(facilityId) {
    const o = this._overrides[facilityId] || {};
    const positions = {};
    for (const [positionId, labels] of Object.entries(o.positions || {})) {
      positions[positionId] = Object.fromEntries(Object.entries(labels).map(([label, e]) => [label, e.mhz]));
    }
    const sfa = Object.fromEntries(Object.entries(o.sfa || {}).map(([rackId, e]) => [rackId, e.mhz]));
    const a = o.added || {};
    const added = {
      positions: Object.fromEntries(Object.entries(a.positions || {}).map(([positionId, labels]) => [positionId, Object.entries(labels).map(([label, e]) => ({ label, mhz: e.mhz }))])),
      sfa: Object.entries(a.sfa || {}).map(([rackId, e]) => ({ rackId, mhz: e.mhz, use: ADDED_SFA_USE })),
    };
    this._facilityConfig.setFrequencyOverlay(facilityId, { positions, sfa, added });
  }

  _duplicateSfa(facilityId) {
    const sfa = this._facilityConfig.getSingleFrequencyApproach(facilityId);
    if (!sfa) return null;
    const seen = new Set();
    for (const p of sfa.pool) { if (seen.has(p.mhz)) return p.mhz; seen.add(p.mhz); }
    return null;
  }

  // ── read ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * One Facility's rows, in file order, each Position's added rows after its shipped ones and the pool's added Racks last:
   * `{ facilityId, kind: 'POSITION', positionId, label, mhz, defaultMhz, added, setAt, setBy }` and
   * `{ facilityId, kind: 'SFA', rackId, use, mhz, defaultMhz, added, setAt, setBy }` (`setAt`/`setBy` null on a default;
   * an added row has `added: true` and no default, `defaultMhz: null`, docs/adr/0138).
   */
  rowsFor(facilityId) {
    const rows = [];
    const shippedPositions = this._facilityConfig.getShippedPositionFrequencies(facilityId);
    for (const [positionId, list] of Object.entries(this._facilityConfig.getPositionFrequencies(facilityId))) {
      for (const f of list) {
        const def = (shippedPositions[positionId] || []).find(x => x.label === f.label) || null;
        const e = this._entry(facilityId, { positionId, label: f.label }, !def);
        rows.push({ facilityId, kind: 'POSITION', positionId, label: f.label, mhz: f.mhz, defaultMhz: def ? def.mhz : null, added: !def, setAt: e ? e.setAt : null, setBy: e ? e.setBy : null });
      }
    }
    const sfa = this._facilityConfig.getSingleFrequencyApproach(facilityId);
    for (const p of sfa ? sfa.pool : []) {
      const def = this._shippedSfa(facilityId, p.rackId);
      const e = this._entry(facilityId, { rackId: p.rackId }, !def);
      rows.push({ facilityId, kind: 'SFA', rackId: p.rackId, use: p.use, mhz: p.mhz, defaultMhz: def ? def.mhz : null, added: !def, setAt: e ? e.setAt : null, setBy: e ? e.setBy : null });
    }
    return rows;
  }

  /** The stored entry of a row (`{ mhz, setAt, setBy }`): an override of a shipped row, or an added row; null when none. */
  _entry(facilityId, { positionId, label, rackId }, added) {
    const o = this._overrides[facilityId] || {};
    const at = added ? (o.added || {}) : o;
    if (rackId !== undefined) return (at.sfa || {})[rackId] || null;
    return ((at.positions || {})[positionId] || {})[label] || null;
  }

  /** Every Facility's rows (the snapshot's `frequencies`). */
  getAll() {
    return this._facilityConfig.getFacilityIds().flatMap(id => this.rowsFor(id));
  }

  // ── write ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * One op: `SetFrequency { positionId, label, mhz }` or `{ rackId, mhz }`, `ResetFrequency { positionId, label }` or
   * `{ rackId }`. @returns {{ok:true, row, changed:boolean}|{ok:false, reason, detail}}
   */
  apply(mutation, actingPositionId, by) {
    const op = mutation.op && typeof mutation.op === 'object' ? mutation.op : {};
    const facilityId = mutation.facilityId;
    let before;
    let wrote = false;
    let result;
    try {
      result = this._applyOp(op, facilityId, actingPositionId, by, (b) => { before = b; }, () => { wrote = true; });
    } catch (err) {
      log.error('unexpected error applying frequency op — rejecting it instead of crashing', { err });
      result = internalError('frequency op', err, wrote);
    }
    // An added SFA Rack is named by the table, so the audit takes its id from the row.
    const rackId = op.rackId !== undefined ? op.rackId : (result.row && result.row.kind === 'SFA' ? result.row.rackId : undefined);
    const subject = { facilityId, positionId: op.positionId, label: op.label, rackId };
    const after = () => (op.kind === 'RemoveFrequency' ? null : this._current(facilityId, { ...op, rackId }));
    this._audit({ ...mutation, op }, { subject, actingPositionId, by, result, before, after });
    return result;
  }

  /** The Facility of a Position (its ids are unique across Facilities, docs/adr/0132 §1), or null. */
  _facilityOfPosition(positionId) {
    return this._facilityConfig.getFacilityIds().find(f => this._facilityConfig.getPositionSet(f).includes(positionId)) || null;
  }

  /** The op itself; `setBefore` takes the value it found, `markWrote` is called before the first write. */
  _applyOp(op, facilityId, actingPositionId, by, setBefore, markWrote) {
    if (!OP_KINDS.includes(op.kind)) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown frequency op ${JSON.stringify(op.kind)} (one of ${OP_KINDS.join(', ')})` };
    if (!this._facilityConfig.getFacilityIds().includes(facilityId)) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown facilityId ${facilityId}` };
    // Only the acting Position's own Facility (docs/adr/0138, H156 FQ-Q2 b).
    const home = this._facilityOfPosition(actingPositionId);
    if (home !== facilityId) {
      return { ok: false, reason: 'FACILITY_MISMATCH', detail: `${actingPositionId} is ${home ? `a Position of ${home}` : 'no Position'}, not of ${facilityId}: set ${facilityId}'s frequencies from one of its Positions` };
    }
    if (op.kind === 'AddFrequency') return this._add(op, facilityId, by, setBefore, markWrote);
    const isSfa = op.rackId !== undefined;
    const shipped = isSfa ? this._shippedSfa(facilityId, op.rackId) : this._shippedPosition(facilityId, op.positionId, op.label);
    const added = shipped ? null : this._entry(facilityId, op, true);
    if (!shipped && !added) {
      return { ok: false, reason: 'NOT_FOUND', detail: isSfa ? `${facilityId} has no SFA Rack ${op.rackId}` : `${facilityId} ${op.positionId} has no frequency labelled ${op.label}` };
    }
    const current = this._current(facilityId, op);
    setBefore(current);
    if (op.kind === 'RemoveFrequency') {
      if (shipped) return { ok: false, reason: 'VALIDATION_ERROR', detail: 'a frequency from the facility file is reset to its default, not removed' };
      if (isSfa && this._inUse(facilityId, current)) {
        return { ok: false, reason: 'FREQUENCY_IN_USE', detail: `a flight is on ${current.toFixed(3)}: hand it off or move it before removing this SFA frequency` };
      }
      markWrote();
      this._writeAdded(facilityId, op, null);
      this._apply(facilityId);
      this._persist();
      return { ok: true, changed: true, row: null };
    }
    if (op.kind === 'ResetFrequency' && !shipped) return { ok: false, reason: 'VALIDATION_ERROR', detail: 'an added frequency has no default: remove it instead' };
    const mhz = op.kind === 'ResetFrequency' ? shipped.mhz : op.mhz;
    const problem = isSfa ? sfaFrequencyProblem(mhz) : positionFrequencyProblem(mhz);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
    if (isSfa && mhz !== current) {
      const other = this._facilityConfig.getSingleFrequencyApproach(facilityId).pool.find(p => p.rackId !== op.rackId && p.mhz === mhz);
      if (other) return { ok: false, reason: 'VALIDATION_ERROR', detail: `${mhz.toFixed(3)} is already the SFA pool's ${other.rackId}` };
      if (this._inUse(facilityId, current)) {
        return { ok: false, reason: 'FREQUENCY_IN_USE', detail: `a flight is on ${current.toFixed(3)}: hand it off or move it before changing this SFA frequency` };
      }
    }
    if (mhz === current) return { ok: true, changed: false, row: this._row(facilityId, op) };
    markWrote();
    const entry = { mhz, setAt: this._clock.now(), setBy: by || null };
    if (shipped) this._write(facilityId, op, mhz === shipped.mhz ? null : entry);
    else this._writeAdded(facilityId, op, entry);
    this._apply(facilityId);
    this._persist();
    return { ok: true, changed: true, row: this._row(facilityId, op) };
  }

  /**
   * AddFrequency (docs/adr/0138): `{ positionId, label, mhz }` gives a Position of the Facility another frequency;
   * `{ sfa: true, mhz }` gives the Facility's SFA pool another frequency, a SPARE on a new Rack the table names.
   */
  _add(op, facilityId, by, setBefore, markWrote) {
    setBefore(null);
    const entry = { mhz: op.mhz, setAt: this._clock.now(), setBy: by || null };
    if (op.sfa === true) {
      const sfa = this._facilityConfig.getSingleFrequencyApproach(facilityId);
      if (!sfa) return { ok: false, reason: 'NOT_FOUND', detail: `${facilityId} has no single frequency approach` };
      const problem = sfaFrequencyProblem(op.mhz);
      if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
      const other = sfa.pool.find(p => p.mhz === op.mhz);
      if (other) return { ok: false, reason: 'VALIDATION_ERROR', detail: `${op.mhz.toFixed(3)} is already the SFA pool's ${other.rackId}` };
      const taken = new Set(sfa.pool.map(p => p.rackId));
      let n = sfa.pool.length + 1;
      while (taken.has(`${SFA_RACK_PREFIX}${n}`)) n++;
      const rackOp = { rackId: `${SFA_RACK_PREFIX}${n}` };
      markWrote();
      this._writeAdded(facilityId, rackOp, entry);
      this._apply(facilityId);
      this._persist();
      return { ok: true, changed: true, row: this._row(facilityId, rackOp) };
    }
    if (op.rackId !== undefined) return { ok: false, reason: 'VALIDATION_ERROR', detail: 'an SFA frequency is added with { sfa: true, mhz }: the table names its Rack' };
    if (!this._facilityConfig.getPositionSet(facilityId).includes(op.positionId)) return { ok: false, reason: 'NOT_FOUND', detail: `${op.positionId} is not a Position of ${facilityId}` };
    const problem = labelProblem(op.label) || positionFrequencyProblem(op.mhz);
    if (problem) return { ok: false, reason: 'VALIDATION_ERROR', detail: problem };
    if ((this._facilityConfig.getPositionFrequencies(facilityId)[op.positionId] || []).some(f => f.label === op.label)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${op.positionId} already has a frequency labelled ${op.label}` };
    }
    markWrote();
    this._writeAdded(facilityId, op, entry);
    this._apply(facilityId);
    this._persist();
    return { ok: true, changed: true, row: this._row(facilityId, op) };
  }

  /** One Mutation-log line, refusals included, in the shape the synced stores write (synced-store.js `_writeAudit`). */
  _audit(mutation, { subject, actingPositionId, by, result, before, after }) {
    if (!this._mutationLog) return;
    this._mutationLog.record({
      clientMutationId: mutation.clientMutationId,
      op: mutation.op.kind,
      ...subject,
      actingPositionId,
      actorId: by || null,
      at: this._clock.now(),
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      detail: result.ok ? undefined : result.detail,
      before,
      after: (result.ok || result.partial) ? after() : undefined,
      ...partialAuditTail(result),
    });
  }

  _current(facilityId, op) {
    if (op.rackId !== undefined) {
      const sfa = this._facilityConfig.getSingleFrequencyApproach(facilityId);
      const p = sfa && sfa.pool.find(e => e.rackId === op.rackId);
      return p ? p.mhz : null;
    }
    const f = (this._facilityConfig.getPositionFrequencies(facilityId)[op.positionId] || []).find(e => e.label === op.label);
    return f ? f.mhz : null;
  }

  _row(facilityId, op) {
    return this.rowsFor(facilityId).find(r => (op.rackId !== undefined ? r.rackId === op.rackId : r.kind === 'POSITION' && r.positionId === op.positionId && r.label === op.label)) || null;
  }

  /** Writes (or, with null, removes) one added row (docs/adr/0138), pruning what becomes empty. */
  _writeAdded(facilityId, op, entry) {
    const f = this._overrides[facilityId] || (this._overrides[facilityId] = {});
    const a = f.added || (f.added = {});
    if (op.rackId !== undefined) {
      a.sfa = a.sfa || {};
      if (entry) a.sfa[op.rackId] = entry; else delete a.sfa[op.rackId];
      if (!Object.keys(a.sfa).length) delete a.sfa;
    } else {
      a.positions = a.positions || {};
      const labels = a.positions[op.positionId] || (a.positions[op.positionId] = {});
      if (entry) labels[op.label] = entry; else delete labels[op.label];
      if (!Object.keys(labels).length) delete a.positions[op.positionId];
      if (!Object.keys(a.positions).length) delete a.positions;
    }
    if (!Object.keys(a).length) delete f.added;
    if (!Object.keys(f).length) delete this._overrides[facilityId];
  }

  /** Writes (or, with null, removes) one override, pruning what becomes empty. */
  _write(facilityId, op, entry) {
    const f = this._overrides[facilityId] || (this._overrides[facilityId] = {});
    if (op.rackId !== undefined) {
      f.sfa = f.sfa || {};
      if (entry) f.sfa[op.rackId] = entry; else delete f.sfa[op.rackId];
      if (!Object.keys(f.sfa).length) delete f.sfa;
    } else {
      f.positions = f.positions || {};
      const labels = f.positions[op.positionId] || (f.positions[op.positionId] = {});
      if (entry) labels[op.label] = entry; else delete labels[op.label];
      if (!Object.keys(labels).length) delete f.positions[op.positionId];
      if (!Object.keys(f.positions).length) delete f.positions;
    }
    if (!Object.keys(f).length) delete this._overrides[facilityId];
  }
}

module.exports = { FrequencyTable, OP_KINDS, channelProblem, positionFrequencyProblem, sfaFrequencyProblem, labelProblem, rowMatchesOp, FILE_NAME };
