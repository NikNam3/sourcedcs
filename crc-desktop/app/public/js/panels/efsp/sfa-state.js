'use strict';

// Client mirror of the SFA rotation record (crc-sync docs/adr/0075, 0093; guide
// §4.7): who is on which of the pool's frequencies. Plain module-level state like
// carrier-state.js, a guarded module.exports so node:test can require it.
//
// The server sends the whole record on every change (`efsp-sfa-delta`) with the
// pool and the jurisdiction, so this file holds no rule of its own beyond two
// small drift-tested mirrors of permission.js (who may send the rotation
// transfer, which Position holds jurisdiction). The server is the authority;
// these only decide what is OFFERED.
//
// A frequency is the Strip's attribute, never the controller's: nothing here
// writes one. The rotation record says which controller is on a frequency, and
// the rotation transfer moves the Strip to PAR with its frequency untouched.

let efspSfaView = null;

function applyEfspSfaSnapshot(msg) { efspSfaView = (msg && msg.sfaRotation) || null; }
function applyEfspSfaDelta(msg) { if (msg && msg.sfaRotation) efspSfaView = msg.sfaRotation; }
function getEfspSfa() { return efspSfaView; }
function _resetEfspSfaStateForTest() { efspSfaView = null; }

// Mirrors of crc-sync permission.js (drift-tested: tests/efsp-sfa-client.test.js).
// INCIRLIK_CAPABILITIES' `sendsSfaRotation` column, and SFA_TRANSFERS.SFA_ROTATION's label.
const SFA_ROTATION_SENDERS = ['APP', 'SFA'];
const SFA_ROTATION_LABEL = 'Rotate to PAR';
// INCIRLIK_CAPABILITIES' `rotatesSfa` ceiling; the server narrows it to the config's jurisdiction.
const SFA_ROTATION_CEILING = ['APP'];

/** `232.100`, the way a controller reads a UHF frequency. */
function sfaFrequencyText(mhz) { return Number.isFinite(mhz) ? mhz.toFixed(3) : '--'; }

/** The pool as rows for the header: `{ rackId, mhz, text, positionId|null }`, in pool order. */
function sfaRotationRows(view = getEfspSfa()) {
  if (!view || !Array.isArray(view.pool)) return [];
  const rotation = view.rotation || {};
  return view.pool.map(p => ({ rackId: p.rackId, mhz: p.mhz, text: sfaFrequencyText(p.mhz), positionId: rotation[p.rackId] || null }));
}

/** The held Position that may change the rotation (the jurisdiction Position, inside the ceiling), or null. Pure over `heldIds`. */
function sfaRotatingPosition(heldIds, view = getEfspSfa()) {
  if (!view) return null;
  return (heldIds || []).find(id => id === view.jurisdiction && SFA_ROTATION_CEILING.includes(id)) || null;
}

/** The pool entry whose frequency is this flight's working frequency, or null: "an aircraft on an SFA frequency". */
function sfaPoolEntryForFrequency(mhz, view = getEfspSfa()) {
  if (!view || !Array.isArray(view.pool) || !Number.isFinite(mhz)) return null;
  return view.pool.find(p => p.mhz === mhz) || null;
}

/**
 * Should this Strip carry the rotation button? An ARRIVAL at INBOUND, held by a Position that may send
 * the transfer, that is on an SFA frequency (its working frequency is in the pool; filing a Strip
 * on an SFA Rack assigns it that frequency). A Strip has one NLA (§3.5 rule 1), so this is a second button beside it, as "See you" is.
 */
function sfaRotationOffered(strip, fdr, heldIds, view = getEfspSfa()) {
  if (!view || !strip || strip.role !== 'ARRIVAL' || strip.state !== 'INBOUND') return false;
  if (!SFA_ROTATION_SENDERS.includes(strip.ownerPositionId)) return false;
  if (!(heldIds || []).includes(strip.ownerPositionId)) return false;
  const mhz = fdr && fdr.comms ? fdr.comms.workingFrequencyMhz : null;
  return !!sfaPoolEntryForFrequency(mhz, view);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    applyEfspSfaSnapshot, applyEfspSfaDelta, getEfspSfa, _resetEfspSfaStateForTest,
    SFA_ROTATION_SENDERS, SFA_ROTATION_LABEL, SFA_ROTATION_CEILING,
    sfaFrequencyText, sfaRotationRows, sfaRotatingPosition, sfaPoolEntryForFrequency, sfaRotationOffered,
  };
}
