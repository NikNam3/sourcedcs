'use strict';
import { missionNow } from '../../mission-clock.js';
import { getAllTracks } from '../../picture.js';
import { carrierHhmm, carrierStateOf, getEfspCarrier } from './carrier-state.js';
import { shipBearingRangeTo } from './carrier-final-distance.js';
import { sendCarrier } from './carrier-send.js';
import { sendEfspCreateStrip } from './efsp-ws.js';
import { checkInEatUtc } from './marshal-board-model.js';
import { carrierCreateSeed } from './panel/carrier-create.js';

// crc-sync docs/adr/0156: the Marshal checks a flight in, from the MARSHAL panel (side number, squawk) or from a contact on
// the CARRIER MAP (side number; the contact's squawk if it has one, and the Strip bound to the contact). One path for both:
// a CV_RECOVERY at the Marshal's stack, and in Case II/III, from where the contact is, its EAT (checkInEatUtc).

/**
 * The EAT for a flight checking in from this contact, or null when there is no contact, no ship, no marshal radial, or the
 * ship is in Case I (no EAT).
 * @param {object|null} track a picture track
 */
export function checkInEatFor(track) {
  const view = getEfspCarrier();
  const st = carrierStateOf(view);
  if (!track || !st || (view.recoveryCase && view.recoveryCase.value === 'I')) return null;
  const marshalRadialDeg = st.radial && st.radial.ref !== 'GRID' && Number.isFinite(st.radial.value) ? st.radial.value : null;
  const pos = shipBearingRangeTo(track.lat, track.lon);
  if (!pos || marshalRadialDeg == null) return null;
  const eats = ((view.derived || {}).MAIN || []).map(e => e.pushTimeUtc).filter(Number.isFinite);
  return checkInEatUtc({ rangeNm: pos.rangeNm, radialDeg: pos.bearingDeg, marshalRadialDeg, nowMs: missionNow(),
    latestEatUtc: eats.length ? Math.max(...eats) : null });
}

/** The contact squawking this code, or null. */
export function trackSquawking(code) {
  return code ? getAllTracks().find(t => t.ssr && t.ssr.code === code) || null : null;
}

/**
 * Sends the check-in. `squawk` is given only in Case II/III; `track` binds the new Strip to that contact.
 * @returns {{ok:true, eatUtc:number|null} | {ok:false, msg:string}}
 */
export function carrierCheckIn({ side, squawk = '', track = null }) {
  const seed = carrierCreateSeed({ side });
  if (!seed.ok) return seed;
  if (squawk && !/^[0-7]{4}$/.test(squawk)) return { ok: false, msg: 'a squawk is four digits 0-7' };
  const eatUtc = checkInEatFor(track || trackSquawking(squawk));
  sendEfspCreateStrip('CV_MARSHAL', {
    kind: 'CreateStrip', bayId: 'cv-marshal-stack', rackId: 'main', stripType: 'CV_RECOVERY',
    flightData: { ...seed.flightData, ...(squawk ? { beaconCode: squawk } : {}) },
    ...(track ? { trackId: String(track.id) } : {}),
  }, 'CARRIER', {
    onAck: (ack) => {
      if (ack && ack.ok && eatUtc != null && ack.strip) sendCarrier('sequencesStack', { kind: 'SetEat', flightDataId: ack.strip.flightDataId, eat: carrierHhmm(eatUtc) });
      return false;
    },
  });
  return { ok: true, eatUtc };
}
