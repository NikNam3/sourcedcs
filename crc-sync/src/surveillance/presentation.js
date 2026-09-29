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
//   the datalink               -> an own participant's callsign, type and
//                                 altitude (DATALINK)
//   correlation                -> the flight's callsign and type, from its FDR
//
// Only the sensors of THIS controller's Positions count, which is why this
// runs per session.

const { checkOnGround } = require('../geo');
const { indicatedAltFt } = require('../altimetry');

// The wire track, as a list — ws-hub-wire-strictness.test.mjs holds every
// sent track to it.
const WIRE_KEYS = [
  'id', 'lat', 'lon', 'domain', 'onGround', 'illuminatedAt', 'sources',
  'iffState', 'iffOverride', 'label', 'type', 'ssr', 'altitude', 'dl',
];

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
 * @param {object} track  raw TrackStore track (DCS truth — never sent)
 * @param {object} ctx
 * @param {number|null} ctx.at            newest return from this session's sensors
 * @param {Array<{caps:{height:boolean,ssr:boolean}, sweepMs:number, at:number}>} ctx.radars
 *        this session's radars that have seen the contact, each with its own last return
 * @param {{callsign:string, type:string, lock:string|null}|null} ctx.dl
 *        the contact's datalink report, when it is a participant and this session has datalink
 * @param {object} ctx.who               Identity#identify()
 * @param {string} ctx.iffState
 * @param {string|null} ctx.iffOverride
 * @param {{code:string|null, ident:boolean, emergency:string|null}|null} ctx.transponder
 * @param {{weather:object, transitionAltFt:number}} ctx.env
 * @param {object|null} ctx.missionData
 * @returns {object|null} the wire track, or null when the controller must not be told about it
 */
function presentTrack(track, ctx) {
  if (ctx.iffState === 'invisible') return null;
  const radars = currentRadars(ctx.radars, ctx.at);
  if (radars.length === 0 && !ctx.dl) return null;

  const domain = domainOf(track);
  const air = domain === 'AIR';
  const interrogated = air && radars.some(r => r.caps && r.caps.ssr);
  const squawking = interrogated && !!ctx.transponder;
  const heightFinding = air && radars.some(r => r.caps && r.caps.height);
  const dl = air || domain === 'SEA' ? ctx.dl : null;

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
    iffState: ctx.iffState,
    iffOverride: ctx.iffOverride || null,
    label: { callsign, source, tag: who.tag || null, trackNumber: who.trackNumber },
    type: (who.correlation && who.fdrType) || (dl && dl.type) || null,
    ssr: squawking ? { code: ctx.transponder.code, ident: ctx.transponder.ident, emergency: ctx.transponder.emergency } : null,
    altitude,
    dl: dl ? { lock: dl.lock || null } : null,
  };
}

/** The identity-only part of a wire track: what `relabeled` carries. */
function labelPart(wire) {
  return { id: wire.id, iffState: wire.iffState, iffOverride: wire.iffOverride, label: wire.label, type: wire.type };
}

module.exports = { presentTrack, labelPart, domainOf, WIRE_KEYS };
