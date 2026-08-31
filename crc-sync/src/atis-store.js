'use strict';

// Tracks which client "owns" an active ATIS transmit loop per frequency, so
// crc-sync (the single shared backend every controller's crc-desktop connects
// to) can reject a second client's loop on the same frequency instead of
// blindly forwarding both to SRS. Previously /api/atis-transmit was fully
// stateless — nothing here before this stopped multiple clients from
// double-transmitting, and stop() sends the first real cancel signal the
// server has ever received (before, "stop" only cleared a client-side timer).
//
// ownerId is a client-generated id (crc-desktop mints one per app session),
// not the Casdoor identity — ATIS transmit is a stateless REST POST, not a
// WS session, so there's no existing per-connection identity to key off.

class AtisStore {
  // ttlMs guards the in-flight-call collision check below (canStart/_byFreq).
  // presenceTtlMs is separate and much longer: it backs getActive(), the
  // "is anyone transmitting on this frequency" list broadcast to every
  // client (see ws-hub.js's 'atis' message). _byFreq only holds an entry
  // for the duration of a single gRPC Transmit call, but a real ATIS loop
  // is "in use" through the 5s pause between calls too — and the call
  // itself is synchronous SRS TTS playback (opts.async=false in
  // grpc-client.js's transmitAtis), so its duration is however long the
  // spoken text takes, not a fixed tick. presenceTtlMs needs enough margin
  // to outlast a single realistic ATIS transmission so "in use" doesn't
  // flicker off mid-playback; a stuck/crashed client still self-heals once
  // it lapses.
  constructor(ttlMs = 8000, presenceTtlMs = 45000) {
    this._byFreq = new Map(); // frequency -> { ownerId, startedAt, call }
    this._ttlMs  = ttlMs;
    this._active = new Map(); // frequency -> { ownerId, lastSeenAt } — see getActive()
    this._presenceTtlMs = presenceTtlMs;
  }

  _isStale(entry) {
    return Date.now() - entry.startedAt > this._ttlMs;
  }

  // A loop may (re)start on a frequency if nobody else holds it, the same
  // owner already holds it (its own next 5s tick), or the holder went stale
  // (e.g. the process died mid-transmit without calling stop/finish).
  canStart(freq, ownerId) {
    const entry = this._byFreq.get(freq);
    if (!entry) return true;
    if (entry.ownerId === ownerId) return true;
    return this._isStale(entry);
  }

  start(freq, ownerId, call) {
    this._byFreq.set(freq, { ownerId, startedAt: Date.now(), call });
    this._active.set(freq, { ownerId, lastSeenAt: Date.now() });
  }

  // Only clears the in-flight entry if it's still the same call — a settling
  // callback from a call that's already been superseded (e.g. a same-owner
  // retry raced ahead of it) must not clobber the newer entry. Deliberately
  // does NOT touch _active: a finished call just means this loop iteration's
  // transmission played, not that the owner is done with the frequency —
  // only stop() or the presence TTL clears that. Still refreshes the
  // presence timestamp for the same reason getActive()'s margin exists:
  // it's another confirmed sign of life from the same owner/loop.
  finish(freq, call) {
    const entry = this._byFreq.get(freq);
    if (!entry || entry.call !== call) return;
    this._byFreq.delete(freq);
    const activeEntry = this._active.get(freq);
    if (activeEntry && activeEntry.ownerId === entry.ownerId) activeEntry.lastSeenAt = Date.now();
  }

  // Only the owner that started a loop can stop it. Cancelling the in-flight
  // gRPC call at minimum stops crc-sync from waiting on/reporting it, even if
  // the DCS-SRS side can't be interrupted mid-playback. Clears this owner's
  // presence entry unconditionally (even with no in-flight call — e.g. STOP
  // pressed during the 5s pause between transmissions, when _byFreq is
  // already empty but the frequency should still free up immediately).
  stop(freq, ownerId) {
    const activeEntry = this._active.get(freq);
    if (activeEntry && activeEntry.ownerId === ownerId) this._active.delete(freq);

    const entry = this._byFreq.get(freq);
    if (!entry || entry.ownerId !== ownerId) return false;
    if (entry.call && typeof entry.call.cancel === 'function') {
      try { entry.call.cancel(); } catch (_) { /* already settled */ }
    }
    this._byFreq.delete(freq);
    return true;
  }

  // Frequencies with a currently-active ATIS loop, for the live "in use"
  // broadcast — every connected client, not just the next one to collide
  // with it via canStart(). Prunes anything that's gone quiet for longer
  // than presenceTtlMs (a crashed client that never called stop()).
  getActive() {
    const cutoff = Date.now() - this._presenceTtlMs;
    for (const [freq, entry] of this._active) {
      if (entry.lastSeenAt < cutoff) this._active.delete(freq);
    }
    return [...this._active.entries()].map(([frequency, entry]) => ({
      frequency: Number(frequency), ownerId: entry.ownerId,
    }));
  }
}

module.exports = AtisStore;
