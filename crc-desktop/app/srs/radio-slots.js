'use strict';
// The renderer's radios as SRS radio slots, and back (pure; ADR 0158 §1, §4; S-RADIO-1 RQ5, RQ13).
//
// SRS knows a client's radios as eleven numbered slots; the renderer knows them by radio identity
// (`POSITION:<positionId>:UHF`, `GUARD:VHF`, `MANUAL:<id>`, docs/parallel/radio/README.md). Radios on the same
// frequency and modulation share one slot (two radios on 243.000 AM are one SRS radio), and a received packet maps
// back to every radio of its slot. Past eleven distinct channels the first eleven are tuned and the rest reported as an
// error (the backstop of S-RADIO-1 RQ13: radio-set.js already marks those radios as conflicting, so reaching this is a
// bug upstream, and losing the first eleven over it would be worse).

const { MAX_RADIOS, Modulation } = require('./sync-message');

/**
 * Two frequencies closer than this are the same channel. It is SRS's own closeness test as remembered from
 * RadioBase.FreqCloseEnough (500 Hz); not confirmed against the source (docs/wip/RADIO-CORE.md). The closest real
 * channel spacing, 8.33 kHz, is far wider.
 */
const MATCH_TOLERANCE_HZ = 500;

/** A channel name is tuned literally (122.105 goes out as 122 105 000 Hz): SRS and DCS do no 8.33 conversion. */
const mhzToHz = (mhz) => Math.round(Number(mhz) * 1e6);

/** The modulations a radio here may have (S-RADIO-2 RQ18: AM, and FM for manual radios; no intercom). */
const MODULATIONS = Object.freeze({ AM: Modulation.AM, FM: Modulation.FM });

const sameChannel = (s, hz, modulation) => Math.abs(s.hz - hz) < MATCH_TOLERANCE_HZ && s.modulation === modulation;

/**
 * @param {Array<{id:string, mhz:number, modulation?:string, label?:string}>} radios
 * @returns {{slots:Array<{radioIds:string[], hz:number, modulation:number, name:string}>, overflow:string[],
 *   invalid:string[], error:string|null}}
 */
function buildSlots(radios) {
  const slots = [], invalid = [], overflow = [];
  const seen = new Set();
  for (const r of radios || []) {
    if (!r || typeof r.id !== 'string' || seen.has(r.id)) continue;
    seen.add(r.id);
    const hz = mhzToHz(r.mhz);
    const modulation = MODULATIONS[String(r.modulation || 'AM').toUpperCase()];
    if (!(hz > 0) || modulation === undefined) { invalid.push(r.id); continue; }
    const shared = slots.find(s => sameChannel(s, hz, modulation));
    if (shared) { shared.radioIds.push(r.id); continue; }
    if (slots.length >= MAX_RADIOS) { overflow.push(r.id); continue; }
    slots.push({ radioIds: [r.id], hz, modulation, name: r.label || r.id });
  }
  const error = overflow.length ? `SRS has ${MAX_RADIOS} radio slots; not tuned: ${overflow.join(', ')}` : null;
  return { slots, overflow, invalid, error };
}

/**
 * The radios a received packet is heard on: every radio of a slot tuned to one of its frequencies with the same
 * modulation. An encrypted segment (encryption != 0) is not heard: this client has no keys.
 */
function matchRadioIds(slots, frequencies, modulations, encryptions) {
  const out = [];
  for (const s of slots) {
    for (let i = 0; i < frequencies.length; i++) {
      if (encryptions && encryptions[i]) continue;
      if (sameChannel(s, frequencies[i], modulations[i])) { out.push(...s.radioIds); break; }
    }
  }
  return out;
}

/**
 * What a transmission on these radios carries: one entry per slot that holds one of them (ADR 0158 §4: a group
 * transmits as one packet stream with every frequency of the group). Radios with no slot are left out.
 */
function txChannels(slots, radioIds) {
  const want = new Set(radioIds);
  const frequencies = [], modulations = [], encryptions = [], used = [];
  for (const s of slots) {
    const mine = s.radioIds.filter(id => want.has(id));
    if (!mine.length) continue;
    frequencies.push(s.hz); modulations.push(s.modulation); encryptions.push(0); used.push(...mine);
  }
  return { frequencies, modulations, encryptions, radioIds: used };
}

/** The slot SRS should show as selected (`radioIndex`): the first transmitting radio's, else 0. */
function selectedSlot(slots, radioIds) {
  const i = slots.findIndex(s => s.radioIds.some(id => radioIds.includes(id)));
  return i < 0 ? 0 : i;
}

module.exports = { MATCH_TOLERANCE_HZ, MODULATIONS, mhzToHz, buildSlots, matchRadioIds, txChannels, selectedSlot };
