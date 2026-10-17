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
// Who may edit: any controller Primary at a Position (the wire family's gate); every change is audited in the Mutation log
// (who, when on the mission clock, before -> after). Undo is setting it back; ResetFrequency returns a row to its default.
// Last write wins (no rev): two controllers editing one row see the second value, both in the log.
//
// The file is strict, like every state/ file that holds controller data (docs/adr/0095): invalid JSON, an unknown key, a
// Facility, Position, label or Rack the shipped files do not have, or a frequency these rules would refuse stops start-up
// naming the file. Nothing is migrated: correct or delete it.

const fs = require('fs');
const path = require('path');
const { SyncedStore } = require('./synced-store');
const { statePaths, ensureDirFor } = require('../state-paths');
const { isValidFrequency, MIN_FREQUENCY_MHZ, MAX_FREQUENCY_MHZ } = require('./airspace-schema');
const { SFA_MIN_MHZ, SFA_MAX_MHZ } = require('./facility-schema');
const { anyOf, mapOf, checkShape } = require('../persisted-shape');
const { WALL_CLOCK } = require('../mission-clock');
const log = require('../log').logger('efsp:frequency-table');

const FILE_NAME = 'efsp-frequencies.json';
const ENTRY = anyOf('mhz', 'setAt', 'setBy');
const FILE_SHAPE = { facilities: mapOf({ positions: mapOf(mapOf(ENTRY)), sfa: mapOf(ENTRY) }) };

const OP_KINDS = Object.freeze(['SetFrequency', 'ResetFrequency']);

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

class FrequencyTable extends SyncedStore {
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
    super({ clock, mutationLog });
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
    }
    this._overrides = data.facilities || {};
    this._applyAll();
    for (const facilityId of Object.keys(this._overrides)) {
      const dup = this._duplicateSfa(facilityId);
      if (dup) throw fail(`gives the ${facilityId} SFA pool ${dup} MHz twice`);
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
    this._facilityConfig.setFrequencyOverlay(facilityId, { positions, sfa });
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
   * One Facility's rows, in file order: `{ facilityId, kind: 'POSITION', positionId, label, mhz, defaultMhz, setAt, setBy }`
   * and `{ facilityId, kind: 'SFA', rackId, use, mhz, defaultMhz, setAt, setBy }` (`setAt`/`setBy` null on a default).
   */
  rowsFor(facilityId) {
    const o = this._overrides[facilityId] || {};
    const rows = [];
    for (const [positionId, list] of Object.entries(this._facilityConfig.getShippedPositionFrequencies(facilityId))) {
      for (const f of list) {
        const e = ((o.positions || {})[positionId] || {})[f.label] || null;
        rows.push({ facilityId, kind: 'POSITION', positionId, label: f.label, mhz: e ? e.mhz : f.mhz, defaultMhz: f.mhz, setAt: e ? e.setAt : null, setBy: e ? e.setBy : null });
      }
    }
    const sfa = this._facilityConfig.getShippedSingleFrequencyApproach(facilityId);
    for (const p of sfa ? sfa.pool : []) {
      const e = (o.sfa || {})[p.rackId] || null;
      rows.push({ facilityId, kind: 'SFA', rackId: p.rackId, use: p.use, mhz: e ? e.mhz : p.mhz, defaultMhz: p.mhz, setAt: e ? e.setAt : null, setBy: e ? e.setBy : null });
    }
    return rows;
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
    const subject = { facilityId, positionId: op.positionId, label: op.label, rackId: op.rackId };
    let before;
    const result = this._guarded('frequency op', log, () => {
      if (!OP_KINDS.includes(op.kind)) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown frequency op ${JSON.stringify(op.kind)} (one of ${OP_KINDS.join(', ')})` };
      if (!this._facilityConfig.getFacilityIds().includes(facilityId)) return { ok: false, reason: 'VALIDATION_ERROR', detail: `unknown facilityId ${facilityId}` };
      const isSfa = op.rackId !== undefined;
      const shipped = isSfa ? this._shippedSfa(facilityId, op.rackId) : this._shippedPosition(facilityId, op.positionId, op.label);
      if (!shipped) {
        return { ok: false, reason: 'NOT_FOUND', detail: isSfa ? `${facilityId} has no SFA Rack ${op.rackId}` : `${facilityId} ${op.positionId} has no frequency labelled ${op.label}` };
      }
      const current = this._current(facilityId, op);
      before = current;
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
      this._write(facilityId, op, mhz === shipped.mhz ? null : { mhz, setAt: this._clock.now(), setBy: by || null });
      this._sync.advance();
      this._apply(facilityId);
      this._persist();
      return { ok: true, changed: true, row: this._row(facilityId, op) };
    });
    this._writeAudit({ ...mutation, op }, { subject, actingPositionId, by, result, before, after: () => this._current(facilityId, op) });
    return result;
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
    return this.rowsFor(facilityId).find(r => (op.rackId !== undefined ? r.rackId === op.rackId : r.positionId === op.positionId && r.label === op.label)) || null;
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

module.exports = { FrequencyTable, OP_KINDS, channelProblem, positionFrequencyProblem, sfaFrequencyProblem, FILE_NAME };
