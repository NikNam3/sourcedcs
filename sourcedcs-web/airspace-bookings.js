'use strict';

/* Pure rules for airspace bookings and the one-time legacy-range migration
   (docs/adr/0098 section 9, H100 DA-5 b). No I/O: routes/bookings.js feeds it
   the live arrays and the registry's definitions. */

const SEPARATION_FT = 999;

function overlap(aS, aE, bS, bE) { return aS < bE && bS < aE; }
function sameRef(a, b) { return !!a && !!b && a.theater === b.theater && a.airspaceId === b.airspaceId; }

/* null lower = the surface, null upper = unbounded; bounds inclusive (ADR 0098 section 6) */
function altitudeInBand(altFt, def) {
  const lo = def && def.altLowerFt != null ? def.altLowerFt : -Infinity;
  const hi = def && def.altUpperFt != null ? def.altUpperFt : Infinity;
  return altFt >= lo && altFt <= hi;
}
function bandText(def) {
  const lo = def && def.altLowerFt != null ? def.altLowerFt + ' ft' : 'the surface';
  const hi = def && def.altUpperFt != null ? def.altUpperFt + ' ft' : 'unbounded';
  return lo + ' to ' + hi;
}

function findAirspaceConflict(bookings, ref, start, end, altitude, excludeId) {
  return bookings.find(b =>
    b.resourceType === 'airspace' && sameRef(b.airspaceRef, ref) && b.id !== excludeId &&
    overlap(start, end, new Date(b.startTime), new Date(b.endTime)) &&
    Math.abs(altitude - b.altitude) < SEPARATION_FT);
}

/* Plans moving every booking of `range` onto the registry airspace `def`
   (null = unknown target). Returns { refusals: [...], moved: [bookingIds] }.
   Nothing is changed here; the caller applies the plan only when refusals is empty.
   Deconfliction is judged between bookings that have not ended (history that
   overlapped in the past breaks nothing). */
function planMigration({ rangeId, ref, def, bookings, allowOutOfBand, nowMs }) {
  const refusals = [];
  if (!def) {
    refusals.push({ kind: 'UNKNOWN_TARGET', detail: 'airspace ' + ref.airspaceId + ' is not in the ' + ref.theater + ' registry' });
    return { refusals, moved: [] };
  }
  const mine = bookings.filter(b => b.resourceType === 'range' && b.resourceId === rangeId);
  if (!allowOutOfBand) {
    for (const b of mine) {
      if (!altitudeInBand(b.altitude, def)) {
        refusals.push({ kind: 'OUT_OF_BAND', bookingId: b.id, altitude: b.altitude, band: bandText(def), startTime: b.startTime, endTime: b.endTime, by: b.bookedBy && b.bookedBy.name });
      }
    }
  }
  const live = (b) => new Date(b.endTime).getTime() > nowMs;
  const target = bookings.filter(b => b.resourceType === 'airspace' && sameRef(b.airspaceRef, ref) && live(b));
  const movingLive = mine.filter(live);
  for (const m of movingLive) {
    for (const t of target) {
      if (overlap(new Date(m.startTime), new Date(m.endTime), new Date(t.startTime), new Date(t.endTime)) && Math.abs(m.altitude - t.altitude) < SEPARATION_FT) {
        refusals.push({ kind: 'DECONFLICTION', bookingId: m.id, otherBookingId: t.id, altitude: m.altitude, otherAltitude: t.altitude, startTime: m.startTime, endTime: m.endTime });
      }
    }
  }
  return { refusals, moved: mine.map(b => b.id) };
}

module.exports = { SEPARATION_FT, overlap, sameRef, altitudeInBand, bandText, findAirspaceConflict, planMigration };
