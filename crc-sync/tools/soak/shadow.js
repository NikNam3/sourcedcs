'use strict';

// A per-client replica of the Board, applying messages exactly as the shipped
// client does (crc-desktop/app/public/js/panels/efsp/efsp-state.js):
//   - efsp-snapshot: clear and refill (applyEfspSnapshot, :73)
//   - efsp-board-delta: upsert `updated`, delete `gone`, take boardSeq (applyEfspDelta, :225)
//   - efsp-mutation-ack: upsert ack.strip on success AND on refusal (applyEfspMutationAck, :247)
// Kept per Facility (the shipped client keeps one Map; stripIds are UUIDs so
// the split changes nothing but lets resync be judged per Facility).
//
// Only the compared fields are stored (briefing §5.6). A DROPPED record that
// an ack re-inserts is kept (the client does too) but ignored by diff(): the
// panel never renders a DROPPED Strip.

const COMPARED = ['stripId', 'rev', 'state', 'ownerPositionId', 'bayId', 'rackId', 'orderKey', 'stripType', 'flightDataId'];

function compared(s) {
  const o = {};
  for (const k of COMPARED) o[k] = s[k] === undefined ? null : s[k];
  return o;
}

// The five sequenced stores outside the Board (docs/adr/0106), as `stores.js` STORE_SYNC declares them. A test
// (tests/soak-store-stale.test.mjs) keeps this table equal to the registry's.
const STORE_SYNC = [
  { key: 'airspaces', seqKey: 'airspaceSeq', epochKey: 'airspaceEpoch', gapFromDeltas: true },
  { key: 'correlations', seqKey: 'correlationSeq', epochKey: 'correlationEpoch', gapFromDeltas: false },
  { key: 'marsa', seqKey: 'marsaSeq', epochKey: 'marsaEpoch', gapFromDeltas: false },
  { key: 'runwayStatuses', seqKey: 'runwayStatusSeq', epochKey: 'runwayStatusEpoch', gapFromDeltas: true },
  { key: 'carriers', seqKey: 'carrierSeq', epochKey: 'carrierEpoch', gapFromDeltas: false },
];
const STORE_DELTA_TYPES = new Set(['efsp-airspace-delta', 'efsp-correlation-delta', 'efsp-marsa-delta', 'efsp-runway-status-delta', 'efsp-carrier-delta']);
// The shipped client asks for a slice after this many heartbeats in a row named a seq ahead of its own
// (crc-desktop sync-cursor.js heartbeatGaps); the soak's `store-stale` detector allows STORE_STALE_BEATS
// heartbeats behind, which a working resync never needs.
const BEATS_BEFORE_RESYNC = 2;
const STORE_STALE_BEATS = 6;

class Shadow {
  constructor(facilityIds) {
    this.facilityIds = facilityIds;
    this.strips = new Map(); // facilityId -> Map(stripId -> compared)
    this.boardSeq = new Map(); // facilityId -> number
    // facilityId -> the Board lifetime boardSeq belongs to (docs/adr/0081). Sent back on efsp-resync.
    this.boardEpoch = new Map();
    for (const f of facilityIds) { this.strips.set(f, new Map()); this.boardSeq.set(f, -1); }
    // Every stripId -> rev regression a delta tried to apply (a delta carrying an OLDER rev than the replica holds).
    this.regressions = 0;
    // The five synced stores' cursors (stores.js STORE_SYNC), the way sync-cursor.js keeps them: key -> { seq, epoch, behind }, plus the keys the
    // client would ask a slice for (`wantResync`) and those that have stayed behind past the bound (`stale`).
    this.stores = new Map();
    this.wantResync = new Set();
    this.stale = new Set();
  }

  /** The connect snapshot (or a Board snapshot answer): every named store's position is replaced. */
  adoptStoreSnapshot(msg) {
    const seqs = msg.storeSeqs || {}; const epochs = msg.storeEpochs || {};
    for (const { key } of STORE_SYNC) {
      if (!Number.isFinite(seqs[key])) continue;
      this.stores.set(key, { seq: seqs[key], epoch: epochs[key], behind: 0 });
      this.wantResync.delete(key); this.stale.delete(key);
    }
  }

  /**
   * A delta or ack carrying a store's `<seqKey>`/`<epochKey>` (sync-cursor.js storeFrameGap): another epoch, or on a
   * `gapFromDeltas` store a seq more than one ahead, is NOT adopted and asks for a slice; a jump on any other store is
   * left for the heartbeat. A frame the shadow never receives (a drop) therefore leaves the cursor behind.
   */
  noteStoreFrame(msg) {
    for (const d of STORE_SYNC) {
      const seq = msg[d.seqKey];
      if (!Number.isFinite(seq)) continue;
      const c = this.stores.get(d.key);
      if (!c) continue;
      const epoch = msg[d.epochKey];
      if (epoch !== undefined && c.epoch !== undefined && epoch !== c.epoch) { this.wantResync.add(d.key); continue; }
      if (seq > c.seq + 1) { if (d.gapFromDeltas) this.wantResync.add(d.key); continue; }
      if (seq > c.seq) c.seq = seq;
    }
  }

