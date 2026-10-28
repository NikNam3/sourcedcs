'use strict';

// A carrier LAUNCH meets its ATO MISSION line (docs/adr/0109, decisions H109).
//
// The ATO import puts every mission line, carrier-based or not, on TACTICAL (ADR 0071). A launch
// Strip is a MARSHAL Strip in LAUNCH, made by CV_MARSHAL (ADR 0064/0074) with no ATO in sight, so
// without this the flight would be a second flight with a second Mode 3/A and none of the line's
// plan, MARSA or military Blocks. L14's ATO-first direction for OPS is a picker in the client that
// sends `flightDataId`; the Marshal has no picker, so the server does the same join: by callsign,
// and only when it is unambiguous (two lines with one callsign are an answer the Marshal gives by
// binding explicitly, ADR 0046).

const TACTICAL = 'TACTICAL';

function _callsignOf(seed) {
  const c = seed && seed.callsign;
  return typeof c === 'string' ? c.trim().toUpperCase() : '';
}

/**
 * The flight an ATO tasked whose callsign this new launch carries, when exactly one qualifies:
 * an ATO-tasked flight (`flightData.ato`) with a live MISSION Strip on TACTICAL and no other live
 * Strip anywhere (a flight already filed or already launched is not "waiting for its launch").
 *
 * @param {object} ctx a Board op context (flightDataStore, rules.peerBoard, rules.liveStripsForFlightData)
 * @param {{callsign?:string}} seed the op's `flightData`
 * @returns {object|null} the flight data to bind, or null
 */
function atoFlightForLaunch(ctx, seed) {
  const wanted = _callsignOf(seed);
  const rules = ctx && ctx.rules;
  if (!wanted || !rules || typeof rules.peerBoard !== 'function' || typeof rules.liveStripsForFlightData !== 'function') return null;
  const tactical = rules.peerBoard(TACTICAL);
  if (!tactical) return null;
  const missionLines = new Map(); // flightDataId -> live MISSION Strips on TACTICAL
  for (const s of tactical.getAll()) {
    if (s.stripType !== 'MISSION' || s.state === 'DROPPED') continue;
    missionLines.set(s.flightDataId, (missionLines.get(s.flightDataId) || 0) + 1);
  }
  const hits = [];
  for (const [flightDataId, lines] of missionLines) {
    const f = ctx.flightDataStore.getFlightData(flightDataId);
    if (!f || !f.ato || !f.identity || f.identity.callsign !== wanted) continue;
    if (rules.liveStripsForFlightData(flightDataId) !== lines) continue; // something else is live on it
    hits.push(f);
  }
  return hits.length === 1 ? hits[0] : null;
}

module.exports = { atoFlightForLaunch };
