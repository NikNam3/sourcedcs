'use strict';

// What each aircraft's transponder is sending (docs/adr/0059).
//
// A radar that interrogates (SSR, or a military IFF interrogator) gets the
// Mode 3/A code and Mode C altitude from a squawking aircraft. This module
// answers "what is it squawking", from the only data we have:
//
//   - A player: SRS reports their transponder (srs-client.js). No SRS client,
//     or the transponder switched off, is no transponder at all.
//   - An AI aircraft: SRS knows nothing about it, so crc-sync gives it a
//     synthetic code from the reserved 6000–6777 block, stable for the life
//     of the unit. Only for the coalitions sensor-specs.json names
//     (`transponder.syntheticFor`) — hostile AI flies with it off.
//
// Mode C is implied whenever the transponder is on. We have no real Mode C:
// the altitude itself is computed from DCS truth (presentation.js), and this
// module only decides whether a radar could have received one.
//
// Ships and ground vehicles have none.
//
// Mode 4/5 is the military crypto mode (docs/adr/0066). A valid reply needs
// our keys, so only our own side can give one: that, and only that, is why
// this module reads the coalition — it stands for the crypto key, never for
// the colour. A player answers when SRS says the transponder and its Mode 4
// switch are on; own AI aircraft and ships are assumed keyed
// (`transponder.mode4For`). Ground vehicles have no IFF. What an answer MEANS
// on the scope is surveillance/iff.js's job, not this module's.

const { SYNTHETIC_BLOCK_START, SYNTHETIC_BLOCK_SIZE } = require('../efsp/code-allocator');
const { USER_COALITION } = require('./iff');

const EMERGENCIES = { '7500': 'HIJACK', '7600': 'RADIO', '7700': 'GENERAL' };

/**
 * A squawk as the 4-digit octal string the EFSP uses, or null.
 *
 * SRS reports Mode 3/A as a NUMBER; code-allocator.js mints 4-digit octal
 * strings. A value containing an 8 or a 9 is not a Mode 3/A code at all, and
 * yields null rather than a plausible-looking wrong answer.
 */
function octalCode(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  const code = String(n).padStart(4, '0');
  return /^[0-7]{4}$/.test(code) ? code : null;
}

function coalitionClass(coalition) {
  if (coalition === USER_COALITION) return 'own';
  if (coalition === 1 || coalition == null || coalition === 0) return 'neutral';
  return 'hostile';
}

/** A small stable hash of a unit id, so a unit keeps its code across restarts of the same mission. */
function hashId(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

class Transponders {
  /**
   * @param {object} deps
   * @param {{getTransponder:(playerName:string)=>object|null}|null} deps.srs
   * @param {{syntheticFor:string[], mode4For:string[]}} [deps.config] sensor-specs.json `transponder`
   */
  constructor({ srs, config } = {}) {
    this._srs = srs || null;
    this._syntheticFor = new Set((config && config.syntheticFor) || ['own', 'neutral']);
    this._mode4For = new Set((config && config.mode4For) || ['own']);
    this._synthetic = new Map(); // trackId -> code
    this._inUse = new Set();     // synthetic codes held
  }

  /**
   * @returns {{code:string|null, ident:boolean, emergency:string|null}|null}
   *   null when the aircraft has no transponder on.
   */
  transponderOf(track) {
    if (!track || (track.category !== 1 && track.category !== 2)) return null;

    if (track.player) {
      const entry = this._srs ? this._srs.getTransponder(track.player) : null;
      if (!entry || entry.squawkStatus === 0) return null;
      const code = octalCode(entry.squawk);
      return { code, ident: entry.squawkStatus === 2, emergency: (code && EMERGENCIES[code]) || null };
    }

    if (!this._syntheticFor.has(coalitionClass(track.coalition))) return null;
    const code = this._syntheticCode(String(track.id));
    return code ? { code, ident: false, emergency: null } : null;
  }

  /**
   * Would this contact give a VALID Mode 4/5 reply to one of our
   * interrogators? Valid means our crypto, so only our own side can: an
   * enemy player with the switch on still has the wrong keys. A player needs
   * SRS with the transponder on and the Mode 4 switch on (SRS models no
   * separate Mode 5). AI aircraft and ships of a `mode4For` class are assumed
   * keyed. Vehicles have no IFF.
   * @returns {boolean}
   */
  mode4Of(track) {
    if (!track) return false;
    const cat = track.category;
    if (cat !== 1 && cat !== 2 && cat !== 4) return false;
    if (coalitionClass(track.coalition) !== 'own') return false; // the crypto key, not the colour
    if (track.player) {
      const e = this._srs ? this._srs.getTransponder(track.player) : null;
      // squawkStatus undefined (the legacy SRS block) is "on", as in transponderOf.
      return !!(e && e.squawkStatus !== 0 && (e.mode4 === true || e.mode4 === 1));
    }
    return this._mode4For.has('own');
  }

  _syntheticCode(id) {
    const held = this._synthetic.get(id);
    if (held) return held;
    const start = hashId(id) % SYNTHETIC_BLOCK_SIZE;
    for (let i = 0; i < SYNTHETIC_BLOCK_SIZE; i++) {
      const n = SYNTHETIC_BLOCK_START + ((start + i) % SYNTHETIC_BLOCK_SIZE);
      const code = n.toString(8).padStart(4, '0');
      if (this._inUse.has(code)) continue;
      this._inUse.add(code);
      this._synthetic.set(id, code);
      return code;
    }
    return null; // 512 AI aircraft squawking at once: the rest fly with it off
  }

  /** A unit has left the picture: its synthetic code goes back to the block. */
  release(trackId) {
    const id = String(trackId);
    const code = this._synthetic.get(id);
    if (!code) return;
    this._synthetic.delete(id);
    this._inUse.delete(code);
  }

  /** Releases every synthetic code whose unit is no longer live. */
  retain(liveIds) {
    for (const id of [...this._synthetic.keys()]) if (!liveIds.has(id)) this.release(id);
  }

  /** Mission reload. */
  clear() {
    this._synthetic.clear();
    this._inUse.clear();
  }
}

module.exports = { Transponders, octalCode, coalitionClass, EMERGENCIES };