  /**
   * An efsp-heartbeat's `stores` (sync-cursor.js heartbeatGaps). Another epoch asks at once; ahead on two beats in a row
   * asks; ahead on STORE_STALE_BEATS beats in a row is `store-stale`.
   * @returns {string[]} the keys newly past the bound
   */
  noteHeartbeat(stores) {
    const flagged = [];
    for (const [key, b] of Object.entries(stores || {})) {
      const c = this.stores.get(key);
      if (!c || !b) continue;
      if (b.epoch !== undefined && c.epoch !== undefined && b.epoch !== c.epoch) { this.wantResync.add(key); c.behind++; }
      else if (Number.isFinite(b.seq) && b.seq > c.seq) { c.behind++; if (c.behind >= BEATS_BEFORE_RESYNC) this.wantResync.add(key); }
      else { c.behind = 0; this.wantResync.delete(key); this.stale.delete(key); continue; }
      if (c.behind >= STORE_STALE_BEATS && !this.stale.has(key)) { this.stale.add(key); flagged.push(key); }
    }
    return flagged;
  }

  /** A slice answered a stores resync: `{ [key]: { seq, epoch } }` replaces those positions. */
  applyStoreSlices(slices) {
    for (const [key, b] of Object.entries(slices || {})) {
      if (!Number.isFinite(b.seq)) continue;
      this.stores.set(key, { seq: b.seq, epoch: b.epoch, behind: 0 });
      this.wantResync.delete(key); this.stale.delete(key);
    }
  }

  _fac(fid) {
    if (!this.strips.has(fid)) { this.strips.set(fid, new Map()); this.boardSeq.set(fid, -1); }
    return this.strips.get(fid);
  }

  applySnapshot(msg, onlyFacility = null) {
    const fids = onlyFacility ? [onlyFacility] : this.facilityIds;
    for (const f of fids) this._fac(f).clear();
    for (const s of msg.strips || []) {
      const fid = s.facilityId || 'INCIRLIK';
      if (onlyFacility && fid !== onlyFacility) continue;
      this._fac(fid).set(s.stripId, compared(s));
    }
    const seqs = msg.boardSeqByFacility || {};
    for (const f of fids) if (Number.isFinite(seqs[f])) this.boardSeq.set(f, seqs[f]);
    const epochs = msg.boardEpochByFacility || {};
    for (const f of fids) if (epochs[f] !== undefined) this.boardEpoch.set(f, epochs[f]);
  }

  applyDelta(msg) {
    const fid = msg.facilityId || 'INCIRLIK';
    const m = this._fac(fid);
    for (const s of (msg.strips && msg.strips.updated) || []) {
      const prev = m.get(s.stripId);
      if (prev && prev.rev > s.rev) this.regressions++;
      m.set(s.stripId, compared(s));
    }
    for (const id of (msg.strips && msg.strips.gone) || []) m.delete(id);
    if (Number.isFinite(msg.boardSeq)) this.boardSeq.set(fid, msg.boardSeq);
    if (msg.boardEpoch !== undefined) this.boardEpoch.set(fid, msg.boardEpoch);
  }

  applyAck(msg) {
    if (!msg.strip) return;
    const fid = msg.facilityId || msg.strip.facilityId || 'INCIRLIK';
    this._fac(fid).set(msg.strip.stripId, compared(msg.strip));
    if (Number.isFinite(msg.boardSeq)) this.boardSeq.set(fid, msg.boardSeq);
    if (msg.boardEpoch !== undefined) this.boardEpoch.set(fid, msg.boardEpoch);
  }

  /**
   * Differences against server truth ({facilityId: {strips:[compact]}}).
   * @returns {Array<{facilityId, stripId, kind:'missing'|'extra'|'stale', fields?:string[], shadowRev?, truthRev?}>}
   */
  diff(truth, onlyFacilities = null) {
    const diffs = [];
    for (const [fid, t] of Object.entries(truth.facilities)) {
      if (onlyFacilities && !onlyFacilities.includes(fid)) continue;
      const mine = this._fac(fid);
      const truthIds = new Set();
      for (const s of t.strips) {
        truthIds.add(s.stripId);
        const m = mine.get(s.stripId);
        if (!m || m.state === 'DROPPED') { diffs.push({ facilityId: fid, stripId: s.stripId, kind: 'missing', truthRev: s.rev }); continue; }
        const fields = COMPARED.filter(k => (m[k] ?? null) !== (s[k] ?? null));
        if (fields.length) diffs.push({ facilityId: fid, stripId: s.stripId, kind: 'stale', fields, shadowRev: m.rev, truthRev: s.rev });
      }
      for (const [id, m] of mine) {
        if (!truthIds.has(id) && m.state !== 'DROPPED') diffs.push({ facilityId: fid, stripId: id, kind: 'extra', shadowRev: m.rev });
      }
    }
    return diffs;
  }
}

module.exports = { Shadow, COMPARED, compared, STORE_SYNC, STORE_DELTA_TYPES, STORE_STALE_BEATS, BEATS_BEFORE_RESYNC };
