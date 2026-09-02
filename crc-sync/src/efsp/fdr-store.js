'use strict';

// Flight Data Record store — net-new state in crc-sync. WP0 reconnaissance
// this session confirmed the guide's decision D-1 ("the CRC server already
// keeps a per-aircraft flight record") is FALSE: src/tracks.js's "track" is
// pure live radar telemetry (id/callsign/coalition/type/lat/lon/alt/heading
// /player/category, plus SRS-observed squawk) with no route, altitude,
// departure, or destination anywhere. This store is the real thing,
// modelled on EFSPImplementationGuide.md §3.1-3.3, §3.8, §3.10.
//
// FDR and Strip are deliberately separate (guide §3.1): this store owns
// only the flight — identity, filed intent, assigned clearance. Strip
// lifecycle (state, ownership, Bay/Rack placement, annotations) lives in
// board-store.js and references an fdrId, never the reverse.

const crypto = require('crypto');
const { CodeAllocator } = require('./code-allocator');

const VOID_DEADLINE_MINUTES = 30; // §3.8 — derived, not stored input

const RELEASE_STATES = new Set(['RELEASED', 'HOLD_FOR_RELEASE', 'RELEASE_TIME', 'CLEARANCE_VOID_TIME']);
const DEGRADATION_STATES = new Set(['NONE', 'TRANSPONDER_FAILED', 'MODE_C_FAILED']);
const DATALINK_INDICATOR_STATES = new Set(['NONE', 'ISSUED']);

const CALLSIGN_RE = /^[A-Za-z0-9]{1,7}$/; // §3.2 rule 1 — MUST NOT exceed 7 alphanumeric characters

// Paths a controller-driven SetBlock may target generically via setField().
// Deliberately excludes identity.equipmentSuffix (derived-only, §3.3),
// identity.modeOne/modeTwo (no setter anywhere — guards defect D24 by
// construction, not validation), identity.beaconObserved/trackRef/military
// (WP5/WP6 hooks, always null in Phase 1), and all structural/system fields
// (fdrId, rev, provenance, createdAt/updatedAt/updatedBy). identity.
// beaconAssigned is listed here but routed through a dedicated method
// (setBeaconAssigned) rather than the generic path, since it needs
// code-allocator validation, not just a plain write.
const WRITABLE_PATHS = new Set([
  'identity.callsign', 'identity.flightSize', 'identity.aircraftType', 'identity.wakeCategory',
  'identity.equipmentCodes', 'identity.degradation',
  'identity.tailNumber', 'identity.unit', 'identity.homeStation',
  'filed.route', 'filed.requestedAltitude', 'filed.departureAirport', 'filed.departureRunway',
  'filed.destinationAirport', 'filed.proposedDepartureTimeUtc', 'filed.fullRouteClearance', 'filed.remarks',
  // ARRIVAL-role fields (Phase 2) — present on every FDR regardless of the
  // Strip role that ends up referencing it, same "present but unpopulated
  // until relevant" precedent as the DEPARTURE-only fields above (guide
  // §12). Deliberately separate names from the departure fields, not
  // repurposed ones — filed.departureAirport means something different
  // from filed.originAirport, and confusing them would be a genuine bug.
  'filed.originAirport', 'filed.arrivalFix', 'filed.estimatedArrivalTimeUtc',
  'assigned.clearedRoute', 'assigned.clearedAltitude', 'assigned.releaseState', 'assigned.releaseTimeUtc',
  'assigned.voidTimeUtc', 'assigned.delayInfo', 'assigned.atisCode', 'assigned.datalinkClearanceIndicator',
  'assigned.movementAreaEntryTimeUtc', 'assigned.taxiTimeUtc', 'assigned.takeoffTimeUtc',
  'assigned.landingRunway',
]);

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  const target = parts.reduce((o, k) => o[k], obj);
  target[last] = value;
}

// [SOURCE-DEFINED, deliberately simplified] — the real FAA equipment-suffix
// cross-reference (AIM 5-1-8/Doc 8643-adjacent tables) is genuinely complex
// published doctrine this guide does not reproduce, and §3.3's actual
// requirement is the INTERLOCK (suffix is derived, never directly
// editable), not a specific mapping. This derivation is intentionally
// naive — sorted, joined equipment-code letters — and MUST NOT be
// presented as real FAA doctrine (§0.2). Replace with a real table if/when
// one is sourced; nothing else in the Block Map depends on the specific
// letters produced here.
function deriveEquipmentSuffix(equipmentCodes) {
  if (!Array.isArray(equipmentCodes) || equipmentCodes.length === 0) return '';
  return [...equipmentCodes].map(String).sort().join('');
}

