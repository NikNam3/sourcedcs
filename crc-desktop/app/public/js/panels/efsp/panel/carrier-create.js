'use strict';

// crc-sync docs/adr/0156: what the toolbar's create form sends for a carrier Strip. A leaf (imports nothing) so node:test
// reads it directly. The carrier names an aircraft by its side number: PriFly types side, type and departure radial, the
// Marshal side, type and fuel. The server checks all of it again (carrier/create-seed.js); this only says what is wrong
// before anything is sent.

const KLB = 1000;

/** The carrier strip types and the one extra field each origin's form asks for. */
export const CARRIER_CREATE_EXTRA = Object.freeze({
  CV_LAUNCH:   { placeholder: 'DEP RAD', maxLength: 3, title: 'Departure radial, degrees magnetic (090)' },
  CV_RECOVERY: { placeholder: 'FUEL', maxLength: 5, title: 'Fuel in thousands of pounds (4.8) or pounds (4800)' },
});

export function isCarrierOrigin(origin) {
  return !!origin && Object.prototype.hasOwnProperty.call(CARRIER_CREATE_EXTRA, origin.stripType);
}

/**
 * @param {'CV_LAUNCH'|'CV_RECOVERY'} stripType
 * @param {{side:string, type:string, extra:string}} typed
 * @returns {{ok:true, flightData:object} | {ok:false, msg:string}}
 */
export function carrierCreateSeed(stripType, { side = '', type = '', extra = '' } = {}) {
  const sideNumber = String(side).trim().toUpperCase();
  if (!sideNumber) return { ok: false, msg: 'Enter the side number first' };
  if (!/^[A-Z0-9]{1,8}$/.test(sideNumber)) return { ok: false, msg: 'The side number is 1-8 letters or digits' };
  const flightData = { sideNumber, aircraftType: String(type).trim().toUpperCase() };
  const x = String(extra).trim();
  if (x !== '' && stripType === 'CV_LAUNCH') {
    if (!/^\d{1,3}$/.test(x) || Number(x) > 360) {
      return { ok: false, msg: `The third field of a launch is its departure radial (degrees, 000-360), not ${x}: a launch has no fuel` };
    }
    flightData.departureRadialDeg = Number(x);
  }
  if (x !== '' && stripType === 'CV_RECOVERY') {
    if (!/^\d+(\.\d+)?$/.test(x)) return { ok: false, msg: 'Fuel is in thousands ("4.8") or pounds' };
    const v = Number(x);
    flightData.lowStateLb = Math.round(v < 100 ? v * KLB : v); // as spoken, NATOPS 6.4.13.2 (marshal-board-model fuelBlockOp)
  }
  return { ok: true, flightData };
}
