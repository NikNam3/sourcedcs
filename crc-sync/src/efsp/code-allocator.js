'use strict';

// Beacon/squawk (Mode 3/A) code allocation for the EFSP. Per the
// phase-1 design decision ("crc-sync mints, EFSP consumes"), this is new,
// server-authoritative capability: the EFSP panel only displays, lets a
// controller override, and applies the doctrine below — it never mints.
//
// Doctrine implemented here, from EFSPImplementationGuide.md §3.10.2/§3.10.4:
//   - reserved codes are hard validation errors, never assignable (rule 4)
//   - duplicates raise a warning, never a hard block — defect D23 (rule 7)
//   - 7777 is never offered as an assignment (rule 5) — a controller can
//     only ever *observe* it, never mint or override to it; it's in
//     RESERVED_CODES so both allocate() and validateAssignment() refuse it
//   - 4000 MUST be a first-class assignable (rule 6) but is excluded from
//     the plain sequential auto-mint scan, so ordinary departures don't
//     silently consume it — it stays available for a deliberate override
//     (the guide's "SHOULD offer 4000 for MTR/AR/ALTRV strips" suggestion
//     is WP6-military-Block-adjacent and out of Phase 1's DEPARTURE-only
//     scope; this just keeps the code itself assignable, not auto-handed-out)
//   - the "monitor set" (1200,1202,1203,1255,1277, and 4000 in restricted/
//     warning/VR context) is recognisable on sight (isMonitorSet), not an
//     allocation concern — display-layer doctrine, exposed here for reuse
//
// [SOURCE-DEFINED] (docs/adr/0059) — the synthetic block (config/sensor-specs.json, 6000–6777 as shipped) is crc-sync's, not
// doctrine: the codes crc-sync gives AI aircraft, which have no SRS transponder.
// Never allocated and never assignable, so no flight data can hold one and an AI
// aircraft can never correlate on its beacon — it correlates on its callsign or
// not at all. The guide has no such block.

const RESERVED_CODES = new Set(['0000', '7500', '7600', '7700', '7400', '7777']);
const MONITOR_SET     = new Set(['1200', '1202', '1203', '1255', '1277']);
const AUTO_ALLOCATE_EXCLUDED = new Set([...RESERVED_CODES, '4000']);

// Mode 3/A codes are 4 octal digits (0-7 each).
function isValidCodeFormat(code) {
  return typeof code === 'string' && /^[0-7]{4}$/.test(code);
}

function isReserved(code) { return RESERVED_CODES.has(code); }

// 4000 counts as "monitor set" only in restricted/warning/VR-route context,
// which this module has no visibility into (that's a facility/airspace
// concern) — callers that know the context should OR this in themselves;
// this checks the unconditional part of the set only.
function isMonitorSet(code) { return MONITOR_SET.has(code); }

// The block's range is data (sensor-specs.json, DATA-3). It is loaded on first use, not at require time, so the pure
// ATO parser that imports this file still reads no config when it loads. A block that swallows a reserved code is a
// start-up error: transponder.js loads it eagerly, and the server requires that.
let _block = null;
function syntheticBlock() {
  if (_block) return _block;
  const b = require('../synthetic-block');
  for (const c of RESERVED_CODES) {
    const n = parseInt(c, 8);
    if (n >= b.SYNTHETIC_BLOCK_START && n < b.SYNTHETIC_BLOCK_START + b.SYNTHETIC_BLOCK_SIZE) {
      throw new Error(`[sensor-specs] "transponder.syntheticBlock" (${b.SYNTHETIC_BLOCK_LABEL}) contains the reserved code ${c}`);
    }
  }
  _block = b;
  return b;
}

/** A code from the block crc-sync reserves for AI transponders. */
function isSynthetic(code) {
  if (!isValidCodeFormat(code)) return false;
  const n = parseInt(code, 8);
  const { SYNTHETIC_BLOCK_START, SYNTHETIC_BLOCK_SIZE } = syntheticBlock();
  return n >= SYNTHETIC_BLOCK_START && n < SYNTHETIC_BLOCK_START + SYNTHETIC_BLOCK_SIZE;
}

