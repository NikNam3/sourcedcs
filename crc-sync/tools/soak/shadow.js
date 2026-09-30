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

const COMPARED = ['stripId', 'rev', 'state', 'ownerPositionId', 'bayId', 'rackId', 'orderKey', 'role', 'fdrId'];

function compared(s) {
  const o = {};
  for (const k of COMPARED) o[k] = s[k] === undefined ? null : s[k];
  return o;
}

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

module.exports = { Shadow, COMPARED, compared };
