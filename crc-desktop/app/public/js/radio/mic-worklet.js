// The microphone's AudioWorkletProcessor (ADR 0158 §1, §6): it cuts the input into BLOCK_SAMPLES blocks and posts
// each to the main thread. mic-capture.js loads this file by its absolute path (`audioWorklet.addModule`); it imports
// only MIC_PROCESSOR_NAME from here, so the file is in the module graph and its cutter is unit-tested, and the
// registration below runs only inside an AudioWorkletGlobalScope. This file imports nothing: a worklet module's
// imports would be fetched again inside the worklet scope.

export const MIC_PROCESSOR_NAME = 'crc-srs-mic';

/**
 * Collects samples into fixed-size blocks (pure).
 * @param {number} size samples per block
 * @returns {{push:(input:Float32Array) => Float32Array[], reset:() => void}}
 */
export function createFrameCutter(size) {
  let buf = new Float32Array(size), fill = 0;
  return {
    push(input) {
      const out = [];
      let i = 0;
      while (i < input.length) {
        const take = Math.min(size - fill, input.length - i);
        buf.set(input.subarray(i, i + take), fill);
        fill += take; i += take;
        if (fill === size) { out.push(buf); buf = new Float32Array(size); fill = 0; }
      }
      return out;
    },
    reset() { fill = 0; },
  };
}

if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor === 'function') {
  class MicFrames extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.cutter = createFrameCutter((options && options.processorOptions && options.processorOptions.blockSamples) || 960);
    }
    process(inputs) {
      const ch = inputs[0] && inputs[0][0];
      if (ch) for (const block of this.cutter.push(ch)) this.port.postMessage(block, [block.buffer]);
      return true;
    }
  }
  registerProcessor(MIC_PROCESSOR_NAME, MicFrames);
}