class FdrStore {
  constructor(codeAllocator) {
    this._codeAllocator = codeAllocator || new CodeAllocator();
    this._fdrs = new Map(); // fdrId -> FlightDataRecord
  }

  get codeAllocator() { return this._codeAllocator; }

  getFdr(fdrId) { return this._fdrs.get(fdrId) || null; }
  getAll() { return [...this._fdrs.values()]; }

  /**
   * Creates a new FDR from filed intent (§3.1, §3.2). Mints a beacon code
   * internally via the code allocator — this is NOT a client-facing RPC
   * (guide §3.10.1's split: crc-sync mints, EFSP only displays/overrides).
   * Returns { ok:true, fdr } or { ok:false, reason }.
   */
  createFdr(seed, { by }) {
    const callsign = String(seed?.callsign || '').toUpperCase();
    if (!CALLSIGN_RE.test(callsign)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'callsign must be 1-7 alphanumeric characters' };
    }

    const fdrId = crypto.randomUUID();
    const now = Date.now();
    const equipmentCodes = Array.isArray(seed.equipmentCodes) ? [...seed.equipmentCodes] : [];

    const minted = this._codeAllocator.allocate(fdrId);
    if (minted.error) return { ok: false, reason: 'VALIDATION_ERROR', detail: 'beacon code pool exhausted' };

    const provenance = {
      'identity.beaconAssigned': 'COMPUTER_GENERATED',
      'identity.equipmentSuffix': 'SYSTEM_DERIVED',
    };

    const fdr = {
      fdrId,
      rev: 1,
      identity: {
        callsign,
        flightSize: Number.isInteger(seed.flightSize) && seed.flightSize > 0 ? seed.flightSize : 1,
        aircraftType: seed.aircraftType || '',
        wakeCategory: seed.wakeCategory || '',
        equipmentCodes,
        equipmentSuffix: deriveEquipmentSuffix(equipmentCodes),
        degradation: 'NONE',
        beaconAssigned: minted.code,
        beaconObserved: null, // WP5 hook — correlation subsystem not built in Phase 1
        modeOne: null,        // ATO-owned, WP7 hook — no setter exists anywhere
        modeTwo: null,        // ATO-owned, WP7 hook — no setter exists anywhere
        tailNumber: seed.tailNumber || null,
        unit: seed.unit || null,
        homeStation: seed.homeStation || null,
      },
      filed: {
        route: seed.route || '',
        requestedAltitude: seed.requestedAltitude || '',
        departureAirport: seed.departureAirport || '',
        departureRunway: seed.departureRunway || null,
        destinationAirport: seed.destinationAirport || '',
        proposedDepartureTimeUtc: seed.proposedDepartureTimeUtc || null,
        fullRouteClearance: !!seed.fullRouteClearance,
        remarks: seed.remarks || '',
        originAirport: seed.originAirport || '',                       // ARRIVAL-role field, Phase 2
        arrivalFix: seed.arrivalFix || null,                            // ARRIVAL-role field, Phase 2
        estimatedArrivalTimeUtc: seed.estimatedArrivalTimeUtc || null,  // ARRIVAL-role field, Phase 2
      },
      assigned: {
        clearedRoute: null,
        clearedAltitude: null,
        releaseState: 'RELEASED',
        releaseTimeUtc: null,
        voidTimeUtc: null,
        voidDeadlineUtc: null,
        delayInfo: null,
        atisCode: null,
        datalinkClearanceIndicator: 'NONE',
        movementAreaEntryTimeUtc: null, // Block 16 — present, unpopulated; metering deferred, guide §12
        taxiTimeUtc: null,              // Block 17 — present, unpopulated
        takeoffTimeUtc: null,
        landingRunway: null,            // ARRIVAL-role field, Phase 2
      },
      military: null,  // WP6 hook
      trackRef: null,  // WP5 hook
      provenance,
      createdAt: now,
      updatedAt: now,
      updatedBy: by || null,
    };

