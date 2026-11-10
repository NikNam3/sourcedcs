'use strict';
// The APRT panel's ATIS frequencies (crc-sync docs/adr/0158 §5): the UHF one and an optional VHF one, transmitted on
// both. Pure: turns the two inputs into the Hz list POST /api/atis-transmit takes, says what is wrong with an input,
// and finds a frequency another controller's ATIS holds. aprt-panel.js does the DOM and the loop.
import { bandOf } from '../radio/bands.js';

const MHZ_RE = /^\d{1,3}(\.\d{1,3})?$/;

function mhzOf(value) {
  const t = String(value == null ? '' : value).trim();
  return MHZ_RE.test(t) ? Number(t) : null;
}

/**
 * What is wrong with an ATIS frequency input, or null when nothing is. Empty is fine (the VHF one is optional, the UHF
 * one is checked when TRANSMIT is pressed). The UHF input only hints: crc-sync never band-checked it, so a saved value
 * outside UHF still transmits; a VHF value outside VHF is refused by crc-sync (apt-config.js) and not transmitted.
 * @param {string} value
 * @param {'UHF'|'VHF'} band
 */
export function atisFreqProblem(value, band) {
  const t = String(value == null ? '' : value).trim();
  if (t === '') return null;
  const mhz = mhzOf(t);
  if (mhz == null || !(mhz > 0)) return 'Not a frequency in MHz.';
  if (bandOf(mhz) !== band) return `Not in the ${band} band.`;
  return null;
}

/**
 * The frequencies an ATIS tick transmits on, in Hz: the UHF input's (if it is a number), then the VHF input's (if it
 * is in the VHF band), with no repeat.
 */
export function atisFrequenciesHz(uhfValue, vhfValue) {
  const out = [];
  const uhf = mhzOf(uhfValue);
  if (uhf != null && uhf > 0) out.push(Math.round(uhf * 1e6));
  if (atisFreqProblem(vhfValue, 'VHF') == null) {
    const vhf = mhzOf(vhfValue);
    if (vhf != null) {
      const hz = Math.round(vhf * 1e6);
      if (!out.includes(hz)) out.push(hz);
    }
  }
  return out;
}

/** The first of `freqsHz` another owner's ATIS is on, from crc-sync's `atis` list, or null. */
export function atisInUseElsewhere(active, freqsHz, ownerId) {
  for (const hz of freqsHz) {
    if ((active || []).some(a => a.frequency === hz && a.ownerId !== ownerId)) return hz;
  }
  return null;
}

/** `251.000` for 251000000 Hz. */
export function atisMhzText(hz) { return (hz / 1e6).toFixed(3); }

/** The status line for a frequency another controller's ATIS holds. */
export function atisInUseText(hz) { return `IN USE ${atisMhzText(hz)} (another client)`; }
