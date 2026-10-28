'use strict';
import { sendEfspAirspaceMutation } from './efsp-ws.js';

// Sending the transit ops (crc-sync docs/adr/0128) on the airspace mutation family. No baseRev: a transit is no state
// transition, and an unrelated change to the record (another flight's transit, a frequency edit) must not make it STALE_REV.

/** One transit op as `positionId` on `airspace` for the flight. */
export function sendTransitOp(positionId, airspace, kind, flightDataId, extra = {}) {
  return sendEfspAirspaceMutation(positionId, airspace.airspaceId, null, { kind, flightDataId, ...extra });
}

/**
 * A request from a choice of transit-rules.js `requestTransitChoices`: sent as the Strip's owner; when this controller also
 * holds the decider, approved by it straight after (the server records the self-coordination, as for activation).
 */
export function requestTransit(choice, flightDataId) {
  sendTransitOp(choice.positionId, choice.airspace, 'RequestTransit', flightDataId);
  if (choice.deciderPositionId) sendTransitOp(choice.deciderPositionId, choice.airspace, 'ApproveTransit', flightDataId);
}
