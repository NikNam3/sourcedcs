'use strict';

// crc-sync docs/adr/0156: what the toolbar's create form sends for a carrier Strip. A leaf (imports nothing) so node:test
// reads it directly. A carrier Strip is created by its side number alone; the type, the departure radial and the fuel are
// typed on the Strip afterwards, as on any Strip. The server checks the side number again (carrier/create-seed.js).

const CARRIER_STRIP_TYPES = new Set(['CV_LAUNCH', 'CV_RECOVERY']);

export function isCarrierOrigin(origin) {
  return !!origin && CARRIER_STRIP_TYPES.has(origin.stripType);
}

/**
 * @param {{side:string}} typed
 * @returns {{ok:true, flightData:{sideNumber:string}} | {ok:false, msg:string}}
 */
export function carrierCreateSeed({ side = '' } = {}) {
  const sideNumber = String(side).trim().toUpperCase();
  if (!sideNumber) return { ok: false, msg: 'Enter the side number first' };
  if (!/^[A-Z0-9]{1,8}$/.test(sideNumber)) return { ok: false, msg: 'The side number is 1-8 letters or digits' };
  return { ok: true, flightData: { sideNumber } };
}