class CodeAllocator {
  constructor() {
    this._allocated = new Map(); // code -> flightDataId — one pool shared by every Facility (docs/adr/0013)
    // The last code allocate() handed out, as a number (docs/adr/0081). The
    // next scan starts after it, so a released code is not handed out again
    // until the whole discrete pool has cycled. 0 = nothing handed out yet.
    this._cursor = 0;
  }

  /** The rotating cursor, persisted beside the allocated codes (flight-data-store.js snapshot). */
  get cursor() { return this._cursor; }
  restoreCursor(cursor) {
    this._cursor = Number.isInteger(cursor) && cursor >= 0 && cursor <= 0o7777 ? cursor : 0;
  }

  /**
   * Mints the next available discrete code for a newly created flight data.
   *
   * A ROTATING scan (docs/adr/0081, L6's F6): from the code after the last one
   * handed out, wrapping past 7777 back to 0001, skipping reserved/excluded,
   * synthetic and already-allocated codes. It used to take the LOWEST free
   * code, so a flight that landed released its code and the very next
   * CreateStrip got it back while the old aircraft was still squawking it on
   * the ramp or in the pattern — and correlation bound the new flight plan to
   * the old aircraft (46 misbindings in a four-hour soak). Now a released code
   * comes back only after every other free discrete code has been used:
   * thousands of flights at this squadron's scale. No clock, no tuning file.
   * The guide's fuller pool/search-order model (named pools, exclusion lists
   * per facility) is WP6+-adjacent and not needed here.
   */
  allocate(flightDataId) {
    const POOL = 0o7777;
    for (let i = 1; i <= POOL; i++) {
      const n = ((this._cursor + i - 1) % POOL) + 1; // 1..7777, starting after the cursor
      const code = n.toString(8).padStart(4, '0');
      if (AUTO_ALLOCATE_EXCLUDED.has(code) || isSynthetic(code)) continue;
      if (this._allocated.has(code)) continue;
      this._allocated.set(code, flightDataId);
      this._cursor = n;
      return { code, pool: 'DISCRETE' };
    }
    return { error: 'POOL_EXHAUSTED' };
  }

  release(code) {
    if (code) this._allocated.delete(code);
  }

  /**
   * Validates a controller-entered override for Block 5 (§3.10.2):
   *   - malformed or reserved → hard VALIDATION_ERROR, never assignable
   *   - already allocated to a *different* flight data → accepted, but flagged as
   *     DUPLICATE_IGNORED_WARNING (defect D23 — duplicates are structural
   *     in the real system, never blocked)
   */
  validateAssignment(code, flightDataId) {
    if (!isValidCodeFormat(code)) return { ok: false, reason: 'VALIDATION_ERROR' };
    if (isReserved(code))         return { ok: false, reason: 'VALIDATION_ERROR' };
    if (isSynthetic(code))        return { ok: false, reason: 'VALIDATION_ERROR', detail: `reserved for AI aircraft (crc-sync's synthetic block ${syntheticBlock().SYNTHETIC_BLOCK_LABEL})` };
    const holder = this._allocated.get(code);
    if (holder && holder !== flightDataId) return { ok: true, warning: 'DUPLICATE_IGNORED_WARNING' };
    return { ok: true };
  }

  /**
   * Records a controller override as the new holder of `newCode`, after
   * validateAssignment() has already approved it. Releases the flight data's prior
   * discrete code first, if it held a different one — the flight data holds at most
   * one code at a time.
   */
  reassign(flightDataId, newCode, previousCode) {
    if (previousCode && previousCode !== newCode) this.release(previousCode);
    this._allocated.set(newCode, flightDataId);
  }

  isAllocated(code) { return this._allocated.has(code); }
  holderOf(code) { return this._allocated.get(code) || null; }

  // ── Persistence (durable per ADR 0002 — ties to flight-data-store.js's snapshot) ──
  snapshot() { return [...this._allocated.entries()]; }
  restore(entries) { this._allocated = new Map(entries || []); }
}

module.exports = {
  CodeAllocator, isReserved, isMonitorSet, isValidCodeFormat, isSynthetic,
  RESERVED_CODES, syntheticBlock,
};
