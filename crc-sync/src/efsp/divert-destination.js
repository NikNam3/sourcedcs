'use strict';

// Which destinations are "a field we run" (docs/adr/0111 §3, H114). Pure: it reads nothing at require time. The caller
// passes what the Facilities and the carrier config already say, so a Facility added later (Konya, Akrotiri) makes its
// field ours with no change here.

/**
 * @param {object} deps
 * @param {() => string[]} deps.airportIcaos the ICAO codes the Facility configs name (`runwayStatus.airportIcao`)
 * @param {() => string[]} deps.hullIds the carrier hull ids (config/efsp-carriers.json)
 * @param {Record<string,string>} [deps.icaoByName] airfield name to ICAO (data/icao.json)
 * @returns {(text:string) => {kind:'FIELD'|'CARRIER'|'OTHER', code:string}}
 */
function createDivertDestinations({ airportIcaos, hullIds, icaoByName = {} }) {
  const byName = new Map(Object.entries(icaoByName).map(([name, icao]) => [name.trim().toUpperCase(), String(icao).toUpperCase()]));
  return function classify(text) {
    const typed = String(text == null ? '' : text).trim().toUpperCase();
    if (typed === '') return { kind: 'OTHER', code: '' };
    const hulls = hullIds().map(h => String(h).toUpperCase());
    if (hulls.includes(typed)) return { kind: 'CARRIER', code: typed };
    const code = byName.get(typed) || typed;
    const fields = airportIcaos().map(c => String(c).toUpperCase());
    if (fields.includes(code)) return { kind: 'FIELD', code };
    return { kind: 'OTHER', code: typed };
  };
}

module.exports = { createDivertDestinations };
