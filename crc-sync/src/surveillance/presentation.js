'use strict';

// What a controller is told about a contact (docs/adr/0059).
//
// This is the ONE place that decides it. Everything a client receives about
// a track comes out of presentTrack(), and nothing else about the track goes
// on the wire: not its DCS type, raw callsign, coalition, player flag or true
// altitude. What the controller is shown depends on the sensors that saw it:
//
//   a radar return             -> a position (PRIMARY)
//   an interrogating radar     -> the transponder's code and Mode C altitude,
//     (caps.ssr)                  when it is squawking (SSR)
//   a height-finding radar     -> an altitude with no help from the aircraft
//     (caps.height)               (HEIGHT)
//   a Mode 4/5 interrogator    -> friendly, when the contact gives a valid
//     (caps.mode4)                (crypto) reply
//   the datalink               -> an own participant's callsign, type and
//                                 altitude (DATALINK)
//   correlation                -> the flight's callsign and type, from its FDR
//
// IFF is what the interrogation got back (docs/adr/0066): a declaration,
// else datalink or a valid Mode 4 reply -> friendly, a Mode 3/C reply ->
// neutral, nothing -> bogey. Never the DCS coalition.
//
// Only the sensors of THIS controller's Positions count, which is why this
// runs per session — two controllers can see one contact in two colours.
//
// Which scheme draws the contact is per session too (docs/adr/0088, H50): a
// controller holding no ATC Position sees only the tactical scheme; one
// holding ATC Positions sees a contact TACTICAL while any of its current
// tactical radars (or the datalink) sees it, and ATC (STARS) otherwise.

const { checkOnGround } = require('../geo');
const { indicatedAltFt } = require('../altimetry');
const { classifyIff } = require('./iff');

// The wire track, as a list — ws-hub-wire-strictness.test.mjs holds every
// sent track to it.
const WIRE_KEYS = [
  'id', 'lat', 'lon', 'domain', 'onGround', 'illuminatedAt', 'sources',
  'iffState', 'iffOverride', 'label', 'type', 'ssr', 'altitude', 'dl', 'scheme',
];

// How long a tactical radar's last return keeps a contact TACTICAL after the
// radar has lost it, in that radar's own sweeps (H41 S1's hysteresis). Two,
// the same look currentRadars() uses, so a contact at the edge of AWACS cover
// does not flip scheme on every missed sweep.
const SCHEME_HOLD_SWEEPS = 2;

function domainOf(track) {
  if (track.category === 1 || track.category === 2) return 'AIR';
  if (track.category === 4) return 'SEA';
  return 'GROUND';
}

/**
 * The radars that count as having seen the contact on this pass: this
 * session's, and only those whose own last return is part of the current
 * look (within two of its sweeps of the newest). A radar that lost the
 * contact a minute ago does not still lend it an altitude.
 */
function currentRadars(radars, at) {
  return (radars || []).filter(r => r.at != null && at - r.at <= 2 * (r.sweepMs || 0));
}

/**
 * The draw scheme for one contact, for one session (docs/adr/0088).
 *
 * @param {Array<{presentation?:string, sweepMs:number, at:number}>} radars this session's radars that saw it
 * @param {number|null} at  the newest return from this session's sensors
 * @param {boolean} datalink  the contact reports on this session's datalink
 * @param {boolean} atcSession  the session holds at least one ATC Position
 * @returns {'TACTICAL'|'ATC'}
 */
function schemeOf(radars, at, datalink, atcSession) {
  if (!atcSession) return 'TACTICAL';
  if (datalink) return 'TACTICAL';
  const held = (radars || []).some(r => r.presentation === 'TACTICAL' && r.at != null
    && at - r.at <= SCHEME_HOLD_SWEEPS * (r.sweepMs || 0));
  return held ? 'TACTICAL' : 'ATC';
}

