'use strict';

// Client mirror of the SFA rotation record (crc-sync docs/adr/0075, 0093; guide
// §4.7): who is on which of the pool's frequencies. Plain module-level state like
// carrier-state.js, an ES module that node:test imports directly.
//
// The server sends the whole record on every change (`efsp-sfa-delta`) with the
// pool and the jurisdiction, so this file holds no rule of its own beyond two
// small drift-tested mirrors of crc-sync's authority tables (who may send the rotation
// transfer, which Position holds jurisdiction). The server is the authority;
// these only decide what is OFFERED.
//
// A frequency is the Strip's attribute, never the controller's: nothing here
// writes one. The rotation record says which controller is on a frequency, and
// the rotation transfer moves the Strip to PAR with its frequency untouched.

let efspSfaView = null;

export function applyEfspSfaSnapshot(msg) { efspSfaView = (msg && msg.sfaRotation) || null; }
export function applyEfspSfaDelta(msg) { if (msg && msg.sfaRotation) efspSfaView = msg.sfaRotation; }
export function getEfspSfa() { return efspSfaView; }
export function _resetEfspSfaStateForTest() { efspSfaView = null; }

// Mirrors of crc-sync's authority/positions/incirlik-military.js (drift-tested: tests/efsp-sfa-client.test.mjs).
// INCIRLIK_CAPABILITIES' `sendsSfaRotation` column, and SFA_TRANSFERS.SFA_ROTATION's label.
export const SFA_ROTATION_SENDERS = ['AP', 'SFA'];
export const SFA_ROTATION_LABEL = 'Rotate to PAR';
// INCIRLIK_CAPABILITIES' `rotatesSfa` ceiling; the server narrows it to the config's jurisdiction.
export const SFA_ROTATION_CEILING = ['AP'];

/** `232.100`, the way a controller reads a UHF frequency. */
export function sfaFrequencyText(mhz) { return Number.isFinite(mhz) ? mhz.toFixed(3) : '--'; }

/** The pool as rows for the header: `{ rackId, mhz, text, positionId|null }`, in pool order. */
export function sfaRotationRows(view = getEfspSfa()) {
  if (!view || !Array.isArray(view.pool)) return [];
  const rotation = view.rotation || {};
  return view.pool.map(p => ({ rackId: p.rackId, mhz: p.mhz, text: sfaFrequencyText(p.mhz), positionId: rotation[p.rackId] || null }));
}

/** The held Position that may change the rotation (the jurisdiction Position, inside the ceiling), or null. Pure over `signedOnIds`. */
export function sfaRotatingPosition(signedOnIds, view = getEfspSfa()) {
  if (!view) return null;
  return (signedOnIds || []).find(id => id === view.jurisdiction && SFA_ROTATION_CEILING.includes(id)) || null;
}

/** The pool entry whose frequency is this flight's working frequency, or null: "an aircraft on an SFA frequency". */
export function sfaPoolEntryForFrequency(mhz, view = getEfspSfa()) {
  if (!view || !Array.isArray(view.pool) || !Number.isFinite(mhz)) return null;
  return view.pool.find(p => p.mhz === mhz) || null;
}

/**
 * Should this Strip carry the rotation button? An ARRIVAL at INBOUND, held by a Position that may send
 * the transfer, that is on an SFA frequency (its working frequency is in the pool; filing a Strip
 * on an SFA Rack assigns it that frequency). A Strip has one NLA (§3.5 rule 1), so this is a second button beside it, as "See you" is.
 */
export function sfaRotationOffered(strip, flightData, signedOnIds, view = getEfspSfa()) {
  if (!view || !strip || strip.stripType !== 'ARRIVAL' || strip.state !== 'INBOUND') return false;
  if (!SFA_ROTATION_SENDERS.includes(strip.ownerPositionId)) return false;
  if (!(signedOnIds || []).includes(strip.ownerPositionId)) return false;
  const mhz = flightData && flightData.comms ? flightData.comms.workingFrequencyMhz : null;
  return !!sfaPoolEntryForFrequency(mhz, view);
}