    this._fdrs.set(fdrId, fdr);
    return { ok: true, fdr };
  }

  /**
   * Generic controller-driven field write for any path in WRITABLE_PATHS.
   * Handles the equipment-suffix recompute-on-equipmentCodes-change
   * interlock (§3.3) and the void-deadline derivation on release-state/
   * void-time changes (§3.8). identity.beaconAssigned is NOT handled here
   * — use setBeaconAssigned(), which needs code-allocator validation.
   */
  setField(fdrId, path, value, { by } = {}) {
    const fdr = this._fdrs.get(fdrId);
    if (!fdr) return { ok: false, reason: 'NOT_FOUND' };
    if (path === 'identity.beaconAssigned') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'use setBeaconAssigned' };
    }
    if (path === 'identity.equipmentSuffix') {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'equipmentSuffix is derived — set identity.equipmentCodes instead' };
    }
    if (!WRITABLE_PATHS.has(path)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: `${path} is not writable` };
    }
    if (path === 'identity.degradation' && !DEGRADATION_STATES.has(value)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'invalid degradation state' };
    }
    if (path === 'assigned.releaseState' && !RELEASE_STATES.has(value)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'invalid release state' };
    }
    if (path === 'assigned.datalinkClearanceIndicator' && !DATALINK_INDICATOR_STATES.has(value)) {
      return { ok: false, reason: 'VALIDATION_ERROR', detail: 'invalid datalink clearance indicator' };
    }

    setPath(fdr, path, value);

    if (path === 'identity.equipmentCodes') {
      fdr.identity.equipmentSuffix = deriveEquipmentSuffix(value);
      fdr.provenance['identity.equipmentSuffix'] = 'SYSTEM_DERIVED';
    }

    if (path === 'assigned.releaseState' || path === 'assigned.voidTimeUtc') {
      fdr.assigned.voidDeadlineUtc =
        fdr.assigned.releaseState === 'CLEARANCE_VOID_TIME' && fdr.assigned.voidTimeUtc
          ? fdr.assigned.voidTimeUtc + VOID_DEADLINE_MINUTES * 60 * 1000
          : null;
    }

    fdr.provenance[path] = 'CONTROLLER_ENTERED';
    fdr.rev += 1;
    fdr.updatedAt = Date.now();
    fdr.updatedBy = by || null;
    return { ok: true, fdr };
  }

  /**
   * Controller override of Block 5 (§3.10.2 rule 2) — routed through the
   * code allocator rather than setField's generic path, since it needs
   * reserved/duplicate validation and must release the FDR's previous code.
   * Returns { ok:false, reason:'VALIDATION_ERROR' } for reserved/malformed
   * codes, or { ok:true, fdr, warning? } — warning is set (never blocking)
   * for a duplicate, per defect D23.
   */
  setBeaconAssigned(fdrId, code, { by } = {}) {
    const fdr = this._fdrs.get(fdrId);
    if (!fdr) return { ok: false, reason: 'NOT_FOUND' };

    const check = this._codeAllocator.validateAssignment(code, fdrId);
    if (!check.ok) return { ok: false, reason: check.reason };

    const previous = fdr.identity.beaconAssigned;
    this._codeAllocator.reassign(fdrId, code, previous);
    fdr.identity.beaconAssigned = code;
    fdr.provenance['identity.beaconAssigned'] = 'CONTROLLER_ENTERED';
    fdr.rev += 1;
    fdr.updatedAt = Date.now();
    fdr.updatedBy = by || null;
    return { ok: true, fdr, warning: check.warning };
  }

  /** Releases the FDR's beacon code — called when its Strip is DROPPED. */
  releaseFdr(fdrId) {
    const fdr = this._fdrs.get(fdrId);
    if (!fdr) return;
    this._codeAllocator.release(fdr.identity.beaconAssigned);
  }

  // ── Persistence (durable per ADR 0002) ──────────────────────────────────
  snapshot() {
    return { fdrs: this.getAll(), codes: this._codeAllocator.snapshot() };
  }
  restore(data) {
    this._fdrs = new Map((data?.fdrs || []).map(f => [f.fdrId, f]));
    this._codeAllocator.restore(data?.codes);
  }
}

module.exports = { FdrStore, deriveEquipmentSuffix, WRITABLE_PATHS, RELEASE_STATES, VOID_DEADLINE_MINUTES };
