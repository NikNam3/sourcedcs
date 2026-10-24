'use strict';

// The APRT panel's runway, in true, from the Facility data (crc-sync docs/adr/0139, S-ARCH-93). Pure: it imports nothing.
//
// The extended centreline used to be drawn on the runway NUMBER times ten, read as magnetic and converted to true: Incirlik's
// "05" is 050 magnetic, 055.7 true, but the pavement lies on 052.7 true (U-LTAG-COURSE), so the line was 3 degrees off it. A
// runway end a Facility describes carries its true heading (`endHeadingsTrue`, from DCS's own runway points), and that is
// drawn. Any number of airfields: whichever runway-status record names the APRT airfield's ICAO.

/** "5", "05", "05L" -> "05", "05L"; null for anything that is not a runway designator. */
export function runwayEndKey(text) {
  const m = String(text == null ? '' : text).toUpperCase().trim().match(/^(\d{1,2})([LRC]?)$/);
  return m ? `${m[1].padStart(2, '0')}${m[2]}` : null;
}

/**
 * The true heading of the runway end typed for an airfield, from the runway-status records (one per Facility with runways), or
 * null when no record names the airfield or the end.
 * @param {{icao?:string}|null} apt the APRT panel's airfield
 * @param {string} rwyText what was typed in the runway field
 * @param {object[]} statuses every runway-status record the client holds (`airportIcao`, `runways[].endHeadingsTrue`)
 */
export function facilityRunwayTrueDeg(apt, rwyText, statuses) {
  const end = runwayEndKey(rwyText);
  const icao = apt && apt.icao;
  if (!end || !icao) return null;
  for (const record of statuses || []) {
    if (!record || record.airportIcao !== icao) continue;
    for (const runway of record.runways || []) {
      const h = runway.endHeadingsTrue && runway.endHeadingsTrue[end];
      if (typeof h === 'number' && Number.isFinite(h)) return h;
    }
  }
  return null;
}
