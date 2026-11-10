// What a press of the key does (ADR 0158 §1, §4): it tells the server which radios transmit, encodes the microphone's
// blocks (already through the limiter, voice-processor.js) into Opus frames and sends each frame up the /srs socket,
// and plays our own start and end tones (and the noise while transmitting, as effects.py).
//
// `down` is idempotent, since ptt-controller.js repeats it every 400 ms as a keepalive. A new encoder per transmission
// means no stale audio leads a call (S-RADIO-1 RQ8). On release the encoder's last frame is flushed before the server
// is told the key is up, so the end of the last word goes out.

const FLUSH_TIMEOUT_MS = 500;

/**
 * @param {object} o
 * @param {{send:(msg:object) => void, sendFrame:(opus:Uint8Array) => void}} o.socket
 * @param {(onFrame:Function) => {encode:Function, finish:() => Promise<void>, close:Function}} o.createEncoder
 * @param {{tone:Function, noise:Function}} o.effects
 * @param {AudioNode} o.dest where our own tones go
 * @param {() => {soundSet:string, noise:boolean}} o.options
 * @param {(radioIds:string[]) => void} [o.onChange]
 * @param {(fn:Function, ms:number) => any} [o.setTimeout]
 */
export function createTxPath(o) {
  const st = o.setTimeout || setTimeout;
  let encoder = null, radioIds = [], stopNoise = null, generation = 0;

  return {
    /** @param {string[]} ids the radios to transmit on (tx-group.js) */
    down(ids) {
      if (encoder || !ids.length) return;
      generation++;
      radioIds = ids;
      encoder = o.createEncoder((frame) => o.socket.sendFrame(frame));
      o.socket.send({ type: 'ptt', down: true, radioIds: ids });
      o.effects.tone(o.dest, o.options().soundSet, 'start');
      if (o.options().noise) stopNoise = o.effects.noise(o.dest, 'AM');
      if (o.onChange) o.onChange(radioIds);
    },
    up() {
      if (!encoder) return;
      const e = encoder, mine = generation;
      encoder = null; radioIds = [];
      if (stopNoise) { stopNoise(); stopNoise = null; }
      o.effects.tone(o.dest, o.options().soundSet, 'end');
      if (o.onChange) o.onChange(radioIds);
      const release = () => { if (mine === generation) o.socket.send({ type: 'ptt', down: false }); };
      Promise.race([e.finish(), new Promise(r => st(r, FLUSH_TIMEOUT_MS))]).then(release, release);
    },
    /** One processed mic block; dropped unless the key is down. */
    block(b) { if (encoder) encoder.encode(b); },
    radioIds: () => radioIds,
    isDown: () => !!encoder,
  };
}