/**
 * @param {object} track  raw TrackStore track (DCS truth — never sent)
 * @param {object} ctx
 * @param {number|null} ctx.at            newest return from this session's sensors
 * @param {Array<{caps:{height:boolean,ssr:boolean,mode4:boolean}, sweepMs:number, at:number}>} ctx.radars
 *        this session's radars that have seen the contact, each with its own last return
 * @param {{callsign:string, type:string, lock:string|null}|null} ctx.dl
 *        the contact's datalink report, when it is a participant and this session has datalink
 * @param {object} ctx.who               Identity#identify()
 * @param {boolean} ctx.mode4           the contact would give a valid Mode 4 reply (Transponders#mode4Of)
 * @param {string|null} ctx.iffOverride
 * @param {{code:string|null, ident:boolean, emergency:string|null}|null} ctx.transponder
 * @param {{weather:object, transitionAltFt:number}} ctx.env
 * @param {object|null} ctx.missionData
 * @param {boolean} [ctx.atcSession]  the session holds an ATC Position (docs/adr/0088)
 * @returns {object|null} the wire track, or null when the controller must not be told about it
 */
function presentTrack(track, ctx) {
  const radars = currentRadars(ctx.radars, ctx.at);
  if (radars.length === 0 && !ctx.dl) return null;

  const domain = domainOf(track);
  const air = domain === 'AIR';
  const interrogated = air && radars.some(r => r.caps && r.caps.ssr);
  const squawking = interrogated && !!ctx.transponder;
  const heightFinding = air && radars.some(r => r.caps && r.caps.height);
  const dl = air || domain === 'SEA' ? ctx.dl : null;
  // Mode 3/C is AIR only; a warship answers Mode 4 too. Only a CURRENT radar
  // of this session asks: a stale one lends no colour, as it lends no height.
  const mode4 = (air || domain === 'SEA') && !!ctx.mode4 && radars.some(r => r.caps && r.caps.mode4);
  const iffState = classifyIff({ declared: ctx.iffOverride || null, datalink: !!dl, mode4, mode3: squawking });

  const sources = [];
  if (radars.length) sources.push('PRIMARY');
  if (squawking) sources.push('SSR');
  if (heightFinding) sources.push('HEIGHT');
  if (dl) sources.push('DATALINK');

  let altitude = null;
  const altSource = squawking ? 'MODE_C' : heightFinding ? 'RADAR' : (dl && air) ? 'DATALINK' : null;
  if (altSource && Number.isFinite(track.alt)) {
    const ta = ctx.env.transitionAltFt;
    const ft = indicatedAltFt(track.alt, ctx.env.weather || {}, ta);
    altitude = { ft: Math.round(ft / 100) * 100, ref: ft >= ta ? 'STD' : 'QNH', source: altSource };
  }

  const who = ctx.who;
  let callsign = null;
  let source = null;
  if (who.fdrCallsign && who.correlation === 'CORRELATED') { callsign = who.fdrCallsign; source = 'FDR'; }
  else if (who.fdrCallsign && who.correlation === 'PROVISIONAL') { callsign = who.fdrCallsign; source = 'FDR_PROVISIONAL'; }
  else if (dl && dl.callsign) { callsign = dl.callsign; source = 'DATALINK'; }
  else if (who.tag) { callsign = who.tag; source = 'TAG'; }

  return {
    id: String(track.id),
    lat: track.lat,
    lon: track.lon,
    domain,
    onGround: air ? checkOnGround(track, ctx.missionData) : false,
    illuminatedAt: ctx.at,
    sources,
    iffState,
    iffOverride: ctx.iffOverride || null,
    label: { callsign, source, tag: who.tag || null, trackNumber: who.trackNumber },
    type: (who.correlation && who.fdrType) || (dl && dl.type) || null,
    ssr: squawking ? { code: ctx.transponder.code, ident: ctx.transponder.ident, emergency: ctx.transponder.emergency } : null,
    altitude,
    dl: dl ? { lock: dl.lock || null } : null,
    scheme: schemeOf(ctx.radars, ctx.at, !!dl, !!ctx.atcSession),
  };
}

/** The identity-only part of a wire track: what `relabeled` carries. */
function labelPart(wire) {
  return { id: wire.id, iffState: wire.iffState, iffOverride: wire.iffOverride, label: wire.label, type: wire.type };
}

module.exports = { presentTrack, labelPart, domainOf, schemeOf, WIRE_KEYS, SCHEME_HOLD_SWEEPS };
