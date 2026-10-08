'use strict';
import { getActingPositions, sendEfspCarrierMutation } from './efsp-ws.js';
import { getEfspCarrier } from './carrier-state.js';

// Who may do what on the carrier, as this controller's signed-on Positions allow it, and the one way a carrier op is sent.
// Split out of carrier-panel.js so the Strip panel's carrier surfaces and the carrier management panel share it without
// importing each other.

// Client mirror of crc-sync's CARRIER_CAPABILITIES (authority/positions/carrier.js, read through permission.js) (drift-tested). A UX
// convenience: the server's predicates are the authority.
//   editsCarrierState  the carrier management panel (crc-sync docs/adr/0113, decisions H119): PriFly and the Marshal
//   sequencesStack     who lands in which slot: the Marshal
export const CARRIER_CAPABILITIES = {
  CV_MARSHAL: { editsCarrierState: true,  sequencesStack: true },
  CV_PRIFLY:  { editsCarrierState: true,  sequencesStack: false },
  CV_APP1:    { editsCarrierState: false, sequencesStack: false },
  CV_APP2:    { editsCarrierState: false, sequencesStack: false },
};

/** The signed-on CV Position that has this capability, or null. Pure over `signedOnIds`. */
export function carrierActingFor(capability, signedOnIds) {
  for (const id of signedOnIds || []) {
    if (CARRIER_CAPABILITIES[id] && CARRIER_CAPABILITIES[id][capability]) return id;
  }
  return null;
}

/** This controller's signed-on Positions at the CARRIER Facility. */
export function signedOnCarrierIds() {
  return getActingPositions('CARRIER').filter(id => CARRIER_CAPABILITIES[id]);
}

/** Sends one carrier op as the signed-on Position that has the capability. False (nothing sent) when none does. */
export function sendCarrier(capability, op) {
  const acting = carrierActingFor(capability, signedOnCarrierIds());
  if (!acting) return false;
  const view = getEfspCarrier();
  sendEfspCarrierMutation(acting, view ? view.hullId : undefined, undefined, op);
  return true;
}

/** Types a value over the carrier state (`value: null` clears the override: "Use DCS" / "Use default"). */
export function sendCarrierState(field, value) {
  return sendCarrier('editsCarrierState', { kind: 'SetCarrierState', field, value });
}
