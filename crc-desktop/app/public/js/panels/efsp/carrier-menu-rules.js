'use strict';

// crc-sync docs/adr/0156: the carrier items of a Strip's "…" menu, as rules. A leaf (imports nothing): the menu
// (strip-menu.js) and node:test both call it with what they know. Each item is the server's own rule (carrier/handoffs.js,
// permission.js mayActBesideOwner) seen from the client: an item a Position can never use is left out, one it cannot use
// now is listed disabled with the reason.

const LANES = Object.freeze(['CV_APP1', 'CV_APP2']);

/**
 * @param {object} strip
 * @param {object} a
 * @param {string[]} a.acting         the Positions this controller acts at (Primary)
 * @param {'I'|'II'|'III'|null} a.shipCase
 * @param {'I'|'II'|'III'|null} a.flightCase  carrier-state.js carrierFlightCase(strip)
 * @returns {{key:string, label:string, enabled:boolean, reason?:string, as:string, op?:object, form?:string}[]}
 */
export function carrierMenuItems(strip, { acting = [], shipCase = null, flightCase = null } = {}) {
  if (!strip || !['CV_LAUNCH', 'CV_RECOVERY'].includes(strip.stripType) || strip.state === 'DROPPED') return [];
  const out = [];
  const owner = strip.ownerPositionId;
  const holdsOwner = acting.includes(owner);
  // Set callsign: the owner, any carrier Strip; the ATO line comes with it (crc-sync set-block.js).
  if (holdsOwner) out.push({ key: 'carrier-callsign', label: 'Set callsign…', enabled: true, as: owner, form: 'callsign' });
  if (strip.stripType !== 'CV_RECOVERY') return out;

  const marshal = acting.includes('CV_MARSHAL');
  const sequenced = flightCase === 'II' || flightCase === 'III';
  // Back to stack: the Marshal from COMMENCED on (the lane's Strip too), the lane from its own approach. Not from BULLSEYE.
  const backStates = ['COMMENCED', 'FINAL_APPROACH', 'DIRTY'];
  if (sequenced && backStates.includes(strip.state)) {
    const laneOwns = LANES.includes(owner) && holdsOwner;
    if (marshal || laneOwns) {
      out.push({ key: 'carrier-back-to-stack', label: 'Back to stack', enabled: true, as: marshal ? 'CV_MARSHAL' : owner,
        op: { kind: 'CarrierHandoff', transfer: 'RETURN_TO_STACK' } });
    }
  }
  // The other lane, before TO APPR.
  if (marshal && sequenced && strip.state === 'COMMENCED' && owner === 'CV_MARSHAL') {
    for (const lane of LANES) {
      out.push({ key: `carrier-to-${lane.toLowerCase()}`, label: `To ${lane === 'CV_APP1' ? 'APP 1' : 'APP 2'}`, enabled: true, as: 'CV_MARSHAL',
        op: { kind: 'CarrierHandoff', transfer: 'TO_APPROACH', toPositionId: lane } });
    }
  }
  // Abort a Case I flight to the Case II/III stack: only while the ship is in II or III.
  if (marshal && flightCase === 'I' && ['STACK', 'CV_PATTERN'].includes(strip.state)) {
    const open = shipCase === 'II' || shipCase === 'III';
    out.push({ key: 'carrier-abort', label: 'Abort to Case II/III stack', enabled: open, reason: open ? '' : 'Case I is active', as: 'CV_MARSHAL',
      op: { kind: 'CarrierHandoff', transfer: 'ABORT_TO_STACK' } });
  }
  return out;
}
