'use strict';

// The single frequency approach on the client (crc-sync docs/adr/0117, superseding the SFA parts of 0075 and 0093).
// Pure: it imports nothing and keeps no state, so node:test imports it directly.
//
// No SFA Position and no rotation record. AP files an arrival on a frequency Rack of its SFA Bay, which assigns the
// flight that frequency (the server writes it); at least five frequencies, three of them rotating between AP and PAR,
// AP holding the rotation (JO 7610.14A para 7-1-5 b, c). The pool rides on the Bay descriptor (`bay.sfaPool`). AP hands
// the arrival to PAR by an ordinary strip transfer into PAR's final Bay; the pilot does not change frequency
// (JO 7110.65BB para 5-10-15 c). Who is on a rotating frequency is not stored: it follows the flight, PAR while PAR holds
// the Strip of a flight on it, else AP.
//
// Two small drift-tested mirrors of crc-sync's tables (tests/efsp-sfa-client.test.mjs): who may hand an arrival to the
// final controller, and the handoff's label. The server is the authority; these only decide what is OFFERED.

// INCIRLIK_CAPABILITIES' `handsOffToFinal` and `receivesFinal` columns, and par-final.js's PAR_HANDOFF label.
export const FINAL_HANDOFF_SENDERS = ['AP'];
export const FINAL_RECEIVER = 'PAR';
export const FINAL_HANDOFF_LABEL = 'Hand off to PAR';
// crc-sync sfa.js's SFA_USE (the facility config's pool `use`).
export const SFA_USE = Object.freeze({ ROTATION: 'ROTATION', INITIAL_CONTACT: 'INITIAL_CONTACT', SPARE: 'SPARE' });

/** `232.100`, the way a controller reads a UHF frequency. */
export function sfaFrequencyText(mhz) { return Number.isFinite(mhz) ? mhz.toFixed(3) : '--'; }

/** The SFA Bay of a Facility (`view: 'sfa-freqs'`, carrying `sfaPool`), or null. */
export function sfaBayOf(bays, facilityId) {
  return (bays || []).find(b => b.view === 'sfa-freqs' && Array.isArray(b.sfaPool) && (!facilityId || !b.facilityId || b.facilityId === facilityId)) || null;
}

/** The pool entry whose frequency is this flight's working frequency, or null: "an aircraft on an SFA frequency". */
export function sfaPoolEntryForFrequency(mhz, bay) {
  if (!bay || !Array.isArray(bay.sfaPool) || !Number.isFinite(mhz)) return null;
  return bay.sfaPool.find(p => p.mhz === mhz) || null;
}

/**
 * The pool as rows for the Bay's header, in pool order: `{ rackId, mhz, text, use, positionId }`. `positionId` is who
 * has a ROTATION frequency selected now (the receiver while it holds a live Strip whose flight is on it, else the
 * Bay's Position, AP); null on the others, which do not rotate.
 * @param {object} bay the SFA Bay descriptor
 * @param {object[]} strips the Facility's Strips
 * @param {(flightDataId:string) => object|null} flightDataOf
 */
export function sfaRows(bay, strips, flightDataOf) {
  if (!bay || !Array.isArray(bay.sfaPool)) return [];
  return bay.sfaPool.map(p => {
    let positionId = null;
    if (p.use === SFA_USE.ROTATION) {
      const atReceiver = (strips || []).some(s => {
        if (s.ownerPositionId !== FINAL_RECEIVER || s.state === 'DROPPED') return false;
        const fd = flightDataOf(s.flightDataId);
        return !!(fd && fd.comms && fd.comms.workingFrequencyMhz === p.mhz);
      });
      positionId = atReceiver ? FINAL_RECEIVER : bay.positionId;
    }
    return { rackId: p.rackId, mhz: p.mhz, text: sfaFrequencyText(p.mhz), use: p.use, positionId };
  });
}

/**
 * Should this Strip carry the "Hand off to PAR" button? An ARRIVAL at INBOUND, owned by a signed-on Position that hands
 * off to the final controller, on one of the rotating SFA frequencies. Any other arrival is handed to PAR by a drag (the
 * same transfer); the button is for the SFA flow, so AP's other inbound Strips stay as they are. A Strip has one NLA
 * (§3.5 rule 1), so this is a second button beside it, as "See you" is.
 */
export function finalHandoffOffered(strip, flightData, signedOnIds, bay) {
  if (!bay || !strip || strip.stripType !== 'ARRIVAL' || strip.state !== 'INBOUND') return false;
  if (!FINAL_HANDOFF_SENDERS.includes(strip.ownerPositionId)) return false;
  if (!(signedOnIds || []).includes(strip.ownerPositionId)) return false;
  const mhz = flightData && flightData.comms ? flightData.comms.workingFrequencyMhz : null;
  const entry = sfaPoolEntryForFrequency(mhz, bay);
  return !!entry && entry.use === SFA_USE.ROTATION;
}

/** The transfer the button sends: into the receiver's Bay that implies ON_FINAL, or null when this Facility has none. */
export function finalHandoffOp(bays, facilityId) {
  const bay = (bays || []).find(b => b.positionId === FINAL_RECEIVER && b.impliesState === 'ON_FINAL' && (!facilityId || !b.facilityId || b.facilityId === facilityId));
  return bay ? { kind: 'TransferStrip', toPositionId: FINAL_RECEIVER, bayId: bay.bayId, rackId: (bay.rackIds && bay.rackIds[0]) || 'main' } : null;
}
