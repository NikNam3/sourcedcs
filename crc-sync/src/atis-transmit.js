'use strict';

// POST /api/atis-transmit's handler (docs/adr/0158 §5): one ATIS loop tick on one or two frequencies (the airfield's
// UHF and its optional VHF). DCS-gRPC's TransmitRequest carries a single frequency, so a tick starts one SRS Transmit
// per frequency, concurrently, and answers once every one has finished: the client's loop waits for that answer before
// its next tick. Ownership stays per frequency in AtisStore; a start is refused whole when any of its frequencies is
// held by another client, and says which one. A stop releases (and cancels) every frequency it names.

const MAX_FREQUENCIES = 2;

/**
 * The request's frequencies in Hz, or an error string. One or two, each a positive whole number of Hz, no repeats.
 * @param {unknown} list
 * @returns {{frequencies: number[]}|{error: string}}
 */
function parseFrequencies(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_FREQUENCIES) {
    return { error: `frequencies must list one or ${MAX_FREQUENCIES} frequencies in Hz` };
  }
  const frequencies = list.map(Number);
  if (!frequencies.every(f => Number.isSafeInteger(f) && f > 0)) return { error: 'each frequency must be a positive whole number of Hz' };
  if (new Set(frequencies).size !== frequencies.length) return { error: 'frequencies must not repeat' };
  return { frequencies };
}

function mhzText(hz) { return (hz / 1e6).toFixed(3); }

/**
 * @param {object} deps
 * @param {import('./atis-store')} deps.atisStore
 * @param {{transmitAtis: (opts: object) => {call: object|null, promise: Promise<object>}}} deps.grpcClient
 * @param {{setAtisActive: (list: object[]) => void}} deps.wsHub
 * @returns {(req: {body?: object}, res: object) => void}
 */
function createAtisTransmitHandler({ atisStore, grpcClient, wsHub }) {
  const broadcast = () => wsHub.setAtisActive(atisStore.getActive());

  return function atisTransmit(req, res) {
    const body = req.body || {};
    const { ownerId, stop } = body;
    if (!ownerId) return res.status(400).json({ error: 'ownerId is required' });
    const parsed = parseFrequencies(body.frequencies);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const { frequencies } = parsed;

    if (stop) {
      for (const f of frequencies) atisStore.stop(f, ownerId);
      broadcast();
      return res.json({ ok: true });
    }

    const refused = atisStore.firstRefused(frequencies, ownerId);
    if (refused != null) {
      return res.status(409).json({
        error: `Another client is already transmitting on ${mhzText(refused)}`,
        reason: 'in-use', frequency: refused,
      });
    }

    // What grpc-client.js's transmitAtis reads, with one frequency each.
    const { ssml, text, coalition, position, lat, lon, alt, clientName } = body;
    const calls = frequencies.map((frequency) => {
      const { call, promise } = grpcClient.transmitAtis({ ssml, text, coalition, position, lat, lon, alt, clientName, frequency });
      atisStore.start(frequency, ownerId, call);
      return { frequency, call, promise };
    });
    broadcast();

    Promise.allSettled(calls.map(c => c.promise)).then((results) => {
      calls.forEach(c => atisStore.finish(c.frequency, c.call));
      const failed = results.map((r, i) => ({ r, frequency: calls[i].frequency })).filter(x => x.r.status === 'rejected');
      if (failed.length) {
        const error = failed.map(x => `${mhzText(x.frequency)}: ${(x.r.reason && x.r.reason.message) || 'transmit failed'}`).join('; ');
        return res.status(503).json({ error, frequencies: failed.map(x => x.frequency) });
      }
      const durations = results.map(r => r.value && r.value.duration_ms).filter(d => d != null);
      res.json({ ok: true, duration_ms: durations.length ? Math.max(...durations) : undefined });
    });
  };
}

module.exports = { createAtisTransmitHandler, parseFrequencies };
